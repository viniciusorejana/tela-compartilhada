(() => {
  const grid = document.getElementById('multiStage');
  const toggle = document.getElementById('multiViewBtn');
  const cards = new Map();
  let active = false;

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
    const root = document.createElement('section');
    root.className = 'multi-card';
    root.innerHTML = '<video autoplay muted playsinline></video><p class="multi-wait" role="status">Conectando ao vídeo…</p><div class="multi-caption"><span></span><div class="multi-actions"></div></div>';
    const video = root.querySelector('video');
    const label = root.querySelector('.multi-caption > span');
    const waiting = root.querySelector('.multi-wait');
    const actions = root.querySelector('.multi-actions');
    const button = (text, title, action) => {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = text; el.title = title; el.setAttribute('aria-label', title);
      el.onclick = action; actions.appendChild(el); return el;
    };
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
      transform();
    };
    const minus = button('−', 'Diminuir zoom deste vídeo', () => setZoom(zoom - .25));
    const reset = button('100%', 'Restaurar zoom deste vídeo', () => setZoom(1));
    const plus = button('+', 'Aumentar zoom deste vídeo', () => setZoom(zoom + .25));
    minus.disabled = true;
    const listen = item.source === 'screen' && item.id !== 'self'
      ? button('Ouvir', 'Ouvir o áudio desta tela', () => { pin(item.id, item.source, true); render(); }) : null;
    button('Ampliar', 'Ver somente este vídeo', () => { setActive(false); pin(item.id, item.source, true); });
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
    return { root, video, label, listen, transform };
  }

  function render() {
    const items = active ? candidatosDeDestaque() : [];
    const wanted = new Set(items.map(item => JSON.stringify([item.id, item.source])));
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
      const key = JSON.stringify([item.id, item.source]);
      if (!cards.has(key)) cards.set(key, create(item));
      const card = cards.get(key);
      const name = `${nomeDe(item.id)} — ${item.source === 'screen' ? 'Tela' : 'Câmera'}`;
      card.label.textContent = name; card.root.setAttribute('aria-label', name);
      const stream = item.id === 'self' ? (item.source === 'screen' ? screenStream : cameraStream) : peers.get(item.id)?.remoteStreams[item.source];
      if (ligarFluxo(card.video, stream) || card.video.paused) garantirReproducao(card.video);
      const selected = pinned?.id === item.id && pinned.source === item.source;
      card.root.classList.toggle('selected', selected);
      if (card.listen) {
        const peer = peers.get(item.id);
        card.listen.disabled = !peer?.state.screenAudio;
        card.listen.setAttribute('aria-pressed', String(selected));
        card.listen.textContent = card.listen.disabled ? 'Sem áudio' : selected ? 'Áudio selecionado' : 'Ouvir';
      }
    }
    if (visible) stageControls.classList.remove('hidden');
    requestAnimationFrame(layout);
  }

  function setActive(value) {
    active = value; render(); mostrarControlesDoPalco();
    if (!active) atualizarPalco();
  }
  toggle.onclick = () => setActive(!active);
  new ResizeObserver(layout).observe(grid);
  window.RoomMulti = { render, get active() { return active; } };
})();
