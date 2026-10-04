/* O seletor de emojis do Nexo: todos os emojis, num painelzinho que abre ao lado de um botão (popover.js).
 *
 *   NexoEmojis.abrir(botao, { aoEscolher, aoFechar, rotulo })   abre; `aoEscolher(emoji)` recebe o emoji
 *                                                               (com o tom de pele já aplicado). Shift+clique
 *                                                               escolhe e deixa aberto.
 *   NexoEmojis.botaoDeCampo(campo, { classe, rotulo })           um botão pronto que insere no campo de texto
 *   NexoEmojis.inserir(campo, emoji)                             insere onde está o cursor, respeitando o maxlength
 *   NexoEmojis.ICONE                                             o desenho do botão (a carinha)
 *
 * De onde vem a lista: public/emojis.json, gerado de uma vez pelo `npm run emojis:gerar` a partir da lista
 * oficial do Unicode e dos nomes em português do CLDR (scripts/gerar-emojis.cjs). A página a pede na primeira
 * vez que o painelzinho abre e guarda: 170 KB que quem nunca abre o seletor nunca baixa.
 *
 * Só aparece o que o aparelho sabe DESENHAR. A lista é a do Unicode mais novo, e um emoji que a fonte do
 * sistema ainda não tem sai como um quadrado: o seletor desenha, numa tela escondida, um emoji de cada versão
 * do Unicode (o `testes` do json) e esconde as versões que saem sem cor -- e, nos compostos, as que saem
 * como dois desenhos. As bandeiras de país também: o Windows não as desenha, e o seletor mostraria "BR".
 *
 * O que a pessoa lembra fica neste navegador (localStorage), como as salas recentes: os usados por último e
 * o tom de pele. Quem escolhe é a própria pessoa, e nada disso vai para o servidor.
 *
 * Teclado: o campo de busca recebe o foco; seta para baixo desce para a grade, as setas andam por ela, Enter
 * escolhe, Esc fecha. As categorias são uma barra de botões; a busca olha o nome e as palavras (sem acento).
 */
(function (root) {
  const doc = root.document;
  const GUARDA_TOM = 'nexo.emoji.tom';
  const GUARDA_RECENTES = 'nexo.emoji.recentes';
  const RECENTES_MAXIMO = 24;
  const RESULTADOS_MAXIMOS = 240;
  // Os tons: o amarelo é o padrão, e os cinco da escala do Unicode. Cores fixas: são a amostra da pele.
  const TONS = [
    ['Tom padrão', '#ffcc4d'], ['Pele clara', '#f7dece'], ['Pele morena clara', '#e0bb95'],
    ['Pele morena', '#bf8f68'], ['Pele morena escura', '#9b643d'], ['Pele escura', '#594539']
  ];
  const FAMILIA = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color","Android Emoji",sans-serif';
  // Os mais usados, para desempatar a busca: "coração" tem dezenas de resultados que começam igual, e o
  // vermelho é o que quase todo mundo quer. Só decide entre resultados que a busca já considera iguais.
  const POPULARES = ['❤️', '😂', '👍', '🙏', '😍', '😭', '😊', '🔥', '🥰', '😘', '😁', '🤣', '🎉', '👏', '💕', '😉', '😅', '🤔', '😎', '🙌', '💪', '✨', '🥺', '😢', '😡', '🤗', '👀', '💯', '🚀', '🤝'];
  const ICONE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01"/><path d="M8.4 14.3a4.6 4.6 0 0 0 7.2 0"/></svg>';
  const DESENHOS = {
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/>',
    limpar: '<path d="M18 6 6 18M6 6l12 12"/>',
    recentes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const svg = nome => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[nome]}</svg>`;

  const elemento = (tag, classe, texto) => {
    const el = doc.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const semAcento = texto => String(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const capitalizar = texto => (texto ? texto[0].toUpperCase() + texto.slice(1) : texto);
  const ler = (chave, padrao) => { try { return JSON.parse(root.localStorage.getItem(chave)) ?? padrao; } catch (_) { return padrao; } };
  const gravar = (chave, valor) => { try { root.localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) { /* sem armazenamento: o seletor funciona, só não lembra */ } };

  // ---------- Saber o que o aparelho desenha ----------
  // Um emoji em cor sai IGUAL desenhado em preto e em branco; um quadrado ou uma letra (a fonte sem o emoji)
  // saem da cor da tinta. O desenho de 100 px é encolhido para um pixel só, que é a média dele.
  function marca(texto, cor) {
    const tela = doc.createElement('canvas');
    tela.width = tela.height = 1;
    const ctx = tela.getContext('2d', { willReadFrequently: true });
    ctx.textBaseline = 'top';
    ctx.font = `100px ${FAMILIA}`;
    ctx.fillStyle = cor;
    ctx.scale(0.01, 0.01);
    ctx.fillText(texto, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data].join(',');
  }
  const emCor = texto => { const preto = marca(texto, '#000'), branco = marca(texto, '#fff'); return preto === branco && !preto.startsWith('0,0,0,'); };
  // Um emoji composto que a fonte não sabe juntar sai como dois ou três desenhos lado a lado, todos em cor:
  // a largura entrega.
  function umSoDesenho(texto) {
    const ctx = doc.createElement('canvas').getContext('2d');
    ctx.font = `32px ${FAMILIA}`;
    const um = ctx.measureText('😀').width;
    return um > 0 && ctx.measureText(texto).width / um < 1.5;
  }
  const RI = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;
  const DE_REGIAO = /[\u{E0020}-\u{E007F}]/u;
  function descobrirSuporte(testes) {
    let resultado;
    try {
      // Se nem o emoji mais comum sai em cor, a tela escondida não serve (um navegador que a embaralha por
      // privacidade): mostra tudo, em vez de esconder o que talvez funcione.
      if (!emCor('😀')) return () => true;
      const versoes = new Map(testes.filter(([versao]) => versao >= 11).map(([versao, emoji, composto]) => [versao, emCor(emoji) && (!composto || umSoDesenho(emoji))]));
      const bandeiras = { pais: emCor('🇧🇷') && umSoDesenho('🇧🇷'), regiao: emCor('🏴󠁧󠁢󠁥󠁮󠁧󠁿') && umSoDesenho('🏴󠁧󠁢󠁥󠁮󠁧󠁿') };
      resultado = (emoji, versao) => {
        if (RI.test(emoji)) return bandeiras.pais;
        if (DE_REGIAO.test(emoji)) return bandeiras.regiao;
        return versao < 11 || versoes.get(versao) !== false;
      };
    } catch (_) { return () => true; }
    return resultado;
  }

  // ---------- Os dados ----------
  let cache = null;
  let promessa = null;
  function preparar(dados) {
    const desenha = descobrirSuporte(dados.testes || []);
    const grupos = [];
    const indice = new Map();
    for (const g of dados.grupos) {
      const itens = [];
      for (const [emoji, nome, busca, versao] of g.itens) {
        if (!desenha(emoji, versao)) continue;
        const item = { emoji, nome, busca: `${semAcento(nome)} ${busca || ''}`, nomeSemAcento: semAcento(nome), tons: dados.tons?.[emoji] || null };
        itens.push(item);
        indice.set(emoji, item);
        for (const variante of item.tons || []) indice.set(variante, item);
      }
      if (itens.length) grupos.push({ id: g.id, nome: g.nome, icone: g.icone, itens });
    }
    cache = { grupos, indice, todos: grupos.flatMap(g => g.itens) };
    return cache;
  }
  function carregar() {
    if (cache) return Promise.resolve(cache);
    promessa ||= root.fetch('/emojis.json', { credentials: 'same-origin' })
      .then(resposta => { if (!resposta.ok) throw new Error(String(resposta.status)); return resposta.json(); })
      .then(preparar)
      .catch(erro => { promessa = null; throw erro; });
    return promessa;
  }

  // ---------- Inserir num campo ----------
  // Onde está o cursor, no lugar do que estiver selecionado; o `input` é disparado para quem escuta o campo
  // (o chat ajusta a altura, o editor refaz a prévia). Não cabendo no maxlength, não faz nada -- o contador do
  // campo já diz que está cheio.
  function inserir(campo, emoji) {
    if (!campo || !emoji) return false;
    const inicio = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? inicio;
    const novo = campo.value.slice(0, inicio) + emoji + campo.value.slice(fim);
    if (campo.maxLength > 0 && novo.length > campo.maxLength) { campo.focus(); return false; }
    campo.value = novo;
    const posicao = inicio + emoji.length;
    campo.setSelectionRange(posicao, posicao);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.focus();
    return true;
  }

  function botaoDeCampo(campo, { classe = '', rotulo = 'Escolher um emoji' } = {}) {
    const botao = elemento('button', classe);
    botao.type = 'button';
    botao.title = rotulo;
    botao.setAttribute('aria-label', rotulo);
    botao.setAttribute('aria-haspopup', 'true');
    botao.setAttribute('aria-expanded', 'false');
    botao.innerHTML = ICONE;
    botao.addEventListener('click', () => abrir(botao, { rotulo, aoEscolher: emoji => inserir(campo, emoji) }));
    return botao;
  }

  // ---------- O painelzinho ----------
  function abrir(botao, { aoEscolher = () => {}, aoFechar = null, rotulo = 'Escolher um emoji' } = {}) {
    const toque = root.matchMedia('(pointer:coarse)').matches;
    // O painelzinho monta o conteúdo ANTES de devolver a instância: quem constrói a grade fala com ela por
    // aqui, e o clique só vem depois que tudo existe.
    const ponte = {
      instancia: null,
      escolher(emoji, manter) {
        const lembrados = [emoji, ...ler(GUARDA_RECENTES, []).filter(e => e !== emoji)].slice(0, RECENTES_MAXIMO);
        gravar(GUARDA_RECENTES, lembrados);
        // Fecha primeiro e entrega depois: o foco volta ao botão, e quem recebe o emoji (um campo de texto)
        // o toma de volta em seguida.
        if (!manter) ponte.instancia.fechar();
        aoEscolher(emoji);
      }
    };
    ponte.instancia = root.NexoPopover.abrir(botao, caixa => {
      caixa.classList.add('nx-emo-pop');
      if (cache) { caixa.append(construir(cache, ponte)); return; }
      caixa.append(elemento('p', 'nx-emo-estado', 'Carregando os emojis…'));
      carregar().then(dados => {
        if (!caixa.isConnected) return;
        caixa.replaceChildren(construir(dados, ponte));
        if (!toque) caixa.querySelector('.nx-emo-campo')?.focus({ preventScroll: true });
      }).catch(() => {
        if (!caixa.isConnected) return;
        const erro = elemento('div', 'nx-emo-estado');
        erro.append(elemento('p', '', 'Não foi possível carregar os emojis.'));
        const outra = elemento('button', 'nx-emo-tentar', 'Tentar de novo');
        outra.type = 'button';
        outra.addEventListener('click', () => { ponte.instancia.fechar(); abrir(botao, { aoEscolher, aoFechar, rotulo }); });
        erro.append(outra);
        caixa.replaceChildren(erro);
      });
    }, { rotulo, classe: 'nx-emo-pop', aoFechar, foco: toque ? '.nx-emo-area' : '.nx-emo-campo' });
    return ponte.instancia;
  }

  function construir(dados, ponte) {
    let tom = Math.min(5, Math.max(0, Number(ler(GUARDA_TOM, 0)) || 0));
    const raiz = elemento('div', 'nx-emo');

    // O topo: a busca. O X limpa e devolve o foco ao campo.
    const topo = elemento('div', 'nx-emo-topo');
    const busca = elemento('label', 'nx-emo-busca');
    busca.insertAdjacentHTML('beforeend', svg('lupa'));
    const campo = elemento('input', 'nx-emo-campo');
    campo.type = 'text';
    campo.placeholder = 'Buscar emoji';
    campo.autocomplete = 'off';
    campo.spellcheck = false;
    campo.setAttribute('autocapitalize', 'none');
    campo.setAttribute('enterkeyhint', 'search');
    campo.setAttribute('aria-label', 'Buscar emoji pelo nome');
    const limpar = elemento('button', 'nx-emo-limpar');
    limpar.type = 'button';
    limpar.hidden = true;
    limpar.title = 'Limpar a busca';
    limpar.setAttribute('aria-label', 'Limpar a busca');
    limpar.innerHTML = svg('limpar');
    busca.append(campo, limpar);
    topo.append(busca);

    // As categorias.
    const abas = elemento('div', 'nx-emo-abas');
    abas.setAttribute('role', 'toolbar');
    abas.setAttribute('aria-label', 'Categorias de emoji');

    const area = elemento('div', 'nx-emo-area');
    area.tabIndex = -1;
    const secoes = elemento('div', 'nx-emo-secoes');
    const resultados = elemento('div', 'nx-emo-resultados');
    resultados.hidden = true;
    area.append(secoes, resultados);

    // O rodapé: o emoji e o nome do que está sob o mouse ou o foco, e os tons de pele.
    const rodape = elemento('div', 'nx-emo-rodape');
    const previa = elemento('span', 'nx-emo-previa');
    previa.setAttribute('aria-hidden', 'true');
    const nome = elemento('span', 'nx-emo-nome', 'Escolha um emoji');
    nome.setAttribute('aria-hidden', 'true');
    const tonsEl = elemento('div', 'nx-emo-tons');
    tonsEl.setAttribute('role', 'radiogroup');
    tonsEl.setAttribute('aria-label', 'Tom de pele');
    rodape.append(previa, nome, tonsEl);

    const emojiDoItem = item => (item.tons && tom > 0 ? item.tons[tom - 1] : item.emoji);
    function botaoDe(item, { fixo = false, emoji = null } = {}) {
      const b = elemento('button', 'nx-emo-item', emoji || emojiDoItem(item));
      b.type = 'button';
      b.tabIndex = -1;
      b.title = capitalizar(item.nome);
      b.setAttribute('aria-label', capitalizar(item.nome));
      b.dataset.base = item.emoji;
      // Os do "usados por último" ficam como foram escolhidos; os da grade acompanham o tom.
      if (item.tons && !fixo) b.dataset.tom = '1';
      return b;
    }

    // ---------- Os usados por último, e as categorias ----------
    const recentesSecao = elemento('section', 'nx-emo-secao');
    recentesSecao.dataset.grupo = 'recentes';
    const recentesTitulo = elemento('h3', 'nx-emo-titulo', 'Usados por último');
    const recentesGrade = elemento('div', 'nx-emo-grade');
    recentesSecao.append(recentesTitulo, recentesGrade);
    function pintarRecentes() {
      const lembrados = ler(GUARDA_RECENTES, []).filter(e => typeof e === 'string' && dados.indice.has(e));
      recentesGrade.replaceChildren(...lembrados.map(e => botaoDe(dados.indice.get(e), { fixo: true, emoji: e })));
      recentesSecao.hidden = !lembrados.length;
      abaDeRecentes.hidden = !lembrados.length;
    }
    secoes.append(recentesSecao);
    const abaDeRecentes = elemento('button', 'nx-emo-aba');
    abaDeRecentes.type = 'button';
    abaDeRecentes.title = 'Usados por último';
    abaDeRecentes.setAttribute('aria-label', 'Usados por último');
    abaDeRecentes.innerHTML = svg('recentes');
    abaDeRecentes.dataset.alvo = 'recentes';
    abas.append(abaDeRecentes);

    const titulos = new Map([['recentes', recentesSecao]]);
    for (const g of dados.grupos) {
      const secao = elemento('section', 'nx-emo-secao');
      secao.dataset.grupo = g.id;
      const grade = elemento('div', 'nx-emo-grade');
      grade.append(...g.itens.map(item => botaoDe(item)));
      secao.append(elemento('h3', 'nx-emo-titulo', g.nome), grade);
      secoes.append(secao);
      titulos.set(g.id, secao);
      const aba = elemento('button', 'nx-emo-aba', g.icone);
      aba.type = 'button';
      aba.title = g.nome;
      aba.setAttribute('aria-label', g.nome);
      aba.dataset.alvo = g.id;
      abas.append(aba);
    }
    pintarRecentes();

    // Clicar numa categoria leva até ela. A rolagem é a da área (e não `scrollIntoView`, que rolaria também
    // a página); o título gruda no alto, então o início da seção é o que se alinha.
    abas.addEventListener('click', evento => {
      const aba = evento.target.closest('.nx-emo-aba');
      if (!aba) return;
      if (campo.value) { campo.value = ''; filtrar(); }
      const secao = titulos.get(aba.dataset.alvo);
      if (secao) area.scrollTo({ top: secao.offsetTop - 2, behavior: 'auto' });
    });
    let quadro = 0;
    function marcarAbaAtual() {
      quadro = 0;
      if (!resultados.hidden) { abas.querySelectorAll('.nx-emo-aba').forEach(a => a.removeAttribute('aria-current')); return; }
      let atual = null;
      for (const [id, secao] of titulos) if (!secao.hidden && secao.offsetTop - 12 <= area.scrollTop) atual = id;
      for (const aba of abas.querySelectorAll('.nx-emo-aba')) {
        if (aba.dataset.alvo === atual) aba.setAttribute('aria-current', 'true'); else aba.removeAttribute('aria-current');
      }
    }
    area.addEventListener('scroll', () => { if (!quadro) quadro = root.requestAnimationFrame(marcarAbaAtual); }, { passive: true });

    // ---------- Os tons de pele ----------
    function pintarTons() {
      tonsEl.replaceChildren(...TONS.map(([rotulo, cor], i) => {
        const b = elemento('button', 'nx-emo-tom');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === tom));
        b.setAttribute('aria-label', rotulo);
        b.title = rotulo;
        b.style.setProperty('--c', cor);
        b.addEventListener('click', () => {
          tom = i;
          gravar(GUARDA_TOM, tom);
          // Os da grade (e os resultados da busca) trocam de pele na hora; os usados por último não.
          area.querySelectorAll('.nx-emo-item[data-tom]').forEach(el => { const item = dados.indice.get(el.dataset.base); el.textContent = emojiDoItem(item); });
          pintarTons();
        });
        return b;
      }));
    }
    pintarTons();

    // ---------- A busca ----------
    // O nome e as palavras, sem acento e em qualquer ordem. Quem começa pelo que foi digitado vem primeiro.
    let espera = 0;
    campo.addEventListener('input', () => {
      limpar.hidden = !campo.value;
      clearTimeout(espera);
      espera = setTimeout(() => { espera = 0; filtrar(); }, 60);
    });
    limpar.addEventListener('click', () => { campo.value = ''; filtrar(); campo.focus(); });
    function filtrar() {
      limpar.hidden = !campo.value;
      const consulta = semAcento(campo.value.trim());
      secoes.hidden = Boolean(consulta);
      resultados.hidden = !consulta;
      area.scrollTop = 0;
      if (!consulta) { marcarAbaAtual(); return; }
      const palavras = consulta.split(/\s+/).filter(Boolean);
      const achados = dados.todos
        .filter(item => palavras.every(p => item.busca.includes(p)))
        .map(item => ({
          item,
          ordem: item.nomeSemAcento.startsWith(palavras[0]) ? 0 : item.nomeSemAcento.includes(` ${palavras[0]}`) ? 1 : 2,
          popular: POPULARES.includes(item.emoji) ? POPULARES.indexOf(item.emoji) : POPULARES.length
        }))
        .sort((a, b) => a.ordem - b.ordem || a.popular - b.popular)
        .slice(0, RESULTADOS_MAXIMOS);
      if (!achados.length) {
        resultados.replaceChildren(elemento('p', 'nx-emo-vazio', `Nenhum emoji para “${campo.value.trim()}”.`));
        return;
      }
      const secao = elemento('section', 'nx-emo-secao');
      const grade = elemento('div', 'nx-emo-grade');
      grade.append(...achados.map(({ item }) => botaoDe(item)));
      secao.append(elemento('h3', 'nx-emo-titulo', achados.length === 1 ? '1 resultado' : `${achados.length} resultados`), grade);
      resultados.replaceChildren(secao);
      // O primeiro resultado é o que o Tab alcança (o da grade das categorias está escondido).
      grade.firstElementChild.tabIndex = 0;
    }

    // ---------- Escolher, e o nome embaixo ----------
    area.addEventListener('click', evento => {
      const botao = evento.target.closest('.nx-emo-item');
      if (!botao) return;
      ponte.escolher(botao.textContent, evento.shiftKey);
      if (evento.shiftKey) pintarRecentes();
    });
    const mostrar = botao => {
      const item = botao && dados.indice.get(botao.dataset.base);
      if (!item) return;
      previa.textContent = botao.textContent;
      nome.textContent = capitalizar(item.nome);
    };
    area.addEventListener('mouseover', evento => mostrar(evento.target.closest('.nx-emo-item')));
    area.addEventListener('focusin', evento => mostrar(evento.target.closest('.nx-emo-item')));

    // ---------- O teclado na grade ----------
    // Uma peça da grade de cada vez na ordem do Tab (as outras ficam em -1): as setas andam por ela. Para
    // cima e para baixo vale o desenho, e não a conta -- as categorias têm tamanhos diferentes.
    const itensVisiveis = () => [...area.querySelectorAll('.nx-emo-item')].filter(el => el.getClientRects().length);
    function vizinho(atual, direcao) {
      const itens = itensVisiveis();
      const i = itens.indexOf(atual);
      if (direcao === 'direita') return itens[i + 1];
      if (direcao === 'esquerda') return itens[i - 1];
      const r = atual.getBoundingClientRect();
      const centro = r.left + r.width / 2;
      const candidatos = itens.filter(el => (direcao === 'baixo' ? el.getBoundingClientRect().top > r.top + 4 : el.getBoundingClientRect().top < r.top - 4));
      if (!candidatos.length) return null;
      const faixa = direcao === 'baixo' ? Math.min(...candidatos.map(el => el.getBoundingClientRect().top)) : Math.max(...candidatos.map(el => el.getBoundingClientRect().top));
      return candidatos.filter(el => Math.abs(el.getBoundingClientRect().top - faixa) < 4)
        .sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - centro) - Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - centro))[0];
    }
    function irPara(botao) {
      if (!botao) return;
      area.querySelectorAll('.nx-emo-item[tabindex="0"]').forEach(el => { el.tabIndex = -1; });
      botao.tabIndex = 0;
      botao.focus();
    }
    area.addEventListener('keydown', evento => {
      const atual = evento.target.closest('.nx-emo-item');
      if (!atual) return;
      const direcao = { ArrowRight: 'direita', ArrowLeft: 'esquerda', ArrowDown: 'baixo', ArrowUp: 'cima' }[evento.key];
      if (direcao) {
        evento.preventDefault();
        const proximo = vizinho(atual, direcao);
        if (proximo) irPara(proximo); else if (direcao === 'cima') campo.focus();
      } else if (evento.key === 'Home' || evento.key === 'End') {
        evento.preventDefault();
        const itens = itensVisiveis();
        irPara(evento.key === 'Home' ? itens[0] : itens.at(-1));
      }
    });
    campo.addEventListener('keydown', evento => {
      if (evento.key === 'ArrowDown') { evento.preventDefault(); irPara(itensVisiveis()[0]); }
      else if (evento.key === 'Enter') {
        // Enter na busca escolhe o primeiro resultado: digitar "coracao" e Enter é o caminho curto. Quem
        // digita depressa aperta o Enter antes de o filtro rodar (ele espera 60 ms para não refazer a
        // lista a cada letra): sem aplicá-lo agora, o Enter escolheria da lista da letra anterior.
        evento.preventDefault();
        if (espera) { clearTimeout(espera); espera = 0; filtrar(); }
        const primeiro = campo.value.trim() ? resultados.querySelector('.nx-emo-item') : null;
        if (primeiro) ponte.escolher(primeiro.textContent, evento.shiftKey);
      }
    });
    // O primeiro da grade é o que o Tab alcança.
    (area.querySelector('.nx-emo-item'))?.setAttribute('tabindex', '0');

    raiz.append(topo, abas, area, rodape);
    // A aba da categoria de cima, desde o começo.
    root.requestAnimationFrame(marcarAbaAtual);
    return raiz;
  }

  root.NexoEmojis = { abrir, botaoDeCampo, inserir, carregar, ICONE };
})(window);
