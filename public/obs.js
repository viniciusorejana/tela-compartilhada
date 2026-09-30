/* A página que vai dentro do OBS (fonte "Navegador").
 *
 * O link traz tudo o que ela sabe: quem o criou, quem aparece e o quê (estudio.js). Ela o
 * apresenta ao socket `/estudio`, e o servidor responde com o estado -- aguardando, recusado,
 * desligado ou no ar, com uma credencial oculta para entrar na sala e só receber.
 *
 * Dentro do OBS a página não mostra nada além da imagem: um "aguardando a Ana" no meio de uma
 * transmissão ao vivo seria pior que o vazio. O OBS se anuncia em `window.obsstudio`, e é por
 * ele que a página sabe onde está; fora dele -- quem colou o link numa aba para conferir -- ela
 * diz o que está acontecendo. `?avisos=1` liga os avisos também no OBS, para montar a cena.
 *
 * O resto da URL são escolhas de quem montou a cena, e só podem TIRAR coisas: `?som=0` deixa a
 * câmera ou a tela sem som, `?ajuste=preencher` corta a imagem para ocupar a fonte inteira.
 */
(() => {
  const LK = window.LivekitClient;
  const $ = id => document.getElementById(id);
  const link = location.pathname.split('/').pop();
  const parametros = new URLSearchParams(location.search);
  const noObs = Boolean(window.obsstudio);
  const mostrarAvisos = !noObs || parametros.get('avisos') === '1';
  const comSom = parametros.get('som') !== '0';
  // Quanto tempo "falando" dura depois do último trecho alto: sem esta folga, o rosto piscaria
  // entre uma sílaba e outra.
  const MS_DE_FOLGA_DA_FALA = 220;

  if (parametros.get('ajuste') === 'preencher') $('video').classList.add('preencher');
  if (!noObs) document.body.classList.add('fora-do-obs');

  const rostos = NexoReativo.criar($('rostos'));
  let estado = null;
  let sala = null;
  let tokenDaSala = null;
  let renovacao = null;

  function avisar(texto, dica = '') {
    $('avisoTexto').textContent = texto || '';
    $('avisoDica').textContent = dica || '';
    $('aviso').hidden = !texto || !mostrarAvisos;
  }

  const DICAS = {
    diretor: 'Pode deixar esta fonte no OBS: a imagem aparece sozinha quando a sala abrir.',
    alvo: 'A imagem aparece sozinha quando a pessoa entrar.',
    recusado: 'Quando ela deixar, a imagem volta sozinha.',
    sala: 'Quando quem abriu a sala religar o OBS, a imagem volta sozinha.',
    revogado: 'Peça um link novo a quem criou este.'
  };

  // ---------- O botão de som, só fora do OBS ----------
  //
  // O OBS toca som sem pedir; uma aba comum não toca nada antes de um clique na página.
  function pedirClique() {
    if (noObs) return;
    $('ouvir').hidden = false;
  }
  $('ouvir').onclick = () => {
    $('ouvir').hidden = true;
    medidor.acordar();
    $('audio').play().catch(() => {});
  };

  // ---------- O nível de voz de cada pessoa (os rostos) ----------
  //
  // A voz desce só para ser medida: o elemento de áudio é mudo, e o analisador não está ligado
  // a saída nenhuma. O elemento existe porque o Chrome não entrega o som de uma faixa remota ao
  // Web Audio se ninguém estiver "tocando" a faixa (o mesmo cuidado de sala.js).
  const medidor = (() => {
    let contexto = null;
    const porId = new Map();

    function acordar() {
      if (!contexto) contexto = new (window.AudioContext || window.webkitAudioContext)();
      if (contexto.state === 'suspended') contexto.resume().catch(() => {}).then(() => { if (contexto.state === 'suspended') pedirClique(); });
      return contexto;
    }

    function acompanhar(id, faixa) {
      soltar(id);
      try {
        const ctx = acordar();
        const fluxo = new MediaStream([faixa]);
        const elemento = new Audio();
        elemento.muted = true;
        elemento.srcObject = fluxo;
        elemento.play().catch(() => {});
        const fonte = ctx.createMediaStreamSource(fluxo);
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 1024;
        fonte.connect(analisador);
        porId.set(id, { fonte, analisador, elemento, dados: new Float32Array(analisador.fftSize), ultimoAlto: 0 });
      } catch (_) { /* sem Web Audio, o rosto só fica parado */ }
    }

    function soltar(id) {
      const entrada = porId.get(id);
      if (!entrada) return;
      try { entrada.fonte.disconnect(); } catch (_) { /* já desligada */ }
      entrada.elemento.srcObject = null;
      porId.delete(id);
      rostos.definirFalando(id, false);
    }

    function passo() {
      const limiar = NexoReativo.limiarEmDb(estado?.config?.estilo?.sensibilidade);
      const agora = performance.now();
      for (const [id, entrada] of porId) {
        entrada.analisador.getFloatTimeDomainData(entrada.dados);
        let soma = 0;
        for (let i = 0; i < entrada.dados.length; i++) soma += entrada.dados[i] * entrada.dados[i];
        const db = 10 * Math.log10(soma / entrada.dados.length + 1e-12);
        if (db >= limiar) entrada.ultimoAlto = agora;
        rostos.definirFalando(id, agora - entrada.ultimoAlto < MS_DE_FOLGA_DA_FALA);
      }
      requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);

    return { acompanhar, soltar, acordar, soltarTodos: () => [...porId.keys()].forEach(soltar), ids: () => [...porId.keys()] };
  })();

  // ---------- O que assinar ----------

  function micMudo(participante) {
    const microfone = [...participante.trackPublications.values()].find(p => p.source === LK.Track.Source.Microphone);
    return !microfone || microfone.isMuted;
  }

  function quer(participante, publicacao, idsDosRostos) {
    if (estado?.tipo !== 'ok') return false;
    if (estado.reativo) return publicacao.source === LK.Track.Source.Microphone && idsDosRostos.has(participante.identity);
    if (participante.identity !== estado.alvo?.identidade) return false;
    if (estado.video && publicacao.source === estado.video) return true;
    return Boolean(estado.audio && publicacao.source === estado.audio && comSom);
  }

  function sincronizar() {
    if (!sala || sala.state !== 'connected') { atualizarImagem(); return; }
    const idsDosRostos = new Set(estado?.reativo ? estado.pessoas.map(p => p.identidade) : []);
    sala.remoteParticipants.forEach(participante => {
      participante.trackPublications.forEach(publicacao => {
        const deve = quer(participante, publicacao, idsDosRostos);
        if (publicacao.isSubscribed !== deve) publicacao.setSubscribed(deve);
        // A camada cheia: o OBS mostra a imagem grande, e é para isso que ela foi pedida.
        if (deve && publicacao.kind === 'video') publicacao.setVideoQuality?.(LK.VideoQuality.HIGH);
      });
    });
    if (estado?.reativo) for (const id of idsDosRostos) {
      const participante = sala.remoteParticipants.get(id);
      rostos.definirMudo(id, !participante || micMudo(participante));
    }
    // Quem saiu da lista dos rostos para de ser medido, mesmo que a faixa ainda não tenha caído.
    for (const id of medidor.ids()) if (!idsDosRostos.has(id)) medidor.soltar(id);
    atualizarImagem();
  }

  // A imagem aparece só com a faixa descendo e ligada: câmera desligada é fonte transparente,
  // e não o último quadro congelado no meio da cena.
  function atualizarImagem() {
    const video = $('video');
    const participante = sala?.remoteParticipants.get(estado?.alvo?.identidade || '');
    const publicacao = participante && estado?.video ? [...participante.trackPublications.values()].find(p => p.source === estado.video) : null;
    const visivel = Boolean(estado?.tipo === 'ok' && !estado.reativo && publicacao?.isSubscribed && !publicacao.isMuted && publicacao.track);
    video.hidden = !visivel;
    if (!visivel && estado?.tipo === 'ok' && !estado.reativo && estado.video && mostrarAvisos) {
      avisar(estado.midia ? `${estado.alvo?.nome || 'A pessoa'} está sem ${estado.fonte === 'tela' ? 'tela compartilhada' : 'câmera'} agora.` : 'Conectando…', 'A imagem aparece sozinha quando ela ligar.');
    } else if (estado?.tipo === 'ok') avisar('');
  }

  function receber(faixa, publicacao, participante) {
    if (estado?.reativo) {
      if (faixa.kind === 'audio') medidor.acompanhar(participante.identity, faixa.mediaStreamTrack);
      return;
    }
    if (participante.identity !== estado?.alvo?.identidade) return;
    const destino = faixa.kind === 'video' ? $('video') : $('audio');
    destino.srcObject = new MediaStream([faixa.mediaStreamTrack]);
    destino.play().catch(() => { if (faixa.kind === 'audio') pedirClique(); });
    atualizarImagem();
  }

  function soltar(faixa, publicacao, participante) {
    if (faixa.kind === 'audio' && estado?.reativo) { medidor.soltar(participante.identity); return; }
    const destino = faixa.kind === 'video' ? $('video') : $('audio');
    if (destino.srcObject?.getTracks().includes(faixa.mediaStreamTrack)) destino.srcObject = null;
    atualizarImagem();
  }

  function limparMidia() {
    $('video').srcObject = null;
    $('audio').srcObject = null;
    medidor.soltarTodos();
  }

  // ---------- A conexão com a sala ----------

  function pedirRenovacao(espera = 2000) {
    clearTimeout(renovacao);
    renovacao = setTimeout(() => { if (socket.connected) socket.emit('renovar'); }, espera);
  }

  async function desconectar() {
    const antiga = sala;
    sala = null;
    tokenDaSala = null;
    limparMidia();
    if (antiga) { try { await antiga.disconnect(); } catch (_) { /* já estava fora */ } }
  }

  async function conectar(midia) {
    if (tokenDaSala === midia.token) return;
    await desconectar();
    tokenDaSala = midia.token;
    const nova = new LK.Room({ adaptiveStream: false, dynacast: false });
    sala = nova;
    const seAtual = fn => (...args) => { if (sala === nova) fn(...args); };
    nova
      .on(LK.RoomEvent.ParticipantConnected, seAtual(sincronizar))
      .on(LK.RoomEvent.ParticipantDisconnected, seAtual(sincronizar))
      .on(LK.RoomEvent.TrackPublished, seAtual(sincronizar))
      .on(LK.RoomEvent.TrackUnpublished, seAtual(sincronizar))
      .on(LK.RoomEvent.TrackMuted, seAtual(sincronizar))
      .on(LK.RoomEvent.TrackUnmuted, seAtual(sincronizar))
      .on(LK.RoomEvent.TrackSubscribed, seAtual(receber))
      .on(LK.RoomEvent.TrackUnsubscribed, seAtual(soltar))
      // Caiu de vez: a credencial pode ter vencido, ou o servidor de mídia reiniciou. Pede-se
      // outra, e a imagem volta sem ninguém mexer no OBS.
      .on(LK.RoomEvent.Disconnected, seAtual(() => { sala = null; tokenDaSala = null; limparMidia(); pedirRenovacao(); }));
    try {
      await nova.connect(midia.url, midia.token, { autoSubscribe: false });
      if (sala !== nova) { nova.disconnect().catch(() => {}); return; }
      sincronizar();
    } catch (_) {
      if (sala !== nova) return;
      sala = null;
      tokenDaSala = null;
      pedirRenovacao(4000);
    }
  }

  // ---------- O estado, vindo do servidor ----------

  function aplicar(novo) {
    const antes = estado;
    estado = novo;
    if (novo.tipo !== 'ok') avisar(novo.texto, DICAS[novo.motivo] || DICAS[novo.tipo] || '');
    else if (!novo.midia) avisar('Conectando…', 'O servidor de mídia está voltando.');
    else avisar('');
    $('rostos').hidden = !novo.reativo;
    if (novo.reativo) rostos.definir({ config: novo.config, pessoas: novo.pessoas });
    else if (antes?.reativo) rostos.definir({ pessoas: [] });
    // A pessoa trocou de identidade (um F5 dela): a imagem antiga não serve mais.
    if (antes?.alvo?.identidade && antes.alvo.identidade !== novo.alvo?.identidade) { $('video').srcObject = null; $('audio').srcObject = null; }
    if (novo.midia) conectar(novo.midia); else desconectar();
    sincronizar();
  }

  const socket = io('/estudio', { auth: { link }, reconnectionDelayMax: 10000 });
  socket.on('estado', aplicar);
  socket.on('connect_error', erro => {
    if (erro?.message === 'link-invalido') {
      avisar('Este link do Nexo não é válido.', 'Confira se ele foi copiado inteiro.');
      socket.disconnect();
      return;
    }
    avisar(erro?.message || 'Sem conexão com o Nexo.', 'Tentando de novo…');
    // Recusado pelo servidor (limite de conexões), o cliente não tenta de novo sozinho.
    if (!socket.active) setTimeout(() => socket.connect(), 10000);
  });
  socket.on('disconnect', () => { if (estado?.tipo !== 'ok') avisar('Sem conexão com o Nexo.', 'Tentando de novo…'); });

  // Quem troca de cena com "desligar a fonte quando não visível" fecha esta página: a captura
  // sai da lista da sala na hora, e não quando o servidor perceber.
  window.addEventListener('pagehide', () => { socket.disconnect(); sala?.disconnect(); });

  avisar('Conectando ao Nexo…');
  window.NexoObs = { get estado() { return estado; }, get sala() { return sala; }, rostos };
})();
