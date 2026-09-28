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
const telemetriaLivekit = require('./telemetria/livekit');

const PASTA = path.resolve(process.env.NEXO_PASTA_SFU || path.join(__dirname, 'native', 'livekit'));

// O executável e a configuração não precisam morar juntos.
//
// O Windows Defender cria a regra de firewall por CAMINHO do executável: binário em pasta
// nova é aplicativo novo, e a caixa de "permitir acesso" reaparece. Os testes isolavam a
// configuração numa pasta sorteada e levavam o binário junto, então cada execução pedia a
// permissão outra vez.
//
// Separar os dois resolve sem desfazer o isolamento que importa. A configuração continua
// sorteada por execução; o binário fica num caminho fixo -- e ainda assim diferente do
// instalado, porque encerrarOrfaos() casa pelo caminho exato e um teste não pode alcançar
// o servidor de verdade que esteja rodando na máquina.
const BINARIO = process.env.NEXO_BINARIO_SFU
  ? path.resolve(process.env.NEXO_BINARIO_SFU)
  : path.join(PASTA, path.basename(caminhoDoBinario()));
let portaWebhook = Number(process.env.PORT) || 3000;
const ARQUIVO_DE_CHAVES = path.join(PASTA, 'chaves.json');
const ARQUIVO_DE_CONFIG = path.join(PASTA, 'livekit.yaml');

const PORTA_LOCAL = Number(process.env.SFU_PORT) || 7880;
const PORTA_METRICAS = Number(process.env.SFU_METRICAS_PORT) || 7883;
const PORTA_TCP = Number(process.env.SFU_TCP_PORT) || 7881;

// Quanto do servidor de midia aparece no terminal:
//
//   (vazio)   so as linhas de ERROR, FATAL e WARN -- o padrao
//   1         tudo, para investigar ICE de perto
//   arquivo   tudo em native/livekit/sfu.log, porque problema de ICE costuma acontecer as
//             duas da manha, quando ninguem esta olhando o terminal
//   0         silencio total
//
// O padrao mudou de "silencio com um aviso generico" para "so os avisos". O aviso generico
// dizia para conferir o painel, mas o painel mostra saude e reinicios -- nao a frase que o
// SFU escreveu. Quem lia aquilo nao tinha para onde ir.
//
// As linhas de INFO sao as que carregam nome e endereco dos participantes; as de erro
// falam do servidor. Por isso o padrao mostra as segundas e esconde as primeiras.
const REGISTRO_SFU = (process.env.NEXO_LOG_SFU || '').trim().toLowerCase();
const registroDetalhado = REGISTRO_SFU === '1' || REGISTRO_SFU === 'console' || REGISTRO_SFU === 'arquivo';
const registroSilencioso = REGISTRO_SFU === '0';
// O nível é o SEGUNDO campo da linha, separado por tabulação:
//
//   2026-09-15T12:00:01-0400 <tab> INFO <tab> livekit.sub <tab> ...
//
// Procurar a palavra em qualquer lugar da linha não serve: metade das linhas de INFO
// carrega um campo "error" no JSON -- é assim que o LiveKit conta por que desistiu de uma
// faixa, por exemplo -- e todas elas vazavam para o terminal como se fossem problema.
// Ancorar no campo do nível é o que separa "a linha é um erro" de "a linha fala de um erro".
const LINHA_DE_PROBLEMA = /^\S+\s+(WARN|ERROR|FATAL|DPANIC|PANIC)\b|"level":"(?:warn|error|fatal|dpanic|panic)"/i;
const ARQUIVO_DE_LOG = path.join(PASTA, 'sfu.log');
const BYTES_MAXIMOS_DO_LOG = 8 * 1024 * 1024;
let bytesDoLog = 0;

function guardarLinha(linha) {
  if (REGISTRO_SFU !== 'arquivo') { console.log(linha); return; }
  try {
    // Uma rotacao so, para o log nunca virar o maior arquivo do disco durante uma
    // investigacao esquecida ligada.
    if (bytesDoLog > BYTES_MAXIMOS_DO_LOG) {
      fs.renameSync(ARQUIVO_DE_LOG, `${ARQUIVO_DE_LOG}.anterior`);
      bytesDoLog = 0;
    }
    const texto = `${new Date().toISOString()} ${linha}\n`;
    fs.appendFileSync(ARQUIVO_DE_LOG, texto);
    bytesDoLog += Buffer.byteLength(texto);
  } catch (_) { /* Sem log nao se derruba a sala: o diagnostico e opcional, a midia nao. */ }
}
// UMA porta de midia, nao uma faixa. Com uma faixa, o servidor de midia abre uma porta por
// conexao: dez regras para acertar no roteador em vez de uma, dez associacoes de NAT para o
// roteador domestico manter vivas, e dez chances de uma delas expirar no meio da conversa --
// que aparece como "a imagem de fulano parou" sem nada no log dizendo por que. Com uma so,
// todo o trafego e multiplexado nela: uma regra, uma associacao, um ponto de falha.
//
// A faixa continua disponivel por variavel de ambiente para quem precisar dela.
const PORTAS_UDP = process.env.SFU_UDP_PORTS || '7882';

// Faixas de túnel, VPN ou rede de emergência: nenhuma delas leva mídia de fora até aqui, e
// todas contam como "mais um endereço em que tentar abrir a porta".
const FAIXAS_QUE_NAO_SERVEM = [
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'sem DHCP'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'CGNAT ou Tailscale'],
  [/^26\./, 'Radmin VPN'],
  [/^25\./, 'Hamachi']
];

// O Tailscale é a exceção da faixa acima, e a exceção foi comprada com tempo de conexão.
//
// Quem entra pela URL da tailnet recebia dois candidatos: o da LAN e o IP público. O da LAN
// tem prioridade de "host" -- é tentado primeiro -- e para quem está fora daquela LAN ele
// simplesmente não responde. A conexão só acontecia depois de esse candidato morto esgotar
// o prazo. O endereço da tailnet conserta isso: para quem está na tailnet ele responde na
// hora, direto e cifrado, sem depender de encaminhamento de porta no roteador.
//
// O preço: para quem NÃO está na tailnet o 100.x é mais um candidato que nunca responde.
// E "usar a URL da tailnet" não é o mesmo que "estar na tailnet": com o Funnel ligado, o
// endereço .ts.net atende a internet inteira, e quem chega por ali não alcança um 100.x.
//
// Por isso o padrão é DESLIGADO: só ajuda quando existem outras máquinas registradas na
// tailnet, e ligar sem elas só acrescenta espera para todo mundo. Confira com
// `tailscale status`; se aparecer mais de uma máquina, NEXO_ANUNCIAR_TAILSCALE=1 passa a
// valer a pena.
//
// A faixa 100.64/10 também é CGNAT de operadora, onde nada disso vale. Por isso a exceção
// olha o NOME da interface, não só o endereço.
const INTERFACE_DE_TAILSCALE = /tailscale|^ts\d/i;
const anunciarTailscale = (process.env.NEXO_ANUNCIAR_TAILSCALE || '').trim() === '1';
const ehEnderecoDeTailscale = (nome, ip) =>
  anunciarTailscale && INTERFACE_DE_TAILSCALE.test(nome) && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

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
      if (motivo && !ehEnderecoDeTailscale(nome, endereco.address)) continue;
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
let reiniciosTotais = 0;
let validarAcesso = null;
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

// Anunciar o IP interno só vale se alguém puder alcançá-lo -- e quem pode depende de onde
// esta máquina está, não de uma preferência.
//
// Em casa vale: quem está na mesma rede conecta direto, sem sair e voltar pela internet. Num
// servidor alugado não vale nada, e custa duas coisas. O endereço privado de lá (172.31.x.x
// na AWS, 10.128.x.x no GCP) não é alcançável por ninguém de fora, então cada cliente gasta
// tempo de checagem ICE num candidato que nunca vai responder; e o servidor passa a ter DOIS
// candidatos TCP no mesmo listener da 7881, que o ICE trata como dois pares válidos do mesmo
// fio e fica alternando entre eles para sempre -- o log enche de "ice reconnected or switched
// pair" sem que nada tenha acontecido de verdade.
//
// A pergunta "estou num servidor alugado?" tem uma resposta objetiva: o endereço de metadados
// das nuvens. AWS, GCP, Azure, Oracle, DigitalOcean, Hetzner e Vultr respondem nele; fora de
// nuvem ele não é roteável, e a tentativa falha em milissegundos em vez de esperar o prazo --
// então perguntar é barato mesmo na máquina de casa, onde a resposta é sempre "não".
const ENDERECO_DE_METADADOS = '169.254.169.254';
const MS_PARA_METADADOS = 400;

function estaNaNuvem() {
  return new Promise(resolve => {
    let respondido = false;
    const responder = valor => { if (!respondido) { respondido = true; try { socket.destroy(); } catch (_) {} resolve(valor); } };
    const socket = net.connect({ host: ENDERECO_DE_METADADOS, port: 80 });
    socket.setTimeout(MS_PARA_METADADOS);
    socket.on('connect', () => responder(true));
    socket.on('timeout', () => responder(false));
    socket.on('error', () => responder(false));
  });
}

// O YAML e gerado a cada inicializacao a partir do ambiente. Um arquivo editado a mao
// viraria uma configuracao fantasma: valeria o que esta no disco, nao o que foi pedido.
async function escreverConfig() {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  // Configurado tem precedência; senão perguntamos por STUN, uma vez, antes de subir.
  const ipPublico = (process.env.NEXO_IP_PUBLICO || '').trim() || (await ipPublicoDescoberto()) || '';

  // Uma lista fechada de endereços é mais segura que uma lista de exclusões: o que aparecer
  // depois (uma VPN que alguém instalar amanhã) fica de fora sozinho.
  const escutar = process.env.SFU_IPS
    ? process.env.SFU_IPS.split(',').map(v => v.trim()).filter(Boolean)
    : enderecosParaEscutar().map(item => item.ip);

  // Quando o IP público JÁ é um dos endereços desta máquina -- o caso do VPS com IP direto --
  // não há nada a decidir: os dois candidatos seriam o mesmo endereço, e o problema não
  // existe. Fora isso, estamos atrás de NAT, e aí a nuvem decide.
  const publicoEhDaMaquina = Boolean(ipPublico) && escutar.includes(ipPublico);
  const escolhaManual = (process.env.NEXO_ANUNCIAR_LAN || '').trim();
  const anunciarLan = escolhaManual
    ? escolhaManual !== '0'
    : publicoEhDaMaquina || !(await estaNaNuvem());

  const linhas = [
    `port: ${PORTA_LOCAL}`,
    'prometheus:',
    `  port: ${PORTA_METRICAS}`,
    '  username: nexo-metricas',
    `  password: ${crypto.createHmac('sha256', apiSecret).update('metricas').digest('hex')}`,
    'webhook:',
    `  api_key: ${apiKey}`,
    '  urls:',
    `    - http://127.0.0.1:${portaWebhook}/api/telemetria/livekit`,
    // O 7880 so escuta em localhost: quem chega de fora passa obrigatoriamente pelo proxy
    // do Node, entao abrir essa porta no roteador por engano nao expoe nada.
    'bind_addresses:',
    `  - ${process.env.SFU_BIND || '127.0.0.1'}`,
    // `NEXO_NIVEL_SFU=debug` abre o que o servidor decide sobre cada assinatura -- é o único
    // lugar em que aparece por que uma faixa pedida não desce. Junto de NEXO_LOG_SFU=arquivo,
    // que é quem guarda as linhas.
    `log_level: ${['debug', 'info', 'warn', 'error'].includes(process.env.NEXO_NIVEL_SFU) ? process.env.NEXO_NIVEL_SFU : 'info'}`,
    'rtc:',
    `  udp_port: ${PORTAS_UDP}`,
    `  tcp_port: ${PORTA_TCP}`,
    `  advertise_internal_ip: ${anunciarLan}`,
    // ICE lite deixaria o servidor só RESPONDER, sem fazer checagem de conectividade. Num
    // servidor com IP próprio na interface isso é válido e conecta um pouco mais rápido --
    // mas quando falha, falha de um jeito difícil de diagnosticar, e o ganho é pequeno
    // demais para ser ligado sozinho. Fica atrás de uma variável, para quem quiser medir.
    `  use_ice_lite: ${process.env.NEXO_ICE_LITE === '1' && publicoEhDaMaquina}`
  ];
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
  return { ipPublico, anunciarLan, publicoEhDaMaquina };
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

async function iniciarSfu(portaHttp) {
  if (Number.isInteger(portaHttp) && portaHttp > 0) portaWebhook = portaHttp;
  if (process.env.NEXO_SEM_MIDIA === '1') { estado.motivo = 'desativado'; return estado; }
  const binario = BINARIO;
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
  const { ipPublico, anunciarLan, publicoEhDaMaquina } = await escreverConfig();
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
      restante = linhas.pop().slice(-8192);
      // Diagnosticar ICE -- par trocado, candidato que não responde, reconexão em laço --
      // se faz LENDO estas linhas: elas dizem qual endereço falhou e por quanto tempo, e
      // nada no painel substitui isso. O que o SFU escreve em INFO é que traz identidade e
      // endereço de quem está na sala; o que ele escreve em ERROR e WARN fala dele mesmo.
      // Daí o corte: os problemas aparecem sempre, o resto só quando alguém pedir.
      if (registroSilencioso) return;
      for (const linha of linhas) {
        if (!linha || (!registroDetalhado && !LINHA_DE_PROBLEMA.test(linha))) continue;
        guardarLinha(`${prefixo} ${linha}`);
      }
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
  // Dizer a decisão em vez de deixá-la implícita: quem migrar para um servidor alugado
  // precisa poder confirmar, numa linha, que o endereço inútil parou de ser anunciado.
  console.log(`  rede local: ${publicoEhDaMaquina
    ? 'o IP público é desta máquina, então há um candidato só'
    : anunciarLan
      ? 'anunciada (quem estiver na mesma rede conecta direto)'
      : 'não anunciada (servidor em nuvem: ninguém alcançaria o endereço interno)'}`);
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
  reiniciosTotais++;
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
  process.on(sinal, encerrarSfu);
}
process.on('exit', encerrarSfu);

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

// Token de acesso do LiveKit: um JWT HS256 assinado com o segredo que so existe aqui.
// O navegador recebe apenas o token pronto, com prazo, sala e permissoes ja embutidos --
// ele nao escolhe sala nem permissao.
//
// `podeReceber` existe para o bot de musica: ele so PUBLICA. Negar a assinatura no proprio
// token e mais forte do que pedir ao cliente dele para nao assinar -- um defeito futuro no
// bot nao consegue passar a baixar a camera e a voz da sala inteira.
function criarToken(sala, identidade, nome, { podeReceber = true } = {}) {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify({
    iss: apiKey,
    sub: identidade,
    name: nome,
    nbf: agora,
    exp: agora + VALIDADE_DO_TOKEN,
    video: { room: sala, roomJoin: true, canPublish: true, canSubscribe: podeReceber, canPublishData: podeReceber }
  }));
  const assinatura = crypto.createHmac('sha256', apiSecret).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

// O cliente do LiveKit acrescenta "/rtc" ao endereco que recebe. Encaminhando esse caminho
// para o processo local, a sinalizacao viaja pelo MESMO HTTPS que serve a pagina: nada de
// porta extra, certificado ou dominio proprio para o WebSocket.
function instalarProxy(app, server) {
  app.use('/rtc', (req, res) => {
    if (validarAcesso && !validarAcesso(req)) return res.status(403).end();
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
    if (validarAcesso && !validarAcesso(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }

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

function tokenDeServidor(video) {
  const { apiKey, apiSecret } = lerOuCriarChaves();
  const cabecalho = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const agora = Math.floor(Date.now() / 1000);
  const corpo = base64url(JSON.stringify({ iss: apiKey, nbf: agora - 5, exp: agora + 60, video }));
  return `${cabecalho}.${corpo}.${crypto.createHmac('sha256', apiSecret).update(`${cabecalho}.${corpo}`).digest('base64url')}`;
}
// Lista fechada: cada método aqui é um poder do servidor sobre a sala. `MutePublishedTrack`
// entrou com os planos -- é ele que desliga a TELA de quem transmite acima do teto do plano,
// sem tirar a pessoa, a voz nem a câmera.
async function consultar(metodo, corpo) {
  // UpdateParticipant é só para o nome: quem tem conta troca o apelido de dentro da sala, e
  // quem chegar depois tem de ver o nome novo -- o antigo estava gravado no token da entrada.
  if (!['ListRooms', 'ListParticipants', 'RemoveParticipant', 'MutePublishedTrack', 'UpdateParticipant'].includes(metodo)) throw new Error('Método não permitido.');
  const video = metodo === 'ListRooms' ? { roomList: true } : { roomAdmin: true, room: corpo.room };
  return JSON.parse(await telemetriaLivekit.pedir({ porta: PORTA_LOCAL, caminho: `/twirp/livekit.RoomService/${metodo}`, corpo: JSON.stringify(corpo), autorizacao: `Bearer ${tokenDeServidor(video)}` }));
}
function metricas() {
  const { apiSecret } = lerOuCriarChaves();
  const senha = crypto.createHmac('sha256', apiSecret).update('metricas').digest('hex');
  return telemetriaLivekit.pedir({ porta: PORTA_METRICAS, caminho: '/metrics', autorizacao: `Basic ${Buffer.from(`nexo-metricas:${senha}`).toString('base64')}` });
}
function identidadeDoToken(token) {
  try {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const [cabecalho, corpo, assinatura] = token.split('.');
    const { apiKey, apiSecret } = lerOuCriarChaves();
    const esperado = crypto.createHmac('sha256', apiSecret).update(`${cabecalho}.${corpo}`).digest();
    const recebido = Buffer.from(assinatura, 'base64url');
    if (JSON.parse(Buffer.from(cabecalho, 'base64url')).alg !== 'HS256' || recebido.length !== esperado.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
    const claims = JSON.parse(Buffer.from(corpo, 'base64url'));
    if (claims.iss !== apiKey || !Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now() || !claims.video?.roomJoin) return null;
    return { sala: claims.video.room, identidade: claims.sub };
  } catch (_) { return null; }
}
module.exports = { iniciarSfu, encerrarSfu, criarToken, instalarProxy, estado, PORTA_LOCAL, consultar, metricas, identidadeDoToken, LINHA_DE_PROBLEMA,
  configurarAcesso: fn => { validarAcesso = fn; },
  validarWebhook: (corpo, autorizacao) => telemetriaLivekit.validarWebhook(corpo, autorizacao, lerOuCriarChaves()),
  diagnostico: () => ({ ...estado, pid: processo?.pid || null, uptime: processo ? Math.max(0, (Date.now() - horaDoUltimoInicio) / 1000) : 0, reinicios: reiniciosTotais, tentativasSeguidas }) };
