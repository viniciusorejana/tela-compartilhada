// Servidor de midia (SFU). Cada pessoa envia UMA copia do proprio video para ca, e daqui
// ele sai para os outros. Isso substitui a malha ponto a ponto por dois motivos:
//
//   1. Todo mundo faz conexao de SAIDA para este servidor, que tem IP publico. Nao existe
//      mais o problema de furar o NAT dos dois lados -- que era a causa de a tela nunca
//      chegar em quem estava em rede movel.
//   2. Quem transmite deixa de enviar N-1 copias. O custo passa a ser de quem hospeda.
//
// A sinalizacao NAO abre porta: ela entra pelo mesmo HTTPS que serve a pagina e e
// encaminhada aqui para o processo local. So a midia (UDP) usa porta propria.
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { caminhoDoBinario, VERSAO } = require('./scripts/baixar-livekit.cjs');

const PASTA = path.join(__dirname, 'native', 'livekit');
const ARQUIVO_DE_CHAVES = path.join(PASTA, 'chaves.json');
const ARQUIVO_DE_CONFIG = path.join(PASTA, 'livekit.yaml');

const PORTA_LOCAL = Number(process.env.SFU_PORT) || 7880;
const PORTA_TCP = Number(process.env.SFU_TCP_PORT) || 7881;
const PORTAS_UDP = process.env.SFU_UDP_PORTS || '7882-7891';

// Faixas de túnel, VPN ou rede de emergência: nenhuma delas leva mídia de fora até aqui, e
// todas contam como "mais um endereço em que tentar abrir a porta".
const FAIXAS_QUE_NAO_SERVEM = [
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'sem DHCP'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'CGNAT ou Tailscale'],
  [/^26\./, 'Radmin VPN'],
  [/^25\./, 'Hamachi']
];

// Descobre os endereços IPv4 reais desta máquina e restringe o servidor de mídia a eles.
//
// Sem isso ele tenta abrir a porta em TODOS os endereços que encontrar -- e um PC comum tem
// muito mais do que parece: Tailscale, VPNs, e sobretudo os vários IPv6 temporários que o
// Windows cria por privacidade na mesma placa. Dois deles na mesma porta e o "bind" falha,
// o que encerra o processo INTEIRO e deixa a sala sem vídeo nem voz.
function enderecosParaEscutar() {
  const escolhidos = [];
  for (const [nome, enderecos] of Object.entries(os.networkInterfaces())) {
    for (const endereco of enderecos || []) {
      if (endereco.family !== 'IPv4' || endereco.internal) continue;
      const motivo = FAIXAS_QUE_NAO_SERVEM.find(([padrao]) => padrao.test(endereco.address));
      if (motivo) continue;
      escolhidos.push({ ip: endereco.address, interface: nome });
    }
  }
  return escolhidos;
}
const VALIDADE_DO_TOKEN = 6 * 60 * 60;
const SERVIDORES_STUN = [['stun.l.google.com', 19302], ['stun.cloudflare.com', 3478], ['stun1.l.google.com', 19302]];

// Pergunta a um servidor STUN qual endereço o mundo vê, por uma porta qualquer do sistema.
//
// O servidor de mídia sabe fazer isso sozinho, mas usa a MESMA porta da mídia -- e então não
// consegue mais abri-la para valer: "bind: only one usage of each socket address", e o
// processo encerra. Descobrindo aqui e entregando o endereço pronto, ele nunca precisa
// tentar. Só o endereço público volta desta conversa; nada é enviado além do pedido padrão.
function descobrirIpPublico(servidor, porta) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const transacao = crypto.randomBytes(12);
    const pedido = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00]),          // Binding Request, sem atributos
      Buffer.from([0x21, 0x12, 0xa4, 0x42]),          // magic cookie
      transacao
    ]);
    const desistir = () => { try { socket.close(); } catch (_) {} resolve(null); };
    const prazo = setTimeout(desistir, 2500);
    socket.on('error', () => { clearTimeout(prazo); desistir(); });
    socket.on('message', mensagem => {
      clearTimeout(prazo);
      try {
        if (mensagem.readUInt16BE(0) !== 0x0101 || !mensagem.subarray(8, 20).equals(transacao)) return desistir();
        let posicao = 20;
        while (posicao + 4 <= mensagem.length) {
          const tipo = mensagem.readUInt16BE(posicao);
          const tamanho = mensagem.readUInt16BE(posicao + 2);
          const valor = mensagem.subarray(posicao + 4, posicao + 4 + tamanho);
          // 0x0020 = XOR-MAPPED-ADDRESS; família 0x01 = IPv4.
          if (tipo === 0x0020 && valor[1] === 0x01) {
            const bytes = [...valor.subarray(4, 8)].map((b, i) => b ^ pedido[4 + i]);
            try { socket.close(); } catch (_) {}
            return resolve(bytes.join('.'));
          }
          posicao += 4 + tamanho + ((4 - (tamanho % 4)) % 4);  // atributos vêm alinhados em 4
        }
      } catch (_) { /* Resposta ilegível: tenta o próximo servidor. */ }
      desistir();
    });
    socket.send(pedido, porta, servidor, erro => { if (erro) { clearTimeout(prazo); desistir(); } });
  });
}

async function ipPublicoDescoberto() {
  for (const [servidor, porta] of SERVIDORES_STUN) {
    const ip = await descobrirIpPublico(servidor, porta);
    if (ip) return ip;
  }
  return null;
}

// Estado observavel: a sala precisa poder DIZER que a midia esta fora do ar, em vez de
// mostrar uma tela preta sem explicacao.
const estado = { ativo: false, motivo: 'nao iniciado', versao: VERSAO };
let processo = null;
let chaves = null;
let encerrando = false;
// Reinicio supervisionado. Um processo que morre nao pode deixar a sala muda ate alguem
// reiniciar o Node na mao -- ninguem esta olhando o terminal no meio de uma conversa.
let tentativasSeguidas = 0;
let horaDoUltimoInicio = 0;
let timerDeReinicio = null;
const MAXIMO_DE_REINICIOS = 8;
const SEGUNDOS_PARA_CONSIDERAR_ESTAVEL = 60;

function lerOuCriarChaves() {
  if (chaves) return chaves;
  try {
    const salvas = JSON.parse(fs.readFileSync(ARQUIVO_DE_CHAVES, 'utf8'));
    if (salvas.apiKey && salvas.apiSecret) return (chaves = salvas);
  } catch (_) { /* Primeira execução, ou arquivo inutilizável: gera de novo. */ }
  chaves = {
    apiKey: 'nexo' + crypto.randomBytes(6).toString('hex'),
    apiSecret: crypto.randomBytes(32).toString('base64url')
  };
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO_DE_CHAVES, JSON.stringify(chaves, null, 2), { mode: 0o600 });
  return chaves;
}

// O YAML e gerado a cada inicializacao a partir do ambiente. Um arquivo editado a mao
// viraria uma configuracao fantasma: valeria o que esta no disco, nao o que foi pedido.
async function escreverConfig() {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  // Configurado tem precedência; senão perguntamos por STUN, uma vez, antes de subir.
  const ipPublico = (process.env.NEXO_IP_PUBLICO || '').trim() || (await ipPublicoDescoberto()) || '';
  const linhas = [
    `port: ${PORTA_LOCAL}`,
    // O 7880 so escuta em localhost: quem chega de fora passa obrigatoriamente pelo proxy
    // do Node, entao abrir essa porta no roteador por engano nao expoe nada.
    'bind_addresses:',
    `  - ${process.env.SFU_BIND || '127.0.0.1'}`,
    'log_level: info',
    'rtc:',
    `  udp_port: ${PORTAS_UDP}`,
    `  tcp_port: ${PORTA_TCP}`,
    // Quem esta na mesma rede local conecta pelo IP interno, sem sair e voltar pela internet.
    '  advertise_internal_ip: true',
    // ICE lite so vale para servidor com IP proprio na interface. Este esta atras do
    // roteador de casa; ligado, a negociacao falharia para quem vem de fora.
    '  use_ice_lite: false'
  ];

  // Uma lista fechada de endereços é mais segura que uma lista de exclusões: o que aparecer
  // depois (uma VPN que alguém instalar amanhã) fica de fora sozinho.
  const escutar = process.env.SFU_IPS
    ? process.env.SFU_IPS.split(',').map(v => v.trim()).filter(Boolean)
    : enderecosParaEscutar().map(item => item.ip);
  if (escutar.length) {
    linhas.push('  ips:', '    includes:', ...escutar.map(ip => `      - ${ip}/32`));
  }
  // O endereço anunciado vem SEMPRE pronto daqui -- configurado ou descoberto acima. Deixar
  // que ele descubra sozinho (use_external_ip) é o que fazia o processo encerrar: a
  // descoberta ocupa a porta da mídia e depois a abertura de verdade falha.
  if (ipPublico) {
    linhas.push('  use_external_ip: false', `  node_ip: ${ipPublico}`);
  } else {
    // Sem endereço público nenhum, resta a rede local: a sala funciona entre quem está aqui.
    linhas.push('  use_external_ip: false');
  }
  // O TURN embutido existe para servidor SEM IP publico. Este tem, e o fallback de TCP
  // acima ja cobre quem bloqueia UDP.
  linhas.push('turn:', '  enabled: false', 'keys:', `  ${apiKey}: ${apiSecret}`, '');
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO_DE_CONFIG, linhas.join('\n'), 'utf8');
  return { ipPublico };
}

// Se o Node for encerrado à força (Ctrl+C não chega, o Gerenciador de Tarefas mata, a
// máquina desliga no tranco), o servidor de mídia fica rodando sozinho segurando a porta --
// e o próximo "npm start" sobe um que não consegue abri-la e encerra em seguida, num ciclo
// que não se resolve sozinho. Só processos deste MESMO executável são encerrados: outro
// LiveKit que a pessoa tenha instalado para outra coisa não é da nossa conta.
function encerrarOrfaos(binario) {
  try {
    if (process.platform === 'win32') {
      const escapado = binario.replace(/'/g, "''");
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Process livekit-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${escapado}' } | Stop-Process -Force`
      ], { stdio: 'ignore', timeout: 8000, windowsHide: true });
    } else {
      execFileSync('pkill', ['-f', binario], { stdio: 'ignore', timeout: 8000 });
    }
  } catch (_) { /* Nenhum órfão, ou nada que possamos encerrar: seguir e deixar o log dizer. */ }
}

async function iniciarSfu() {
  const binario = caminhoDoBinario();
  if (!fs.existsSync(binario)) {
    estado.motivo = 'binario-ausente';
    console.error(`\nO servidor de mídia não está instalado em ${binario}.`);
    console.error('Rode "npm start" (ou "node scripts/baixar-livekit.cjs") para baixá-lo.');
    console.error('Sem ele a sala abre, mas ninguém consegue ver nem ouvir ninguém.\n');
    return estado;
  }

  // Só na primeira subida: num reinício supervisionado o processo anterior já morreu, e
  // varrer de novo só atrasaria a volta.
  if (!tentativasSeguidas) encerrarOrfaos(binario);
  const { ipPublico } = await escreverConfig();
  if (encerrando) return estado;
  horaDoUltimoInicio = Date.now();
  processo = spawn(binario, ['--config', ARQUIVO_DE_CONFIG], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // "iniciado" nao e o mesmo que "pronto": ele ainda descobre o proprio IP por STUN, o que
  // leva alguns segundos. Anunciar antes disso faz quem abre a sala nesse intervalo receber
  // um erro e ficar sem midia ate recarregar.
  estado.ativo = false;
  estado.motivo = 'iniciando';
  aguardarProntidao();

  const registrar = (fluxo, prefixo) => {
    let restante = '';
    fluxo.setEncoding('utf8');
    fluxo.on('data', pedaco => {
      const linhas = (restante + pedaco).split('\n');
      restante = linhas.pop();
      linhas.filter(Boolean).forEach(linha => console.log(`${prefixo} ${linha}`));
    });
  };
  registrar(processo.stdout, '[mídia]');
  registrar(processo.stderr, '[mídia]');

  processo.on('exit', codigo => {
    processo = null;
    estado.ativo = false;
    estado.motivo = 'encerrado';
    if (encerrando) return;
    console.error(`\nO servidor de mídia encerrou (código ${codigo}).`);
    reiniciarDepoisDeCair();
  });
  processo.on('error', erro => {
    processo = null;
    estado.ativo = false;
    estado.motivo = 'falha-ao-iniciar';
    console.error('Não foi possível iniciar o servidor de mídia:', erro.message);
    if (!encerrando) reiniciarDepoisDeCair();
  });

  const escutando = enderecosParaEscutar().map(item => `${item.ip} (${item.interface})`).join(', ') || 'nenhuma placa de rede utilizável';
  console.log(`Servidor de mídia ${VERSAO}: UDP ${PORTAS_UDP}, TCP ${PORTA_TCP}${ipPublico ? `, anunciando ${ipPublico}` : ', descobrindo o IP público'}`);
  console.log(`  escutando em: ${escutando}`);
  return estado;
}

// Uma queda logo depois de subir e sintoma de configuracao, e insistir depressa so enche o
// log. Uma queda depois de horas no ar e outra coisa -- ai vale voltar rapido.
function reiniciarDepoisDeCair() {
  if (encerrando || timerDeReinicio) return;
  if (Date.now() - horaDoUltimoInicio > SEGUNDOS_PARA_CONSIDERAR_ESTAVEL * 1000) tentativasSeguidas = 0;
  if (tentativasSeguidas >= MAXIMO_DE_REINICIOS) {
    estado.motivo = 'nao-sobe';
    console.error(`Ele não sobe depois de ${MAXIMO_DE_REINICIOS} tentativas. A causa mais comum é a porta de mídia ocupada por outro processo -- confira com "netstat -ano | findstr 7882". A sala segue com chat; vídeo e voz voltam quando o motivo acima for resolvido e o servidor reiniciado.\n`);
    return;
  }
  const espera = Math.min(30, 2 ** tentativasSeguidas);
  tentativasSeguidas++;
  console.error(`Subindo de novo em ${espera}s (tentativa ${tentativasSeguidas}).\n`);
  timerDeReinicio = setTimeout(() => { timerDeReinicio = null; if (!encerrando) iniciarSfu(); }, espera * 1000);
  timerDeReinicio.unref?.();
}

function responde() {
  return new Promise(resolve => {
    const pedido = http.request({ host: '127.0.0.1', port: PORTA_LOCAL, path: '/', method: 'GET', timeout: 1500 }, res => {
      res.resume();
      resolve(true);
    });
    pedido.on('error', () => resolve(false));
    pedido.on('timeout', () => { pedido.destroy(); resolve(false); });
    pedido.end();
  });
}

async function aguardarProntidao() {
  for (let tentativa = 0; tentativa < 60 && processo; tentativa++) {
    if (await responde()) {
      estado.ativo = true;
      estado.motivo = null;
      console.log('Servidor de mídia pronto para receber conexões.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (processo) {
    estado.motivo = 'sem-resposta';
    console.error('O servidor de mídia subiu mas não respondeu. A sala fica sem vídeo nem voz.');
  }
}

// Sem isto um Ctrl+C deixaria o processo filho segurando as portas, e o proximo "npm start"
// falharia sem dizer por que.
function encerrarSfu() {
  encerrando = true;
  clearTimeout(timerDeReinicio);
  timerDeReinicio = null;
  if (!processo) return;
  processo.kill();
  processo = null;
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sinal, () => { encerrarSfu(); process.exit(0); });
}
process.on('exit', encerrarSfu);

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

// Token de acesso do LiveKit: um JWT HS256 assinado com o segredo que so existe aqui.
// O navegador recebe apenas o token pronto, com prazo, sala e permissoes ja embutidos --
// ele nao escolhe sala nem permissao.
function criarToken(sala, identidade, nome) {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify({
    iss: apiKey,
    sub: identidade,
    name: nome,
    nbf: agora,
    exp: agora + VALIDADE_DO_TOKEN,
    video: { room: sala, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true }
  }));
  const assinatura = crypto.createHmac('sha256', apiSecret).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

// O cliente do LiveKit acrescenta "/rtc" ao endereco que recebe. Encaminhando esse caminho
// para o processo local, a sinalizacao viaja pelo MESMO HTTPS que serve a pagina: nada de
// porta extra, certificado ou dominio proprio para o WebSocket.
function instalarProxy(app, server) {
  app.use('/rtc', (req, res) => {
    const alvo = http.request({
      host: '127.0.0.1', port: PORTA_LOCAL, method: req.method,
      path: '/rtc' + req.url, headers: { ...req.headers, host: `127.0.0.1:${PORTA_LOCAL}` }
    }, resposta => {
      res.writeHead(resposta.statusCode, resposta.headers);
      resposta.pipe(res);
    });
    alvo.on('error', () => {
      if (!res.headersSent) res.status(503).json({ error: 'Servidor de mídia indisponível' });
      else res.end();
    });
    req.pipe(alvo);
  });

  server.on('upgrade', (req, socket, head) => {
    let caminho = '';
    try { caminho = new URL(req.url, 'http://local').pathname; } catch (_) { return; }
    if (caminho !== '/rtc' && !caminho.startsWith('/rtc/')) return;

    // Sem desligar o algoritmo de Nagle, os pacotes pequenos de ping/pong ficam retidos
    // esperando companhia. O cliente conclui que o servidor sumiu e derruba a sessao no
    // meio da conversa -- foi exatamente o que apareceu como "ping timeout".
    socket.setNoDelay(true);
    socket.setTimeout(0);

    const alvo = net.connect(PORTA_LOCAL, '127.0.0.1', () => {
      alvo.setNoDelay(true);
      alvo.setTimeout(0);
      const cabecalhos = Object.entries(req.headers)
        .map(([nome, valor]) => `${nome}: ${Array.isArray(valor) ? valor.join(', ') : valor}`);
      alvo.write(`GET ${req.url} HTTP/1.1\r\n${cabecalhos.join('\r\n')}\r\n\r\n`);
      if (head?.length) alvo.write(head);
      socket.pipe(alvo);
      alvo.pipe(socket);
    });
    const desistir = () => { socket.destroy(); alvo.destroy(); };
    alvo.on('error', desistir);
    socket.on('error', desistir);
    // Um lado fechando precisa fechar o outro: sem isto sobra um socket meio aberto por
    // reconexao, e uma sala longa acumula dezenas deles.
    alvo.on('close', () => socket.destroy());
    socket.on('close', () => alvo.destroy());
  });
}

module.exports = { iniciarSfu, encerrarSfu, criarToken, instalarProxy, estado, PORTA_LOCAL };
