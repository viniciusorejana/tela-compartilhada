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
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { caminhoDoBinario, VERSAO } = require('./scripts/baixar-livekit.cjs');

const PASTA = path.join(__dirname, 'native', 'livekit');
const ARQUIVO_DE_CHAVES = path.join(PASTA, 'chaves.json');
const ARQUIVO_DE_CONFIG = path.join(PASTA, 'livekit.yaml');

const PORTA_LOCAL = Number(process.env.SFU_PORT) || 7880;
const PORTA_TCP = Number(process.env.SFU_TCP_PORT) || 7881;
const PORTAS_UDP = process.env.SFU_UDP_PORTS || '7882-7891';
const VALIDADE_DO_TOKEN = 6 * 60 * 60;

// Estado observavel: a sala precisa poder DIZER que a midia esta fora do ar, em vez de
// mostrar uma tela preta sem explicacao.
const estado = { ativo: false, motivo: 'nao iniciado', versao: VERSAO };
let processo = null;
let chaves = null;
let encerrando = false;

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
function escreverConfig() {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  const ipPublico = (process.env.NEXO_IP_PUBLICO || '').trim();
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
  if (ipPublico) {
    // IP fixo e conhecido: anunciar direto e mais previsivel que descobrir por STUN a cada
    // inicializacao. use_external_ip tem precedencia, entao precisa ficar desligado.
    linhas.push('  use_external_ip: false', `  node_ip: ${ipPublico}`);
  } else {
    // Sem configuracao, descobre sozinho. Muito roteador domestico nao devolve o proprio
    // IP publico para dentro (sem NAT loopback), e ai a auto-verificacao falharia.
    linhas.push('  use_external_ip: true', '  skip_external_ip_validation: true');
  }
  // O TURN embutido existe para servidor SEM IP publico. Este tem, e o fallback de TCP
  // acima ja cobre quem bloqueia UDP.
  linhas.push('turn:', '  enabled: false', 'keys:', `  ${apiKey}: ${apiSecret}`, '');
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO_DE_CONFIG, linhas.join('\n'), 'utf8');
  return { ipPublico };
}

function iniciarSfu() {
  const binario = caminhoDoBinario();
  if (!fs.existsSync(binario)) {
    estado.motivo = 'binario-ausente';
    console.error(`\nO servidor de mídia não está instalado em ${binario}.`);
    console.error('Rode "npm start" (ou "node scripts/baixar-livekit.cjs") para baixá-lo.');
    console.error('Sem ele a sala abre, mas ninguém consegue ver nem ouvir ninguém.\n');
    return estado;
  }

  const { ipPublico } = escreverConfig();
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
    if (!encerrando) console.error(`\nO servidor de mídia encerrou (código ${codigo}). A sala continua, mas sem vídeo nem voz.\n`);
  });
  processo.on('error', erro => {
    processo = null;
    estado.ativo = false;
    estado.motivo = 'falha-ao-iniciar';
    console.error('Não foi possível iniciar o servidor de mídia:', erro.message);
  });

  console.log(`Servidor de mídia ${VERSAO}: UDP ${PORTAS_UDP}, TCP ${PORTA_TCP}${ipPublico ? `, anunciando ${ipPublico}` : ', descobrindo o IP público'}`);
  return estado;
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
