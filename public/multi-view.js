(() => {
  const grid = document.getElementById('multiStage');
  const toggle = document.getElementById('multiViewBtn');
  const cards = new Map();
  // A grade lembrada só abre quando houver o que mostrar: render() confere, e sem fonte o palco
  // continua o de sempre.
  let active = window.Preferencias?.ler('grade', false) === true;
  let mostrando = new Set();

  const chave = item => JSON.stringify([item.id, item.source]);

  function layout() {
    const count = cards.size;
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    if (!count || !width || !height) return;
    // Prefer the arrangement with the largest complete 16:9 images.
    let columns = 1, best = 0;
    const max = width < 520 ? 1 : Math.min(count, Math.floor(width / 250));
    for (let c = 1; c <= max; c++) {
      const rows = Math.ceil(count / c);
      const score = Math.min((width - (c - 1) * 10) / c, (height - (rows - 1) * 10) / rows * 16 / 9);
      if (score > best) { best = score; columns = c; }
    }
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${Math.ceil(count / columns)}, minmax(160px, 1fr))`;
    cards.forEach(card => card.transform());
  }

  function create(item) {
    const ehPropria = item.id === 'self';
    const ehTela = item.source === 'screen';
    const root = document.createElement('section');
    // Escuro mesmo no tema claro, como o palco: é vídeo, e o controle por cima dele precisa
    // do fundo escuro para ser lido (tema.css).
    root.className = 'multi-card contexto-escuro';
    // A grade e a mesma coisa que os quadradinhos de baixo, so que grande: quem ajusta o
    // volume de uma tela ali tem de encontrar o mesmo ajuste aqui, e nao um card onde o som
    // simplesmente nao se controla.
    root.innerHTML = `
      <video autoplay muted playsinline></video>
      <p class="multi-wait" role="status">Conectando ao vídeo…</p>
      ${ehTela ? '<button type="button" class="espectadores espectadores-card" hidden></button>' : ''}
      <div class="multi-caption">
        <span class="multi-nome"></span>
        <div class="multi-barra">
          ${ehPropria ? '' : `<div class="volume-row multi-volume">${LINHA_DE_VOLUME(ehTela ? 'tela' : 'voz')}</div>`}
          <div class="multi-actions"></div>
        </div>
      </div>`;
    const video = root.querySelector('video');
    const label = root.querySelector('.multi-nome');
    const waiting = root.querySelector('.multi-wait');
    const actions = root.querySelector('.multi-actions');
    const slider = root.querySelector('.volume-slider');
    const muteBtn = root.querySelector('.mute-peer-btn');
    const button = (text, title, action, className) => {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = text; el.title = title; el.setAttribute('aria-label', title);
      if (className) el.className = className;
      el.onclick = action; actions.appendChild(el); return el;
    };

    if (slider) {
      const mexer = mudanca => ehTela ? definirAudioDaTela(item.id, mudanca) : definirAudioDaVoz(item.id, mudanca);
      slider.addEventListener('input', () => mexer({ nivel: slider.value / 100 }));
      muteBtn.addEventListener('click', () => mexer({ alternarMudo: true }));
    }

    let zoom = 1, x = 0, y = 0, drag = null;
    const transform = () => {
      const scale = Math.min(root.clientWidth / (video.videoWidth || 16), root.clientHeight / (video.videoHeight || 9));
      const mx = Math.max(0, ((video.videoWidth || 16) * scale * zoom - root.clientWidth) / 2);
      const my = Math.max(0, ((video.videoHeight || 9) * scale * zoom - root.clientHeight) / 2);
      x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
      video.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      video.style.touchAction = zoom > 1 ? 'none' : 'auto';
      video.style.cursor = zoom > 1 ? 'grab' : 'default';
    };
    const setZoom = (value, point) => {
      const old = zoom;
      zoom = Math.max(1, Math.min(3, value));
      if (point) {
        const rect = root.getBoundingClientRect();
        const px = point.clientX - rect.left - rect.width / 2, py = point.clientY - rect.top - rect.height / 2;
        x = px - (px - x) * zoom / old; y = py - (py - y) * zoom / old;
      }
      if (zoom === 1) x = y = 0;
      minus.disabled = zoom <= 1; plus.disabled = zoom >= 3;
      reset.textContent = `${Math.round(zoom * 100)}%`;
      reset.disabled = zoom === 1;
      transform();
    };
    const minus = button('−', 'Diminuir zoom deste vídeo', () => setZoom(zoom - .25), 'multi-zoom');
    const reset = button('100%', 'Restaurar zoom deste vídeo', () => setZoom(1), 'multi-zoom multi-nivel');
    const plus = button('+', 'Aumentar zoom deste vídeo', () => setZoom(zoom + .25), 'multi-zoom');
    minus.disabled = true;
    reset.disabled = true;
    // So a propria camera/tela ganha este botao: ocultar a de outro participante nao faz
    // sentido, o quadradinho dele nao e uma previa que se controla daqui. Um clique tira
    // este item da lista no proximo render() -- o card some da grade, nao so o video.
    if (ehPropria) {
      button('Ocultar', `Ocultar sua ${ehTela ? 'tela' : 'câmera'} só para você — a sala continua recebendo`,
        () => alternarOcultarPropria(item.source), 'multi-ocultar');
    }
    // Largar uma tela aqui dentro: sem isto a unica saida era fechar a grade e procurar o
    // quadradinho certo la embaixo.
    const parar = ehTela && !ehPropria
      ? button('Parar', 'Parar de assistir esta tela', () => assistirTela(item.id, false)) : null;
    button('Ampliar', 'Ver somente este vídeo', () => { setActive(false); pin(item.id, item.source, true); }, 'multi-ampliar');
    video.addEventListener('wheel', event => {
      if (event.ctrlKey || !video.videoWidth || !event.deltaY) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
      setZoom(zoom * Math.exp(-Math.max(-125, Math.min(125, delta)) * .002), event);
    }, { passive: false });
    video.addEventListener('pointerdown', event => {
      if (zoom <= 1 || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
      video.setPointerCapture(event.pointerId);
    });
    video.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      x = event.clientX - drag.x; y = event.clientY - drag.y; transform();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => video.addEventListener(type, () => { drag = null; }));
    const state = () => {
      waiting.hidden = !video.paused && video.readyState >= 2 && video.videoWidth > 0;
      root.classList.toggle('playback-stalled', !waiting.hidden);
    };
    ['playing', 'loadeddata', 'waiting', 'pause', 'emptied'].forEach(type => video.addEventListener(type, state));
    video.addEventListener('resize', transform);
    button('Reproduzir', 'Retomar a reprodução deste vídeo', () => garantirReproducao(video)).className = 'multi-retry';
    grid.appendChild(root);
    return { root, video, label, slider, muteBtn, parar, source: item.source, transform, espectadores: root.querySelector('.espectadores') };
  }

  // O volume mora num lugar so (sala.js); daqui o card apenas recebe o aviso de que ele
  // mudou -- inclusive quando quem mexeu foi o quadradinho la de baixo.
  function sincronizarAudio(id) {
    for (const [key, card] of cards) {
      if (!card.slider || JSON.parse(key)[0] !== id) continue;
      pintarControleDeVolume(card.slider, card.muteBtn, card.source === 'screen' ? audioDaTela(id) : audioDaVoz(id));
    }
  }

  function render() {
    // Camera/tela propria ocultada nao entra na grade: o card some de vez, em vez de ficar
    // ali tampado -- assim o espaco dele volta para os outros participantes.
    const items = (active ? candidatosDeDestaque() : [])
      .filter(item => !(item.id === 'self' && (item.source === 'screen' ? ocultarPropriaTela : ocultarPropriaCamera)));
    const wanted = new Set(items.map(chave));
    // O que a grade assumiu, no formato que o transporte entende. A plateia consulta isto
    // para não repetir uma imagem que já está grande aqui em cima; o transporte, para saber
    // que um card merece a camada do meio e um quadradinho não.
    mostrando = new Set(items.map(item => `${item.id}|${item.source}`));
    for (const [key, card] of cards) {
      if (wanted.has(key)) continue;
      card.video.pause(); card.video.srcObject = null;
      midiasBloqueadas.delete(card.video);
      card.root.remove(); cards.delete(key);
    }
    const visible = active && items.length > 0;
    grid.hidden = !visible;
    stage.classList.toggle('multi-view', visible);
    toggle.setAttribute('aria-pressed', String(active));
    toggle.title = active ? 'Voltar ao destaque único' : 'Ver telas e câmeras em grade';
    toggle.setAttribute('aria-label', toggle.title);
    for (const item of items) {
      const key = chave(item);
      if (!cards.has(key)) cards.set(key, create(item));
      const card = cards.get(key);
      const name = `${nomeDe(item.id)} — ${item.source === 'screen' ? 'Tela' : 'Câmera'}`;
      card.label.textContent = name; card.root.setAttribute('aria-label', name);
      const stream = item.id === 'self' ? (item.source === 'screen' ? screenStream : cameraStream) : peers.get(item.id)?.remoteStreams[item.source];
      if (ligarFluxo(card.video, stream) || card.video.paused) garantirReproducao(card.video);
      card.root.classList.toggle('selected', pinned?.id === item.id && pinned.source === item.source);
      // Cada tela da grade com o próprio placar: com três telas lado a lado, quem vê qual é
      // exatamente a pergunta que a grade faz.
      if (card.espectadores) window.NexoEspectadores?.pintar(card.espectadores, item.id);
      if (card.slider) sincronizarAudio(item.id);
    }
    if (visible) stageControls.classList.remove('hidden');
    requestAnimationFrame(layout);
  }

  function setActive(value) {
    active = value; render(); mostrarControlesDoPalco();
    // Quem prefere ver tudo em grade prefere na próxima entrada também. Neste aparelho só: o
    // que cabe numa tela larga não cabe num celular.
    window.Preferencias?.gravar('grade', active || null);
    // Abrir ou fechar a grade muda quem está em destaque -- e com isso quem sai da plateia,
    // quem volta para ela e em que camada cada um desce. `atualizarPalco` é quem avisa as
    // duas pontas, então vale nos dois sentidos, não só ao fechar.
    atualizarPalco();
  }
  toggle.onclick = () => setActive(!active);
  new ResizeObserver(layout).observe(grid);
  window.RoomMulti = {
    render, sincronizarAudio,
    get active() { return active; },
    mostra: (id, source) => mostrando.has(`${id}|${source}`),
    get chaves() { return mostrando; }
  };
})();
