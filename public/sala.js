const pathParts = window.location.pathname.split('/').filter(Boolean);
const roomCode = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : 'principal';
document.getElementById('roomTitle').textContent = roomCode;
// Quem chega por um link colado em algum lugar merece ver em que sala esta entrando ANTES
// de digitar o nome -- ate porque um link errado so se descobre depois, ja la dentro.
document.getElementById('gateTitle').textContent = roomCode;
document.title = `${roomCode} · Nexo`;

const nameGate = document.getElementById('nameGate');
const nameInput = document.getElementById('nameInput');
const nameConfirmBtn = document.getElementById('nameConfirmBtn');
const status = document.getElementById('status');
const participantCount = document.getElementById('participantCount');
const participantsEl = document.getElementById('participants');
const stage = document.getElementById('stage');
const stageVideo = document.getElementById('stageVideo');
const stageOcultoOverlay = document.getElementById('stageOcultoOverlay');
const stageEmpty = document.getElementById('stageEmpty');
const stageLabel = document.getElementById('stageLabel');
const stageControls = document.getElementById('stageControls');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomLevelLabel = document.getElementById('zoomLevelLabel');
const stageVolume = document.getElementById('stageVolume');
const stageStopBtn = document.getElementById('stageStopBtn');
const stageSlider = document.getElementById('stageSlider');
const stageMute = document.getElementById('stageMute');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const qualidadeBtn = document.getElementById('qualidadeBtn');
const devicesBtn = document.getElementById('devicesBtn');
const devicesPanel = document.getElementById('devicesPanel');
const devicesClose = document.getElementById('devicesClose');
const devicesDica = document.getElementById('devicesDica');
const micDevice = document.getElementById('micDevice');
const outDevice = document.getElementById('outDevice');
const camDevice = document.getElementById('camDevice');
const micNivel = document.getElementById('micNivel');
const micDica = document.getElementById('micDica');
const camPreview = document.getElementById('camPreview');
const camDica = document.getElementById('camDica');
const saidaCampo = document.getElementById('saidaCampo');
const echoWarning = document.getElementById('echoWarning');
const fixEchoBtn = document.getElementById('fixEchoBtn');
const capturaAviso = document.getElementById('capturaAviso');
const capturaAvisoTexto = document.getElementById('capturaAvisoTexto');
const usarTelaInteiraBtn = document.getElementById('usarTelaInteiraBtn');
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
// Celular ou tablet. Interessa porque o codificador deles e muito mais apertado que o de
// um PC: a mesma configuracao que um desktop engole sem suar faz um telefone aquecer,
// baixar o relogio e entregar a imagem aos tropecos.
//
// `userAgentData.mobile` e a resposta direta onde existe; nos demais, um iPad moderno se
// declara "Macintosh" e so se entrega pelos pontos de toque.
const ehCelular = Boolean(
  navigator.userAgentData?.mobile
  || /Android|iPhone|iPod/i.test(navigator.userAgent)
  || (/iPad|Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
);
const suportaTelaCheia = Boolean(
  document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
);

let socket = null;
let credencialSessao = null;
let identidadeSessao = null;
let sequenciaMedicao = 0;
window.NexoSessao = { cabecalhos: () => credencialSessao ? { 'X-Nexo-Sessao': credencialSessao } : {} };
// A credencial privada retoma a mesma identidade de mídia durante uma oscilação.
// Ela fica só nesta aba; o identificador público não permite assumir outra sessão.
// Duas identidades diferentes, de proposito: "myId" e como o servidor de midia me conhece
// (e o que aparece no mapa de participantes); "meuSocketId" e a conexao de sinalizacao, que
// carimba o autor de cada mensagem do chat.
let myId = null;
let meuSocketId = null;
let myName = '';
// Quem abriu esta sala, pela identidade de mídia, e se EU posso moderar. As duas coisas vêm
// do servidor separadas de propósito: a primeira desenha o selo na lista de todo mundo, a
// segunda decide se as ações aparecem para mim. Ver moderacao.js.
let donoDaSala = null;
let podeModerar = false;
let configuracaoDaSala = { trancada: false, compartilharTela: true, soundboard: true, musica: true };
let ensurdecido = false;
let micAntesDeEnsurdecer = true;
let pushToTalkAtivo = false;
let pushToTalkPressionado = false;
let presencaLocal = '';
let economiaDeDadosAtiva = false;
let aguardandoEntrada = false;
const presencasPorIdentidade = new Map();
// Fui retirado desta sala. Existe para uma coisa só: impedir que os avisos de conexão -- que
// chegam logo depois, porque a conexão cai de fato -- apaguem o motivo real da tela.
let fuiRemovido = false;
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
let pedidoDeConfig = null;
function buscarConfigDaSala(nome) {
  // Chat e mídia podem retomar juntos. Um único pedido evita criar duas sessões
  // quando o processo reiniciou e a credencial anterior deixou de existir.
  pedidoDeConfig ||= pedirConfigDaSala(nome).finally(() => { pedidoDeConfig = null; });
  return pedidoDeConfig;
}
async function pedirConfigDaSala(nome) {
  let ultimoMotivo = 'sala-config';
  for (let tentativa = 0; tentativa < 150; tentativa++) {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 8000);
    try {
      const resposta = await fetch(`/api/sala-config?sala=${encodeURIComponent(roomCode)}&nome=${encodeURIComponent(nome)}`, { signal: controle.signal, headers: window.NexoSessao.cabecalhos() });
      const dados = await resposta.json().catch(() => ({}));
      if (dados.credencialSessao) { credencialSessao = dados.credencialSessao; identidadeSessao = dados.identidade; }
      if (dados.publicUrl) publicInviteUrl = dados.publicUrl;
      if (resposta.ok) return dados;
      if (dados.motivo === 'aguardando') {
        aguardandoEntrada = true;
        document.getElementById('waitingPanel')?.classList.remove('hidden');
        status.textContent = 'Aguardando quem abriu a sala aprovar sua entrada…';
        ultimoMotivo = dados.error || 'aguardando-aprovacao';
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      if (dados.motivo === 'recusado') {
        aguardandoEntrada = false;
        const recusa = new Error(dados.error || 'Seu pedido de entrada não foi aceito.');
        recusa.removido = true;
        throw recusa;
      }
      // Removido da sala não é falha de preparação: é uma resposta definitiva, com prazo, e
      // insistir doze vezes só atrasaria a frase que explica o que aconteceu.
      if (dados.motivo === 'removido') {
        const recusa = new Error(dados.error || 'Você foi removido desta sala.');
        recusa.removido = true;
        throw recusa;
      }
      ultimoMotivo = dados.error || 'sala-config';
      if (dados.motivo !== 'iniciando') break;
      status.textContent = 'O servidor de mídia está iniciando...';
    } catch (erro) {
      // A recusa por remoção é definitiva e precisa atravessar o laço. Sem este repasse ela
      // seria tratada como "o servidor não respondeu" e viraria onze novas tentativas.
      if (erro?.removido) { clearTimeout(prazo); throw erro; }
      ultimoMotivo = 'sem-resposta';
    } finally { clearTimeout(prazo); }
    if (saindoDaSala) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(ultimoMotivo);
}

async function cancelarPedidoDeEntrada(redirecionar = false) {
  if (aguardandoEntrada && credencialSessao) {
    aguardandoEntrada = false;
    try {
      await fetch(`/api/sala-pedido?sala=${encodeURIComponent(roomCode)}`, {
        method: 'DELETE', headers: window.NexoSessao.cabecalhos(), keepalive: true
      });
    } catch (_) { /* A expiração do servidor remove pedidos cujo navegador sumiu. */ }
  }
  if (redirecionar) location.assign('/');
}
document.getElementById('waitingCancel').onclick = () => cancelarPedidoDeEntrada(true);
window.addEventListener('pagehide', () => { if (aguardandoEntrada) cancelarPedidoDeEntrada(false); });

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
    // Removido tem painel próprio: a pessoa precisa ver o motivo e o prazo, não um conselho
    // de recarregar a página que não vai mudar nada.
    if (erro?.removido) {
      fuiRemovido = true;
      status.textContent = erro.message;
      document.getElementById('removidoMotivo').textContent = erro.message;
      document.getElementById('removidoPanel').classList.remove('hidden');
      return;
    }
    status.textContent = erro.message === 'servidor-de-midia-indisponivel'
      ? 'O servidor de mídia não está no ar. O chat funciona, mas ninguém vai ver nem ouvir ninguém.'
      : 'Não foi possível preparar a entrada na sala. Recarregue a página.';
    if (erro.message !== 'servidor-de-midia-indisponivel') return;
  }
  if (saindoDaSala) return;
  myId = salaConfig?.identidade || identidadeSessao || `local-${Math.random().toString(36).slice(2)}`;
  aguardandoEntrada = false;
  document.getElementById('waitingPanel')?.classList.add('hidden');

  if (salaConfig && !suportaWebRTC) {
    salaConfig = null;
    status.textContent = 'Este navegador não faz chamadas de vídeo. O chat funciona, mas para ver e ouvir a sala é preciso outro navegador.';
  }

  if (salaConfig) {
    transporte = RoomTransport.criarTransporte({
      peers,
      proximaOrdem: () => ++sequenciaDeCompartilhamento,
      aoEntrar: (par, info) => {
        par.state.presenca = presencasPorIdentidade.get(par.id) || '';
        criarTile(par.id, par.name, par.state);
        atualizarContador();
        avaliarDestaque();
        // Vale dizer que a retomada foi automática: sem isso parece que a sala decidiu
        // sozinha voltar a pagar por uma imagem que ninguém pediu agora.
        if (info?.retomando) status.textContent = `${par.name} voltou — a tela que você estava assistindo volta junto.`;
      },
      aoSair: (id, info) => {
        removerPar(id);
        atualizarContador();
        avaliarDestaque();
        // Sumir sem explicação é o que faz a sala achar que o problema é dela. Dizer que a
        // pessoa caiu, e que a volta se resolve sozinha, evita meia dúzia de "cadê o
        // fulano?" no chat.
        if (info?.caiu) status.textContent = `${info.nome} perdeu a conexão. Se voltar logo, a sala se recompõe sozinha.`;
      },
      aoMudarMidia: id => { ligarMidiaDoTile(id); avaliarDestaque(); },
      // A ordem em que a tela de alguém entrou só é conhecida aqui -- o quadradinho dela
      // já foi criado quando a faixa chegou, antes de o estado ser recalculado.
      aoMudarEstado: par => { atualizarTile(par.id); reordenarQuadradinhos(); avaliarDestaque(); avaliarRiscoDeEco(); },

      // Credencial NOVA a cada volta. A antiga tem prazo, e uma queda longa a deixa
      // vencida: reaproveita-la faria a reconexao falhar justamente nos casos em que ela
      // mais importa. O sufixo da sessao vai junto, entao a identidade nao muda.
      pedirCredencial: async () => {
        salaConfig = await buscarConfigDaSala(myName);
        myId = salaConfig?.identidade || myId;
        return salaConfig;
      },
      aoReconectar: republicarTudo,
      aoMudarConexao: (estado, mensagem) => {
        // Quem foi removido não recebe aviso de conexão em cima do motivo. Sem esta guarda o
        // "a mídia caiu" chega um instante depois e apaga a única frase que explicava o que
        // aconteceu -- e a pessoa fica recarregando a página sem saber que foi retirada.
        if (fuiRemovido) return;
        if (mensagem) status.textContent = mensagem;
        else if (estado === 'failed') status.textContent = 'A mídia caiu e não foi possível voltar. O chat continua.';
        atualizarContador();
      },
      // Quem transmite tambem precisa ceder quando a rede aperta: o controle de
      // congestionamento do servidor age sobre o que SAI dele, nao sobre o que entra.
      aoMudarQualidade: ajustarEnvioPelaQualidade
    });
    transporte.definirEconomia?.(document.getElementById('dataSaver')?.checked);
    try {
      await transporte.conectar(salaConfig.url, salaConfig.token);
    } catch (erro) {
      status.textContent = 'Não foi possível conectar ao servidor de mídia: ' + erro.message;
    }
    if (saindoDaSala) { await transporte.desconectar(); return; }
  }

  socket = io({ autoConnect: false, auth: responder => responder({ credencial: credencialSessao }) });
  socket.on('limite-atingido', aviso => { status.textContent = aviso.error || 'Aguarde antes de tentar novamente.'; });
  let renovandoSessao = false;
  socket.on('connect_error', async erro => {
    status.textContent = erro.message || 'Não foi possível conectar ao chat.';
    if (renovandoSessao || saindoDaSala || !erro.message?.includes('Sessão inválida')) return;
    renovandoSessao = true;
    try {
      const antiga = myId;
      try { salaConfig = await buscarConfigDaSala(myName); }
      catch (falha) { if (falha.message !== 'servidor-de-midia-indisponivel' || !credencialSessao) throw falha; salaConfig = null; }
      myId = salaConfig?.identidade || identidadeSessao;
      if (transporte && salaConfig && antiga !== myId) {
        await transporte.desconectar();
        await transporte.conectar(salaConfig.url, salaConfig.token);
        await republicarTudo();
      }
      socket.connect();
    } catch (_) { status.textContent = 'Não foi possível renovar a sessão. Aguarde e recarregue a página.'; }
    finally { renovandoSessao = false; }
  });
  // O canal de musica e a mesa de sons vivem em arquivos proprios e precisam do MESMO
  // socket -- ele e criado aqui, uma vez, e reconecta sozinho, entao os ouvintes deles
  // sobrevivem a uma queda de rede sem serem religados.
  window.NexoMusica?.ligar(socket);
  window.NexoSoundboard?.ligar(socket);

  socket.on('connect', async () => {
    // O Socket.IO cuida do chat, do agente de audio e do historico. A midia vive na conexao
    // com o servidor de midia, que se reconecta por conta propria -- entao uma oscilacao
    // aqui nao derruba mais video nem voz, e nao ha malha para refazer.
    const voltando = sessaoIniciada;
    meuSocketId = socket.id;
    if (voltando) status.textContent = 'Reconectado ao servidor.';
    // Primeira medida assim que existe caminho para medir, e não daqui a cinco segundos: é
    // nesses primeiros instantes que se olha para a conexão, antes de ligar qualquer coisa.
    medirLatenciaDaSinalizacao();
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
      donoDaSala = response.dono || null;
      podeModerar = Boolean(response.podeModerar);
      aplicarConfiguracaoDaSala(response.configuracao || configuracaoDaSala);
      desenharPedidosDeEntrada(response.pedidosEntrada || []);
      for (const participante of response.peers || []) {
        if (!participante.identidade) continue;
        presencasPorIdentidade.set(participante.identidade, participante.state?.presenca || '');
        const par = peers.get(participante.identidade);
        if (par) { par.state.presenca = participante.state?.presenca || ''; atualizarTile(par.id); }
      }
      if (presencaLocal) socket.emit('sinal-presenca', { presenca: presencaLocal });
      atualizarSelosDeDono();
      // Entrar na sala já liga a proteção contra throttling. Antes ela só aparecia no
      // primeiro clique no microfone ou na câmera -- quem entrava para assistir ficava sem
      // nenhuma, e era candidato a cair por ociosidade sem nunca ter feito nada.
      atualizarModoSegundoPlano();
      try {
        const recent = JSON.parse(localStorage.getItem('nexoRecentRooms') || '[]');
        localStorage.setItem('nexoRecentRooms', JSON.stringify([roomCode, ...(Array.isArray(recent) ? recent.filter(code => code !== roomCode) : [])].slice(0, 4)));
      } catch (_) { /* Recent rooms are optional. */ }
      // Numa reconexao o microfone ja pode estar aberto; numa entrada normal, nao existe
      // microfone nenhum ainda e nao ha o que acompanhar.
      if (micStream) { acompanharVoz('self', micStream); montarFiltroDeRuido(); }
      if (Array.isArray(response.historico) && response.historico.length) {
        chatMsgs.innerHTML = '';
        mensagensDoChat.clear();
        carregandoHistorico = true;
        response.historico.forEach(mostrarMensagem);
        carregandoHistorico = false;
        divisorDeNaoLidas = false;
        chatMsgs.querySelectorAll('.unread-divider').forEach(el => el.remove());
        naoLidas = 0;
        chatBadge.classList.add('hidden');
      }
      // A fila de musica e a mesa de sons chegam na mesma resposta, pelo mesmo motivo do
      // historico: quem entra no meio precisa ver a sala como ela esta, nao vazia.
      window.NexoMusica?.aoEntrar(response.musica);
      window.NexoSoundboard?.aoEntrar(response.soundboard);
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
    if (!identidade) return;
    // Vai pelo transporte, e não direto no mapa: ele precisa ANOTAR a saída. A lista do
    // servidor de mídia ainda vai insistir por um bom tempo que essa pessoa está aqui, e
    // sem a anotação a conferência periódica a traria de volta cinco segundos depois.
    if (transporte) transporte.descartar(identidade);
    else if (peers.has(identidade)) removerPar(identidade);
    atualizarContador();
    avaliarDestaque();
  });

  // O contraponto do aviso acima, e ele existe por um motivo concreto: a sinalização cai
  // sozinha. Um socket que apenas oscilou dispara o "peer-left" para todo mundo -- mas a
  // pessoa não saiu de lugar nenhum, e a mídia dela nunca chegou a cair. Sem este aviso, a
  // anotação de saída a manteria fora da lista de todos por um minuto e meio, porque a
  // sessão de mídia continua sendo a mesma e a anotação só sabe distinguir sessões.
  socket.on('peer-joined', ({ identidade }) => {
    if (!identidade || !transporte) return;
    transporte.readmitir(identidade);
    atualizarContador();
    avaliarDestaque();
  });

  // ---------- Quem manda na sala ----------
  //
  // Chega no `join-room` e é atualizado por este aviso, que dispara quando o dono muda --
  // sucessão por saída ou passagem deliberada. O cliente não deduz nada disso: ele não teria
  // como saber quem chegou primeiro, e no dia em que existir "moderador" a dedução por
  // comparação de identidade deixaria de valer.
  socket.on('sala-dono', ({ identidade }) => {
    donoDaSala = identidade || null;
    podeModerar = Boolean(donoDaSala) && donoDaSala === myId;
    atualizarSelosDeDono();
    aplicarConfiguracaoDaSala(configuracaoDaSala);
    atualizarAvisoDeEntrada();
  });

  socket.on('sala-configuracao', aplicarConfiguracaoDaSala);
  socket.on('pedido-entrada', adicionarPedidoDeEntrada);
  socket.on('pedido-entrada-resolvido', ({ identidade }) => removerPedidoDeEntrada(identidade));
  socket.on('pedido-entrada-cancelado', ({ identidade }) => removerPedidoDeEntrada(identidade));
  socket.on('presenca-atualizada', ({ identidade, presenca }) => {
    presencasPorIdentidade.set(identidade, presenca || '');
    if (identidade === myId) presencaLocal = presenca || '';
    const par = identidade === myId ? peers.get('self') : peers.get(identidade);
    if (par) { par.state ||= {}; par.state.presenca = presenca || ''; atualizarTile(par.id); }
    atualizarPresencaNaInterface(identidade, presenca || '');
  });
  socket.on('reacao-sala', mostrarReacaoDaSala);

  // Ser removido não pode ser silencioso, e não pode parecer queda de conexão -- senão a
  // pessoa fica recarregando a página sem entender, e a sala recebe dez tentativas de volta.
  socket.on('removido-da-sala', ({ motivo, minutos }) => {
    fuiRemovido = true;
    const frase = motivo === 'banir'
      ? `Você foi removido desta sala e não pode voltar por ${minutos || 60} min.`
      : 'Você foi removido desta sala por quem a abriu.';
    status.textContent = frase;
    // `desconectar` e não só encerrar as capturas: ele marca a saída como deliberada, e sem
    // isso o transporte trataria a queda como oscilação e tentaria voltar para a sala de que
    // a pessoa acabou de ser removida -- de dois em dois segundos.
    transporte?.desconectar();
    encerrarMidiasDaSala();
    // Um painel, e não um `alert`: a razão precisa ficar À VISTA, e não desaparecer no clique
    // seguinte. Ele não tem botão de fechar de propósito -- a sala já não existe para esta
    // pessoa, e a única saída honesta é ir para outro lugar.
    document.getElementById('removidoMotivo').textContent = frase
      + (motivo === 'banir' ? ' Se isso foi um engano, fale com quem abriu a sala.' : '');
    document.getElementById('removidoPanel').classList.remove('hidden');
  });

  socket.on('audio-data', (data) => receberPcm(data));

  socket.on('audio-error', (message) => { status.textContent = message; });

  socket.on('chat-mensagem', (msg) => mostrarMensagem(msg));
  socket.on('chat-atualizada', atualizarMensagemDoChat);
  socket.on('chat-removida', ({ id }) => removerMensagemDoChat(id));

  socket.on('disconnect', () => {
    // A queda vem LOGO depois da remoção, porque é o servidor fechando o socket de propósito.
    // Prometer reconexão a quem foi retirado é a mensagem errada duas vezes: ela não vai
    // acontecer, e ela apaga a frase que explicava o motivo.
    if (!fuiRemovido) status.textContent = 'Desconectado do servidor. Tentando reconectar...';
    // O último número medido descreve uma conexão que acabou de cair. Mantê-lo na barra
    // afirmaria, com um "24 ms" tranquilo, exatamente o contrário do que está acontecendo.
    latenciaDaSinalizacao = null;
    medindoLatencia = false;
    atualizarIndicadorDeConexao();
    registrarDiagnostico('socket.disconnect');
  });
  socket.on('connect_error', erro => {
    if (fuiRemovido) return;
    if (!erro.message?.includes('Sessão inválida') && !erro.message?.includes('Aguarde')) status.textContent = 'Não foi possível alcançar o servidor. Tentando novamente...';
    registrarDiagnostico('socket.connect_error');
  });
  // Register listeners before connecting: a fast socket used to beat the RTC fetch.
  socket.connect();
}

function meuEstado() {
  return { camera: Boolean(cameraStream), screen: Boolean(screenStream), screenAudio: Boolean(screenStream?.getAudioTracks().length), micMuted, presenca: presencaLocal };
}

// O estado das proprias fontes so importa para a interface local: para os outros, quem
// anuncia camera, tela e som de tela e a lista de publicacoes no servidor de midia.
function enviarEstado() {
  avaliarRiscoDeEco();
  document.dispatchEvent(new Event('room-update'));
}

// Escolha de codec de video. "auto" prioriza H.264 baseline: e o que tem decodificacao por
// hardware em todo aparelho que entra na sala, e no Windows e o que tem mais chance de sair
// pelo encoder da GPU. As demais opcoes existem para comparar em campo; nenhuma delas REMOVE
// codec da lista, entao quem nao suporta a escolha cai no melhor comum em vez de ficar sem
// imagem.
//
// "Todo aparelho" e mais forte do que "o unico que o iPhone decodifica por hardware", que era
// o que estava escrito aqui e ja nao e verdade: do iPhone 15 Pro em diante o Safari tambem
// decodifica AV1 por hardware. A razao de H.264 continuar sendo o automatico nao e essa, e
// sao outras duas, que valem para a sala inteira e nao para um aparelho: e o unico que esta
// maquina codifica em hardware (medido em docs/captura-de-tela.md), e -- enquanto o servidor
// de midia for a 1.13.6 -- e um dos dois que sobem com o degrau barato de 360p, o degrau que
// segura na sala quem tem a rede ruim.
//
// Um automatico que ESCOLHA o codec, em vez de fixar um, depende de saber tres coisas que
// hoje nao se sabem: o custo de codificar aqui, a capacidade de decodificar de cada
// espectador, e se o degrau barato existe naquele servidor. As duas primeiras passaram a ser
// medidas agora (ver medirEnvio); a terceira depende da 1.13.7. Escolher antes disso seria
// adivinhar -- e o erro de adivinhar aqui nao e imagem feia, e gente caindo da sala.
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
  // Outro codec tem outro custo por quadro: comparar o antes com o depois seria comparar
  // duas coisas diferentes.
  esquecerHistoricoDoEnvio();
  try { localStorage.setItem('nexoCodec', escolha); } catch (_) { /* Vale so nesta sessão. */ }
  seletoresDeCodec.forEach(select => { select.value = escolha; });
  status.textContent = escolha === 'auto'
    ? 'Codec automático: H.264 na tela, o que todo aparelho da sala decodifica por hardware.'
    : `Codec da tela: ${escolha.toUpperCase()}. Quem não suportar recebe pelo melhor codec em comum.`;
  republicarTela();
}

// "auto" e H.264: e o unico codec decodificado por hardware no iPhone e o que tem mais
// chance de sair pelo encoder da placa de video no Windows.
//
// A escolha vale para a TELA, e a camera fica fixa aqui. São duas razões.
//
// A primeira é custo no lugar errado. A câmera é 720p e desaparece no orçamento ao lado de
// uma tela 1080p, mas cobra uma codificação inteira do processador de quem transmite -- e
// numa sala de seis são seis câmeras subindo ao mesmo tempo, contra uma ou duas telas. Os
// kbps que VP9 ou AV1 economizariam nela não pagam esse processador.
//
// A segunda é que trocar o codec da tela deixa de republicar a câmera. Cada republicação
// renegocia com o servidor de mídia, e cada renegociação é uma chance de a faixa não voltar
// -- foi assim que a câmera sumiu do lado de quem assistia na auditoria.
const CODEC_DA_CAMERA = 'h264';
function codecDePublicacao(fonte) {
  if (fonte === 'camera') return CODEC_DA_CAMERA;
  return codecDeVideo === 'auto' ? 'h264' : codecDeVideo;
}

// VP9 e AV1 codificam em camadas dentro do mesmo fluxo (SVC), e o cliente do servidor de
// mídia trata isso de um jeito que exige esta escolha declarada no pedido.
//
// Sem `scalabilityMode` o cliente decide sozinho -- e decide em duas etapas que discordam
// entre si. Ele avisa o servidor primeiro ("recebe UMA faixa com as resoluções dentro") e
// só depois injeta `L1T3` nas opções; o cálculo dos fluxos, que roda por último, já vê o
// `L1T3` e monta DUAS faixas independentes, de 360p e 1080p. O servidor então trata a faixa
// pequena como se ela trouxesse a imagem inteira, e o orçamento vai todo para o lado errado:
// medido aqui, a camada de 1080p ficou em 0,25 quadro por segundo -- um quadro a cada quatro
// segundos -- enquanto quem assistia recebia 360p e três congelamentos em oito segundos.
//
// Declarando `L1T3` desde o pedido, as duas etapas concordam. Onde o servidor de mídia sabe
// fazer simulcast destes codecs (depois da 1.13.6) sobem as duas faixas de verdade; onde não
// sabe, o cliente desliga o simulcast e sobe uma faixa SVC só -- imagem inteira no palco,
// mas sem o degrau barato que a grade e a rede ruim usam. É por isso que estes codecs
// continuam fora do automático: ver AVISO_SEM_DEGRAU_BARATO.
const ESCADA_SVC = 'L1T3';
const CODECS_SVC = ['vp9', 'av1'];
const ehCodecSVC = codec => CODECS_SVC.includes(codec);

// Quanto do orçamento de H.264 cada codec precisa para a MESMA qualidade percebida.
//
// Sem isto, trocar de codec não economizava nada. O teto do perfil era o mesmo para todos, o
// codificador recebia o orçamento inteiro e gastava até o fim: VP9 entregava imagem melhor
// nos mesmos 4 Mbps em vez de a mesma imagem em 2,8. A economia ia para a nitidez, nunca para
// a conta de quem hospeda -- e é por isso que as trocas de codec testadas em campo nunca
// apareceram em lugar nenhum como redução de banda.
//
// Os fatores são conservadores de propósito. Em tela parada -- texto, código -- VP9 e AV1
// rendem bem mais que isto; em cena de muito movimento, bem menos. Gastar menos do que o
// codec aguentaria é invisível; gastar menos do que ele precisa aparece na hora, como borrão.
// Entre os dois erros, este é o barato.
const ORCAMENTO_POR_CODEC = { h264: 1, vp8: 1, vp9: 0.7, av1: 0.6 };

function tetoParaOCodec(bitrate, codec) {
  return Math.round(bitrate * (ORCAMENTO_POR_CODEC[codec] ?? 1));
}

// O teto da tela sai dos pixels que a captura está REALMENTE entregando, e não dos pixels
// que o perfil pediu.
//
// Os dois divergem sempre que a fonte não é um monitor 16:9 inteiro: uma janela, um monitor
// ultrawide, uma tela de notebook com escala. O perfil é o máximo que se pede; o que chega é
// o que a fonte tem para dar. Cobrar o orçamento do que foi pedido era pagar por pixels
// inexistentes -- multiplicado por espectador, porque o servidor manda uma cópia para cada.
//
// As medidas do perfil ficam como reserva: `getSettings` pode vir vazio antes do primeiro
// quadro, e um teto de reserva é melhor do que um teto zerado.
// A faixa vem por parâmetro, e não de `screenStream`, porque na hora de publicar as duas
// podem discordar: quem troca a fonte chama a publicação com a faixa NOVA, e ler a antiga
// daria um teto calculado sobre pixels que já não existem. Sem faixa -- o botão desenhando
// o rótulo antes de a captura existir -- vale a que está no ar.
function tetoDaTela(perfil, faixa) {
  const medidas = (faixa || screenStream?.getVideoTracks()[0])?.getSettings?.() || {};
  const largura = medidas.width || perfil.width;
  const altura = medidas.height || perfil.height;
  // A taxa vem da escolha, não de `getSettings`: é o teto que a publicação vai declarar, e a
  // fonte pode estar entregando menos neste instante sem que isso mude o combinado.
  return RoomQuality.tetoDeEnvio(
    Math.min(largura, perfil.width), Math.min(altura, perfil.height), quadrosDaTela);
}

// Trocar o codec republica a TELA, e só ela: a câmera tem codec fixo (ver CODEC_DA_CAMERA).
//
// A sequência inteira entra na fila de uma vez. Despublicar e publicar de novo eram duas
// tarefas separadas nela, e qualquer outra mudança -- parar a tela, trocar de câmera, voltar
// de uma queda -- conseguia se encaixar no meio. O resultado observado foi a faixa ficando
// despublicada: o "publique de novo" rodava antes do "despublique", que então apagava o que
// tinha acabado de subir.
async function republicarTela() {
  const tela = screenStream?.getVideoTracks()[0] || null;
  if (!tela) return;
  const ok = await sequenciaDePublicacao('screen', async () => {
    await aplicarPublicacao('screen', null);
    await aplicarPublicacao('screen', tela);
  });
  if (ok) avisarSeFaltaDegrauBarato();
}

// VP9 e AV1 podem subir sem o degrau barato, e quem escolheu precisa saber disso na hora.
//
// Depende do servidor de mídia: antes da 1.13.7 ele não sabe receber estes codecs como
// faixas independentes, e o cliente então desliga o simulcast e sobe uma faixa só (ver
// ESCADA_SVC). A imagem no palco fica inteira -- é a grade, a plateia e quem está com a rede
// apertada que perdem o degrau de 360p. E perder aquele degrau não deixa a pessoa com imagem
// ruim: deixa a pessoa fora da sala, porque a sinalização viaja no mesmo transporte que
// afoga. O motivo completo está em quality-utils.js.
//
// A conferência é por MEDIÇÃO, não pela versão que o servidor anuncia. O que importa é
// quantas camadas o navegador de fato criou, e isso não depende só do servidor: todo Safari
// e todo navegador no iOS sobem estes codecs em camada única de qualquer maneira, com
// qualquer versão do outro lado.
const AVISO_SEM_DEGRAU_BARATO = codec => `Neste servidor, ${codec} sobe em camada única: quem está`
  + ' com a rede apertada e as telas fora do palco perdem o degrau leve de 360p. H.264 e VP8 têm'
  + ' esse degrau — se houver gente com internet ruim na sala, prefira um deles.';

function avisarSeFaltaDegrauBarato() {
  const codec = codecDePublicacao('screen');
  if (!ehCodecSVC(codec)) return;
  const remetente = publicacoesLocais.screen?.track?.sender;
  let camadas = 0;
  try { camadas = remetente?.getParameters?.().encodings?.length || 0; } catch (_) { return; }
  // Zero é "ainda não sei", e não é motivo para assustar ninguém.
  if (camadas !== 1) return;
  status.textContent = AVISO_SEM_DEGRAU_BARATO(codec.toUpperCase());
  registrarDiagnostico('midia.camadaUnica', `${codec} subiu sem o degrau de 360p`);
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
// A prioridade decide o que CEDE quando aperta. Quantos quadros se pede é outra escolha, e
// por isso ela saiu daqui.
//
// Estavam juntas, e a junção tirava combinações legítimas das pessoas: "Fluidez máxima" era
// o único jeito de pedir 60 quadros, então quem queria 1440p a 30 com os quadros protegidos
// não tinha como, e quem queria 60 quadros em texto era obrigado a aceitar que a resolução
// cedesse primeiro. Pior: a interface anunciava "30 fps" num rótulo fixo, que passava a
// mentir no instante em que alguém escolhia fluidez.
//
// Separadas, cada seletor responde uma pergunta só -- quantos quadros eu quero, e o que
// abandono quando não couber -- e as seis combinações de resolução e taxa ficam todas
// disponíveis.
// O "Automático" saiu, e ele era o padrão.
//
// Ele parecia a escolha segura -- "deixe o Nexo decidir" -- e era, medido, a pior opção para
// qualquer conteúdo em movimento. A razão é que ele não decidia nada: a única diferença dele
// para "Fluidez" era deixar o `contentHint` VAZIO, e a preferência de degradação era a mesma.
// Com o hint vazio, a especificação manda o navegador favorecer detalhe e resolução em faixas
// de captura de tela -- ou seja, ele configurava o codificador em modo texto para quem estava
// compartilhando jogo.
//
// O preço, medido em 720p com o mesmo jogo e a mesma captura: 6,6 ms por quadro com
// `motion` contra 21,8 ms com o hint vazio, o que virou 57 quadros por segundo contra 16.
// Três vezes o custo por escolher a opção que se anunciava como automática.
//
// Sobraram duas, e elas são escolhas de verdade -- pedem coisas opostas e nenhuma serve para
// as duas tarefas. "Fluidez" é o padrão porque travar é o que estraga uma transmissão; a
// nitidez de texto parado é uma preferência, o lag não é.
const PRIORIDADES_DE_TELA = {
  fluidez: { rotulo: 'Movimento', dica: 'jogos e vídeo; a resolução cede antes dos quadros', pista: 'motion', degradacao: 'maintain-framerate' },
  nitidez: { rotulo: 'Nitidez', dica: 'código e texto parados; os quadros cedem antes da resolução', pista: 'detail', degradacao: 'maintain-resolution' }
};
const PRIORIDADE_PADRAO = 'fluidez';
let prioridadeDaTela = (() => {
  try {
    const guardada = localStorage.getItem('nexoPrioridade');
    // Quem tinha "automatico" salvo herda o padrão novo. Ele era o pior dos três, então
    // migrar é devolver quadros a quem nunca soube que os estava perdendo.
    if (guardada && PRIORIDADES_DE_TELA[guardada]) return guardada;
  } catch (_) { /* Sem armazenamento: vale o padrão desta sessão. */ }
  return PRIORIDADE_PADRAO;
})();
const seletoresDePrioridade = [...document.querySelectorAll('[data-screen-priority]')];

// Quadros por segundo da tela, agora uma escolha própria.
const QUADROS_DA_TELA = [30, 60];
let quadrosDaTela = (() => {
  try {
    const guardado = Number(localStorage.getItem('nexoFps'));
    if (QUADROS_DA_TELA.includes(guardado)) return guardado;
    // Quem já tinha escolhido "Fluidez máxima" escolheu 60 quadros -- era o que aquela opção
    // significava. Herdar isso é o que impede a separação de virar uma perda silenciosa de
    // metade dos quadros para quem já usava o Nexo para jogar.
    if (localStorage.getItem('nexoPrioridade') === 'fluidez') return 60;
  } catch (_) { /* Sem armazenamento: vale o padrão desta sessão. */ }
  return 30;
})();
const seletoresDeQuadros = [...document.querySelectorAll('[data-screen-fps]')];

async function definirPrioridadeDaTela(escolha) {
  if (!PRIORIDADES_DE_TELA[escolha] || escolha === prioridadeDaTela) return;
  prioridadeDaTela = escolha;
  // A prioridade decide se cede a resolução ou os quadros: depois de trocá-la, uma queda de
  // quadros pode ser exatamente o que foi pedido.
  esquecerHistoricoDoEnvio();
  try { localStorage.setItem('nexoPrioridade', escolha); } catch (_) { /* Vale so nesta sessão. */ }
  seletoresDePrioridade.forEach(select => { select.value = escolha; });
  const prioridade = PRIORIDADES_DE_TELA[escolha];
  const faixa = screenStream?.getVideoTracks()[0];
  if (faixa) {
    faixa.contentHint = prioridade.pista || '';
    // A prioridade já não mexe na taxa de quadros -- ela é escolha separada agora. O que
    // muda aqui é a dica de conteúdo e a preferência de degradação, e as duas viajam nas
    // opções de publicação.
    await sequenciaDePublicacao('screen', async () => {
      await aplicarPublicacao('screen', null);
      await aplicarPublicacao('screen', faixa);
    });
  }
  status.textContent = `Prioridade da tela: ${prioridade.rotulo.toLowerCase()} (${prioridade.dica}).`;
  atualizarBotaoDeQualidade();
}

// Pedir mais quadros exige mexer na CAPTURA, e não só na publicação: a taxa que a fonte
// entrega é o teto do que o codificador tem para enviar. Sem isto, escolher 60 não teria de
// onde tirar quadros a mais -- e escolher 30 continuaria codificando 60 para jogar metade
// fora, gastando processador de quem transmite em quadros que ninguém veria.
async function definirQuadrosDaTela(escolha) {
  const quadros = Number(escolha);
  if (!QUADROS_DA_TELA.includes(quadros) || quadros === quadrosDaTela) return;
  quadrosDaTela = quadros;
  esquecerHistoricoDoEnvio();
  try { localStorage.setItem('nexoFps', String(quadros)); } catch (_) { /* Vale so nesta sessão. */ }
  seletoresDeQuadros.forEach(select => { select.value = String(quadros); });
  const faixa = screenStream?.getVideoTracks()[0];
  if (faixa) {
    try { await faixa.applyConstraints({ ...faixa.getConstraints(), frameRate: { ideal: quadros, max: quadros } }); }
    catch (_) { /* A fonte manda na taxa; o teto de publicação abaixo continua valendo. */ }
    await sequenciaDePublicacao('screen', async () => {
      await aplicarPublicacao('screen', null);
      await aplicarPublicacao('screen', faixa);
    });
  }
  status.textContent = `Tela a ${quadros} quadros por segundo. ${quadros === 60
    ? 'Movimento mais macio, e cerca de 1,4 vez a banda de 30.'
    : 'Metade dos quadros de 60, e bem menos processador de quem transmite.'}`;
  atualizarBotaoDeQualidade();
}

function opcoesDePublicacao(fonte, faixa) {
  if (fonte === 'mic') return { source: FONTE_DO_SERVIDOR.mic };
  if (fonte === 'screenAudio') {
    // DTX corta a transmissao no silencio e RED duplica pacotes para voz. Os dois estragam
    // som de jogo e musica, e o servidor de midia os liga por padrao em faixa mono.
    return { source: FONTE_DO_SERVIDOR.screenAudio, dtx: false, red: false, audioPreset: { maxBitrate: 128_000 } };
  }
  const perfil = perfilAtual();
  if (fonte === 'camera') {
    // Camera e movimento: perder nitidez incomoda menos que ver a pessoa aos solavancos.
    const opcoes = { source: FONTE_DO_SERVIDOR.camera, videoCodec: codecDePublicacao('camera'), simulcast: true, degradationPreference: 'maintain-framerate' };
    // No celular, DUAS camadas em vez de tres.
    //
    // Simulcast codifica a mesma imagem varias vezes, uma por qualidade, para que cada
    // espectador receba a que a conexao dele aguenta. Num PC isso e barato. Num telefone e
    // a terceira codificacao que empurra o aparelho para o limite -- e o sintoma nao e a
    // imagem ficar feia, e ela tropecar de tempos em tempos, porque o codificador nao
    // termina um quadro antes do proximo chegar.
    //
    // Com duas camadas a adaptacao continua existindo (quem esta na rede ruim ainda recebe
    // a pequena), e some um terco do trabalho de codificar.
    //
    // As camadas sao declaradas a mao em vez de usar os presets prontos da biblioteca: os
    // dela limitam a 20 quadros por segundo, e trocar tres camadas a 30 por duas a 20
    // consertaria o tropeco criando outro -- a imagem ficaria constante, porem lenta.
    if (ehCelular) {
      opcoes.videoSimulcastLayers = [
        new LivekitClient.VideoPreset(640, 360, 500_000, 30),
        new LivekitClient.VideoPreset(1280, 720, 1_700_000, 30)
      ];
    }
    return opcoes;
  }
  const prioridade = PRIORIDADES_DE_TELA[prioridadeDaTela];
  const codec = codecDePublicacao('screen');
  const teto = tetoDaTela(perfil, faixa);
  const opcoes = {
    source: FONTE_DO_SERVIDOR.screen,
    videoCodec: codec,
    simulcast: true,
    degradationPreference: prioridade.degradacao,
    // Sem esta linha o cliente monta a escada sozinho -- e monta o degrau de baixo custando
    // um quarto da captura. Quem assiste de uma rede ruim nao alcanca nem esse, e o servidor
    // acaba empurrando mais do que o canal aguenta ate derrubar a pessoa. Declarada aqui, a
    // escada tem um degrau barato de verdade e NAO tem o do meio, que custava a quem
    // transmite quase o mesmo que a camada de cima. Os motivos estao em quality-utils.js.
    screenShareSimulcastLayers: camadasDaTela(perfil),
    screenShareEncoding: { maxBitrate: tetoParaOCodec(teto, codec), maxFramerate: quadrosDaTela }
  };
  // Ver ESCADA_SVC: sem isto, VP9 e AV1 sobem com o cliente e o servidor discordando sobre o
  // que a faixa pequena contém, e o palco recebe 360p a 14 quadros em vez de 1080p a 30.
  if (ehCodecSVC(codec)) opcoes.scalabilityMode = ESCADA_SVC;
  return opcoes;
}

// A escada declarada no perfil vira presets do cliente. O degrau de baixo carrega a taxa de
// quadros dele, baixa de proposito: numa conexao apertada, texto legivel a 15 quadros vale
// mais do que borrao a 30. Nenhum degrau pede mais quadros do que a escolha ja permite -- a
// 30 quadros, o degrau de 15 continua em 15, e nenhum deles vira 60 por causa da escada.
//
// O desconto por codec incide só no degrau de CIMA, e esta é a correção de um erro que
// custava exatamente onde não se podia pagar. O degrau de baixo não é uma fração da captura:
// ele é o piso de rede. Os 300 kbps a 640×360 foram escolhidos por caberem em quase qualquer
// lugar, e é o único degrau que segura na sala quem está com a conexão ruim -- sem ele a
// pessoa não fica com vídeo feio, ela CAI (o porquê está em quality-utils.js). Descontar 40%
// dele em AV1 poupava 120 kbps num envio de megabits e enfraquecia justamente essa garantia.
//
// O topo continua acompanhando o codec, e a distância entre os degraus continua grande o
// bastante para eles serem escolhas distintas para quem assiste: em AV1 são 2,4 Mbps contra
// 0,3 -- oito vezes.
function camadasDaTela(perfil) {
  return (perfil.camadas || []).map(([largura, altura, bitrate, fps]) =>
    new LivekitClient.VideoPreset(largura, altura, bitrate, Math.min(fps, quadrosDaTela)));
}

// Uma tarefa da fila é uma OPERAÇÃO INTEIRA, não uma chamada.
//
// A diferença é o que consertou a faixa que não voltava. Cada publicação e cada remoção
// entravam sozinhas na fila, e as sequências -- "despublique e publique de novo", que é o
// que trocar codec, qualidade ou prioridade faz -- eram duas tarefas com uma fresta entre
// elas. Qualquer outra mudança se encaixava nessa fresta, e a ordem que chegava ao servidor
// de mídia deixava de ser a ordem em que a pessoa clicou: o "publique de novo" da tela
// rodava antes do "despublique" da câmera, que então apagava o que tinha acabado de subir.
// O sintoma era a captura viva aqui e ausente do outro lado, sem erro em lugar nenhum.
//
// Quem chama `naFila` com uma sequência garante que nada se intromete no meio dela. Dentro
// dela usa-se `aplicarPublicacao`, que NÃO reentra na fila -- fazer isso travaria as duas.
function naFila(tarefa) {
  const proxima = filaDePublicacao.then(() => tarefa());
  // A fila nunca carrega rejeição: uma operação que falha não pode cancelar as seguintes.
  filaDePublicacao = proxima.catch(() => {});
  return proxima;
}

function avisarFalhaDePublicacao(fonte, erro) {
  console.warn('Falha ao publicar', fonte, erro);
  status.textContent = `Não foi possível enviar ${fonte === 'camera' ? 'a câmera' : fonte === 'mic' ? 'o microfone' : 'a tela'}. Tente desligar e ligar essa fonte.`;
}

// Uma sequência de mudanças na publicação, com reconciliação garantida no fim. Devolve
// `false` se alguma etapa falhou, para quem chamou não anunciar sucesso.
//
// O `finally` aqui não é zelo: a falha mais comum deste caminho é a publicação expirar sem
// resposta do servidor de mídia, e é exatamente nesse caso que a reconciliação precisa
// rodar, porque ela é quem traz a faixa de volta. Deixar a exceção abortar a sequência
// jogava fora a única chance de consertar -- e o resultado era a captura viva aqui com
// ninguém vendo do outro lado, que é o sintoma que esta fase toda existe para eliminar.
function sequenciaDePublicacao(fonte, tarefa) {
  return naFila(async () => {
    let ok = true;
    try {
      await tarefa();
    } catch (erro) {
      ok = false;
      avisarFalhaDePublicacao(fonte, erro);
    } finally {
      // A reconciliação também pode falhar, e nem por isso a sequência inteira deve
      // estourar: ela roda de novo na mudança seguinte.
      try { await reconciliarPublicacoes(); } catch (_) { ok = false; }
    }
    return ok;
  });
}

// O que foi COMBINADO com o servidor de mídia na publicação, e que por isso `replaceTrack`
// não consegue mudar depois. Fica de fora o que é ajustável no remetente com a faixa no ar
// -- o teto por qualidade de rede, por exemplo, que muda a toda hora e de propósito não
// republica nada.
function assinaturaDePublicacao(opcoes) {
  const escada = opcoes.screenShareSimulcastLayers || opcoes.videoSimulcastLayers || [];
  return JSON.stringify([
    opcoes.videoCodec ?? null,
    opcoes.scalabilityMode ?? null,
    opcoes.simulcast ?? null,
    opcoes.degradationPreference ?? null,
    opcoes.screenShareEncoding?.maxBitrate ?? null,
    opcoes.screenShareEncoding?.maxFramerate ?? null,
    escada.map(preset => [preset.width, preset.height, preset.encoding?.maxBitrate, preset.encoding?.maxFramerate])
  ]);
}

// O que foi combinado com o servidor na última publicação de cada fonte.
const assinaturasPublicadas = { mic: null, camera: null, screen: null, screenAudio: null };

// O corpo de uma publicação, FORA da fila. Só deve ser chamado de dentro de `naFila`.
async function aplicarPublicacao(fonte, faixa) {
  if (!transporte?.conectada) return;
  const local = transporte.sala.localParticipant;
  const anterior = publicacoesLocais[fonte];

  // "false" e essencial: por padrao o servidor de midia ENCERRA a faixa ao despublicar.
  // Quem manda no ciclo de vida das capturas e esta pagina -- sem isto, trocar o perfil
  // de qualidade (que despublica e publica de novo) matava a tela compartilhada.
  const despublicar = async publicacao => {
    await local.unpublishTrack(publicacao.track ?? publicacao, false).catch(() => {});
    publicacoesLocais[fonte] = null;
    assinaturasPublicadas[fonte] = null;
  };

  if (!faixa || faixa.readyState === 'ended') {
    if (anterior) await despublicar(anterior);
    return;
  }

  const opcoes = opcoesDePublicacao(fonte, faixa);
  const assinatura = assinaturaDePublicacao(opcoes);

  // Trocar de camera ou de tela nao precisa republicar: a faixa entra no lugar da atual,
  // sem renegociar e sem piscar para quem esta assistindo.
  //
  // Só enquanto o que foi combinado continuar valendo, e essa condição faltava aqui.
  // `replaceTrack` troca os quadros e nada mais: codec, teto, escada de camadas e taxa
  // máxima ficam como foram publicados. Trocar de câmera depois de escolher outro codec
  // mantinha o codec antigo no ar, calado, e o painel passava a anunciar uma configuração
  // que não era a que estava sendo enviada.
  if (anterior?.track && typeof anterior.track.replaceTrack === 'function' && assinaturasPublicadas[fonte] === assinatura) {
    try { await anterior.track.replaceTrack(faixa); return; }
    catch (_) { await despublicar(anterior); }
  } else if (anterior) {
    await despublicar(anterior);
  }
  publicacoesLocais[fonte] = await local.publishTrack(faixa, opcoes);
  assinaturasPublicadas[fonte] = assinatura;
}

// Substitui o que "definirFaixaEmTodosOsPares" fazia na malha: agora ha um destino so.
function publicarFonte(fonte, faixa) {
  return naFila(() => aplicarPublicacao(fonte, faixa)).catch(erro => avisarFalhaDePublicacao(fonte, erro));
}

// Confere o que o servidor de mídia realmente tem contra o que esta página acha que publicou.
//
// Existe porque as duas listas divergem sem ninguém errar de forma visível: uma renegociação
// que expira, uma queda no meio de um `unpublishTrack`, um `publishTrack` que resolve depois
// de a sala já ter sido substituída. O sintoma é sempre o mesmo e sempre calado -- a captura
// viva aqui, e do outro lado ninguém vendo nada. Rodar isto depois de cada sequência de
// mudanças é mais barato do que descobrir qual das três aconteceu.
async function reconciliarPublicacoes() {
  if (!transporte?.conectada) return;
  const local = transporte.sala.localParticipant;
  const capturas = {
    mic: faixaEnviadaDoMic,
    camera: cameraStream?.getVideoTracks()[0],
    screen: screenStream?.getVideoTracks()[0],
    screenAudio: appAudioTrack?.readyState === 'live' ? appAudioTrack : screenStream?.getAudioTracks()[0]
  };
  for (const [fonte, faixa] of Object.entries(capturas)) {
    if (!faixa || faixa.readyState !== 'live') continue;
    const publicada = publicacoesLocais[fonte];
    // `trackSid` só existe depois de o servidor confirmar. Sem ele, ou com um sid que o
    // participante local não reconhece mais, o que está guardado aqui é um fantasma.
    const viva = publicada?.trackSid && local.trackPublications.has(publicada.trackSid);
    if (viva) continue;
    registrarDiagnostico('midia.reconciliar', `${fonte} estava fora do ar; republicando`);
    publicacoesLocais[fonte] = null;
    assinaturasPublicadas[fonte] = null;
    try { await aplicarPublicacao(fonte, faixa); }
    catch (erro) { avisarFalhaDePublicacao(fonte, erro); }
  }
}

// Nome preservado da malha: a interface inteira chama por aqui e nao precisa saber que
// agora existe um destino so.
function definirFaixaEmTodosOsPares(source, track) {
  // Faixa de microfone recem-publicada nasce ANUNCIADA como ativa, mesmo que a pessoa
  // esteja muda: o anuncio precisa ser refeito por cima dela. Os dois passos vão na MESMA
  // tarefa -- entre publicar e anunciar não pode entrar outra mudança, ou o anúncio chega
  // a uma faixa que já não é a que subiu.
  if (source !== 'mic') return publicarFonte(source, track);
  return naFila(async () => {
    await aplicarPublicacao('mic', track);
    await aplicarMudoDoMic();
  }).catch(erro => avisarFalhaDePublicacao('mic', erro));
}

// `faixa.enabled = false` cala o som de verdade, mas e uma decisao que morre neste
// navegador: o servidor de midia continua anunciando a publicacao como ativa e, do outro
// lado, o icone fica ligado enquanto ninguem ouve nada. Quem conta o mudo para a sala e o
// mute() da publicacao, que viaja pela sinalizacao -- inclusive para quem entrar depois.
//
// Vai pela mesma fila das publicacoes porque a ordem importa: anunciar o mudo de uma faixa
// que ainda esta subindo nao chega a lugar nenhum.
async function aplicarMudoDoMic() {
  const faixa = publicacoesLocais.mic?.track;
  if (typeof faixa?.mute !== 'function') return;
  // micMuted e lido aqui, e nao no agendamento: entre um e outro a pessoa pode ter
  // clicado no botao de novo, e quem vale e o ultimo clique.
  if (faixa.isMuted === micMuted) return;
  await (micMuted ? faixa.mute() : faixa.unmute());
}

function anunciarMudoDoMic() {
  return naFila(aplicarMudoDoMic).catch(() => { /* sala caiu no meio; o proximo anuncio corrige */ });
}

// ---------- Voltar ao ar depois de uma queda ----------

// Uma sessao nova no servidor de midia comeca sem faixa nenhuma, e os objetos de publicacao
// da sessao anterior apontam para um transporte que nao existe mais. Reaproveita-los faria
// `publicarFonte` tentar trocar a faixa de uma publicacao morta -- sem erro visivel e sem
// nada subindo, que e a pior forma de falhar. Por isso a lista e zerada ANTES de republicar.
//
// As capturas em si sobrevivem a queda porque a sala pede que o servidor de midia nao as
// encerre (stopLocalTrackOnUnpublish, em room-transport.js). Sem isso a tela nao voltaria:
// pedi-la de novo exige um gesto da pessoa, e ninguem clica em "compartilhar tela" no meio
// de uma oscilacao de rede que nem percebeu.
// Volta ao ar como UMA operação na fila, do começo ao fim. Voltar de uma queda é justamente
// o momento em que mais coisas acontecem ao mesmo tempo -- a pessoa clicando, o vigia de
// conexão reagindo, o servidor confirmando faixas antigas -- e era aqui que a intercalação
// mais doía: a sessão nova subia meia.
function republicarTudo() {
  return naFila(async () => {
    Object.keys(publicacoesLocais).forEach(fonte => { publicacoesLocais[fonte] = null; });
    Object.keys(assinaturasPublicadas).forEach(fonte => { assinaturasPublicadas[fonte] = null; });

    const viva = faixa => Boolean(faixa) && faixa.readyState === 'live';
    // Cada fonte sobe por conta própria, e uma que falhe não impede as seguintes. Numa volta
    // de queda isso é o que decide se a pessoa reaparece inteira ou pela metade: um
    // microfone que não voltou não é razão para a tela também não voltar.
    const fontes = [['mic', faixaEnviadaDoMic],
      ['camera', cameraStream?.getVideoTracks()[0]],
      ['screen', screenStream?.getVideoTracks()[0]],
      ['screenAudio', viva(appAudioTrack) ? appAudioTrack : screenStream?.getAudioTracks()[0]]];
    for (const [fonte, faixa] of fontes) {
      if (!viva(faixa)) continue;
      try {
        await aplicarPublicacao(fonte, faixa);
        if (fonte === 'mic') await aplicarMudoDoMic();
      } catch (erro) { console.warn('Não voltou ao ar', fonte, erro); }
    }
    // E o que não voltou tem uma segunda chance aqui, antes de qualquer aviso à pessoa.
    try { await reconciliarPublicacoes(); } catch (_) { /* a próxima mudança tenta de novo */ }

    // A qualidade so gera aviso quando MUDA. Quem volta com a rede ainda ruim nao receberia
    // aviso nenhum, e subiria no teto cheio -- direto para a queda seguinte.
    await ajustarEnvioPelaQualidade(transporte?.qualidade);
  }).catch(erro => avisarFalhaDePublicacao('screen', erro));
}

// ---------- Ceder banda quando a rede aperta, do lado de quem ENVIA ----------

// O controle de congestionamento do servidor de midia cuida do que SAI dele para cada
// espectador. O que ENTRA -- a copia que esta pagina envia -- e responsabilidade daqui: se
// a conexao de quem transmite aperta, o servidor so ve a midia chegando picada, e nao ha
// como consertar o que nao chegou.
//
// O ajuste vai direto nos parametros do remetente, sem republicar. Republicar renegocia, e
// renegociar numa conexao que ja esta ruim e exatamente o que nao se deve fazer: e a
// diferenca entre "a imagem piorou um pouco" e "a sala caiu". Só maxBitrate e tocado --
// os outros campos ficam como estao, porque um deles e o "active" com que o servidor
// desliga as camadas que ninguem esta consumindo.
const TETOS_POR_QUALIDADE = { poor: 0.25, lost: 0.25, good: 0.6, excellent: 1 };
// Os tetos de origem de cada camada, guardados na primeira vez que mexemos no remetente.
// Sem eles, aplicar 60% duas vezes daria 36%: o fator tem de incidir sempre sobre o valor
// original, nunca sobre o que ja foi reduzido.
const tetosOriginais = new WeakMap();
// O fator vigente é de CADA remetente, não da página.
//
// Era uma variável só, e o "se o fator não mudou, não faça nada" que ela guardava mentia
// justamente quando importava. Republicar a tela ou trocar de câmera cria um remetente NOVO,
// no teto cheio, e esta função voltava sem tocar nele porque a página "já estava" em 60% --
// numa rede que continuava ruim. Era também por isso que o codec de reserva nunca era
// ajustado: ele tem remetente próprio, e nunca coube na variável única.
//
// Isso não é só teoria: na auditoria de codecs, H.264 e VP8 foram medidos com o teto cheio
// enquanto VP9 e AV1 ficaram presos em 60% do que já era um orçamento menor -- 1,68 e 1,44
// Mbps contra 4. A tabela que comparava os quatro estava comparando orçamentos diferentes.
const fatorAplicado = new WeakMap();
// O último fator que chegou a ser aplicado, só para a interface poder dizer "o teto está em
// 60% porque a sua conexão foi classificada como instável". Um bitrate que cai pela metade
// sem explicação parece defeito; com a frase, é uma decisão que a pessoa entende.
let ultimoFatorDeQualidade = 1;

// Todos os remetentes de uma faixa: o principal e os dos codecs de reserva.
//
// O de reserva existe quando alguém na sala não decodifica o codec escolhido -- o cliente
// então codifica a imagem DE NOVO, em VP8, e esse segundo fluxo tem remetente próprio. Ele
// custa processador de quem transmite e banda de upload como qualquer outro, e ficava de
// fora de todo controle daqui.
function remetentesDaFaixa(faixa) {
  const lista = [];
  if (typeof faixa?.sender?.getParameters === 'function') lista.push(faixa.sender);
  faixa?.simulcastCodecs?.forEach(info => {
    if (typeof info?.sender?.getParameters === 'function') lista.push(info.sender);
  });
  return lista;
}

// Duas coisas mexem nos parâmetros do MESMO remetente -- o teto por qualidade de rede e a
// escala por custo de codificação --, e cada uma faz o ciclo ler-alterar-escrever inteiro.
// Sem fila, a que lesse primeiro e escrevesse depois gravaria os parâmetros de ANTES da
// outra mudança, desfazendo-a. O sintoma seria um ajuste que "não pegou" de vez em quando,
// que é a forma mais calada possível de errar.
let filaDeParametros = Promise.resolve();

function naFilaDeParametros(tarefa) {
  const proxima = filaDeParametros.then(() => tarefa());
  filaDeParametros = proxima.catch(() => {});
  return proxima;
}

function ajustarEnvioPelaQualidade(qualidade) {
  return naFilaDeParametros(() => aplicarTetoDeQualidade(qualidade));
}

async function aplicarTetoDeQualidade(qualidade) {
  const fatorDaRede = TETOS_POR_QUALIDADE[qualidade];
  if (!fatorDaRede) return;
  const fator = economiaDeDadosAtiva ? Math.min(.4, fatorDaRede) : fatorDaRede;
  const aplicado = [];
  for (const fonte of ['screen', 'camera']) {
    for (const remetente of remetentesDaFaixa(publicacoesLocais[fonte]?.track)) {
      if (fatorAplicado.get(remetente) === fator) continue;
      try {
        const parametros = remetente.getParameters();
        if (!parametros.encodings?.length) continue;
        let originais = tetosOriginais.get(remetente);
        if (!originais) {
          originais = parametros.encodings.map(encoding => encoding.maxBitrate || 0);
          tetosOriginais.set(remetente, originais);
        }
        parametros.encodings.forEach((encoding, indice) => {
          const base = originais[indice];
          // Nunca abaixo do degrau mais baixo util: cortar alem disso nao economiza nada que
          // importe e so transforma a imagem em pasta.
          if (base) encoding.maxBitrate = Math.max(120_000, Math.round(base * fator));
        });
        await remetente.setParameters(parametros);
        fatorAplicado.set(remetente, fator);
        aplicado.push(fonte);
      } catch (_) { /* O proximo aviso de qualidade tenta de novo. */ }
    }
  }
  if (!aplicado.length) return;
  ultimoFatorDeQualidade = fator;
  registrarDiagnostico('midia.tetoDeEnvio', `${Math.round(fator * 100)}% em ${[...new Set(aplicado)].join(' e ')}`);
}

// ---------- Encolher a imagem em vez de perder quadros ----------
//
// O libwebrtc TEM um adaptador que faz exatamente isto: quando o codificador não dá conta,
// ele reduz a resolução da fonte e preserva a taxa de quadros. Ele não está agindo aqui, e
// a medição de campo é a evidência -- as duas camadas em `limitado por=none`, a fonte
// entregando 44 quadros e a saída em 24. Um adaptador ativo teria encolhido a imagem; o que
// se viu foi quadro descartado com a resolução intacta.
//
// A explicação mais provável é a escada de simulcast: declarar `scaleResolutionDownBy` por
// camada fixa a resolução de cada degrau, e o adaptador não tem por onde encolher sem
// quebrar o que foi combinado com o servidor. Seja essa a causa ou outra, o efeito é o que
// importa, e ele é o pior dos dois males numa transmissão: quadro perdido é o que produz o
// travamento que se nota. Resolução menor, quase ninguém repara.
//
// Então a escala passa a ser nossa. O sinal já estava medido e não precisou de nada novo:
// `custoDeCodificacao` soma o tempo de codificação de todas as camadas -- elas sobem em
// sequência, pelo mesmo adaptador, na mesma thread -- e compara com os 1000 ms de um
// segundo. Passando do teto, a camada de cima encolhe um degrau; sobrando folga para o
// degrau anterior caber, ela volta.
//
// Só a camada de CIMA encolhe. A de baixo é o piso de rede -- 640x360 a 300 kbps, o único
// degrau que segura na sala quem está com a conexão ruim (o porquê está em
// quality-utils.js) --, e encolhê-la não pouparia codificação que importe.
//
// O `maxBitrate` fica intacto, e isso é decisão e não esquecimento. Ele já sai dos pixels
// que a CAPTURA entrega, é teto e não piso, e mexer nas duas coisas de uma vez tornaria
// impossível dizer qual delas produziu o efeito na primeira sessão em que isto rodar. Se a
// medição mostrar banda gasta numa imagem que encolheu, o passo seguinte é fazer o teto
// acompanhar os pixels.

// A decisão -- qual degrau, e quando mudar de degrau -- mora em quality-utils.js, onde ela é
// uma função pura e testável sem navegador. Aqui fica o que depende do navegador: os
// remetentes, os parâmetros e o estado da sessão.
const { CUSTO_QUE_APERTA, ESCADA_DE_ESCALA } = RoomQuality;

let apertosSeguidos = 0;
let folgasSeguidas = 0;
// A escala vigente é de CADA remetente, pela mesma razão que o fator de rede é: republicar a
// tela cria remetentes novos, na escala cheia, e um estado de página mentiria sobre eles.
const escalaExtra = new WeakMap();
const escalasOriginais = new WeakMap();
// Só para a interface poder DIZER que a imagem encolheu. Uma resolução menor que a pedida,
// sem explicação, parece defeito -- e a conclusão seria razoável.
let ultimaEscalaDaTela = 1;
// "1,25" e não "1,3": `comVirgula` arredonda para uma casa, e aqui o número é um degrau da
// escada, não uma medição. Arredondá-lo faria a interface anunciar uma escala que não existe.
const escalaEmTexto = escala => String(escala).replace('.', ',');

// Sem seletor na interface, de propósito: escolher entre resolução e quadros foi justamente
// o que se retirou, porque é uma decisão que a medição toma melhor do que quem está jogando.
// Isto existe para diagnóstico -- `nexoEscalaAutomatica = false` no console congela a escala
// onde ela está, o que permite comparar dois minutos com e sem.
let escalaAutomatica = true;
Object.defineProperty(window, 'nexoEscalaAutomatica', {
  get: () => escalaAutomatica,
  set: valor => { escalaAutomatica = Boolean(valor); }
});

// A camada de cima é a de MENOR `scaleResolutionDownBy`, e procurá-la assim não é
// preciosismo: o cliente monta a escada do degrau pequeno para o grande, e a medição a
// ordena ao contrário. Usar índice fixo aqui encolheria exatamente o degrau que não pode.
function indiceDaCamadaAlta(escalas) {
  let alvo = 0;
  escalas.forEach((escala, i) => { if (escala < escalas[alvo]) alvo = i; });
  return alvo;
}

async function aplicarEscalaPeloCusto(q) {
  if (!escalaAutomatica) return;
  const remetentes = remetentesDaFaixa(publicacoesLocais.screen?.track);
  if (!remetentes.length) return;
  // Em espera não se decide nada: sem ninguém assistindo, o servidor desliga as camadas e
  // não há custo de codificação para medir. Reagir a esse zero devolveria a escala cheia
  // logo antes de alguém abrir a tela, justamente na hora em que ela vai custar.
  const custo = q && !q.emEspera ? custoDeCodificacao(q) : null;
  if (!custo) return;
  const decidido = RoomQuality.proximaEscala({
    escala: ultimaEscalaDaTela, custoProjetado: custo.projetado,
    apertos: apertosSeguidos, folgas: folgasSeguidas
  });
  apertosSeguidos = decidido.apertos;
  folgasSeguidas = decidido.folgas;
  const desejada = decidido.escala;
  const anterior = ultimaEscalaDaTela;
  ultimaEscalaDaTela = desejada;
  for (const remetente of remetentes) {
    // Um remetente que a página nunca tocou entra aqui mesmo que a escala não tenha mudado:
    // republicar cria remetentes novos, na escala cheia, e o de codec de reserva nasce depois
    // dos outros. Foi exatamente assim que o fator de rede deixava o codec de reserva de fora.
    if (escalaExtra.get(remetente) === desejada) continue;
    try {
      const parametros = remetente.getParameters();
      if (!parametros.encodings?.length) continue;
      let originais = escalasOriginais.get(remetente);
      if (!originais) {
        originais = parametros.encodings.map(encoding => encoding.scaleResolutionDownBy || 1);
        escalasOriginais.set(remetente, originais);
      }
      // Sempre sobre o ORIGINAL, nunca sobre o que já foi reduzido: aplicar 1,25 duas vezes
      // daria 1,5625, um degrau que não está na escada e do qual não há como voltar.
      const alta = indiceDaCamadaAlta(originais);
      parametros.encodings[alta].scaleResolutionDownBy = originais[alta] * desejada;
      await remetente.setParameters(parametros);
      escalaExtra.set(remetente, desejada);
    } catch (_) { /* A medição seguinte tenta de novo. */ }
  }
  if (anterior === desejada) return;
  registrarDiagnostico('midia.escalaDaTela', desejada === 1
    ? 'imagem de volta ao tamanho cheio'
    : `imagem encolhida ${escalaEmTexto(desejada)}x para os quadros caberem`);
}

function paraCadaPar(fn) { peers.forEach(fn); }

// Limpa TUDO que pertence a essa pessoa, esteja ela ainda no mapa ou nao.
//
// A guarda que existia aqui ("se nao esta em peers, nao faca nada") era a origem dos
// fantasmas: o servidor de midia avisa que alguem saiu apagando a pessoa do mapa PRIMEIRO e
// so entao chamando esta funcao -- que entao achava o mapa limpo e ia embora sem tirar o
// quadradinho. O aviso do socket, que chama daqui com a pessoa ainda no mapa, funcionava; o
// do servidor de midia, nao. Por isso o fantasma aparecia justamente quando o socket
// demorava ou se perdia, que e o que mais acontece em celular e em sala cheia.
function removerPar(id) {
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
        pintarBotaoDaCamera(false);
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
  // O rótulo é sempre "Virar" — o nome inteiro fica no título e no leitor de tela, que é
  // onde ele cabe sem alargar o botão a cada troca de lado.
  flipCameraBtn.title = traseira ? 'Voltar para a câmera frontal' : 'Usar a câmera traseira';
  flipCameraBtn.setAttribute('aria-label', flipCameraBtn.title);
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
// Quem desliga a reducao de ruido costuma ter um motivo que nao muda de uma sessao para
// a outra -- um microfone bom, um instrumento, uma placa que ja limpa o som. Religar
// sozinho a cada entrada desfaz essa decisao todo dia.
let filtroDeRuidoLigado = window.Preferencias ? window.Preferencias.ler('reducaoDeRuido', true) !== false : true;
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
      status.textContent = 'Redução de ruído indisponível aqui. A voz continua com o filtro do navegador.';
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
  // "RNNoise" é o nome da biblioteca, não do que ela faz: o rótulo diz o resultado, e o
  // nome fica no título para quem for procurar.
  noiseBtn.textContent = ativo ? 'Ruído reduzido' : carregandoFiltro ? 'Preparando…' : 'Filtro do navegador';
  noiseBtn.setAttribute('aria-pressed', String(filtroDeRuidoLigado));
  noiseBtn.classList.toggle('secondary', !ativo);
  noiseBtn.title = ativo ? 'RNNoise limpando sua voz neste computador. Clique para usar só o filtro do navegador.'
    : erroDoFiltro ? 'RNNoise indisponível neste aparelho. O filtro do navegador continua valendo.'
    : 'Clique para ligar a redução de ruído do Nexo.';
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
  window.Preferencias?.gravar('reducaoDeRuido', filtroDeRuidoLigado);
  if (filtroDeRuidoLigado) montarFiltroDeRuido();
  else desmontarFiltroDeRuido();
  liberarContextoDeAudio();
  escolherFaixaDoMic();
  status.textContent = filtroDeRuidoLigado
    ? 'Redução de ruído ligada. O botão avisa quando ela estiver valendo.'
    : 'Redução de ruído desligada. Vale a do próprio navegador.';
};

// ---------- Mic ----------
// O rotulo dos botoes da barra e o NOME da coisa, sempre o mesmo; quem conta o estado e o
// icone (riscado quando desligado) e a cor. Antes cada botao contava uma historia diferente
// -- o microfone dizia como estava ("Mic mudo"), a camera dizia o que faria ("Ligar
// camera") -- e o texto ainda mudava de largura a cada clique, empurrando a barra inteira.
function atualizarBotaoDoMic() {
  const semMicrofone = !micTrack;
  const desligado = semMicrofone || micMuted;
  micBtn.setAttribute('aria-pressed', String(!desligado));
  micBtn.classList.toggle('secondary', desligado);
  micBtn.classList.toggle('desligado', desligado);
  micBtn.title = semMicrofone ? 'Ativar o microfone' : micMuted ? 'Tirar o microfone do mudo' : 'Deixar o microfone mudo';
  micBtn.setAttribute('aria-label', micBtn.title);
  atualizarEspelhoDosAparelhos();
}

function pintarBotaoDaCamera(ligada) {
  cameraBtn.setAttribute('aria-pressed', String(ligada));
  cameraBtn.classList.toggle('desligado', !ligada);
  cameraBtn.title = ligada ? 'Desligar a câmera' : 'Ligar a câmera';
  cameraBtn.setAttribute('aria-label', cameraBtn.title);
  atualizarEspelhoDosAparelhos();
}

function pintarBotaoDaTela(compartilhando) {
  screenBtn.setAttribute('aria-pressed', String(compartilhando));
  screenBtn.classList.toggle('desligado', !compartilhando);
  screenBtn.title = compartilhando ? 'Parar de compartilhar a tela' : 'Compartilhar sua tela';
  screenBtn.setAttribute('aria-label', screenBtn.title);
}

let abrindoMicrofone = false;

// Primeiro clique: e aqui que o microfone e pedido ao navegador, e nao ao entrar na sala.
async function ativarMicrofone() {
  if (abrindoMicrofone) return;
  if (!temMediaDevices) {
    status.textContent = 'Este navegador só libera o microfone por HTTPS (ou localhost).';
    return;
  }
  abrindoMicrofone = true;
  micBtn.disabled = true;
  micBtn.classList.add('ocupado');
  try {
    micStream = await abrirMicrofone();
    micTrack = micStream.getAudioTracks()[0];
    instrumentarFaixaDoMic(micTrack);
    faixaEnviadaDoMic = micTrack;
    micMuted = false;
    micTrack.enabled = true;
    noiseBtn.hidden = false;
    // O botao nasce dizendo a verdade. `montarFiltroDeRuido` desiste logo na primeira
    // linha quando a reducao esta desligada -- e desiste ANTES de pintar --, entao quem
    // guardou "desligado" via o botao aparecer anunciando "Ruído reduzido".
    atualizarBotaoDeRuido();
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
    // A permissão pode demorar mais que o toque. Se o Espaço já foi solto quando a faixa
    // chega, ela nasce muda; sem isso um toque curto deixaria o microfone aberto.
    if (pushToTalkAtivo && !pushToTalkPressionado && micTrack && !micMuted) {
      micMuted = true;
      micTrack.enabled = false;
      if (faixaEnviadaDoMic && faixaEnviadaDoMic !== micTrack) faixaEnviadaDoMic.enabled = false;
      escolherFaixaDoMic();
      anunciarMudoDoMic();
    }
    micBtn.disabled = false;
    micBtn.classList.remove('ocupado');
    atualizarBotaoDoMic();
    atualizarTile('self');
    enviarEstado();
    atualizarModoSegundoPlano();
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
  // A faixa publicada pode ser a mesma de antes (nada a republicar): o anúncio do mudo sai
  // daqui de qualquer jeito.
  anunciarMudoDoMic();
  atualizarBotaoDoMic();
  atualizarTile('self');
  enviarEstado();
  atualizarModoSegundoPlano();
}
micBtn.onclick = alternarMic;

// Ensurdecer é local: corta tudo que chega e, como no Discord, também fecha o microfone.
//
// Ele NÃO varre o DOM apagando `muted` elemento a elemento. Essa era a primeira versão, e ela
// se desfazia sozinha: `definirAudioDaVoz` e `atualizarAudioDeTela` reescrevem `muted` a cada
// mudança de mídia da sala, então bastava alguém ligar a câmera para o som voltar. Guardar o
// mudo anterior num `dataset` tinha o defeito simétrico -- calar uma pessoa durante o
// ensurdecimento era esquecido ao voltar. Aqui o ensurdecimento é só mais uma condição de
// quem JÁ decide o mudo, e reaplicá-lo é reexecutar essas duas funções.
const deafenBtn = document.getElementById('deafenBtn');
function aplicarEnsurdecimento() {
  tiles.forEach((_refs, id) => definirAudioDaVoz(id, { lembrar: false }));
  atualizarAudioDeTela();
  window.NexoSoundboard?.definirMudoGlobal?.(ensurdecido);
}
function alternarEnsurdecimento() {
  ensurdecido = !ensurdecido;
  if (ensurdecido) {
    micAntesDeEnsurdecer = micMuted;
    if (!micMuted) alternarMic();
  } else if (!micAntesDeEnsurdecer && micTrack && micMuted && !pushToTalkAtivo) alternarMic();
  aplicarEnsurdecimento();
  // O rótulo é o nome fixo da coisa, como em "Microfone" e "Câmera"; quem conta o estado é o
  // ícone, que aparece cortado, e o fundo de atenção que o microfone fechado já usa.
  deafenBtn.setAttribute('aria-pressed', String(ensurdecido));
  deafenBtn.classList.toggle('secondary', !ensurdecido);
  deafenBtn.title = ensurdecido ? 'Voltar a ouvir a sala' : 'Ensurdecer: silenciar toda a sala';
  deafenBtn.setAttribute('aria-label', deafenBtn.title);
}
deafenBtn.onclick = alternarEnsurdecimento;

const pushToTalk = document.getElementById('pushToTalk');
try { pushToTalkAtivo = localStorage.getItem('sala.pushToTalk') === '1'; } catch (_) {}
pushToTalk.checked = pushToTalkAtivo;
pushToTalk.addEventListener('change', () => {
  pushToTalkAtivo = pushToTalk.checked;
  try { localStorage.setItem('sala.pushToTalk', pushToTalkAtivo ? '1' : '0'); } catch (_) {}
  if (pushToTalkAtivo && micTrack && !micMuted) alternarMic();
});
function alvoEditavel(alvo) { return Boolean(alvo?.closest?.('input,textarea,select,[contenteditable="true"]')); }
// Fechar o microfone não pode depender de o `keyup` chegar. Alt+Tab com o Espaço apertado, um
// clique que leva o foco para o campo do chat no meio da fala, a aba que vai para segundo
// plano -- em todos esses casos o `keyup` nunca acontece, e o microfone ficava aberto sem
// ninguém saber. Qualquer um desses caminhos passa por aqui.
function soltarPushToTalk() {
  if (!pushToTalkPressionado) return;
  pushToTalkPressionado = false;
  if (pushToTalkAtivo && micTrack && !micMuted) alternarMic();
}
window.addEventListener('blur', soltarPushToTalk);
document.addEventListener('visibilitychange', () => { if (document.hidden) soltarPushToTalk(); });
document.addEventListener('keydown', evento => {
  if (evento.code === 'Space' && pushToTalkAtivo && !evento.repeat && !alvoEditavel(evento.target)) {
    evento.preventDefault();
    pushToTalkPressionado = true;
    if (!micTrack) ativarMicrofone();
    else if (micMuted && !ensurdecido) alternarMic();
    return;
  }
  if (!(evento.ctrlKey && evento.shiftKey) || evento.repeat) return;
  const tecla = evento.key.toLowerCase();
  if (tecla === 'm') { evento.preventDefault(); alternarMic(); }
  else if (tecla === 'd') { evento.preventDefault(); alternarEnsurdecimento(); }
  else if (tecla === 'c') { evento.preventDefault(); cameraBtn.click(); }
  else if (tecla === 'h') { evento.preventDefault(); chatToggle.click(); }
  else if (tecla === 'e') { evento.preventDefault(); devicesBtn.click(); }
  else if (tecla === 'p') { evento.preventDefault(); document.getElementById('presenceBtn').click(); }
});
document.addEventListener('keyup', evento => {
  if (evento.code !== 'Space') return;
  // Soltar o Espaço fecha o microfone mesmo que o foco tenha ido parar num campo de texto
  // entre o aperto e a soltura: o que vale é ter sido este atalho que abriu.
  if (pushToTalkPressionado && !alvoEditavel(evento.target)) evento.preventDefault();
  soltarPushToTalk();
});

const presenceBtn = document.getElementById('presenceBtn');
const presenceMenu = document.getElementById('presenceMenu');
function atualizarPresencaNaInterface(identidade, presenca) {
  const id = identidade === myId ? 'self' : identidade;
  if (id) atualizarTile(id);
  document.dispatchEvent(new CustomEvent('room-update'));
  // Só a MINHA escolha marca o menu. Sem esta guarda, a presença de qualquer outra pessoa
  // passava por aqui e desmarcava os cinco botões -- o meu status sumia da lista por conta
  // de alguém do outro lado ter pedido a palavra.
  if (identidade !== myId) return;
  presenceMenu.querySelectorAll('[data-presence]').forEach(b => b.classList.toggle('ativo', b.dataset.presence === presenca));
}

// ---------- Reações que atravessam a sala ----------
//
// A primeira versão subia em linha reta, na mesma velocidade e do mesmo pixel: três pessoas
// reagindo juntas produziam um emoji só, grosso, piscando. O que dá vida a isto é a variação
// -- cada reação sobe a própria altura, com a própria demora e a própria deriva lateral.
//
// A subida e a deriva ficam em DOIS elementos aninhados de propósito: uma transformação só
// não consegue ter duas curvas de tempo diferentes, e é justamente o descasamento entre elas
// (sobe acelerando, gingando devagar) que tira o movimento do trilho.
const REACOES_SIMULTANEAS = 18;
function mostrarReacaoDaSala({ identidade, nome, reacao }) {
  const caixa = document.getElementById('roomReactions');
  // Teto contra o dedo preso no botão: a sala continua respondendo, e o excesso simplesmente
  // não vira elemento. Sai a mais antiga, que já está quase no fim do percurso.
  while (caixa.childElementCount >= REACOES_SIMULTANEAS) caixa.firstElementChild.remove();
  const id = identidade === myId ? 'self' : identidade;
  const quadradinho = tiles.get(id)?.root;
  const plateiaVisivel = !document.querySelector('.app').classList.contains('plateia-oculta');
  const doQuadradinho = Boolean(plateiaVisivel && quadradinho?.getClientRects().length);
  const origem = (doQuadradinho ? quadradinho : stage).getBoundingClientRect();
  const sorteio = (minimo, maximo) => minimo + Math.random() * (maximo - minimo);

  const aviso = document.createElement('span');
  aviso.className = 'room-reaction';
  aviso.setAttribute('role', 'img');
  aviso.setAttribute('aria-label', `${nome || 'Alguém'} reagiu com ${reacao}`);
  const emoji = elemento('span', 'room-reaction-emoji', reacao);
  emoji.setAttribute('aria-hidden', 'true');
  aviso.append(emoji);
  // Saindo do quadradinho já se sabe de quem é; do palco, não -- e aí o nome é o que
  // transforma um emoji solto em alguém reagindo.
  if (!doQuadradinho && nome) {
    const autoria = elemento('span', 'room-reaction-nome', nome);
    autoria.setAttribute('aria-hidden', 'true');
    aviso.append(autoria);
  }

  // Do quadradinho as reações saem quase do mesmo ponto, mas nunca do mesmo pixel; do palco
  // elas se espalham pela largura de baixo, como quem joga confete de baixo para cima.
  const espalhar = doQuadradinho ? Math.min(26, origem.width / 5) : Math.min(150, origem.width / 3.2);
  const x = origem.left + origem.width / 2 + sorteio(-espalhar, espalhar);
  const y = doQuadradinho ? origem.top + origem.height * .52 : origem.bottom - Math.min(76, origem.height * .17);
  aviso.style.setProperty('--reaction-x', `${Math.round(x)}px`);
  aviso.style.setProperty('--reaction-y', `${Math.round(y)}px`);
  aviso.style.setProperty('--reaction-subida', `${Math.round(sorteio(doQuadradinho ? 120 : 170, doQuadradinho ? 180 : 250))}px`);
  aviso.style.setProperty('--reaction-deriva', `${Math.round(sorteio(14, 34)) * (Math.random() < .5 ? -1 : 1)}px`);
  aviso.style.setProperty('--reaction-giro', `${Math.round(sorteio(7, 17)) * (Math.random() < .5 ? -1 : 1)}deg`);
  aviso.style.setProperty('--reaction-duracao', `${sorteio(2, 2.7).toFixed(2)}s`);
  aviso.style.setProperty('--reaction-escala', sorteio(.9, 1.12).toFixed(2));
  caixa.append(aviso);
  // `animationend` dispensa o cronômetro paralelo que precisava ser mantido em sincronia com
  // a duração do CSS -- e que ficava para trás assim que a duração passou a ser sorteada.
  aviso.addEventListener('animationend', evento => { if (evento.target === aviso) aviso.remove(); });
}
// O menu nasce ancorado no botão, e não numa distância fixa da quina. Com a barra lateral
// recolhida -- ou aberta como gaveta, no celular -- o botão muda de lugar, e um `left` fixo
// deixava o menu flutuando sozinho no meio da tela, longe do que o abriu.
//
// Ele é `role="menu"`, e não `role="dialog"`: room-ui.js junta TODOS os `[role="dialog"]` e
// trata cada um como modal, marcando a sala inteira como `inert` enquanto estiver aberto.
// Um popover de status fazia a sala parar -- e, pior, o `inert` não move o foco de onde
// estava: quem tivesse o cursor no campo do chat o via piscando num campo que não aceitava
// mais nenhuma tecla, que era o "não consigo editar" que aparecia de vez em quando.
function posicionarMenuDePresenca() {
  presenceMenu.classList.remove('hidden');
  const botao = presenceBtn.getBoundingClientRect();
  const visivel = botao.width > 4;
  const ancora = visivel ? botao : document.querySelector('.control-bar').getBoundingClientRect();
  const folga = 10;
  const esquerda = visivel ? ancora.left : ancora.left + folga;
  presenceMenu.style.left = `${Math.round(Math.min(Math.max(folga, esquerda), Math.max(folga, window.innerWidth - presenceMenu.offsetWidth - folga)))}px`;
  const acimaDaAncora = window.innerHeight - ancora.top + folga;
  presenceMenu.style.bottom = `${Math.round(Math.min(acimaDaAncora, Math.max(folga, window.innerHeight - presenceMenu.offsetHeight - folga)))}px`;
}
function fecharMenuDePresenca() {
  presenceMenu.classList.add('hidden');
  presenceBtn.setAttribute('aria-expanded', 'false');
}
presenceBtn.onclick = evento => {
  evento.stopPropagation();
  if (presenceMenu.classList.contains('hidden')) { posicionarMenuDePresenca(); presenceBtn.setAttribute('aria-expanded', 'true'); }
  else fecharMenuDePresenca();
};
presenceMenu.addEventListener('click', evento => {
  const botao = evento.target.closest('button');
  if (!botao || !socket?.connected) return;
  if (botao.dataset.presence !== undefined) {
    presencaLocal = botao.dataset.presence;
    socket.emit('sinal-presenca', { presenca: presencaLocal });
    atualizarPresencaNaInterface(myId, presencaLocal);
    fecharMenuDePresenca();
  } else if (botao.dataset.reaction) {
    socket.emit('sinal-presenca', { reacao: botao.dataset.reaction });
    fecharMenuDePresenca();
  }
});
document.addEventListener('click', evento => { if (!evento.target.closest('#presenceMenu,#presenceBtn')) fecharMenuDePresenca(); });
document.addEventListener('keydown', evento => {
  if (evento.key === 'Escape' && !presenceMenu.classList.contains('hidden')) { evento.stopPropagation(); fecharMenuDePresenca(); }
}, true);

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
    ? 'Os nomes aparecem depois que você ativa o microfone ou a câmera uma vez.'
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
  instrumentarFaixaDoMic(micTrack);
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
      pintarBotaoDaCamera(false);
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

devicesBtn.onclick = () => { listarDispositivos(); mostrarOQueELembrado(); devicesPanel.classList.remove('hidden'); };

// ---------- O que a sala lembra de voce ----------
//
// Uma preferencia guardada e util ate o dia em que ela vira um misterio: alguem baixou o
// volume de fulano ha dois meses, esqueceu, e agora nao ouve a pessoa sem saber por que --
// e nao ha nada na tela que explique. Dizer quantas escolhas estao guardadas, e permitir
// apaga-las de uma vez, e o que impede essa camada de virar um defeito silencioso.
function mostrarOQueELembrado() {
  const texto = document.getElementById('lembradosTexto');
  const botao = document.getElementById('esquecerBtn');
  if (!texto || !botao || !window.Preferencias) return;
  const { pessoas, salas } = window.Preferencias.resumo();
  const partes = [];
  if (pessoas) partes.push(`volume ajustado para ${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'}`);
  if (salas) partes.push(`a mesa de sons de ${salas} ${salas === 1 ? 'sala' : 'salas'}`);
  texto.textContent = partes.length
    ? `Guardado: ${partes.join(' e ')}, além dos aparelhos e da qualidade escolhidos. Tudo fica só neste navegador.`
    : 'Só os aparelhos e a qualidade escolhidos. Volumes ajustados por pessoa aparecem aqui.';
  botao.disabled = !partes.length;
}

document.getElementById('esquecerBtn').onclick = () => {
  if (!window.Preferencias?.esquecerTudo()) return;
  // Devolve o volume de todo mundo que esta na sala AGORA ao padrao: sem isto a tela
  // continuaria mostrando o que acabou de ser esquecido, ate alguem sair e voltar.
  for (const id of tiles.keys()) {
    if (id === 'self') continue;
    const refs = tiles.get(id);
    refs.volumeDeVoz = 1;
    refs.localMute = false;
    definirAudioDaVoz(id, { lembrar: false });
    const tela = volumeDaTela.get(id);
    if (tela) { tela.nivel = 1; tela.mudo = false; definirAudioDaTela(id, { lembrar: false }); }
  }
  // A mesa de sons guarda o volume dela por fora deste mapa, e em chaves mais antigas que
  // esta camada. Sem avisá-la, "esquecer tudo" deixaria justamente o ajuste mais audível
  // de pé -- e a pessoa continuaria sem ouvir os sons, sem nada na tela explicando.
  window.NexoSoundboard?.esquecerAjustes?.();
  mostrarOQueELembrado();
  status.textContent = 'Pronto: os ajustes guardados neste navegador foram esquecidos.';
};
devicesClose.onclick = () => devicesPanel.classList.add('hidden');
devicesPanel.addEventListener('click', (e) => {
  if (e.target === devicesPanel) devicesPanel.classList.add('hidden');
});
// O painel fecha por quatro caminhos (botão, clique no fundo, Esc, e o foco do room-ui):
// observar a classe pega todos de uma vez, em vez de lembrar de chamar em cada um.
new MutationObserver(() => atualizarEspelhoDosAparelhos())
  .observe(devicesPanel, { attributes: true, attributeFilter: ['class'] });

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
  cpu: 'O processador não dá conta desta qualidade. Baixe um nível, feche o que estiver pesado ou escolha Fluidez.',
  bandwidth: 'Sua conexão de subida não dá conta. Baixe a qualidade — nada aqui contorna o limite do link.',
  other: 'O navegador está limitando o envio por outro motivo.'
};

// O teto de uma combinação, já com tudo que o envio vai mesmo carregar: os pixels da captura
// em vez dos do perfil, a taxa escolhida e o desconto do codec.
function tetoAnunciado(perfil) {
  return tetoParaOCodec(tetoDaTela(perfil), codecDePublicacao('screen'));
}

// Cada rótulo é calculado, e nenhum é escrito à mão.
//
// Os que eram fixos no HTML mentiam os três: o título anunciava "· 30 fps" mesmo com fluidez
// escolhida, e cada opção de resolução prometia um teto ("até 2 / 4 / 6 Mbps") que deixou de
// ser verdade quando o orçamento passou a acompanhar a captura. Agora a opção diz o que
// aquela escolha custaria AGORA, com esta fonte, esta taxa e este codec -- e escolher entre
// elas é comparar números reais em vez de rótulos.
function atualizarRotulosDeQualidade() {
  seletoresDeQualidade.forEach(select => {
    [...select.options].forEach(opcao => {
      const perfil = RoomQuality.profiles[opcao.value];
      if (perfil) opcao.textContent = `${perfil.label} · até ${emMegabits(tetoAnunciado(perfil))}`;
    });
  });
  const dica = document.getElementById('fpsDica');
  const dicaDoEnvio = document.getElementById('shareFpsDica');
  // Os dois tetos da MESMA resolução, lado a lado: é a comparação que decide a escolha, e
  // ela não é óbvia -- dobrar os quadros não dobra a banda, porque quadros vizinhos se
  // parecem e a compressão vive disso.
  const perfil = perfilAtual();
  const medidas = screenStream?.getVideoTracks()[0]?.getSettings?.() || {};
  const largura = Math.min(medidas.width || perfil.width, perfil.width);
  const altura = Math.min(medidas.height || perfil.height, perfil.height);
  const codec = codecDePublicacao('screen');
  const em = fps => emMegabits(tetoParaOCodec(RoomQuality.tetoDeEnvio(largura, altura, fps), codec));
  // Quando a resolução já bate no teto de conta, mais quadros deixam de ganhar banda e
  // passam a DIVIDIR a mesma -- e aí a definição de cada quadro cai. É o problema que esta
  // separação corrigiu em 1080p reaparecendo em 1440p, agora por um motivo diferente e
  // legítimo (o custo por espectador), e calar sobre isso seria deixar a pessoa escolher
  // "mais" acreditando que é melhor.
  const noTeto = RoomQuality.tetoDeEnvio(largura, altura, 60) >= RoomQuality.TETO_ABSOLUTO
    && RoomQuality.tetoDeEnvio(largura, altura, 30) >= RoomQuality.TETO_ABSOLUTO;
  const texto = `Nesta resolução: 30 quadros até ${em(30)}, 60 quadros até ${em(60)}.`
    + (noTeto
      ? ` Os dois batem no teto de ${emMegabits(RoomQuality.TETO_ABSOLUTO)}, que existe porque o servidor manda uma cópia por espectador.`
        + ' Aqui 60 quadros não ganham banda, dividem a mesma: mais movimento, menos definição em cada quadro.'
        + ' Para 60 quadros com imagem cheia, uma resolução abaixo entrega mais.'
      : ' Dobrar os quadros não dobra a banda, mas dobra o trabalho do seu processador.');
  if (dica) dica.textContent = texto;
  if (dicaDoEnvio) dicaDoEnvio.textContent = texto;
  atualizarAvisoDeCodificacao();
}

// ---------- Dizer, ANTES da escolha, o que esta máquina entrega ----------
//
// O painel já diz quando a imagem encolheu (ver `escalaDaTela`, na medição). Mas isso é
// depois: quem escolhe 1440p a 60 quadros descobre no meio da transmissão que está enviando
// 810p, e a conclusão razoável é que o Nexo está com defeito.
//
// Sem codificação por hardware, o limite não é opinião: a 1080p medimos 11,7 ms por quadro
// nesta classe de máquina, e 60 quadros pediriam 702 ms de codificação por segundo -- de 700
// que cabem com folga. 720p a 60 e 1080p a 30 cabem; 1080p a 60 e 1440p não.
//
// O aviso só aparece quando ele é verdade. Numa máquina cuja placa codifica, a frase seria
// falsa -- e um aviso que aparece sempre é um aviso que ninguém lê.
const COMBINACOES_QUE_NAO_CABEM = perfil => perfil.height >= 1440 || (perfil.height >= 1080 && quadrosDaTela >= 60);

async function atualizarAvisoDeCodificacao() {
  const alvos = [document.getElementById('codecEstado'), document.getElementById('shareCodecEstado')].filter(Boolean);
  if (!alvos.length) return;
  let porEstado = null;
  try { porEstado = await window.NexoHardware?.codificadores(); } catch (_) { /* sem resposta: ver abaixo */ }
  // `null` é "o navegador não respondeu", e não "não tem hardware". Afirmar o segundo a
  // partir do primeiro seria inventar um diagnóstico.
  const semHardware = porEstado && !porEstado.hardware.length && porEstado.software.length;
  const aperta = COMBINACOES_QUE_NAO_CABEM(perfilAtual());
  const frase = !semHardware ? ''
    : aperta
      ? `Esta máquina comprime vídeo no processador, e ${perfilAtual().label.split(' · ')[0]} a ${quadrosDaTela} quadros`
        + ' não cabe nele. A resolução vai cair sozinha durante a transmissão para os quadros não travarem —'
        + ' o painel de medições mostra quando isso acontece. 720p a 60 e 1080p a 30 cabem com folga.'
      : 'Esta máquina comprime vídeo no processador, e esta combinação cabe nele.';
  for (const alvo of alvos) {
    alvo.textContent = frase;
    alvo.classList.toggle('aviso-aperta', Boolean(semHardware && aperta));
  }
}

// ---------- As medições, desenhadas em vez de despejadas ----------
//
// Isto era um parágrafo de texto monoespaçado com tudo dentro: resolução, quadros, bitrate,
// codec, camadas, codec de reserva e o motivo do limite, separados por pontos e quebras de
// linha. Cada informação que a instrumentação ganhou tornava o parágrafo mais completo e
// menos legível, até chegar ao ponto em que quem abre o painel para entender um problema
// precisa LER tudo para descobrir se há um problema.
//
// Agora a hierarquia está na tela e não na frase. Os três números que respondem "como está
// agora" aparecem grandes; o que responde "está piorando, e por quê" aparece como um aviso
// com cor; e os detalhes por camada ficam numa grade, que é a forma natural de comparar
// linhas. Nada foi removido -- o relatório técnico completo continua no Diagnóstico.
// Número com vírgula, como se escreve em português. `toFixed` devolve ponto decimal, e um
// "5.3 ms" no meio de uma interface em português é um detalhe que denuncia descuido.
const comVirgula = (valor, casas = 1) => valor.toFixed(casas).replace('.', ',');
// "video/H264" é o que o navegador devolve; "H.264" é como o codec se chama.
const nomeDoCodec = mime => (mime || '').replace(/^video\//i, '')
  .replace(/^H264$/i, 'H.264').replace(/^H265$/i, 'H.265').replace(/^AV1$/i, 'AV1');

const elemento = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  // Sempre `textContent`: aqui entram nomes de codec e implementações de codificador, que
  // vêm do navegador, e nenhum deles tem motivo para virar HTML.
  if (texto != null) el.textContent = texto;
  return el;
};

// ---------- Ícones desenhados ----------
//
// "☺", "↩" e "⋯" são CARACTERES, não ícones: cada fonte os desenha num tamanho, numa
// espessura e numa altura de linha diferentes, e num botão de 26px eles saem minúsculos e
// fora do centro -- o rosto, em particular, fica ilegível. O resto da sala já desenha os
// ícones em traço de 24×24, e é para lá que estes vão. O conteúdo é literal, escrito aqui;
// nada que venha da rede passa por `innerHTML`.
const icone = (desenho, tamanho = 15) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = desenho;
  return svg;
};
const ICONE_REAGIR = '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01"/><path d="M8.4 14.3a4.6 4.6 0 0 0 7.2 0"/>';
const ICONE_RESPONDER = '<path d="m9 14-5-5 5-5"/><path d="M4 9h9.5A6.5 6.5 0 0 1 20 15.5V19"/>';
const ICONE_MAIS = '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>';
const ICONE_ALFINETE = '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z"/><path d="M12 14v6"/>';

function blocoDeNumero(valor, rotulo) {
  const bloco = elemento('div', 'medicao-numero');
  bloco.append(elemento('strong', null, valor), elemento('span', null, rotulo));
  return bloco;
}

function linhaDeCamada(c, principal) {
  const linha = elemento('div', 'medicao-linha');
  linha.append(
    elemento('span', 'medicao-camada-nome', `${c.altura || '?'}p`),
    elemento('span', null, `${c.fps} fps`),
    elemento('span', null, emMegabits(c.kbps * 1000)),
    // O custo de codificar cada quadro é o que separa "minha internet não dá conta" de "meu
    // processador não dá conta". Sem ele, trocar de codec é fé.
    elemento('span', 'medicao-custo', c.msPorQuadro ? `${comVirgula(c.msPorQuadro)} ms/quadro` : '—')
  );
  if (!principal) linha.classList.add('medicao-linha-secundaria');
  return linha;
}

function renderizarMedicaoDoEnvio(ao_vivo, q) {
  ao_vivo.textContent = '';
  // Ninguém assistindo é o caso mais comum de tela compartilhada, e ele não é um problema.
  //
  // O servidor desliga as camadas que ninguém consome, então o envio vai a zero -- que é a
  // maior economia que o Nexo faz. Mostrar aquilo como "0 quadros, 0,0 Mbps" ao lado de um
  // aviso laranja transformava a economia em susto, e acusava o codificador de não dar conta
  // exatamente quando ele estava de folga.
  if (q.emEspera) {
    const espera = elemento('div', 'medicao-veredito ok');
    espera.append(elemento('strong', null, 'Em espera: ninguém abriu a sua tela ainda.'));
    espera.append(elemento('span', null, 'A tela está publicada, mas o servidor desligou as camadas'
      + ' porque não há quem as receba — então nada está sendo codificado nem subindo. As medições'
      + ' aparecem quando alguém clicar em Assistir.'));
    ao_vivo.append(espera);
    return;
  }
  const codec = nomeDoCodec(q.codec);
  // Só afirma hardware quando o navegador informa; caso contrário, silêncio.
  const ondeCodifica = q.hardware === true ? 'em hardware' : q.hardware === false ? 'em software' : '';

  const destaque = elemento('div', 'medicao-destaque');
  destaque.append(
    blocoDeNumero(`${q.width || '?'}×${q.height || '?'}`, 'imagem'),
    blocoDeNumero(String(Math.round(q.fps || 0)), 'quadros/s'),
    // O TOTAL, e não só a camada de cima: é este número que multiplica por espectador.
    blocoDeNumero(emMegabits(q.bitrate), 'subindo no total')
  );
  ao_vivo.append(destaque);

  if (codec || ondeCodifica) {
    ao_vivo.append(elemento('div', 'medicao-sub', [codec, ondeCodifica].filter(Boolean).join(' · ')));
  }

  // Os TRÊS degraus do caminho, lado a lado: o que foi pedido, o que a fonte entregou, o que
  // saiu codificado.
  //
  // Eram dois, e faltava justamente o primeiro. Com "48 capturados → 49 codificados" o
  // painel dizia que o codificador estava acompanhando, o que era verdade, e deixava sem
  // resposta a pergunta de quem pediu 60: onde foram os outros 12? O degrau estava antes da
  // captura, e não havia como ver isso.
  //
  // A comparação de saída é só com a camada de MAIOR resolução, e só quando ela está ativa.
  // O degrau de baixo é 15 quadros de propósito -- numa conexão apertada, texto legível a 15
  // vale mais que borrão a 30 -- então incluí-lo aqui faria o painel acusar o codificador de
  // não acompanhar por estar funcionando exatamente como foi projetado.
  const principal = q.camadas?.[0];
  if (q.capturaFps != null && principal?.ativo) {
    const fluxo = elemento('div', 'medicao-fluxo');
    const captura = Math.round(q.capturaFps);
    const codificado = principal.fps;
    fluxo.append(
      elemento('span', 'medicao-fluxo-ponta medicao-fluxo-pedido', `${quadrosDaTela} pedidos`),
      elemento('span', 'medicao-seta', '→'),
      elemento('span', 'medicao-fluxo-ponta', `${captura} capturados`),
      elemento('span', 'medicao-seta', '→'),
      elemento('span', 'medicao-fluxo-ponta', `${codificado} codificados`)
    );
    // Um quarto de diferença é folga para arredondamento e para o codificador respirar. Além
    // disso, alguém ficou para trás -- e QUAL dos dois muda completamente o que fazer a
    // respeito, que é a razão de os três números estarem aqui.
    const fonteEntrega = captura >= quadrosDaTela * 0.75;
    const codificadorAcompanha = codificado >= captura * 0.75;
    const selo = !codificadorAcompanha ? { classe: 'alerta', texto: 'o codificador não acompanha a fonte' }
      : !fonteEntrega ? { classe: 'alerta', texto: 'a fonte entrega menos do que você pediu' }
      : { classe: 'ok', texto: 'o caminho inteiro acompanha o que você pediu' };
    fluxo.append(elemento('span', `medicao-selo ${selo.classe}`, selo.texto));
    ao_vivo.append(fluxo);
    // Quando o degrau está entre o pedido e a captura, dizer o que isso significa: é o
    // ponto em que nenhum ajuste desta página tem efeito, e saber disso evita a pessoa
    // ficar trocando resolução e codec atrás de quadros que nunca existiram.
    if (fonteEntrega === false && codificadorAcompanha) {
      ao_vivo.append(elemento('div', 'medicao-nota', 'A fonte não tem mais quadros para dar:'
        + ' a captura de tela só produz quadro quando a imagem muda, e não passa da taxa em que o'
        + ' programa capturado está desenhando. Se o jogo está a ' + captura + ' quadros, é isso que'
        + ' sobe — e a placa de vídeo ocupada também afeta a captura, mesmo com o processador folgado.'));
    }
  }

  if (q.camadas?.length) {
    ao_vivo.append(elemento('div', 'medicao-titulo', q.camadas.length > 1 ? 'Camadas que sobem' : 'Camada única'));
    const grade = elemento('div', 'medicao-grade');
    q.camadas.forEach((c, i) => grade.append(linhaDeCamada(c, i === 0)));
    ao_vivo.append(grade);
    // O custo SOMADO, que é o número que decide se a taxa pedida cabe. As camadas sobem pelo
    // mesmo adaptador, em sequência, na mesma thread: o painel mostrava "17,4 ms" e "5,4 ms"
    // lado a lado e deixava a soma — a única conta que importa — para quem estivesse
    // disposto a fazê-la de cabeça.
    const custo = custoDeCodificacao(q);
    if (custo) {
      // O limite mostrado é o que a página USA para decidir encolher, não os 1000 ms do
      // segundo. Dizer "cabe" até 900 e agir em 700 deixaria o painel contradizendo a
      // decisão que ele mesmo está explicando duas linhas abaixo.
      const cabe = custo.projetado <= CUSTO_QUE_APERTA;
      const linha = elemento('div', `medicao-custo-total ${cabe ? '' : 'aperta'}`);
      linha.append(elemento('strong', null, `${Math.round(custo.agora)} ms`));
      linha.append(elemento('span', null, `de codificação por segundo, de ${CUSTO_QUE_APERTA} que cabem com folga.`
        + (cabe ? '' : ` Os ${quadrosDaTela} quadros pedidos precisariam de ${Math.round(custo.projetado)} ms — não cabe.`)));
      ao_vivo.append(linha);
    }
    // A imagem encolhida precisa ser DITA, e esta é a mesma lição do teto reduzido por rede:
    // quem pediu 1080p e vê 810p no painel conclui defeito, e a conclusão é razoável se nada
    // na tela explicar. Sem a frase, o ajuste que protege os quadros pareceria o problema.
    if (q.escalaDaTela > 1) {
      ao_vivo.append(elemento('div', 'medicao-nota', `A imagem foi encolhida ${escalaEmTexto(q.escalaDaTela)}x`
        + ` para os ${quadrosDaTela} quadros caberem na codificação — menos pixels custam menos por quadro.`
        + ' É a troca deliberada desta sala: resolução menor quase ninguém repara, quadro perdido trava a'
        + ' imagem e todo mundo repara. Ela volta ao tamanho cheio sozinha quando sobrar folga.'));
    }
    // Uma camada sozinha desligada continua sendo economia, e continua merecendo explicação:
    // é o degrau que ninguém está usando, não um degrau que falhou.
    const dormindo = q.camadas.filter(c => !c.ativo);
    if (dormindo.length) {
      ao_vivo.append(elemento('div', 'medicao-nota',
        `${dormindo.length === 1 ? 'Uma camada está' : `${dormindo.length} camadas estão`} desligada${dormindo.length === 1 ? '' : 's'}`
        + ' porque ninguém a está recebendo. O servidor religa quando alguém precisar dela.'));
    }
  }

  // O de reserva é uma codificação inteira a mais, paga por quem transmite, e nada na tela
  // contava isso.
  if (q.reserva) {
    ao_vivo.append(elemento('div', 'medicao-nota',
      `Codec de reserva ${nomeDoCodec(q.reserva.codec)} também subindo: ${emMegabits(q.reserva.kbps * 1000)}. `
      + 'Alguém na sala não decodifica sua escolha, então a imagem sobe duas vezes.'));
  }

  // O veredito fecha o painel porque é a conclusão, não a introdução: quem chega aqui já viu
  // os números que a sustentam.
  const queda = diagnosticoDaQueda(q);
  if (queda) {
    // A queda por captura não é laranja: na maioria das vezes ela é a tela parada, que é
    // economia. Alarmar nesse caso ensina a pessoa a ignorar o aviso quando ele importar.
    const nivel = queda.nivel === 'ok' ? 'ok'
      : queda.nivel === 'indefinido' || queda.nivel === 'fonte' ? 'neutro' : 'alerta';
    const caixa = elemento('div', `medicao-veredito ${nivel}`);
    caixa.append(elemento('strong', null, queda.titulo));
    if (queda.texto) caixa.append(elemento('span', null, queda.texto));
    ao_vivo.append(caixa);
  } else if (MOTIVOS_DE_LIMITE[q.reason]) {
    ao_vivo.append(elemento('div', 'medicao-veredito alerta', MOTIVOS_DE_LIMITE[q.reason]));
  }
}

function atualizarBotaoDeQualidade() {
  const prioridade = PRIORIDADES_DE_TELA[prioridadeDaTela];
  atualizarRotulosDeQualidade();
  qualidadeBtn.textContent = `${perfilAtual().label} · ${quadrosDaTela} fps · ${prioridade.rotulo.toLowerCase()} · até ${emMegabits(tetoAnunciado(perfilAtual()))}`;
  const q = qualidadeDoEnvio;
  const ao_vivo = document.getElementById('qualityLive');
  if (!screenStream) { ao_vivo.textContent = 'As medições aparecem durante a transmissão.'; return; }
  if (!q) { ao_vivo.textContent = 'Aguardando as primeiras medições…'; return; }
  renderizarMedicaoDoEnvio(ao_vivo, q);
}

// Uma leitura periodica do envio, so para a interface. Ela nao decide mais nada: ajustar
// resolucao e bitrate por espectador e tarefa do servidor de midia.
//
// O que ela mede mudou, e essa é a diferença entre um número decorativo e um número que
// serve para decidir. Antes olhava só a camada de maior altura e chamava aquilo de "o
// envio": numa publicação de duas camadas mais um codec de reserva, isso podia ser um terço
// do que a máquina estava realmente subindo. Qualquer conversa sobre economia de banda
// partindo daquele número estava partindo de um número errado -- e é por isso que somar
// tudo vem ANTES de calibrar orçamento por codec ou por conteúdo.
let medindoEnvio = false;
async function medirEnvio() {
  const faixa = publicacoesLocais.screen?.track;
  const remetentes = remetentesDaFaixa(faixa);
  if (!remetentes.length || medindoEnvio) return;
  medindoEnvio = true;
  try {
    // Um relatório por remetente: o principal e os dos codecs de reserva. `getStats` da
    // faixa só alcança o principal, e o de reserva é exatamente o que ninguém estava vendo.
    const relatorios = await Promise.all(remetentes.map(r => r.getStats().catch(() => null)));
    const fluxos = [];
    relatorios.forEach((stats, indice) => {
      if (!stats) return;
      stats.forEach(item => {
        if (item.type !== 'outbound-rtp' || item.kind !== 'video') return;
        fluxos.push({
          // Os ids são únicos dentro de um relatório, não entre relatórios.
          chave: `${indice}:${item.id}`,
          item,
          codec: stats.get(item.codecId)?.mimeType || ''
        });
      });
    });
    if (!fluxos.length) return;
    fluxos.sort((a, b) => (b.item.frameHeight || 0) - (a.item.frameHeight || 0));

    // O FPS da FONTE, antes de qualquer codificação. É a medida que faltava, e sem ela uma
    // queda de quadros não tinha como ser explicada.
    //
    // Quando os quadros caem, há duas histórias possíveis e elas pedem coisas opostas. Ou a
    // captura parou de entregar -- o jogo entrou em tela cheia exclusiva, o compositor do
    // Windows mudou de modo, a fonte engasgou -- e então não há ajuste de qualidade nesta
    // página que resolva, porque não existe quadro para codificar. Ou a captura continua
    // entregando 60 e é o codificador que não acompanha, e aí baixar resolução ou codec
    // resolve. Olhando só o lado do codificador, as duas são o mesmo número caindo.
    let fonte = null;
    relatorios.forEach(stats => {
      if (!stats) return;
      stats.forEach(item => {
        if (item.type === 'media-source' && item.kind === 'video') fonte = item;
      });
    });

    const anteriores = qualidadeDoEnvio?.bruto || {};
    const bruto = {};
    let bitsPorSegundo = 0;
    const porFluxo = fluxos.map(({ chave, item, codec }) => {
      const antes = anteriores[chave];
      const intervalo = antes && item.timestamp - antes.timestamp;
      const kbps = intervalo > 0 ? Math.max(0, (item.bytesSent - antes.bytes) * 8 / intervalo) : 0;
      // Quanto custou codificar CADA quadro desta camada, em milissegundos. É a medida que
      // separa "minha internet não dá conta" de "meu processador não dá conta", e a única
      // que mostra o preço real de trocar de codec.
      const quadros = antes ? item.framesEncoded - antes.framesEncoded : 0;
      const segundos = antes ? item.totalEncodeTime - antes.totalEncodeTime : 0;
      bruto[chave] = { bytes: item.bytesSent, timestamp: item.timestamp, framesEncoded: item.framesEncoded, totalEncodeTime: item.totalEncodeTime };
      bitsPorSegundo += kbps * 1000;
      return {
        altura: item.frameHeight, fps: Math.round(item.framesPerSecond || 0), kbps, codec,
        msPorQuadro: quadros > 0 ? (segundos * 1000) / quadros : null,
        // Camada desligada pelo servidor porque ninguém a consome (dynacast). Zero aqui é
        // economia, não defeito -- e sem distinguir as duas coisas a interface acusava o
        // codificador de não dar conta justamente quando ele estava de folga.
        ativo: item.active !== false
      };
    });

    const palco = fluxos[0].item;
    const codecPrincipal = codecDePublicacao('screen');
    // O de reserva é o que sobe num codec que não é o pedido: o cliente codifica a imagem
    // DE NOVO para quem não decodifica a escolha. Custa processador e upload, e some da
    // conta de quem só olha a camada de cima.
    const reserva = porFluxo.filter(f => f.codec && !f.codec.toLowerCase().includes(codecPrincipal));
    qualidadeDoEnvio = {
      width: palco.frameWidth, height: palco.frameHeight, fps: palco.framesPerSecond,
      // O total: todas as camadas, de todos os codecs. É este o número que multiplica por
      // espectador na conta de quem hospeda.
      bitrate: bitsPorSegundo,
      bitrateDoPalco: porFluxo[0].kbps * 1000,
      reason: palco.qualityLimitationReason,
      // Quanto tempo o envio passou limitado, e por quê: um "bandwidth" que aparece num
      // instante e some não é o mesmo problema que um que dura a transmissão inteira.
      duracoesDoLimite: palco.qualityLimitationDurations || null,
      codec: fluxos[0].codec,
      // Unica evidencia objetiva de que a placa de video esta sendo usada.
      encoder: palco.encoderImplementation || '',
      hardware: palco.powerEfficientEncoder,
      msPorQuadro: porFluxo[0].msPorQuadro,
      camadas: porFluxo,
      reserva: reserva.length ? { codec: reserva[0].codec, kbps: reserva.reduce((soma, f) => soma + f.kbps, 0) } : null,
      // O que a FONTE está produzindo, para comparar com o que saiu codificado.
      capturaFps: fonte?.framesPerSecond ?? null,
      capturaWidth: fonte?.width ?? null,
      capturaHeight: fonte?.height ?? null,
      // O corte que a qualidade da rede impôs, se impôs. Sem isto, um teto reduzido a 60%
      // parece uma queda inexplicável de bitrate.
      fatorDeRede: ultimoFatorDeQualidade,
      // O quanto ESTA página encolheu a imagem para os quadros caberem na codificação.
      escalaDaTela: ultimaEscalaDaTela,
      // Quantas vezes o NAVEGADOR mudou a resolução por limitação. É a medida que decide a
      // suspeita registrada acima: zero durante uma queda de quadros é a assinatura do
      // adaptador dele desligado, e é o que justifica a escala ter vindo para cá. Se este
      // número subir, os dois estão agindo e há uma briga a resolver.
      mudancasDeResolucao: palco.qualityLimitationResolutionChanges ?? null,
      // Sem nenhuma camada ativa, a tela está publicada e não está sendo codificada: é o
      // servidor economizando porque ninguém abriu sua tela ainda.
      emEspera: porFluxo.every(f => !f.ativo),
      bruto
    };
    registrarAmostraDoEnvio(qualidadeDoEnvio);
    atualizarBotaoDeQualidade();
    // Fora do `await` da medição e dentro da fila dos parâmetros: a decisão de escala não
    // pode atrasar a leitura seguinte, e não pode correr com o teto por qualidade de rede.
    naFilaDeParametros(() => aplicarEscalaPeloCusto(qualidadeDoEnvio)).catch(() => {});
  } catch (_) { /* Sem estatísticas, a medição some da tela e a transmissão segue. */ }
  finally { medindoEnvio = false; }
}
setInterval(medirEnvio, 2000);

// ---------- O histórico do envio, e o que ele conclui ----------
//
// "Por que o FPS cai depois de vários minutos compartilhando?" é uma pergunta que uma
// medição instantânea não responde, por mais completa que ela seja. O painel mostrava o
// agora; a pergunta é sobre a diferença entre o agora e dez minutos atrás.
//
// Uma amostra a cada quinze segundos dá uma hora de sessão em sessenta entradas. A medição
// continua rodando a cada dois segundos para a interface -- guardar tudo seria ruído, porque
// oscilação de dois segundos não é degradação.
const SEGUNDOS_ENTRE_AMOSTRAS = 15;
const AMOSTRAS_GUARDADAS = 240;
const historicoDoEnvio = [];
let ultimaAmostra = 0;

function registrarAmostraDoEnvio(q) {
  // Tempo de espera não entra no histórico, e essa guarda é o que impede o diagnóstico de
  // mentir. Enquanto ninguém assiste, o servidor desliga as camadas e o envio é zero de
  // propósito; guardar esses zeros faria a comparação com o melhor momento acusar "os
  // quadros caíram de 30 para 0" em toda sessão em que alguém fechasse a sua tela.
  if (q.emEspera) return;
  const agora = Date.now();
  if (agora - ultimaAmostra < SEGUNDOS_ENTRE_AMOSTRAS * 1000) return;
  ultimaAmostra = agora;
  historicoDoEnvio.push({
    em: agora,
    fps: Math.round(q.fps || 0),
    capturaFps: q.capturaFps == null ? null : Math.round(q.capturaFps),
    altura: q.height || 0,
    mbps: q.bitrate / 1e6,
    msPorQuadro: q.msPorQuadro,
    motivo: q.reason || 'nada',
    fatorDeRede: q.fatorDeRede
  });
  while (historicoDoEnvio.length > AMOSTRAS_GUARDADAS) historicoDoEnvio.shift();
}
window.verHistoricoDoEnvio = () => historicoDoEnvio.slice();

// O histórico compara uma configuração consigo mesma, e por isso ele é zerado quando a
// configuração muda.
//
// Sem isto, baixar a taxa de 60 para 30 de propósito -- ou trocar para uma resolução menor,
// ou mudar de fonte -- fazia o diagnóstico anunciar "os quadros caíram de 60 para 30 nos
// últimos 2 min", acusando degradação onde houve escolha. Uma queda só é queda se nada foi
// pedido de diferente.
function esquecerHistoricoDoEnvio() {
  historicoDoEnvio.length = 0;
  ultimaAmostra = 0;
  // A escala volta ao tamanho cheio pelo mesmo motivo. Todas as mudanças que chegam aqui
  // republicam a tela, e os remetentes novos nascem na escada original -- manter a escala
  // antiga faria a imagem encolher no instante seguinte, por causa de um aperto que era de
  // outra configuração. Quem pede 720p depois de 1080p merece ver 720p antes de qualquer
  // desconto, e se o aperto continuar a medição o descobre em quatro segundos.
  apertosSeguidos = 0;
  folgasSeguidas = 0;
  ultimaEscalaDaTela = 1;
}

// Quanto trabalho de codificação existe por segundo, e quanto existiria na taxa pedida.
//
// Esta conta virou necessária porque o navegador não sempre denuncia a saturação. Medido em
// campo: as duas camadas a `limitado por=none`, a fonte entregando 44 quadros e a saída em
// 24 -- o codificador claramente derrubando quadros, e o `qualityLimitationReason` calado.
// A suspeita é que o `scaleResolutionDownBy` declarado na escada trave o adaptador de
// resolução: sem poder encolher a imagem, ele não marca "cpu", só descarta quadros.
//
// A aritmética não fica calada. Um `SimulcastEncoderAdapter` codifica as camadas em
// sequência, então o que importa é a SOMA: cada camada custa o seu tempo por quadro vezes a
// sua taxa, e o total disputa os mesmos 1000 ms de cada segundo. O painel mostrava 17,4 e
// 5,4 ms lado a lado sem nunca somar, e a soma é o número que decide.
function custoDeCodificacao(q) {
  const camadas = (q.camadas || []).filter(c => c.ativo && c.msPorQuadro > 0);
  if (!camadas.length) return null;
  const agora = camadas.reduce((soma, c) => soma + c.msPorQuadro * c.fps, 0);
  // O que a taxa pedida custaria mantendo o preço por quadro de agora. A camada de cima
  // acompanharia o pedido; as de baixo têm taxa própria e de propósito (15 quadros no degrau
  // barato), então elas entram como estão.
  const projetado = camadas.reduce((soma, c, i) =>
    soma + c.msPorQuadro * (i === 0 ? quadrosDaTela : c.fps), 0);
  return { agora, projetado };
}

// Quanto o envio piorou desde o melhor momento da sessão, e por quê.
//
// A comparação é contra o MELHOR e não contra o primeiro: os primeiros segundos de uma
// transmissão são de acomodação -- o codificador ainda está subindo, a estimativa de banda
// ainda não existe -- e usar aquilo como referência acusaria degradação em toda sessão.
//
// Cada resposta aqui manda a pessoa para um lugar diferente, e é por isso que vale a pena
// distinguir em vez de dizer "sua conexão ou seu PC". A fonte parar não tem remédio nesta
// página; o processador saturar tem (resolução, taxa, codec); o teto cair por rede tem outro
// (esperar, ou aceitar menos).
const QUEDA_QUE_IMPORTA = 0.75;      // abaixo de três quartos do melhor já se nota
const QUADROS_MINIMOS_PARA_COMPARAR = 5;

// O "agora" vem da medição corrente, não da última amostra do histórico.
//
// Ler o histórico para as duas pontas parecia natural e produzia uma contradição dentro da
// mesma caixa: as amostras são de quinze em quinze segundos, então o veredito ficava até
// quinze segundos atrasado em relação aos números logo acima dele. Numa tela que ficou
// parada e voltou a se mover, o topo já mostrava 50 quadros enquanto o veredito ainda
// acusava 9. O histórico serve para saber qual foi o MELHOR momento; o agora é o agora.
function diagnosticoDaQueda(medicao) {
  if (historicoDoEnvio.length < 3 || !medicao) return null;
  const melhor = historicoDoEnvio.reduce((a, b) => (b.fps > a.fps ? b : a));
  if (melhor.fps < QUADROS_MINIMOS_PARA_COMPARAR) return null;
  const atual = {
    fps: Math.round(medicao.fps || 0),
    capturaFps: medicao.capturaFps == null ? null : Math.round(medicao.capturaFps),
    motivo: medicao.reason || 'nada',
    msPorQuadro: medicao.msPorQuadro,
    fatorDeRede: medicao.fatorDeRede,
    escala: medicao.escalaDaTela || 1
  };
  // Mandar "baixe a resolução" a quem já está com a imagem encolhida ao máximo é o pior tipo
  // de conselho: ele é obsoleto e dá a entender que a pessoa não fez o óbvio. Estas duas
  // frases entram em lugar disso, e elas dizem coisas diferentes -- uma é "já estamos
  // cuidando", a outra é "cuidamos até o fim e não bastou".
  const noLimite = atual.escala >= ESCADA_DE_ESCALA[ESCADA_DE_ESCALA.length - 1];
  const sobreEscala = atual.escala <= 1 ? ''
    : noLimite
      ? ` A imagem já está encolhida ${escalaEmTexto(atual.escala)}x, que é o limite: daqui em diante ela chegaria`
        + ' no degrau de 360p e as duas camadas viriam do mesmo tamanho. Baixar a taxa de quadros ou a resolução'
        + ' escolhida é o que ainda sobra.'
      : ` A imagem já foi encolhida ${escalaEmTexto(atual.escala)}x para proteger os quadros, e ela continua`
        + ' encolhendo sozinha enquanto não couber.';
  if (atual.fps >= melhor.fps * QUEDA_QUE_IMPORTA) {
    return { nivel: 'ok', titulo: `Estável: ${atual.fps} quadros por segundo, contra ${melhor.fps} no melhor momento.` };
  }
  const minutos = Math.max(1, Math.round((Date.now() - melhor.em) / 60000));
  const abertura = `Os quadros caíram de ${melhor.fps} para ${atual.fps} desde o melhor momento, ${minutos} min atrás.`;

  // O que o NAVEGADOR afirma vem antes do que se pode inferir, e essa ordem foi aprendida
  // errando.
  //
  // A inferência pela captura estava sendo testada primeiro, e ganhava de um
  // `qualityLimitationReason: cpu` explícito. O erro não é só de precedência: quando o
  // codificador não dá conta, o libwebrtc aplica contrapressão e DERRUBA quadros antes de
  // codificar -- então a captura cai *por causa* da CPU. As duas coisas ficam verdadeiras ao
  // mesmo tempo, e a inferência apontava a consequência em vez da causa. Visto em campo:
  // 1080p a 60 pedidos, 43 capturados, 11,7 ms por quadro (60 x 11,7 = 702 ms de
  // codificação por segundo, que não cabe numa thread) -- e o painel dizia "a fonte não tem
  // mais quadros para dar", mandando a pessoa procurar no lugar errado.
  if (atual.motivo === 'cpu') {
    // O custo por quadro vira o argumento: a conta mostra por que a taxa pedida não cabe, em
    // vez de pedir que se acredite.
    const custo = atual.msPorQuadro
      ? ` Cada quadro custa ${comVirgula(atual.msPorQuadro)} ms para codificar, então os ${quadrosDaTela} que você pediu`
        + ` precisariam de ${Math.round(atual.msPorQuadro * quadrosDaTela)} ms de codificação por segundo — e só existem 1000.`
      : '';
    return { nivel: 'cpu', titulo: abertura, texto: `É o processador que não acompanha.${custo}${sobreEscala}`
      + (atual.escala > 1 ? '' : ' Baixe a resolução ou a taxa de quadros.')
      + ' Se a codificação estiver em software (o Diagnóstico diz), ela'
      + ' está saindo no processador, e o limite é uma thread de codificação — não os seus núcleos todos, que é'
      + ' por que o uso total de CPU pode parecer folgado.' };
  }
  if (atual.motivo === 'bandwidth') {
    const corte = atual.fatorDeRede < 1 ? ` O teto de envio está reduzido a ${Math.round(atual.fatorDeRede * 100)}% porque a sua conexão foi classificada como instável.` : '';
    return { nivel: 'rede', titulo: abertura, texto: 'O limite é a sua banda de subida.'
      + `${corte} Baixar a resolução ajuda; nada aqui contorna o limite do link.` };
  }
  // O navegador calado não significa que não há causa. Quando a conta de codificação não
  // cabe em um segundo, ela é a causa -- e dizê-la é melhor do que oferecer "não tem causa
  // óbvia" a quem está olhando os números que a provam.
  const custo = custoDeCodificacao(medicao);
  if (custo && custo.projetado > 900) {
    const camadas = medicao.camadas.filter(c => c.ativo && c.msPorQuadro > 0);
    const detalhe = camadas.length > 1
      ? ` Somando as camadas (${camadas.map(c => `${c.altura}p a ${comVirgula(c.msPorQuadro)} ms`).join(' e ')}),`
      : ` A ${comVirgula(camadas[0].msPorQuadro)} ms por quadro,`;
    return { nivel: 'cpu', titulo: abertura, texto: 'O codificador não tem tempo para a taxa que você pediu.'
      + `${detalhe} os ${quadrosDaTela} quadros pedidos precisariam de ${Math.round(custo.projetado)} ms de codificação`
      + ' por segundo — e um segundo tem 1000. As camadas são codificadas em sequência, na mesma thread, então o que'
      + ' conta é a soma; o uso total do processador pode parecer folgado e ainda assim não caber.'
      + (atual.escala > 1 ? sobreEscala : ' Baixe a resolução ou a taxa: menos pixels custam menos por quadro.') };
  }
  // Só quando nem o navegador nem a conta apontam limite é que vale inferir pela captura.
  // Aqui há duas explicações com a mesma assinatura, e a mais comum não é problema nenhum: a
  // captura de tela só produz quadro quando algo muda, então tela parada é captura parada --
  // a maior economia que existe. A outra é a fonte não conseguir acompanhar.
  if (atual.capturaFps != null && atual.capturaFps < melhor.fps * QUEDA_QUE_IMPORTA) {
    return { nivel: 'fonte', titulo: abertura, texto: `A captura está entregando ${atual.capturaFps} quadros e o`
      + ' codificador está acompanhando — os quadros não estão sendo perdidos, eles não estão chegando a existir.'
      + ' Três coisas fazem isso. Se a tela ficou parada, é o esperado e não gasta banda de ninguém. Se havia'
      + ' movimento, ou a fonte travou (jogo em tela cheia exclusiva, janela minimizada) ou a própria captura de'
      + ` tela não sustenta ${quadrosDaTela} quadros nesta resolução — copiar a imagem da placa de vídeo para o`
      + ' navegador tem um custo por quadro, e ele cresce com os pixels. Nos três casos, mexer em codec não ajuda;'
      + ' no último, uma resolução menor ajuda, porque há menos para copiar.' };
  }
  // Caiu, a fonte entrega, e o navegador não diz estar limitando nada. Não inventar causa.
  return { nivel: 'indefinido', titulo: abertura, texto: 'A captura continua entregando e o navegador não aponta'
    + ' limite de processador nem de banda. Vale abrir o Diagnóstico e copiar o relatório: esta combinação não tem'
    + ' causa óbvia, e o histórico completo é o que permite achá-la.' };
}

// ---------- Quanto a sala custou ----------
//
// A medição acima é do ENVIO e existe para a interface. Esta é do RECEBIMENTO e existe para o
// histórico: a conta de banda de quem hospeda é a soma do que todos receberam, e essa soma só
// pode acontecer no servidor. Cada página manda apenas o próprio pedaço.
//
// Uma vez por minuto, de propósito. A pergunta que isto responde -- "quanto a tela custou
// nesta semana, comparada com a anterior" -- não melhora com amostras de dois em dois
// segundos; e numa sala de vinte pessoas, medir a cada dois segundos seriam seiscentas
// mensagens por minuto para acompanhar um número que mal se move.
let medindoRecebimento = false;
async function relatarRecebimento() {
  if (medindoRecebimento || !transporte?.conectada || !socket?.connected) return;
  medindoRecebimento = true;
  try {
    const porFonte = await transporte.medirRecebimento();
    socket.emit('medicao-de-banda', { v: 2, sequencia: ++sequenciaMedicao, fontes: porFonte });
  } catch (_) { /* Sem medição, a sala não muda em nada: isto é histórico, não funcionamento. */ }
  finally { medindoRecebimento = false; }
}
setInterval(relatarRecebimento, 60000);

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
      // A taxa de quadros vem da escolha ATIVA, e é isto que corrige um 30 escrito à mão que
      // estava aqui. Quem tinha pedido 60 quadros e trocava a resolução perdia metade deles
      // sem aviso: a captura caía para 30 e ficava lá, enquanto o botão e a publicação
      // continuavam anunciando 60. Trocar de resolução não é uma opinião sobre a taxa.
      const fps = quadrosDaTela;
      // Duas falhas muito diferentes moravam no mesmo `catch`, com a mesma frase -- e para
      // uma delas a frase era falsa.
      //
      // Aqui, a fonte recusar a resolução: a escolha não se aplica, e a frase sobre a fonte
      // é verdadeira.
      if (track) {
        try {
          await track.applyConstraints({ ...track.getConstraints(), width: { ideal: perfil.width, max: perfil.width },
            height: { ideal: perfil.height, max: perfil.height }, frameRate: { ideal: fps, max: fps } });
        } catch (erro) {
          console.warn('A fonte não aceitou a nova resolução', erro);
          status.textContent = 'Esta fonte não aceitou a nova resolução. Use Atualizar tela para selecionar novamente.';
          return;   // o `finally` devolve os seletores ao perfil que continua valendo
        }
      }
      perfilDeQualidade = novo;
      esquecerHistoricoDoEnvio();
      try { localStorage.setItem('nexoQuality', novo); } catch (_) {}
      // O teto de envio entra nas opcoes de publicacao, entao a faixa precisa subir de novo.
      // Despublicar e publicar vão na MESMA tarefa da fila: eram duas, e a fresta entre elas
      // deixava outra mudança entrar e apagar a faixa que acabara de subir.
      //
      // A outra falha é a republicação não voltar -- e ela NÃO desfaz a escolha. A resolução
      // já foi aplicada na captura, e desfazer o perfil deixaria a página anunciando um
      // número e enviando outro. Quem conserta é a reconciliação, que `sequenciaDePublicacao`
      // garante rodar justamente quando a publicação falha.
      const publicou = track ? await sequenciaDePublicacao('screen', async () => {
        await aplicarPublicacao('screen', null);
        await aplicarPublicacao('screen', track);
      }) : true;
      if (publicou) status.textContent = `Qualidade ${perfil.label}. Cada pessoa recebe a camada que a conexão dela aguenta.`;
    } catch (erro) {
      perfilDeQualidade = anterior;
      console.warn('Falha inesperada ao trocar a qualidade', erro);
      status.textContent = 'Não foi possível aplicar esta qualidade. Use Atualizar tela para selecionar a fonte novamente.';
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
seletoresDeQuadros.forEach(select => {
  select.value = String(quadrosDaTela);
  select.onchange = () => definirQuadrosDaTela(select.value);
});
atualizarBotaoDeQualidade();

// ---------- Câmera ----------
async function alternarCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    definirFaixaEmTodosOsPares('camera', null, null);
    pintarBotaoDaCamera(false);
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
    pintarBotaoDaCamera(true);
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
  atualizarModoSegundoPlano();
}
cameraBtn.onclick = alternarCamera;
flipCameraBtn.onclick = virarCamera;

// ---------- Tela ----------
function abrirPainelDeTela(modo) {
  settingsMode = modo;
  settingsTitle.textContent = modo === 'update' ? 'Trocar o que está na tela' : 'Compartilhar tela';
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
  // Sem agente NESTE sistema, o aplicativo ainda entrega som -- pelo loopback do Electron, e
  // com eco se a pessoa não estiver de fone. É melhor que silêncio, e a sala avisa.
  if (aplicativoNativo && agenteAusenteNesteSistema) return 'loopback';
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
    aba: 'Marque "Compartilhar áudio da guia" na janela do navegador. Como vai só o som daquela aba, não há risco de eco.',
    'janela-navegador': 'Vai só o som da janela escolhida, quando o navegador oferece essa opção — nunca o som do resto do sistema. Se não oferecer, a tela vai sem áudio.',
    agente: textoDaCaptura('agente'),
    helper: textoDaCaptura('helper'),
    // Este sistema ainda não tem o agente nativo, então o som vem inteiro -- e o Nexo vai
    // dentro dele. Dizer isso ANTES é o que permite a pessoa pôr o fone: o eco aparece no
    // ouvido dos outros, não no dela, e ela seria a última a descobrir.
    loopback: 'O som deste computador vai junto, inteiro. Use fones: sem eles, a voz dos outros'
      + ' volta para a sala como eco. Neste sistema o Nexo ainda não consegue tirar a si mesmo da captura.',
    'navegador-sistema': 'Marque "Compartilhar áudio do sistema" na janela que abrir. Sem isso o navegador não envia som nenhum.'
  };
  echoHint.textContent = textos[plano];
  if (captureMode.value === 'window' && aplicativoNativo && audioPolicy.value !== 'none') {
    echoHint.textContent = 'O som do programa vai junto com a janela, automaticamente. Outras janelas do mesmo programa podem ser ouvidas também.';
  }
  if (aplicativoNativo && plano === 'nenhum' && audioPolicy.value !== 'none') echoHint.textContent = 'Sem o agente de áudio a tela vai sem som. Reinicie o aplicativo para tentar de novo.';
  atualizarCaixaDoAgente(plano);

  // A escolha do programa vale nos dois caminhos de captura nativa: pelo agente (no PC de
  // cada participante) e pelo helper (quando a sala esta aberta na propria maquina do
  // servidor). Antes o seletor morava dentro da caixa do agente e sumia no modo local, o
  // que fazia parecer que era preciso baixar o agente sem necessidade.
  const capturaNativa = plano === 'agente' || plano === 'helper';
  excluirAppCampo.hidden = !capturaNativa || captureMode.value === 'window';
  if (capturaNativa && !aplicativosDoAgente.length) pedirAplicativos();

  const riscoDeEco = plano === 'navegador-sistema' || plano === 'loopback';
  echoWarning.hidden = !riscoDeEco;
  if (plano === 'loopback') {
    echoWarningText.textContent = 'Neste sistema o aplicativo ainda não tem o agente de áudio, que é o'
      + ' programa capaz de excluir o Nexo da captura. Sem ele o som vai inteiro: de fone, ninguém nota;'
      + ' em caixas de som, a voz dos outros volta como eco. Compartilhar uma aba do navegador não tem esse risco.';
  } else if (riscoDeEco) {
    const explicacoes = {
      'helper-ausente': 'Sem o helper nativo não dá para tirar esta chamada da captura, e a voz dos outros pode voltar como eco. Rode "npm start" para compilá-lo, ou compartilhe uma aba.',
      'atras-de-proxy': 'Por um endereço público a captura nativa fica desativada: ela rodaria na máquina do servidor e enviaria o áudio de lá. O navegador captura o som daqui, mas a voz dos outros pode voltar como eco. Se você hospeda a sala, abra-a por ' + (audioCapabilities.urlLocal || 'http://localhost:3000') + ' neste computador.',
      remoto: 'A captura nativa só vale no computador que executa o servidor. O navegador captura o som daqui normalmente, mas a voz dos outros pode voltar como eco.'
    };
    echoWarningText.textContent = explicacoes[audioCapabilities.motivo] || explicacoes.remoto;
  }
  atualizarAvisoDeCaptura();
}

// Quem compartilha uma janela paga um preco que nao aparece em lugar nenhum da interface:
// o custo cai DENTRO do jogo, nao na transmissao, entao e facil culpar o Nexo ou a internet.
// A tarja amarela vem do mesmo caminho de captura e nao da para desligar por aqui -- so o
// Windows 11 tem a API que a remove (IsBorderRequired), e ainda assim mediante permissao.
// Como nao ha o que corrigir no codigo, o que cabe e dizer o que esta acontecendo e deixar a
// saida a um clique.
function atualizarAvisoDeCaptura() {
  const mostrar = ehWindows && captureMode.value === 'window';
  capturaAviso.hidden = !mostrar;
  if (!mostrar) return;
  // O custo era descrito e não medido. Agora é medido, e o número é grande o bastante para
  // mudar a decisão de quem lê: mesmo jogo, mesma resolução, mesma prioridade, trocando só
  // janela por tela inteira, os quadros que chegaram ao outro lado foram de 30 para 57.
  capturaAvisoTexto.textContent = 'Compartilhar UMA janela custa quase metade dos quadros: medido '
    + 'aqui, o mesmo jogo em 720p entregou 30 quadros por segundo por janela e 57 pela tela inteira. '
    + 'O Windows precisa desenhar a janela de novo só para a captura, e é daí que vem também a tarja '
    + 'amarela em volta. A tela inteira lê o quadro que a placa de vídeo já fez: mesma imagem, sem '
    + 'tarja, com o dobro da fluidez — e o som do jogo continua saindo sem eco pelo agente.';
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
    : 'Um arquivo só, sem instalar: baixe, dê um duplo clique e deixe a janelinha aberta. Se o antivírus reclamar, é alarme falso — escolha "Manter" nos downloads do navegador.';
  // Dentro do aplicativo o agente vem junto: oferecer o download seria mandar a pessoa
  // resolver a mao um problema que o proprio aplicativo ja resolve.
  agenteDownload.hidden = conectado || Boolean(aplicativoNativo);
  agenteDownload.href = `/api/agente?token=${encodeURIComponent(tokenDoAgente)}`;
  if (!conectado && aplicativoNativo) {
    agenteTexto.textContent = 'Subindo o agente de áudio. Se esta mensagem não sair em alguns '
      + 'segundos, o AgenteAudio.exe não está ao lado do aplicativo.';
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
// O aplicativo em Linux e macOS ainda não tem o agente nativo -- ele é o programa que sabe
// excluir uma árvore de processos da captura, e é essa exclusão que evita o eco. Lá o som da
// tela vem pelo loopback do próprio Electron, que captura TUDO, inclusive o Nexo.
//
// Isto é descoberto ao abrir e guardado: `planoDeAudio` roda a cada mudança do seletor, e
// perguntar ao processo principal a cada chamada seria um ida-e-volta por tecla digitada.
let agenteAusenteNesteSistema = false;
aplicativoNativo?.estadoDoAgente?.().then(estado => {
  agenteAusenteNesteSistema = Boolean(estado?.loopback);
  atualizarExplicacaoDeAudio();
}).catch(() => { /* Aplicativo antigo: segue como antes, sem som de sistema. */ });
if (aplicativoNativo) {
  captureMode.querySelector('option[value="browser"]').remove();
  // Tela inteira, e nao a janela. No Windows a captura de UMA janela passa pelo Windows
  // Graphics Capture: o sistema tem de compor aquela janela outra vez, so para a captura, e
  // um jogo em tela cheia perde o caminho direto ate o monitor -- o FPS que cai e o do JOGO,
  // nao o da transmissao. A tarja amarela em volta e o aviso de captura desse mesmo caminho.
  // A tela inteira le o quadro que a placa de video ja produziu para o monitor: nao muda
  // como o jogo desenha, e nao tem tarja. Para um jogo em tela cheia as duas mostram
  // exatamente a mesma imagem, entao a janela so custa -- nao entrega nada em troca.
  captureMode.value = 'monitor';
  fixEchoBtn.hidden = true;
  document.getElementById('captureCompatibility').hidden = false;
}
// O modo escolhido da ultima vez, se ainda fizer sentido. "excluir-pid" fica de fora de
// proposito: ele so existe rodando dentro do aplicativo, e e decidido logo abaixo pelo
// PID que ele mesmo informa -- restaurar um "excluir-pid" guardado no navegador comum
// deixaria o seletor apontando para um modo que nao tem como funcionar ali.
const modoGuardado = window.Preferencias?.ler('compartilhar.modoDoSom', null);
if (modoGuardado === 'excluir' || modoGuardado === 'incluir') modoDeAudio = modoGuardado;
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
    ? 'Programa que entra'
    : 'Programa que fica de fora';
  if (!precisaEscolher) {
    excluirAppDica.textContent = 'O som deste aplicativo fica fora, então a sala não volta como eco. '
      + 'Todo o resto do computador vai junto.';
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
  if (modoDeAudio !== 'excluir-pid') window.Preferencias?.gravar('compartilhar.modoDoSom', modoDeAudio);
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

// ---------- Abas dos painéis ----------
// Estas telas cresceram até virar rolagem: o que fazia diferença ficava abaixo da dobra, e
// a pessoa tinha de descer procurando. Separar por assunto não esconde nada -- todos os
// controles continuam ali, e cada aba cabe inteira na tela, inclusive no celular.
function montarAbas(caixa) {
  const abas = [...caixa.querySelectorAll('[role="tab"]')];
  const mostrar = escolhida => {
    abas.forEach(aba => {
      const ativa = aba === escolhida;
      aba.setAttribute('aria-selected', String(ativa));
      aba.tabIndex = ativa ? 0 : -1;
      document.getElementById(aba.getAttribute('aria-controls')).hidden = !ativa;
    });
  };
  abas.forEach((aba, indice) => {
    aba.addEventListener('click', () => mostrar(aba));
    // Seta para o lado percorre as abas, como manda o padrão de navegação por teclado.
    aba.addEventListener('keydown', evento => {
      const passo = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
      if (!passo) return;
      evento.preventDefault();
      const alvo = abas[(indice + passo + abas.length) % abas.length];
      mostrar(alvo);
      alvo.focus();
    });
  });
}
document.querySelectorAll('[data-abas]').forEach(montarAbas);

// O que compartilhar e se o som vai junto sao decisoes que a mesma pessoa repete toda vez:
// quem sempre manda a tela inteira com audio nao deveria reescolher isso a cada partida.
//
// So estes dois vivem aqui. O "modo do som do sistema" e restaurado la em cima, junto com
// a variavel de estado que o acompanha, porque o seletor sozinho nao conta a historia --
// e porque dentro do aplicativo ele ja vem decidido pelo PID.
for (const [seletor, chave, respeitarOAplicativo] of [
  [captureMode, 'compartilhar.oQue', true],
  [audioPolicy, 'compartilhar.audio', false]
]) {
  const guardado = window.Preferencias?.ler(chave, null);
  // So aceita valor que ainda EXISTE na lista: uma opcao removida numa versao futura
  // deixaria o seletor num estado que a sala nao sabe tratar.
  //
  // E dentro do aplicativo o QUE compartilhar nao se restaura: ele ja escolheu tela
  // inteira alguns blocos acima, por um motivo que nao e preferencia -- capturar uma
  // janela obriga o Windows a compor aquela janela de novo so para a captura, e quem
  // perde quadros e o jogo. Uma escolha guardada no navegador nao pode desfazer isso.
  const podeRestaurar = guardado && !(respeitarOAplicativo && aplicativoNativo)
    && [...seletor.options].some(o => o.value === guardado);
  if (podeRestaurar) seletor.value = guardado;
  seletor.addEventListener('change', () => window.Preferencias?.gravar(chave, seletor.value));
}

captureMode.onchange = atualizarExplicacaoDeAudio;
audioPolicy.onchange = atualizarExplicacaoDeAudio;

fixEchoBtn.onclick = () => {
  captureMode.value = 'browser';
  atualizarExplicacaoDeAudio();
};

usarTelaInteiraBtn.onclick = () => {
  captureMode.value = 'monitor';
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
  // `loopback` entra aqui porque quem entrega a faixa é o próprio `getDisplayMedia`: o
  // processo principal do Electron responde ao pedido com a fonte de áudio do sistema. Sem
  // pedir áudio na chamada, não há faixa para ele preencher.
  const audioPeloNavegador = ['aba', 'navegador-sistema', 'janela-navegador', 'loopback'].includes(plano);

  // As chaves fora de "video"/"audio" (systemAudio, selfBrowserSurface...) so existem no
  // Chrome/Edge. Firefox e Safari as ignoram, o que e o comportamento desejado.
  const restricoes = {
    video: {
      displaySurface: captureMode.value,
      cursor: 'always',
      width: { ideal: perfilAtual().width, max: perfilAtual().width },
      height: { ideal: perfilAtual().height, max: perfilAtual().height },
      frameRate: { ideal: quadrosDaTela, max: quadrosDaTela }
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
        } else stream.nexoAudioAviso = 'Janela compartilhada sem som: o programa dono dela não foi identificado.';
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
    // Fonte nova, histórico novo: uma janela pequena depois de um monitor inteiro entrega
    // outros números, e compará-los acusaria uma queda que é só outra fonte.
    esquecerHistoricoDoEnvio();
    const faixaDaTela = screenStream.getVideoTracks()[0];
    faixaDaTela.onended = pararTela;
    // O navegador encerra a faixa quando a fonte some -- aba fechada, janela fechada, botão
    // "parar de compartilhar" da barra. Dentro do aplicativo esse aviso nem sempre chega, e
    // é por isso que existe o vigia do processo. Estes dois registros dizem, no diagnóstico
    // de quem relatar o problema, QUAL sinal chegou primeiro: sem isso a escolha entre
    // "esperar o fim da faixa" e "vigiar por fora" seria palpite.
    faixaDaTela.onmute = () => registrarDiagnostico('telaFaixa.muda', 'parou de entregar quadros');
    faixaDaTela.onunmute = () => registrarDiagnostico('telaFaixa.voltou');
    // Entra na mesma fila das telas dos outros: quem comecou antes fica mais a esquerda.
    // Trocar a fonte da tela nao renova o lugar -- a transmissao e a mesma.
    if (!telaAntiga) ordemDaMinhaTela = ++sequenciaDeCompartilhamento;

    definirFaixaEmTodosOsPares('screen', screenStream.getVideoTracks()[0], screenStream);
    atualizarModoSegundoPlano();
    definirFaixaEmTodosOsPares('screenAudio', screenStream.getAudioTracks()[0] || null, screenStream);

    if (telaAntiga) telaAntiga.getTracks().forEach(t => t.stop());
    fecharPainelDeTela();
    pintarBotaoDaTela(true);
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
        ? 'Compartilhando a tela, mas sem som: a captura de áudio não iniciou.'
        : 'Compartilhando a tela sem som. Para levar o áudio junto, compartilhe uma aba e marque a caixa de áudio do navegador.';
    }
    else if (plano === 'loopback') status.textContent = 'Compartilhando tela + som deste computador. Use fones para não gerar eco.';
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
  // Sem este aviso o vigia do aplicativo continuaria de pé depois da transmissão acabar, e
  // dispararia fora de hora -- quando a pessoa fechasse aquele programa horas depois.
  aplicativoNativo?.encerreiCaptura?.().catch(() => {});
  ordemDaMinhaTela = 0;
  limparAudioDoAplicativo();
  definirFaixaEmTodosOsPares('screen', null, null);
  atualizarModoSegundoPlano();
  definirFaixaEmTodosOsPares('screenAudio', null, null);
  pintarBotaoDaTela(false);
  updateScreenBtn.hidden = true;
  atualizarTile('self');
  if (pinned?.id === 'self' && pinned.source === 'screen') { pinned = null; destaqueManual = false; }
  avaliarDestaque();
  status.textContent = 'Compartilhamento de tela encerrado.';
  enviarEstado();
}

// Fechar o aplicativo compartilhado encerra a transmissão. Quem fecha o programa já decidiu
// parar de mostrá-lo; deixar a sala olhando o último quadro congelado não é o que ninguém
// espera, e ainda custa banda a quem hospeda.
//
// O aviso vem do processo principal, que vigia o processo dono da janela (ver app/main.js).
// A guarda de "estou compartilhando agora" é o que separa este caso de um aviso atrasado:
// o vigia é desligado ao parar, mas uma corrida entre parar e fechar continua possível.
aplicativoNativo?.aoEncerrarCaptura?.(() => {
  if (!screenStream) return;
  registrarDiagnostico('tela.aplicativoFechou');
  pararTela();
  status.textContent = 'O aplicativo que você compartilhava foi fechado. Transmissão encerrada.';
});

// Celulares (iOS e Android) nao implementam getDisplayMedia: em vez de deixar o botao
// falhar no clique, ele fica desativado com o motivo à vista. Câmera e microfone
// continuam funcionando normalmente nesses aparelhos.
if (!suportaCompartilharTela) {
  screenBtn.disabled = true;
  screenBtn.title = 'Este navegador não permite compartilhar tela (comum em celulares).';
  screenBtn.classList.add('desligado');
}

screenBtn.onclick = () => {
  if (!suportaCompartilharTela) {
    status.textContent = 'Este navegador não compartilha tela. Use um computador para transmitir a sua.';
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
// Parar de assistir tira a tela do palco sozinho: sem fonte, `avaliarDestaque` escolhe a
// próxima. Não é preciso despinar aqui.
stageStopBtn.onclick = () => {
  if (pinned?.source === 'screen' && pinned.id !== 'self') assistirTela(pinned.id, false);
};
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

// ---------- Segundo plano no celular ----------
// Celular suspende getUserMedia quando o navegador sai de primeiro plano -- isso e o
// sistema operacional protegendo camera e microfone, nao da para contornar via JS. O que
// da para fazer e convencer o navegador de que esta aba "toca midia", que e o unico caso
// em que Android (Chrome) deixa de congelar a aba agressivamente: um <audio> realmente
// tocando, mais uma Media Session registrada. Video de camera mesmo assim para quando a
// tela bloqueia ou o app troca -- so o audio tem chance real de sobreviver, e so no
// Android; no iPhone (Safari) o sistema e bem mais restritivo e pode cortar de qualquer
// jeito. Nada aqui e garantia, e sim a melhor tentativa que o navegador permite.
let elementoDeFundo = null;
let contextoDeFundo = null;
let travaDeTela = null;

// Diagnostico temporario: "para depois de alguns segundos" pode ser (a) o Android revogando
// o hardware do microfone quando o Chrome perde o foco -- sem solucao via JS --, (b) o
// AudioContext do truque de audio sendo suspenso pelo navegador, ou (c) a propria conexao
// com o servidor de midia caindo. Cada causa pede um remedio diferente (ou nenhum), entao
// fica registrado em vez de adivinhado. Remover depois de descobrir a causa real.
const DIAGNOSTICO_CHAVE = 'sala.diagnosticoSegundoPlano';
const inicioDoDiagnostico = Date.now();
function registrarDiagnostico(evento, detalhe = '') {
  const linha = `+${((Date.now() - inicioDoDiagnostico) / 1000).toFixed(1)}s ${evento}${detalhe ? ' ' + detalhe : ''}`;
  console.info('[bg]', linha);
  try {
    const lista = JSON.parse(localStorage.getItem(DIAGNOSTICO_CHAVE) || '[]');
    lista.push(linha);
    while (lista.length > 300) lista.shift();
    localStorage.setItem(DIAGNOSTICO_CHAVE, JSON.stringify(lista));
  } catch (_) {}
}
window.verDiagnosticoSegundoPlano = () => {
  try { return JSON.parse(localStorage.getItem(DIAGNOSTICO_CHAVE) || '[]').join('\n'); }
  catch (_) { return ''; }
};
window.limparDiagnosticoSegundoPlano = () => { try { localStorage.removeItem(DIAGNOSTICO_CHAVE); } catch (_) {} };

// O áudio de fundo não existe para alguém ouvir: ele existe para o navegador NÃO tratar
// esta aba como ociosa. Aba sem áudio tocando é candidata a throttling agressivo -- os
// temporizadores caem para um por minuto, e com eles vão os batimentos que mantêm a
// sinalização viva. Aparece como "fulano caiu sozinho", e cai justamente quem está quieto.
//
// A pergunta aqui era "está produzindo alguma coisa?", e a resposta virava NÃO no instante
// em que a pessoa mutava o microfone -- exatamente o momento em que ela mais precisa da
// proteção, porque acabou de ficar quieta. Quem só assistia nunca teve proteção nenhuma, e
// compartilhar tela não contava. A pergunta certa é "está na sala?".
//
// Custa um oscilador silencioso. Perder a chamada custa a conversa.
function precisaDeSegundoPlano() {
  return Boolean(transporte?.conectada || socket?.connected || micStream || cameraStream || screenStream);
}

// A trava de tela é outra conversa: ela mantém o MONITOR aceso, e isso tem custo real de
// bateria. Vale enquanto há algo que a pessoa esteja produzindo ou olhando -- inclusive a
// tela de outro, que é o caso clássico de o monitor apagar no meio da apresentação.
function precisaDeTravaDeTela() {
  if ((micStream && !micMuted) || cameraStream || screenStream) return true;
  for (const par of peers.values()) if (par.assistindo) return true;
  return false;
}

function garantirAudioDeFundo() {
  if (elementoDeFundo || !AudioContextClass) return;
  try {
    // Referencia propria porque o close() do pararAudioDeFundo dispara "statechange" DEPOIS
    // de a variavel ja ter virado null: lendo a global, o ouvinte estourava um TypeError
    // bem no caminho de saida da sala.
    const contexto = contextoDeFundo = new AudioContextClass();
    const destino = contexto.createMediaStreamDestination();
    const fonte = contexto.createConstantSource();
    const ganho = contexto.createGain();
    // Nao e zero de proposito: alguns navegadores detectam silencio absoluto e aplicam o
    // mesmo throttling de uma aba sem audio nenhum. Neste volume nao da para ouvir.
    ganho.gain.value = 0.0001;
    fonte.connect(ganho).connect(destino);
    fonte.start();
    contexto.resume().catch(() => {});
    contexto.addEventListener('statechange', () => registrarDiagnostico('audioDeFundo.contexto', contexto.state));
    elementoDeFundo = new Audio();
    elementoDeFundo.srcObject = destino.stream;
    elementoDeFundo.volume = 0.01;
    elementoDeFundo.addEventListener('pause', () => registrarDiagnostico('audioDeFundo.pausou'));
    elementoDeFundo.addEventListener('ended', () => registrarDiagnostico('audioDeFundo.terminou'));
    elementoDeFundo.addEventListener('error', () => registrarDiagnostico('audioDeFundo.erro'));
    elementoDeFundo.play().then(() => registrarDiagnostico('audioDeFundo.tocando'))
      .catch(err => registrarDiagnostico('audioDeFundo.playFalhou', err.name));
  } catch (err) { registrarDiagnostico('audioDeFundo.excecao', err.message); }
}

function pararAudioDeFundo() {
  elementoDeFundo?.pause();
  elementoDeFundo = null;
  contextoDeFundo?.close().catch(() => {});
  contextoDeFundo = null;
}

function atualizarMediaSession(ativo) {
  if (!('mediaSession' in navigator)) return;
  try {
    if (ativo) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `Sala ${roomCode}`, artist: 'Nexo' });
      navigator.mediaSession.playbackState = 'playing';
      // Handlers vazios: sem eles alguns sistemas mostram os controles de midia
      // desabilitados, e o botao de "pausar" de um fone bluetooth poderia parar a aba.
      ['play', 'pause', 'stop'].forEach(acao => {
        try { navigator.mediaSession.setActionHandler(acao, () => {}); } catch (_) {}
      });
    } else {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    }
  } catch (_) { /* Media Session nao suportada ou instavel neste navegador */ }
}

async function pedirTravaDeTela() {
  if (travaDeTela || !('wakeLock' in navigator) || document.hidden) return;
  try {
    travaDeTela = await navigator.wakeLock.request('screen');
    registrarDiagnostico('wakeLock.concedida');
    travaDeTela.addEventListener('release', () => { travaDeTela = null; registrarDiagnostico('wakeLock.liberada'); });
  } catch (err) { registrarDiagnostico('wakeLock.negada', err.message); }
}

function instrumentarFaixaDoMic(faixa) {
  if (!faixa) return;
  faixa.onmute = () => registrarDiagnostico('micTrack.mute');
  faixa.onunmute = () => registrarDiagnostico('micTrack.unmute');
  faixa.onended = () => registrarDiagnostico('micTrack.ended');
}
document.addEventListener('visibilitychange', () => {
  registrarDiagnostico('visibilitychange', document.visibilityState);
  // Aba escondida não precisa receber imagem -- só som. Quem decide o que isso significa é
  // o transporte; daqui vai apenas o fato.
  transporte?.definirAbaVisivel(!document.hidden);
});
// O LiveKit se desconecta sozinho em "pagehide"/"beforeunload" (por causa da opcao
// disconnectOnPageLeave) e tambem em "freeze" (a Page Lifecycle API do Chrome, sempre, mesmo
// com a opcao desligada). Qualquer um destes tres pode ser quem esta matando a chamada ao
// trocar de app, entao ficam registrados na ordem em que o navegador realmente os dispara.
['pagehide', 'freeze', 'beforeunload', 'resume'].forEach(nomeDoEvento => {
  window.addEventListener(nomeDoEvento, event => registrarDiagnostico('window.' + nomeDoEvento, 'persisted' in event ? `persisted=${event.persisted}` : ''));
});

function liberarTravaDeTela() {
  travaDeTela?.release().catch(() => {});
  travaDeTela = null;
}

function atualizarModoSegundoPlano() {
  const ativo = precisaDeSegundoPlano();
  atualizarMediaSession(ativo);
  if (ativo) garantirAudioDeFundo(); else pararAudioDeFundo();
  // Separado do de cima de propósito: manter a aba viva e manter o monitor aceso são
  // decisões diferentes, com custos diferentes, e amarrá-las foi o que fez o silêncio de
  // alguém virar desconexão.
  if (precisaDeTravaDeTela()) pedirTravaDeTela(); else liberarTravaDeTela();
}

// ---------- Sair ----------
let saindoDaSala = false;
function encerrarMidiasDaSala() {
  micStream?.getTracks().forEach(t => t.stop());
  cameraStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  desmontarFiltroDeRuido();
  pararAudioDeFundo();
  liberarTravaDeTela();
  atualizarMediaSession(false);
  Array.from(peers.keys()).forEach(removerPar);
  // Sem isto o servidor de midia so notaria a saida pelo tempo limite, e por alguns
  // segundos os outros continuariam vendo uma imagem congelada de quem ja foi embora.
  transporte?.desconectar();
  limparAudioDoAplicativo().catch(() => {});
}
async function sairDaSala() {
  if (saindoDaSala) return;
  saindoDaSala = true;
  await Promise.race([relatarRecebimento(), new Promise(resolve => setTimeout(resolve, 400))]);
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
// O rotulo volta ao que ESTAVA, e nao a um texto fixo: antes o botao nascia "Convidar
// amigos", virava "Link copiado!" e terminava "Copiar link" para o resto da sessao.
const ROTULO_DO_CONVITE = copyLinkBtn.textContent;
let voltaDoConvite = null;
copyLinkBtn.onclick = async () => {
  const link = RoomMedia.inviteUrl(window.location.href, publicInviteUrl, roomCode);
  try {
    await navigator.clipboard.writeText(link);
    copyLinkBtn.textContent = 'Link copiado!';
    copyLinkBtn.classList.add('copiado');
    clearTimeout(voltaDoConvite);
    voltaDoConvite = setTimeout(() => {
      copyLinkBtn.textContent = ROTULO_DO_CONVITE;
      copyLinkBtn.classList.remove('copiado');
    }, 1800);
  } catch (_) {
    document.getElementById('inviteLink').value = link;
    document.getElementById('invitePanel').classList.remove('hidden');
    document.getElementById('inviteLink').select();
  }
};

// ---------- Tiles (UI de participantes) ----------
// Os mesmos dois controles aparecem no quadradinho e no card da grade. Um molde so evita
// que eles se afastem um do outro com o tempo -- e e o que permite ao pintarControleDeVolume
// tratar os dois pelo mesmo caminho.
const LINHA_DE_VOLUME = alvo => `
  <input type="range" class="volume-slider" min="0" max="100" value="100" step="1" data-alvo="${alvo}">
  <button class="mute-peer-btn" type="button" aria-pressed="false"></button>
`;

// ---------- Acesso e permissões da sala ----------
const controlesDaConfiguracao = {
  roomLocked: 'trancada', allowScreen: 'compartilharTela',
  allowSoundboard: 'soundboard', allowMusic: 'musica'
};

function aplicarConfiguracaoDaSala(nova) {
  configuracaoDaSala = { ...configuracaoDaSala, ...(nova || {}) };
  for (const [id, chave] of Object.entries(controlesDaConfiguracao)) {
    const campo = document.getElementById(id);
    if (!campo) continue;
    campo.checked = Boolean(configuracaoDaSala[chave]);
    campo.disabled = !podeModerar;
  }
  const telaPermitida = podeModerar || configuracaoDaSala.compartilharTela;
  // Duas razões independentes fecham este botão, e só uma delas é a sala: o celular que não
  // sabe compartilhar tela continua sem o recurso mesmo numa sala liberada. Ignorar isso
  // devolvia o botão a quem não tem como usá-lo, com a explicação apagada por cima.
  screenBtn.disabled = !telaPermitida || !suportaCompartilharTela;
  if (!telaPermitida && screenStream) pararTela();
  if (!suportaCompartilharTela) screenBtn.title = 'Este navegador não permite compartilhar tela (comum em celulares).';
  else if (!telaPermitida) screenBtn.title = 'Quem abriu a sala restringiu o compartilhamento de tela';
  // Liberada de novo, a dica volta a dizer o que o botão faz -- senão ela ficava presa na
  // restrição antiga, contando uma regra que já não existe.
  else pintarBotaoDaTela(Boolean(screenStream));
  screenBtn.setAttribute('aria-label', screenBtn.title);
  const sonsPermitidos = podeModerar || configuracaoDaSala.soundboard;
  const somBtn = document.getElementById('soundboardBtn');
  if (somBtn) { somBtn.disabled = !sonsPermitidos; somBtn.title = sonsPermitidos ? 'Mesa de sons da sala' : 'Mesa de sons restrita por quem abriu a sala'; }
  // Apagar não segue a chave da mesa: restringir trava enviar e tocar, e apagar o som de
  // outra pessoa é moderação. Esta função roda sempre que o dono muda, e é por isso que o
  // aviso sai daqui.
  window.NexoSoundboard?.definirPodeApagar?.(podeModerar);
  const musicaPermitida = podeModerar || configuracaoDaSala.musica;
  const musicaInput = document.getElementById('musicaInput');
  const musicaSend = document.getElementById('musicaSend');
  if (musicaInput) { musicaInput.disabled = !musicaPermitida; musicaInput.placeholder = musicaPermitida ? 'Nome da música, link ou !ajuda…' : 'Novos pedidos foram restringidos'; }
  if (musicaSend) musicaSend.disabled = !musicaPermitida;
}

Object.entries(controlesDaConfiguracao).forEach(([id, chave]) => {
  document.getElementById(id)?.addEventListener('change', evento => {
    if (!socket?.connected || !podeModerar) return;
    socket.emit('sala-configurar', { [chave]: evento.target.checked }, resposta => {
      if (!resposta?.ok) { status.textContent = resposta?.error || 'Não foi possível alterar a sala.'; aplicarConfiguracaoDaSala(configuracaoDaSala); }
    });
  });
});

const pedidosPendentes = new Map();
let temporizadorAvisoDeEntrada = null;
function tocarAvisoDeEntrada() {
  try {
    const contexto = new AudioContextClass();
    const ganho = contexto.createGain();
    const oscilador = contexto.createOscillator();
    oscilador.frequency.setValueAtTime(660, contexto.currentTime);
    oscilador.frequency.exponentialRampToValueAtTime(880, contexto.currentTime + .12);
    ganho.gain.setValueAtTime(.0001, contexto.currentTime);
    ganho.gain.exponentialRampToValueAtTime(.09, contexto.currentTime + .02);
    ganho.gain.exponentialRampToValueAtTime(.0001, contexto.currentTime + .22);
    oscilador.connect(ganho).connect(contexto.destination);
    oscilador.start(); oscilador.stop(contexto.currentTime + .24);
    oscilador.onended = () => contexto.close().catch(() => {});
  } catch (_) { /* O aviso visual continua disponível se o navegador bloquear áudio. */ }
}
function atualizarAvisoDeEntrada(nome) {
  const total = podeModerar ? pedidosPendentes.size : 0;
  const contador = document.getElementById('joinRequestCount');
  contador.hidden = !total;
  contador.textContent = total > 9 ? '9+' : String(total);
  const aviso = document.getElementById('joinRequestNotice');
  clearTimeout(temporizadorAvisoDeEntrada);
  temporizadorAvisoDeEntrada = null;
  aviso.hidden = !total;
  if (!total) return;
  document.getElementById('joinRequestNoticeTitle').textContent = total === 1
    ? `${nome || [...pedidosPendentes.values()][0]?.nome || 'Alguém'} quer entrar`
    : `${total} pessoas querem entrar`;
  temporizadorAvisoDeEntrada = setTimeout(() => {
    aviso.hidden = true;
    temporizadorAvisoDeEntrada = null;
  }, 7000);
}
function desenharPedidosDeEntrada(lista) {
  pedidosPendentes.clear();
  (lista || []).forEach(p => pedidosPendentes.set(p.identidade, p));
  renderizarPedidosDeEntrada();
  atualizarAvisoDeEntrada();
}
function adicionarPedidoDeEntrada(pedido) {
  if (!podeModerar || !pedido?.identidade || pedido.estado === 'recusado') return;
  const novo = !pedidosPendentes.has(pedido.identidade);
  pedidosPendentes.set(pedido.identidade, pedido);
  if (!novo) return;
  renderizarPedidosDeEntrada();
  atualizarAvisoDeEntrada(pedido.nome);
  tocarAvisoDeEntrada();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`${pedido.nome || 'Alguém'} quer entrar no Nexo`, { body: `Sala ${roomCode}`, tag: `entrada-${roomCode}` });
  }
  status.textContent = `${pedido.nome || 'Alguém'} quer entrar na sala.`;
}
function removerPedidoDeEntrada(identidade) { pedidosPendentes.delete(identidade); renderizarPedidosDeEntrada(); atualizarAvisoDeEntrada(); }
function renderizarPedidosDeEntrada() {
  const caixa = document.getElementById('joinRequests');
  if (!caixa) return;
  caixa.replaceChildren();
  if (!podeModerar || !pedidosPendentes.size) return;
  caixa.append(elemento('strong', '', 'Pedidos de entrada'));
  pedidosPendentes.forEach(pedido => {
    const linha = elemento('div', 'join-request');
    linha.append(elemento('span', '', pedido.nome || 'Convidado'));
    for (const [rotulo, aceitar] of [['Aceitar', true], ['Recusar', false]]) {
      const botao = elemento('button', aceitar ? '' : 'secondary', rotulo);
      botao.type = 'button';
      botao.onclick = () => socket.emit('resolver-entrada', { identidade: pedido.identidade, aceitar }, resposta => {
        if (resposta?.ok) removerPedidoDeEntrada(pedido.identidade);
        else status.textContent = resposta?.error || 'Não foi possível responder ao pedido.';
      });
      linha.append(botao);
    }
    caixa.append(linha);
  });
}

// ---------- Moderação ----------
//
// O botão nasce escondido e só aparece para quem pode usá-lo. Isso é conveniência de
// interface e nada mais: quem manda é o servidor (ver o handler de `moderar`, em server.js),
// e um cliente modificado chegaria lá do mesmo jeito para ser recusado.
const BOTAO_DE_MODERAR = '<button class="moderar-btn" type="button" hidden aria-label="Moderar este participante">⋮</button>';

// Percorre os quadradinhos aplicando o selo e a visibilidade do botão. Roda em toda mudança
// de dono e em toda entrada: são os dois momentos em que a resposta pode ter mudado, e
// recalcular tudo é barato numa sala de dezenas.
function atualizarSelosDeDono() {
  // O acesso à moderação da SALA -- a lista de bloqueados -- só existe para quem pode usá-la.
  const botaoDaSala = document.getElementById('moderarSalaBtn');
  if (botaoDaSala) botaoDaSala.hidden = !podeModerar;
  tiles.forEach((refs, id) => {
    const identidade = id === 'self' ? myId : id;
    refs.donoSelo?.classList.toggle('hidden', !donoDaSala || identidade !== donoDaSala);
    // Nunca sobre o próprio dono: passar a sala existe no painel, mas "remover" não se
    // aplica a quem abriu -- e o servidor recusaria de todo modo.
    if (refs.moderarBtn) refs.moderarBtn.hidden = !podeModerar || id === 'self' || identidade === donoDaSala;
  });
}

// Quem está no painel agora. Guardado porque o painel é um só, reaproveitado -- e sem isso
// um clique em "remover" depois de trocar de pessoa agiria sobre a anterior.
let alvoDaModeracao = null;

// `id` nulo abre o painel SEM alvo: só a lista de bloqueados. É o caminho de que o dono
// precisa justamente quando não há mais ninguém para moderar -- liberar alguém acontece
// depois de a sala ter se acalmado, e exigir um clique sobre um participante presente faria
// dessa hora a única em que a ação é impossível.
function abrirModeracao(id) {
  if (!podeModerar) return;
  const par = id ? peers.get(id) : null;
  if (id && !par) return;
  alvoDaModeracao = id || null;
  document.getElementById('moderarNome').textContent = par ? (par.name || 'Participante') : 'esta sala';
  document.getElementById('moderarAcoes').hidden = !par;
  document.getElementById('moderarRessalva').hidden = !par;
  document.getElementById('roomSecurity').hidden = Boolean(par);
  document.getElementById('moderarStatus').textContent = '';
  document.getElementById('moderarPanel').classList.remove('hidden');
  carregarRemovidos();
}

function fecharModeracao() {
  alvoDaModeracao = null;
  document.getElementById('moderarPanel').classList.add('hidden');
}

// A lista vem do servidor a cada abertura, e não de um cache: o prazo de cada bloqueio corre,
// e mostrar "faltam 58 min" de dez minutos atrás seria pior do que não mostrar nada.
function carregarRemovidos() {
  socket.emit('moderar', { acao: 'removidos' }, resposta => desenharRemovidos(resposta));
}

function desenharRemovidos(resposta) {
  const caixa = document.getElementById('moderarListaRemovidos');
  caixa.textContent = '';
  if (!resposta?.ok) { caixa.append(elemento('span', 'moderar-vazio', resposta?.error || 'Não foi possível ler a lista.')); return; }
  const lista = resposta.removidos || [];
  if (!lista.length) { caixa.append(elemento('span', 'moderar-vazio', 'Ninguém bloqueado nesta sala.')); return; }
  for (const item of lista) {
    const linha = elemento('div', 'moderar-removido');
    // O nome entra como TEXTO, como todo nome nesta interface: ele foi escolhido por quem
    // entrou na sala.
    linha.append(elemento('span', 'moderar-removido-nome', item.nome));
    linha.append(elemento('span', 'moderar-removido-prazo', `${item.minutos} min`));
    const liberar = elemento('button', 'secondary', 'Liberar');
    liberar.type = 'button';
    liberar.addEventListener('click', () => {
      liberar.disabled = true;
      socket.emit('moderar', { acao: 'desbanir', nome: item.nome }, resposta => {
        if (!resposta?.ok) { liberar.disabled = false; document.getElementById('moderarStatus').textContent = resposta?.error || 'Não foi possível liberar.'; return; }
        document.getElementById('moderarStatus').textContent = `${item.nome} pode voltar à sala.`;
        desenharRemovidos(resposta);
      });
    });
    linha.append(liberar);
    caixa.append(linha);
  }
}

function pedirModeracao(acao) {
  const alvo = alvoDaModeracao;
  if (!alvo) return;
  const aviso = document.getElementById('moderarStatus');
  aviso.textContent = 'Enviando…';
  socket.emit('moderar', { acao, identidade: alvo }, resposta => {
    if (!resposta?.ok) { aviso.textContent = resposta?.error || 'Não foi possível concluir.'; return; }
    fecharModeracao();
    const nome = peers.get(alvo)?.name || 'A pessoa';
    status.textContent = acao === 'transferir' ? `${nome} agora é quem manda nesta sala.`
      : acao === 'banir' ? `${nome} foi removida e não pode voltar por uma hora.`
      : `${nome} foi removida da sala.`;
  });
}

document.getElementById('moderarSalaBtn').onclick = () => abrirModeracao(null);
document.getElementById('joinRequestNoticeOpen').onclick = () => {
  clearTimeout(temporizadorAvisoDeEntrada);
  temporizadorAvisoDeEntrada = null;
  document.getElementById('joinRequestNotice').hidden = true;
  abrirModeracao(null);
};
document.getElementById('moderarRemover').onclick = () => pedirModeracao('expulsar');
document.getElementById('moderarBanir').onclick = () => pedirModeracao('banir');
document.getElementById('moderarTransferir').onclick = () => pedirModeracao('transferir');
document.querySelector('#moderarPanel [data-close]').addEventListener('click', fecharModeracao);

// Este botao era invisivel ate o mouse passar por cima, e existia mesmo sem camera nenhuma
// para ocultar: um alvo transparente que nao anunciava nada e, quando anunciava, nao servia
// para nada. Agora ele tem rotulo, e quem decide se ele aparece e a existencia da fonte.
const BOTAO_DE_OCULTAR = () => `
  <button class="hide-self-btn" type="button" aria-pressed="false" hidden><span>Ocultar</span></button>
  <div class="oculto-overlay hidden">
    <strong>Oculto para você</strong>
    <small>A sala continua recebendo normalmente.</small>
  </div>
`;

function pintarBotaoDeOcultar(refs, fonte, oculto, existe) {
  if (!refs.hideBtn) return;
  const coisa = fonte === 'screen' ? 'sua tela' : 'sua câmera';
  refs.hideBtn.hidden = !existe;
  refs.hideBtn.setAttribute('aria-pressed', String(oculto));
  refs.hideBtn.querySelector('span').textContent = oculto ? 'Mostrar' : 'Ocultar';
  refs.hideBtn.title = oculto
    ? `Voltar a ver ${coisa} aqui`
    : `Ocultar ${coisa} só para você — a sala continua recebendo`;
  refs.hideBtn.setAttribute('aria-label', refs.hideBtn.title);
  refs.ocultoOverlay.classList.toggle('hidden', !(existe && oculto));
}

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
      <span class="presence-badge hidden" aria-label="Status"></span>
      ${isSelf ? BOTAO_DE_OCULTAR('camera') : BOTAO_DE_MODERAR}
    </div>
    <div class="participant-name"></div>
    <div class="volume-row"></div>
    <audio class="peer-audio" autoplay></audio>
    <audio class="screen-audio" autoplay></audio>
  `;
  // O selo do dono é um elemento próprio, e não parte do texto do nome: o nome é escrito com
  // `textContent` justamente porque vem de quem escolheu o nome, e concatenar um selo ali
  // faria "Fulano · dono" ser um nome possível de escolher.
  const linhaDoNome = el.querySelector('.participant-name');
  linhaDoNome.textContent = `${name}${isSelf ? ' (você)' : ''}`;
  linhaDoNome.append(elemento('span', 'dono-selo hidden', 'abriu a sala'));
  el.querySelector('.avatar-fallback').textContent = iniciais(name);
  el.querySelector('.avatar-fallback').style.background = corDoNome(name);
  const volumeRow = el.querySelector('.volume-row');
  if (!isSelf) volumeRow.innerHTML = LINHA_DE_VOLUME('voz');
  participantsEl.appendChild(el);

  const refs = {
    root: el,
    camVideo: el.querySelector('.cam-video'),
    avatar: el.querySelector('.avatar-fallback'),
    micIcon: el.querySelector('.mic-icon'),
    screenBadge: el.querySelector('.screen-badge'),
    presenceBadge: el.querySelector('.presence-badge'),
    peerAudio: el.querySelector('.peer-audio'),
    screenAudio: el.querySelector('.screen-audio'),
    volumeSlider: el.querySelector('.volume-slider'),
    muteBtn: el.querySelector('.mute-peer-btn'),
    donoSelo: el.querySelector('.dono-selo'),
    moderarBtn: el.querySelector('.moderar-btn'),
    hideBtn: el.querySelector('.hide-self-btn'),
    ocultoOverlay: el.querySelector('.oculto-overlay'),
    localMute: false,
    volumeDeVoz: 1
  };
  tiles.set(id, refs);
  reordenarQuadradinhos();
  // Elemento novo nasce na saida escolhida: sem isto, so quem ja estava na sala sairia
  // pelo fone certo, e quem entrasse depois voltaria para o padrao do sistema.
  aplicarSaidaEm(refs.peerAudio);
  aplicarSaidaEm(refs.screenAudio);
  // E no volume em que esta pessoa foi deixada da ultima vez. Quem baixou o som de alguem
  // que fala alto nao deveria ter de baixar de novo a cada entrada.
  aplicarAudioLembrado(id);

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
    refs.volumeSlider.addEventListener('input', () => definirAudioDaVoz(id, { nivel: refs.volumeSlider.value / 100 }));
    refs.muteBtn.addEventListener('click', () => definirAudioDaVoz(id, { alternarMudo: true }));
    refs.moderarBtn?.addEventListener('click', evento => {
      // Sem isto o clique sobe para o avatar e põe a pessoa no palco -- abrir o painel de
      // moderação de alguém não é o mesmo que querer olhar para ela.
      evento.stopPropagation();
      abrirModeracao(id);
    });
    sincronizarControlesDeAudio(id);
  } else {
    refs.hideBtn.addEventListener('click', evento => {
      evento.stopPropagation();
      alternarOcultarPropria('camera');
    });
  }

  // Um quadradinho novo precisa nascer sabendo se aquela pessoa é a dona e se eu posso
  // moderá-la: quem entra depois de mim chega sem selo nenhum se isto não for aplicado aqui.
  atualizarSelosDeDono();
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
  // Sempre, e nao so quando a faixa chegou: o quadradinho da tela agora existe desde o
  // anuncio, com o convite para assistir. Esperar a faixa deixaria a tela invisivel para
  // sempre, porque a faixa so desce depois que alguem pede.
  atualizarTileDeTela(id);
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

// ---------- Volume, em um lugar so ----------
// O mesmo som agora tem dois controles na tela: o do quadradinho, la embaixo, e o do card
// na grade. Se cada um guardar o proprio numero, mexer em um deixa o outro mentindo. Entao
// quem manda e a preferencia guardada aqui; os controles so a leem e a escrevem, e depois
// de qualquer escrita todo mundo se redesenha a partir dela.
//
// Volume de <audio> so aceita 0..1 por especificacao; acima disso o navegador lanca
// IndexSizeError e o ajuste inteiro se perde.
const entre0e1 = valor => Math.max(0, Math.min(1, Number(valor) || 0));

function telaTemSom(id) {
  const peer = peers.get(id);
  return Boolean(peer?.state.screenAudio && peer.remoteStreams.screenAudio.getAudioTracks().some(t => t.readyState === 'live'));
}

function audioDaTela(id) {
  const pref = preferenciaDeTela(id);
  return { nivel: pref.nivel, mudo: pref.mudo, disponivel: telaTemSom(id) };
}

function definirAudioDaTela(id, { nivel, alternarMudo, lembrar = true }) {
  const pref = preferenciaDeTela(id);
  if (nivel !== undefined) {
    pref.nivel = entre0e1(nivel);
    // Arrastar o volume para cima quer dizer "quero ouvir": tira do mudo sozinho.
    if (pref.mudo && pref.nivel > 0) pref.mudo = false;
  }
  if (alternarMudo) pref.mudo = !pref.mudo;
  if (lembrar) lembrarAudioDe(id);
  atualizarAudioDeTela();
  sincronizarControlesDeAudio(id);
}

function audioDaVoz(id) {
  const refs = tiles.get(id);
  const peer = peers.get(id);
  return {
    nivel: refs ? refs.volumeDeVoz : 1,
    mudo: Boolean(refs?.localMute),
    disponivel: Boolean(peer?.remoteStreams.micAudio.getAudioTracks().some(t => t.readyState === 'live'))
  };
}

function definirAudioDaVoz(id, { nivel, alternarMudo, lembrar = true }) {
  const refs = tiles.get(id);
  if (!refs) return;
  if (nivel !== undefined) {
    refs.volumeDeVoz = entre0e1(nivel);
    if (refs.localMute && refs.volumeDeVoz > 0) refs.localMute = false;
  }
  if (alternarMudo) refs.localMute = !refs.localMute;
  refs.peerAudio.volume = refs.volumeDeVoz;
  // Ensurdecer cala por cima, sem apagar o mudo individual: ao voltar a ouvir, quem estava
  // calado continua calado e quem não estava volta a falar.
  refs.peerAudio.muted = refs.localMute || ensurdecido;
  if (pinned?.id === id && pinned.source === 'camera') stageVideo.volume = refs.volumeDeVoz;
  sincronizarControlesDeAudio(id);
  // `lembrar: false` e usado ao APLICAR o que ja estava guardado -- senao a aplicacao
  // regravaria a mesma coisa e mexeria na ordem de despejo por nada.
  if (lembrar) lembrarAudioDe(id);
}

// ---------- O que foi escolhido para cada pessoa ----------
//
// Guardado pelo NOME, e nao pelo identificador: a identidade de midia carrega um sufixo
// sorteado a cada entrada, entao lembrar por ela seria nao lembrar nada. Pelo nome, a
// escolha sobrevive a sair e voltar, e vale em qualquer sala -- inclusive para o bot de
// musica, cujo nome e sempre o mesmo.
function nomeParaPreferencia(id) {
  if (id === 'self') return null;                    // o proprio audio nao se ouve
  return peers.get(id)?.name || null;
}

// Arrastar um controle de volume dispara "input" a cada pixel -- algumas dezenas de vezes
// num gesto so. Gravar em cada uma seria gravar trinta vezes o caminho de um dedo, e
// escrever no armazenamento do navegador e SINCRONO: trava a mesma linha de execucao que
// desenha a sala. Guardar so depois que a mao para custa uma escrita por ajuste.
let gravacaoAdiada = null;
const pendentes = new Set();

function lembrarAudioDe(id) {
  if (!nomeParaPreferencia(id) || !window.Preferencias) return;
  pendentes.add(id);
  clearTimeout(gravacaoAdiada);
  gravacaoAdiada = setTimeout(gravarOQueFicouPendente, 400);
}

function gravarOQueFicouPendente() {
  clearTimeout(gravacaoAdiada);
  gravacaoAdiada = null;
  for (const id of pendentes) {
    const nome = nomeParaPreferencia(id);
    if (!nome) continue;
    const voz = tiles.get(id);
    const tela = volumeDaTela.get(id);
    window.Preferencias?.guardarAudioDe(nome, {
      voz: voz ? voz.volumeDeVoz : 1,
      vozMuda: Boolean(voz?.localMute),
      tela: tela ? tela.nivel : 1,
      telaMuda: Boolean(tela?.mudo)
    });
  }
  pendentes.clear();
}

// Fechar a aba no meio do atraso nao pode perder o ajuste que a pessoa acabou de fazer.
window.addEventListener('pagehide', gravarOQueFicouPendente);

// Chamado quando alguem entra: devolve a essa pessoa o volume em que ela foi deixada da
// ultima vez, em vez de comecar todo mundo em 100% de novo a cada sessao.
function aplicarAudioLembrado(id) {
  const nome = nomeParaPreferencia(id);
  if (!nome || !window.Preferencias) return;
  const guardado = window.Preferencias.audioDe(nome);
  const refs = tiles.get(id);
  if (refs) {
    refs.volumeDeVoz = entre0e1(guardado.voz);
    refs.localMute = Boolean(guardado.vozMuda);
    definirAudioDaVoz(id, { lembrar: false });
  }
  if (guardado.tela !== 1 || guardado.telaMuda) {
    const pref = preferenciaDeTela(id);
    pref.nivel = entre0e1(guardado.tela);
    pref.mudo = Boolean(guardado.telaMuda);
    definirAudioDaTela(id, { lembrar: false });
  }
}

// Redesenha TODOS os controles do mesmo som a partir da preferencia — quem mexeu inclusive,
// que assim nunca fica com um valor que a preferencia recusou (o 0 que desfaz o mudo, por
// exemplo). São três lugares agora: o quadradinho, o card da grade e o palco.
function sincronizarControlesDeAudio(id) {
  const tela = tilesDeTela.get(id);
  if (tela?.slider) pintarControleDeVolume(tela.slider, tela.muteBtn, audioDaTela(id));
  const pessoa = tiles.get(id);
  if (pessoa?.volumeSlider) pintarControleDeVolume(pessoa.volumeSlider, pessoa.muteBtn, audioDaVoz(id));
  window.RoomMulti?.sincronizarAudio(id);
  if (pinned?.id === id) sincronizarVolumeDoPalco();
}

// ---------- Volume de quem está no palco ----------
// A grade ganhou volume por card, mas o destaque único — onde se passa a maior parte do
// tempo — continuava mandando a pessoa até o quadradinho lá embaixo para abaixar um som.
// O controle acompanha o que está em destaque: tela mexe no som da tela, câmera na voz.
// A própria imagem não tem o que ajustar; ela não toca neste computador.
function audioDoDestaque() {
  if (!pinned || pinned.id === 'self') return null;
  return pinned.source === 'screen' ? audioDaTela(pinned.id) : audioDaVoz(pinned.id);
}

function sincronizarVolumeDoPalco() {
  const estado = audioDoDestaque();
  stageVolume.hidden = !estado;
  if (!estado) return;
  stageSlider.dataset.alvo = pinned.source === 'screen' ? 'tela' : 'voz';
  pintarControleDeVolume(stageSlider, stageMute, estado);
}

function mexerNoAudioDoDestaque(mudanca) {
  if (!pinned || pinned.id === 'self') return;
  (pinned.source === 'screen' ? definirAudioDaTela : definirAudioDaVoz)(pinned.id, mudanca);
}
stageSlider.addEventListener('input', () => mexerNoAudioDoDestaque({ nivel: stageSlider.value / 100 }));
stageMute.addEventListener('click', () => mexerNoAudioDoDestaque({ alternarMudo: true }));

// Um controle de volume desenhado em dois lugares diferentes precisa dizer a mesma coisa
// nos dois: o mesmo numero, o mesmo estado de mudo e a mesma razao para estar apagado.
function pintarControleDeVolume(slider, muteBtn, estado) {
  const porcento = Math.round(estado.nivel * 100);
  if (document.activeElement !== slider) slider.value = String(porcento);
  slider.disabled = !estado.disponivel;
  muteBtn.disabled = !estado.disponivel;
  muteBtn.setAttribute('aria-pressed', String(estado.mudo));
  // O artigo viaja junto com o nome: um "o" fixo daria "o voz desta pessoa" na metade dos
  // casos, e este mesmo controle atende as duas fontes.
  const ehTela = slider.dataset.alvo === 'tela';
  const coisa = ehTela ? 'som desta tela' : 'voz desta pessoa';
  const comArtigo = ehTela ? 'o som desta tela' : 'a voz desta pessoa';
  slider.title = estado.disponivel ? `Volume: ${porcento}%` : `Sem ${coisa} para ajustar`;
  slider.setAttribute('aria-label', `Volume ${ehTela ? 'do' : 'da'} ${coisa}`);
  muteBtn.title = !estado.disponivel ? `Sem ${coisa}` : estado.mudo ? `Ouvir ${comArtigo}` : `Silenciar ${comArtigo}`;
  muteBtn.setAttribute('aria-label', muteBtn.title);
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
      <div class="convite-de-tela" hidden>
        <span class="convite-texto">ao vivo</span>
        <button class="assistir-btn" type="button">Assistir</button>
      </div>
      <button class="parar-de-assistir" type="button" hidden title="Parar de assistir esta tela">Parar</button>
      ${BOTAO_DE_OCULTAR()}
    </div>
    <div class="participant-name"></div>
    <div class="volume-row"></div>
  `;
  participantsEl.appendChild(el);

  const refs = {
    root: el, video: el.querySelector('.cam-video'), nome: el.querySelector('.participant-name'),
    linhaDeVolume: el.querySelector('.volume-row'), slider: null, muteBtn: null,
    convite: el.querySelector('.convite-de-tela'), assistirBtn: el.querySelector('.assistir-btn'),
    pararBtn: el.querySelector('.parar-de-assistir'),
    hideBtn: el.querySelector('.hide-self-btn'), ocultoOverlay: el.querySelector('.oculto-overlay')
  };
  tilesDeTela.set(id, refs);
  reordenarQuadradinhos();

  // A propria tela nao se assiste: ela ja esta aqui. Os controles nem chegam a existir --
  // deixa-los escondidos poria dois "Assistir" na pagina, e o de baixo nunca seria clicavel.
  if (id === 'self') {
    refs.convite.remove(); refs.pararBtn.remove();
    refs.convite = null; refs.assistirBtn = null; refs.pararBtn = null;
    refs.hideBtn.addEventListener('click', evento => { evento.stopPropagation(); alternarOcultarPropria('screen'); });
  } else {
    refs.hideBtn.remove(); refs.ocultoOverlay.remove();
    refs.hideBtn = null; refs.ocultoOverlay = null;
  }

  // Um clique no quadradinho de quem nao esta sendo assistido quer dizer "quero ver": pedir
  // a imagem e destacar sao a mesma intencao, e cobrar dois cliques por ela so irrita.
  el.querySelector('.avatar-wrap').addEventListener('click', () => {
    if (!assistindoTela(id)) { assistirTela(id, true); return; }
    pin(id, 'screen', true);
  });
  refs.assistirBtn?.addEventListener('click', evento => { evento.stopPropagation(); assistirTela(id, true); });
  refs.pararBtn?.addEventListener('click', evento => { evento.stopPropagation(); assistirTela(id, false); });

  // A propria tela nao toca neste computador (seria o som saindo e voltando), entao os
  // controles so fazem sentido para quem esta assistindo.
  if (id !== 'self') {
    refs.linhaDeVolume.innerHTML = LINHA_DE_VOLUME('tela');
    refs.slider = refs.linhaDeVolume.querySelector('.volume-slider');
    refs.muteBtn = refs.linhaDeVolume.querySelector('.mute-peer-btn');
    refs.slider.addEventListener('input', () => definirAudioDaTela(id, { nivel: refs.slider.value / 100 }));
    refs.muteBtn.addEventListener('click', () => definirAudioDaTela(id, { alternarMudo: true }));
    sincronizarControlesDeAudio(id);
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

// Pedir (ou largar) a tela de alguem. Nao e mostrar/esconder um video: o pedido vai ate o
// servidor de midia, que so entao comeca -- ou para de -- mandar os quadros. Por isso
// entrar numa sala com cinco telas no ar nao custa mais nada ate voce escolher uma.
function assistirTela(id, ligar) {
  if (id === 'self' || !peers.has(id)) return;
  transporte?.assistir(id, ligar);
  atualizarTileDeTela(id);
  if (ligar) { pin(id, 'screen', true); status.textContent = `Assistindo a tela de ${nomeDe(id)}.`; }
  else {
    // Sair de uma tela nao pode deixar o palco vazio se ha outra coisa para ver.
    if (pinned?.id === id && pinned.source === 'screen') { destaqueManual = false; despinar(); }
    status.textContent = `Você parou de assistir a tela de ${nomeDe(id)}.`;
  }
  avaliarDestaque();
  atualizarAudioDeTela();
}

function atualizarTileDeTela(id) {
  const estado = id === 'self' ? meuEstado() : (peers.get(id)?.state || {});
  if (!estado.screen) { removerTileDeTela(id); return; }

  const refs = garantirTileDeTela(id);
  // Já está grande no palco ou na grade: aqui embaixo seria a segunda cópia da mesma imagem.
  // O fluxo é desligado junto, e não só escondido -- um <video> oculto continua decodificando
  // e compondo, e poupar esse trabalho é metade do motivo de não repetir.
  const emDestaque = estaEmDestaque(id, 'screen');
  refs.root.hidden = emDestaque;
  if (emDestaque) { ligarFluxo(refs.video, null); return; }
  refs.nome.textContent = `${nomeDe(id)} — Tela`;
  const assistindo = assistindoTela(id);
  const stream = id === 'self' ? screenStream : peers.get(id)?.remoteStreams.screen;
  ligarFluxo(refs.video, assistindo ? stream : null);
  if (assistindo) garantirReproducao(refs.video);
  // Quem nao esta assistindo ve que a tela existe -- e so isso. A imagem nem desce do
  // servidor de midia, entao nao ha video para esconder: ha um convite no lugar dele.
  if (refs.convite) refs.convite.hidden = assistindo;
  if (refs.pararBtn) refs.pararBtn.hidden = !assistindo;
  refs.video.classList.toggle('active', assistindo);
  refs.root.classList.toggle('nao-assistida', !assistindo);
  refs.root.classList.toggle('pinned', pinned?.id === id && pinned.source === 'screen');
  pintarBotaoDeOcultar(refs, 'screen', ocultarPropriaTela, true);

  // Da para compartilhar a tela sem som nenhum. Nesse caso os controles ficam apagados, em
  // vez de sumirem: some a duvida de "abaixei o volume e nao mudou nada".
  if (refs.slider) sincronizarControlesDeAudio(id);
}

function atualizarTile(id) {
  const refs = tiles.get(id);
  if (!refs) return;
  const estado = id === 'self' ? meuEstado() : (peers.get(id)?.state || {});
  // "Tem câmera ligada" e "a imagem está chegando" deixaram de ser a mesma coisa: numa sala
  // cheia, a câmera de quem não está falando nem em destaque não desce. Perguntar ao estado
  // anunciado deixaria um retângulo preto no lugar do avatar -- o pior dos dois mundos.
  const temCamera = id === 'self'
    ? Boolean(cameraStream)
    : Boolean(estado.camera && peers.get(id)?.remoteStreams.camera?.getTracks().length);

  // A câmera desta pessoa já está grande no palco ou na grade: o quadradinho seria a segunda
  // cópia. Sem câmera em destaque ele permanece -- é ele que diz que a pessoa está na sala, e
  // presença não é redundância. Quem está sem câmera nunca some daqui.
  const cameraEmDestaque = temCamera && estaEmDestaque(id, 'camera');
  refs.root.hidden = cameraEmDestaque;
  if (cameraEmDestaque) {
    ligarFluxo(refs.camVideo, null);
    atualizarTileDeTela(id);
    return;
  }

  // Religar ao voltar do destaque: o fluxo foi desligado quando a câmera subiu, e sem isto o
  // quadradinho voltaria preto para todo mundo menos para quem está olhando a própria imagem.
  if (id === 'self') { if (cameraStream) ligarFluxo(refs.camVideo, cameraStream); }
  else {
    const peer = peers.get(id);
    if (peer && ligarFluxo(refs.camVideo, peer.remoteStreams.camera)) garantirReproducao(refs.camVideo);
  }

  refs.camVideo.classList.toggle('active', temCamera);
  refs.avatar.classList.toggle('hidden', temCamera);
  // O selo "Tela" some do quadradinho da pessoa: agora a tela tem o proprio quadradinho.
  refs.screenBadge.classList.add('hidden');
  refs.micIcon.classList.toggle('muted', Boolean(estado.micMuted));
  const simbolosDePresenca = { hand: '✋', brb: '☕', gaming: '🎮', quiet: '🔇' };
  const nomesDePresenca = { hand: 'Quer falar', brb: 'Volto já', gaming: 'Em jogo', quiet: 'Sem falar' };
  if (refs.presenceBadge) {
    refs.presenceBadge.textContent = simbolosDePresenca[estado.presenca] || '';
    refs.presenceBadge.classList.toggle('hidden', !simbolosDePresenca[estado.presenca]);
    refs.presenceBadge.title = nomesDePresenca[estado.presenca] || '';
    refs.presenceBadge.setAttribute('aria-label', nomesDePresenca[estado.presenca] || 'Sem status');
  }
  // Quem está com a conexão perdida aparecia assim só na lista lateral -- que em modo
  // teatro nem existe. O quadradinho é onde se olha, então é nele que a queda precisa
  // aparecer: a pessoa ainda está na sala, apagada, esperando a volta.
  refs.root.classList.toggle('sem-conexao', Boolean(peers.get(id)?.semConexao));
  // Sem camera nao ha o que ocultar: o botao nem aparece. Ele so existia o tempo todo
  // porque nunca foi perguntado se havia imagem por baixo dele.
  if (id === 'self') pintarBotaoDeOcultar(refs, 'camera', ocultarPropriaCamera, temCamera);
  else sincronizarControlesDeAudio(id);
  atualizarTileDeTela(id);
}

function atualizarContador() {
  const total = peers.size + 1;
  participantCount.textContent = total === 1 ? 'Só você na sala' : `${total} pessoas na sala`;
  document.dispatchEvent(new Event('room-update'));
}

// ---------- Ocultar a propria imagem so para mim ----------
// So um overlay local: a faixa continua saindo normal para o resto da sala. Serve para
// quem nao quer ver a propria cara/tela no quadradinho (ou no palco, quando esta sozinho
// na sala e a propria imagem acaba indo ao centro).
let ocultarPropriaCamera = false;
let ocultarPropriaTela = false;

// No palco o aviso ocupava a tela inteira sem oferecer a volta: para desfazer era preciso
// achar o quadradinho certo la embaixo e o botao dentro dele.
document.getElementById('stageMostrarBtn').onclick = () => {
  if (pinned?.id === 'self') alternarOcultarPropria(pinned.source);
};

function alternarOcultarPropria(fonte) {
  if (fonte === 'camera') ocultarPropriaCamera = !ocultarPropriaCamera;
  else ocultarPropriaTela = !ocultarPropriaTela;
  atualizarTile('self');
  atualizarTileDeTela('self');
  if (pinned?.id === 'self' && pinned.source === fonte) atualizarPalco();
  // Tres lugares mostram a propria imagem (quadradinho, palco e a grade); qualquer um deles
  // pode ter disparado esta troca, entao os outros dois tambem precisam saber.
  window.RoomMulti?.render();
}

// ---------- Palco (spotlight) ----------
// Destaque automatico, para ninguem precisar clicar em nada:
//  - tela tem prioridade sobre camera;
//  - entre fontes do mesmo tipo, ganha quem comecou primeiro;
//  - a propria imagem so vai ao centro se nao houver mais ninguem compartilhando (ver a
//    propria tela no palco gera o efeito de espelho infinito);
//  - uma escolha manual manda mais que tudo, ate aquela fonte acabar.
let sequenciaDeCompartilhamento = 0;
let destaqueManual = false;

// ---------- O que o palco diz quando nao ha nada nele ----------
// Este espaco e o maior da tela e ficava gasto com a mesma frase de sempre, que nao mudava
// nada e nao levava a lugar nenhum. Ele sabe exatamente o que esta faltando -- alguem para
// conversar, alguem que transmita, ou so um clique em "Assistir" -- entao e isso que ele
// diz, com o botao que resolve ao lado.
const stageEmptyTitle = document.getElementById('stageEmptyTitle');
const stageEmptyText = document.getElementById('stageEmptyText');
const stageEmptyActions = document.getElementById('stageEmptyActions');

function porPalcoVazio(titulo, texto, acoes = []) {
  stage.classList.toggle('so-mensagem', !acoes.length);
  stageEmptyTitle.textContent = titulo;
  stageEmptyText.textContent = texto || '';
  stageEmptyText.hidden = !texto;
  stageEmptyActions.replaceChildren(...acoes.map(([rotulo, aoClicar, secundario]) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = rotulo;
    if (secundario) botao.className = 'secondary';
    botao.onclick = aoClicar;
    return botao;
  }));
  stageEmptyActions.hidden = !acoes.length;
}

// Mensagem de passagem ("estou esperando a imagem"): sem ilustracao e sem botao, para nao
// parecer que a transmissao acabou quando ela so esta chegando.
const mensagemDePalco = texto => porPalcoVazio(texto, '');

function convidarParaOPalco() {
  const transmitindo = [...peers.values()].filter(par => par.state?.screen && !par.assistindo);
  // Alguem ESTA transmitindo e o palco vazio pareceria defeito: como a tela so desce a
  // pedido, o vazio precisa dizer que ha algo para pedir -- e deixar pedir daqui mesmo.
  if (transmitindo.length === 1) {
    porPalcoVazio(`${transmitindo[0].name} está compartilhando a tela`,
      'A imagem só começa a descer quando você pede.',
      [['Assistir agora', () => assistirTela(transmitindo[0].id, true)]]);
    return;
  }
  if (transmitindo.length) {
    porPalcoVazio(`${transmitindo.length} telas ao vivo na sala`,
      'Escolha de quem você quer ver, nos quadradinhos abaixo.');
    return;
  }
  if (!peers.size) {
    porPalcoVazio('Você é o primeiro por aqui',
      'Chame o squad — ou já deixe a tela pronta para quando eles chegarem.',
      [['Convidar amigos', () => copyLinkBtn.click()], ['Compartilhar tela', () => screenBtn.click(), true]]);
    return;
  }
  porPalcoVazio('Ninguém está transmitindo ainda',
    'Compartilhe sua tela ou abra a câmera para colocar algo no palco.',
    [['Compartilhar tela', () => screenBtn.click()], ['Ligar câmera', () => cameraBtn.click(), true]]);
}

// Fonte anunciada pelo estado, mesmo que o video ainda nao tenha chegado: e o que permite
// destacar na hora e esperar a imagem, em vez de largar o palco vazio.
// Como no Discord: a tela de alguem so entra no palco depois que voce pede para assistir.
// A propria tela e sempre "assistida" -- ela ja esta aqui, nao ha nada para baixar.
function assistindoTela(id) {
  return id === 'self' || Boolean(peers.get(id)?.assistindo);
}

// ---------- Uma fonte, um lugar ----------
//
// A mesma tela aparecia duas vezes: grande no palco e pequena no quadradinho logo abaixo.
// Três, com a grade aberta. Não custava banda -- é uma faixa só, descendo uma vez, pintada em
// dois lugares --, mas custava duas outras coisas. Atenção, porque o olho não sabe qual das
// cópias olhar e a plateia fica ocupada por uma miniatura do que já está em foco. E trabalho
// do aparelho de quem assiste: cada <video> a mais compõe de novo, a cada quadro, e é no
// celular que isso aparece primeiro.
//
// Agora vale uma hierarquia de tamanho: a fonte aparece no MAIOR lugar em que couber. Palco
// ganha da grade, grade ganha da plateia. Quem não está em nenhum dos dois continua na
// plateia -- que é onde a presença mora, e por isso quem está sem câmera nunca some de lá.
function estaEmDestaque(id, source) {
  if (pinned?.id === id && pinned.source === source) return true;
  return Boolean(window.RoomMulti?.active && window.RoomMulti.mostra(id, source));
}

// Palco ou grade mudaram: quem entrou em destaque sai da plateia, quem saiu volta para ela.
function reavaliarPlateia() {
  atualizarTile('self');
  peers.forEach((_par, id) => atualizarTile(id));
}

function fonteAnunciada(id, source) {
  if (id === 'self') {
    const stream = source === 'screen' ? screenStream : cameraStream;
    return Boolean(stream && stream.getVideoTracks().length);
  }
  const peer = peers.get(id);
  if (!peer) return false;
  return Boolean(source === 'screen' ? peer.state?.screen && peer.assistindo : peer.state?.camera);
}

function candidatosDeDestaque() {
  const lista = [];
  peers.forEach((peer, id) => {
    if (peer.state?.screen && peer.assistindo) lista.push({ id, source: 'screen', prioridade: 0, ordem: peer.ordem.screen });
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

// Som de tela: toca o de toda tela que voce PEDIU para assistir e nao silenciou.
//
// Antes so tocava a tela em destaque (mais a unica da sala, como remendo). Isso batia de
// frente com a grade, onde cinco telas aparecem ao mesmo tempo e so uma tinha som -- e
// com o proprio controle de volume, que ficava ali mexendo em nada nas outras quatro. Um
// slider que nao faz barulho e um slider quebrado.
//
// O risco do contrario, varias telas falando juntas, e menor do que parece: nenhuma imagem
// desce sem alguem clicar em "Assistir", entao ouvir tres telas e uma escolha de tres
// cliques -- e agora cada uma tem volume e mudo proprios para equilibrar.
function atualizarAudioDeTela() {
  tiles.forEach((refs, id) => {
    if (!refs.screenAudio) return;
    const peer = peers.get(id);
    if (!peer) return;
    const stream = peer.remoteStreams.screenAudio;
    if (refs.screenAudio.srcObject !== stream) refs.screenAudio.srcObject = stream;
    const deveTocar = Boolean(peer.state.screen && peer.state.screenAudio && peer.assistindo);
    // O mudo do participante vale para a VOZ dele; o som da tela tem o proprio controle, no
    // quadradinho da tela. Antes os dois andavam juntos e nao dava para calar so a tela.
    const pref = preferenciaDeTela(id);
    refs.screenAudio.volume = pref.nivel;
    refs.screenAudio.muted = pref.mudo || !deveTocar || ensurdecido;
    if (deveTocar && !pref.mudo && !ensurdecido) garantirReproducao(refs.screenAudio);
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
  // Sai do palco, mas a grade pode continuar aberta: mandar as chaves dela junto evita que
  // despinar rebaixe para a camada do quadradinho o que ainda está grande num card.
  transporte?.definirExibicao(null, null, window.RoomMulti?.chaves);
  reavaliarPlateia();
  stageVideo.srcObject = null;
  stageOcultoOverlay.classList.add('hidden');
  convidarParaOPalco();
  stage.classList.remove('is-waiting');
  document.getElementById('playbackRecovery').hidden = true;
  clearTimeout(esperaDoVideo);
  stageEmpty.classList.remove('hidden');
  stageLabel.classList.add('hidden');
  stageControls.classList.add('hidden');
  sincronizarVolumeDoPalco();
  if (!window.RoomMulti?.active || !candidatosDeDestaque().length) definirModoTeatro(false);
  definirZoom(1);
  if (document.fullscreenElement === stage) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  document.querySelectorAll('.participant').forEach(el => el.classList.remove('pinned'));
  atualizarAudioDeTela();
  window.RoomMulti?.render();
}

function atualizarPalco() {
  window.RoomMulti?.render();
  // Quem está no palco recebe a imagem inteira; quem está no quadradinho, a do meio.
  // Avisar aqui é o que faz a câmera de quem sai do palco parar de custar caro.
  transporte?.definirExibicao(pinned?.id, pinned?.source, window.RoomMulti?.chaves);
  // Quem subiu para o palco sai da plateia; quem desceu volta para ela. Precisa vir depois do
  // render acima, que é quem sabe o que a grade assumiu nesta passada.
  reavaliarPlateia();
  // O botão de parar morava no quadradinho da tela -- que agora some quando ela está em
  // destaque. Sem um substituto aqui, quem abrisse uma tela ficaria sem como fechá-la, e o
  // custo dela seguiria sendo pago até a pessoa sair da sala.
  stageStopBtn.hidden = !(pinned && pinned.id !== 'self' && pinned.source === 'screen' && assistindoTela(pinned.id));
  if (!pinned) return;
  const { id, source } = pinned;
  const nome = id === 'self' ? myName : (peers.get(id)?.name || 'Participante');
  const stream = id === 'self'
    ? (source === 'screen' ? screenStream : cameraStream)
    : (peers.get(id)?.remoteStreams[source] || null);

  stageOcultoOverlay.classList.toggle('hidden',
    !(id === 'self' && (source === 'screen' ? ocultarPropriaTela : ocultarPropriaCamera)));

  stageLabel.classList.remove('hidden');
  stageLabel.textContent = `${nome} — ${source === 'screen' ? 'Tela' : 'Câmera'}`;
  sincronizarVolumeDoPalco();

  if (!stream || !stream.getVideoTracks().length) {
    // O estado ja anunciou a fonte, mas a faixa de video ainda nao chegou. Antes o palco
    // se desfazia sozinho aqui e so voltava com F5; agora ele espera.
    stageVideo.srcObject = null;
    mensagemDePalco('Conectando à transmissão…');
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
  // A mesa de sons não toca por um <audio> da página: ela tem um contexto de áudio
  // próprio, e o Safari só o libera dentro de um gesto. Sem esta linha, quem entrasse no
  // iPhone e nunca abrisse a janela de sons ouviria a sala inteira, menos a mesa.
  window.NexoSoundboard?.destravar();
}
enableSoundBtn.onclick = retomarMidias;

let esperaDoVideo = null;
function aguardarVideo() {
  if (esperaDoVideo) return;
  esperaDoVideo = setTimeout(() => {
    esperaDoVideo = null;
    if (!pinned || (!stageVideo.paused && stageVideo.readyState >= 2 && stageVideo.videoWidth)) return;
    mensagemDePalco('A imagem ainda não chegou.');
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
    mensagemDePalco(midiasBloqueadas.has(stageVideo) ? 'Toque em Ativar reprodução para assistir.' : 'Recebendo vídeo…');
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  retomarMidias();
  // Voltar do segundo plano é onde as duas proteções se restabelecem: o wake lock é
  // liberado sozinho quando a aba fica oculta, e o áudio de fundo pode ter sido barrado
  // pela política de autoplay na primeira tentativa.
  atualizarModoSegundoPlano();
});
window.addEventListener('pageshow', retomarMidias);

window.addEventListener('pagehide', event => {
  // "persisted" quer dizer que a pagina foi para o bfcache (pausa reversivel, volta com
  // "pageshow"/persisted) em vez de ser descartada de vez -- trocar de app entra nessa
  // categoria em alguns navegadores. So um pagehide sem persisted significa que a aba
  // esta mesmo sendo fechada, e so ai faz sentido desligar microfone, camera e conexao.
  if (event.persisted) return;
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
const chatFocusBtn = document.getElementById('chatFocusBtn');
const musicaFocusBtn = document.getElementById('musicaFocusBtn');

// ---------- Qualidade, economia e vídeo compacto ----------
// ---------- Latência da sinalização ----------
//
// A latência da sala sempre veio das estatísticas de uma FAIXA de mídia -- e quem entra só
// para ouvir não publica nem recebe faixa nenhuma. Ficava sem um único número sobre a própria
// conexão justamente no momento em que ele decide se vale ligar a câmera.
//
// Esta medida não substitui a da mídia: ela percorre o mesmo caminho até o servidor, mas por
// WebSocket, onde uma retransmissão de TCP aparece como um pico que o fluxo de mídia, em UDP,
// não teria. Por isso as duas convivem, cada uma dizendo de onde veio: quando há mídia, vale
// a dela; antes disso, esta é a que existe.
let latenciaDaSinalizacao = null;
let medindoLatencia = false;
function medirLatenciaDaSinalizacao() {
  if (medindoLatencia || document.hidden || !socket?.connected) return;
  medindoLatencia = true;
  const inicio = performance.now();
  // Um relógio à parte porque a confirmação pode simplesmente não voltar: numa rede que caiu
  // sem o socket perceber, guardar o último número medido afirmaria uma conexão boa que não
  // existe mais. Sem resposta, a sala volta a dizer que não sabe.
  const desistir = setTimeout(() => { medindoLatencia = false; latenciaDaSinalizacao = null; }, 4000);
  socket.emit('eco', () => {
    clearTimeout(desistir);
    medindoLatencia = false;
    latenciaDaSinalizacao = Math.round(performance.now() - inicio);
  });
}
setInterval(medirLatenciaDaSinalizacao, 5000);
// A volta do segundo plano e a reconexão medem na hora: o número de antes descreve uma rede
// que pode não ser mais a mesma -- o celular que trocou de Wi-Fi para 4G é o caso comum.
document.addEventListener('visibilitychange', () => { if (!document.hidden) medirLatenciaDaSinalizacao(); });

const connectionQualityBtn = document.getElementById('connectionQualityBtn');
function atualizarIndicadorDeConexao() {
  const bruto = String(transporte?.qualidade || (socket?.connected ? 'good' : 'unknown')).toLowerCase();
  const qualidade = ['excellent', 'good', 'poor', 'lost'].find(q => bruto.includes(q)) || 'unknown';
  const rotulos = { excellent: 'Excelente', good: 'Boa', poor: 'Instável', lost: 'Sem mídia', unknown: 'Conexão' };
  connectionQualityBtn.dataset.quality = qualidade;
  connectionQualityBtn.querySelector('span').textContent = rotulos[qualidade];
  // O número fica fora do rótulo, num elemento próprio: a barra de cima já estava apertada, e
  // assim a largura dele varia sem empurrar o nome da sala a cada medição.
  //
  // Aqui é SEMPRE a da sinalização, mesmo quando há mídia no ar. Alternar entre as duas
  // fontes faria o número pular ao ligar a câmera sem que nada na rede tivesse mudado -- e o
  // diagnóstico, que mostra as duas lado a lado, é onde a diferença entre elas tem contexto.
  const ms = latenciaDaSinalizacao;
  const medida = connectionQualityBtn.querySelector('b');
  medida.textContent = ms == null ? '' : `${ms} ms`;
  medida.hidden = ms == null;
  const detalhe = ms == null ? 'latência ainda não medida' : `${ms} ms até o servidor`;
  connectionQualityBtn.title = qualidade === 'poor'
    ? `Conexão instável (${detalhe}) — ative Economia de dados ou abra o diagnóstico`
    : `${rotulos[qualidade]} · ${detalhe} — abrir diagnóstico`;
  connectionQualityBtn.setAttribute('aria-label', connectionQualityBtn.title);
}
// `abrirDiagnostico` vive dentro do módulo de room-ui.js e nunca foi global: chamá-la daqui
// lançava ReferenceError e o botão não abria nada. O caminho público é o evento que o vigia
// de conexão travada já usa.
connectionQualityBtn.onclick = () => document.dispatchEvent(new CustomEvent('room-diagnostics-request'));
// Parado em segundo plano o indicador não tem quem o leia, e acordar a cada 1,5 s só serve
// para o navegador cobrar bateria por isso.
setInterval(() => { if (!document.hidden) atualizarIndicadorDeConexao(); }, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarIndicadorDeConexao(); });

const dataSaver = document.getElementById('dataSaver');
const dataSaverField = document.getElementById('dataSaverField');
dataSaverField.hidden = !ehCelular;
try { dataSaver.checked = ehCelular && localStorage.getItem('sala.economiaDados') === '1'; } catch (_) {}
function aplicarEconomiaDeDados() {
  const ativa = ehCelular && dataSaver.checked;
  economiaDeDadosAtiva = ativa;
  document.querySelector('.app').classList.toggle('economia-dados', ativa);
  transporte?.definirEconomia?.(ativa);
  // O modo econômico é um teto adicional, não uma escolha forçada no formulário. Assim a
  // pessoa continua podendo preparar 1080p/60 para quando desligá-lo, sem o primeiro clique
  // reescrever ou travar os selects.
  ajustarEnvioPelaQualidade(transporte?.qualidade || 'excellent');
  try { localStorage.setItem('sala.economiaDados', ativa ? '1' : '0'); } catch (_) {}
  atualizarIndicadorDeConexao();
}
dataSaver.addEventListener('change', aplicarEconomiaDeDados);
aplicarEconomiaDeDados();

const compactBtn = document.getElementById('compactBtn');
compactBtn.onclick = async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture().catch(() => {}); return; }
  if (stageVideo.srcObject && document.pictureInPictureEnabled && stageVideo.requestPictureInPicture) {
    try { await stageVideo.requestPictureInPicture(); return; } catch (_) { /* usa o compacto da pagina */ }
  }
  const ativo = document.querySelector('.app').classList.toggle('compacto-local');
  compactBtn.setAttribute('aria-pressed', String(ativo));
  compactBtn.title = ativo ? 'Sair do modo compacto' : 'Abrir vídeo compacto';
};
stageVideo.addEventListener('enterpictureinpicture', () => { compactBtn.setAttribute('aria-pressed', 'true'); compactBtn.title = 'Fechar vídeo compacto'; });
stageVideo.addEventListener('leavepictureinpicture', () => {
  compactBtn.setAttribute('aria-pressed', 'false');
  compactBtn.title = 'Abrir vídeo compacto';
  // Chromium pausa o elemento por um instante quando o X da janela nativa é usado. O
  // evento de `pause` pinta o palco como "Recebendo vídeo"; retomar na próxima pintura
  // evita que esse estado transitório vire a tela permanente mostrada no relato.
  requestAnimationFrame(() => {
    if (!stageVideo.srcObject?.getVideoTracks().some(faixa => faixa.readyState === 'live')) return;
    garantirReproducao(stageVideo).finally(atualizarEstadoDoVideo);
  });
});

const LARGURA_MAXIMA_DA_IMAGEM = 1280;
const BYTES_MAXIMOS_DA_IMAGEM = 700 * 1024;
let naoLidas = 0;

// Focar texto nao e o mesmo que abrir o painel. `aberto` continua registrando apenas a
// gaveta responsiva; por isso uma pessoa pode entrar no foco em 1440px, diminuir para um
// celular e aumentar de novo sem o resize reescrever a escolha. Ao sair, volta exatamente
// ao comportamento automatico que existia antes.
function definirFocoChat(ativo) {
  const app = document.querySelector('.app');
  if (ativo) {
    definirModoTeatro(false);
    app.classList.remove('sem-chat');
  }
  app.classList.toggle('foco-chat', ativo);
  for (const [botao, canal] of [[chatFocusBtn, 'chat'], [musicaFocusBtn, 'canal de música']]) {
    botao.setAttribute('aria-pressed', String(ativo));
    botao.setAttribute('aria-label', ativo ? 'Mostrar palco e plateia' : `Focar somente no ${canal}`);
    botao.title = ativo ? 'Mostrar palco e plateia' : 'Ocultar palco e plateia';
    botao.textContent = ativo ? 'Mostrar palco' : 'Focar';
  }
  requestAnimationFrame(() => {
    limitarPan();
    aplicarTransformDoPalco();
    const mensagens = app.classList.contains('painel-musica') ? document.getElementById('musicaMsgs') : chatMsgs;
    if (ativo && mensagens) mensagens.scrollTop = mensagens.scrollHeight;
  });
}
chatFocusBtn.onclick = () => definirFocoChat(!document.querySelector('.app').classList.contains('foco-chat'));
musicaFocusBtn.onclick = chatFocusBtn.onclick;

function chatVisivel() {
  const app = document.querySelector('.app');
  if (app.classList.contains('teatro')) return false;
  if (app.classList.contains('sem-chat')) return false;
  // A coluna e uma so, e o canal de musica pode estar ocupando ela. Sem esta linha, uma
  // mensagem que chegasse com a musica aberta seria contada como lida -- o contador nao
  // apareceria, e ela passaria despercebida.
  if (app.classList.contains('painel-musica')) return false;
  if (app.classList.contains('foco-chat')) return true;
  return window.matchMedia('(min-width: 1101px)').matches || chatPanel.classList.contains('aberto');
}
function abrirChat() {
  definirModoTeatro(false);
  chatPanel.classList.add('aberto');
  document.querySelector('.app').classList.remove('sem-chat');
  naoLidas = 0;
  chatBadge.classList.add('hidden');
  divisorDeNaoLidas = false;
  chatInput.focus();
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}
// "aberto" vale na tela estreita, onde o chat e uma camada; "sem-chat" vale na tela larga,
// onde ele e uma coluna. O X mexe nos dois, entao fechar funciona nas duas larguras.
function fecharChat() {
  definirFocoChat(false);
  chatPanel.classList.remove('aberto');
  document.querySelector('.app').classList.add('sem-chat');
  chatMsgs.querySelectorAll('.unread-divider').forEach(el => el.remove());
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
const mensagensDoChat = new Map();
let contextoDoChat = null; // { tipo:'resposta'|'edicao', mensagem }
let divisorDeNaoLidas = false;
let carregandoHistorico = false;
chatMsgs.addEventListener('scroll', () => {
  perto = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight < 80;
});

function mostrarMensagem(msg) {
  const vazio = chatMsgs.querySelector('.chat-vazio');
  if (vazio) vazio.remove();
  perto = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight < 80;

  msg.id ||= `legado-${msg.em || Date.now()}-${Math.random().toString(36).slice(2)}`;
  mensagensDoChat.set(msg.id, msg);
  if (!carregandoHistorico && !msg._atualizandoLocal && !chatVisivel() && msg.autorId !== myId && !divisorDeNaoLidas) {
    chatMsgs.querySelectorAll('.unread-divider').forEach(divisor => divisor.remove());
    const divisor = document.createElement('div');
    divisor.className = 'unread-divider';
    divisor.textContent = 'Novas mensagens';
    chatMsgs.appendChild(divisor);
    divisorDeNaoLidas = true;
  }
  const el = document.createElement('div');
  el.className = 'msg';
  el.dataset.messageId = msg.id;
  if (msg.editada) el.classList.add('editada');
  const mencionou = Boolean(myName && msg.texto && new RegExp(`(^|\\s)@${myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(msg.texto));
  el.classList.toggle('mencionou', mencionou);
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

  // A citação entra DEPOIS da linha do nome. Antes dela, virava a primeira linha da grade e
  // puxava o avatar para cima junto -- ele deixava de ficar ao lado de quem falou e passava a
  // ficar ao lado da citação, desalinhado de todas as outras mensagens.
  let resposta = null;
  if (msg.resposta) {
    resposta = document.createElement('button');
    resposta.className = 'msg-reply';
    resposta.type = 'button';
    resposta.title = 'Ir para a mensagem respondida';
    resposta.append(elemento('span', 'msg-reply-autor', msg.resposta.autor), document.createTextNode(msg.resposta.texto || 'Mensagem'));
    resposta.onclick = () => focarMensagem(msg.resposta.id);
  }

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

  // Três botões, e não os nove de antes. Nove ocupavam os 292px da coluna inteira e a barra
  // flutuante passava por cima do nome, da hora e da citação -- a mensagem sumia justamente
  // quando o ponteiro ia até ela. Reagir e as ações de dono abrem um menu ancorado.
  const acoes = document.createElement('div');
  acoes.className = 'msg-actions';
  const botaoAcao = (desenho, titulo, acao) => {
    const b = document.createElement('button'); b.type = 'button';
    b.append(icone(desenho));
    b.title = titulo; b.setAttribute('aria-label', titulo); b.dataset.chatAction = acao; return b;
  };
  acoes.append(botaoAcao(ICONE_REAGIR, 'Reagir', 'abrir-reacoes'), botaoAcao(ICONE_RESPONDER, 'Responder', 'responder'));
  if (msg.autorId === myId || podeModerar) acoes.append(botaoAcao(ICONE_MAIS, 'Mais ações', 'abrir-mais'));

  el.append(avatar, topo);
  if (resposta) el.append(resposta);
  el.append(corpo, acoes);
  const reacoes = document.createElement('div');
  reacoes.className = 'msg-reactions';
  for (const [emoji, pessoas] of Object.entries(msg.reacoes || {})) {
    if (!pessoas?.length) continue;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = `${emoji} ${pessoas.length}`;
    b.dataset.chatAction = 'reagir'; b.dataset.emoji = emoji;
    b.classList.toggle('minha', pessoas.includes(myId));
    reacoes.append(b);
  }
  if (reacoes.childElementCount) el.append(reacoes);
  chatMsgs.appendChild(el);
  if (perto) chatMsgs.scrollTop = chatMsgs.scrollHeight;

  if (!carregandoHistorico && !msg._atualizandoLocal && !chatVisivel() && msg.autorId !== myId) {
    naoLidas++;
    chatBadge.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
    chatBadge.classList.remove('hidden');
  }
  if (!carregandoHistorico && !msg._atualizandoLocal && mencionou && msg.autorId !== myId && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`${msg.autor || 'Alguém'} mencionou você no Nexo`, { body: String(msg.texto || '').slice(0, 160), tag: `nexo-${roomCode}` });
  }
  atualizarFixadas();
}

function focarMensagem(id) {
  const alvo = chatMsgs.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!alvo) return;
  alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  alvo.animate([{ backgroundColor: '#a092ff35' }, { backgroundColor: 'transparent' }], { duration: 1200 });
}
function atualizarMensagemDoChat(msg) {
  if (!msg?.id) return;
  mensagensDoChat.set(msg.id, msg);
  // O menu aberto está ancorado num botão que esta troca vai destruir. Fechá-lo antes evita
  // que ele fique boiando ao lado de uma mensagem que já não existe.
  if (mensagemDoMenu?.id === msg.id) fecharMenuDaMensagem();
  const antigo = chatMsgs.querySelector(`[data-message-id="${CSS.escape(msg.id)}"]`);
  if (!antigo) { mostrarMensagem(msg); return; }
  const proximo = antigo.nextSibling;
  // Uma reação numa mensagem antiga não é mensagem nova: ela não pode arrastar quem está
  // lendo o histórico para o fim da conversa. `mostrarMensagem` rola ao acrescentar, então a
  // posição é devolvida ao fim da troca.
  const rolagem = chatMsgs.scrollTop;
  antigo.remove();
  msg._atualizandoLocal = true;
  mostrarMensagem(msg);
  delete msg._atualizandoLocal;
  const novo = chatMsgs.lastElementChild;
  if (proximo) chatMsgs.insertBefore(novo, proximo);
  if (!perto) chatMsgs.scrollTop = rolagem;
  atualizarFixadas();
}
function removerMensagemDoChat(id) {
  mensagensDoChat.delete(id);
  if (mensagemDoMenu?.id === id) fecharMenuDaMensagem();
  chatMsgs.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.remove();
  if (contextoDoChat?.mensagem.id === id) limparContextoDoChat();
  atualizarFixadas();
  if (!mensagensDoChat.size) mostrarVazio();
}
function atualizarFixadas() {
  const fixadas = [...mensagensDoChat.values()].filter(m => m.fixada);
  const contador = document.getElementById('chatPinsCount');
  contador.hidden = !fixadas.length; contador.textContent = String(fixadas.length);
  const barra = document.getElementById('chatPinnedBar');
  barra.hidden = !fixadas.length;
  if (fixadas.length) {
    const ultima = fixadas.at(-1);
    // O alfinete é desenhado, e não um emoji: a sala inteira usa traço monocromático nos
    // ícones, e um 📌 colorido no meio de uma barra discreta puxa o olho para o lugar errado.
    barra.replaceChildren(icone(ICONE_ALFINETE, 13), elemento('strong', '', ultima.autor), elemento('span', '', ultima.texto || 'Imagem'));
    barra.setAttribute('aria-label', fixadas.length > 1
      ? `${fixadas.length} mensagens fixadas. Ver a lista.`
      : `Mensagem fixada de ${ultima.autor}. Ir até ela.`);
    barra.onclick = () => (fixadas.length > 1 ? abrirListaDeFixadas(barra) : focarMensagem(ultima.id));
    // A barra é um `div` com papel de botão, e um `div` não responde a Enter sozinho: sem
    // isto, quem navega pelo teclado chegava até ela e não conseguia acioná-la.
    barra.onkeydown = evento => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      barra.onclick();
    };
  }
  // A lista aberta descreve o que havia um instante atrás. Fixar ou desafixar com ela na tela
  // precisa redesenhá-la, senão o clique seguinte leva a uma mensagem que já saiu de lá.
  if (!chatPinsList.classList.contains('hidden')) {
    if (fixadas.length > 1) desenharListaDeFixadas(fixadas);
    else fecharListaDeFixadas();
  }
}

function definirContextoDoChat(tipo, mensagem) {
  contextoDoChat = { tipo, mensagem };
  document.getElementById('chatContext').hidden = false;
  const titulo = document.getElementById('chatContextTitle');
  // O nome de quem está sendo respondido sai destacado do rótulo: é o dado que interessa na
  // hora de conferir, de relance, se a resposta vai para a pessoa certa.
  if (tipo === 'edicao') titulo.textContent = 'Editando sua mensagem';
  else titulo.replaceChildren(document.createTextNode('Respondendo a '), elemento('b', '', mensagem.autor));
  document.getElementById('chatContextText').textContent = mensagem.texto || 'Imagem';
  if (tipo === 'edicao') {
    chatInput.value = mensagem.texto || '';
    // Atribuir `value` não dispara `input`, e é o `input` que mede a altura do campo: sem
    // isto, editar uma mensagem de três linhas deixava o compositor com uma.
    chatInput.dispatchEvent(new Event('input'));
  }
  chatInput.focus();
  // O cursor vai para o FIM do texto, que é onde se continua escrevendo -- e não para o
  // começo, onde a primeira tecla parece sobrescrever o que já estava lá.
  const fim = chatInput.value.length;
  try { chatInput.setSelectionRange(fim, fim); } catch (_) { /* campo ainda não mediu */ }
  // O foco é reforçado no quadro seguinte porque os painéis da sala devolvem o foco por um
  // MutationObserver -- que é assíncrono, e chegava DEPOIS deste `focus()` para roubá-lo.
  requestAnimationFrame(() => { if (document.activeElement !== chatInput && contextoDoChat) chatInput.focus(); });
}
function limparContextoDoChat() {
  contextoDoChat = null;
  document.getElementById('chatContext').hidden = true;
}
document.getElementById('chatContextClose').onclick = limparContextoDoChat;

function mostrarVazio() {
  chatMsgs.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'chat-vazio';
  const heading = document.createElement('strong');
  heading.textContent = 'A resenha começa aqui.';
  p.append(heading, document.createTextNode('Mande um oi, um link ou a captura da última partida.'));
  chatMsgs.appendChild(p);
}
mostrarVazio();

function enviarMensagem(texto, imagem) {
  if (!socket?.connected) { status.textContent = 'Aguarde a reconexão para enviar sua mensagem.'; return false; }
  if (!texto && !imagem) return false;
  if (contextoDoChat?.tipo === 'edicao') {
    socket.emit('chat-acao', { acao: 'editar', id: contextoDoChat.mensagem.id, texto: texto || '' }, resposta => {
      if (!resposta?.ok) status.textContent = resposta?.error || 'Não foi possível editar a mensagem.';
    });
    limparContextoDoChat();
  } else {
    socket.emit('chat-message', { texto: texto || '', imagem: imagem || null, respostaA: contextoDoChat?.tipo === 'resposta' ? contextoDoChat.mensagem.id : null });
    limparContextoDoChat();
  }
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
// ---------- Menu de uma mensagem ----------
//
// Um menu só, movido até a mensagem em que se clicou, em vez de um por mensagem: cem
// mensagens no histórico não podem virar cem paletas de emoji escondidas no DOM.
const REACOES_DO_CHAT = ['👍', '❤️', '😂', '👏', '🎉'];
const chatMsgMenu = document.getElementById('chatMsgMenu');
let mensagemDoMenu = null;
// O botão que abriu o menu, guardado para acompanhá-lo enquanto a conversa rola.
let ancoraDoMenu = null;
// Alinhado pela borda DIREITA do que o abriu, e preso dentro da janela: o chat é uma coluna
// estreita encostada na quina, e um menu alinhado pela esquerda saía metade fora da tela.
// Quando não cabe embaixo -- uma mensagem no rodapé --, ele sobe para cima da âncora.
function ancorarAbaixoDe(painel, ancora) {
  const base = ancora.getBoundingClientRect();
  const folga = 8;
  const esquerda = Math.min(base.right - painel.offsetWidth, window.innerWidth - painel.offsetWidth - folga);
  painel.style.left = `${Math.round(Math.max(folga, esquerda))}px`;
  const cabeAbaixo = base.bottom + painel.offsetHeight + folga < window.innerHeight;
  painel.style.top = `${Math.round(cabeAbaixo ? base.bottom + 4 : Math.max(folga, base.top - painel.offsetHeight - 4))}px`;
}
function fecharMenuDaMensagem() {
  chatMsgMenu.classList.add('hidden');
  chatMsgMenu.replaceChildren();
  mensagemDoMenu = null;
  ancoraDoMenu = null;
}
function abrirMenuDaMensagem(botao, mensagem, tipo) {
  mensagemDoMenu = mensagem;
  chatMsgMenu.replaceChildren();
  chatMsgMenu.dataset.tipo = tipo;
  if (tipo === 'reacoes') {
    for (const emoji of REACOES_DO_CHAT) {
      const b = elemento('button', 'msg-menu-emoji', emoji);
      b.type = 'button'; b.dataset.emoji = emoji; b.dataset.menuAction = 'reagir';
      b.title = `Reagir com ${emoji}`; b.setAttribute('aria-label', b.title);
      if (mensagem.reacoes?.[emoji]?.includes(myId)) b.classList.add('minha');
      chatMsgMenu.append(b);
    }
  } else {
    const opcoes = [];
    if (mensagem.autorId === myId) opcoes.push(['editar', 'Editar mensagem']);
    if (podeModerar) opcoes.push(['fixar', mensagem.fixada ? 'Desafixar do topo' : 'Fixar no topo']);
    if (mensagem.autorId === myId || podeModerar) opcoes.push(['excluir', 'Excluir para todos']);
    for (const [acao, rotulo] of opcoes) {
      const b = elemento('button', acao === 'excluir' ? 'perigo' : '', rotulo);
      b.type = 'button'; b.dataset.menuAction = acao;
      chatMsgMenu.append(b);
    }
  }
  chatMsgMenu.querySelectorAll('button').forEach(b => b.setAttribute('role', 'menuitem'));
  chatMsgMenu.classList.remove('hidden');
  ancoraDoMenu = botao;
  ancorarAbaixoDe(chatMsgMenu, botao);
  chatMsgMenu.querySelector('button')?.focus();
}
chatMsgMenu.addEventListener('click', evento => {
  const botao = evento.target.closest('[data-menu-action]');
  if (!botao || !mensagemDoMenu || !socket?.connected) return;
  const mensagem = mensagemDoMenu;
  const acao = botao.dataset.menuAction;
  fecharMenuDaMensagem();
  if (acao === 'reagir') socket.emit('chat-acao', { acao, id: mensagem.id, emoji: botao.dataset.emoji });
  else if (acao === 'editar') definirContextoDoChat('edicao', mensagem);
  else if (acao === 'fixar') socket.emit('chat-acao', { acao, id: mensagem.id }, resposta => { if (!resposta?.ok) status.textContent = resposta?.error || 'Não foi possível fixar.'; });
  else if (acao === 'excluir' && confirm('Excluir esta mensagem para toda a sala?')) socket.emit('chat-acao', { acao, id: mensagem.id });
});
document.addEventListener('click', evento => { if (!evento.target.closest('#chatMsgMenu,[data-chat-action]')) fecharMenuDaMensagem(); });
document.addEventListener('keydown', evento => { if (evento.key === 'Escape' && !chatMsgMenu.classList.contains('hidden')) { evento.stopPropagation(); fecharMenuDaMensagem(); } }, true);

chatMsgs.addEventListener('click', (e) => {
  const img = e.target.closest('.msg-img');
  if (img && img.src) abrirImagem(img.src);
  const botao = e.target.closest('[data-chat-action]');
  const mensagemEl = botao?.closest('[data-message-id]');
  const mensagem = mensagemEl && mensagensDoChat.get(mensagemEl.dataset.messageId);
  if (!botao || !mensagem || !socket?.connected) return;
  const acao = botao.dataset.chatAction;
  const jaAberto = !chatMsgMenu.classList.contains('hidden') && mensagemDoMenu === mensagem;
  fecharMenuDaMensagem();
  if (acao === 'responder') definirContextoDoChat('resposta', mensagem);
  else if (acao === 'reagir') socket.emit('chat-acao', { acao, id: mensagem.id, emoji: botao.dataset.emoji });
  else if (acao === 'abrir-reacoes' && !(jaAberto && chatMsgMenu.dataset.tipo === 'reacoes')) abrirMenuDaMensagem(botao, mensagem, 'reacoes');
  else if (acao === 'abrir-mais' && !(jaAberto && chatMsgMenu.dataset.tipo === 'mais')) abrirMenuDaMensagem(botao, mensagem, 'mais');
});
// ---------- As mensagens fixadas ----------
//
// Com mais de uma fixada, adivinhar qual mostrar é sempre errado: quem clica no alfinete quer
// ESCOLHER. A versão anterior percorria a lista às cegas, um item por clique, e a pessoa tinha
// de passar por todas até achar a que procurava -- sem nunca ver quantas eram.
const chatPinsBtn = document.getElementById('chatPinsBtn');
const chatPinsList = document.getElementById('chatPinsList');
function fecharListaDeFixadas() {
  chatPinsList.classList.add('hidden');
  chatPinsList.replaceChildren();
  chatPinsBtn.setAttribute('aria-expanded', 'false');
}
function desenharListaDeFixadas(fixadas) {
  chatPinsList.replaceChildren(elemento('strong', '', `${fixadas.length} mensagens fixadas`));
  for (const fixada of fixadas) {
    const linha = elemento('div', 'pin-item');
    const ir = elemento('button', 'pin-ir');
    ir.type = 'button';
    ir.setAttribute('role', 'menuitem');
    ir.append(elemento('strong', '', fixada.autor), elemento('span', '', fixada.texto || 'Imagem'));
    ir.onclick = () => { fecharListaDeFixadas(); focarMensagem(fixada.id); };
    linha.append(ir);
    // Quem fixou é quem desafixa, e o lugar natural de tirar da lista é a própria lista --
    // caçar a mensagem no meio da conversa só para soltar o alfinete é o caminho longo.
    if (podeModerar) {
      const soltar = elemento('button', 'pin-soltar');
      soltar.type = 'button';
      soltar.title = 'Desafixar';
      soltar.setAttribute('aria-label', `Desafixar a mensagem de ${fixada.autor}`);
      soltar.append(icone(ICONE_ALFINETE, 13));
      soltar.onclick = () => socket.emit('chat-acao', { acao: 'fixar', id: fixada.id }, resposta => {
        if (!resposta?.ok) status.textContent = resposta?.error || 'Não foi possível desafixar.';
      });
      linha.append(soltar);
    }
    chatPinsList.append(linha);
  }
}
function abrirListaDeFixadas(ancora) {
  const fixadas = [...mensagensDoChat.values()].filter(m => m.fixada);
  if (!fixadas.length) { status.textContent = 'Ainda não há mensagens fixadas.'; return; }
  if (fixadas.length === 1) { focarMensagem(fixadas[0].id); return; }
  fecharMenuDaMensagem();
  desenharListaDeFixadas(fixadas);
  chatPinsList.classList.remove('hidden');
  ancorarAbaixoDe(chatPinsList, ancora);
  chatPinsBtn.setAttribute('aria-expanded', 'true');
  chatPinsList.querySelector('button')?.focus();
}
chatPinsBtn.onclick = () => {
  if (!chatPinsList.classList.contains('hidden')) { fecharListaDeFixadas(); return; }
  abrirListaDeFixadas(chatPinsBtn);
};
document.addEventListener('click', evento => {
  if (!evento.target.closest('#chatPinsList,#chatPinsBtn,#chatPinnedBar')) fecharListaDeFixadas();
});
document.addEventListener('keydown', evento => {
  if (evento.key === 'Escape' && !chatPinsList.classList.contains('hidden')) { evento.stopPropagation(); fecharListaDeFixadas(); }
}, true);

// Os menus são posicionados uma vez, em coordenadas da janela. Rolar a conversa move a
// mensagem que os ancorou e NÃO move o menu: ele fica apontando para o nada, e o clique
// seguinte acerta a mensagem errada. Acompanhar a âncora é mais barato que parece -- uma
// medição e duas atribuições por quadro --, e evita fechar na cara de quem só rolou um
// pouco para reler. Quando a âncora sai da conversa, aí sim o menu perde o sentido.
function acompanharAncora() {
  for (const [painel, ancora] of [[chatMsgMenu, ancoraDoMenu], [chatPinsList, chatPinsBtn]]) {
    if (painel.classList.contains('hidden') || !ancora?.isConnected) continue;
    const alvo = ancora.getBoundingClientRect();
    const area = chatMsgs.getBoundingClientRect();
    // Só o menu da mensagem some com a âncora: o botão de fixadas vive no cabeçalho, que não
    // rola, e fechá-lo aqui apagaria a lista ao primeiro toque na roda do mouse.
    if (ancora !== chatPinsBtn && (alvo.bottom < area.top || alvo.top > area.bottom)) { fecharMenuDaMensagem(); continue; }
    ancorarAbaixoDe(painel, ancora);
  }
  if (!presenceMenu.classList.contains('hidden')) posicionarMenuDePresenca();
}
chatMsgs.addEventListener('scroll', acompanharAncora, { passive: true });
window.addEventListener('resize', acompanharAncora);
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
    // O mesmo analisador que acende o anel verde alimenta o medidor do painel. Ele só é
    // lido quando o painel está aberto: fora disso não há para onde escrever.
    if (id === 'self' && !devicesPanel.classList.contains('hidden')) {
      micNivel.style.width = `${Math.min(100, Math.round(media * 2.4))}%`;
    }
  });
  requestAnimationFrame(pulsoDeVoz);
}

// O painel só sabe o que está ligado no momento em que abre — e o que fecha precisa soltar
// a prévia, senão a câmera continua desenhando num <video> que ninguém vê.
function atualizarEspelhoDosAparelhos() {
  const aberto = !devicesPanel.classList.contains('hidden');
  const ouvindo = aberto && Boolean(micTrack) && !micMuted;
  micDica.hidden = ouvindo;
  micDica.textContent = !micTrack ? 'Ative o microfone para ver o nível.' : 'O microfone está mudo.';
  if (!ouvindo) micNivel.style.width = '0';
  const vendo = aberto && Boolean(cameraStream);
  camPreview.hidden = !vendo;
  camDica.hidden = vendo;
  ligarFluxo(camPreview, vendo ? cameraStream : null);
  if (vendo) garantirReproducao(camPreview);
}
requestAnimationFrame(pulsoDeVoz);
