/* Room presentation and diagnostics. Media capture stays in sala.js. */
(() => {
  const $ = id => document.getElementById(id);
  const appRoot = document.querySelector('.app');
  let startedAt = null;
  let memberSignature = '';
  let report = '';
  let collecting = false;

  $('sidebarRoom').textContent = roomCode;

  function closeSidebar() {
    appRoot.classList.remove('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', 'false');
  }
  $('sidebarToggle').onclick = () => {
    const open = appRoot.classList.toggle('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', String(open));
  };

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'invite') copyLinkBtn.click();
    if (action === 'chat') { closeSidebar(); abrirChat(); }
    if (action === 'room') { closeSidebar(); fecharChat(); }
    if (action === 'devices') devicesBtn.click();
    if (action === 'diagnostics') {
      $('diagnosticsPanel').classList.remove('hidden');
      collectDiagnostics();
    }
    const close = event.target.closest('[data-close]')?.dataset.close;
    if (close) $(close)?.classList.add('hidden');
    if (appRoot.classList.contains('sidebar-open') && !event.target.closest('#roomSidebar, #sidebarToggle')) closeSidebar();
  });

  $('attachImageBtn').onclick = () => $('chatImageFile').click();
  $('chatImageFile').onchange = () => {
    const file = $('chatImageFile').files[0];
    if (file) mandarArquivoDeImagem(file);
    $('chatImageFile').value = '';
  };

  function renderRoom() {
    const joined = tiles.has('self');
    if (joined && !startedAt) startedAt = Date.now();
    const total = joined ? peers.size + 1 : 0;
    const connected = Boolean(joined && socket?.connected);
    const failed = [...peers.values()].some(p => ['failed', 'disconnected'].includes(p.pc.connectionState));
    document.querySelector('.connection-box').classList.toggle('connected', connected && !failed);
    $('connectionLabel').textContent = failed ? 'Conexão instável' : connected ? 'Conectado à sala' : joined ? 'Reconectando…' : 'Aguardando entrada';
    const seconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
    $('sessionClock').textContent = joined ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')} nesta sessão` : 'Sua sessão começa aqui';
    $('selfName').textContent = myName || 'Seu perfil';
    $('selfAvatar').textContent = iniciais(myName || '?');
    $('selfAvatar').style.background = corDoNome(myName || 'Nexo');
    $('selfState').textContent = !joined ? 'Pronto para entrar' : micMuted ? 'Microfone desligado' : 'Microfone ligado';
    for (const id of ['memberTotal', 'sidebarCount', 'tileCount']) $(id).textContent = total;
    const live = [...peers.values()].filter(p => p.state.screen).length + Number(Boolean(screenStream));
    $('sessionBadge').textContent = live ? `${live} ${live === 1 ? 'TELA AO VIVO' : 'TELAS AO VIVO'}` : 'SALA DE VOZ';
    $('sessionBadge').classList.toggle('live', live > 0);
    $('missionTitle').textContent = total > 1 ? 'Squad reunido' : 'Monte seu squad';
    $('missionText').textContent = total > 1 ? `${total} pessoas, uma sala. ${live ? 'A transmissão já começou.' : 'Que tal compartilhar uma jogada?'}` : 'Copie o convite e chame alguém para a sala.';
    const members = joined ? [{ id: 'self', name: myName, state: meuEstado() }, ...peers.values()] : [];
    const signature = JSON.stringify(members.map(p => [p.id, p.name, p.state]));
    if (signature !== memberSignature) {
      memberSignature = signature;
      $('memberList').replaceChildren(...members.map(person => {
        const row = document.createElement('div');
        row.className = 'member';
        row.dataset.memberId = person.id;
        const avatar = document.createElement('span');
        avatar.className = 'member-avatar';
        avatar.style.background = corDoNome(person.name);
        avatar.textContent = iniciais(person.name);
        const name = document.createElement('span');
        name.className = 'member-name';
        name.textContent = person.name + (person.id === 'self' ? ' (você)' : '');
        const state = document.createElement('span');
        state.className = person.state.screen ? 'member-live' : 'member-state';
        state.textContent = person.state.screen ? 'LIVE' : person.state.micMuted ? 'mudo' : 'voz';
        row.append(avatar, name, state);
        return row;
      }));
    }
    document.querySelectorAll('.member').forEach(row => row.classList.toggle('falando', Boolean(tiles.get(row.dataset.memberId)?.root.classList.contains('falando'))));
    document.querySelectorAll('.avatar-wrap').forEach(element => {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Destacar ${element.parentElement.querySelector('.participant-name').textContent}`);
    });
    document.querySelectorAll('.volume-slider').forEach(element => element.setAttribute('aria-label', `Volume de ${element.closest('.participant').querySelector('.participant-name').textContent}`));
    if (!suportaCompartilharTela) {
      screenBtn.setAttribute('aria-label', 'Este navegador permite assistir, mas não transmitir a tela');
      screenBtn.title = 'Você pode assistir às telas. Para transmitir a sua, use um computador.';
    }
    chatToggle.setAttribute('aria-expanded', String(chatVisivel()));
  }
  setInterval(renderRoom, 1000);
  document.addEventListener('room-update', renderRoom);
  renderRoom();

  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.avatar-wrap')) {
      event.preventDefault();
      event.target.click();
    }
  });

  async function collectDiagnostics() {
    if (collecting) return;
    collecting = true;
    try {
      const turn = rtcConfig.iceServers?.some(s => [s.urls].flat().some(url => /^turns?:/.test(url)));
      const lines = ['Nexo · diagnóstico de mídia', `Navegador: ${navigator.userAgent}`, `Contexto seguro: ${window.isSecureContext ? 'sim' : 'não'}`, `Servidor: ${socket?.connected ? 'conectado' : 'desconectado'}`, `TURN configurado: ${turn ? 'sim' : 'não'}`, `Vídeo no palco: ${stageVideo.videoWidth} × ${stageVideo.videoHeight}; ${stageVideo.paused ? 'pausado' : 'reproduzindo'}; readyState=${stageVideo.readyState}`, `Reprodução bloqueada: ${midiasBloqueadas.size} elemento(s)`];
      let index = 0, failed = false, received = 0;
      lines.push('Revisão de mídia: screen-vp8-serial-1');
      for (const peer of peers.values()) {
        lines.push('', `Participante ${++index}: conexão=${peer.pc.connectionState}; ICE=${peer.pc.iceConnectionState}; sinalização=${peer.pc.signalingState}`);
        lines.push(`Fontes anunciadas: câmera=${Boolean(peer.state.camera)}, tela=${Boolean(peer.state.screen)}, áudio de tela=${Boolean(peer.state.screenAudio)}`);
        lines.push(`Última falha de sinalização: ${peer.lastSignalingError || 'nenhuma'}`);
        peer.pc.getTransceivers().forEach(t => lines.push(`Transceptor MID ${t.mid ?? '?'}: direção=${t.direction}; negociada=${t.currentDirection || 'pendente'}`));
        failed ||= ['failed', 'disconnected', 'checking'].includes(peer.pc.iceConnectionState);
        let stats;
        try { stats = await peer.pc.getStats(); } catch (_) { lines.push('Estatísticas indisponíveis.'); continue; }
        stats.forEach(item => {
          if (item.type === 'transport' && item.selectedCandidatePairId) {
            const pair = stats.get(item.selectedCandidatePairId);
            const candidate = pair && stats.get(pair.localCandidateId);
            lines.push(`Rota: ${candidate?.candidateType === 'relay' ? 'TURN' : 'direta'}; latência: ${pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) + ' ms' : 'não informada'}`);
          }
          if (item.type === 'inbound-rtp' && (item.kind === 'video' || item.mediaType === 'video')) {
            const codec = stats.get(item.codecId);
            received += item.framesDecoded || 0;
            lines.push(`Vídeo MID ${item.mid ?? '?'}: ${codec?.mimeType || 'codec não informado'}; bytes=${item.bytesReceived ?? '?'}; quadros decodificados=${item.framesDecoded ?? '?'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}`);
            lines.push(`  Fonte=${peer.remoteStreamIds?.mids?.[item.mid] || 'consultar faixas abaixo'}; recebidos=${item.framesReceived ?? '?'}; keyframes=${item.keyFramesDecoded ?? '?'}; descartados=${item.framesDropped ?? '?'}; PLI=${item.pliCount ?? '?'}`);
          }
        });
        peer.remoteTracks.forEach(event => lines.push(`Faixa ${event.track.kind}, MID ${event.transceiver?.mid ?? '?'}: ${RoomMedia.sourceForTrack(event, peer.remoteStreamIds, peer.state) || 'aguardando identificação'}; ${event.track.readyState}; muda=${event.track.muted}`));
      }
      let summary = !socket?.connected ? 'O servidor está desconectado. Confira o endereço e se o servidor está ligado.'
        : !peers.size ? 'Você está conectado à sala. O diagnóstico de mídia aparece quando outra pessoa entrar.'
        : failed ? (turn ? 'A conexão de mídia está em negociação ou falhou. Confira o serviço TURN e tente outra rede.' : 'A conexão de mídia está em negociação ou falhou. Redes móveis e alguns roteadores precisam de TURN; o link HTTPS do Funnel não substitui esse serviço.')
        : midiasBloqueadas.size ? 'O navegador bloqueou a reprodução. Feche este painel e toque em Ativar reprodução.'
        : received > 0 ? 'Há quadros de vídeo decodificados. Se a imagem não aparece, feche este painel e tente Reproduzir vídeo.'
        : 'A sala está conectada. Se alguém já transmite, aguarde os primeiros quadros e confira as faixas abaixo.';
      if (pinned?.id === 'self') summary = 'O palco mostra sua prévia local. Para conferir a recepção, abra o diagnóstico em outro participante.';
      report = lines.join('\n');
      $('diagnosticsSummary').textContent = summary;
      $('diagnosticsReport').textContent = report;
    } finally { collecting = false; }
  }
  setInterval(() => { if (!$('diagnosticsPanel').classList.contains('hidden')) collectDiagnostics(); }, 4000);
  $('copyDiagnosticsBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(report);
      $('copyDiagnosticsBtn').textContent = 'Copiado!';
      setTimeout(() => { $('copyDiagnosticsBtn').textContent = 'Copiar diagnóstico'; }, 1800);
    } catch (_) {
      const range = document.createRange();
      range.selectNodeContents($('diagnosticsReport'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      $('diagnosticsSummary').textContent = 'Relatório selecionado. Use o comando Copiar do navegador.';
    }
  };

  // Focus stays inside an open dialog and returns to its trigger when closed.
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  let activeDialog = null, previousFocus = null;
  const visibleDialog = () => [...dialogs].reverse().find(d => !d.classList.contains('hidden'));
  const focusable = dialog => [...dialog.querySelectorAll('button:not(:disabled), input:not([hidden]), select, textarea, a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
  function syncDialog() {
    const next = visibleDialog();
    if (next === activeDialog) return;
    appRoot.inert = Boolean(next);
    if (next) {
      if (!activeDialog) previousFocus = document.activeElement;
      activeDialog = next;
      (next.querySelector('input:not([type="file"])') || focusable(next)[0])?.focus();
    } else {
      activeDialog = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    }
  }
  for (const dialog of dialogs) {
    new MutationObserver(syncDialog).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || dialog === nameGate) return;
      if (dialog === settingsPanel) fecharPainelDeTela();
      else dialog.classList.add('hidden');
    });
  }
  document.addEventListener('keydown', event => {
    if (activeDialog && event.key === 'Tab') {
      const elements = focusable(activeDialog);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === 'Escape' && activeDialog && activeDialog !== nameGate) {
      event.stopImmediatePropagation();
      if (activeDialog === settingsPanel) fecharPainelDeTela();
      else activeDialog.classList.add('hidden');
    } else if (event.key === 'Escape') closeSidebar();
  }, true);
  syncDialog();
})();
