/* Canal de musica: o que a sala pede e o que o bot responde.
 *
 * O SOM nao passa por aqui. Ele chega como qualquer outro participante -- o bot publica
 * uma faixa de audio e o quadradinho dele aparece na sala com o controle de volume que
 * todo participante tem. Este arquivo cuida so do canal: os pedidos, a fila e o que esta
 * tocando.
 *
 * Por isso o volume aparece em dois lugares, e eles nao brigam: o daqui e o do bot (vale
 * para a sala inteira, como abaixar o rádio); o do quadradinho e o de cada um (vale so
 * para quem mexeu, como tapar o proprio ouvido).
 */
(() => {
  const $ = id => document.getElementById(id);
  const appRoot = document.querySelector('.app');
  const painel = $('musicaPanel');
  const mensagens = $('musicaMsgs');
  const entrada = $('musicaInput');

  let naoLidasNaMusica = 0;
  let estadoAtual = { conectado: false, tocando: null, fila: [], volume: 15, pausado: false };
  let disponivel = true;
  let pertoDoFim = true;
  // O tempo decorrido anda de segundo em segundo aqui, entre um aviso e outro do servidor.
  // Sem isto a barra so se mexeria quando alguma coisa mudasse -- e ficaria parada durante
  // a musica inteira, que e justamente quando alguem olha para ela.
  let relogio = null;
  let decorridoLocal = 0;

  function painelVisivel() {
    if (appRoot.classList.contains('teatro')) return false;
    if (!appRoot.classList.contains('painel-musica')) return false;
    if (appRoot.classList.contains('sem-chat')) return false;
    if (appRoot.classList.contains('foco-chat')) return true;
    return window.matchMedia('(min-width: 1101px)').matches || painel.classList.contains('aberto');
  }

  function abrirMusica() {
    definirModoTeatro(false);
    appRoot.classList.add('painel-musica');
    appRoot.classList.remove('sem-chat');
    painel.classList.add('aberto');
    // O painel do chat divide a coluna com este: deixar a classe dele ligada faria os dois
    // aparecerem sobrepostos na tela estreita, onde ambos sao camadas.
    $('chatPanel').classList.remove('aberto');
    naoLidasNaMusica = 0;
    marcarSidebar();
    // Sem rolar, como o do chat: o campo nasce fora da coluna que ainda está abrindo.
    entrada.focus({ preventScroll: true });
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  function fecharMusica() {
    definirFocoChat(false);
    painel.classList.remove('aberto');
    appRoot.classList.remove('painel-musica');
    appRoot.classList.add('sem-chat');
  }

  // O chat e a musica dividem a mesma coluna: abrir um tem de fechar o outro, e quem abre
  // o chat passa por `abrirChat`, que nao conhece este arquivo -- o botao do topo, o X, o
  // Escape e a barra lateral, todos. Envolver as duas funcoes e o que mantem a coluna
  // coerente sem repetir a regra em cada um desses lugares.
  const abrirChatOriginal = window.abrirChat;
  window.abrirChat = function () {
    appRoot.classList.remove('painel-musica');
    painel.classList.remove('aberto');
    abrirChatOriginal.apply(this, arguments);
    marcarSidebar();
  };
  const fecharChatOriginal = window.fecharChat;
  window.fecharChat = function () {
    fecharChatOriginal.apply(this, arguments);
    marcarSidebar();
  };

  function marcarSidebar() {
    for (const botao of document.querySelectorAll('.channel[data-action]')) {
      const ehMusica = botao.dataset.action === 'musica';
      const ehChat = botao.dataset.action === 'chat';
      const ehSala = botao.dataset.action === 'room';
      const musicaAberta = appRoot.classList.contains('painel-musica') && !appRoot.classList.contains('sem-chat');
      const chatAberto = !appRoot.classList.contains('painel-musica') && !appRoot.classList.contains('sem-chat');
      botao.classList.toggle('active', (ehMusica && musicaAberta) || (ehChat && chatAberto) || (ehSala && appRoot.classList.contains('sem-chat')));
    }
    const resumo = $('sidebarMusica');
    if (resumo) {
      resumo.textContent = estadoAtual.tocando
        ? (estadoAtual.pausado ? 'Pausado' : estadoAtual.tocando.titulo)
        : estadoAtual.fila.length ? `${estadoAtual.fila.length} na fila` : 'Peça uma música';
    }
    $('musicaLive').hidden = !estadoAtual.tocando || estadoAtual.pausado;
  }

  // ---------- Texto ----------
  //
  // O bot manda **negrito**, `código` e links. NADA vira HTML por concatenacao: cada
  // pedaco entra como no de texto ou como elemento criado a mao, que e o que impede uma
  // mensagem de virar marcacao na tela de quem le.
  const PEDACOS = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<]+)/g;

  function montarTextoDaMusica(destino, texto) {
    for (const linha of String(texto).split('\n')) {
      if (destino.childNodes.length) destino.appendChild(document.createElement('br'));
      for (const parte of linha.split(PEDACOS)) {
        if (!parte) continue;
        if (parte.startsWith('**') && parte.endsWith('**') && parte.length > 4) {
          const forte = document.createElement('strong');
          forte.textContent = parte.slice(2, -2);
          destino.appendChild(forte);
        } else if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2) {
          const codigo = document.createElement('code');
          codigo.textContent = parte.slice(1, -1);
          destino.appendChild(codigo);
        } else if (/^https?:\/\//.test(parte)) {
          const link = document.createElement('a');
          link.href = parte;
          link.textContent = parte.length > 48 ? `${parte.slice(0, 45)}…` : parte;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          destino.appendChild(link);
        } else {
          destino.appendChild(document.createTextNode(parte));
        }
      }
    }
  }

  // ---------- As falas do bot ----------
  //
  // O tipo vem do servidor e diz o que aconteceu; é ele que escolhe o ícone da linha. Uma fala
  // de antes desta versão chega sem tipo, com o glifo no começo do texto -- ele é traduzido
  // para o tipo e sai do texto, para as duas formas ficarem iguais na tela.
  const ICONES_DO_BOT = {
    tocando: '<path d="M7 4v16l13-8Z" fill="currentColor"/>',
    agora: '<path d="M7 4v16l13-8Z" fill="currentColor"/>',
    volta: '<path d="M7 4v16l13-8Z" fill="currentColor"/>',
    fila: '<path d="M12 5v14M5 12h14"/>',
    'a-seguir': '<path d="M5 4h14M12 20V9M7 13l5-5 5 5"/>',
    lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    'lista-da-fila': '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    escolha: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pulou: '<path d="M5 5v14l10-7ZM19 5v14"/>',
    pausa: '<path d="M8 5v14M16 5v14"/>',
    parou: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    moveu: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
    removeu: '<path d="M18 6 6 18M6 6l12 12"/>',
    esvaziou: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    embaralhou: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7"/>',
    erro: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    aviso: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    dica: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.4 1-1.9A6 6 0 0 0 12 3Z"/>',
    ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 16.5v.01"/>',
    info: '<path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>'
  };
  // Falas que são para ler, e não avisos: ficam num cartão, e dobram quando são longas.
  const TIPOS_EM_CARTAO = new Set(['ajuda', 'lista-da-fila', 'escolha']);
  const GLIFOS_ANTIGOS = [['▶ ', 'tocando'], ['＋ ', 'fila'], ['⏭ ', 'pulou'], ['⏸ ', 'pausa'], ['⏹ ', 'parou'], ['🔀 ', 'embaralhou'], ['↕ ', 'moveu'], ['⤒ ', 'a-seguir'], ['✕ ', 'removeu'], ['🔊 ', 'volume']];
  function tipoDaFala(msg) {
    let texto = String(msg.texto || '');
    let tipo = typeof msg.tipo === 'string' && ICONES_DO_BOT[msg.tipo] ? msg.tipo : null;
    const antigo = GLIFOS_ANTIGOS.find(([glifo]) => texto.startsWith(glifo));
    if (antigo) { texto = texto.slice(antigo[0].length); tipo ||= antigo[1]; }
    if (!tipo) tipo = Array.isArray(msg.opcoes) && msg.opcoes.length ? 'escolha' : texto.includes('\n') ? 'ajuda' : 'info';
    return { tipo, texto };
  }

  // Mensagens seguidas da mesma pessoa, a poucos minutos uma da outra, dividem o cabeçalho --
  // quem enfileira cinco músicas de uma vez não precisa ver o próprio nome cinco vezes.
  const MS_PARA_AGRUPAR = 5 * 60000;
  let ultimaDePessoa = null;

  function mostrarMensagemDeMusica(msg) {
    const vazio = mensagens.querySelector('.chat-vazio');
    if (vazio) vazio.remove();
    pertoDoFim = mensagens.scrollHeight - mensagens.scrollTop - mensagens.clientHeight < 80;
    const hora = document.createElement('span');
    hora.className = 'msg-hora';
    hora.textContent = horaCurta(msg.em || Date.now());

    if (msg.doBot) {
      const { tipo, texto } = tipoDaFala(msg);
      ultimaDePessoa = null;
      const marca = document.createElement('span');
      marca.className = 'bot-marca';
      marca.setAttribute('aria-hidden', 'true');
      marca.innerHTML = `<svg viewBox="0 0 24 24">${ICONES_DO_BOT[tipo]}</svg>`;
      // A capa da faixa, quando há: reconhecer a música pela imagem é mais rápido que ler.
      if (/^https:\/\//.test(msg.capa || '')) { pintarCapa(marca, msg.capa); marca.classList.add('com-capa'); }
      const corpo = document.createElement('div');
      corpo.className = 'msg-texto';
      montarTextoDaMusica(corpo, texto);
      const el = document.createElement('div');
      el.dataset.tipo = tipo;
      // Quem ouve pela tela não vê o ícone: o nome do bot vai junto, só para o leitor.
      const quem = document.createElement('span');
      quem.className = 'so-leitor';
      quem.textContent = `${msg.autor || 'Nexo DJ'}: `;
      if (TIPOS_EM_CARTAO.has(tipo)) {
        el.className = 'msg do-bot bot-cartao';
        const topo = document.createElement('div');
        topo.className = 'bot-cartao-topo';
        const autor = document.createElement('span');
        autor.className = 'msg-autor';
        autor.textContent = msg.autor || 'Nexo DJ';
        topo.append(marca, autor, hora);
        el.append(topo, corpo);
        adicionarEscolhas(corpo, msg);
        // Uma lista de quinze músicas ou a ajuda inteira ocupavam a coluna toda. Dobradas, as
        // primeiras linhas dizem do que se trata, e o resto está a um clique.
        if (!msg.opcoes?.length && texto.split('\n').length > 5) {
          el.classList.add('recolhido');
          const mais = document.createElement('button');
          mais.type = 'button';
          mais.className = 'bot-mais';
          mais.textContent = `Mostrar tudo (${texto.split('\n').length} linhas)`;
          mais.setAttribute('aria-expanded', 'false');
          mais.onclick = () => {
            const aberto = el.classList.toggle('recolhido') === false;
            mais.textContent = aberto ? 'Mostrar menos' : `Mostrar tudo (${texto.split('\n').length} linhas)`;
            mais.setAttribute('aria-expanded', String(aberto));
          };
          el.append(mais);
        }
      } else {
        el.className = 'msg do-bot bot-linha';
        el.title = texto.replace(/\*\*|`/g, '');
        el.append(marca, quem, corpo, hora);
      }
      mensagens.appendChild(el);
      concluirMensagem(msg);
      return;
    }

    const el = document.createElement('div');
    el.className = 'msg';
    if (msg.id) el.dataset.pedido = msg.id;
    const anterior = ultimaDePessoa;
    if (anterior && anterior.autorId === msg.autorId && (msg.em || 0) - (anterior.em || 0) < MS_PARA_AGRUPAR && mensagens.lastElementChild?.classList.contains('msg')) el.classList.add('continua');
    ultimaDePessoa = { autorId: msg.autorId, em: msg.em || Date.now() };
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
    topo.append(autor, hora);

    const corpo = document.createElement('div');
    corpo.className = 'msg-texto';
    montarTextoDaMusica(corpo, msg.texto || '');
    el.append(avatar, topo, corpo);
    mensagens.appendChild(el);
    concluirMensagem(msg);
  }

  function concluirMensagem(msg) {
    if (pertoDoFim) mensagens.scrollTop = mensagens.scrollHeight;
    if (!painelVisivel() && msg.autorId !== meuSocketId) {
      naoLidasNaMusica++;
      marcarSidebar();
    }
  }

  // "Procurando…" embaixo do pedido, enquanto a busca dura. Quem entrou no meio não tem o
  // pedido na tela, e aí simplesmente não há onde mostrar -- o resultado chega do mesmo jeito.
  const buscasEmCurso = new Map();
  function acompanharBusca({ pedido, rotulo, fim }) {
    const alvo = pedido && mensagens.querySelector(`[data-pedido="${CSS.escape(pedido)}"]`);
    clearTimeout(buscasEmCurso.get(pedido));
    buscasEmCurso.delete(pedido);
    alvo?.querySelector('.pedido-status')?.remove();
    if (fim || !alvo) return;
    const status = document.createElement('span');
    status.className = 'pedido-status';
    status.setAttribute('role', 'status');
    status.textContent = String(rotulo || 'Procurando…').slice(0, 60);
    alvo.append(status);
    if (pertoDoFim) mensagens.scrollTop = mensagens.scrollHeight;
    // Um fim que se perdeu numa queda de conexão não pode deixar o indicador girando para sempre.
    buscasEmCurso.set(pedido, setTimeout(() => { status.remove(); buscasEmCurso.delete(pedido); }, 90000));
  }

  // Listas encontradas por nome viram botões. O endereço fica guardado no objeto, nunca
  // escrito no HTML: ele vem de uma busca externa, e um botão é um alvo mais seguro do
  // que um link montado com texto de fora.
  function adicionarEscolhas(corpo, msg) {
    if (Array.isArray(msg.opcoes) && msg.opcoes.length) {
      const escolhas = document.createElement('div');
      escolhas.className = 'escolhas-de-lista';
      for (const opcao of msg.opcoes.slice(0, 8)) {
        if (!/^https:\/\/(www\.|music\.)?youtube\.com\//i.test(opcao?.endereco || '')) continue;
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.textContent = opcao.titulo || 'Lista';
        botao.title = `Enfileirar "${opcao.titulo}"`;
        botao.onclick = () => {
          // Desabilita o grupo inteiro: dois toques seguidos enfileirariam duas listas.
          escolhas.querySelectorAll('button').forEach(b => { b.disabled = true; });
          botao.classList.add('escolhida');
          enviarComando(`!lista ${opcao.endereco}`);
        };
        escolhas.appendChild(botao);
      }
      if (escolhas.childElementCount) corpo.appendChild(escolhas);
    }
  }

  function mostrarVazioDaMusica() {
    mensagens.replaceChildren();
    const p = document.createElement('div');
    p.className = 'chat-vazio';
    const titulo = document.createElement('strong');
    titulo.textContent = disponivel ? 'Peça uma música.' : 'O bot não está instalado.';
    p.append(titulo, document.createTextNode(disponivel
      ? 'Escreva o nome, cole um link do YouTube, SoundCloud ou Spotify, e eu entro na chamada para tocar.'
      : 'Na máquina que hospeda a sala, rode “npm run musica:instalar”. O resto da sala funciona normalmente.'));
    mensagens.appendChild(p);
  }

  // ---------- O que está tocando ----------

  function tempoLegivel(segundos) {
    const inteiro = Math.max(0, Math.floor(segundos || 0));
    return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, '0')}`;
  }

  function pintarTocando() {
    const tocando = estadoAtual.tocando;
    $('tocandoAgora').hidden = !tocando;
    $('musicaVolume').hidden = !estadoAtual.conectado;
    if (!tocando) {
      $('tocandoCapa').style.backgroundImage = '';
      return;
    }
    $('tocandoAgora').classList.toggle('pausado', estadoAtual.pausado);
    $('tocandoTitulo').textContent = tocando.titulo;
    $('tocandoAutor').textContent = [tocando.autor, tocando.pedidoPor && `pedida por ${tocando.pedidoPor}`].filter(Boolean).join(' · ');
    // A capa vem de fora e vai para uma propriedade de CSS: sem as aspas e a checagem de
    // esquema, uma URL com parenteses ou com "javascript:" sairia do lugar dela.
    pintarCapa($('tocandoCapa'), tocando.capa);
    $('tocandoRotulo').textContent = estadoAtual.pausado ? 'PAUSADO' : 'TOCANDO AGORA';
    // Troca o desenho, e não um glifo: ▶ e ⏸ mudavam de tamanho e de linha de base a cada fonte.
    if ($('musicaPausar').dataset.pausado !== String(estadoAtual.pausado)) {
      $('musicaPausar').dataset.pausado = String(estadoAtual.pausado);
      $('musicaPausar').innerHTML = estadoAtual.pausado ? ICONE_TOCAR : ICONE_PAUSAR;
    }
    $('musicaPausar').title = estadoAtual.pausado ? 'Voltar' : 'Pausar';
    $('musicaPausar').setAttribute('aria-label', $('musicaPausar').title);

    const duracao = tocando.duracao || 0;
    $('tocandoTempo').textContent = duracao ? `${tempoLegivel(decorridoLocal)} / ${tempoLegivel(duracao)}` : tempoLegivel(decorridoLocal);
    $('tocandoProgresso').style.width = duracao ? `${Math.min(100, (decorridoLocal / duracao) * 100)}%` : '0%';
  }

  // ---------- A fila ----------
  //
  // Cada faixa vai ao servidor pelo `id`, nunca pela posição que a pessoa viu: entre ver e
  // clicar, outra pessoa pode ter tirado a de cima (ver musica.js no servidor). A tela muda na
  // hora (otimista) e o `musica-estado` que o servidor manda em seguida é quem vale.
  const ICONE = caminho => `<svg class="ico ico-p" viewBox="0 0 24 24" aria-hidden="true">${caminho}</svg>`;
  const ICONE_TOCAR = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8Z"/></svg>';
  const ICONE_PAUSAR = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
  const ICONE_ALCA = ICONE('<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/>');
  const ICONE_A_SEGUIR = ICONE('<path d="M5 4h14M12 20V9M7 13l5-5 5 5"/>');
  const ICONE_MAIS = ICONE('<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>');
  const lista = $('musicaFilaLista');
  const menu = $('musicaFilaMenu');
  // A faixa cujo foco precisa voltar depois de redesenhar (quem reordena pelo teclado não
  // pode perder o lugar a cada seta).
  let focarDepois = null;
  // Enquanto alguém arrasta, a lista não é redesenhada: um aviso do servidor no meio do gesto
  // arrancaria a faixa da mão da pessoa. O estado fica guardado e entra ao soltar.
  let arrastando = null;
  let estadoAdiado = null;
  let recolhida = false;
  try { recolhida = localStorage.getItem('nexo.fila.recolhida') === '1'; } catch (_) { /* sem armazenamento */ }

  // A capa vem de fora e vai para uma propriedade de CSS: sem as aspas e a checagem de
  // esquema, uma URL com parenteses ou com "javascript:" sairia do lugar dela. Sem capa, a nota
  // desenhada -- a mesma do canal --, e não o glifo ♪, que cada fonte desenhava de um jeito.
  const NOTA_SEM_CAPA = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  function pintarCapa(el, capa) {
    const valida = /^https:\/\//.test(capa || '');
    el.style.backgroundImage = valida ? `url("${CSS.escape(capa).replace(/\\/g, '\\\\')}")` : '';
    el.innerHTML = valida ? '' : NOTA_SEM_CAPA;
  }

  function duracaoTotal(fila) {
    const segundos = fila.reduce((soma, faixa) => soma + (faixa.duracao || 0), 0);
    if (!segundos) return '';
    const minutos = Math.round(segundos / 60);
    return minutos >= 60 ? `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min` : `${Math.max(1, minutos)} min`;
  }

  function pintarFila() {
    if (arrastando) { estadoAdiado = estadoAtual; return; }
    const fila = estadoAtual.fila;
    $('musicaFila').hidden = !fila.length;
    $('musicaFila').classList.toggle('recolhida', recolhida);
    $('musicaFilaRecolher').setAttribute('aria-expanded', String(!recolhida));
    $('musicaFilaTotal').textContent = fila.length;
    $('musicaFilaDuracao').textContent = duracaoTotal(fila);
    $('musicaEmbaralhar').disabled = fila.length < 2;
    // Redesenhar troca todos os elementos, e o foco iria junto para o nada. Toda mudança chega
    // duas vezes -- a otimista e a confirmação do servidor --, e sem isto quem reordena pelo
    // teclado perdia o lugar entre uma seta e a outra.
    const focoAntes = lista.contains(document.activeElement)
      ? { id: document.activeElement.closest('.fila-item')?.dataset.id, alca: document.activeElement.classList.contains('fila-alca') }
      : null;
    const anteriores = new Set([...lista.children].map(el => el.dataset.id));
    lista.replaceChildren(...fila.map((faixa, indice) => {
      const item = document.createElement('li');
      item.className = 'fila-item';
      item.dataset.id = faixa.id;
      // Faixa que acabou de entrar pisca uma vez: numa fila de vinte, é assim que se acha.
      if (anteriores.size && !anteriores.has(faixa.id)) item.classList.add('chegou');

      const alca = document.createElement('button');
      alca.type = 'button';
      alca.className = 'fila-alca';
      alca.innerHTML = ICONE_ALCA;
      alca.setAttribute('aria-label', `Mover ${faixa.titulo}, posição ${indice + 1} de ${fila.length}`);
      alca.title = 'Arraste para mudar a ordem';
      alca.addEventListener('pointerdown', evento => comecarArrasto(evento, item));
      alca.addEventListener('keydown', evento => moverPeloTeclado(evento, faixa, indice));

      const posicao = document.createElement('span');
      posicao.className = 'fila-pos';
      posicao.textContent = indice + 1;
      posicao.setAttribute('aria-hidden', 'true');

      const capa = document.createElement('span');
      capa.className = 'fila-capa';
      capa.setAttribute('aria-hidden', 'true');
      pintarCapa(capa, faixa.capa);

      const info = document.createElement('div');
      info.className = 'fila-info';
      const titulo = document.createElement('strong');
      titulo.textContent = faixa.titulo;
      titulo.title = faixa.titulo;
      const detalhe = document.createElement('small');
      // A duração primeiro: é o que se procura numa fila ("quanto falta?"), e o fim da linha é
      // o que corta quando a coluna é estreita.
      detalhe.textContent = [faixa.duracao ? tempoLegivel(faixa.duracao) : null, faixa.autor, faixa.pedidoPor && `por ${faixa.pedidoPor}`].filter(Boolean).join(' · ');
      info.append(titulo, detalhe);

      const acoes = document.createElement('div');
      acoes.className = 'fila-acoes';
      if (indice > 0) {
        const aSeguir = document.createElement('button');
        aSeguir.type = 'button';
        aSeguir.className = 'ghost';
        aSeguir.innerHTML = ICONE_A_SEGUIR;
        aSeguir.title = 'Tocar a seguir';
        aSeguir.setAttribute('aria-label', `Tocar ${faixa.titulo} a seguir`);
        aSeguir.onclick = () => agirNaFila('mover', faixa, 1);
        acoes.append(aSeguir);
      }
      const mais = document.createElement('button');
      mais.type = 'button';
      mais.className = 'ghost';
      mais.innerHTML = ICONE_MAIS;
      mais.title = 'Mais opções';
      mais.setAttribute('aria-label', `Mais opções para ${faixa.titulo}`);
      mais.setAttribute('aria-haspopup', 'menu');
      mais.setAttribute('aria-expanded', 'false');
      mais.onclick = evento => { evento.stopPropagation(); abrirMenuDaFaixa(mais, item, faixa, indice); };
      acoes.append(mais);

      item.append(alca, posicao, capa, info, acoes);
      return item;
    }));
    const focar = focarDepois || focoAntes?.id;
    if (focar) {
      const item = lista.querySelector(`[data-id="${CSS.escape(focar)}"]`);
      (focarDepois || focoAntes?.alca ? item?.querySelector('.fila-alca') : item?.querySelector('.fila-acoes button:last-child'))?.focus();
      focarDepois = null;
    }
  }

  // Muda a tela na hora e pede ao servidor. Se o servidor recusar (a faixa já tinha saído,
  // por exemplo), a própria resposta dele traz a fila de verdade de volta.
  function agirNaFila(acao, faixa, para) {
    if (!socket?.connected) { status.textContent = 'Aguarde a reconexão para mexer na fila.'; return; }
    const fila = [...estadoAtual.fila];
    const de = fila.findIndex(f => f.id === faixa?.id);
    if (acao === 'mover' && de >= 0) {
      const [movida] = fila.splice(de, 1);
      fila.splice(Math.max(0, Math.min(fila.length, para - 1)), 0, movida);
      estadoAtual = { ...estadoAtual, fila };
      pintarFila();
    } else if (acao === 'remover' && de >= 0) {
      fila.splice(de, 1);
      estadoAtual = { ...estadoAtual, fila };
      pintarFila();
    }
    socket.emit('musica-fila', { acao, id: faixa?.id, para }, resposta => {
      if (!resposta?.ok) {
        status.textContent = resposta?.error || 'Não foi possível mexer na fila.';
        socket.emit('musica-estado', pacote => { if (pacote?.estado) aplicarEstado(pacote.estado); });
      }
    });
  }

  function moverPeloTeclado(evento, faixa, indice) {
    const total = estadoAtual.fila.length;
    const destino = { ArrowUp: indice, ArrowDown: indice + 2, Home: 1, End: total }[evento.key];
    if (!destino) return;
    evento.preventDefault();
    if (destino < 1 || destino > total || destino === indice + 1) return;
    focarDepois = faixa.id;
    agirNaFila('mover', faixa, destino);
  }

  // ---------- Arrastar ----------
  //
  // Por eventos de ponteiro, e não pelo arrastar-e-soltar do HTML: aquele não existe no toque,
  // e é justamente no celular que a fila é mexida no meio da conversa. As outras faixas abrem
  // espaço deslizando; nada é redesenhado até soltar.
  function comecarArrasto(evento, item) {
    if (evento.button !== 0 || estadoAtual.fila.length < 2) return;
    evento.preventDefault();
    fecharMenuDaFaixa();
    const itens = [...lista.children];
    const origem = itens.indexOf(item);
    const caixas = itens.map(el => el.getBoundingClientRect());
    const altura = caixas[origem].height + 1;
    const inicioY = evento.clientY;
    const inicioRolagem = lista.scrollTop;
    let destino = origem;
    let rolar = 0;
    arrastando = { item, origem };
    item.classList.add('arrastando');
    lista.classList.add('reordenando');
    evento.currentTarget.setPointerCapture?.(evento.pointerId);

    const acompanhar = y => {
      const deslocamento = y - inicioY + (lista.scrollTop - inicioRolagem);
      item.style.transform = `translateY(${deslocamento}px)`;
      const centro = caixas[origem].top + caixas[origem].height / 2 + deslocamento;
      destino = origem;
      for (let i = 0; i < itens.length; i++) {
        if (i === origem) continue;
        const meio = caixas[i].top + caixas[i].height / 2;
        if (i < origem && centro < meio) { destino = Math.min(destino, i); }
        if (i > origem && centro > meio) { destino = Math.max(destino, i); }
      }
      itens.forEach((el, i) => {
        if (i === origem) return;
        const desce = destino < origem && i >= destino && i < origem;
        const sobe = destino > origem && i <= destino && i > origem;
        el.style.transform = desce ? `translateY(${altura}px)` : sobe ? `translateY(${-altura}px)` : '';
      });
      // Perto da borda, a lista rola sozinha: numa fila longa, o lugar certo pode estar fora da vista.
      const borda = lista.getBoundingClientRect();
      rolar = y < borda.top + 28 ? -8 : y > borda.bottom - 28 ? 8 : 0;
    };
    let ultimoY = evento.clientY;
    const aoMover = e => { ultimoY = e.clientY; acompanhar(ultimoY); };
    const rolagem = setInterval(() => { if (rolar) { lista.scrollTop += rolar; acompanhar(ultimoY); } }, 16);
    const aoSoltar = () => {
      clearInterval(rolagem);
      window.removeEventListener('pointermove', aoMover);
      window.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('pointercancel', aoSoltar);
      itens.forEach(el => { el.style.transform = ''; });
      item.classList.remove('arrastando');
      lista.classList.remove('reordenando');
      arrastando = null;
      const faixa = estadoAtual.fila[origem];
      if (estadoAdiado) { estadoAtual = estadoAdiado; estadoAdiado = null; }
      if (destino !== origem && faixa) {
        focarDepois = faixa.id;
        agirNaFila('mover', faixa, destino + 1);
      } else pintarFila();
    };
    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
  }

  // ---------- O menu de uma faixa ----------
  let menuAberto = null;
  function fecharMenuDaFaixa() {
    if (!menuAberto) return;
    menuAberto.botao.setAttribute('aria-expanded', 'false');
    menuAberto.item.classList.remove('menu-aberto');
    menu.classList.add('hidden');
    menu.replaceChildren();
    menuAberto = null;
  }
  function abrirMenuDaFaixa(botao, item, faixa, indice) {
    const jaEra = menuAberto?.botao === botao;
    fecharMenuDaFaixa();
    if (jaEra) return;
    const total = estadoAtual.fila.length;
    const opcoes = [];
    if (estadoAtual.tocando) opcoes.push(['Tocar agora', () => agirNaFila('agora', faixa)]);
    if (indice > 0) opcoes.push(['Tocar a seguir', () => agirNaFila('mover', faixa, 1)]);
    if (indice > 0) opcoes.push(['Subir uma posição', () => agirNaFila('mover', faixa, indice)]);
    if (indice < total - 1) opcoes.push(['Descer uma posição', () => agirNaFila('mover', faixa, indice + 2)]);
    if (indice < total - 1) opcoes.push(['Mandar para o fim', () => agirNaFila('mover', faixa, total)]);
    if (total > 2) opcoes.push(['Mover para a posição…', () => pedirPosicao(botao, faixa, indice)]);
    opcoes.push(null, ['Tirar da fila', () => agirNaFila('remover', faixa), 'perigo']);
    for (const opcao of opcoes) {
      if (!opcao) { menu.append(document.createElement('hr')); continue; }
      const [rotulo, fazer, classe] = opcao;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (classe) b.className = classe;
      b.textContent = rotulo;
      // Sem parar o clique aqui, ele chega ao documento depois de o menu ter trocado de
      // conteúdo -- e o "Mover para a posição…" fecharia no mesmo clique que o abriu.
      b.onclick = evento => { evento.stopPropagation(); fecharMenuDaFaixa(); fazer(); };
      menu.append(b);
    }
    menuAberto = { botao, item };
    botao.setAttribute('aria-expanded', 'true');
    item.classList.add('menu-aberto');
    menu.classList.remove('hidden');
    ancorarAbaixoDe(menu, botao);
    menu.querySelector('button')?.focus();
  }

  // "Mover para a posição" troca o menu por um número: numa fila de trinta, arrastar do fim ao
  // meio é trabalho, e digitar "4" não é.
  function pedirPosicao(botao, faixa, indice) {
    const total = estadoAtual.fila.length;
    const formulario = document.createElement('form');
    formulario.className = 'fila-posicao';
    const rotulo = document.createElement('label');
    rotulo.textContent = `Posição (1 a ${total})`;
    const campo = document.createElement('input');
    campo.type = 'number'; campo.min = '1'; campo.max = String(total); campo.value = String(indice + 1);
    campo.inputMode = 'numeric';
    rotulo.append(campo);
    const ir = document.createElement('button');
    ir.type = 'submit';
    ir.textContent = 'Mover';
    formulario.append(rotulo, ir);
    formulario.onsubmit = evento => {
      evento.preventDefault();
      const para = Math.trunc(Number(campo.value));
      fecharMenuDaFaixa();
      if (para >= 1 && para <= total && para !== indice + 1) { focarDepois = faixa.id; agirNaFila('mover', faixa, para); }
    };
    const item = lista.querySelector(`[data-id="${CSS.escape(faixa.id)}"]`);
    menu.replaceChildren(formulario);
    menuAberto = { botao, item };
    item?.classList.add('menu-aberto');
    menu.classList.remove('hidden');
    ancorarAbaixoDe(menu, botao);
    campo.select();
    campo.focus();
  }
  document.addEventListener('click', evento => { if (menuAberto && !evento.target.closest('#musicaFilaMenu')) fecharMenuDaFaixa(); });
  document.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape' || !menuAberto) return;
    evento.stopPropagation();
    const botao = menuAberto.botao;
    fecharMenuDaFaixa();
    botao.focus();
  }, true);
  // Setas dentro do menu, como num menu de sistema.
  menu.addEventListener('keydown', evento => {
    if (!['ArrowDown', 'ArrowUp'].includes(evento.key)) return;
    const botoes = [...menu.querySelectorAll('button')];
    const atual = botoes.indexOf(document.activeElement);
    if (atual < 0) return;
    evento.preventDefault();
    botoes[(atual + (evento.key === 'ArrowDown' ? 1 : botoes.length - 1)) % botoes.length].focus();
  });
  lista.addEventListener('scroll', fecharMenuDaFaixa);

  $('musicaFilaRecolher').onclick = () => {
    recolhida = !recolhida;
    try { localStorage.setItem('nexo.fila.recolhida', recolhida ? '1' : '0'); } catch (_) { /* fica só nesta aba */ }
    pintarFila();
  };
  $('musicaEmbaralhar').onclick = () => agirNaFila('embaralhar');
  $('musicaEsvaziar').onclick = () => {
    const total = estadoAtual.fila.length;
    if (!total) return;
    if (!confirm(`Tirar as ${total} ${total === 1 ? 'faixa' : 'faixas'} da fila? A que está tocando continua.`)) return;
    estadoAtual = { ...estadoAtual, fila: [] };
    pintarFila();
    socket?.emit('musica-fila', { acao: 'esvaziar' });
  };

  function pintarVolume() {
    $('musicaVolumeSlider').value = estadoAtual.volume;
    $('musicaVolumeValor').textContent = `${estadoAtual.volume}%`;
  }

  function aplicarEstado(novo) {
    if (!novo) return;
    const trocouDeFaixa = novo.tocando?.id !== estadoAtual.tocando?.id;
    estadoAtual = novo;
    // O tempo do servidor manda na troca de faixa e sempre que o desvio passar de dois
    // segundos. Entre isso, o relogio local conta sozinho -- adotar o valor do servidor a
    // cada aviso faria a barra pular para tras por causa do atraso da rede.
    const doServidor = novo.tocando?.decorrido || 0;
    if (trocouDeFaixa || Math.abs(doServidor - decorridoLocal) > 2) decorridoLocal = doServidor;
    pintarTocando();
    pintarFila();
    pintarVolume();
    marcarSidebar();
    tocarRelogio();
  }

  function tocarRelogio() {
    clearInterval(relogio);
    relogio = null;
    if (!estadoAtual.tocando || estadoAtual.pausado) return;
    relogio = setInterval(() => {
      decorridoLocal++;
      pintarTocando();
    }, 1000);
  }

  // ---------- Enviar ----------

  function enviarComando(texto) {
    const limpo = String(texto || '').trim();
    if (!limpo) return;
    if (!socket?.connected) { status.textContent = 'Aguarde a reconexão para pedir música.'; return; }
    socket.emit('musica-comando', { texto: limpo });
  }

  // Pedir entra no fim da fila; "a seguir" passa na frente de todo mundo que está esperando.
  // Um comando que já começa com "!" vai como está: o botão não reescreve o que a pessoa
  // escreveu de propósito.
  function pedir(aSeguir) {
    const texto = entrada.value.trim();
    if (!texto) { entrada.focus(); return; }
    enviarComando(aSeguir && !texto.startsWith('!') ? `!proxima ${texto}` : texto);
    entrada.value = '';
    entrada.style.height = 'auto';
    atualizarBotoesDePedido();
  }
  // Sem texto não há o que pedir; com a música restrita pelo dono, o campo inteiro está
  // desligado (sala.js), e os botões vão junto.
  function atualizarBotoesDePedido() {
    const bloqueado = entrada.disabled || !entrada.value.trim();
    $('musicaSend').disabled = bloqueado;
    $('musicaProxima').disabled = bloqueado;
  }
  $('musicaSend').onclick = () => pedir(false);
  $('musicaProxima').onclick = () => pedir(true);
  entrada.addEventListener('keydown', evento => {
    if (evento.key !== 'Enter' || evento.shiftKey) return;
    evento.preventDefault();
    pedir(evento.ctrlKey || evento.metaKey);
  });
  entrada.addEventListener('input', atualizarBotoesDePedido);
  atualizarBotoesDePedido();
  entrada.addEventListener('input', () => {
    entrada.style.height = 'auto';
    entrada.style.height = `${Math.min(120, entrada.scrollHeight)}px`;
  });
  mensagens.addEventListener('scroll', () => {
    pertoDoFim = mensagens.scrollHeight - mensagens.scrollTop - mensagens.clientHeight < 80;
  });

  $('musicaClose').onclick = fecharMusica;
  $('musicaPausar').onclick = () => enviarComando(estadoAtual.pausado ? '!voltar' : '!pausar');
  $('musicaPular').onclick = () => enviarComando('!pular');

  // O volume do bot vale para a sala toda, entao ele so e enviado quando a pessoa SOLTA o
  // controle. Mandando a cada pixel, um arrasto viraria trinta avisos para todo mundo.
  $('musicaVolumeSlider').addEventListener('input', () => {
    $('musicaVolumeValor').textContent = `${$('musicaVolumeSlider').value}%`;
  });
  $('musicaVolumeSlider').addEventListener('change', () => enviarComando(`!volume ${$('musicaVolumeSlider').value}`));

  mostrarVazioDaMusica();
  // Em tela larga a sala abre com o chat na coluna, e nao com "Sala de voz" -- que era o
  // que o HTML marcava. Acertar aqui, uma vez, evita que o primeiro clique em qualquer
  // canal seja tambem o que corrige a marcacao.
  marcarSidebar();

  window.NexoMusica = {
    abrir: abrirMusica,
    fechar: fecharMusica,
    marcarSidebar,
    atualizarBotoes: atualizarBotoesDePedido,
    // Chamado por sala.js assim que o socket existe. O Socket.IO reconecta sozinho sem
    // trocar de objeto, entao ligar uma vez basta para a sessao inteira.
    ligar(soquete) {
      soquete.on('musica-mensagem', mostrarMensagemDeMusica);
      soquete.on('musica-busca', acompanharBusca);
      soquete.on('musica-estado', aplicarEstado);
    },
    // Chamado pelo `join-room`: o estado inteiro do canal chega de uma vez, junto com o
    // resto da sala, em vez de custar duas idas e voltas so para descobrir se ha musica.
    aoEntrar(pacote) {
      if (!pacote) return;
      disponivel = pacote.disponivel !== false;
      mensagens.replaceChildren();
      ultimaDePessoa = null;
      if (Array.isArray(pacote.historico) && pacote.historico.length) pacote.historico.forEach(mostrarMensagemDeMusica);
      else mostrarVazioDaMusica();
      aplicarEstado(pacote.estado);
      naoLidasNaMusica = 0;
      marcarSidebar();
    }
  };

  window.addEventListener('pagehide', () => clearInterval(relogio));
})();
