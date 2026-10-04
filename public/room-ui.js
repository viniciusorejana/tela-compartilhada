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
  // 760 px, a fronteira do celular (docs/interface.md): abaixo dela a barra é gaveta (sala.css).
  const estreita = window.matchMedia('(max-width:760px)');
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

  // Lateral, chat e plateia deslizam (sala.css), e o palco muda de tamanho DURANTE o movimento.
  // Quem mede o palco -- o zoom, o arrasto, a grade -- ouve `resize`; ele vai de novo no fim do
  // deslize, quando o tamanho é o definitivo.
  appRoot.addEventListener('transitionend', evento => {
    const fim = (evento.target === appRoot && evento.propertyName === 'grid-template-columns')
      || (evento.target.classList?.contains('participants-section') && evento.propertyName === 'grid-template-rows');
    if (fim) window.dispatchEvent(new Event('resize'));
  });

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
  // O seletor de emojis do chat da sala: o emoji entra onde está o cursor (e o foco volta ao campo). O canal
  // de música não tem esse botão -- ali se pede música, e emoji no pedido só atrapalharia a busca.
  $('chatEmojiBtn').addEventListener('click', () => {
    window.NexoEmojis?.abrir($('chatEmojiBtn'), { rotulo: 'Escolher um emoji', aoEscolher: emoji => window.NexoEmojis.inserir($('chatInput'), emoji) });
  });

  function renderRoom() {
    const joined = tiles.has('self');
    if (joined && !startedAt) startedAt = Date.now();
    const total = joined ? peers.size + 1 : 0;
    const connected = Boolean(joined && socket?.connected);
    const failed = [...peers.values()].some(p => ['failed', 'disconnected'].includes(p.pc.connectionState));
    document.querySelector('.connection-box').classList.toggle('connected', connected && !failed);
    $('connectionLabel').textContent = failed ? 'Conexão instável' : connected ? 'Conectado à sala' : joined ? 'Reconectando…' : 'Aguardando entrada';
    // O relógio conta desde a entrada que o SERVIDOR registrou, e não desde esta aba: um F5 ou
    // uma queda curta continuam a hora de conversa (tempo-sala.js). Antes da resposta dele, a
    // aba conta sozinha, e a troca não se nota.
    const desde = window.NexoTempo?.desdeDe('self') ?? startedAt;
    $('sessionClock').textContent = joined && desde ? `Você está há ${NexoTempo.relogio(Date.now() - desde)}` : 'Sua sessão começa aqui';
    $('selfName').textContent = myName || 'Seu perfil';
    // A borda (pintarAvatar) e o estilo do nome do cartão, para a pessoa se ver como a sala a vê.
    pintarAvatar($('selfAvatar'), myName || '?', perfilDe('self'));
    pintarStatusNoAvatar($('selfAvatar'), 'self');
    atualizarStatusDoCartaoAberto();
    window.NexoCartao?.estilizarNome($('selfName'), vitrineDe('self'));
    // Duas formas da mesma frase: a inteira onde ela cabe (a gaveta do celular) e a curta na lateral
    // do computador, onde "Microfone desligado" quebrava em duas linhas em qualquer largura
    // (sala.css, `container: eu`). A inteira fica no `title`.
    const [longo, curto] = !joined ? ['Pronto para entrar', 'Fora da sala'] : ensurdecido ? ['Ensurdecido', 'Ensurdecido'] : micMuted ? ['Microfone desligado', 'Mic mudo'] : ['Microfone ligado', 'Mic ligado'];
    const estadoEu = $('selfState');
    estadoEu.title = longo;
    estadoEu.querySelector('.estado-longo').textContent = longo;
    estadoEu.querySelector('.estado-curto').textContent = curto;
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
        pintarStatusNoAvatar(avatar, person.id);
        const name = document.createElement('span');
        name.className = 'member-name';
        // `rotuloDe` acrescenta um trecho do código só quando outro nome na sala é igual.
        name.textContent = rotuloDe(person.id) + (person.id === 'self' ? ' (você)' : '');
        window.NexoCartao?.estilizarNome(name, vitrineDe(person.id));
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        // O status (o ponto do avatar) entra no texto da linha quando diz algo: "disponível" é o normal.
        const statusDaLinha = statusDaPessoa(person.id);
        row.setAttribute('aria-label', `Ver o perfil de ${person.name}${statusDaLinha === 'online' ? '' : ` · ${window.NexoCartao?.NOMES_DOS_STATUS[statusDaLinha] || ''}`}`);
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
        // O tempo da pessoa fica escondido até o mouse passar pela linha (ou até a pessoa pedir,
        // na Aparência, para vê-lo sempre): numa lista de dez, dez relógios seriam ruído.
        const tempo = document.createElement('span');
        tempo.className = 'member-tempo';
        row.append(avatar, name, tempo, state);
        // Um selo não come o outro: quem transmite TAMBÉM pode estar mudo, e era justamente
        // essa combinação que a lista escondia — o "LIVE" ocupava o lugar do microfone e a
        // pergunta "por que ela não responde?" ficava sem resposta aqui.
        // Ensurdecido ocupa o mesmo lugar, com o fone cortado: quem ensurdece fecha o microfone
        // junto, e dois selos diriam a mesma coisa duas vezes.
        if ((person.state.micMuted || person.state.ensurdecido) && !person.semConexao) {
          const surdo = Boolean(person.state.ensurdecido);
          const mudo = document.createElement('span');
          mudo.className = surdo ? 'member-mudo ensurdecido' : 'member-mudo';
          mudo.title = surdo ? 'Ensurdecido: não está ouvindo a sala' : 'Microfone desligado';
          mudo.setAttribute('role', 'img');
          mudo.setAttribute('aria-label', mudo.title);
          row.append(mudo);
        }
        return row;
      }));
    }
    document.querySelectorAll('.member').forEach(row => {
      row.classList.toggle('falando', Boolean(tiles.get(row.dataset.memberId)?.root.classList.contains('falando')));
      // A linha não é redesenhada a cada segundo, só o texto do tempo dela.
      const tempo = row.querySelector('.member-tempo');
      const duracao = window.NexoTempo?.duracaoDe(row.dataset.memberId);
      if (tempo) {
        tempo.textContent = duracao == null ? '' : NexoTempo.curta(duracao);
        tempo.title = duracao == null ? '' : `Na sala há ${NexoTempo.extenso(duracao)}`;
      }
    });
    // O quadradinho da pessoa sem câmera não destaca nada: abre o perfil (sala.js) -- também
    // quando ela compartilha a tela, que tem o quadradinho dela. O nome embaixo abre o perfil sempre.
    document.querySelectorAll('.avatar-wrap').forEach(element => {
      const tile = element.closest('.participant');
      const nome = tile?.querySelector('.participant-name');
      if (!nome) return;
      const id = tile.dataset.id;
      const estado = tile.dataset.source === 'camera' ? (id === 'self' ? meuEstado() : peers.get(id)?.state) : null;
      const perfil = tile.dataset.source === 'camera' && !estado?.camera;
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      // Só o nome: o texto da linha inteira levava junto o do selo de dono, escondido ("Caioabriu a sala").
      const textoDoNome = tile.querySelector('.participant-nome')?.textContent || nome.textContent;
      element.setAttribute('aria-label', `${perfil ? 'Ver o perfil de' : 'Destacar'} ${textoDoNome}`);
      nome.tabIndex = 0;
      nome.setAttribute('role', 'button');
      nome.title = 'Ver o perfil';
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

  // A lista é redesenhada inteira quando muda, então o clique é ouvido no contêiner.
  $('memberList').addEventListener('click', event => {
    const row = event.target.closest('.member');
    if (row) abrirPerfil(row.dataset.memberId);
  });
  $('memberList').addEventListener('keydown', event => {
    const row = event.target.closest('.member');
    if (!row || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    abrirPerfil(row.dataset.memberId);
  });

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
          + ' “Video Encode” em chrome://gpu, o driver de vídeo e adaptadores de vídeo'
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

  // ---------- A tela por WebCodecs ----------
  //
  // Para quem lê o painel, a tela é UMA transmissão que sai por um de dois motores -- WebCodecs
  // ou WebRTC --, e não duas coisas lado a lado. Por isso o WebCodecs não tem cartão próprio: ele
  // escreve no mesmo "Enviando sua tela" e no mesmo "Recebendo a tela de…" que o WebRTC, com a
  // mesma forma de linha. Um cartão separado, ao lado de camadas RTP paradas, dava a impressão
  // de um caminho velho convivendo com um novo -- e de que algo estava desligado por engano.
  //
  // O cartão responde "está bom?" e "onde codifica?". O porquê de cada escolha, as camadas e os
  // contadores ficam no relatório técnico, que é o que se cola num chat.
  const PREFERENCIA_EM_TEXTO = { automatico: 'automática', sempre: 'forçar WebCodecs', desligada: 'só WebRTC' };
  const NOME_DO_CODEC_WC = codec => {
    const nome = String(codec || '').toLowerCase();
    return nome === 'h264' || nome.startsWith('avc1') ? 'H.264' : nome.startsWith('vp8') ? 'VP8' : nome.toUpperCase();
  };
  const mbps = bps => `${(bps / 1e6).toFixed(1).replace('.', ',')} Mbps`;
  const medianaDe = valores => {
    if (!valores.length) return null;
    const ordenados = [...valores].sort((a, b) => a - b);
    return ordenados[Math.floor(ordenados.length / 2)];
  };

  function anotarEnvioPorWebCodecs(c, envio) {
    anotar(c, 'Transmissão', `WebCodecs · ${NOME_DO_CODEC_WC(envio.codec)}${envio.transporte === 'rtp' ? ' pelo RTP' : ''}`, 'ok');
    const camadas = envio.camadas;
    if (!camadas.length) {
      anotar(c, 'Imagem', 'parada até alguém assistir', 'neutro');
      return;
    }
    const pelaPlaca = camadas.some(camada => camada.hardware);
    anotar(c, 'Onde codifica', pelaPlaca ? 'na placa de vídeo' : 'no processador', pelaPlaca ? 'ok' : 'alerta');
    for (const camada of camadas) {
      anotar(c, camada.camada === 'alta' ? 'Imagem' : 'Imagem leve',
        `${camada.largura}×${camada.altura} · ${Math.round(camada.fps)} fps · ${mbps(camada.bps)}`,
        camada.saidaApertada || camada.codificadorApertado ? 'alerta' : 'ok');
    }
    if (camadas.some(camada => camada.codificadorApertado)) anotar(c, 'Limitado por', 'codificação', 'alerta');
    else if (camadas.some(camada => camada.saidaApertada)) anotar(c, 'Limitado por', 'banda de subida', 'alerta');
    // Pelo RTP, quantos assistem só o servidor sabe: a linha some em vez de dizer "null pessoas".
    if (envio.espectadores != null) anotar(c, 'Assistindo', envio.espectadores === 1 ? '1 pessoa' : `${envio.espectadores} pessoas`);
    const atraso = medianaDe(camadas.flatMap(camada => camada.atrasos));
    if (atraso !== null) anotar(c, 'Atraso até quem assiste', `${Math.round(atraso)} ms`, atraso > 400 ? 'alerta' : 'ok');
  }

  // O relatório técnico inteiro, e os cartões de quem assiste pelo WebCodecs.
  function diagnosticarTelaPorWebCodecs(lines, cartaoDe) {
    const wc = transporte?.telaWebCodecs;
    if (!wc) {
      lines.push('', 'Tela por WebCodecs: módulo ausente neste navegador (tudo pelo WebRTC).');
      return 0;
    }
    const cap = wc.capacidade();
    const envio = wc.estadoDoEnvio();
    const sim = valor => valor ? 'sim' : 'não';
    lines.push('', 'Tela por WebCodecs:',
      `  Codificação da tela: ${PREFERENCIA_EM_TEXTO[cap.preferencia] || cap.preferencia}; servidor: ${cap.desligadoPeloServidor ? 'desligado para todos' : 'liberado'}`,
      `  Envio: captura=${cap.envio?.captura ? 'sim' : 'não'}; H.264 pela placa=${sim(cap.envio?.h264Hardware)}; H.264=${sim(cap.envio?.h264)}; VP8=${sim(cap.envio?.vp8)}`,
      `  Recebimento: exibe=${sim(cap.recebimento?.exibe)}; H.264=${sim(cap.recebimento?.h264)}; VP8=${sim(cap.recebimento?.vp8)}; anuncia=${cap.anuncio.recebe ? cap.anuncio.dec.join('+') : 'não recebe'}`
        + (cap.recebimentoFalhou ? `; falhou: ${cap.recebimentoFalhou}` : ''));

    if (envio) {
      lines.push(`  Sua tela: ${envio.modo}; motivo: ${envio.motivo}; captura=${envio.captura || 'parada'}; fonte=${envio.fonte.largura}×${envio.fonte.altura}; espectadores=${envio.espectadores}; buffer=${envio.buffer ?? '?'} B; ritmador=${envio.ritmador.bytes} B (${Math.round(envio.ritmador.atrasoMs)} ms); saída estimada pelo WebRTC=${envio.saidaDisponivel ? mbps(envio.saidaDisponivel) : '?'}; envios recusados=${envio.envioRecusado}`);
      for (const camada of envio.camadas) {
        const atraso = medianaDe(camada.atrasos);
        lines.push(`  Camada ${camada.camada}: ${camada.codec} (${camada.perfil}, ${camada.hardware ? 'placa' : 'processador'}, ${camada.modoDeBitrate}, taxa ${camada.taxaDeclarada ? 'declarada' : 'não declarada'}); ${camada.largura}×${camada.altura} a ${Math.round(camada.fps)}/${camada.quadrosAlvo} fps; ${mbps(camada.bps)} de ${mbps(camada.bitrateAlvo)}; escala=${camada.escala}; `
          + `codificação=${camada.msDeCodificacao != null ? camada.msDeCodificacao.toFixed(1) + ' ms' : '?'}; fila=${camada.fila}; pulados: ritmo=${camada.descartes.ritmo} codificador=${camada.descartes.codificador} fila=${camada.descartes.fila} rede=${camada.descartes.rede}; `
          + `perda mediana=${Math.round(camada.perda * 100)}%; atraso mediano=${atraso !== null ? Math.round(atraso) : '?'} ms; espectadores=${camada.espectadores}; reconfigurações só de bitrate=${camada.reconfiguracoes.soDeBitrate} (com chave espontânea: ${camada.reconfiguracoes.comChaveEspontanea})`
          + (camada.ultimaMudanca ? `; última mudança: ${camada.ultimaMudanca}` : ''));
      }
    }

    // A tela pela placa, transportada pelo RTP (tela-placa-rtp.js): as camadas RTP dela estão
    // em miniatura de propósito, e o que interessa é o que a placa codificou no lugar.
    const placa = typeof telaPelaPlaca !== 'undefined' ? telaPelaPlaca : null;
    if (placa) {
      lines.push(`  Tela pela placa, pelo RTP: ${placa.ativo() ? 'no ar' : 'fora do ar'}${placa.ultimaFalha() ? `; última falha: ${placa.ultimaFalha()}` : ''}`);
      for (const camada of placa.estadoDoEnvio()?.camadas || []) {
        lines.push(`  Camada ${camada.camada} (placa, RTP): ${camada.codec} (${camada.perfil || '?'}, ${camada.hardware ? 'placa' : 'processador'}, ${camada.modoDeBitrate}, taxa ${camada.taxaDeclarada ? 'declarada' : 'não declarada'}); `
          + `${camada.largura}×${camada.altura} a ${Math.round(camada.fps)}/${camada.quadrosAlvo} fps; ${mbps(camada.bps)} de ${mbps(camada.bitrateAlvo)}; `
          + `codificação=${camada.msDeCodificacao != null ? camada.msDeCodificacao.toFixed(1) + ' ms' : '?'}; quadros-chave=${camada.chaves}; trocas de cena=${camada.cenas}; `
          + `sem captura=${camada.semCaptura}; imagem repetida (tela parada)=${camada.repetidos}; atrasados na placa=${camada.atrasados}; `
          + `chaves completadas com SPS/PPS=${camada.chavesCompletadas ?? 0}; reconfigurações de orçamento=${camada.reconfiguracoes.soDeBitrate}`);
      }
    }

    let quadros = 0;
    for (const r of wc.estadoDoRecebimento()) {
      const nome = peers.get(r.id)?.name || r.id;
      quadros += r.decodificados;
      const c = cartaoDe(`Recebendo a tela de ${nome}`);
      anotar(c, 'Transmissão', 'WebCodecs', 'ok');
      anotar(c, 'Imagem', r.comImagem
        ? `${r.largura}×${r.altura} · ${Math.round(r.fps)} fps${r.camada === 'baixa' ? ' · imagem leve' : ''}`
        : 'esperando o primeiro quadro', r.comImagem ? (r.perda > 0.05 ? 'alerta' : 'ok') : 'neutro');
      if (r.codec) {
        anotar(c, 'Codec', NOME_DO_CODEC_WC(r.codec)
          + (r.hardware === true ? ' · decodificado em hardware' : r.hardware === false ? ' · decodificado em software' : ''));
      }
      if (Number.isFinite(r.atrasoMs)) anotar(c, 'Atraso', `${Math.round(r.atrasoMs)} ms`, r.atrasoMs > 400 ? 'alerta' : 'ok');
      if (r.perda > 0.01) anotar(c, 'Perda', `${Math.round(r.perda * 100)}% dos quadros`, r.perda > 0.05 ? 'alerta' : 'neutro');
      lines.push(`  Recebendo de ${nome}: camada=${r.camada || '—'} (alvo ${r.alvo}; disponíveis ${r.camadasDisponiveis.join('+')}); ${r.codec || 'sem configuração'}; decodificação ${r.hardware === true ? 'pela placa' : r.hardware === false ? 'no processador' : '?'}; saída=${r.saida}; `
        + `${r.largura}×${r.altura} a ${Math.round(r.fps)} fps; ${mbps(r.bps)}; recebidos=${r.recebidos} perdidos=${r.perdidos} atrasados=${r.atrasados} pedidos de chave=${r.pedidosDeChave}; `
        + `atraso=${Number.isFinite(r.atrasoMs) ? Math.round(r.atrasoMs) + ' ms' : '?'} (ida e volta ${r.rtt != null ? Math.round(r.rtt) + ' ms' : '?'}); decodificação=${r.msDeDecodificacao != null ? r.msDeDecodificacao.toFixed(1) + ' ms' : '?'}; `
        + `totais: ${r.totais.recebidos} recebidos, ${r.totais.perdidos} perdidos, ${r.totais.pedidosDeChave} pedidos de chave`);
    }
    return quadros;
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
        // Quando o som da tela vem do agente: por qual caminho, quanto fica na fila (é o
        // atraso do som em relação à imagem) e quantas vezes ele falhou. Um relato de chiado
        // sem esta linha é palpite.
        `Som da tela pelo agente: ${(typeof resumoDoAudioDoAgente === 'function' && resumoDoAudioDoAgente()) || 'inativo'}`,
        `Aplicativo: ${window.NexoAtualizacao?.situacao()?.texto || 'navegador'}`,
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
      // Com a tela no WebCodecs, as camadas RTP dela estão paradas de propósito (ninguém as
      // assina, e o dynacast as desliga). Listá-las como "sem medida · desligada" com um
      // "em software" em laranja ao lado fazia o painel acusar o processador justamente quando a
      // placa estava codificando. Elas ficam só no relatório técnico.
      const envioPorWebCodecs = (typeof telaPelaPlaca !== 'undefined' && telaPelaPlaca?.estadoDoEnvio()) || transporte?.telaWebCodecs?.estadoDoEnvio();
      const telaPorWebCodecs = envioPorWebCodecs?.modo === 'webcodecs';
      // Um cartão por origem, criado só quando há o que pôr nele: um painel com seções
      // vazias é pior do que um painel curto.
      const cartoesPorRotulo = new Map();
      const cartaoDe = rotulo => {
        if (!cartoesPorRotulo.has(rotulo)) cartoesPorRotulo.set(rotulo, cartao(rotulo));
        return cartoesPorRotulo.get(rotulo);
      };
      // A primeira linha do envio da tela é por onde ela vai. Pelo WebRTC, o codec só se sabe
      // dentro do laço, e a linha é completada lá.
      const tituloDaTela = faixasLocais.find(([rotulo]) => rotulo === 'enviando screen')?.[2];
      let transmissaoPeloWebRTC = null;
      if (tituloDaTela) {
        const c = cartaoDe(tituloDaTela);
        if (telaPorWebCodecs) anotarEnvioPorWebCodecs(c, envioPorWebCodecs);
        else {
          anotar(c, 'Transmissão', 'WebRTC');
          transmissaoPeloWebRTC = c.linhas[c.linhas.length - 1];
          if (envioPorWebCodecs?.falha) anotar(c, 'WebCodecs', `falhou: ${envioPorWebCodecs.falha}`, 'alerta');
        }
      }
      // Onde cada envio codifica, somado por cartão: uma linha por camada repetia "em
      // hardware" três vezes. Uma camada no processador basta para o cartão dizer processador.
      const ondeCodifica = new Map();
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
            if (rotulo.startsWith('recebendo screen') && !c.linhas.length) anotar(c, 'Transmissão', 'WebRTC');
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
            lines.push(`  Camada ${item.rid || 'única'}: ${stats.get(item.codecId)?.mimeType || 'codec não informado'}; ${item.frameWidth || '?'}×${item.frameHeight || '?'}; FPS=${item.framesPerSecond ?? '?'}; limitado por=${item.qualityLimitationReason || 'nada'}${item.active === false ? '; desligada' : ''}`);
            lines.push(`  codificador=${item.encoderImplementation || 'não informado'}; economia de energia=${describeEfficiency(item.powerEfficientEncoder)}`);
            if (rotulo === 'enviando screen' && telaPorWebCodecs) return;
            const c = cartaoDe(titulo);
            if (rotulo === 'enviando screen' && transmissaoPeloWebRTC && item.active !== false && stats.get(item.codecId)?.mimeType) {
              const mime = stats.get(item.codecId).mimeType;
              transmissaoPeloWebRTC.valor = `WebRTC · ${typeof nomeDoCodec === 'function' ? nomeDoCodec(mime) : mime.replace(/^video\//i, '')}`;
            }
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
            // resolução ou se o problema está fora do Nexo. Só para camada ATIVA: a desligada
            // não codifica nada, e o navegador relata para ela o codificador de reserva.
            if (item.powerEfficientEncoder !== undefined && item.active !== false) {
              if (!ondeCodifica.has(c)) ondeCodifica.set(c, new Set());
              ondeCodifica.get(c).add(item.powerEfficientEncoder ? 'placa' : 'processador');
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

      // Logo abaixo da "Transmissão", quando ela existe: é a segunda pergunta de quem abre o
      // cartão.
      for (const [c, onde] of ondeCodifica) {
        const noProcessador = onde.has('processador');
        const linha = { rotulo: 'Onde codifica', valor: noProcessador ? 'no processador' : 'na placa de vídeo', estado: noProcessador ? 'alerta' : 'ok' };
        const depoisDe = c.linhas.findIndex(l => l.rotulo === 'Transmissão');
        c.linhas.splice(depoisDe + 1, 0, linha);
      }

      for (const par of peers.values()) {
        lines.push('', `Participante ${++index}: ${par.pc.connectionState}`);
        lines.push(`Fontes anunciadas: câmera=${Boolean(par.state.camera)}, tela=${Boolean(par.state.screen)}, áudio de tela=${Boolean(par.state.screenAudio)}`);
        par.publicacoes.forEach(publicacao => {
          const faixa = publicacao.track?.mediaStreamTrack;
          lines.push(`  Faixa ${publicacao.kind}: ${RoomTransport.fonteDaPublicacao(publicacao) || 'fonte desconhecida'}; ${faixa ? faixa.readyState : 'sem faixa'}; muda=${publicacao.isMuted}; inscrita=${publicacao.isSubscribed}`);
        });
      }

      recebidos += diagnosticarTelaPorWebCodecs(lines, cartaoDe);

      // Um cartão para o que é desta máquina e não muda com a rede. Vem por último porque é
      // o que menos muda -- e o que a pessoa consulta uma vez, não a cada quatro segundos.
      const maquina = cartao('Este computador');
      // A sondagem é do WebRTC (`type: 'webrtc'`), e o rótulo diz isso: com a tela saindo pela
      // placa por WebCodecs, um "Com hardware: nenhum" em laranja acusava a máquina logo abaixo
      // de um "na placa de vídeo". Sem placa no WebRTC só é alerta quando o WebCodecs também
      // não tem.
      const hw = await codificadoresPorHardware();
      const placaNoWebCodecs = Boolean(transporte?.telaWebCodecs?.capacidade().envio?.h264Hardware);
      if (hw === null) anotar(maquina, 'Hardware no WebRTC', 'o navegador não sabe informar', 'neutro');
      else {
        anotar(maquina, 'Hardware no WebRTC', hw.hardware.length ? hw.hardware.join(', ') : 'nenhum em 1080p/30',
          hw.hardware.length ? 'ok' : placaNoWebCodecs ? 'neutro' : 'alerta');
        if (hw.software.length) anotar(maquina, 'Processador no WebRTC', hw.software.join(', '), 'neutro');
        if (hw.desconhecido.length) anotar(maquina, 'Sem resposta', hw.desconhecido.join(', '), 'neutro');
      }
      anotar(maquina, 'Codec escolhido', `${codecDeVideoEscolhido()} na tela · H.264 na câmera`);
      // Da codificação da tela, só o que foge do normal: a escolha quando não é a automática, a
      // chave do servidor quando está desligada, e esta máquina quando não recebe por WebCodecs
      // -- que é o que leva a sala inteira ao WebRTC por causa dela.
      const wc = transporte?.telaWebCodecs?.capacidade();
      if (wc) {
        if (wc.preferencia !== 'automatico') anotar(maquina, 'Codificação da tela', PREFERENCIA_EM_TEXTO[wc.preferencia] || wc.preferencia, 'neutro');
        if (wc.desligadoPeloServidor) anotar(maquina, 'WebCodecs', 'desligado no servidor para todo mundo', 'neutro');
        else if (wc.recebimento && !wc.anuncio.recebe && wc.preferencia !== 'desligada') {
          anotar(maquina, 'Recebe por WebCodecs', wc.recebimentoFalhou ? `não: ${wc.recebimentoFalhou}` : 'não: a sala transmite pelo WebRTC', 'alerta');
        }
      }
      if (typeof planoDeAudio === 'function') anotar(maquina, 'Áudio do sistema', planoDeAudio());
      const somDaTela = typeof resumoDoAudioDoAgente === 'function' ? resumoDoAudioDoAgente() : '';
      if (somDaTela) anotar(maquina, 'Som da tela', somDaTela, estatisticasDoAudioDoAgente?.buracos ? 'alerta' : 'ok');
      // A versão do aplicativo é a primeira pergunta de todo relato de defeito que vem dele.
      const versaoDoApp = window.NexoAtualizacao?.situacao();
      if (versaoDoApp) anotar(maquina, 'Aplicativo', versaoDoApp.texto, versaoDoApp.desatualizado ? 'alerta' : 'ok');
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
    aoFalhar: ' Use “Copiar diagnóstico” e mande por outro caminho.'
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
      // `data-foco-inicial` vence o primeiro campo: no editor do cartão o primeiro campo é o seletor
      // de cor, e o lugar de começar é a aba escolhida.
      (next.querySelector('[data-foco-inicial]') || next.querySelector('input:not([type="file"])') || focusable(next)[0])?.focus();
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
  const fecharDialogo = dialog => { if (dialog === settingsPanel) fecharPainelDeTela(); else dialog.classList.add('hidden'); };
  // Um X no canto de todo painel que se fecha. O Escape e o clique fora continuam valendo, mas
  // nenhum dos dois se descobre olhando -- e no celular não existe Escape. Ficam de fora os
  // três que não se "fecham": a entrada, a espera e o aviso de remoção têm saídas próprias.
  const semX = new Set([nameGate, $('waitingPanel'), $('removidoPanel')]);
  for (const dialog of dialogs) {
    const cartao = dialog.querySelector('.modal-card');
    if (semX.has(dialog) || !cartao) continue;
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'ghost icone-so modal-fechar';
    fechar.title = 'Fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    fechar.addEventListener('click', () => fecharDialogo(dialog));
    cartao.prepend(fechar);
  }
  for (const dialog of dialogs) {
    new MutationObserver(syncDialog).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || dialog === nameGate) return;
      fecharDialogo(dialog);
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
      fecharDialogo(activeDialog);
    } else if (event.key === 'Escape') closeSidebar();
  }, true);
  syncDialog();
})();
