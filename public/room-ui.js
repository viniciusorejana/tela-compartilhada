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

  // A barra vale por si -- lista, convite, perfil -- mas nem sempre. Quem esta assistindo
  // uma tela quer o palco maior sem entrar no teatro, que apaga o chat junto. Recolher e a
  // terceira posicao entre "tudo" e "so o palco", e a escolha fica gravada.
  //
  // O mesmo botao serve a duas gestualidades diferentes, porque a barra e duas coisas
  // diferentes: no celular ela e uma gaveta sobreposta, que o botao abre e fecha; no
  // desktop ela e uma coluna do grid, e o botao so aparece quando ela esta recolhida, para
  // traze-la de volta. Um estado unico para os dois faria o botao mentir numa das larguras.
  const CHAVE_DA_BARRA = 'nexoBarraRecolhida';
  const estreita = window.matchMedia('(max-width:700px)');
  const telaEstreita = () => estreita.matches;

  // Um botao so, e ele fica no TOPO -- nunca dentro da barra. A primeira versao tinha um
  // botao proprio no cabecalho da barra, e o cabecalho e um link que sai da sala: quem
  // errasse o alvo por alguns pixels caia fora da conversa. Alvo pequeno em cima de acao
  // destrutiva e armadilha, por melhor que fique.
  function rotularToggle() {
    const botao = $('sidebarToggle');
    botao.title = telaEstreita()
      ? 'Abrir lista de participantes'
      : appRoot.classList.contains('barra-recolhida') ? 'Mostrar a barra lateral' : 'Recolher a barra lateral';
    botao.setAttribute('aria-label', botao.title);
  }

  function definirBarraRecolhida(recolhida, gravar) {
    appRoot.classList.toggle('barra-recolhida', recolhida);
    if (!telaEstreita()) $('sidebarToggle').setAttribute('aria-expanded', String(!recolhida));
    rotularToggle();
    if (gravar === false) return;
    try { localStorage.setItem(CHAVE_DA_BARRA, recolhida ? '1' : '0'); } catch (_) { /* Vale so nesta aba. */ }
  }

  try {
    if (localStorage.getItem(CHAVE_DA_BARRA) === '1') definirBarraRecolhida(true, false);
  } catch (_) { /* Sem armazenamento, a barra comeca aberta -- que e o padrao. */ }
  rotularToggle();
  // O mesmo botao quer dizer coisas diferentes nas duas larguras: atravessar o limite sem
  // reescrever o rotulo deixaria "Recolher a barra lateral" num botao que abre uma gaveta.
  estreita.addEventListener('change', rotularToggle);

  // A plateia e uma preferencia apenas desta pessoa. Ela nao altera publicacao, destaque ou
  // o que os demais veem, e permanece independente de teatro, chat e barra lateral.
  const CHAVE_DA_PLATEIA = 'nexoPlateiaOculta';
  function definirPlateiaOculta(oculta, gravar = true) {
    appRoot.classList.toggle('plateia-oculta', oculta);
    const botao = $('audienceToggle');
    botao.setAttribute('aria-pressed', String(oculta));
    botao.title = oculta ? 'Mostrar plateia' : 'Ocultar plateia';
    botao.setAttribute('aria-label', botao.title);
    if (gravar) {
      try { localStorage.setItem(CHAVE_DA_PLATEIA, oculta ? '1' : '0'); } catch (_) { /* Preferencia desta aba. */ }
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  try { definirPlateiaOculta(localStorage.getItem(CHAVE_DA_PLATEIA) === '1', false); }
  catch (_) { definirPlateiaOculta(false, false); }
  $('audienceToggle').onclick = () => definirPlateiaOculta(!appRoot.classList.contains('plateia-oculta'));

  $('sidebarToggle').onclick = () => {
    if (!telaEstreita()) { definirBarraRecolhida(!appRoot.classList.contains('barra-recolhida')); return; }
    const open = appRoot.classList.toggle('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', String(open));
  };

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'invite') copyLinkBtn.click();
    if (action === 'chat') { closeSidebar(); abrirChat(); }
    if (action === 'musica') { closeSidebar(); window.NexoMusica?.abrir(); }
    if (action === 'soundboard') { closeSidebar(); window.NexoSoundboard?.abrir(); }
    // "Sala de voz" fecha a coluna lateral inteira, qualquer que seja o canal aberto nela.
    if (action === 'room') { closeSidebar(); window.NexoMusica?.fechar(); fecharChat(); }
    if (['chat', 'room', 'musica'].includes(action)) window.NexoMusica?.marcarSidebar();
    if (action === 'devices') devicesBtn.click();
    if (action === 'diagnostics') abrirDiagnostico();
    if (action === 'sugestao') { closeSidebar(); $('sugestaoPanel').classList.remove('hidden'); $('sugestaoTexto').focus(); }
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
    pintarAvatar($('selfAvatar'), myName || '?', perfilDe('self'));
    $('selfState').textContent = !joined ? 'Pronto para entrar' : micMuted ? 'Microfone desligado' : 'Microfone ligado';
    for (const id of ['memberTotal', 'sidebarCount', 'tileCount']) $(id).textContent = total;
    const live = [...peers.values()].filter(p => p.state.screen).length + Number(Boolean(screenStream));
    $('sessionBadge').textContent = live ? `${live} ${live === 1 ? 'TELA AO VIVO' : 'TELAS AO VIVO'}` : 'SALA DE VOZ';
    $('sessionBadge').classList.toggle('live', live > 0);
    // O cartao do topo da barra lateral conta o que esta acontecendo agora. Antes eram tres
    // blocos separados (uma frase de efeito, um botao e um "mande um convite") dizendo a
    // mesma coisa em lugares diferentes.
    $('missionTitle').textContent = !joined ? 'Entrando na sala' : total > 1 ? `${total} pessoas na sala` : 'Só você por aqui';
    $('missionText').textContent = !joined ? 'Um instante.'
      : live ? `${live} ${live === 1 ? 'tela ao vivo agora.' : 'telas ao vivo agora.'}`
      : total > 1 ? 'Ninguém transmitindo ainda.' : 'Chame alguém para a sala.';
    const members = joined ? [{ id: 'self', name: myName, state: meuEstado() }, ...peers.values()] : [];
    // O perfil entra na assinatura porque ele chega pela sinalização, depois de a pessoa já
    // estar na lista pela mídia: sem isso a cor escolhida só apareceria na próxima mudança.
    const signature = JSON.stringify(members.map(p => [p.id, p.name, p.state, Boolean(p.semConexao), perfilDe(p.id)]));
    if (signature !== memberSignature) {
      memberSignature = signature;
      $('memberList').replaceChildren(...members.map(person => {
        const row = document.createElement('div');
        row.className = 'member';
        row.dataset.memberId = person.id;
        const avatar = document.createElement('span');
        avatar.className = 'member-avatar';
        pintarAvatar(avatar, person.name, perfilDe(person.id));
        const name = document.createElement('span');
        name.className = 'member-name';
        name.textContent = person.name + (person.id === 'self' ? ' (você)' : '');
        const state = document.createElement('span');
        // Quem perdeu a conexao ainda aparece, mas dito: some sozinho se nao voltar.
        state.className = person.semConexao ? 'member-state' : person.state.screen ? 'member-live' : 'member-state';
        const presencas = { hand: '✋', brb: '☕', gaming: '🎮', quiet: '🔇' };
        const nomesDePresenca = { hand: 'Quer falar', brb: 'Volto já', gaming: 'Em jogo', quiet: 'Sem falar' };
        state.textContent = person.semConexao ? 'sem conexão' : person.state.screen ? 'LIVE' : presencas[person.state.presenca] || (person.state.micMuted ? '' : 'voz');
        if (nomesDePresenca[person.state.presenca]) {
          state.title = nomesDePresenca[person.state.presenca];
          state.setAttribute('aria-label', nomesDePresenca[person.state.presenca]);
        }
        row.append(avatar, name, state);
        // Um selo não come o outro: quem transmite TAMBÉM pode estar mudo, e era justamente
        // essa combinação que a lista escondia — o "LIVE" ocupava o lugar do microfone e a
        // pergunta "por que ela não responde?" ficava sem resposta aqui.
        if (person.state.micMuted && !person.semConexao) {
          const mudo = document.createElement('span');
          mudo.className = 'member-mudo';
          mudo.title = 'Microfone desligado';
          mudo.setAttribute('role', 'img');
          mudo.setAttribute('aria-label', 'Microfone desligado');
          row.append(mudo);
        }
        return row;
      }));
    }
    document.querySelectorAll('.member').forEach(row => row.classList.toggle('falando', Boolean(tiles.get(row.dataset.memberId)?.root.classList.contains('falando'))));
    document.querySelectorAll('.avatar-wrap').forEach(element => {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Destacar ${element.parentElement.querySelector('.participant-name').textContent}`);
    });
    // Os controles de volume são rotulados pelo pintarControleDeVolume: ele sabe de quem é
    // o som, e alcança também os que vivem na grade, fora de qualquer .participant.
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

  // Três respostas, não duas.
  //
  // A lista era só de quem tinha hardware, e tudo o que sobrava virava uma frase única:
  // "NENHUM codec". Isso juntava três situações diferentes -- o navegador dizer que aquela
  // configuração não é eficiente, o navegador não saber responder, e a consulta estourar --
  // numa afirmação categórica sobre a máquina inteira. Nesta máquina a conclusão estava
  // certa (a medição está em docs/captura-de-tela.md), e é justamente por isso que ela
  // precisa ser dita com o alcance certo: o que foi perguntado foi UMA configuração, 1080p
  // a 30 quadros, e uma resposta "não eficiente" nela não é uma resposta sobre 720p, sobre
  // outro perfil ou sobre o WebCodecs -- que nesta mesma máquina aceita H.264 por hardware.
  // A resposta é guardada porque a pergunta não muda.
  //
  // O painel se redesenha a cada quatro segundos enquanto está aberto, e cada redesenho
  // refazia as quatro sondagens -- e sondar capacidade de codificação instancia
  // codificadores de teste. Quem abre o painel justamente para observar uma queda de
  // desempenho estava participando dela. A placa de vídeo da máquina não muda no meio da
  // transmissão; perguntar uma vez basta.
  let hardwareConhecido;
  async function codificadoresPorHardware() {
    if (hardwareConhecido !== undefined) return hardwareConhecido;
    hardwareConhecido = await sondarCodificadores();
    return hardwareConhecido;
  }

  // O painel de qualidade também precisa desta resposta, e ela não pode ser sondada duas
  // vezes: cada sondagem instancia codificadores de teste. Uma função só, memoizada, servindo
  // os dois lugares.
  window.NexoHardware = { codificadores: codificadoresPorHardware };

  async function sondarCodificadores() {
    if (!navigator.mediaCapabilities?.encodingInfo) return null;
    const porEstado = { hardware: [], software: [], desconhecido: [] };
    for (const [nome, contentType] of Object.entries(CODECS_PARA_SONDAR)) {
      try {
        const r = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType, width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 }
        });
        if (!r.supported) porEstado.software.push(nome);
        // `powerEfficient` ausente é desconhecido, não negativo: há navegador que suporta a
        // consulta e não preenche o campo.
        else if (r.powerEfficient === undefined) porEstado.desconhecido.push(nome);
        else if (r.powerEfficient) porEstado.hardware.push(nome);
        else porEstado.software.push(nome);
      } catch (_) { porEstado.desconhecido.push(nome); }
    }
    return porEstado;
  }

  // O texto do relatório, separado da coleta: a sondagem responde três coisas e a redação
  // precisa dizer as três sem virar um encadeado de `if` dentro do montador do relatório.
  function frasesDeHardware(porEstado, transmitindo) {
    if (porEstado === null) return ['Codificação por hardware: este navegador não sabe informar.'];
    const { hardware, software, desconhecido } = porEstado;
    const linhas = [];
    if (hardware.length) linhas.push(`Codificação por hardware disponível para: ${hardware.join(', ')}.`);
    if (software.length) {
      // O parágrafo sobre o custo de codificar só interessa a quem está codificando. Para
      // quem só assiste, ele era três linhas explicando um problema que não é dele -- e
      // ruído num painel é o que faz a informação que importa passar batida.
      linhas.push(`Sem codificação eficiente em 1080p/30 para: ${software.join(', ')}.`
        + (hardware.length || !transmitindo ? '' : ' Quem codifica é o processador, e isso pesa no computador de'
          + ' quem transmite — inclusive nos jogos. Não é ajustável por aqui: confira'
          + ' "Video Encode" em chrome://gpu, o driver de vídeo e adaptadores de vídeo'
          + ' virtuais (Parsec, monitores USB) que possam estar no caminho.'));
    }
    if (desconhecido.length) linhas.push(`Sem resposta do navegador para: ${desconhecido.join(', ')}.`);
    // A pergunta é sobre UMA configuração. Dizer isso evita que a resposta seja lida como
    // um veredito sobre a máquina.
    if (software.length || desconhecido.length) {
      linhas.push('A consulta foi de 1080p a 30 quadros em WebRTC: outra resolução, outro'
        + ' perfil ou outro caminho de codificação podem responder diferente.');
    }
    return linhas;
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

  // ---------- O relatório, agora em duas formas ----------
  //
  // Era uma forma só: um `<pre>` com tudo, dentro de um `<details>` fechado. Aquilo serve
  // muito bem para COLAR num chat e pedir ajuda, e continua existindo para isso. Mas é a
  // forma errada para a pergunta que traz alguém aqui -- "está funcionando? se não, o que
  // está errado?" -- porque obriga a ler sessenta linhas de números para descobrir qual
  // delas é a que importa.
  //
  // Os cartões respondem essa pergunta primeiro: cada um é uma área (a conexão, o seu
  // envio, o que chega de cada pessoa, esta máquina), e cada linha tem um estado com cor.
  // Quem quer o detalhe abre o relatório; quem quer saber se pode jogar, não precisa.
  const ESTADOS_DA_SALA = {
    connected: 'conectado', connecting: 'conectando', disconnected: 'desconectado',
    reconnecting: 'reconectando', signalReconnecting: 'restabelecendo a sinalização'
  };
  const cartoes = [];
  const cartao = titulo => { const c = { titulo, linhas: [] }; cartoes.push(c); return c; };
  const anotar = (c, rotulo, valor, estado) => { c.linhas.push({ rotulo, valor: String(valor), estado }); };

  function desenharCartoes() {
    const alvo = $('diagnosticsCards');
    alvo.textContent = '';
    for (const c of cartoes) {
      if (!c.linhas.length) continue;
      const caixa = document.createElement('section');
      caixa.className = 'diag-cartao';
      const titulo = document.createElement('h3');
      titulo.textContent = c.titulo;
      caixa.append(titulo);
      for (const linha of c.linhas) {
        const el = document.createElement('div');
        el.className = 'diag-linha' + (linha.estado ? ` diag-${linha.estado}` : '');
        const rotulo = document.createElement('span');
        rotulo.className = 'diag-rotulo';
        rotulo.textContent = linha.rotulo;
        const valor = document.createElement('span');
        valor.className = 'diag-valor';
        // `textContent` em tudo: aqui entram nomes de participantes, que são texto de quem
        // entrou na sala e nunca devem virar marcação.
        valor.textContent = linha.valor;
        el.append(rotulo, valor);
        caixa.append(el);
      }
      alvo.append(caixa);
    }
  }

  async function collectDiagnostics() {
    if (collecting) return;
    collecting = true;
    cartoes.length = 0;
    try {
      const sala = transporte?.sala;
      const estado = sala?.state || 'sem conexão';
      const conexao = cartao('Conexão');
      anotar(conexao, 'Sinalização', socket?.connected ? 'conectada' : 'desconectada', socket?.connected ? 'ok' : 'problema');
      // Esta é a única latência que existe SEMPRE: ela não depende de haver faixa de mídia, e
      // quem entrou só para ouvir não tem nenhuma. Acima de 150 ms a conversa já ganha aquele
      // atraso que faz todo mundo falar junto -- é onde vale avisar, não em qualquer número.
      if (latenciaDaSinalizacao != null) {
        anotar(conexao, 'Latência até o servidor', `${latenciaDaSinalizacao} ms`, latenciaDaSinalizacao > 150 ? 'alerta' : 'ok');
      } else {
        anotar(conexao, 'Latência até o servidor', socket?.connected ? 'medindo…' : 'sem conexão', socket?.connected ? null : 'problema');
      }
      // O estado vem em inglês da biblioteca, e este painel é lido por quem não está
      // depurando nada -- "signalReconnecting" não diz a ninguém que a sala está voltando.
      anotar(conexao, 'Servidor de mídia', ESTADOS_DA_SALA[estado] || estado, estado === 'connected' ? 'ok' : estado === 'connecting' || estado === 'reconnecting' ? 'alerta' : 'problema');
      if (!window.isSecureContext) anotar(conexao, 'Contexto seguro', 'não', 'problema');
      const lines = ['Nexo · diagnóstico de mídia',
        `Navegador: ${navigator.userAgent}`,
        `Contexto seguro: ${window.isSecureContext ? 'sim' : 'não'}`,
        `Sinalização: ${socket?.connected ? 'conectada' : 'desconectada'}`,
        `Latência até o servidor: ${latenciaDaSinalizacao != null ? latenciaDaSinalizacao + ' ms (ida e volta pela sinalização)' : 'não medida'}`,
        `Servidor de mídia: ${estado}`,
        `Codec de vídeo escolhido: ${codecDeVideoEscolhido()} (a câmera vai sempre em H.264)`,
        // Por onde o áudio do sistema está vindo, quando está. Pelo "agente" ele vai do
        // programa nativo direto para esta página; pelo "helper" ele passa pelo processo do
        // servidor -- que só é oferecido quando a página está aberta nesta mesma máquina,
        // então é tráfego de loopback, não de internet. Mesmo assim são ~1,4 Mbps de PCM sem
        // compressão em cada sentido, mais cem mensagens por segundo, e nada na tela dizia
        // qual dos dois estava no ar.
        `Áudio do sistema: ${typeof planoDeAudio === 'function' ? planoDeAudio() : 'desconhecido'}`,
        `Vídeo no palco: ${stageVideo.videoWidth} × ${stageVideo.videoHeight}; ${stageVideo.paused ? 'pausado' : 'reproduzindo'}; readyState=${stageVideo.readyState}`,
        `Reprodução bloqueada: ${midiasBloqueadas.size} elemento(s)`,
        'Revisão de mídia: sfu-1'];

      // O que aconteceu com a página em segundo plano — a pergunta que só aparece no
      // celular, onde não há DevTools à mão. Isto era despejado na barra de status da sala
      // a cada volta para a aba: um texto de depuração no lugar reservado a avisos de uso.
      // O histórico guarda até 300 linhas; o que interessa a quem abre o painel são as
      // últimas, de perto do problema.
      const segundoPlano = (window.verDiagnosticoSegundoPlano?.() || '').trim().split('\n').slice(-25);
      if (segundoPlano[0]) lines.push('', 'Eventos em segundo plano:', ...segundoPlano);

      // Quem está com tela ou câmera no ar é quem codifica, e só para ele o custo importa.
      const transmitindo = Boolean(publicacoesLocais.screen || publicacoesLocais.camera);
      lines.push(...frasesDeHardware(await codificadoresPorHardware(), transmitindo));

      let recebidos = 0, index = 0;
      const conectado = estado === 'connected';

      // Estatisticas vem por faixa, pela API publica do cliente: o que esta SENDO enviado
      // daqui e o que esta chegando de cada participante.
      // Os rótulos dos cartões saem em português; os do relatório técnico continuam com os
      // nomes internos, que é o que ajuda quem for ler o código depois de receber um colado
      // num chat.
      const NOME_DA_FONTE = { screen: 'sua tela', camera: 'sua câmera', mic: 'seu microfone', screenAudio: 'o som da sua tela' };
      const faixasLocais = Object.entries(publicacoesLocais)
        .filter(([, publicacao]) => publicacao?.track?.getRTCStatsReport)
        .map(([fonte, publicacao]) => [`enviando ${fonte}`, publicacao.track, `Enviando ${NOME_DA_FONTE[fonte] || fonte}`]);
      const faixasRemotas = [];
      for (const par of peers.values()) {
        par.publicacoes.forEach(publicacao => {
          if (!publicacao.track?.getRTCStatsReport) return;
          const fonte = RoomTransport.fonteDaPublicacao(publicacao) || '?';
          const humano = { screen: 'a tela', camera: 'a câmera', micAudio: 'a voz', screenAudio: 'o som da tela' }[fonte] || fonte;
          faixasRemotas.push([`recebendo ${fonte} de ${par.name}`, publicacao.track, `Recebendo ${humano} de ${par.name}`]);
        });
      }

      let rotaImpressa = false;
      // Um cartão por origem, criado só quando há o que pôr nele: um painel com seções
      // vazias é pior do que um painel curto.
      const cartoesPorRotulo = new Map();
      const cartaoDe = rotulo => {
        if (!cartoesPorRotulo.has(rotulo)) cartoesPorRotulo.set(rotulo, cartao(rotulo));
        return cartoesPorRotulo.get(rotulo);
      };
      for (const [rotulo, faixa, titulo] of [...faixasLocais, ...faixasRemotas]) {
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
            anotar(conexao, 'Rota', `${local?.candidateType || 'não informada'} por ${local?.protocol || '?'}`);
            const ms = item.currentRoundTripTime != null ? Math.round(item.currentRoundTripTime * 1000) : null;
            // A latência da MÍDIA, que só existe quando há faixa no ar. Ela tem nome próprio
            // porque convive com a da sinalização, logo acima, e as duas costumam divergir:
            // esta vai por UDP, e a outra por WebSocket, onde uma retransmissão de TCP vira
            // um pico que o fluxo de mídia não teria.
            if (ms != null) anotar(conexao, 'Latência da mídia', `${ms} ms`, ms > 150 ? 'alerta' : 'ok');
          }
          if (item.type === 'inbound-rtp' && item.kind === 'video') {
            recebidos += item.framesDecoded || 0;
            lines.push(`  ${stats.get(item.codecId)?.mimeType || 'codec não informado'}; bytes=${item.bytesReceived ?? '?'}; quadros decodificados=${item.framesDecoded ?? '?'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}`);
            lines.push(`  keyframes=${item.keyFramesDecoded ?? '?'}; descartados=${item.framesDropped ?? '?'}; PLI=${item.pliCount ?? '?'}; decodificador=${item.decoderImplementation || 'não informado'}; economia de energia=${describeEfficiency(item.powerEfficientDecoder)}`);
            // "Travadinha" tem nome no relatório do navegador: congelamento. Sem estas duas
            // linhas, quem sente a imagem tropeçar não tinha o que mostrar -- só a
            // impressão. Com elas dá para separar o que congela (imagem parada) do que
            // chega picotado (quadros descartados), que têm causas diferentes.
            lines.push(`  congelamentos=${item.freezeCount ?? '?'} (${item.totalFreezesDuration != null ? item.totalFreezesDuration.toFixed(2) + ' s no total' : 'duração não informada'}); pausas=${item.pauseCount ?? '?'}`);
            lines.push(`  atraso do buffer=${item.jitterBufferDelay != null && item.jitterBufferEmittedCount ? Math.round(item.jitterBufferDelay / item.jitterBufferEmittedCount * 1000) + ' ms' : '?'}; jitter=${item.jitter != null ? Math.round(item.jitter * 1000) + ' ms' : '?'}; perdidos=${item.packetsLost ?? '?'}`);
            const c = cartaoDe(titulo);
            anotar(c, 'Imagem', `${item.frameWidth || '?'}×${item.frameHeight || '?'} · ${Math.round(item.framesPerSecond || 0)} fps`,
              item.frameHeight ? 'ok' : 'alerta');
            const mime = stats.get(item.codecId)?.mimeType || '?';
            anotar(c, 'Codec', (typeof nomeDoCodec === 'function' ? nomeDoCodec(mime) : mime.replace(/^video\//i, ''))
              + (item.powerEfficientDecoder === true ? ' · decodificado em hardware' : item.powerEfficientDecoder === false ? ' · decodificado em software' : ''));
            // Congelamento é a "travadinha" com nome de relatório. Um é normal ao entrar;
            // uma dúzia é o que a pessoa está sentindo e não sabia nomear.
            const congela = item.freezeCount || 0;
            anotar(c, 'Congelamentos', congela + (item.totalFreezesDuration ? ` · ${item.totalFreezesDuration.toFixed(1)} s no total` : ''),
              congela > 3 ? 'alerta' : congela ? 'neutro' : 'ok');
            const perdidos = item.packetsLost || 0;
            anotar(c, 'Pacotes perdidos', perdidos, perdidos > 50 ? 'alerta' : 'ok');
          }
          // Música e voz sofrem de coisas diferentes na mesma rede, e o áudio é onde um
          // engasgo aparece primeiro: a imagem tem quadros para descartar, o som não.
          if (item.type === 'inbound-rtp' && item.kind === 'audio') {
            const buffer = item.jitterBufferDelay != null && item.jitterBufferEmittedCount
              ? Math.round(item.jitterBufferDelay / item.jitterBufferEmittedCount * 1000) + ' ms' : '?';
            lines.push(`  Áudio: buffer=${buffer}; jitter=${item.jitter != null ? Math.round(item.jitter * 1000) + ' ms' : '?'}; perdidos=${item.packetsLost ?? '?'}; remendos=${item.concealedSamples ?? '?'}`);
          }
          // Do lado de quem envia, e aqui que se ve se a GPU esta sendo usada de verdade.
          if (item.type === 'outbound-rtp' && item.kind === 'video') {
            lines.push(`  Camada ${item.rid || 'única'}: ${stats.get(item.codecId)?.mimeType || 'codec não informado'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}; limitado por=${item.qualityLimitationReason || 'nada'}`);
            lines.push(`  codificador=${item.encoderImplementation || 'não informado'}; economia de energia=${describeEfficiency(item.powerEfficientEncoder)}`);
            const c = cartaoDe(titulo);
            // O rid ("q", "h", "f") é nome de protocolo e não diz nada a quem lê. A altura
            // diz: "camada 360p" é a pequena, e quem abriu o painel sabe o que isso significa
            // depois de ler uma vez. O rid continua no relatório técnico.
            //
            // Sem altura, o rid NÃO é a saída -- e este era o furo. Uma camada desligada pelo
            // dynacast, ou que ainda não produziu o primeiro quadro, não tem `frameHeight`, e
            // ali o painel voltava a mostrar "Camada h". Quem não tem medida ainda é descrita
            // pelo que se sabe dela: que ela existe e ainda não entregou nada.
            anotar(c, item.frameHeight ? `Camada ${item.frameHeight}p` : 'Camada sem medida ainda',
              `${item.frameWidth || '?'}×${item.frameHeight || '?'} · ${Math.round(item.framesPerSecond || 0)} fps`
              + (item.active === false ? ' · desligada' : ''),
              item.active === false ? 'neutro' : undefined);
            // O motivo do limite, em português e só quando existe. "nada" não merece linha:
            // a ausência de problema não é informação que precise de espaço.
            const motivo = item.qualityLimitationReason;
            if (motivo && motivo !== 'none') {
              anotar(c, 'Limitado por', motivo === 'cpu' ? 'processador' : motivo === 'bandwidth' ? 'banda de subida' : motivo, 'alerta');
            }
            // Onde a codificação está acontecendo é a pergunta que decide se vale mexer em
            // resolução ou se o problema está fora do Nexo.
            if (item.powerEfficientEncoder !== undefined) {
              anotar(c, 'Codificação', item.powerEfficientEncoder ? 'em hardware' : 'em software (pesa no processador)',
                item.powerEfficientEncoder ? 'ok' : 'alerta');
            }
          }
          // A fonte, antes de qualquer codificação. Comparada com a camada acima, ela diz se
          // uma queda de quadros começou na captura ou na codificação -- e as duas pedem
          // coisas opostas de quem está tentando resolver.
          if (item.type === 'media-source' && item.kind === 'video') {
            lines.push(`  Fonte: ${item.width || '?'}×${item.height || '?'}; FPS capturado=${item.framesPerSecond ?? '?'}`);
            anotar(cartaoDe(titulo), 'Fonte capturando', `${item.width || '?'}×${item.height || '?'} · ${Math.round(item.framesPerSecond || 0)} fps`);
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

      // Um cartão para o que é desta máquina e não muda com a rede. Vem por último porque é
      // o que menos muda -- e o que a pessoa consulta uma vez, não a cada quatro segundos.
      const maquina = cartao('Este computador');
      const hw = await codificadoresPorHardware();
      if (hw === null) anotar(maquina, 'Codificação por hardware', 'o navegador não sabe informar', 'neutro');
      else {
        anotar(maquina, 'Com hardware', hw.hardware.length ? hw.hardware.join(', ') : 'nenhum em 1080p/30',
          hw.hardware.length ? 'ok' : 'alerta');
        if (hw.software.length) anotar(maquina, 'No processador', hw.software.join(', '), 'neutro');
        if (hw.desconhecido.length) anotar(maquina, 'Sem resposta', hw.desconhecido.join(', '), 'neutro');
      }
      anotar(maquina, 'Codec escolhido', `${codecDeVideoEscolhido()} na tela · H.264 na câmera`);
      if (typeof planoDeAudio === 'function') anotar(maquina, 'Áudio do sistema', planoDeAudio());
      if (midiasBloqueadas.size) anotar(maquina, 'Reprodução bloqueada', `${midiasBloqueadas.size} elemento(s)`, 'problema');
      desenharCartoes();

      let summary = !socket?.connected ? 'O servidor está desconectado. Confira o endereço e se ele está ligado.'
        : !conectado ? 'A sala não alcança o servidor de mídia: o chat funciona, mas ninguém vê nem ouve ninguém.'
        : !peers.size ? 'Tudo conectado. O diagnóstico de recepção aparece quando outra pessoa entrar.'
        : midiasBloqueadas.size ? 'O navegador bloqueou a reprodução. Feche este painel e toque em Ativar reprodução.'
        : recebidos > 0 ? 'O vídeo está chegando e sendo decodificado. Se a imagem não aparece, tente Reproduzir vídeo.'
        : 'Tudo conectado. Se alguém já transmite, aguarde os primeiros quadros.';
      if (pinned?.id === 'self') summary = 'O palco mostra sua própria imagem. Para conferir a recepção, destaque outro participante.';
      report = lines.join('\n');
      $('diagnosticsSummary').textContent = summary;
      $('diagnosticsReport').textContent = report;
    } finally { collecting = false; }
  }
  setInterval(() => { if (!$('diagnosticsPanel').classList.contains('hidden')) collectDiagnostics(); }, 4000);
  // ---------- Mandar o relato, em vez de copiar e procurar onde colar ----------
  //
  // O botão de copiar FICA. Ele continua sendo o caminho de quem quer pedir ajuda num chat, e
  // é o único que funciona quando o próprio servidor é o problema -- que é justamente o caso
  // em que um POST não chegaria a lugar nenhum.
  //
  // O protocolo devolvido é mostrado e não some: sem ele a pessoa não tem como falar do
  // relato depois, e quem recebe não tem como ligar uma conversa a um registro.
  // Um caminho de envio, dois formulários. O que muda entre eles é o tipo, se o relatório
  // técnico vai anexado, e o que dizer quando o campo está vazio -- o resto (cota, protocolo,
  // erro, limpar o campo) é idêntico, e duplicá-lo garantiria que um dos dois envelhecesse.
  function ligarEnvio({ campo, botao, aviso, tipo, comRelatorio, faltouTexto, aoFalhar }) {
    const dizer = (texto, estado) => {
      aviso.textContent = texto;
      aviso.className = `relato-status${estado ? ` ${estado}` : ''}`;
    };
    botao.onclick = async () => {
      const mensagem = campo.value.trim();
      if (!mensagem) { dizer(faltouTexto, 'alerta'); campo.focus(); return; }
      botao.disabled = true;
      dizer('Enviando…');
      try {
        const resposta = await fetch('/api/relato', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(window.NexoSessao?.cabecalhos() || {}) },
          body: JSON.stringify({ tipo, mensagem, relatorio: comRelatorio ? report : '' })
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok || !dados.ok) throw new Error(dados.error || `O servidor respondeu ${resposta.status}.`);
        // O campo é limpo para não reenviar o mesmo texto por engano, e o protocolo fica na
        // tela até o painel ser fechado.
        campo.value = '';
        dizer(`Enviado. Seu protocolo é ${dados.protocolo} — anote para poder falar disto depois.`, 'ok');
      } catch (erro) {
        dizer(`Não foi possível enviar: ${erro.message}${aoFalhar}`, 'problema');
      } finally {
        botao.disabled = false;
      }
    };
  }

  ligarEnvio({
    campo: $('relatoTexto'), botao: $('sendRelatoBtn'), aviso: $('relatoStatus'),
    tipo: 'problema', comRelatorio: true,
    // O relatório sozinho já seria um relato útil -- "não funciona e não sei dizer mais" é
    // informação legítima --, mas pedir a frase é o que transforma sessenta linhas de números
    // em algo que se consegue investigar.
    faltouTexto: 'Escreva em uma linha o que aconteceu. Sem isso, o relatório é só números.',
    // Aqui a alternativa importa mais do que o erro: se o envio falhou, é bem possível que o
    // problema seja exatamente o servidor, e o caminho que sobra é copiar.
    aoFalhar: ' Use "Copiar diagnóstico" e mande por outro caminho.'
  });

  ligarEnvio({
    campo: $('sugestaoTexto'), botao: $('sendSugestaoBtn'), aviso: $('sugestaoStatus'),
    // Sem relatório: uma sugestão não tem diagnóstico, e anexar sessenta linhas de medições a
    // "seria bom poder voltar na mesma sala" só encheria o arquivo.
    tipo: 'sugestao', comRelatorio: false,
    faltouTexto: 'Escreva o que você queria que existisse, ou o que incomodou.',
    aoFalhar: ' Tente de novo em instantes.'
  });

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
    const closingDialog = activeDialog;
    appRoot.inert = Boolean(next);
    if (next) {
      if (!activeDialog) previousFocus = document.activeElement;
      activeDialog = next;
      (next.querySelector('input:not([type="file"])') || focusable(next)[0])?.focus();
    } else {
      activeDialog = null;
      const currentFocus = document.activeElement;
      const focusWasReleased = !currentFocus
        || currentFocus === document.body
        || currentFocus === document.documentElement
        || closingDialog?.contains(currentFocus);
      // A observação da classe do modal é assíncrona. Se a pessoa já clicou no
      // compositor enquanto o callback aguardava, não devolva o foco ao botão
      // que abriu o painel — isso fazia o campo parecer se desselecionar sozinho.
      if (focusWasReleased && previousFocus?.isConnected) previousFocus.focus();
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
