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
    if (action === 'diagnostics') abrirDiagnostico();
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
    const signature = JSON.stringify(members.map(p => [p.id, p.name, p.state, Boolean(p.semConexao)]));
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
        // Quem perdeu a conexao ainda aparece, mas dito: some sozinho se nao voltar.
        state.className = person.semConexao ? 'member-state' : person.state.screen ? 'member-live' : 'member-state';
        state.textContent = person.semConexao ? 'sem conexão' : person.state.screen ? 'LIVE' : person.state.micMuted ? 'mudo' : 'voz';
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

  // powerEfficient* nao existe em todo navegador; "não informado" e honesto, "não" nao seria.
  const describeEfficiency = valor => valor === undefined ? 'não informado' : valor ? 'sim (hardware provável)' : 'não (software provável)';

  // "codificador=OpenH264" nao diz nada a quem le, e a conclusao errada e facil: culpar o
  // Nexo, o codec escolhido ou a internet. Esta pergunta e feita ANTES de qualquer conexao,
  // sem simulcast e sem dica de conteudo -- ou seja, no caso mais simples possivel. Se nem
  // ela encontra a placa de video, nao existe ajuste nesta pagina que a faca aparecer: o
  // problema esta no navegador, no driver ou na maquina.
  const CODECS_PARA_SONDAR = {
    'H.264': 'video/H264;profile-level-id=42e01f',
    VP8: 'video/VP8', VP9: 'video/VP9', AV1: 'video/AV1'
  };

  async function codificadoresPorHardware() {
    if (!navigator.mediaCapabilities?.encodingInfo) return null;
    const comHardware = [];
    for (const [nome, contentType] of Object.entries(CODECS_PARA_SONDAR)) {
      try {
        const r = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 }
        });
        if (r.supported && r.powerEfficient) comHardware.push(nome);
      } catch (_) { /* Navegador sem suporte a esta consulta: some da lista, sem chute. */ }
    }
    return comHardware;
  }

  function abrirDiagnostico() {
    $('diagnosticsPanel').classList.remove('hidden');
    collectDiagnostics();
  }

  // O vigia de conexao travada (sala.js) pede o painel quando conclui que a midia nao esta
  // passando: e nesse momento que o relatorio tem valor, nao dez minutos depois.
  document.addEventListener('room-diagnostics-request', () => {
    if ($('diagnosticsPanel').classList.contains('hidden')) abrirDiagnostico();
  });

  async function collectDiagnostics() {
    if (collecting) return;
    collecting = true;
    try {
      const sala = transporte?.sala;
      const estado = sala?.state || 'sem conexão';
      const lines = ['Nexo · diagnóstico de mídia',
        `Navegador: ${navigator.userAgent}`,
        `Contexto seguro: ${window.isSecureContext ? 'sim' : 'não'}`,
        `Sinalização: ${socket?.connected ? 'conectada' : 'desconectada'}`,
        `Servidor de mídia: ${estado}`,
        `Codec de vídeo escolhido: ${codecDeVideoEscolhido()}`,
        `Vídeo no palco: ${stageVideo.videoWidth} × ${stageVideo.videoHeight}; ${stageVideo.paused ? 'pausado' : 'reproduzindo'}; readyState=${stageVideo.readyState}`,
        `Reprodução bloqueada: ${midiasBloqueadas.size} elemento(s)`,
        'Revisão de mídia: sfu-1'];

      const comHardware = await codificadoresPorHardware();
      if (comHardware === null) {
        lines.push('Codificação por hardware: este navegador não sabe informar.');
      } else if (comHardware.length) {
        lines.push(`Codificação por hardware disponível para: ${comHardware.join(', ')}.`);
      } else {
        lines.push('Codificação por hardware: NENHUM codec. Quem codifica é o processador,'
          + ' e isso pesa no computador de quem transmite — inclusive nos jogos. Não é'
          + ' ajustável por aqui: confira "Video Encode" em chrome://gpu, o driver de vídeo'
          + ' e adaptadores de vídeo virtuais (Parsec, monitores USB) que possam estar no'
          + ' caminho.');
      }

      let recebidos = 0, index = 0;
      const conectado = estado === 'connected';

      // Estatisticas vem por faixa, pela API publica do cliente: o que esta SENDO enviado
      // daqui e o que esta chegando de cada participante.
      const faixasLocais = Object.entries(publicacoesLocais)
        .filter(([, publicacao]) => publicacao?.track?.getRTCStatsReport)
        .map(([fonte, publicacao]) => [`enviando ${fonte}`, publicacao.track]);
      const faixasRemotas = [];
      for (const par of peers.values()) {
        par.publicacoes.forEach(publicacao => {
          if (publicacao.track?.getRTCStatsReport) faixasRemotas.push([`recebendo ${RoomTransport.fonteDaPublicacao(publicacao) || '?'} de ${par.name}`, publicacao.track]);
        });
      }

      let rotaImpressa = false;
      for (const [rotulo, faixa] of [...faixasLocais, ...faixasRemotas]) {
        let stats;
        try { stats = await faixa.getRTCStatsReport(); } catch (_) { continue; }
        if (!stats) continue;
        lines.push('', `${rotulo}:`);
        stats.forEach(item => {
          // A rota e a mesma para todas as faixas do mesmo transporte: basta uma vez.
          if (!rotaImpressa && item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) {
            const local = stats.get(item.localCandidateId);
            lines.push(`  Rota: ${local?.candidateType || 'não informada'} por ${local?.protocol || '?'}; latência: ${item.currentRoundTripTime != null ? Math.round(item.currentRoundTripTime * 1000) + ' ms' : 'não informada'}`);
            rotaImpressa = true;
          }
          if (item.type === 'inbound-rtp' && item.kind === 'video') {
            recebidos += item.framesDecoded || 0;
            lines.push(`  ${stats.get(item.codecId)?.mimeType || 'codec não informado'}; bytes=${item.bytesReceived ?? '?'}; quadros decodificados=${item.framesDecoded ?? '?'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}`);
            lines.push(`  keyframes=${item.keyFramesDecoded ?? '?'}; descartados=${item.framesDropped ?? '?'}; PLI=${item.pliCount ?? '?'}; decodificador=${item.decoderImplementation || 'não informado'}; economia de energia=${describeEfficiency(item.powerEfficientDecoder)}`);
          }
          // Do lado de quem envia, e aqui que se ve se a GPU esta sendo usada de verdade.
          if (item.type === 'outbound-rtp' && item.kind === 'video') {
            lines.push(`  Camada ${item.rid || 'única'}: ${stats.get(item.codecId)?.mimeType || 'codec não informado'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}; limitado por=${item.qualityLimitationReason || 'nada'}`);
            lines.push(`  codificador=${item.encoderImplementation || 'não informado'}; economia de energia=${describeEfficiency(item.powerEfficientEncoder)}`);
          }
        });
      }

      for (const par of peers.values()) {
        lines.push('', `Participante ${++index}: ${par.pc.connectionState}`);
        lines.push(`Fontes anunciadas: câmera=${Boolean(par.state.camera)}, tela=${Boolean(par.state.screen)}, áudio de tela=${Boolean(par.state.screenAudio)}`);
        par.publicacoes.forEach(publicacao => {
          const faixa = publicacao.track?.mediaStreamTrack;
          lines.push(`  Faixa ${publicacao.kind}: ${RoomTransport.fonteDaPublicacao(publicacao) || 'fonte desconhecida'}; ${faixa ? faixa.readyState : 'sem faixa'}; muda=${publicacao.isMuted}; inscrita=${publicacao.isSubscribed}`);
        });
      }

      let summary = !socket?.connected ? 'O servidor está desconectado. Confira o endereço e se ele está ligado.'
        : !conectado ? 'A sala não está conectada ao servidor de mídia. Sem ele o chat funciona, mas ninguém vê nem ouve ninguém — confira se o processo do servidor de mídia está no ar.'
        : !peers.size ? 'Você está conectado ao servidor de mídia. O diagnóstico de recepção aparece quando outra pessoa entrar.'
        : midiasBloqueadas.size ? 'O navegador bloqueou a reprodução. Feche este painel e toque em Ativar reprodução.'
        : recebidos > 0 ? 'Há quadros de vídeo decodificados. Se a imagem não aparece, feche este painel e tente Reproduzir vídeo.'
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
