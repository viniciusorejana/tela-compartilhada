const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { execFile, spawn } = require('child_process');

const HELPER_PATH = path.join(__dirname, 'native', 'audio-helper', 'x64', 'Release', 'ApplicationLoopback.exe');
const AGENTE_PATH = path.join(__dirname, 'native', 'audio-agent', 'x64', 'Release', 'AgenteAudio.exe');

// Trecho do nome do arquivo que carrega a URL da sala (em base64url). O agente le o
// proprio nome ao iniciar -- por isso o participante so precisa dar um duplo clique.
const MARCADOR_NOME_CONFIG = '.cfg-';

// Familias de navegador aceitas na captura por processo. Whitelist fechada: o valor vira
// argumento de um processo nativo, entao nada que venha do cliente passa direto.
const FAMILIAS_DE_NAVEGADOR = {
  chrome: 'chrome.exe',
  msedge: 'msedge.exe',
  firefox: 'firefox.exe',
  opera: 'opera.exe',
  brave: 'brave.exe',
  vivaldi: 'vivaldi.exe'
};

const app = express();
require('./desktop-download')(app, path.join(__dirname, 'app', 'dist', 'SalaCompartilhada.exe'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || true }
});

app.get('/vendor/rnnoise-sync.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/@jitsi/rnnoise-wasm/dist/rnnoise-sync.js')));
app.get('/vendor/rnnoise-LICENSE', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/@jitsi/rnnoise-wasm/LICENSE')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/sala', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sala.html'));
});

app.get('/:roomCode/sala', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sala.html'));
});

// Links antigos continuam funcionando, apontando para a sala unificada.
app.get(['/compartilhar', '/ao-vivo'], (req, res) => res.redirect('/sala'));
app.get(['/:roomCode/compartilhar', '/:roomCode/ao-vivo'], (req, res) => {
  res.redirect(`/${req.params.roomCode}/sala`);
});

// Um unico STUN e um ponto unico de falha: se ele estiver bloqueado ou o DNS falhar, nenhum
// candidato srflx e coletado e so a MESMA rede local consegue conversar -- exatamente o
// sintoma de "funciona aqui em casa, nao funciona para quem esta fora".
const STUN_PADRAO = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
];

function listaDoAmbiente(nome) {
  return (process.env[nome] || '').split(',').map(valor => valor.trim()).filter(Boolean);
}

// Padrao TURN REST API (o mesmo que o coturn implementa com "use-auth-secret"): o usuario
// carrega o instante de expiracao e a credencial e o HMAC disso com o segredo. Assim o
// /api/rtc-config -- que e publico, porque a sala nao tem login -- nunca entrega uma senha
// permanente do TURN a quem so abriu a URL.
function credencialTemporariaDeTurn(segredo, segundos) {
  const expiraEm = Math.floor(Date.now() / 1000) + segundos;
  const username = `${expiraEm}:${crypto.randomBytes(6).toString('hex')}`;
  return {
    username,
    credential: crypto.createHmac('sha1', segredo).update(username).digest('base64')
  };
}

// TURN e necessario quando os navegadores nao conseguem abrir uma conexao direta.
app.get('/api/rtc-config', (req, res) => {
  const stunUrls = listaDoAmbiente('STUN_URLS');
  const iceServers = (stunUrls.length ? stunUrls : STUN_PADRAO).map(urls => ({ urls }));
  const turnUrls = listaDoAmbiente('TURN_URLS');

  if (turnUrls.length && process.env.TURN_STATIC_AUTH_SECRET) {
    // O prazo curto vale pela duracao da alocacao: quem ja esta na sala continua com a
    // conexao aberta, e quem entrar depois pede uma credencial nova ao recarregar a pagina.
    const ttl = Number(process.env.TURN_TTL) > 0 ? Number(process.env.TURN_TTL) : 2 * 60 * 60;
    iceServers.push({ urls: turnUrls, ...credencialTemporariaDeTurn(process.env.TURN_STATIC_AUTH_SECRET, ttl) });
    // Uma credencial temporaria nao pode ser guardada em cache por proxy nenhum.
    res.set('Cache-Control', 'no-store');
  } else if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    // Caminho antigo, mantido para nao quebrar quem ja configurou credencial fixa.
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  let publicUrl = null;
  try {
    const configured = new URL(process.env.PUBLIC_URL);
    if (['https:', 'http:'].includes(configured.protocol)) publicUrl = configured.origin;
  } catch (_) { /* Without configuration, invite links use the browser's origin. */ }
  res.json({ iceServers, publicUrl });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const TOKEN_VALIDO = /^[a-f0-9]{16,64}$/i;

// A configuracao do agente viaja no NOME do arquivo, nunca dentro dele. Modificar bytes de
// um executavel ja compilado faz o Windows Defender barrar o download como
// Trojan:Win32/Wacatac!ml. Entregando o arquivo sem tocar em nada, todo mundo recebe
// exatamente o mesmo binario -- o que ajuda, mas nao basta: por ser pequeno, sem assinatura
// e capturar audio, o binario ja foi marcado assim mesmo intacto. Ver o aviso de antivirus
// no README (metadados de versao, ganho de reputacao e envio de falso positivo).
app.get('/api/agente', (req, res) => {
  const token = String(req.query.token || '');
  if (!TOKEN_VALIDO.test(token)) return res.status(400).send('Token invalido.');
  if (!fs.existsSync(AGENTE_PATH)) {
    return res.status(503).send('O agente ainda nao foi compilado neste servidor. Rode "npm start".');
  }

  // Atras de um tunel o protocolo real vem no cabecalho; sem ele, e a conexao direta.
  const hospedeiro = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  if (!/^[a-z0-9.\-]+(:\d+)?$/i.test(hospedeiro)) return res.status(400).send('Endereco invalido.');

  // ':' nao e valido em nome de arquivo no Windows, entao a porta viaja como '_'.
  const hostNoNome = hospedeiro.replace(':', '_');
  const nome = `AgenteAudio${MARCADOR_NOME_CONFIG}${token}-${hostNoNome}.exe`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  fs.createReadStream(AGENTE_PATH).pipe(res);
  console.log(`Agente baixado para ${hospedeiro} (arquivo: ${nome})`);
});

// roomCode -> Map<socketId, { name, state }>
const roomMembers = new Map();

// Chat da sala. Fica na conexao de sinalizacao, que ja existe e passa o tempo todo ociosa:
// video e voz vao ponto a ponto e nao encostam nisso. O historico serve para quem entra
// depois nao achar a sala muda, e vive so na memoria -- some quando a sala esvazia.
const HISTORICO_MAXIMO = 80;
const BYTES_MAXIMOS_DO_HISTORICO = 6 * 1024 * 1024;
const TAMANHO_MAXIMO_DO_TEXTO = 2000;
const TAMANHO_MAXIMO_DA_IMAGEM = 820 * 1024;
const IMAGEM_VALIDA = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const historicoPorSala = new Map();

const tamanhoDaMensagem = (m) => (m.texto ? m.texto.length : 0) + (m.imagem ? m.imagem.length : 0);

function guardarNoHistorico(roomCode, msg) {
  const lista = historicoPorSala.get(roomCode) || [];
  lista.push(msg);
  while (lista.length > HISTORICO_MAXIMO) lista.shift();
  // Imagens sao pesadas: alem do limite de mensagens ha um teto de bytes, senao algumas
  // capturas de tela coladas no chat prenderiam dezenas de MB por sala.
  let bytes = lista.reduce((soma, m) => soma + tamanhoDaMensagem(m), 0);
  while (bytes > BYTES_MAXIMOS_DO_HISTORICO && lista.length > 1) bytes -= tamanhoDaMensagem(lista.shift());
  historicoPorSala.set(roomCode, lista);
}
const socketRoomCodes = new Map();
const audioCaptureProcesses = new Map();

// Pareamento agente <-> navegador. E deliberadamente sem estado persistente: o token e
// gerado pelo navegador, guardado no localStorage dele e gravado dentro do executavel.
// Os dois lados se encontram por apresentarem o mesmo token, entao reiniciar o servidor
// nao invalida os agentes ja baixados.
const agentesPorToken = new Map();     // token -> WebSocket
const navegadoresPorToken = new Map(); // token -> socketId
// Porta que o agente abriu em 127.0.0.1 do computador DELE. O navegador daquela pessoa usa
// essa porta para receber o audio direto, sem a volta ate aqui.
const portasLocaisPorToken = new Map(); // token -> porta

function avisarStatusDoAgente(token) {
  const socketId = navegadoresPorToken.get(token);
  if (!socketId) return;
  io.to(socketId).emit('agente-status', { conectado: agentesPorToken.has(token), portaLocal: portasLocaisPorToken.get(token) || null });
}

// Os agentes falam WebSocket puro (bem mais simples de implementar em C++ que o
// protocolo do Socket.IO). Roteamos o upgrade manualmente para nao brigar com o Socket.IO.
const wssAgentes = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let caminho = '';
  try { caminho = new URL(req.url, 'http://local').pathname; } catch (_) { return; }
  if (caminho !== '/agente') return; // deixa o Socket.IO cuidar do resto

  const token = new URL(req.url, 'http://local').searchParams.get('token') || '';
  if (!TOKEN_VALIDO.test(token)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  wssAgentes.handleUpgrade(req, socket, head, (ws) => {
    ws.tokenDoAgente = token;
    wssAgentes.emit('connection', ws, req);
  });
});

wssAgentes.on('connection', (ws) => {
  const token = ws.tokenDoAgente;
  const anterior = agentesPorToken.get(token);
  if (anterior && anterior !== ws) anterior.terminate();
  agentesPorToken.set(token, ws);
  console.log(`Agente conectado (token ${token.slice(0, 8)}...)`);
  avisarStatusDoAgente(token);

  ws.on('message', (dados, ehBinario) => {
    if (ehBinario) {
      // PCM do computador do participante -> navegador dele, no mesmo formato que o
      // caminho local ja usa (44100 Hz, estereo, 16 bits). So faz sentido com um
      // navegador do outro lado; sem ele o audio nao tem destino.
      const socketId = navegadoresPorToken.get(token);
      if (socketId) io.to(socketId).emit('audio-data', dados);
      return;
    }
    // As mensagens de controle NAO podem depender de haver navegador registrado: o
    // agente e aberto antes de a pessoa entrar na sala, e e logo ao conectar que ele
    // informa a porta local. Exigir o navegador aqui fazia esse anuncio se perder, e a
    // conexao direta nunca era usada.
    try {
      const mensagem = JSON.parse(dados.toString());
      // Lista de aplicativos com audio, para a pessoa escolher qual nao transmitir.
      if (mensagem.evento === 'aplicativos' && Array.isArray(mensagem.lista)) {
        const destino = navegadoresPorToken.get(token);
        if (destino) io.to(destino).emit('agente-aplicativos', {
          lista: mensagem.lista.slice(0, 40),
          atual: String(mensagem.atual || '').slice(0, 120),
          modo: ['incluir', 'excluir', 'excluir-pid', 'incluir-pid'].includes(mensagem.modo) ? mensagem.modo : undefined
        });
      }
      if (mensagem.evento === 'porta-local' && Number.isInteger(mensagem.porta) && mensagem.porta > 0 && mensagem.porta < 65536) {
        portasLocaisPorToken.set(token, mensagem.porta);
        avisarStatusDoAgente(token);
      }
      if (mensagem.evento === 'erro') {
        const socketId = navegadoresPorToken.get(token);
        if (socketId) io.to(socketId).emit('audio-error', `Agente: ${mensagem.mensagem || 'falha'}`);
      }
    } catch (_) { /* mensagem de controle malformada e ignorada */ }
  });

  ws.on('close', () => {
    if (agentesPorToken.get(token) === ws) {
      agentesPorToken.delete(token);
      portasLocaisPorToken.delete(token);
      console.log(`Agente desconectado (token ${token.slice(0, 8)}...)`);
      avisarStatusDoAgente(token);
    }
  });
  ws.on('error', () => ws.terminate());
});

// Nome de executavel aceitavel. Fechado de proposito: esse valor vira argumento de um
// processo nativo, entao nada de caminho, aspas ou espaco esquisito.
const EXECUTAVEL_VALIDO = /^[A-Za-z0-9._+-]{1,60}\.exe$/;

// A escolha de audio de uma pessoa. Tres modos, e so estes:
//   excluir      todo o som, menos um programa (vazio = o navegador dela)
//   incluir      SOMENTE o som de um programa
//   excluir-pid  todo o som, menos a arvore de um PID -- o modo do aplicativo proprio
const MODOS_DE_AUDIO = ['excluir', 'incluir', 'excluir-pid', 'incluir-pid'];

function escolhaLimpa(bruta) {
  const dados = bruta && typeof bruta === 'object' ? bruta : {};
  const modo = MODOS_DE_AUDIO.includes(dados.modo) ? dados.modo : 'excluir';
  const executavel = String(dados.executavel || '').slice(0, 120);
  const pid = Number(dados.pid);
  if (executavel && !EXECUTAVEL_VALIDO.test(executavel)) return null;
  // PID vem de um processo que existe de verdade: inteiro positivo e dentro da faixa.
  if (['excluir-pid', 'incluir-pid'].includes(modo) && (!Number.isInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF)) return null;
  if (modo === 'incluir' && !executavel) return null;
  return { modo, executavel, pid: ['excluir-pid', 'incluir-pid'].includes(modo) ? pid : 0 };
}

// Pergunta ao helper quais programas tem audio nesta maquina. E o mesmo codigo que o
// agente usa; a diferenca e so quem executa.
function listarAplicativosLocais(familia) {
  const navegador = FAMILIAS_DE_NAVEGADOR[familia] || '';
  return new Promise((resolve) => {
    execFile(HELPER_PATH, ['--listar', navegador].filter(Boolean),
      { windowsHide: true, maxBuffer: 512 * 1024 }, (erro, stdout) => {
        if (erro) return resolve(null);
        try { resolve(JSON.parse(stdout || 'null')); } catch (_) { resolve(null); }
      });
  });
}

// O agente usa a familia para saber qual e o navegador desta pessoa: e ele que fica na
// lista como escolha automatica, mesmo quando nao esta tocando nada.
function familiaLimpa(valor) {
  const f = String(valor || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(FAMILIAS_DE_NAVEGADOR, f) ? f : '';
}

function comandarAgente(token, comando) {
  const ws = agentesPorToken.get(token);
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(comando));
  return true;
}

const estadoPadrao = () => ({ camera: false, screen: false, screenAudio: false, micMuted: true });

function roomCodeForSocket(socket) {
  return socketRoomCodes.get(socket.id) || null;
}

function roomName(roomCode) {
  return `room:${roomCode}`;
}

function membrosDaSala(roomCode) {
  if (!roomMembers.has(roomCode)) roomMembers.set(roomCode, new Map());
  return roomMembers.get(roomCode);
}

// O helper nativo roda na maquina do servidor. So faz sentido oferece-lo a quem esta
// nessa mesma maquina (o host); para os demais participantes ele capturaria o audio
// errado -- o do host, e nao o deles.
function enderecoEhDestaMaquina(address) {
  if (!address) return false;
  const limpo = String(address).replace(/^::ffff:/, '');
  if (limpo === '127.0.0.1' || limpo === '::1' || limpo === 'localhost') return true;
  return Object.values(os.networkInterfaces())
    .flat()
    .some(iface => iface && iface.address === limpo);
}

// Atras de um proxy/tunel (Cloudflare Tunnel, nginx...) TODAS as conexoes chegam como
// 127.0.0.1, entao o endereco sozinho nao prova nada: sem esta checagem, qualquer
// participante remoto seria tratado como host e acabaria capturando o audio do host.
const CABECALHOS_DE_PROXY = [
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto',
  'forwarded', 'cf-connecting-ip', 'cf-ray', 'via', 'tailscale-funnel-request'
];

// O Host precisa apontar para um endereco desta maquina E para a porta real do servidor.
// Um proxy escuta em outra porta (ou usa um dominio publico), entao nao passa por aqui.
function hostDaRequisicaoEhLocal(headers) {
  const host = String(headers.host || '');
  const comPorta = host.match(/^\[([^\]]+)\]:(\d+)$/) || host.match(/^([^:]+):(\d+)$/);
  if (!comPorta) return false;
  const porta = Number(comPorta[2]);
  if (porta !== Number(PORT)) return false;
  return enderecoEhDestaMaquina(comPorta[1]);
}

function helperCompilado() {
  return fs.existsSync(HELPER_PATH);
}

// Decide, com varias camadas e sempre falhando para o lado seguro, se este participante
// pode usar a captura nativa (ou seja, se ele esta mesmo no computador do servidor).
function diagnosticarHelper(handshake) {
  const headers = (handshake && handshake.headers) || {};
  if (CABECALHOS_DE_PROXY.some(nome => headers[nome])) {
    return { podeUsarHelper: false, motivo: 'atras-de-proxy' };
  }
  if (!enderecoEhDestaMaquina(handshake && handshake.address) || !hostDaRequisicaoEhLocal(headers)) {
    return { podeUsarHelper: false, motivo: 'remoto' };
  }
  if (!helperCompilado()) {
    return { podeUsarHelper: false, motivo: 'helper-ausente' };
  }
  return { podeUsarHelper: true, motivo: null };
}

function pararCapturaAudio(socketId) {
  const captures = audioCaptureProcesses.get(socketId) || [];
  captures.forEach(capture => capture.kill());
  audioCaptureProcesses.delete(socketId);
}

function misturarAudio(socket, captures) {
  const frameBytes = 441 * 2 * 2;
  const buffers = captures.map(() => Buffer.alloc(0));

  captures.forEach((capture, index) => {
    capture.stdout.on('data', chunk => {
      buffers[index] = Buffer.concat([buffers[index], chunk]);
      while (buffers.every(buffer => buffer.length >= frameBytes)) {
        const mixed = Buffer.alloc(frameBytes);
        for (let offset = 0; offset < frameBytes; offset += 2) {
          let sample = 0;
          buffers.forEach(buffer => { sample += buffer.readInt16LE(offset); });
          sample = Math.max(-32768, Math.min(32767, sample));
          mixed.writeInt16LE(sample, offset);
        }
        buffers.forEach((buffer, bufferIndex) => {
          buffers[bufferIndex] = buffer.subarray(frameBytes);
        });
        socket.emit('audio-data', mixed);
      }
    });
  });
}

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  function sairDaSalaAtual() {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    socket.leave(roomName(roomCode));
    const membros = roomMembers.get(roomCode);
    if (membros) {
      membros.delete(socket.id);
      // Sala vazia: o historico do chat some junto, nada fica guardado em disco.
      if (!membros.size) { roomMembers.delete(roomCode); historicoPorSala.delete(roomCode); }
    }
    socket.to(roomName(roomCode)).emit('peer-left', { id: socket.id });
    pararCapturaAudio(socket.id);
    socketRoomCodes.delete(socket.id);
  }

  socket.on('leave-room', callback => {
    sairDaSalaAtual();
    const token = socket.data.tokenAgente;
    if (token && navegadoresPorToken.get(token) === socket.id) comandarAgente(token, { acao: 'parar' });
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('join-room', (requestedCode, displayName, callback) => {
    const roomCode = String(requestedCode || 'principal').toLowerCase();
    if (!/^[a-z0-9_-]{4,32}$/.test(roomCode)) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Codigo de sala invalido.' });
      return;
    }
    const name = String(displayName || 'Convidado').trim().slice(0, 40) || 'Convidado';

    sairDaSalaAtual();

    socket.join(roomName(roomCode));
    socketRoomCodes.set(socket.id, roomCode);
    const membros = membrosDaSala(roomCode);
    const peers = Array.from(membros.entries()).map(([id, info]) => ({ id, name: info.name, state: info.state }));
    membros.set(socket.id, { name, state: estadoPadrao() });

    if (typeof callback === 'function') {
      // Quem entra depois recebe o que ja foi conversado, para a sala nao parecer muda.
      callback({ ok: true, roomCode, selfId: socket.id, peers, historico: historicoPorSala.get(roomCode) || [] });
    }
    socket.to(roomName(roomCode)).emit('peer-joined', { id: socket.id, name, state: estadoPadrao() });
    console.log(`${socket.id} (${name}) entrou na sala ${roomCode}`);
  });

  socket.on('media-state', (state) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    const membros = roomMembers.get(roomCode);
    const membro = membros && membros.get(socket.id);
    if (!membro) return;
    membro.state = {
      camera: Boolean(state?.camera),
      screen: Boolean(state?.screen),
      screenAudio: Boolean(state?.screenAudio),
      micMuted: Boolean(state?.micMuted)
    };
    socket.to(roomName(roomCode)).emit('media-state', { id: socket.id, ...membro.state });
  });

  // O cliente pergunta se ESTE participante pode usar a captura nativa por processo.
  socket.on('audio-capabilities', (callback) => {
    if (typeof callback !== 'function') return;
    const token = socket.data.tokenAgente;
    callback({
      ...diagnosticarHelper(socket.handshake),
      urlLocal: `http://localhost:${PORT}`,
      agenteDisponivel: fs.existsSync(AGENTE_PATH),
      agenteConectado: Boolean(token && agentesPorToken.has(token)),
      portaLocalDoAgente: (token && portasLocaisPorToken.get(token)) || null
    });
  });

  // O navegador diz qual e o token do agente dele (gerado por ele e guardado no
  // localStorage). E o que permite o servidor casar o agente com a aba certa.
  socket.on('registrar-agente', (token, callback) => {
    const limpo = String(token || '');
    if (!TOKEN_VALIDO.test(limpo)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }
    const anterior = socket.data.tokenAgente;
    if (anterior && anterior !== limpo && navegadoresPorToken.get(anterior) === socket.id) {
      navegadoresPorToken.delete(anterior);
    }
    socket.data.tokenAgente = limpo;
    navegadoresPorToken.set(limpo, socket.id);
    if (typeof callback === 'function') callback({ ok: true, conectado: agentesPorToken.has(limpo) });
  });

  // Captura todo o audio do sistema MENOS a arvore de processos do navegador de quem
  // pediu -- ou seja, sem o audio desta propria chamada, sem eco.
  //
  // Duas origens possiveis: o agente instalado no PC do proprio participante (vale para
  // qualquer pessoa) ou o helper que roda aqui no servidor (so para quem esta nesta
  // maquina). Nunca capturamos o audio local em nome de outra pessoa.
  socket.on('audio-start', async (request) => {
    if (!roomCodeForSocket(socket)) return;
    const familiaPedida = String(request?.familia || '').toLowerCase();

    if (request?.origem === 'agente') {
      const token = socket.data.tokenAgente;
      if (!token || !agentesPorToken.has(token)) {
        socket.emit('audio-error', 'O agente de audio nao esta conectado neste computador.');
        return;
      }
      comandarAgente(token, { acao: 'iniciar', familia: familiaPedida });
      console.log(`Agente do token ${token.slice(0, 8)}... iniciou a captura (${familiaPedida}).`);
      return;
    }

    const diagnostico = diagnosticarHelper(socket.handshake);
    if (!diagnostico.podeUsarHelper) {
      // Nunca capturar o audio desta maquina em nome de outra pessoa: ela receberia o
      // som do computador do host em vez do proprio.
      socket.emit('audio-error', diagnostico.motivo === 'helper-ausente'
        ? 'Helper de audio nao encontrado. Compile o projeto nativo.'
        : 'A captura nativa so funciona para quem abre a sala direto no computador que executa o servidor. Seu audio sera capturado pelo navegador.');
      return;
    }

    await iniciarCapturaLocal(socket, familiaPedida);
  });

  // Sobe (ou refaz) a captura local com a escolha da pessoa. Quem descobre a raiz da arvore
  // e o proprio helper, pelo nome do executavel ou pelo PID -- some a volta pelo PowerShell.
  async function iniciarCapturaLocal(socket, familia) {
    const escolha = socket.data.escolhaDeAudio || { modo: 'excluir', executavel: '', pid: 0 };
    let argumentos;
    let alvo;

    if (['excluir-pid', 'incluir-pid'].includes(escolha.modo)) {
      argumentos = ['--' + escolha.modo, String(escolha.pid)];
      alvo = `pid ${escolha.pid}`;
    } else {
      // No modo "incluir" nao existe padrao: incluir o navegador por engano mandaria para a
      // sala exatamente o que a sala acabou de tocar.
      const executavel = escolha.executavel || (escolha.modo === 'incluir' ? '' : FAMILIAS_DE_NAVEGADOR[familia]);
      if (!executavel) {
        socket.emit('audio-error', 'Nao foi possivel identificar o programa do audio.');
        return;
      }
      argumentos = [escolha.modo === 'incluir' ? '--incluir' : '--excluir', executavel];
      alvo = executavel;
    }

    pararCapturaAudio(socket.id);
    const capture = spawn(HELPER_PATH, argumentos, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const captures = [capture];
    audioCaptureProcesses.set(socket.id, captures);
    misturarAudio(socket, captures);
    console.log(`Audio do sistema para ${socket.id}: ${argumentos[0]} ${alvo}.`);

    capture.stderr.on('data', (chunk) => console.error(`Audio helper: ${chunk}`));
    capture.on('close', (codigo) => {
      if (audioCaptureProcesses.get(socket.id)?.includes(capture)) {
        audioCaptureProcesses.set(socket.id, audioCaptureProcesses.get(socket.id).filter(item => item !== capture));
      }
      if (codigo === 2) socket.emit('audio-error', `O programa ${alvo} nao esta aberto.`);
    });
    capture.on('error', (error) => {
      console.error(`Nao foi possivel iniciar o audio helper: ${error.message}`);
      socket.emit('audio-error', 'Helper de audio nao encontrado. Compile o projeto nativo.');
    });
  }

  socket.on('chat-message', (dados) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return;

    const texto = String(dados?.texto || '').slice(0, TAMANHO_MAXIMO_DO_TEXTO).trim();
    const bruta = typeof dados?.imagem === 'string' ? dados.imagem : '';
    // Aceita apenas data URL de imagem, dentro do limite: o navegador de quem recebe vai
    // colocar isso num <img>, entao nao pode entrar qualquer coisa aqui.
    const imagem = (bruta.length <= TAMANHO_MAXIMO_DA_IMAGEM && IMAGEM_VALIDA.test(bruta)) ? bruta : null;
    if (!texto && !imagem) return;

    const mensagem = { autor: membro.name, autorId: socket.id, texto, imagem, em: Date.now() };
    guardarNoHistorico(roomCode, mensagem);
    io.to(roomName(roomCode)).emit('chat-mensagem', mensagem);
  });

  // A escolha de qual programa fica fora da captura. Vale na hora: se o agente ja estiver
  // capturando, ele mesmo refaz a captura com o novo alvo, sem interromper a tela.
  socket.on('agente-aplicativos', async (familia) => {
    const limpa = familiaLimpa(familia);
    const token = socket.data.tokenAgente;
    if (token && agentesPorToken.has(token)) {
      comandarAgente(token, { acao: 'listar-aplicativos', familia: limpa });
      return;
    }
    // Sem agente, mas com o helper disponivel e a pagina aberta na propria maquina do
    // servidor: a captura ja acontece aqui, entao a escolha tambem pode.
    const diagnostico = diagnosticarHelper(socket.handshake);
    if (!diagnostico.podeUsarHelper) return;
    const resposta = await listarAplicativosLocais(limpa);
    if (!resposta || !Array.isArray(resposta.lista)) return;
    socket.emit('agente-aplicativos', {
      lista: resposta.lista.slice(0, 40),
      atual: socket.data.escolhaDeAudio?.executavel || String(resposta.atual || ''),
      modo: socket.data.escolhaDeAudio?.modo || 'excluir'
    });
  });

  // Uma escolha so, para os dois caminhos de captura: o agente no PC da pessoa e o helper
  // aqui no servidor. Antes eram dois eventos com nome de "excluir", que deixou de descrever
  // o que acontece desde que existe o modo "somente este programa".
  socket.on('audio-escolha', async (bruta) => {
    const escolha = escolhaLimpa(bruta);
    if (!escolha) return;
    const familia = familiaLimpa(bruta && bruta.familia);

    const token = socket.data.tokenAgente;
    if (token && agentesPorToken.has(token)) {
      // "escolha" e uma acao nova. Um agente antigo simplesmente a ignora -- e nao faz nada,
      // que e o unico desfecho seguro: entender "somente este programa" como "todos menos
      // este" seria fazer o oposto do pedido, e devolver eco para a sala inteira.
      comandarAgente(token, {
        acao: 'escolha',
        modo: escolha.modo,
        executavel: escolha.executavel,
        // Texto de proposito: o leitor de JSON do agente so le valor entre aspas.
        pid: String(escolha.pid || ''),
        familia
      });
      return;
    }

    socket.data.escolhaDeAudio = escolha;
    if (audioCaptureProcesses.has(socket.id)) await iniciarCapturaLocal(socket, familia);
  });

  socket.on('audio-stop', () => {
    pararCapturaAudio(socket.id);
    if (socket.data.tokenAgente) comandarAgente(socket.data.tokenAgente, { acao: 'parar' });
  });

  // Repasse de mensagens WebRTC (offer/answer/candidate) entre pares da mesma sala
  socket.on('offer', (targetId, description, mediaInfo) => {
    if (socketRoomCodes.get(targetId) === roomCodeForSocket(socket)) {
      socket.to(targetId).emit('offer', socket.id, description, mediaInfo || {});
    }
  });

  socket.on('answer', (targetId, description, mediaInfo) => {
    if (socketRoomCodes.get(targetId) === roomCodeForSocket(socket)) {
      socket.to(targetId).emit('answer', socket.id, description, mediaInfo || {});
    }
  });

  socket.on('candidate', (targetId, candidate) => {
    if (socketRoomCodes.get(targetId) === roomCodeForSocket(socket)) {
      socket.to(targetId).emit('candidate', socket.id, candidate);
    }
  });

  socket.on('disconnect', () => {
    sairDaSalaAtual();
    const token = socket.data.tokenAgente;
    if (token) {
      // Manda o agente parar de capturar: sem isso ele continuaria gravando o audio da
      // pessoa depois que ela fechou a aba.
      comandarAgente(token, { acao: 'parar' });
      if (navegadoresPorToken.get(token) === socket.id) navegadoresPorToken.delete(token);
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
server.listen(PORT, HOST, () => {
  console.log(`\nServidor rodando em ${publicUrl}`);
  console.log(`  -> Entrar na sala: ${publicUrl}/sala\n`);
});
