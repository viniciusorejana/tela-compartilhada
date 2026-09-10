const pathParts = window.location.pathname.split('/').filter(Boolean);
const roomCode = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : 'principal';
document.getElementById('roomTitle').textContent = roomCode;
document.title = `${roomCode} · Nexo`;

const nameGate = document.getElementById('nameGate');
const nameInput = document.getElementById('nameInput');
const nameConfirmBtn = document.getElementById('nameConfirmBtn');
const status = document.getElementById('status');
const participantCount = document.getElementById('participantCount');
const participantsEl = document.getElementById('participants');
const stage = document.getElementById('stage');
const stageVideo = document.getElementById('stageVideo');
const stageEmpty = document.getElementById('stageEmpty');
const stageLabel = document.getElementById('stageLabel');
const stageControls = document.getElementById('stageControls');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomLevelLabel = document.getElementById('zoomLevelLabel');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const qualidadeBtn = document.getElementById('qualidadeBtn');
const devicesBtn = document.getElementById('devicesBtn');
const devicesPanel = document.getElementById('devicesPanel');
const devicesClose = document.getElementById('devicesClose');
const devicesDica = document.getElementById('devicesDica');
const micDevice = document.getElementById('micDevice');
const outDevice = document.getElementById('outDevice');
const camDevice = document.getElementById('camDevice');
const saidaCampo = document.getElementById('saidaCampo');
const echoWarning = document.getElementById('echoWarning');
const fixEchoBtn = document.getElementById('fixEchoBtn');
const micBtn = document.getElementById('micBtn');
const cameraBtn = document.getElementById('cameraBtn');
const flipCameraBtn = document.getElementById('flipCameraBtn');
const screenBtn = document.getElementById('screenBtn');
const updateScreenBtn = document.getElementById('updateScreenBtn');
const testAudioBtn = document.getElementById('testAudioBtn');
const leaveBtn = document.getElementById('leaveBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const enableSoundBtn = document.getElementById('enableSoundBtn');
const noiseBtn = document.getElementById('noiseBtn');
const avisoDeEco = document.getElementById('avisoDeEco');
const modoDeAudioSelect = document.getElementById('modoDeAudio');
const excluirAppRotulo = document.getElementById('excluirAppRotulo');
const excluirAppCampo = document.getElementById('excluirAppCampo');
const excluirApp = document.getElementById('excluirApp');
const excluirAppDica = document.getElementById('excluirAppDica');
const settingsPanel = document.getElementById('settingsPanel');
const settingsTitle = document.getElementById('settingsTitle');
const captureMode = document.getElementById('captureMode');
const audioPolicy = document.getElementById('audioPolicy');
const echoHint = document.getElementById('echoHint');
const echoWarningText = document.getElementById('echoWarningText');
const agenteBox = document.getElementById('agenteBox');
const agenteBolinha = document.getElementById('agenteBolinha');
const agenteTitulo = document.getElementById('agenteTitulo');
const agenteTexto = document.getElementById('agenteTexto');
const agenteDownload = document.getElementById('agenteDownload');
const confirmScreenBtn = document.getElementById('confirmScreenBtn');
const cancelScreenBtn = document.getElementById('cancelScreenBtn');

// ---------- O que este navegador suporta ----------
// Safari usa webkitAudioContext; celulares em geral nao tem getDisplayMedia; e nenhum
// navegador fora do Windows tem o agente. Detectar uma vez aqui evita erro espalhado.
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const temMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
// Sem WebRTC nao ha transporte de midia possivel. Alguns navegadores de nicho e algumas
// distribuicoes de teste nao o trazem: a sala ainda serve para o chat, mas insistir em
// conectar so faria a entrada travar esperando algo que nunca vai acontecer.
const suportaWebRTC = Boolean(window.RTCPeerConnection && window.RTCRtpSender);
const suportaCompartilharTela = Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
const ehWindows = /Windows/i.test(navigator.userAgent);
const suportaTelaCheia = Boolean(
  document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
);

let socket = null;
// Duas identidades diferentes, de proposito: "myId" e como o servidor de midia me conhece
// (e o que aparece no mapa de participantes); "meuSocketId" e a conexao de sinalizacao, que
// carimba o autor de cada mensagem do chat.
let myId = null;
let meuSocketId = null;
let myName = '';
let micStream = null;
let micTrack = null;
let cameraStream = null;
let screenStream = null;
// Entra-se na sala em silencio: o microfone e aberto (a permissao vale de uma vez so),
// mas a faixa vai desligada ate a pessoa apertar o botao.
let micMuted = true;
let appAudioContext = null;
let appAudioNode = null;
let appAudioTrack = null;
let audioCaptureVersion = 0;
let testAudioContext = null;
let pendingPcm = new Uint8Array(0);
let settingsMode = 'start'; // 'start' | 'update'
let audioCapabilities = { podeUsarHelper: false, motivo: 'remoto', agenteDisponivel: false, agenteConectado: false };

// Token que liga ESTE navegador ao agente instalado neste computador. Fica no
// localStorage e vai gravado dentro do .exe no momento do download, para o participante
// nao precisar digitar nada.
const tokenDoAgente = (() => {
  let token;
  try { token = localStorage.getItem('tokenAgenteAudio'); } catch (_) { /* Private storage can be unavailable. */ }
  if (!/^[a-f0-9]{16,64}$/i.test(token || '')) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('tokenAgenteAudio', token); } catch (_) { /* Session-only pairing. */ }
  }
  return token;
})();
let pinned = null; // { id, source }
let needsUserGesture = false;
const midiasBloqueadas = new Set();
let publicInviteUrl = '';
let zoomLevel = 1;
let panX = 0, panY = 0;
let arrastandoPalco = null;

const peers = new Map(); // id -> peer object
const tiles = new Map(); // id -> dom refs

// A midia passa por um servidor de midia (SFU). O navegador pede aqui o endereco dele e um
// token que vale so para ESTA sala, com prazo. Nada disso e escolhido do lado do cliente.
let salaConfig = null;
let transporte = null;

// Logo depois de o servidor subir, o servidor de midia ainda esta descobrindo o proprio
// endereco. Quem abre a pagina nesse intervalo receberia um erro e ficaria sem midia ate
// recarregar; entao vale a pena esperar em vez de desistir na primeira resposta.
async function buscarConfigDaSala(nome) {
  let ultimoMotivo = 'sala-config';
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 8000);
    try {
      const resposta = await fetch(`/api/sala-config?sala=${encodeURIComponent(roomCode)}&nome=${encodeURIComponent(nome)}`, { signal: controle.signal });
      const dados = await resposta.json().catch(() => ({}));
      if (dados.publicUrl) publicInviteUrl = dados.publicUrl;
      if (resposta.ok) return dados;
      ultimoMotivo = dados.error || 'sala-config';
      if (dados.motivo !== 'iniciando') break;
      status.textContent = 'O servidor de mídia está iniciando...';
    } catch (_) {
      ultimoMotivo = 'sem-resposta';
    } finally { clearTimeout(prazo); }
    if (saindoDaSala) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(ultimoMotivo);
}

function corDoNome(nome) {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 62%)`;
}
function iniciais(nome) {
  return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';
}

// ---------- Entrada / nome ----------
const nomeSalvo = (() => { try { return localStorage.getItem('salaNome'); } catch (_) { return ''; } })();
if (nomeSalvo) {
  nameInput.value = nomeSalvo;
}
nameGate.classList.remove('hidden');

function entrar() {
  if (socket) return;
  const nome = nameInput.value.trim().slice(0, 40) || `Convidado-${Math.floor(Math.random() * 1000)}`;
  try { localStorage.setItem('salaNome', nome); } catch (_) { /* The room works without persistence. */ }
  myName = nome;
  nameGate.classList.add('hidden');
  iniciarConexao();
}
nameConfirmBtn.onclick = entrar;
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });

// ---------- Conexão / sala ----------
async function iniciarConexao() {
  status.textContent = 'Conectando ao servidor...';
  try {
    salaConfig = await buscarConfigDaSala(myName);
  } catch (erro) {
    status.textContent = erro.message === 'servidor-de-midia-indisponivel'
      ? 'O servidor de mídia não está no ar. O chat funciona, mas ninguém vai ver nem ouvir ninguém.'
      : 'Não foi possível preparar a entrada na sala. Recarregue a página.';
    if (erro.message !== 'servidor-de-midia-indisponivel') return;
  }
  if (saindoDaSala) return;
  myId = salaConfig?.identidade || `local-${Math.random().toString(36).slice(2)}`;

  if (salaConfig && !suportaWebRTC) {
    salaConfig = null;
    status.textContent = 'Este navegador não faz chamadas de vídeo. O chat funciona; para ver e ouvir a sala, use outro navegador.';
  }

  if (salaConfig) {
    transporte = RoomTransport.criarTransporte({
      peers,
      proximaOrdem: () => ++sequenciaDeCompartilhamento,
      aoEntrar: par => {
        criarTile(par.id, par.name, par.state);
        atualizarContador();
        avaliarDestaque();
      },
      aoSair: id => {
        removerPar(id);
        atualizarContador();
        avaliarDestaque();
      },
      aoMudarMidia: id => { ligarMidiaDoTile(id); avaliarDestaque(); },
      // A ordem em que a tela de alguém entrou só é conhecida aqui -- o quadradinho dela
      // já foi criado quando a faixa chegou, antes de o estado ser recalculado.
      aoMudarEstado: par => { atualizarTile(par.id); reordenarQuadradinhos(); avaliarDestaque(); avaliarRiscoDeEco(); }
    });
    try {
      await transporte.conectar(salaConfig.url, salaConfig.token);
    } catch (erro) {
      status.textContent = 'Não foi possível conectar ao servidor de mídia: ' + erro.message;
    }
    if (saindoDaSala) { await transporte.desconectar(); return; }
  }

  socket = io({ autoConnect: false });

  socket.on('connect', async () => {
    // O Socket.IO cuida do chat, do agente de audio e do historico. A midia vive na conexao
    // com o servidor de midia, que se reconecta por conta propria -- entao uma oscilacao
    // aqui nao derruba mais video nem voz, e nao ha malha para refazer.
    const voltando = sessaoIniciada;
    meuSocketId = socket.id;
    if (voltando) status.textContent = 'Reconectado ao servidor.';
    sessaoIniciada = true;
    // O microfone NAO e aberto ao entrar. Num celular, abrir o microfone aqui tira o audio
    // de quem esta falando em outro aplicativo -- a pessoa entra para assistir e fica muda
    // no Discord sem entender por que. Como se entra mudo de qualquer forma, o microfone so
    // e pedido no clique do botao, que e tambem quando a permissao faz sentido para quem ve.

    socket.emit('join-room', roomCode, myName, myId, (response) => {
      if (!response?.ok) {
        status.textContent = response?.error || 'Não foi possível entrar na sala.';
        return;
      }
      criarTileLocal();
      try {
        const recent = JSON.parse(localStorage.getItem('nexoRecentRooms') || '[]');
        localStorage.setItem('nexoRecentRooms', JSON.stringify([roomCode, ...(Array.isArray(recent) ? recent.filter(code => code !== roomCode) : [])].slice(0, 4)));
      } catch (_) { /* Recent rooms are optional. */ }
      // Numa reconexao o microfone ja pode estar aberto; numa entrada normal, nao existe
      // microfone nenhum ainda e nao ha o que acompanhar.
      if (micStream) { acompanharVoz('self', micStream); montarFiltroDeRuido(); }
      if (Array.isArray(response.historico) && response.historico.length) {
        chatMsgs.innerHTML = '';
        response.historico.forEach(mostrarMensagem);
        naoLidas = 0;
        chatBadge.classList.add('hidden');
      }
      // O agente precisa saber o modo ANTES de comecar a capturar.
      enviarEscolhaDeAudio();
      status.textContent = salaConfig
        ? 'Conectado. Use os botões abaixo para ligar câmera, tela ou microfone.'
        : suportaWebRTC
          ? 'Conectado ao chat. A mídia está indisponível: o servidor de mídia não respondeu.'
          : 'Conectado ao chat. Este navegador não faz chamadas de vídeo.';
      atualizarContador();
      // Alguem pode ja estar compartilhando desde antes de eu entrar.
      avaliarDestaque();
    });

    // Liga este navegador ao agente local (se houver um instalado) e descobre quais
    // caminhos de captura de áudio estão disponíveis para ESTE participante.
    socket.emit('registrar-agente', tokenDoAgente, () => {
      socket.emit('audio-capabilities', (capabilities) => {
        audioCapabilities = capabilities || audioCapabilities;
        if (!settingsPanel.classList.contains('hidden')) atualizarExplicacaoDeAudio();
      });
    });
    ligarAgenteDoAplicativo();
  });

  socket.on('agente-aplicativos', ({ lista, atual, modo }) => {
    aplicativosDoAgente = Array.isArray(lista) ? lista : [];
    if (atual) appEscolhido = atual;
    // Um agente anterior a este recurso responde sem o modo. Ele nao vai obedecer a escolha,
    // e e melhor dizer isso do que deixar a pessoa achar que escolheu.
    agenteSemModo = audioCapabilities.agenteConectado && modo === undefined;
    desenharAplicativos();
  });

  socket.on('agente-status', ({ conectado, portaLocal }) => {
    // O agente pode ter conectado depois de nos: repete a escolha para ele.
    if (conectado) setTimeout(enviarEscolhaDeAudio, 0);
    audioCapabilities.agenteConectado = Boolean(conectado);
    audioCapabilities.portaLocalDoAgente = portaLocal || null;
    status.textContent = conectado
      ? 'Agente de áudio conectado: você já pode compartilhar o som do seu computador.'
      : 'Agente de áudio desconectado.';
    if (!settingsPanel.classList.contains('hidden')) atualizarExplicacaoDeAudio();
  });

  // Duas fontes independentes dizem quem está na sala, e é bom que sejam duas. O servidor de
  // mídia é a fonte da imagem e da voz, mas guarda por muito tempo quem só sumiu -- fechou o
  // notebook, perdeu o Wi-Fi, matou o navegador -- esperando essa pessoa voltar. A conexão
  // de sinalização percebe isso em segundos, e é ela que tira o fantasma da lista.
  socket.on('peer-left', ({ identidade }) => {
    if (!identidade || !peers.has(identidade)) return;
    removerPar(identidade);
    atualizarContador();
    avaliarDestaque();
  });

  socket.on('audio-data', (data) => receberPcm(data));

  socket.on('audio-error', (message) => { status.textContent = message; });

  socket.on('chat-mensagem', (msg) => mostrarMensagem(msg));

  socket.on('disconnect', () => {
    status.textContent = 'Desconectado do servidor. Tentando reconectar...';
  });
  socket.on('connect_error', () => {
    status.textContent = 'Não foi possível alcançar o servidor. Tentando novamente...';
  });
  // Register listeners before connecting: a fast socket used to beat the RTC fetch.
  socket.connect();
}

function meuEstado() {
  return { camera: Boolean(cameraStream), screen: Boolean(screenStream), screenAudio: Boolean(screenStream?.getAudioTracks().length), micMuted };
}

// O estado das proprias fontes so importa para a interface local: para os outros, quem
// anuncia camera, tela e som de tela e a lista de publicacoes no servidor de midia.
function enviarEstado() {
  avaliarRiscoDeEco();
  document.dispatchEvent(new Event('room-update'));
}

// Escolha de codec de video. "auto" prioriza H.264 baseline: no iPhone e o unico decodificado
// por hardware, e no Windows e o que tem mais chance de sair pelo encoder da GPU. As demais
// opcoes existem para comparar em campo; nenhuma delas REMOVE codec da lista, entao quem nao
// suporta a escolha cai no melhor comum em vez de ficar sem imagem.
let codecDeVideo = (() => { try { return localStorage.getItem('nexoCodec') || 'auto'; } catch (_) { return 'auto'; } })();
if (!RoomMedia.CODEC_PREFERENCES.includes(codecDeVideo)) codecDeVideo = 'auto';
const seletoresDeCodec = [...document.querySelectorAll('[data-video-codec]')];
function codecDeVideoEscolhido() { return codecDeVideo; }

// O codec deixa de ser negociado por transceiver: ele e uma opcao de publicacao, aplicada
// no momento em que a faixa sobe. Trocar durante a transmissao exige republicar a faixa --
// o servidor de midia nao transcodifica, entao quem ja esta recebendo precisa do fluxo novo.
function definirCodecDeVideo(escolha) {
  if (!RoomMedia.CODEC_PREFERENCES.includes(escolha) || escolha === codecDeVideo) return;
  codecDeVideo = escolha;
  try { localStorage.setItem('nexoCodec', escolha); } catch (_) { /* Vale so nesta sessão. */ }
  seletoresDeCodec.forEach(select => { select.value = escolha; });
  status.textContent = escolha === 'auto'
    ? 'Codec automático: H.264, o único que o iPhone decodifica por hardware.'
    : `Codec preferido: ${escolha.toUpperCase()}. Quem não suportar recebe pelo melhor codec em comum.`;
  republicarVideo();
}

// "auto" e H.264: e o unico codec decodificado por hardware no iPhone e o que tem mais
// chance de sair pelo encoder da placa de video no Windows.
function codecDePublicacao() {
  return codecDeVideo === 'auto' ? 'h264' : codecDeVideo;
}

async function republicarVideo() {
  if (!transporte?.conectada) return;
  const camera = cameraStream?.getVideoTracks()[0] || null;
  const tela = screenStream?.getVideoTracks()[0] || null;
  if (camera) { await publicarFonte('camera', null); await publicarFonte('camera', camera); }
  if (tela) { await publicarFonte('screen', null); await publicarFonte('screen', tela); }
}

// Os perfis definem a QUALIDADE DE CAPTURA e o teto de envio. Repartir banda entre
// espectadores deixou de ser tarefa desta pagina: o servidor de midia recebe uma copia e
// entrega a cada pessoa a camada que a conexao dela aguenta (simulcast). Por isso sairam a
// medicao de banda por par, o orcamento, a histerese de resolucao e o limite de upload --
// eles brigariam com o controle de congestionamento do proprio servidor.
let perfilDeQualidade = (() => { try { return localStorage.getItem('nexoQuality') || 'high'; } catch (_) { return 'high'; } })();
if (!RoomQuality.profiles[perfilDeQualidade]) perfilDeQualidade = 'high';
const perfilAtual = () => RoomQuality.profiles[perfilDeQualidade];

// ---------- Publicacao das proprias fontes ----------
// Cada fonte sobe UMA vez para o servidor de midia, que a entrega a todo mundo. Antes era
// uma copia por participante, e a negociacao tinha de ser refeita com cada um.
const publicacoesLocais = { mic: null, camera: null, screen: null, screenAudio: null };
// UMA fila para todas as fontes, nao uma por fonte. Cada publicacao ou remocao dispara uma
// renegociacao com o servidor de midia, e duas ao mesmo tempo -- parar a tela remove video e
// audio juntos -- faziam a negociacao estourar o tempo limite e derrubar a transmissao.
let filaDePublicacao = Promise.resolve();

const FONTE_DO_SERVIDOR = {
  mic: 'microphone', camera: 'camera', screen: 'screen_share', screenAudio: 'screen_share_audio'
};

// Quando falta banda ou processador, alguma coisa TEM de ceder: ou a nitidez, ou a
// fluidez. Não existe escolha certa para os dois casos -- ler código exige texto nítido,
// jogar exige movimento -- e por isso quem compartilha decide, em vez de a página decidir
// por todo mundo. "detail" e "maintain-resolution" derrubam os quadros para segurar a
// resolução; "motion" e "maintain-framerate" fazem o contrário.
// "maintain-framerate" e o unico que entrega quadros constantes: quando o custo aperta, ele
// baixa a resolucao e a devolve quando sobra folga. "balanced" cede dos dois lados, e o que
// se ve e a imagem ficando nitida e travando logo em seguida -- que era o padrao anterior.
const PRIORIDADES_DE_TELA = {
  automatico: { rotulo: 'Automático', dica: 'quadros constantes, na melhor resolução que couber', pista: null, degradacao: 'maintain-framerate', fps: 30 },
  nitidez: { rotulo: 'Nitidez', dica: 'código e texto parados; os quadros cedem primeiro', pista: 'detail', degradacao: 'maintain-resolution', fps: 30 },
  fluidez: { rotulo: 'Fluidez máxima', dica: 'jogos e vídeo, até 60 quadros', pista: 'motion', degradacao: 'maintain-framerate', fps: 60 }
};
let prioridadeDaTela = (() => { try { return localStorage.getItem('nexoPrioridade') || 'automatico'; } catch (_) { return 'automatico'; } })();
if (!PRIORIDADES_DE_TELA[prioridadeDaTela]) prioridadeDaTela = 'automatico';
const seletoresDePrioridade = [...document.querySelectorAll('[data-screen-priority]')];

async function definirPrioridadeDaTela(escolha) {
  if (!PRIORIDADES_DE_TELA[escolha] || escolha === prioridadeDaTela) return;
  prioridadeDaTela = escolha;
  try { localStorage.setItem('nexoPrioridade', escolha); } catch (_) { /* Vale so nesta sessão. */ }
  seletoresDePrioridade.forEach(select => { select.value = escolha; });
  const prioridade = PRIORIDADES_DE_TELA[escolha];
  const faixa = screenStream?.getVideoTracks()[0];
  if (faixa) {
    faixa.contentHint = prioridade.pista || '';
    // A taxa pedida na captura é o teto do que o encoder pode enviar: sem mexer nela,
    // escolher "fluidez" não teria de onde tirar quadros a mais.
    try { await faixa.applyConstraints({ ...faixa.getConstraints(), frameRate: { ideal: prioridade.fps, max: prioridade.fps } }); }
    catch (_) { /* A fonte manda na taxa; o resto da escolha continua valendo. */ }
    await publicarFonte('screen', null);
    await publicarFonte('screen', faixa);
  }
  status.textContent = `Prioridade da tela: ${prioridade.rotulo.toLowerCase()} (${prioridade.dica}).`;
  atualizarBotaoDeQualidade();
}

function opcoesDePublicacao(fonte) {
  if (fonte === 'mic') return { source: FONTE_DO_SERVIDOR.mic };
  if (fonte === 'screenAudio') {
    // DTX corta a transmissao no silencio e RED duplica pacotes para voz. Os dois estragam
    // som de jogo e musica, e o servidor de midia os liga por padrao em faixa mono.
    return { source: FONTE_DO_SERVIDOR.screenAudio, dtx: false, red: false, audioPreset: { maxBitrate: 128_000 } };
  }
  const perfil = perfilAtual();
  if (fonte === 'camera') {
    // Camera e movimento: perder nitidez incomoda menos que ver a pessoa aos solavancos.
    return { source: FONTE_DO_SERVIDOR.camera, videoCodec: codecDePublicacao(), simulcast: true, degradationPreference: 'maintain-framerate' };
  }
  const prioridade = PRIORIDADES_DE_TELA[prioridadeDaTela];
  return {
    source: FONTE_DO_SERVIDOR.screen,
    videoCodec: codecDePublicacao(),
    simulcast: true,
    degradationPreference: prioridade.degradacao,
    screenShareEncoding: { maxBitrate: perfil.bitrate, maxFramerate: prioridade.fps }
  };
}

// Substitui o que "definirFaixaEmTodosOsPares" fazia na malha: agora ha um destino so.
function publicarFonte(fonte, faixa) {
  const tarefa = filaDePublicacao.catch(() => {}).then(async () => {
    if (!transporte?.conectada) return;
    const local = transporte.sala.localParticipant;
    const anterior = publicacoesLocais[fonte];

    // "false" e essencial: por padrao o servidor de midia ENCERRA a faixa ao despublicar.
    // Quem manda no ciclo de vida das capturas e esta pagina -- sem isto, trocar o perfil
    // de qualidade (que despublica e publica de novo) matava a tela compartilhada.
    const despublicar = publicacao => local.unpublishTrack(publicacao.track ?? publicacao, false).catch(() => {});

    if (!faixa || faixa.readyState === 'ended') {
      if (anterior) { await despublicar(anterior); publicacoesLocais[fonte] = null; }
      return;
    }
    // Trocar de camera ou de tela nao precisa republicar: a faixa entra no lugar da atual,
    // sem renegociar e sem piscar para quem esta assistindo.
    if (anterior?.track && typeof anterior.track.replaceTrack === 'function') {
      try { await anterior.track.replaceTrack(faixa); return; }
      catch (_) { await despublicar(anterior); publicacoesLocais[fonte] = null; }
    }
    publicacoesLocais[fonte] = await local.publishTrack(faixa, opcoesDePublicacao(fonte));
  }).catch(erro => {
    console.warn('Falha ao publicar', fonte, erro);
    status.textContent = `Não foi possível enviar ${fonte === 'camera' ? 'a câmera' : fonte === 'mic' ? 'o microfone' : 'a tela'}. Tente desligar e ligar essa fonte.`;
  });
  filaDePublicacao = tarefa;
  return tarefa;
}

// Nome preservado da malha: a interface inteira chama por aqui e nao precisa saber que
// agora existe um destino so.
function definirFaixaEmTodosOsPares(source, track) {
  return publicarFonte(source, track);
}

function paraCadaPar(fn) { peers.forEach(fn); }

function removerPar(id) {
  const par = peers.get(id);
  if (!par) return;
  peers.delete(id);
  pararDeAcompanhar(id);
  removerTile(id);
  if (pinned?.id === id) despinar();
}

// ---------- Captura de microfone e camera ----------
// O navegador so entrega o que a gente pede. Sem pedir resolucao, o Chrome devolve
// 640x480 (4:3) mesmo numa webcam widescreen -- e o padrao dele, nao o formato da camera,
// e o resultado e uma imagem quase quadrada, mais estreita do que a camera enxerga.
// Pedindo 1280x720 como "ideal", o navegador escolhe o modo nativo mais proximo: 16:9 em
// quem tem 16:9, 4:3 em quem so tem 4:3. Nada e forcado, entao ninguem e recortado.
// No celular o que importa e o LADO da camera, nao o deviceId: no iOS a lista vem sem nome
// ate haver permissao, e um id guardado de outra sessao pode nem existir mais.
const suportaLadoDaCamera = Boolean(navigator.mediaDevices?.getSupportedConstraints?.().facingMode);
const LADO_PADRAO = 'user';
// "ladoPreferido" so existe depois que a pessoa vira a camera. Sem isso, uma webcam de mesa
// receberia um facingMode que ninguem pediu; o comportamento de quem nunca virou fica igual.
let ladoPreferido = (() => {
  try { const salvo = localStorage.getItem('nexoLadoCamera'); return salvo === 'user' || salvo === 'environment' ? salvo : ''; }
  catch (_) { return ''; }
})();
// Lado da imagem que esta no ar agora, para o botao saber para onde virar.
let ladoDaCamera = ladoPreferido || LADO_PADRAO;

async function abrirCamera(lado) {
  const escolhida = lado ? '' : dispositivoEscolhido('camera');
  const alvo = lado || (escolhida ? '' : ladoPreferido);
  const medida = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        // "exact" porque "ideal" e apenas uma sugestao: o navegador entregaria a camera
        // padrao sem avisar, e a escolha da pessoa sumiria em silencio.
        ...(escolhida ? { deviceId: { exact: escolhida } } : {}),
        // O lado, ao contrario, vai como preferencia: um notebook so tem a frontal, e
        // exigir "environment" ali significaria ficar sem camera nenhuma.
        ...(alvo ? { facingMode: alvo } : {}),
        ...medida
      },
      audio: false
    });
  } catch (err) {
    // Quem pediu um LADO especifico quer aquele lado. Cair aqui na "qualquer camera" fazia
    // virar a camera abrir de novo a mesma e ainda anunciar que tinha virado.
    if (lado) throw err;
    // Dispositivo escolhido sumiu (desconectado, trocado de porta): melhor a camera padrao
    // do que camera nenhuma -- mas a preferencia fica guardada para quando ele voltar.
    if (escolhida && err && err.name !== 'NotAllowedError') {
      return await navigator.mediaDevices.getUserMedia({ video: { ...medida }, audio: false });
    }
    // Permissao negada e um nao definitivo; o resto pode ser so a camera nao aceitar essa
    // combinacao, e ai uma camera em 4:3 e melhor que camera nenhuma.
    if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) throw err;
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function ladoAtualDaCamera() {
  const medida = cameraStream?.getVideoTracks()[0]?.getSettings?.().facingMode;
  return medida === 'environment' || medida === 'user' ? medida : ladoDaCamera;
}

// "escolhido" separa o que a pessoa pediu (virar a câmera) do que apenas foi medido ao ligar
// a câmera. Só o pedido vira preferência guardada.
function guardarLadoDaCamera(lado, escolhido) {
  ladoDaCamera = lado;
  if (!escolhido) return;
  ladoPreferido = lado;
  try { localStorage.setItem('nexoLadoCamera', lado); } catch (_) { /* Vale so nesta sessão. */ }
}

// Virar a camera no celular. Dois caminhos, nesta ordem:
//   1. applyConstraints na faixa que ja existe. No Safari isso troca a camera SEM
//      renegociar, sem replaceTrack e sem disparar onended -- de longe o mais suave.
//   2. Reabrir. Aqui a ordem importa: no iOS, abrir a segunda camera com a primeira ainda
//      viva congela a primeira, entao a antiga e parada ANTES do getUserMedia. Se a nova
//      falhar, a anterior e reaberta para nao deixar a pessoa sem imagem.
let virandoCamera = false;
async function virarCamera() {
  if (!cameraStream || virandoCamera) return;
  const faixa = cameraStream.getVideoTracks()[0];
  if (!faixa) return;
  const alvo = ladoAtualDaCamera() === 'environment' ? 'user' : 'environment';
  virandoCamera = true;
  flipCameraBtn.disabled = true;
  try {
    try {
      await faixa.applyConstraints({ ...faixa.getConstraints(), facingMode: { exact: alvo } });
      atualizarTile('self');
      atualizarPalco();
      anunciarLado(faixa, alvo);
      return;
    } catch (erroDeAjuste) {
      if (!['OverconstrainedError', 'NotSupportedError', 'TypeError', 'InvalidStateError'].includes(erroDeAjuste?.name)) throw erroDeAjuste;
    }

    const anterior = ladoAtualDaCamera();
    cameraStream.getTracks().forEach(t => t.stop());
    let novo;
    try {
      novo = await abrirCamera(alvo);
    } catch (erroAoAbrir) {
      try { novo = await abrirCamera(anterior); }
      catch (_) {
        cameraStream = null;
        definirFaixaEmTodosOsPares('camera', null, null);
        cameraBtn.textContent = 'Ligar câmera';
        cameraBtn.setAttribute('aria-pressed', 'false');
        atualizarTile('self');
        avaliarDestaque();
        enviarEstado();
        status.textContent = 'Não foi possível virar a câmera: ' + erroAoAbrir.message;
        return;
      }
      cameraStream = novo;
      aplicarNovaCamera(novo);
      status.textContent = 'Esta câmera não está disponível agora; a anterior foi mantida.';
      return;
    }
    cameraStream = novo;
    aplicarNovaCamera(novo);
    anunciarLado(novo.getVideoTracks()[0], alvo);
  } catch (err) {
    status.textContent = 'Não foi possível virar a câmera: ' + err.message;
  } finally {
    virandoCamera = false;
    flipCameraBtn.disabled = false;
    atualizarBotaoDeVirarCamera();
    listarDispositivos();
  }
}

// Nem toda camera informa o lado (webcam de mesa, canvas de teste). Quando informa, e ela
// quem tem razao: dizer "câmera traseira" com a frontal ligada seria mentir para quem ve.
function anunciarLado(faixa, alvo) {
  const medido = faixa?.getSettings?.().facingMode;
  const efetivo = medido === 'user' || medido === 'environment' ? medido : alvo;
  guardarLadoDaCamera(efetivo, true);
  status.textContent = efetivo !== alvo
    ? 'Este aparelho não trocou de câmera; a imagem continua na mesma.'
    : efetivo === 'environment' ? 'Câmera traseira.' : 'Câmera frontal.';
}

function aplicarNovaCamera(stream) {
  const faixa = stream.getVideoTracks()[0];
  definirFaixaEmTodosOsPares('camera', faixa, stream);
  faixa.onended = alternarCamera;
  atualizarTile('self');
  atualizarPalco();
}

// O botao so faz sentido onde ha mais de uma camera para alternar.
let temMaisDeUmaCamera = false;
function atualizarBotaoDeVirarCamera() {
  const mostrar = Boolean(cameraStream) && suportaLadoDaCamera && temMaisDeUmaCamera;
  flipCameraBtn.hidden = !mostrar;
  if (!mostrar) return;
  const traseira = ladoAtualDaCamera() === 'environment';
  const rotulo = traseira ? 'Câmera frontal' : 'Câmera traseira';
  flipCameraBtn.textContent = rotulo;
  // No celular o rótulo é encurtado pelo CSS; o nome inteiro fica aqui, para o leitor de tela.
  flipCameraBtn.setAttribute('aria-label', rotulo);
  flipCameraBtn.title = traseira ? 'Voltar para a câmera frontal' : 'Usar a câmera traseira';
}

async function abrirMicrofone(forcarDispositivo) {
  const suportadas = navigator.mediaDevices.getSupportedConstraints?.() || {};
  const escolhido = forcarDispositivo || dispositivoEscolhido('microfone');
  const pedido = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1
  };
  if (escolhido) pedido.deviceId = { exact: escolhido };
  // Supressor de ruido novo do Chrome (bem melhor que o classico, e existe no Android).
  if (suportadas.voiceIsolation) pedido.voiceIsolation = true;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: pedido });
  } catch (err) {
    if (err && err.name === 'NotAllowedError') throw err;
    // Sem o dispositivo escolhido, o padrao serve; a preferencia continua guardada.
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

// ---------- Redução de ruído local: RNNoise em AudioWorklet ----------
let filtroDeRuidoLigado = true;
let cadeiaDeRuido = null;
let faixaEnviadaDoMic = null;
let geracaoDoFiltro = 0;
let carregandoFiltro = false;
let erroDoFiltro = false;
let contextoDoFiltroPendente = null;

async function montarFiltroDeRuido() {
  if (!micStream || !micTrack || cadeiaDeRuido || carregandoFiltro || !filtroDeRuidoLigado) return;
  const geracao = ++geracaoDoFiltro;
  carregandoFiltro = true;
  erroDoFiltro = false;
  atualizarBotaoDeRuido();
  let contexto, fonte, node, faixa;
  try {
    contexto = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
    contextoDoFiltroPendente = contexto;
    const retomando = contexto.resume().catch(() => {});
    await contexto.audioWorklet.addModule('/noise-worklet.js');
    await retomando;
    if (geracao !== geracaoDoFiltro || !micTrack || !filtroDeRuidoLigado) { await contexto.close(); return; }
    node = new AudioWorkletNode(contexto, 'nexo-noise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    fonte = contexto.createMediaStreamSource(micStream);
    const destino = contexto.createMediaStreamDestination();
    fonte.connect(node);
    node.connect(destino);
    faixa = destino.stream.getAudioTracks()[0];
    faixa.enabled = !micMuted;
    cadeiaDeRuido = { contexto, fonte, node, faixa };
    node.onprocessorerror = () => {
      erroDoFiltro = true;
      desmontarFiltroDeRuido();
      escolherFaixaDoMic();
      status.textContent = 'Redução inteligente indisponível. A voz continua com o filtro do navegador.';
    };
    contexto.addEventListener('statechange', escolherFaixaDoMic);
    escolherFaixaDoMic();
  } catch (error) {
    fonte?.disconnect();
    node?.disconnect();
    faixa?.stop();
    await contexto?.close().catch(() => {});
    if (geracao === geracaoDoFiltro) erroDoFiltro = true;
  } finally {
    if (contextoDoFiltroPendente === contexto) contextoDoFiltroPendente = null;
    if (geracao === geracaoDoFiltro) { carregandoFiltro = false; atualizarBotaoDeRuido(); }
  }
}

function desmontarFiltroDeRuido() {
  ++geracaoDoFiltro;
  carregandoFiltro = false;
  if (contextoDoFiltroPendente) {
    contextoDoFiltroPendente.close().catch(() => {});
    contextoDoFiltroPendente = null;
  }
  const antiga = cadeiaDeRuido;
  cadeiaDeRuido = null;
  if (!antiga) return;
  antiga.contexto.removeEventListener('statechange', escolherFaixaDoMic);
  antiga.fonte.disconnect();
  antiga.node.port.postMessage('stop');
  antiga.node.disconnect();
  antiga.faixa.stop();
  antiga.contexto.close().catch(() => {});
}

function escolherFaixaDoMic() {
  if (!micTrack) return;
  const podeFiltrar = filtroDeRuidoLigado && cadeiaDeRuido?.contexto.state === 'running';
  const desejada = podeFiltrar ? cadeiaDeRuido.faixa : micTrack;
  cadeiaDeRuido?.node.port.postMessage({ enabled: Boolean(podeFiltrar && !micMuted) });
  if (desejada !== faixaEnviadaDoMic) {
    faixaEnviadaDoMic = desejada;
    desejada.enabled = !micMuted;
    definirFaixaEmTodosOsPares('mic', desejada, micStream);
  }
  atualizarBotaoDeRuido();
}

function atualizarBotaoDeRuido() {
  const ativo = Boolean(filtroDeRuidoLigado && cadeiaDeRuido?.contexto.state === 'running' && faixaEnviadaDoMic === cadeiaDeRuido.faixa);
  noiseBtn.textContent = ativo ? 'RNNoise ativo' : carregandoFiltro ? 'Preparando RNNoise…' : 'Filtro do navegador';
  noiseBtn.setAttribute('aria-pressed', String(filtroDeRuidoLigado));
  noiseBtn.classList.toggle('secondary', !ativo);
  noiseBtn.title = ativo ? 'Redução inteligente local, sem limite de uso. Clique para usar só o filtro do navegador.'
    : erroDoFiltro ? 'RNNoise indisponível neste dispositivo. O filtro do navegador continua funcionando.'
    : 'Clique para alternar a redução inteligente de ruído.';
}

function liberarContextoDeAudio() {
  for (const contexto of [contextoDeAnalise, cadeiaDeRuido?.contexto, contextoDoFiltroPendente]) {
    if (contexto?.state === 'suspended') contexto.resume().then(escolherFaixaDoMic).catch(() => {});
  }
}
['pointerdown', 'touchstart', 'keydown'].forEach(evento => {
  document.addEventListener(evento, liberarContextoDeAudio, { passive: true });
});

noiseBtn.onclick = () => {
  filtroDeRuidoLigado = !filtroDeRuidoLigado;
  if (filtroDeRuidoLigado) montarFiltroDeRuido();
  else desmontarFiltroDeRuido();
  liberarContextoDeAudio();
  escolherFaixaDoMic();
  status.textContent = filtroDeRuidoLigado
    ? 'Redução inteligente solicitada. O botão indica quando RNNoise estiver ativo.'
    : 'Usando a redução de ruído padrão do navegador.';
};

// ---------- Mic ----------
function atualizarBotaoDoMic() {
  const semMicrofone = !micTrack;
  micBtn.textContent = semMicrofone ? 'Ativar mic' : (micMuted ? 'Mic mudo' : 'Mic ligado');
  micBtn.setAttribute('aria-pressed', String(!semMicrofone && !micMuted));
  micBtn.classList.toggle('secondary', semMicrofone || micMuted);
  micBtn.title = semMicrofone ? 'Ativar o microfone' : 'Microfone';
}

let abrindoMicrofone = false;

// Primeiro clique: e aqui que o microfone e pedido ao navegador, e nao ao entrar na sala.
async function ativarMicrofone() {
  if (abrindoMicrofone) return;
  if (!temMediaDevices) {
    status.textContent = 'Este navegador não libera microfone nesta página. É preciso abrir por HTTPS (ou localhost).';
    return;
  }
  abrindoMicrofone = true;
  micBtn.disabled = true;
  micBtn.textContent = 'Abrindo...';
  try {
    micStream = await abrirMicrofone();
    micTrack = micStream.getAudioTracks()[0];
    faixaEnviadaDoMic = micTrack;
    micMuted = false;
    micTrack.enabled = true;
    noiseBtn.hidden = false;
    // O clique e um gesto do usuario -- exatamente o que o celular exige para deixar o
    // AudioContext do filtro sair de "suspended".
    montarFiltroDeRuido();
    // A faixa nao estava na conexao: entra agora, e o navegador renegocia sozinho.
    definirFaixaEmTodosOsPares('mic', faixaEnviadaDoMic, micStream);
    acompanharVoz('self', micStream);
    // Com a permissao concedida, os dispositivos finalmente tem nome.
    listarDispositivos();
    status.textContent = 'Microfone ligado.';
  } catch (err) {
    micStream = null;
    micTrack = null;
    micMuted = true;
    noiseBtn.hidden = true;
    status.textContent = 'Não foi possível acessar o microfone: ' + err.message;
  } finally {
    abrindoMicrofone = false;
    micBtn.disabled = false;
    atualizarBotaoDoMic();
    atualizarTile('self');
    enviarEstado();
  }
}

function alternarMic() {
  if (!micTrack) { ativarMicrofone(); return; }
  micMuted = !micMuted;
  micTrack.enabled = !micMuted;
  // A faixa filtrada e outra faixa: sem isso, o mudo nao valeria para quem esta com o
  // filtro ligado.
  if (faixaEnviadaDoMic && faixaEnviadaDoMic !== micTrack) faixaEnviadaDoMic.enabled = !micMuted;
  escolherFaixaDoMic();
  atualizarBotaoDoMic();
  atualizarTile('self');
  enviarEstado();
}
micBtn.onclick = alternarMic;

// ---------- Microfone, fone e camera ----------
// O navegador so revela o NOME dos dispositivos depois de conceder permissao a um deles.
// Antes disso a lista existe, mas vem anonima -- e por isso ela e refeita assim que o
// microfone ou a camera abrem pela primeira vez.
const CHAVES_DE_DISPOSITIVO = {
  microfone: 'sala.dispositivo.microfone',
  saida: 'sala.dispositivo.saida',
  camera: 'sala.dispositivo.camera'
};

function dispositivoEscolhido(tipo) {
  try { return localStorage.getItem(CHAVES_DE_DISPOSITIVO[tipo]) || ''; }
  catch (_) { return ''; }   // navegacao privada, armazenamento bloqueado
}

function guardarDispositivo(tipo, valor) {
  try {
    if (valor) localStorage.setItem(CHAVES_DE_DISPOSITIVO[tipo], valor);
    else localStorage.removeItem(CHAVES_DE_DISPOSITIVO[tipo]);
  } catch (_) { /* sem armazenamento: vale so nesta sessao */ }
}

// setSinkId so existe em navegadores baseados no Chromium. Onde nao existe, quem escolhe a
// saida e o sistema operacional, e o seletor sai da tela em vez de fingir que funciona.
const podeEscolherSaida = typeof HTMLMediaElement !== 'undefined'
  && 'setSinkId' in HTMLMediaElement.prototype;

function aplicarSaidaEm(elemento) {
  if (!podeEscolherSaida || !elemento?.setSinkId) return;
  const id = dispositivoEscolhido('saida');
  // '' e o padrao do sistema, e e um valor valido para o setSinkId.
  elemento.setSinkId(id).catch(() => { /* dispositivo sumiu: segue no padrao */ });
}

function aplicarSaidaEmTodos() {
  if (!podeEscolherSaida) return;
  tiles.forEach(refs => { aplicarSaidaEm(refs.peerAudio); aplicarSaidaEm(refs.screenAudio); });
  tilesDeTela.forEach(refs => aplicarSaidaEm(refs.video));
  aplicarSaidaEm(stageVideo);
}

function preencher(seletor, lista, escolhido, rotuloPadrao) {
  seletor.innerHTML = '';
  const padrao = document.createElement('option');
  padrao.value = '';
  padrao.textContent = rotuloPadrao;
  seletor.appendChild(padrao);
  lista.forEach((d, i) => {
    const opcao = document.createElement('option');
    opcao.value = d.deviceId;
    opcao.textContent = d.label || `${rotuloPadrao.replace('Padrão do sistema', 'Dispositivo')} ${i + 1}`;
    seletor.appendChild(opcao);
  });
  // Um dispositivo guardado que nao esta mais na lista nao pode ser selecionado: o seletor
  // mostraria o padrao enquanto a preferencia continua valendo. Melhor anuncia-lo ausente.
  if (escolhido && !lista.some(d => d.deviceId === escolhido)) {
    const sumido = document.createElement('option');
    sumido.value = escolhido;
    sumido.textContent = 'Escolhido anteriormente (desconectado)';
    seletor.appendChild(sumido);
  }
  seletor.value = escolhido || '';
}

async function listarDispositivos() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let lista = [];
  try { lista = await navigator.mediaDevices.enumerateDevices(); }
  catch (_) { return; }

  const entradas = lista.filter(d => d.kind === 'audioinput');
  const saidas = lista.filter(d => d.kind === 'audiooutput');
  const cameras = lista.filter(d => d.kind === 'videoinput');

  temMaisDeUmaCamera = cameras.length > 1;
  atualizarBotaoDeVirarCamera();

  preencher(micDevice, entradas, dispositivoEscolhido('microfone'), 'Padrão do sistema');
  preencher(camDevice, cameras, dispositivoEscolhido('camera'), 'Padrão do sistema');
  if (podeEscolherSaida) preencher(outDevice, saidas, dispositivoEscolhido('saida'), 'Padrão do sistema');
  saidaCampo.hidden = !podeEscolherSaida;

  // Sem permissao concedida a lista vem sem nome nenhum -- dizer isso e melhor que mostrar
  // "Dispositivo 1, Dispositivo 2" e deixar a pessoa adivinhar.
  const semNomes = [...entradas, ...cameras].some(d => !d.label);
  devicesDica.textContent = semNomes
    ? 'Os nomes dos dispositivos só aparecem depois que você ativa o microfone ou a câmera pelo menos uma vez.'
    : (podeEscolherSaida ? '' : 'Este navegador não deixa escolher a saída de áudio; quem decide é o sistema.');
}

async function trocarMicrofone(id) {
  guardarDispositivo('microfone', id);
  // Sem microfone aberto ainda, guardar basta: ele já nasce no dispositivo certo.
  if (!micTrack) return;

  const anterior = micStream;
  let novo;
  try { novo = await abrirMicrofone(id); }
  catch (err) { status.textContent = 'Não foi possível abrir esse microfone: ' + err.message; return; }

  micStream = novo;
  micTrack = novo.getAudioTracks()[0];
  micTrack.enabled = !micMuted;

  // O filtro e o medidor de voz vivem presos ao stream antigo: os dois são refeitos.
  desmontarFiltroDeRuido();
  faixaEnviadaDoMic = micTrack;
  montarFiltroDeRuido();
  definirFaixaEmTodosOsPares('mic', faixaEnviadaDoMic, micStream);
  acompanharVoz('self', micStream);

  // Só depois de o novo estar no ar: parar antes deixaria um buraco de silêncio.
  anterior?.getTracks().forEach(t => t.stop());
  status.textContent = 'Microfone trocado.';
  listarDispositivos();
}

async function trocarCamera(id) {
  const preferenciaAnterior = dispositivoEscolhido('camera');
  guardarDispositivo('camera', id);
  if (!cameraStream) return;

  // A anterior e encerrada ANTES de abrir a nova: no iOS, duas cameras vivas ao mesmo tempo
  // congelam a primeira, e no Windows algumas webcams recusam a segunda abertura.
  cameraStream.getTracks().forEach(t => t.stop());
  let novo, revertida = false;
  try { novo = await abrirCamera(); }
  catch (err) {
    // A antiga ja foi encerrada: sem voltar a preferencia e reabrir, a pessoa ficaria sem
    // imagem por ter apenas ESCOLHIDO uma camera na lista.
    revertida = true;
    guardarDispositivo('camera', preferenciaAnterior);
    camDevice.value = preferenciaAnterior || '';
    try { novo = await abrirCamera(); }
    catch (_) {
      cameraStream = null;
      definirFaixaEmTodosOsPares('camera', null, null);
      cameraBtn.textContent = 'Ligar câmera';
      cameraBtn.setAttribute('aria-pressed', 'false');
      atualizarTile('self');
      atualizarBotaoDeVirarCamera();
      avaliarDestaque();
      enviarEstado();
      status.textContent = 'Não foi possível abrir essa câmera: ' + err.message;
      return;
    }
  }

  cameraStream = novo;
  aplicarNovaCamera(novo);
  atualizarBotaoDeVirarCamera();
  status.textContent = revertida ? 'Essa câmera não abriu; a anterior foi mantida.' : 'Câmera trocada.';
  listarDispositivos();
}

micDevice.onchange = () => trocarMicrofone(micDevice.value);
camDevice.onchange = () => trocarCamera(camDevice.value);
outDevice.onchange = () => {
  guardarDispositivo('saida', outDevice.value);
  aplicarSaidaEmTodos();
  status.textContent = 'Saída de áudio trocada.';
};

devicesBtn.onclick = () => { listarDispositivos(); devicesPanel.classList.remove('hidden'); };
devicesClose.onclick = () => devicesPanel.classList.add('hidden');
devicesPanel.addEventListener('click', (e) => {
  if (e.target === devicesPanel) devicesPanel.classList.add('hidden');
});

// Fone conectado ou removido no meio da conversa: a lista se atualiza sozinha.
navigator.mediaDevices?.addEventListener?.('devicechange', listarDispositivos);
listarDispositivos();

// ---------- Qualidade de transmissão ----------
function emMegabits(bits) { return (bits / 1_000_000).toFixed(1).replace('.', ',') + ' Mbps'; }

// As medicoes agora sao do ENVIO para o servidor de midia: uma copia so, em vez de uma por
// pessoa. O que cada espectador recebe e decidido la, pela conexao dele.
let qualidadeDoEnvio = null;
// "Está ruim por causa da minha internet ou do meu PC?" é a primeira pergunta de quem vê a
// imagem travando, e o navegador sabe a resposta. Ela vale mais em português do que como
// "qualityLimitationReason: cpu" escondido num relatório.
const MOTIVOS_DE_LIMITE = {
  cpu: 'O processador não dá conta de codificar tudo isso. Baixe a qualidade, feche o que estiver pesado, ou escolha Fluidez.',
  bandwidth: 'Sua conexão de subida não dá conta. Baixe a qualidade — nada aqui contorna o limite do link.',
  other: 'O navegador está limitando o envio por outro motivo.'
};

function atualizarBotaoDeQualidade() {
  const prioridade = PRIORIDADES_DE_TELA[prioridadeDaTela];
  qualidadeBtn.textContent = `${perfilAtual().label} · ${prioridade.rotulo.toLowerCase()} · até ${prioridade.fps} fps e ${emMegabits(perfilAtual().bitrate)}`;
  const q = qualidadeDoEnvio;
  const ao_vivo = document.getElementById('qualityLive');
  if (!screenStream) { ao_vivo.textContent = 'As medições aparecem durante a transmissão.'; return; }
  if (!q) { ao_vivo.textContent = 'Aguardando medições de envio…'; return; }
  const codec = q.codec ? ` · ${q.codec.replace(/^video\//i, '')}` : '';
  // Só afirma hardware quando o navegador informa; caso contrário, silêncio.
  const encoder = q.hardware === true ? ' · em hardware' : q.hardware === false ? ' · em software' : '';
  const motivo = MOTIVOS_DE_LIMITE[q.reason];
  const camadas = q.camadas?.length > 1
    ? `\nCamadas: ${q.camadas.map(c => `${c.altura || '?'}p a ${c.fps} fps`).join(' · ')}`
    : '';
  ao_vivo.textContent = `Enviando ${q.width || '?'} × ${q.height || '?'} · ${Math.round(q.fps || 0)} fps · ${emMegabits(q.bitrate)}${codec}${encoder}`
    + camadas
    + (motivo ? `\n${motivo}` : '\nNada está limitando o envio: os quadros que saem são os que a fonte entrega.')
    + '\nCada pessoa recebe a camada que a conexão dela aguenta.';
}

// Uma leitura periodica do envio, so para a interface. Ela nao decide mais nada: ajustar
// resolucao e bitrate por espectador e tarefa do servidor de midia.
let medindoEnvio = false;
async function medirEnvio() {
  const faixa = publicacoesLocais.screen?.track;
  if (!faixa?.getRTCStatsReport || medindoEnvio) return;
  medindoEnvio = true;
  try {
    const stats = await faixa.getRTCStatsReport();
    if (!stats) return;
    // Sua tela sobe repartida em camadas, e cada uma tem os proprios quadros. Olhar so a
    // maior esconde justamente o que se ve na tela: uma camada travando enquanto a outra
    // vai bem. Por isso as duas aparecem.
    const camadas = [...stats.values()]
      .filter(i => i.type === 'outbound-rtp' && i.kind === 'video')
      .sort((a, b) => (b.frameHeight || 0) - (a.frameHeight || 0));
    const video = camadas[0];
    if (!video) return;
    const anterior = qualidadeDoEnvio?.bruto;
    const intervalo = anterior && video.timestamp - anterior.timestamp;
    qualidadeDoEnvio = {
      width: video.frameWidth, height: video.frameHeight, fps: video.framesPerSecond,
      bitrate: intervalo > 0 ? Math.max(0, (video.bytesSent - anterior.bytes) * 8000 / intervalo) : 0,
      reason: video.qualityLimitationReason,
      codec: stats.get(video.codecId)?.mimeType || '',
      // Unica evidencia objetiva de que a placa de video esta sendo usada.
      encoder: video.encoderImplementation || '',
      hardware: video.powerEfficientEncoder,
      camadas: camadas.map(c => ({ altura: c.frameHeight, fps: Math.round(c.framesPerSecond || 0) })),
      bruto: { bytes: video.bytesSent, timestamp: video.timestamp }
    };
    atualizarBotaoDeQualidade();
  } catch (_) { /* Sem estatísticas, a medição some da tela e a transmissão segue. */ }
  finally { medindoEnvio = false; }
}
setInterval(medirEnvio, 2000);

const seletoresDeQualidade = [...document.querySelectorAll('[data-quality-profile]')];
seletoresDeQualidade.forEach(select => {
  select.value = perfilDeQualidade;
  select.onchange = async () => {
    const anterior = perfilDeQualidade;
    const novo = select.value;
    if (!RoomQuality.profiles[novo]) return;
    seletoresDeQualidade.forEach(el => { el.disabled = true; });
    try {
      const perfil = RoomQuality.profiles[novo];
      const track = screenStream?.getVideoTracks()[0];
      if (track) await track.applyConstraints({ ...track.getConstraints(), width: { ideal: perfil.width, max: perfil.width },
        height: { ideal: perfil.height, max: perfil.height }, frameRate: { ideal: 30, max: 30 } });
      perfilDeQualidade = novo;
      try { localStorage.setItem('nexoQuality', novo); } catch (_) {}
      // O teto de envio entra nas opcoes de publicacao, entao a faixa precisa subir de novo.
      if (track) await publicarFonte('screen', null).then(() => publicarFonte('screen', track));
      status.textContent = `Qualidade ${perfil.label}. Cada pessoa recebe a camada que a conexão dela aguenta.`;
    } catch (_) {
      perfilDeQualidade = anterior;
      status.textContent = 'Esta fonte não aceitou a nova resolução. Use Atualizar tela para selecionar novamente.';
    } finally {
      seletoresDeQualidade.forEach(el => { el.disabled = false; el.value = perfilDeQualidade; });
      atualizarBotaoDeQualidade();
    }
  };
});
seletoresDeCodec.forEach(select => {
  select.value = codecDeVideo;
  select.onchange = () => definirCodecDeVideo(select.value);
});
seletoresDePrioridade.forEach(select => {
  select.value = prioridadeDaTela;
  select.onchange = () => definirPrioridadeDaTela(select.value);
});
atualizarBotaoDeQualidade();

// ---------- Câmera ----------
async function alternarCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    definirFaixaEmTodosOsPares('camera', null, null);
    cameraBtn.textContent = 'Ligar câmera';
    cameraBtn.setAttribute('aria-pressed', 'false');
  } else {
    try {
      cameraStream = await abrirCamera();
    } catch (err) {
      status.textContent = 'Não foi possível acessar a câmera: ' + err.message;
      return;
    }
    const track = cameraStream.getVideoTracks()[0];
    definirFaixaEmTodosOsPares('camera', track, cameraStream);
    track.onended = alternarCamera;
    cameraBtn.textContent = 'Desligar câmera';
    cameraBtn.setAttribute('aria-pressed', 'true');
    const medida = track.getSettings?.() || {};
    if (medida.facingMode === 'user' || medida.facingMode === 'environment') guardarLadoDaCamera(medida.facingMode);
    if (medida.width && medida.height) {
      status.textContent = `Câmera ligada em ${medida.width}x${medida.height}.`;
    }
    listarDispositivos();
  }
  atualizarBotaoDeVirarCamera();
  atualizarTile('self');
  // Precisa passar pelo avaliador, e nao so desfazer o destaque: ligar a propria camera
  // estando sozinho tem de acender o palco na hora, sem depender de outro evento chegar.
  avaliarDestaque();
  enviarEstado();
}
cameraBtn.onclick = alternarCamera;
flipCameraBtn.onclick = virarCamera;

// ---------- Tela ----------
function abrirPainelDeTela(modo) {
  settingsMode = modo;
  settingsTitle.textContent = modo === 'update' ? 'Atualizar tela compartilhada' : 'Configurar compartilhamento de tela';
  confirmScreenBtn.textContent = modo === 'update' ? 'Atualizar' : 'Compartilhar';
  settingsPanel.classList.remove('hidden');
  acompanharAplicativos(true);
  atualizarExplicacaoDeAudio();
}
function fecharPainelDeTela() {
  settingsPanel.classList.add('hidden');
  acompanharAplicativos(false);
}

// Qual navegador esta rodando: o servidor usa isso para achar sozinho a arvore de
// processos a excluir do audio do sistema.
function familiaDoNavegador() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'msedge';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome'; // Brave/Vivaldi tambem se identificam como Chrome
  return '';
}

// Segunda camada de protecao (a primeira e no servidor): a captura nativa acontece na
// maquina do servidor, entao so pode valer para uma pagina aberta localmente. Se a sala
// foi aberta por um dominio publico/tunel, o helper capturaria o audio do computador do
// host e mandaria como se fosse o nosso.
function paginaAbertaLocalmente() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^25\./.test(h) || /^26\./.test(h); // faixas de VPN comuns (Hamachi/Radmin)
}

// Decide sozinho de onde vem o audio, sem o usuario escolher processo nenhum:
//  - aba    -> o proprio navegador entrega o audio daquela aba (nunca gera eco)
//  - agente -> agente instalado NESTE computador: todo o sistema menos o navegador
//  - helper -> mesma coisa, mas pelo processo do servidor (so para quem esta nele)
//  - resto  -> audio do sistema pelo navegador, que pode voltar como eco
function planoDeAudio() {
  if (audioPolicy.value === 'none') return 'nenhum';
  if (captureMode.value === 'browser') return 'aba';
  if (captureMode.value === 'window' && !aplicativoNativo) return 'janela-navegador';
  if (aplicativoNativo && !audioCapabilities.agenteConectado) return 'nenhum';
  if (audioCapabilities.agenteConectado) return 'agente';
  if (audioCapabilities.podeUsarHelper && paginaAbertaLocalmente()) return 'helper';
  return 'navegador-sistema';
}

// O texto muda conforme o programa escolhido, porque a consequencia muda: excluir o
// navegador e o caso sem eco; excluir outro programa deixa o navegador entrar na captura,
// e ai a voz dos outros participantes volta se a conversa for por aqui.
// O texto muda conforme o modo, porque a consequencia muda: excluir o navegador (ou o
// aplicativo) e o caso sem eco; excluir outro programa deixa o navegador entrar na captura,
// e ai tudo que ele toca volta para a sala.
function textoDaCaptura(quem) {
  const origem = quem === 'agente'
    ? 'O agente instalado neste computador vai transmitir'
    : 'Este computador vai transmitir';

  if (modoDeAudio === 'excluir-pid') {
    return `${origem} todo o áudio do sistema, exceto o deste aplicativo. `
         + 'Como quem toca a sala é o próprio aplicativo, nada volta como eco — e o navegador '
         + 'continua na captura, então um vídeo aberto nele vai junto normalmente.';
  }
  if (modoDeAudio === 'incluir') {
    if (!appEscolhido) {
      return 'Escolha abaixo o programa cujo som deve ir para a sala. Enquanto nenhum for '
           + 'escolhido, a tela é compartilhada sem áudio.';
    }
    const nome = nomeDoApp(appEscolhido);
    return `${origem} SOMENTE o áudio de ${nome}. Nada mais do computador vai para a sala: `
         + 'nem a voz de outro aplicativo, nem esta página. É o modo para quem conversa por fora '
         + '(Discord, por exemplo) e compartilha tela ao mesmo tempo, porque é a única forma de '
         + 'deixar os dois de fora.';
  }
  const app = aplicativosDoAgente.find(a => a.executavel === appEscolhido);
  if (!app || app.padrao) {
    return `${origem} todo o áudio do SEU sistema, exceto o do navegador — sem eco, e sem precisar `
         + 'marcar nada na janela do Chrome.';
  }
  return `${origem} todo o áudio do SEU sistema, exceto o de ${app.nome}. `
       + 'Como o navegador entra na captura, use assim só enquanto a conversa por voz for por fora: '
       + 'falando por aqui, sua própria sala volta como eco.';
}

function atualizarExplicacaoDeAudio() {
  const plano = planoDeAudio();
  const textos = {
    nenhum: 'A tela será compartilhada sem áudio.',
    aba: 'O áudio da aba escolhida será transmitido. Marque "Compartilhar áudio da guia" na janela do navegador. Como é o áudio só daquela aba, não existe risco de eco.',
    'janela-navegador': 'Escolha uma janela. Somente o áudio dessa janela será solicitado, quando o navegador oferecer essa opção. Caso contrário, será transmitida sem áudio. Nunca incluímos o áudio do sistema nesse modo.',
    agente: textoDaCaptura('agente'),
    helper: textoDaCaptura('helper'),
    'navegador-sistema': 'O áudio do SEU computador será capturado pelo navegador. Marque "Compartilhar áudio do sistema" na janela que abrir — sem isso o Chrome não envia áudio nenhum.'
  };
  echoHint.textContent = textos[plano];
  if (captureMode.value === 'window' && aplicativoNativo && audioPolicy.value !== 'none') {
    echoHint.textContent = 'O áudio do programa será escolhido automaticamente junto com a janela. Outras janelas ou abas que pertencem ao mesmo processo também podem ser ouvidas. O áudio desta aplicação fica fora.';
  }
  if (aplicativoNativo && plano === 'nenhum' && audioPolicy.value !== 'none') echoHint.textContent = 'Agente de áudio indisponível. A imagem será compartilhada sem som; reinicie o aplicativo atualizado para usar o áudio automático.';
  atualizarCaixaDoAgente(plano);

  // A escolha do programa vale nos dois caminhos de captura nativa: pelo agente (no PC de
  // cada participante) e pelo helper (quando a sala esta aberta na propria maquina do
  // servidor). Antes o seletor morava dentro da caixa do agente e sumia no modo local, o
  // que fazia parecer que era preciso baixar o agente sem necessidade.
  const capturaNativa = plano === 'agente' || plano === 'helper';
  excluirAppCampo.hidden = !capturaNativa || captureMode.value === 'window';
  if (capturaNativa && !aplicativosDoAgente.length) pedirAplicativos();

  const riscoDeEco = plano === 'navegador-sistema';
  echoWarning.hidden = !riscoDeEco;
  if (riscoDeEco) {
    const explicacoes = {
      'helper-ausente': 'O helper nativo não está compilado neste computador, então não dá para remover o áudio desta chamada da captura: a voz dos outros participantes pode voltar como eco. Rode "npm start" (que compila o helper) ou compartilhe uma aba.',
      'atras-de-proxy': 'Esta sala foi aberta por um endereço público/túnel, então a captura nativa fica desativada — ela roda na máquina do servidor e enviaria o áudio do computador do host, não o seu. Seu áudio do sistema será capturado pelo navegador; a voz dos outros participantes pode voltar como eco. Se você É quem hospeda, abra a sala por ' + (audioCapabilities.urlLocal || 'http://localhost:3000') + ' neste computador para liberar a captura nativa.',
      remoto: 'Você não está no computador que executa o servidor, então a captura nativa não vale aqui (ela pegaria o áudio do host). O navegador vai capturar o áudio do SEU computador normalmente, mas a voz dos outros participantes pode voltar como eco.'
    };
    echoWarningText.textContent = explicacoes[audioCapabilities.motivo] || explicacoes.remoto;
  }
}

// Mostra o estado do agente e, quando ele nao esta rodando, oferece o download ja
// configurado com a URL desta sala e com o token deste navegador.
function atualizarCaixaDoAgente(plano) {
  const relevante = plano !== 'nenhum' && plano !== 'aba' && plano !== 'janela-navegador';
  // O agente e um .exe: nao faz sentido oferece-lo a quem esta no Linux, no Mac ou no
  // celular. Sem o agente, essas pessoas usam o audio pelo proprio navegador.
  agenteBox.hidden = !relevante || !audioCapabilities.agenteDisponivel || !ehWindows;
  if (agenteBox.hidden) return;

  const conectado = Boolean(audioCapabilities.agenteConectado);
  agenteBolinha.classList.toggle('ligado', conectado);
  agenteTitulo.textContent = conectado ? 'Agente de áudio conectado' : 'Agente de áudio não encontrado';
  const excluindoOutro = modoDeAudio !== 'excluir'
    || aplicativosDoAgente.some(a => a.executavel === appEscolhido && !a.padrao);
  agenteTexto.textContent = conectado
    ? (excluindoOutro
      ? 'O som do seu computador vai junto com a tela, sem o programa escolhido abaixo.'
      : 'O som do seu computador vai junto com a tela, sem eco e sem depender da caixa de áudio do navegador.')
    : 'Baixe e execute o agente neste computador para transmitir o som do SEU sistema sem eco. É um único arquivo, sem instalação: baixe, dê um duplo clique e deixe a janelinha aberta. Se o antivírus bloquear ou apagar o arquivo, é alarme falso: escolha "Manter" na lista de downloads do navegador.';
  // Dentro do aplicativo o agente vem junto: oferecer o download seria mandar a pessoa
  // resolver a mao um problema que o proprio aplicativo ja resolve.
  agenteDownload.hidden = conectado || Boolean(aplicativoNativo);
  agenteDownload.href = `/api/agente?token=${encodeURIComponent(tokenDoAgente)}`;
  if (!conectado && aplicativoNativo) {
    agenteTexto.textContent = 'O aplicativo está subindo o agente de áudio. Se esta mensagem '
      + 'não sair em alguns segundos, o AgenteAudio.exe não foi encontrado ao lado do aplicativo.';
  }
}

// ---------- O que do som do sistema vai para a transmissao ----------
// A API do Windows captura com UM alvo: ou tudo menos uma arvore de processos, ou somente
// ela. Nao da para somar duas exclusoes -- misturar audio e uniao, nao intersecao -- entao
// quem precisa deixar DOIS programas de fora (a voz no Discord e o navegador que toca a
// sala) so tem uma saida: dizer o que ENTRA.
//
//   excluir      tudo, menos um programa. Padrao: o navegador desta pessoa, que evita o eco.
//   incluir      somente um programa. E o modo de quem conversa por fora e compartilha tela.
//   excluir-pid  tudo, menos o aplicativo proprio. So existe rodando pelo aplicativo, que
//                manda o proprio PID -- e a exclusao que nao depende de acertar nome nenhum.
let aplicativosDoAgente = [];
let appEscolhido = '';
let modoDeAudio = 'excluir';
let agenteSemModo = false;   // agente antigo, que nao entende a escolha de modo
let timerDeAplicativos = null;
let audioDaJanela = null;

// Quando a pagina roda dentro do aplicativo proprio, ele se apresenta com o proprio PID.
//
// O nome da constante NAO pode ser "appNativo": o aplicativo publica esse nome no window
// como propriedade nao-configuravel, e um `const` de mesmo nome no escopo global e um
// SyntaxError -- que derruba o SCRIPT INTEIRO, nao so esta linha. No navegador comum nada
// disso existe e o erro nao aparece; dentro do aplicativo, a sala parava de funcionar por
// completo, sem socket e sem nenhum botao respondendo.
const aplicativoNativo = (typeof window !== 'undefined' && window.appNativo) || null;
if (aplicativoNativo) {
  captureMode.querySelector('option[value="browser"]').remove();
  captureMode.value = 'window';
  fixEchoBtn.hidden = true;
  document.getElementById('captureCompatibility').hidden = false;
}
if (aplicativoNativo?.pid) {
  modoDeAudio = 'excluir-pid';
  modoDeAudioSelect.querySelector('option[value="excluir-pid"]').hidden = false;
}
modoDeAudioSelect.value = modoDeAudio;

// Pelo aplicativo ninguem baixa nem executa nada a parte: ele mesmo levanta o agente,
// apontando para esta sala. O agente e o mesmo binario de sempre.
async function ligarAgenteDoAplicativo() {
  if (!aplicativoNativo?.iniciarAgente) return;
  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocolo}://${location.host}/agente?token=${encodeURIComponent(tokenDoAgente)}`;
  try {
    const resposta = await aplicativoNativo.iniciarAgente(url);
    if (!resposta?.rodando && resposta?.motivo === 'nao-encontrado') {
      status.textContent = 'O aplicativo não encontrou o AgenteAudio.exe ao lado dele, '
        + 'então o som do sistema não será capturado.';
    }
  } catch (_) { /* sem agente: a sala continua funcionando, so sem som do sistema */ }
}

function enviarEscolhaDeAudio() {
  if (audioDaJanela) {
    socket?.emit('audio-escolha', { modo: 'incluir-pid', executavel: '', pid: audioDaJanela.pid, familia: familiaDoNavegador() });
    return;
  }
  socket?.emit('audio-escolha', {
    modo: modoDeAudio,
    executavel: modoDeAudio === 'excluir-pid' ? '' : appEscolhido,
    pid: aplicativoNativo?.pid || 0,
    familia: familiaDoNavegador()
  });
}

function pedirAplicativos() {
  const plano = planoDeAudio();
  if (plano !== 'agente' && plano !== 'helper') return;
  socket.emit('agente-aplicativos', familiaDoNavegador());
}

function desenharAplicativos() {
  // No modo "menos este aplicativo" nao ha nada a escolher: o alvo e o proprio aplicativo.
  const precisaEscolher = modoDeAudio !== 'excluir-pid';
  excluirApp.hidden = !precisaEscolher;
  excluirAppRotulo.hidden = !precisaEscolher;
  excluirAppRotulo.textContent = modoDeAudio === 'incluir'
    ? 'Programa cujo som SERÁ transmitido'
    : 'Programa que NÃO será transmitido';
  if (!precisaEscolher) {
    excluirAppDica.textContent = 'O som deste aplicativo fica fora da captura, então a voz e as '
      + 'telas dos outros não voltam como eco. Todo o resto do computador vai junto — inclusive o navegador.';
    return;
  }

  const anterior = excluirApp.value;
  excluirApp.innerHTML = '';

  // Lista vazia nao pode virar um seletor mudo. Ou nada tem audio, ou -- bem mais provavel
  // -- o agente que esta rodando e de uma versao anterior a este recurso e simplesmente
  // ignora o pedido da lista.
  if (!aplicativosDoAgente.length) {
    const opcao = document.createElement('option');
    opcao.value = '';
    opcao.textContent = 'Nenhum programa encontrado';
    excluirApp.appendChild(opcao);
    excluirApp.disabled = true;
    excluirAppDica.textContent = audioCapabilities.agenteConectado
      ? 'O agente não respondeu com a lista. Se você o baixou antes desta versão, baixe e execute de novo.'
      : 'Nenhum programa com áudio foi encontrado neste computador.';
    return;
  }

  if (agenteSemModo) {
    excluirAppDica.textContent = 'O agente que está rodando é anterior a este recurso e não obedece '
      + 'a esta escolha. Baixe e execute o agente de novo para que ela valha.';
  }

  excluirApp.disabled = false;
  for (const app of aplicativosDoAgente) {
    const opcao = document.createElement('option');
    opcao.value = app.executavel;
    const marcas = [];
    if (app.padrao) marcas.push('padrão, evita eco');
    if (app.tocando) marcas.push('tocando agora');
    opcao.textContent = app.nome + (marcas.length ? ` — ${marcas.join(', ')}` : '');
    excluirApp.appendChild(opcao);
  }
  const desejado = appEscolhido || anterior;
  if (desejado && aplicativosDoAgente.some(a => a.executavel === desejado)) excluirApp.value = desejado;
}

function nomeDoApp(executavel) {
  const app = aplicativosDoAgente.find(a => a.executavel === executavel);
  return app ? app.nome : executavel;
}

modoDeAudioSelect.onchange = () => {
  modoDeAudio = modoDeAudioSelect.value;
  // Trocar para "somente" sem alvo mandaria silencio: adota o que estiver selecionado.
  if (modoDeAudio === 'incluir' && !appEscolhido) appEscolhido = excluirApp.value || '';
  enviarEscolhaDeAudio();
  desenharAplicativos();
  atualizarExplicacaoDeAudio();
  avaliarRiscoDeEco();
};

excluirApp.onchange = () => {
  appEscolhido = excluirApp.value;
  enviarEscolhaDeAudio();
  const nome = nomeDoApp(appEscolhido);
  const app = aplicativosDoAgente.find(a => a.executavel === appEscolhido);
  if (modoDeAudio === 'incluir') {
    excluirAppDica.textContent = `Só o som de ${nome} vai para a sala. Nada mais do computador é transmitido — nem a voz de outro aplicativo, nem esta página.`;
    status.textContent = `Somente o som de ${nome} será transmitido.`;
  } else {
    excluirAppDica.textContent = app && !app.padrao
      ? `O som de ${nome} fica fora da transmissão. Vale na hora — mas o navegador passa a entrar, então evite conversar por voz aqui enquanto isso.`
      : `O som de ${nome} fica fora da transmissão. Vale na hora.`;
    status.textContent = `O som de ${nome} não será transmitido.`;
  }
  atualizarExplicacaoDeAudio();
  avaliarRiscoDeEco();
};

// ---------- Aviso de eco entre telas ----------
// Cenario que so aparece com gente demais compartilhando: se o meu navegador entra na
// captura (porque quem esta excluido e outro programa) e ele esta tocando a tela de outra
// pessoa, eu devolvo o som dela para a sala. Com duas pessoas compartilhando som de tela ao
// mesmo tempo, o eco e certo -- entao vale dizer antes, e nao depois de todo mundo ouvir.
function avaliarRiscoDeEco() {
  const plano = planoDeAudio();
  const capturaNativa = plano === 'agente' || plano === 'helper';
  const navegadorNaCaptura = capturaNativa && modoDeAudio === 'excluir'
    && aplicativosDoAgente.some(a => a.executavel === appEscolhido && !a.padrao);

  const euMando = Boolean(meuEstado().screenAudio);
  const outrosQueMandam = [];
  peers.forEach((peer, id) => { if (peer.state?.screenAudio) outrosQueMandam.push(nomeDe(id)); });

  const emRisco = navegadorNaCaptura && euMando && outrosQueMandam.length > 0;
  avisoDeEco.classList.toggle('hidden', !emRisco);
  if (!emRisco) return;
  avisoDeEco.textContent = `Eco à vista: o som da sua tela inclui este navegador, que está tocando a tela de `
    + `${outrosQueMandam.join(', ')}. O som deles volta para a sala pela sua transmissão. `
    + `Para resolver, troque o modo para "Somente um programa" e escolha o que você quer transmitir.`;
}

// Enquanto o painel esta aberto a lista se mantem viva: um programa que comeca a tocar
// agora aparece sozinho, sem precisar fechar e abrir.
function acompanharAplicativos(ligar) {
  clearInterval(timerDeAplicativos);
  timerDeAplicativos = null;
  if (!ligar) return;
  pedirAplicativos();
  timerDeAplicativos = setInterval(pedirAplicativos, 3000);
}

captureMode.onchange = atualizarExplicacaoDeAudio;
audioPolicy.onchange = atualizarExplicacaoDeAudio;

fixEchoBtn.onclick = () => {
  captureMode.value = 'browser';
  atualizarExplicacaoDeAudio();
};

let wsAgenteLocal = null;
// Distingue a primeira conexao da reconexao automatica do Socket.IO.
let sessaoIniciada = false;

// O PCM chega por dois caminhos possíveis e é tratado igual nos dois: pelo WebSocket
// local do agente (curto) ou pelo servidor da sala (reserva).
function receberPcm(data) {
  if (!appAudioNode) return;
  const incoming = new Uint8Array(data);
  const combined = new Uint8Array(pendingPcm.length + incoming.length);
  combined.set(pendingPcm);
  combined.set(incoming, pendingPcm.length);
  const usableLength = combined.length - (combined.length % 4);
  if (usableLength) {
    const pcm = combined.slice(0, usableLength).buffer;
    appAudioNode.port.postMessage(pcm, [pcm]);
  }
  pendingPcm = combined.slice(usableLength);
}

// Conecta direto ao agente que roda NESTE computador, cortando a volta pela internet: sem
// isso o som sai daqui, vai até o servidor da sala e retorna para esta mesma máquina.
//
// Se não der certo (agente antigo, porta ocupada, navegador que bloqueie loopback), não há
// prejuízo: o agente continua enviando pelo servidor e o áudio funciona igual, só com mais
// atraso. Por isso nada aqui interrompe a transmissão em caso de falha.
function conectarAgenteLocal() {
  const porta = audioCapabilities.portaLocalDoAgente;
  if (!porta || wsAgenteLocal) return;
  let ws;
  try { ws = new WebSocket(`ws://127.0.0.1:${porta}/?token=${encodeURIComponent(tokenDoAgente)}`); }
  catch (_) { return; }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsAgenteLocal = ws; console.info('Áudio do sistema vindo direto do agente, sem passar pelo servidor.'); };
  ws.onmessage = (event) => receberPcm(event.data);
  ws.onclose = () => { if (wsAgenteLocal === ws) wsAgenteLocal = null; };
  ws.onerror = () => { if (wsAgenteLocal === ws) wsAgenteLocal = null; };
}

function fecharAgenteLocal() {
  if (!wsAgenteLocal) return;
  try { wsAgenteLocal.close(); } catch (_) { /* já estava fechado */ }
  wsAgenteLocal = null;
}

// O PCM chega pelo evento 'audio-data' (do agente local ou do helper do servidor) e vira
// uma faixa de audio comum, que entra na transmissao WebRTC como qualquer outra.
async function iniciarAudioDoSistema(targetStream, origem) {
  // latencyHint 'interactive' pede o menor buffer possivel de saida.
  appAudioContext = new AudioContextClass({ sampleRate: 44100, latencyHint: 'interactive' });
  const workletCode = `
    class PcmPlayer extends AudioWorkletProcessor {
      constructor() {
        super();
        this.blocos = [];
        this.offset = 0;    // posicao dentro de blocos[0], em amostras
        this.total = 0;     // soma do tamanho de todos os blocos da fila
        // Este audio ja chega atrasado: ele sai do PC de quem compartilha, vai ate o
        // servidor e volta. Guardar mais um tanto aqui so aumentaria o atraso, entao o
        // alvo e curto e o teto e rigido.
        this.alvo = Math.round(sampleRate * 0.04) * 2;
        this.teto = Math.round(sampleRate * 0.12) * 2;
        this.port.onmessage = event => {
          const bloco = new Int16Array(event.data);
          if (!bloco.length) return;
          this.blocos.push(bloco);
          this.total += bloco.length;
          this.descartarExcesso();
        };
      }

      // Sem isto a fila so cresce. Qualquer engasgo da rede (ou a diferenca minima entre o
      // relogio da placa de som e o do navegador) vira atraso PERMANENTE, porque tudo que
      // entrou na fila precisa ser tocado em tempo real. Preferimos um pulo curto agora a
      // carregar o atraso para o resto da transmissao.
      descartarExcesso() {
        if (this.total - this.offset <= this.teto) return;
        while (this.blocos.length > 1 && this.total - this.offset > this.alvo) {
          this.total -= this.blocos.shift().length;
          this.offset = 0;
        }
        const sobra = this.total - this.offset - this.alvo;
        if (sobra > 0) this.offset += sobra - (sobra % 2);  // par: nao trocar os canais
      }

      process(inputs, outputs) {
        const left = outputs[0][0];
        const right = outputs[0][1] || left;
        for (let i = 0; i < left.length; i++) {
          while (this.blocos.length && this.offset + 1 >= this.blocos[0].length) {
            this.total -= this.blocos.shift().length;
            this.offset = 0;
          }
          const bloco = this.blocos[0];
          if (!bloco) { left[i] = 0; right[i] = 0; continue; }
          left[i] = bloco[this.offset++] / 32768;
          right[i] = bloco[this.offset++] / 32768;
        }
        return true;
      }
    }
    registerProcessor('pcm-player', PcmPlayer);
  `;
  const moduleUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
  await appAudioContext.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  appAudioNode = new AudioWorkletNode(appAudioContext, 'pcm-player', { outputChannelCount: [2] });
  const destination = appAudioContext.createMediaStreamDestination();
  appAudioNode.connect(destination);
  appAudioTrack = destination.stream.getAudioTracks()[0];
  targetStream.addTrack(appAudioTrack);
  await appAudioContext.resume();
  if (origem === 'agente') conectarAgenteLocal();
  socket.emit('audio-start', { origem, familia: familiaDoNavegador(), version: audioCaptureVersion });
}

async function limparAudioDoAplicativo() {
  audioDaJanela = null;
  audioCaptureVersion += 1;
  fecharAgenteLocal();
  socket?.emit('audio-stop');
  if (appAudioTrack) appAudioTrack.stop();
  if (appAudioContext) await appAudioContext.close();
  appAudioTrack = null;
  appAudioContext = null;
  appAudioNode = null;
  pendingPcm = new Uint8Array(0);
}

async function capturarTela() {
  const plano = planoDeAudio();
  const tipoPedido = captureMode.value;
  if (aplicativoNativo && (!aplicativoNativo.prepararCaptura || !await aplicativoNativo.prepararCaptura(tipoPedido))) {
    throw new Error('Atualize o aplicativo para usar o seletor de janelas e telas.');
  }
  // Com o agente/helper o audio vem do sistema (fora do navegador), entao aqui pedimos
  // video sem audio para nao capturar a mesma coisa duas vezes.
  const audioPeloNavegador = ['aba', 'navegador-sistema', 'janela-navegador'].includes(plano);

  // As chaves fora de "video"/"audio" (systemAudio, selfBrowserSurface...) so existem no
  // Chrome/Edge. Firefox e Safari as ignoram, o que e o comportamento desejado.
  const restricoes = {
    video: {
      displaySurface: captureMode.value,
      cursor: 'always',
      width: { ideal: perfilAtual().width, max: perfilAtual().width },
      height: { ideal: perfilAtual().height, max: perfilAtual().height },
      frameRate: { ideal: PRIORIDADES_DE_TELA[prioridadeDaTela].fps, max: PRIORIDADES_DE_TELA[prioridadeDaTela].fps }
    },
    audio: audioPeloNavegador ? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      sampleSize: 16,
      channelCount: 2,
      restrictOwnAudio: true
    } : false,
    systemAudio: plano === 'navegador-sistema' ? 'include' : 'exclude',
    windowAudio: captureMode.value === 'window' ? 'window' : 'exclude',
    selfBrowserSurface: 'exclude',
    monitorTypeSurfaces: tipoPedido === 'monitor' ? 'include' : 'exclude',
    surfaceSwitching: 'exclude'
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(restricoes);
  } catch (err) {
    // Firefox e Safari nao capturam audio de tela e podem recusar o pedido inteiro por
    // causa dele. Melhor compartilhar so o video do que nao compartilhar nada.
    if (!audioPeloNavegador || !['TypeError', 'NotSupportedError', 'OverconstrainedError'].includes(err?.name)) throw err;
    restricoes.audio = false;
    stream = await navigator.mediaDevices.getDisplayMedia(restricoes);
    status.textContent = 'Tela compartilhada sem áudio: este navegador não captura som da tela.';
  }
  const tipoReal = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if (!aplicativoNativo && tipoReal && tipoReal !== tipoPedido) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('A fonte escolhida não corresponde ao tipo solicitado. Escolha uma ' + (tipoPedido === 'browser' ? 'aba do navegador.' : tipoPedido === 'window' ? 'janela.' : 'tela inteira.'));
  }
  let selecionada = null;
  if (aplicativoNativo && tipoPedido === 'window') {
    try { selecionada = await aplicativoNativo.capturaSelecionada(); }
    catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  }
  // A dica segue a prioridade escolhida: uma tela nova nao pode desfazer a escolha.
  stream.getVideoTracks().forEach(track => {
    track.contentHint = PRIORIDADES_DE_TELA[prioridadeDaTela].pista || '';
  });

  try {
    await limparAudioDoAplicativo();
    if (plano === 'agente' || plano === 'helper') {
      if (tipoPedido === 'window' && aplicativoNativo) {
        if (selecionada?.tipo === 'window' && selecionada.pid > 0) {
          audioDaJanela = selecionada;
          // An older agent must acknowledge the exact mode before recording. Never
          // fall back to its default system-wide capture when inclusion is unsupported.
          const confirmado = await new Promise(resolve => {
            const finalizar = ok => { clearTimeout(timer); socket.off('agente-aplicativos', receber); resolve(ok); };
            const receber = data => { if (data.modo === 'incluir-pid') finalizar(true); };
            const timer = setTimeout(() => finalizar(false), 2500);
            socket.on('agente-aplicativos', receber);
            enviarEscolhaDeAudio();
          });
          if (confirmado) await iniciarAudioDoSistema(stream, 'agente');
          else { audioDaJanela = null; stream.nexoAudioAviso = 'Janela compartilhada sem som: atualize o agente de áudio para esta versão.'; }
        } else stream.nexoAudioAviso = 'Janela compartilhada sem som: não foi possível identificar o processo de áudio, ou a janela pertence a esta aplicação.';
      } else {
        enviarEscolhaDeAudio();
        await iniciarAudioDoSistema(stream, plano === 'agente' ? 'agente' : 'local');
      }
    }
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await limparAudioDoAplicativo().catch(() => {});
    throw error;
  }
  return stream;
}

confirmScreenBtn.onclick = async () => {
  confirmScreenBtn.disabled = true;
  try {
    const plano = planoDeAudio();
    const novaTela = await capturarTela();
    const telaAntiga = screenStream;
    screenStream = novaTela;
    screenStream.getVideoTracks()[0].onended = pararTela;
    // Entra na mesma fila das telas dos outros: quem comecou antes fica mais a esquerda.
    // Trocar a fonte da tela nao renova o lugar -- a transmissao e a mesma.
    if (!telaAntiga) ordemDaMinhaTela = ++sequenciaDeCompartilhamento;

    definirFaixaEmTodosOsPares('screen', screenStream.getVideoTracks()[0], screenStream);
    definirFaixaEmTodosOsPares('screenAudio', screenStream.getAudioTracks()[0] || null, screenStream);

    if (telaAntiga) telaAntiga.getTracks().forEach(t => t.stop());
    fecharPainelDeTela();
    screenBtn.textContent = 'Parar tela';
    screenBtn.setAttribute('aria-pressed', 'true');
    updateScreenBtn.hidden = false;
    atualizarTile('self');
    avaliarDestaque();

    // Diz exatamente que audio esta indo junto. Esquecer de marcar a caixa de audio no
    // seletor do Chrome e o motivo mais comum de "compartilhei mas nao sai som".
    const temAudio = screenStream.getAudioTracks().length > 0;
    if (novaTela.nexoAudioAviso) status.textContent = novaTela.nexoAudioAviso;
    else if (plano === 'nenhum') status.textContent = 'Compartilhando tela (sem áudio).';
    else if (!temAudio) {
      status.textContent = (plano === 'agente' || plano === 'helper')
        ? 'Compartilhando tela, mas a captura nativa de áudio não iniciou. Veja o aviso acima.'
        : 'Compartilhando sem áudio: o navegador não ofereceu som para essa fonte ou a opção não foi marcada. Para som de uma aba, escolha "Aba do navegador" e marque compartilhar áudio.';
    }
    else if (audioDaJanela) status.textContent = `Compartilhando janela + áudio do programa ${audioDaJanela.nome}.`;
    else if (plano === 'agente') status.textContent = 'Compartilhando tela + áudio conforme a seleção do sistema.';
    else if (plano === 'helper') status.textContent = 'Compartilhando tela + áudio deste computador (exceto o navegador).';
    else if (plano === 'aba') status.textContent = 'Compartilhando tela + áudio da aba.';
    else if (plano === 'janela-navegador') status.textContent = 'Compartilhando janela + áudio fornecido pelo navegador.';
    else status.textContent = 'Compartilhando tela + áudio do seu sistema.';
    enviarEstado();
  } catch (err) {
    status.textContent = 'Não foi possível compartilhar a tela: ' + err.message;
  } finally {
    confirmScreenBtn.disabled = false;
  }
};
cancelScreenBtn.onclick = fecharPainelDeTela;

function pararTela() {
  if (!screenStream) return;
  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;
  ordemDaMinhaTela = 0;
  limparAudioDoAplicativo();
  definirFaixaEmTodosOsPares('screen', null, null);
  definirFaixaEmTodosOsPares('screenAudio', null, null);
  screenBtn.textContent = 'Compartilhar tela';
  screenBtn.setAttribute('aria-pressed', 'false');
  updateScreenBtn.hidden = true;
  atualizarTile('self');
  if (pinned?.id === 'self' && pinned.source === 'screen') { pinned = null; destaqueManual = false; }
  avaliarDestaque();
  status.textContent = 'Compartilhamento de tela encerrado.';
  enviarEstado();
}

// Celulares (iOS e Android) nao implementam getDisplayMedia: em vez de deixar o botao
// falhar no clique, ele fica desativado com o motivo à vista. Câmera e microfone
// continuam funcionando normalmente nesses aparelhos.
if (!suportaCompartilharTela) {
  screenBtn.disabled = true;
  screenBtn.title = 'Este navegador não permite compartilhar tela (comum em celulares).';
  screenBtn.textContent = 'Tela indisponível';
}

screenBtn.onclick = () => {
  if (!suportaCompartilharTela) {
    status.textContent = 'Compartilhar tela não é possível neste navegador. Use um computador para isso.';
    return;
  }
  if (screenStream) pararTela();
  else abrirPainelDeTela('start');
};
updateScreenBtn.onclick = () => abrirPainelDeTela('update');

// ---------- Teste de áudio ----------
testAudioBtn.onclick = async () => {
  testAudioContext ||= new AudioContextClass();
  await testAudioContext.resume();
  const oscillator = testAudioContext.createOscillator();
  const gain = testAudioContext.createGain();
  const now = testAudioContext.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  oscillator.connect(gain).connect(testAudioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.2);
  status.textContent = 'Beep de teste reproduzido.';
};

// ---------- Zoom e tela cheia do palco ----------
function aplicarTransformDoPalco() {
  stageVideo.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

// Tamanho que a imagem realmente ocupa no palco depois do encaixe por "contain".
// Em video vertical isso e bem mais estreito que o palco, e as barras dos lados nao sao
// conteudo: arrastar ate elas so jogaria a imagem para fora da vista.
function areaDaImagem() {
  const rect = stage.getBoundingClientRect();
  const largura = stageVideo.videoWidth;
  const altura = stageVideo.videoHeight;
  if (!largura || !altura) return { rect, largura: rect.width, altura: rect.height };
  const escala = Math.min(rect.width / largura, rect.height / altura);
  return { rect, largura: largura * escala, altura: altura * escala };
}

function limitarPan() {
  const { rect, largura, altura } = areaDaImagem();
  const maxX = Math.max(0, (largura * zoomLevel - rect.width) / 2);
  const maxY = Math.max(0, (altura * zoomLevel - rect.height) / 2);
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function definirZoom(novoNivel, ponto) {
  const anterior = zoomLevel;
  zoomLevel = Math.round(Math.max(1, Math.min(3, novoNivel)) * 100) / 100;
  if (ponto) {
    const rect = stage.getBoundingClientRect();
    const x = ponto.x - rect.left - rect.width / 2;
    const y = ponto.y - rect.top - rect.height / 2;
    panX = x - (x - panX) * zoomLevel / anterior;
    panY = y - (y - panY) * zoomLevel / anterior;
  }
  if (zoomLevel === 1) { panX = 0; panY = 0; }
  limitarPan();
  aplicarTransformDoPalco();
  zoomLevelLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
  zoomOutBtn.disabled = zoomLevel <= 1;
  zoomInBtn.disabled = zoomLevel >= 3;
}

zoomInBtn.onclick = () => definirZoom(zoomLevel + 0.25);
zoomOutBtn.onclick = () => definirZoom(zoomLevel - 0.25);

stageVideo.addEventListener('wheel', event => {
  if (event.ctrlKey || !stageVideo.videoWidth || !event.deltaY) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
  definirZoom(zoomLevel * Math.exp(-Math.max(-125, Math.min(125, delta)) * 0.002),
    { x: event.clientX, y: event.clientY });
}, { passive: false });

const theaterBtn = document.getElementById('theaterBtn');
function definirModoTeatro(ativo) {
  document.querySelector('.app').classList.toggle('teatro', ativo);
  theaterBtn.setAttribute('aria-pressed', String(ativo));
  theaterBtn.title = ativo ? 'Sair do modo teatro' : 'Modo teatro';
  theaterBtn.setAttribute('aria-label', ativo ? 'Sair do modo teatro' : 'Ativar modo teatro');
  requestAnimationFrame(() => { limitarPan(); aplicarTransformDoPalco(); });
}
theaterBtn.onclick = () => definirModoTeatro(!document.querySelector('.app').classList.contains('teatro'));

stageVideo.addEventListener('pointerdown', event => {
  if (zoomLevel <= 1) return;
  arrastandoPalco = { x: event.clientX - panX, y: event.clientY - panY };
  stageVideo.setPointerCapture(event.pointerId);
});
stageVideo.addEventListener('pointermove', event => {
  if (!arrastandoPalco) return;
  panX = event.clientX - arrastandoPalco.x;
  panY = event.clientY - arrastandoPalco.y;
  limitarPan();
  aplicarTransformDoPalco();
});
stageVideo.addEventListener('pointerup', () => { arrastandoPalco = null; });
// Dispara quando a fonte muda de tamanho (celular girando, tela trocada). O encaixe em si
// e do CSS, mas o limite do arrasto depende do novo aspect.
stageVideo.addEventListener('resize', () => { limitarPan(); aplicarTransformDoPalco(); });
// Girar o celular ou redimensionar a janela muda o palco, e com ele o limite do arrasto.
window.addEventListener('resize', () => { limitarPan(); aplicarTransformDoPalco(); });
stageVideo.addEventListener('dblclick', () => alternarTelaCheia());

function alternarTelaCheia() {
  const emTelaCheia = document.fullscreenElement || document.webkitFullscreenElement;
  if (!emTelaCheia) {
    const pedir = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (pedir) { pedir.call(stage); return; }
    // iPhone nao deixa um <div> entrar em tela cheia; so o proprio <video> consegue.
    if (window.RoomMulti?.active) { definirModoTeatro(true); return; }
    if (stageVideo.webkitEnterFullscreen) stageVideo.webkitEnterFullscreen();
    return;
  }
  (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
}
if (!suportaTelaCheia && !stageVideo.webkitEnterFullscreen) fullscreenBtn.hidden = true;
fullscreenBtn.onclick = () => alternarTelaCheia();
function aoMudarTelaCheia() {
  const cheio = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  fullscreenBtn.textContent = cheio ? '⛝' : '⛶';
  fullscreenBtn.title = cheio ? 'Sair da tela cheia' : 'Tela cheia';
  limitarPan();
  aplicarTransformDoPalco();
}
document.addEventListener('fullscreenchange', aoMudarTelaCheia);
document.addEventListener('webkitfullscreenchange', aoMudarTelaCheia);

// ---------- Rotulo e controles que somem sozinhos ----------
const SEGUNDOS_ATE_SUMIR = 2.5;
let timerDoPalco = null;
let tecladoNoPalco = false;

function mostrarControlesDoPalco() {
  stage.classList.remove('ocioso');
  clearTimeout(timerDoPalco);
  if (tecladoNoPalco && stageControls.contains(document.activeElement)) return;
  timerDoPalco = setTimeout(() => stage.classList.add('ocioso'), SEGUNDOS_ATE_SUMIR * 1000);
}

['pointermove', 'pointerdown', 'wheel'].forEach(evento =>
  stage.addEventListener(evento, mostrarControlesDoPalco, { passive: true }));

// Tirar o mouse do palco esconde na hora. Num toque nao existe "sair": quem cuida e o tempo.
stage.addEventListener('pointerleave', (ev) => {
  if (ev.pointerType !== 'touch') { clearTimeout(timerDoPalco); stage.classList.add('ocioso'); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    tecladoNoPalco = true;
    stage.classList.add('controles-teclado');
    mostrarControlesDoPalco();
  }
});
['pointerdown', 'pointermove'].forEach(evento => stage.addEventListener(evento, () => {
  tecladoNoPalco = false;
  stage.classList.remove('controles-teclado');
  mostrarControlesDoPalco();
}, { passive: true }));
stageControls.addEventListener('focusin', mostrarControlesDoPalco);
stageControls.addEventListener('focusout', () => setTimeout(mostrarControlesDoPalco, 0));
stageVideo.addEventListener('playing', mostrarControlesDoPalco);
mostrarControlesDoPalco();
// Entrar e sair da tela cheia e movimento suficiente para mostrar o que ha ali.
document.addEventListener('fullscreenchange', mostrarControlesDoPalco);
document.addEventListener('webkitfullscreenchange', mostrarControlesDoPalco);

// ---------- Sair ----------
let saindoDaSala = false;
function encerrarMidiasDaSala() {
  micStream?.getTracks().forEach(t => t.stop());
  cameraStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  desmontarFiltroDeRuido();
  Array.from(peers.keys()).forEach(removerPar);
  // Sem isto o servidor de midia so notaria a saida pelo tempo limite, e por alguns
  // segundos os outros continuariam vendo uma imagem congelada de quem ja foi embora.
  transporte?.desconectar();
  limparAudioDoAplicativo().catch(() => {});
}
async function sairDaSala() {
  if (saindoDaSala) return;
  saindoDaSala = true;
  encerrarMidiasDaSala();
  if (socket?.connected) {
    await new Promise(resolve => socket.timeout(900).emit('leave-room', () => resolve()));
  }
  socket?.disconnect();
  window.location.assign('/');
}
leaveBtn.onclick = sairDaSala;
document.querySelectorAll('a[href="/"]').forEach(link => link.addEventListener('click', event => {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  sairDaSala();
}));

// ---------- Link ----------
copyLinkBtn.onclick = async () => {
  const link = RoomMedia.inviteUrl(window.location.href, publicInviteUrl, roomCode);
  try {
    await navigator.clipboard.writeText(link);
    copyLinkBtn.textContent = 'Link copiado!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copiar link'; }, 1800);
  } catch (_) {
    document.getElementById('inviteLink').value = link;
    document.getElementById('invitePanel').classList.remove('hidden');
    document.getElementById('inviteLink').select();
  }
};

// ---------- Tiles (UI de participantes) ----------
function criarTileLocal() {
  criarTileBase('self', myName, meuEstado(), true);
}

function criarTile(id, name, state) {
  if (tiles.has(id)) return;
  criarTileBase(id, name, state, false);
}

function criarTileBase(id, name, state, isSelf) {
  if (tiles.has(id)) return;   // reconexao nao pode criar um segundo quadradinho
  const el = document.createElement('div');
  el.className = 'participant';
  el.dataset.id = id;
  el.dataset.source = 'camera';
  el.innerHTML = `
    <div class="avatar-wrap">
      <video class="cam-video" autoplay playsinline muted></video>
      <div class="avatar-fallback"></div>
      <span class="mic-icon audio-icon" aria-hidden="true"></span>
      <span class="screen-badge hidden">Tela</span>
    </div>
    <div class="participant-name"></div>
    <div class="volume-row"></div>
    <audio class="peer-audio" autoplay></audio>
    <audio class="screen-audio" autoplay></audio>
  `;
  el.querySelector('.participant-name').textContent = `${name}${isSelf ? ' (você)' : ''}`;
  el.querySelector('.avatar-fallback').textContent = iniciais(name);
  el.querySelector('.avatar-fallback').style.background = corDoNome(name);
  const volumeRow = el.querySelector('.volume-row');
  if (!isSelf) {
    volumeRow.innerHTML = `
      <input type="range" class="volume-slider" min="0" max="100" value="100">
      <button class="mute-peer-btn" type="button" title="Silenciar a voz deste participante"></button>
    `;
  }
  participantsEl.appendChild(el);

  const refs = {
    root: el,
    camVideo: el.querySelector('.cam-video'),
    avatar: el.querySelector('.avatar-fallback'),
    micIcon: el.querySelector('.mic-icon'),
    screenBadge: el.querySelector('.screen-badge'),
    peerAudio: el.querySelector('.peer-audio'),
    screenAudio: el.querySelector('.screen-audio'),
    volumeSlider: el.querySelector('.volume-slider'),
    muteBtn: el.querySelector('.mute-peer-btn'),
    localMute: false
  };
  tiles.set(id, refs);
  reordenarQuadradinhos();
  // Elemento novo nasce na saida escolhida: sem isto, so quem ja estava na sala sairia
  // pelo fone certo, e quem entrasse depois voltaria para o padrao do sistema.
  aplicarSaidaEm(refs.peerAudio);
  aplicarSaidaEm(refs.screenAudio);

  el.querySelector('.avatar-wrap').addEventListener('click', () => {
    const estado = id === 'self' ? meuEstado() : peers.get(id)?.state;
    // Este quadradinho e o da PESSOA: clicar nele foca a camera dela. A tela tem o proprio
    // quadradinho ao lado -- antes a tela vinha na frente aqui, e quem compartilhava as
    // duas coisas nunca conseguia por a propria camera no centro.
    // Escolha manual: a partir daqui o destaque nao muda sozinho, ate esta fonte acabar.
    if (estado?.camera) pin(id, 'camera', true);
    else if (estado?.screen) pin(id, 'screen', true);
  });

  if (!isSelf) {
    refs.volumeSlider.addEventListener('input', () => {
      // volume de <audio> so aceita 0..1 por especificacao; acima disso o navegador lanca
      // IndexSizeError e o ajuste inteiro se perde.
      const nivel = Math.max(0, Math.min(1, Number(refs.volumeSlider.value) / 100));
      refs.peerAudio.volume = nivel;
      if (pinned?.id === id) stageVideo.volume = nivel;
    });
    refs.muteBtn.addEventListener('click', () => {
      refs.localMute = !refs.localMute;
      refs.peerAudio.muted = refs.localMute;
      refs.muteBtn.setAttribute('aria-pressed', String(refs.localMute));
    });
  }

  atualizarTile(id);
}

function removerTile(id) {
  removerTileDeTela(id);
  // A pessoa saiu da sala: o volume guardado dela nao serve mais para ninguem.
  volumeDaTela.delete(id);
  const refs = tiles.get(id);
  if (!refs) return;
  refs.root.remove();
  tiles.delete(id);
  reordenarQuadradinhos();
}

function ligarMidiaDoTile(id) {
  const refs = tiles.get(id);
  const peer = peers.get(id);
  if (!refs || !peer) return;
  ligarFluxo(refs.camVideo, peer.remoteStreams.camera);
  if (peer.remoteStreams.screen.getTracks().length) atualizarTileDeTela(id);
  if (peer.remoteStreams.micAudio.getTracks().length) {
    if (refs.peerAudio.srcObject !== peer.remoteStreams.micAudio) refs.peerAudio.srcObject = peer.remoteStreams.micAudio;
    acompanharVoz(id, peer.remoteStreams.micAudio);
  } else { refs.peerAudio.srcObject = null; pararDeAcompanhar(id); }
  atualizarTile(id);
  garantirReproducao(refs.peerAudio);
  garantirReproducao(refs.camVideo);
  // A chegada de uma faixa e justamente quando o palco pode finalmente mostrar algo.
  avaliarDestaque();
}

// ---------- Quadradinho da tela ----------
// Como no Discord, quem compartilha a tela ganha um quadradinho SEPARADO. E o que permite
// escolher entre a camera e a tela da mesma pessoa: um clique em cada.
const tilesDeTela = new Map(); // id -> { root, video, nome, slider, muteBtn }

// Volume do som da tela, guardado por participante e nao dentro do quadradinho: o
// quadradinho da tela nasce e morre junto com o compartilhamento, entao um volume guardado
// nele voltaria sozinho para 100 assim que a pessoa parasse e recomecasse a compartilhar.
const volumeDaTela = new Map(); // id -> { nivel, mudo }

function preferenciaDeTela(id) {
  let pref = volumeDaTela.get(id);
  if (!pref) { pref = { nivel: 1, mudo: false }; volumeDaTela.set(id, pref); }
  return pref;
}

// As telas ficam todas juntas, à esquerda, na ordem em que começaram; as pessoas vêm depois,
// cada câmera no quadradinho de quem ela é.
//
// Ordenar por ORDEM DE INÍCIO, e não por nome, tem um motivo prático: quem chega depois entra
// no fim da fila e nada se mexe. Por nome, alguém chamado "Ana" empurraria todas as telas para
// a direita no meio da transmissão, bem quando as pessoas já sabem onde cada uma está.
//
// A reordenação é feita com a propriedade "order" do CSS, não movendo os elementos: tirar um
// <video> do lugar no meio da árvore faz a imagem piscar, e não há por que pagar isso.
const ORDEM_DAS_PESSOAS = 1000;
let ordemDaMinhaTela = 0;

function ordemDaTela(id) {
  if (id === 'self') return ordemDaMinhaTela;
  return peers.get(id)?.ordem?.screen || 0;
}

function reordenarQuadradinhos() {
  const telas = [...tilesDeTela.entries()]
    .sort(([idA], [idB]) => ordemDaTela(idA) - ordemDaTela(idB) || nomeDe(idA).localeCompare(nomeDe(idB), 'pt-BR'));
  telas.forEach(([, refs], posicao) => { refs.root.style.order = posicao; });
  // Uma faixa só: as pessoas ficam depois de qualquer tela, sem precisar recontar nada.
  tiles.forEach(refs => { refs.root.style.order = ORDEM_DAS_PESSOAS; });
}

function nomeDe(id) {
  return id === 'self' ? myName : (peers.get(id)?.name || 'Participante');
}

function garantirTileDeTela(id) {
  if (tilesDeTela.has(id)) return tilesDeTela.get(id);
  const el = document.createElement('div');
  el.className = 'participant participant-tela';
  el.dataset.id = id;
  el.dataset.source = 'screen';
  el.innerHTML = `
    <div class="avatar-wrap">
      <video class="cam-video active" autoplay playsinline muted></video>
      <span class="screen-badge">Tela</span>
    </div>
    <div class="participant-name"></div>
    <div class="volume-row"></div>
  `;
  participantsEl.appendChild(el);

  const refs = {
    root: el, video: el.querySelector('.cam-video'), nome: el.querySelector('.participant-name'),
    linhaDeVolume: el.querySelector('.volume-row'), slider: null, muteBtn: null
  };
  tilesDeTela.set(id, refs);
  reordenarQuadradinhos();

  el.querySelector('.avatar-wrap').addEventListener('click', () => pin(id, 'screen', true));

  // A propria tela nao toca neste computador (seria o som saindo e voltando), entao os
  // controles so fazem sentido para quem esta assistindo.
  if (id !== 'self') {
    const pref = preferenciaDeTela(id);
    refs.linhaDeVolume.innerHTML = `
      <input type="range" class="volume-slider" min="0" max="100" value="${Math.round(pref.nivel * 100)}">
      <button class="mute-peer-btn" type="button" title="Silenciar o som desta tela" aria-pressed="${pref.mudo}"></button>
    `;
    refs.slider = refs.linhaDeVolume.querySelector('.volume-slider');
    refs.muteBtn = refs.linhaDeVolume.querySelector('.mute-peer-btn');

    refs.slider.addEventListener('input', () => {
      // volume de <audio> so aceita 0..1 por especificacao; acima disso o navegador lanca
      // IndexSizeError e o ajuste inteiro se perde.
      pref.nivel = Math.max(0, Math.min(1, Number(refs.slider.value) / 100));
      // Arrastar o volume para cima quer dizer "quero ouvir": tira do mudo sozinho.
      if (pref.mudo && pref.nivel > 0) { pref.mudo = false; refs.muteBtn.setAttribute('aria-pressed', 'false'); }
      atualizarAudioDeTela();
    });
    refs.muteBtn.addEventListener('click', () => {
      pref.mudo = !pref.mudo;
      refs.muteBtn.setAttribute('aria-pressed', String(pref.mudo));
      atualizarAudioDeTela();
    });
  }
  return refs;
}

function removerTileDeTela(id) {
  const refs = tilesDeTela.get(id);
  if (!refs) return;
  refs.video.srcObject = null;
  refs.root.remove();
  tilesDeTela.delete(id);
  reordenarQuadradinhos();
  if (pinned?.id === id && pinned.source === 'screen') avaliarDestaque();
}

function atualizarTileDeTela(id) {
  const estado = id === 'self' ? meuEstado() : (peers.get(id)?.state || {});
  if (!estado.screen) { removerTileDeTela(id); return; }

  const refs = garantirTileDeTela(id);
  refs.nome.textContent = `${nomeDe(id)} — Tela`;
  const stream = id === 'self' ? screenStream : peers.get(id)?.remoteStreams.screen;
  ligarFluxo(refs.video, stream);
  garantirReproducao(refs.video);
  refs.root.classList.toggle('pinned', pinned?.id === id && pinned.source === 'screen');

  // Da para compartilhar a tela sem som nenhum. Nesse caso os controles ficam apagados, em
  // vez de sumirem: some a duvida de "abaixei o volume e nao mudou nada".
  if (refs.slider) {
    const temSom = Boolean(peers.get(id)?.remoteStreams.screenAudio.getTracks().length);
    refs.slider.disabled = !temSom;
    refs.muteBtn.disabled = !temSom;
    refs.linhaDeVolume.title = temSom
      ? 'Volume do som desta tela'
      : 'Esta tela está sendo compartilhada sem som';
  }
}

function atualizarTile(id) {
  const refs = tiles.get(id);
  if (!refs) return;
  const estado = id === 'self' ? meuEstado() : (peers.get(id)?.state || {});
  const temCamera = id === 'self' ? Boolean(cameraStream) : Boolean(estado.camera);
  if (id === 'self' && cameraStream) ligarFluxo(refs.camVideo, cameraStream);

  refs.camVideo.classList.toggle('active', temCamera);
  refs.avatar.classList.toggle('hidden', temCamera);
  // O selo "Tela" some do quadradinho da pessoa: agora a tela tem o proprio quadradinho.
  refs.screenBadge.classList.add('hidden');
  refs.micIcon.classList.toggle('muted', Boolean(estado.micMuted));
  atualizarTileDeTela(id);
}

function atualizarContador() {
  const total = peers.size + 1;
  participantCount.textContent = total === 1 ? 'Só você na sala' : `${total} pessoas na sala`;
  document.dispatchEvent(new Event('room-update'));
}

// ---------- Palco (spotlight) ----------
// Destaque automatico, para ninguem precisar clicar em nada:
//  - tela tem prioridade sobre camera;
//  - entre fontes do mesmo tipo, ganha quem comecou primeiro;
//  - a propria imagem so vai ao centro se nao houver mais ninguem compartilhando (ver a
//    propria tela no palco gera o efeito de espelho infinito);
//  - uma escolha manual manda mais que tudo, ate aquela fonte acabar.
const TEXTO_PALCO_VAZIO = stageEmpty.innerHTML;
let sequenciaDeCompartilhamento = 0;
let destaqueManual = false;

// Fonte anunciada pelo estado, mesmo que o video ainda nao tenha chegado: e o que permite
// destacar na hora e esperar a imagem, em vez de largar o palco vazio.
function fonteAnunciada(id, source) {
  if (id === 'self') {
    const stream = source === 'screen' ? screenStream : cameraStream;
    return Boolean(stream && stream.getVideoTracks().length);
  }
  const peer = peers.get(id);
  if (!peer) return false;
  return Boolean(source === 'screen' ? peer.state?.screen : peer.state?.camera);
}

function candidatosDeDestaque() {
  const lista = [];
  peers.forEach((peer, id) => {
    if (peer.state?.screen) lista.push({ id, source: 'screen', prioridade: 0, ordem: peer.ordem.screen });
    if (peer.state?.camera) lista.push({ id, source: 'camera', prioridade: 1, ordem: peer.ordem.camera });
  });
  // A propria imagem entra por ultimo, so como preenchimento quando estou sozinho.
  if (screenStream) lista.push({ id: 'self', source: 'screen', prioridade: 2, ordem: 0 });
  if (cameraStream) lista.push({ id: 'self', source: 'camera', prioridade: 3, ordem: 0 });
  lista.sort((a, b) => a.prioridade - b.prioridade || a.ordem - b.ordem);
  return lista;
}

function avaliarDestaque() {
  window.RoomMulti?.render();
  const atualValido = pinned && fonteAnunciada(pinned.id, pinned.source);

  // Escolha manual manda enquanto aquela fonte existir.
  if (destaqueManual && atualValido) {
    atualizarPalco();
    atualizarAudioDeTela();
    return;
  }

  // O que ja esta no palco nao sai de la so porque apareceu mais gente compartilhando:
  // quem esta assistindo uma tela continua nela, e nao e puxado para a tela de quem
  // chegou depois. So duas situacoes justificam a troca automatica.
  if (atualValido) {
    const candidato = candidatosDeDestaque()[0];
    const trocaJustificada = candidato && (
      // estava numa camera e surgiu uma tela, que tem prioridade
      (pinned.source === 'camera' && candidato.source === 'screen') ||
      // estava na propria imagem, que e so preenchimento para quando estou sozinho
      (pinned.id === 'self' && candidato.id !== 'self')
    );
    if (trocaJustificada) pin(candidato.id, candidato.source, false);
    else atualizarPalco();
    atualizarAudioDeTela();
    return;
  }

  // Chegou aqui: o que estava no palco acabou. Escolhe o melhor disponivel.
  destaqueManual = false;
  const melhor = candidatosDeDestaque()[0];
  if (!melhor) { despinar(); atualizarAudioDeTela(); return; }
  if (!pinned || pinned.id !== melhor.id || pinned.source !== melhor.source) pin(melhor.id, melhor.source, false);
  else atualizarPalco();
  atualizarAudioDeTela();
}

// Som de tela: toca o da tela em destaque. Se existe uma unica tela na sala, ela toca de
// qualquer jeito -- assim ninguem fica mudo por ter clicado numa camera.
function atualizarAudioDeTela() {
  const comSom = [];
  peers.forEach((peer, id) => { if (peer.state.screen && peer.state.screenAudio && peer.remoteStreams.screenAudio.getAudioTracks().some(t => t.readyState === 'live')) comSom.push(id); });
  tiles.forEach((refs, id) => {
    if (!refs.screenAudio) return;
    const peer = peers.get(id);
    if (!peer) return;
    const stream = peer.remoteStreams.screenAudio;
    if (refs.screenAudio.srcObject !== stream) refs.screenAudio.srcObject = stream;
    const emDestaque = pinned?.id === id && pinned.source === 'screen';
    const unicaTelaComSom = comSom.length === 1 && comSom[0] === id;
    const deveTocar = peer.state.screenAudio && peer.state.screen && (emDestaque || unicaTelaComSom);
    // O mudo do participante vale para a VOZ dele; o som da tela tem o proprio controle, no
    // quadradinho da tela. Antes os dois andavam juntos e nao dava para calar so a tela.
    const pref = preferenciaDeTela(id);
    refs.screenAudio.volume = pref.nivel;
    refs.screenAudio.muted = pref.mudo || !deveTocar;
    if (deveTocar && !pref.mudo) garantirReproducao(refs.screenAudio);
  });
}

function pin(id, source, manual) {
  if (!id) { despinar(); return; }
  const mudou = !pinned || pinned.id !== id || pinned.source !== source;
  pinned = { id, source };
  if (manual) destaqueManual = true;
  if (mudou) definirZoom(1);
  atualizarPalco();
  // O som de tela segue o destaque, entao precisa ser reavaliado aqui tambem: o clique
  // manual no participante chama pin() direto, sem passar por avaliarDestaque().
  atualizarAudioDeTela();
  stageControls.classList.remove('hidden');
  // Trocar o destaque muda o rotulo: mostra o novo antes de deixar sumir de novo.
  mostrarControlesDoPalco();
  // O destaque agora e por FONTE: a mesma pessoa pode ter dois quadradinhos.
  document.querySelectorAll('.participant').forEach(el =>
    el.classList.toggle('pinned', el.dataset.id === id && el.dataset.source === source));
}

function despinar() {
  pinned = null;
  destaqueManual = false;
  stageVideo.srcObject = null;
  stageEmpty.innerHTML = TEXTO_PALCO_VAZIO;
  stage.classList.remove('is-waiting');
  document.getElementById('playbackRecovery').hidden = true;
  clearTimeout(esperaDoVideo);
  stageEmpty.classList.remove('hidden');
  stageLabel.classList.add('hidden');
  stageControls.classList.add('hidden');
  if (!window.RoomMulti?.active || !candidatosDeDestaque().length) definirModoTeatro(false);
  definirZoom(1);
  if (document.fullscreenElement === stage) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  document.querySelectorAll('.participant').forEach(el => el.classList.remove('pinned'));
  atualizarAudioDeTela();
  window.RoomMulti?.render();
}

function atualizarPalco() {
  window.RoomMulti?.render();
  if (!pinned) return;
  const { id, source } = pinned;
  const nome = id === 'self' ? myName : (peers.get(id)?.name || 'Participante');
  const stream = id === 'self'
    ? (source === 'screen' ? screenStream : cameraStream)
    : (peers.get(id)?.remoteStreams[source] || null);

  stageLabel.classList.remove('hidden');
  stageLabel.textContent = `${nome} — ${source === 'screen' ? 'Tela' : 'Câmera'}`;

  if (!stream || !stream.getVideoTracks().length) {
    // O estado ja anunciou a fonte, mas a faixa de video ainda nao chegou. Antes o palco
    // se desfazia sozinho aqui e so voltava com F5; agora ele espera.
    stageVideo.srcObject = null;
    stageEmpty.textContent = 'Conectando à transmissão…';
    stage.classList.add('is-waiting');
    stageEmpty.classList.remove('hidden');
    aguardarVideo();
    return;
  }
  const mudou = ligarFluxo(stageVideo, stream);
  if (mudou) {
    clearTimeout(esperaDoVideo);
    esperaDoVideo = null;
  }
  atualizarEstadoDoVideo();
  garantirReproducao(stageVideo);
}

// One video-only stream per element. Never clone/stop the receiver track itself.
function ligarFluxo(el, stream) {
  return el ? RoomMedia.bindVideo(el, stream) : false;
}

// ---------- Autoplay (som bloqueado pelo navegador) ----------
function garantirReproducao(mediaEl) {
  if (!mediaEl?.srcObject?.getTracks().some(t => t.readyState === 'live')) return Promise.resolve();
  const stream = mediaEl.srcObject;
  return Promise.resolve(mediaEl.play()).then(() => {
    midiasBloqueadas.delete(mediaEl);
    atualizarAvisoDeReproducao();
  }).catch(error => {
    // Replacing a stream aborts its pending play. It is not a permission failure.
    if (mediaEl.srcObject !== stream || error.name === 'AbortError') return;
    if (error.name === 'NotAllowedError') midiasBloqueadas.add(mediaEl);
    else console.warn('Reprodução:', error);
    atualizarAvisoDeReproducao();
    if (mediaEl === stageVideo) atualizarEstadoDoVideo();
  });
}

function atualizarAvisoDeReproducao() {
  for (const el of midiasBloqueadas) {
    if (!el.isConnected || !el.srcObject?.getTracks().some(t => t.readyState === 'live')) midiasBloqueadas.delete(el);
  }
  needsUserGesture = midiasBloqueadas.size > 0;
  enableSoundBtn.classList.toggle('hidden', !needsUserGesture);
}

function retomarMidias() {
  // All play() calls happen directly in the tap handler, before any await on iOS.
  document.querySelectorAll('video, audio').forEach(garantirReproducao);
  liberarContextoDeAudio();
  contextoDeAnalise?.resume().catch(() => {});
}
enableSoundBtn.onclick = retomarMidias;

let esperaDoVideo = null;
function aguardarVideo() {
  if (esperaDoVideo) return;
  esperaDoVideo = setTimeout(() => {
    esperaDoVideo = null;
    if (!pinned || (!stageVideo.paused && stageVideo.readyState >= 2 && stageVideo.videoWidth)) return;
    stageEmpty.textContent = 'A imagem ainda não chegou. Tente reproduzir ou confira a conexão.';
    document.getElementById('playbackRecovery').hidden = false;
  }, 8000);
}

function atualizarEstadoDoVideo() {
  if (!pinned) return;
  const tocando = stageVideo.srcObject && !stageVideo.paused && stageVideo.readyState >= 2 && stageVideo.videoWidth > 0;
  stage.classList.toggle('is-waiting', !tocando);
  stageEmpty.classList.toggle('hidden', Boolean(tocando));
  if (tocando) {
    clearTimeout(esperaDoVideo);
    esperaDoVideo = null;
    document.getElementById('playbackRecovery').hidden = true;
  } else {
    stageEmpty.textContent = midiasBloqueadas.has(stageVideo) ? 'Toque em Ativar reprodução para assistir.' : 'Recebendo vídeo…';
    aguardarVideo();
  }
}
['playing', 'loadeddata', 'pause', 'waiting', 'emptied'].forEach(event => stageVideo.addEventListener(event, atualizarEstadoDoVideo));
stageVideo.addEventListener('canplay', () => garantirReproducao(stageVideo));
document.getElementById('retryPlaybackBtn').onclick = () => {
  if (pinned) {
    const stream = pinned.id === 'self' ? (pinned.source === 'screen' ? screenStream : cameraStream) : peers.get(pinned.id)?.remoteStreams[pinned.source];
    stageVideo.srcObject = null;
    ligarFluxo(stageVideo, stream);
  }
  retomarMidias();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) retomarMidias(); });
window.addEventListener('pageshow', retomarMidias);

window.addEventListener('pagehide', () => {
  saindoDaSala = true;
  encerrarMidiasDaSala();
  socket?.disconnect();
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

// ---------- Janela de compartilhamento ----------
// Antes era um bloco no meio da pagina, e era preciso rolar ate o fim para achar o botao.
settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) fecharPainelDeTela(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!lightbox.classList.contains('hidden')) { fecharImagem(); return; }
  if (!settingsPanel.classList.contains('hidden')) { fecharPainelDeTela(); return; }
  if (chatPanel.classList.contains('aberto')) fecharChat();
});

// ---------- Chat da sala ----------
// Mensagens trafegam pela conexao de sinalizacao, que ja existe e fica ociosa. Video e voz
// continuam ponto a ponto: o chat nao passa perto deles.
const chatPanel = document.getElementById('chatPanel');
const chatMsgs = document.getElementById('chatMsgs');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatToggle = document.getElementById('chatToggle');
const chatClose = document.getElementById('chatClose');
const chatBadge = document.getElementById('chatBadge');

const LARGURA_MAXIMA_DA_IMAGEM = 1280;
const BYTES_MAXIMOS_DA_IMAGEM = 700 * 1024;
let naoLidas = 0;

function chatVisivel() {
  if (document.querySelector('.app').classList.contains('teatro')) return false;
  if (document.querySelector('.app').classList.contains('sem-chat')) return false;
  return window.matchMedia('(min-width: 1101px)').matches || chatPanel.classList.contains('aberto');
}
function abrirChat() {
  definirModoTeatro(false);
  chatPanel.classList.add('aberto');
  document.querySelector('.app').classList.remove('sem-chat');
  naoLidas = 0;
  chatBadge.classList.add('hidden');
  chatInput.focus();
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}
// "aberto" vale na tela estreita, onde o chat e uma camada; "sem-chat" vale na tela larga,
// onde ele e uma coluna. O X mexe nos dois, entao fechar funciona nas duas larguras.
function fecharChat() {
  chatPanel.classList.remove('aberto');
  document.querySelector('.app').classList.add('sem-chat');
}
chatToggle.onclick = () => (chatVisivel() ? fecharChat() : abrirChat());
chatClose.onclick = fecharChat;

function horaCurta(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const EXTENSOES_DE_IMAGEM = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

// O texto NUNCA vira HTML: cada pedaco entra como nó de texto e so os links viram <a>.
// E o que impede alguem de injetar marcacao pelo chat.
function montarTexto(destino, texto) {
  const partes = texto.split(/(https?:\/\/[^\s<]+)/gi);
  partes.forEach((parte, i) => {
    if (!parte) return;
    if (i % 2 === 1) {
      const a = document.createElement('a');
      a.href = parte;
      a.textContent = parte;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      destino.appendChild(a);
      if (EXTENSOES_DE_IMAGEM.test(parte)) {
        const img = document.createElement('img');
        img.className = 'msg-img';
        img.loading = 'lazy';
        img.alt = 'imagem compartilhada';
        img.src = parte;
        img.onerror = () => img.remove();   // link quebrado: fica so o endereco
        img.onload = () => { if (perto) chatMsgs.scrollTop = chatMsgs.scrollHeight; };
        destino.appendChild(img);
      }
    } else {
      destino.appendChild(document.createTextNode(parte));
    }
  });
}

let perto = true;
chatMsgs.addEventListener('scroll', () => {
  perto = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight < 80;
});

function mostrarMensagem(msg) {
  const vazio = chatMsgs.querySelector('.chat-vazio');
  if (vazio) vazio.remove();
  perto = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight < 80;

  const el = document.createElement('div');
  el.className = 'msg';
  const avatar = document.createElement('span');
  avatar.className = 'msg-avatar';
  avatar.textContent = iniciais(msg.autor || '?');
  avatar.style.background = corDoNome(msg.autor || '');
  avatar.setAttribute('aria-hidden', 'true');

  const topo = document.createElement('div');
  topo.className = 'msg-topo';
  const autor = document.createElement('span');
  autor.className = 'msg-autor';
  autor.textContent = msg.autor || 'Alguém';
  autor.style.color = corDoNome(msg.autor || '');
  const hora = document.createElement('span');
  hora.className = 'msg-hora';
  hora.textContent = horaCurta(msg.em || Date.now());
  topo.append(autor, hora);

  const corpo = document.createElement('div');
  corpo.className = 'msg-texto';
  if (msg.texto) montarTexto(corpo, msg.texto);
  if (msg.imagem) {
    const img = document.createElement('img');
    img.className = 'msg-img';
    img.alt = 'imagem enviada no chat';
    img.src = msg.imagem;
    img.onload = () => { if (perto) chatMsgs.scrollTop = chatMsgs.scrollHeight; };
    corpo.appendChild(img);
  }

  el.append(avatar, topo, corpo);
  chatMsgs.appendChild(el);
  if (perto) chatMsgs.scrollTop = chatMsgs.scrollHeight;

  if (!chatVisivel() && msg.autorId !== meuSocketId) {
    naoLidas++;
    chatBadge.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
    chatBadge.classList.remove('hidden');
  }
}

function mostrarVazio() {
  chatMsgs.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'chat-vazio';
  const heading = document.createElement('strong');
  heading.textContent = 'A resenha começa aqui.';
  p.append(heading, document.createTextNode('Mande um oi, compartilhe um link ou aquela captura da última partida.'));
  chatMsgs.appendChild(p);
}
mostrarVazio();

function enviarMensagem(texto, imagem) {
  if (!socket?.connected) { status.textContent = 'Aguarde a reconexão para enviar sua mensagem.'; return false; }
  if (!texto && !imagem) return false;
  socket.emit('chat-message', { texto: texto || '', imagem: imagem || null });
  return true;
}

chatSend.onclick = () => {
  const texto = chatInput.value.trim();
  if (!texto) return;
  if (!enviarMensagem(texto, null)) return;
  chatInput.value = '';
  chatInput.style.height = 'auto';
};
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend.click(); }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(120, chatInput.scrollHeight) + 'px';
});

// Imagem colada ou arrastada: reduzida no proprio navegador antes de sair. Mandar o
// original de uma captura de tela (varios MB) entupiria a sinalizacao a toa.
// JPEG nao tem canal alfa: converter um PNG transparente para JPEG pinta o fundo de preto.
// Por isso, antes de escolher o formato, olhamos se a imagem realmente usa transparencia.
function temTransparencia(ctx, tela) {
  try {
    const dados = ctx.getImageData(0, 0, tela.width, tela.height).data;
    for (let i = 3; i < dados.length; i += 4) if (dados[i] < 250) return true;
    return false;
  } catch (_) {
    return false;  // canvas marcado por imagem de outra origem: nao da para inspecionar
  }
}

function reduzir(origem, fator) {
  const menor = document.createElement('canvas');
  menor.width = Math.max(1, Math.round(origem.width / fator));
  menor.height = Math.max(1, Math.round(origem.height / fator));
  menor.getContext('2d').drawImage(origem, 0, 0, menor.width, menor.height);
  return menor;
}

async function encolherImagem(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LARGURA_MAXIMA_DA_IMAGEM / Math.max(bitmap.width, bitmap.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(bitmap.width * escala);
  tela.height = Math.round(bitmap.height * escala);
  const ctx = tela.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, tela.width, tela.height);
  bitmap.close?.();

  if (temTransparencia(ctx, tela)) {
    // PNG e sem perdas, entao nao ha qualidade para baixar: o que cabe no limite e ir
    // diminuindo as dimensoes, preservando o fundo transparente.
    let atual = tela;
    for (let i = 0; i < 5; i++) {
      const url = atual.toDataURL('image/png');
      if (url.length <= BYTES_MAXIMOS_DA_IMAGEM) return url;
      atual = reduzir(atual, 1.5);
    }
    return null;
  }

  for (const qualidade of [0.82, 0.65, 0.5, 0.35]) {
    const url = tela.toDataURL('image/jpeg', qualidade);
    if (url.length <= BYTES_MAXIMOS_DA_IMAGEM) return url;
  }
  return null;
}

async function mandarArquivoDeImagem(arquivo) {
  if (!arquivo || !arquivo.type.startsWith('image/')) return;
  // GIF animado perde a animacao ao passar pelo canvas, entao so vai se ja for pequeno.
  if (arquivo.type === 'image/gif') {
    if (arquivo.size > BYTES_MAXIMOS_DA_IMAGEM) {
      status.textContent = 'Esse GIF é grande demais para o chat. Cole o link dele que ele aparece igual.';
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => enviarMensagem(chatInput.value.trim(), leitor.result);
    leitor.readAsDataURL(arquivo);
    chatInput.value = '';
    return;
  }
  try {
    const url = await encolherImagem(arquivo);
    if (!url) { status.textContent = 'Não consegui reduzir essa imagem o bastante. Envie o link dela.'; return; }
    enviarMensagem(chatInput.value.trim(), url);
    chatInput.value = '';
  } catch (_) {
    status.textContent = 'Não consegui ler essa imagem.';
  }
}

chatInput.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  mandarArquivoDeImagem(item.getAsFile());
});
chatPanel.addEventListener('dragover', (e) => e.preventDefault());
chatPanel.addEventListener('drop', (e) => {
  const arquivo = e.dataTransfer?.files?.[0];
  if (!arquivo) return;
  e.preventDefault();
  mandarArquivoDeImagem(arquivo);
});

// ---------- Visualizador de imagem ----------
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxFechar = document.getElementById('lightboxFechar');
const lightboxBaixar = document.getElementById('lightboxBaixar');

function abrirImagem(src) {
  lightboxImg.classList.remove('real');
  lightboxImg.src = src;
  lightboxBaixar.href = src;
  lightbox.classList.remove('hidden');
}

function fecharImagem() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
}

// Delegacao: as mensagens sao criadas o tempo todo, entao o ouvinte fica no container.
chatMsgs.addEventListener('click', (e) => {
  const img = e.target.closest('.msg-img');
  if (img && img.src) abrirImagem(img.src);
});
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) fecharImagem(); });
lightboxImg.addEventListener('click', () => lightboxImg.classList.toggle('real'));
lightboxFechar.onclick = fecharImagem;

// ---------- Indicador de quem esta falando ----------
// Um unico AudioContext analisa o volume de cada participante e acende o anel verde. Tudo
// dentro de try: se algum navegador nao deixar, o pior que acontece e nao ter o anel.
let contextoDeAnalise = null;
const analisadores = new Map(); // id -> { analisador, dados }

function acompanharVoz(id, stream) {
  try {
    const faixa = stream && stream.getAudioTracks()[0];
    if (!faixa) return;
    const atual = analisadores.get(id);
    // Refaz o analisador quando a faixa mudou ou quando ele foi montado sobre uma faixa
    // que ainda estava muda. Faixa que vem da rede chega SEMPRE muda: o ontrack acontece
    // antes do primeiro pacote, e um no de audio criado nesse instante pode ficar surdo
    // para sempre. Antes a segunda chamada (a do "desmutou") saia na hora porque ja havia
    // uma entrada, e o anel do outro participante nunca acendia -- so o proprio, cuja
    // faixa nasce fluindo.
    if (atual && atual.faixa === faixa && !atual.montadoMudo) return;
    contextoDeAnalise ||= new AudioContextClass();
    if (atual && atual.fonte) { try { atual.fonte.disconnect(); } catch (_) {} }
    const fonte = contextoDeAnalise.createMediaStreamSource(stream);
    const analisador = contextoDeAnalise.createAnalyser();
    analisador.fftSize = 512;
    analisador.smoothingTimeConstant = 0.6;
    fonte.connect(analisador);
    // A fonte fica guardada de proposito: sem nenhuma referencia viva, o coletor de lixo
    // pode leva-la e o analisador emudece sozinho no meio da conversa.
    analisadores.set(id, {
      analisador, dados: new Uint8Array(analisador.frequencyBinCount),
      fonte, stream, faixa, montadoMudo: faixa.muted
    });
  } catch (_) { /* sem indicador de fala neste navegador */ }
}

function pararDeAcompanhar(id) {
  const entrada = analisadores.get(id);
  if (entrada && entrada.fonte) { try { entrada.fonte.disconnect(); } catch (_) {} }
  analisadores.delete(id);
}

function pulsoDeVoz() {
  analisadores.forEach((entrada, id) => {
    // Se a faixa chegou muda e o evento de "desmutou" nao veio (acontece em rede ruim),
    // o conserto sai daqui mesmo, sem depender do evento.
    if (entrada.montadoMudo && entrada.faixa && !entrada.faixa.muted) {
      acompanharVoz(id, entrada.stream);
      return;
    }
    const { analisador, dados } = entrada;
    analisador.getByteFrequencyData(dados);
    let soma = 0;
    for (let i = 0; i < dados.length; i++) soma += dados[i];
    const media = soma / dados.length;
    const tile = tiles.get(id);
    if (tile) tile.root.classList.toggle('falando', media > 12);
  });
  requestAnimationFrame(pulsoDeVoz);
}
requestAnimationFrame(pulsoDeVoz);
