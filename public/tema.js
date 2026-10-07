/* O tema do Nexo: claro ou escuro, um tema pronto e, para quem pode, as cores exatas.
 *
 * Roda no <head> de toda página, ANTES da primeira pintura: ler a escolha depois de a página
 * aparecer faria um tema claro nascer escuro e piscar para branco a cada navegação.
 *
 * ---------- Uma cor vira uma paleta ----------
 *
 * A pessoa escolhe duas coisas, no máximo: a cor de destaque e o tom do fundo. Todo o resto --
 * o botão cheio, o texto em destaque, o anel de foco, as seis camadas de superfície, os seis
 * níveis de texto -- sai delas por conta, com o contraste conferido. É o que deixa um seletor de
 * cor livre ser seguro: não existe escolha que produza texto ilegível, porque o texto nunca é
 * a cor escolhida, é a cor escolhida levada até o contraste que ele precisa.
 *
 *   - o botão cheio leva texto branco, então escurece até 4,5:1 com o branco;
 *   - o texto em destaque clareia (no escuro) ou escurece (no claro) até 4,5:1 com o painel;
 *   - as superfícies têm a luminosidade FIXA de cada camada; do fundo escolhido vêm só o matiz
 *     e a saturação -- e, no fundo exato escolhido, a luminosidade da camada principal.
 *
 * O tema padrão (Nexo, escuro) não calcula nada: os valores dele estão em tema.css, e a página
 * sem JavaScript continua igual a sempre.
 *
 * Arquivo para a página e para os testes, como perfil.js.
 */
(function (root) {
  const CHAVE = 'nexo.pref.aparencia';
  // O último "pode usar cores exatas" que a página soube. O plano só chega depois da conta, e
  // o tema precisa ser pintado antes: quem escolheu cores exatas não pode ver o fundo trocar de cor a cada
  // carregamento enquanto a conta responde.
  const CHAVE_DA_PERMISSAO = 'nexo.pref.coresLivres';
  // A cor do fundo do tema de agora (`--bg`), para o <head> da página seguinte pintar o <html> antes de
  // qualquer arquivo chegar. Só existe quando o tema NÃO é o de sempre: o de sempre é o fundo escuro
  // que o próprio <head> já tem por padrão.
  const CHAVE_DO_FUNDO = 'nexoFundo';

  // ---------- Os temas prontos ----------
  // Quatro escuros e quatro claros. `fundo` é matiz e saturação das superfícies; `luz` desloca
  // a luminosidade de todas elas (o Carvão é o Nexo quase preto, para tela OLED e sala escura).
  const TEMAS = Object.freeze([
    { id: 'nexo', nome: 'Nexo', modo: 'escuro', fundo: { h: 235, s: 18 }, destaque: '#8879f6' },
    { id: 'meia-noite', nome: 'Meia-noite', modo: 'escuro', fundo: { h: 222, s: 32, luz: -2 }, destaque: '#4f9dff' },
    { id: 'floresta', nome: 'Floresta', modo: 'escuro', fundo: { h: 165, s: 14 }, destaque: '#3fc98f' },
    { id: 'carvao', nome: 'Carvão', modo: 'escuro', fundo: { h: 240, s: 5, luz: -5 }, destaque: '#b3a6ff' },
    { id: 'claro', nome: 'Claro', modo: 'claro', fundo: { h: 235, s: 22 }, destaque: '#6c5ce7' },
    { id: 'ceu', nome: 'Céu', modo: 'claro', fundo: { h: 210, s: 40 }, destaque: '#2f7de1' },
    { id: 'areia', nome: 'Areia', modo: 'claro', fundo: { h: 36, s: 32 }, destaque: '#d2742b' },
    { id: 'sakura', nome: 'Sakura', modo: 'claro', fundo: { h: 340, s: 34 }, destaque: '#e0558e' }
  ]);
  const TEMA_PADRAO = 'nexo';

  // As cores de destaque de um clique, livres para todo mundo.
  const DESTAQUES = Object.freeze({
    violeta: '#8879f6', azul: '#4f9dff', turquesa: '#2cbfb6', verde: '#3fc98f',
    ambar: '#e8a33d', coral: '#f2735f', rosa: '#e8619c', ameixa: '#b07ad6'
  });
  const NOMES_DOS_DESTAQUES = Object.freeze({
    violeta: 'Violeta', azul: 'Azul', turquesa: 'Turquesa', verde: 'Verde',
    ambar: 'Âmbar', coral: 'Coral', rosa: 'Rosa', ameixa: 'Ameixa'
  });
  const MODOS = Object.freeze(['escuro', 'claro', 'sistema']);

  // ---------- Cor ----------
  const hexValido = valor => (typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : null);

  function hexParaRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbParaHex([r, g, b]) {
    return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  }
  function rgbParaHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l * 100];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s * 100, l * 100];
  }
  function hslParaHex(h, s, l) {
    s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgbParaHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  // Luminância relativa e contraste da WCAG: é por eles que "legível" deixa de ser opinião.
  function luminancia(hex) {
    const canal = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = hexParaRgb(hex).map(canal);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contraste(a, b) {
    const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }
  // Anda a luminosidade da cor, em passos de 1%, até ela ter o contraste pedido contra `fundo`.
  // `sentido` +1 clareia, -1 escurece. Se nem no extremo alcança, fica no extremo.
  function levarAteContraste(hex, fundo, alvo, sentido) {
    const [h, s, l0] = rgbParaHsl(hexParaRgb(hex));
    for (let l = l0; l >= 0 && l <= 100; l += sentido) {
      const cor = hslParaHex(h, s, l);
      if (contraste(cor, fundo) >= alvo) return cor;
    }
    return hslParaHex(h, s, sentido > 0 ? 100 : 0);
  }
  const mudarLuz = (hex, delta) => { const [h, s, l] = rgbParaHsl(hexParaRgb(hex)); return hslParaHex(h, s, l + delta); };
  const comAlfa = (hex, alfa) => `${hex}${Math.round(alfa * 255).toString(16).padStart(2, '0')}`;

  // ---------- As camadas ----------
  // Luminosidade de cada superfície, da mais funda à mais alta. No claro a ordem das três
  // últimas se inverte de propósito: são as cores de "passar o mouse" e de botão secundário,
  // que precisam ficar MAIS escuras que o cartão branco em que aparecem.
  const CAMADAS = {
    escuro: { fundo: 9, 0: 11, bg: 12, 1: 13.5, 2: 15.5, cartao: 17.5, 3: 20, 4: 25, 5: 30 },
    claro: { fundo: 83, 0: 93, bg: 95.5, 1: 98.5, 2: 100, cartao: 100, 3: 91.5, 4: 88, 5: 84 }
  };
  const TEXTOS = {
    escuro: { text: [95, 26], 'text-2': [84, 20], 'text-3': [75, 16], muted: [68, 12], faint: [60, 12], apagado: [48, 10] },
    claro: { text: [13, 22], 'text-2': [23, 18], 'text-3': [31, 14], muted: [38, 12], faint: [43, 10], apagado: [62, 8] }
  };
  const NOMES_DAS_CAMADAS = { fundo: '--bg-fundo', 0: '--bg-0', bg: '--bg', 1: '--bg-1', 2: '--bg-2', cartao: '--bg-cartao', 3: '--bg-3', 4: '--bg-4', 5: '--bg-5' };

  // As cores que dependem do modo e não da escolha: verde de conectado, vermelho de perigo,
  // âmbar de aviso. No claro elas escurecem -- o verde-menta do escuro some num fundo branco.
  const SEMANTICAS = {
    escuro: {
      '--online': '#90dfb3', '--online-texto': '#a6e7c4', '--danger': '#f07583', '--danger-texto': '#ff98a4',
      '--aviso': '#e8c07a', '--aviso-texto': '#f1d58c', '--laranja-texto': '#f0b98a', '--rosa': '#e87fa3', '--rosa-texto': '#ffa6bd'
    },
    claro: {
      '--online': '#23965f', '--online-texto': '#1b7a4b', '--danger': '#d23b4f', '--danger-texto': '#b8283d',
      '--aviso': '#b8841f', '--aviso-texto': '#855b00', '--laranja-texto': '#a24f14', '--rosa': '#d2477a', '--rosa-texto': '#b12e62'
    }
  };

  // Tudo o que um modo, um fundo e um destaque produzem, como propriedades CSS.
  function derivar({ modo, fundo, destaque }) {
    const escuro = modo !== 'claro';
    const tipo = escuro ? 'escuro' : 'claro';
    const props = {};
    // Saturação das superfícies: a do tema, amortecida no claro (um fundo claro muito saturado
    // vira cor, não fundo) e com teto nos dois. O fundo exato escolhido não passa por isso: a
    // cor escolhida é a que aparece.
    const sat = fundo.exato ? fundo.s : Math.min(escuro ? 40 : 45, Math.max(0, fundo.s) * (escuro ? 1 : 0.8));
    // A luminosidade da camada principal pode vir de um fundo exato; as outras andam junto.
    const base = CAMADAS[tipo];
    let deslocamento = Number.isFinite(fundo.l)
      ? Math.max(escuro ? -8 : -12, Math.min(escuro ? 10 : 4, fundo.l - base.bg))
      : (fundo.luz || 0);
    // Luminosidade HSL não é luminância: um amarelo a 22% já é claro demais para um fundo escuro
    // (o branco dá 5:1 sobre ele). As camadas andam juntas até o texto extremo -- branco no
    // escuro, quase preto no claro -- ter folga de sobra na superfície menos favorável: o
    // cartão, a mais clara das que levam texto no escuro; o campo de digitar, a mais escura no claro.
    const extremo = escuro ? '#ffffff' : '#16161f';
    const camadaCritica = escuro ? base.cartao : base[0];
    for (let passo = 0; passo < 80 && contraste(extremo, hslParaHex(fundo.h, sat, Math.max(2, Math.min(100, camadaCritica + deslocamento)))) < 10; passo++) {
      deslocamento += escuro ? -0.5 : 0.5;
    }
    for (const [camada, luz] of Object.entries(base)) {
      // A mais funda de todas não passa do preto; a mais alta do claro não passa do branco.
      props[NOMES_DAS_CAMADAS[camada]] = hslParaHex(fundo.h, sat, Math.max(2, Math.min(100, luz + deslocamento)));
    }
    // O texto parte de uma luminosidade fixa, e é levado até o contraste que cada nível pede
    // contra a superfície menos favorável em que ele aparece -- o cartão no escuro, o campo de
    // digitar no claro. Um fundo exato muito claro (ou muito escuro) empurra o texto junto, em
    // vez de deixá-lo sumir.
    const ALVOS = { text: 7, 'text-2': 6, 'text-3': 5, muted: 4.6, faint: 4.6 };
    const pior = escuro ? props['--bg-cartao'] : props['--bg-0'];
    for (const [nome, [luz, s]] of Object.entries(TEXTOS[tipo])) {
      const cor = hslParaHex(fundo.h, Math.min(s, 8 + sat * 0.6), luz);
      props[`--${nome}`] = ALVOS[nome] && contraste(cor, pior) < ALVOS[nome] ? levarAteContraste(cor, pior, ALVOS[nome], escuro ? 1 : -1) : cor;
    }
    // A "tinta" das sobreposições translúcidas: branco no escuro, quase preto no claro. Uma
    // borda de 7% de branco num painel escuro e de 7% de tinta num claro dizem a mesma coisa.
    const tinta = escuro ? [255, 255, 255] : hexParaRgb(hslParaHex(fundo.h, 30, 12));
    props['--tinta'] = tinta.join(' ');
    props['--line'] = `rgb(${tinta.join(' ')} / ${escuro ? 5 : 8}%)`;
    props['--line-2'] = `rgb(${tinta.join(' ')} / ${escuro ? 9 : 12}%)`;
    props['--line-3'] = `rgb(${tinta.join(' ')} / ${escuro ? 15 : 18}%)`;

    // O destaque: a cor escolhida é a de borda e ícone; o resto sai dela com contraste garantido.
    const painel = props['--bg-1'];
    let accent = destaque;
    // No claro, um destaque muito claro (um âmbar, um verde-limão) não aparece como borda.
    if (!escuro && contraste(accent, painel) < 3) accent = levarAteContraste(accent, painel, 3, -1);
    const forte = levarAteContraste(accent, '#ffffff', 4.6, -1);
    props['--accent'] = accent;
    props['--accent-hi'] = escuro ? mudarLuz(accent, 6) : mudarLuz(accent, -6);
    props['--accent-forte'] = forte;
    // Passar o mouse clareia no escuro e escurece no claro. O estado dura o tempo de um gesto,
    // então aceita um pouco menos de contraste -- o mesmo que o violeta de sempre (4,1:1).
    const vizinho = mudarLuz(forte, escuro ? 4 : -5);
    props['--accent-forte-hi'] = contraste(vizinho, '#ffffff') >= 3.9 ? vizinho : forte;
    props['--accent-suave'] = comAlfa(accent, escuro ? 0.12 : 0.1);
    props['--accent-suave-hi'] = comAlfa(accent, escuro ? 0.2 : 0.16);
    // No escuro o texto em destaque fica claro como o lilás de sempre (≈10:1); no claro, o
    // bastante para texto miúdo.
    props['--accent-texto'] = escuro ? levarAteContraste(accent, painel, 8.5, 1) : levarAteContraste(accent, painel, 4.8, -1);
    props['--anel-cor'] = escuro ? mudarLuz(accent, 10) : forte;
    // O que é vídeo fica escuro mesmo no tema claro (tema.css, `.contexto-escuro`), e o destaque
    // lá dentro precisa da versão clara da cor -- a do claro some sobre um vídeo escuro.
    if (!escuro) {
      const painelEscuro = '#1c1d28';
      props['--accent-hi-escuro'] = contraste(mudarLuz(destaque, 6), painelEscuro) >= 4.5 ? mudarLuz(destaque, 6) : levarAteContraste(destaque, painelEscuro, 4.5, 1);
      props['--accent-texto-escuro'] = levarAteContraste(destaque, painelEscuro, 8.5, 1);
      props['--anel-cor-escuro'] = levarAteContraste(destaque, painelEscuro, 6, 1);
    }
    Object.assign(props, SEMANTICAS[tipo]);
    return props;
  }

  // ---------- Escolha guardada -> tema efetivo ----------
  const temaPorId = id => TEMAS.find(t => t.id === id) || TEMAS.find(t => t.id === TEMA_PADRAO);

  function lerEscolha() {
    try { return JSON.parse(root.localStorage?.getItem(CHAVE) || 'null') || {}; } catch (_) { return {}; }
  }
  function lerPermissao() {
    try { return root.localStorage?.getItem(CHAVE_DA_PERMISSAO) === '1'; } catch (_) { return false; }
  }

  // O modo "sistema" segue o aparelho, e acompanha a troca sem recarregar.
  const consultaDoSistema = root.matchMedia ? root.matchMedia('(prefers-color-scheme: light)') : null;
  function modoEfetivo(modo) {
    if (modo === 'sistema') return consultaDoSistema?.matches ? 'claro' : 'escuro';
    return modo === 'claro' ? 'claro' : 'escuro';
  }

  // O que vale de fato. As cores exatas só entram com permissão; sem ela ficam guardadas e
  // voltam sozinhas quando o plano volta -- como a qualidade de quem perdeu o nível completo.
  function resolver(escolha = {}, { coresLivres = false } = {}) {
    const tema = temaPorId(escolha.tema);
    const modoEscolhido = MODOS.includes(escolha.modo) ? escolha.modo : tema.modo;
    const modo = modoEfetivo(modoEscolhido);
    const fundo = { ...tema.fundo };
    let destaque = DESTAQUES[escolha.destaque] || tema.destaque;
    const exatas = coresLivres && escolha.cores ? escolha.cores : null;
    if (hexValido(exatas?.destaque)) destaque = hexValido(exatas.destaque);
    if (hexValido(exatas?.fundo)) {
      const [h, s, l] = rgbParaHsl(hexParaRgb(hexValido(exatas.fundo)));
      Object.assign(fundo, { h, s, l, luz: 0, exato: true });
    }
    // O padrão de sempre não calcula nada: tema.css já tem os valores exatos.
    const padrao = tema.id === TEMA_PADRAO && modo === 'escuro' && destaque === tema.destaque && !hexValido(exatas?.fundo);
    return { tema: tema.id, modoEscolhido, modo, fundo, destaque, padrao };
  }

  const aplicadas = new Set();
  function aplicar(escolha = lerEscolha(), opcoes = { coresLivres: lerPermissao() }) {
    const doc = root.document?.documentElement;
    if (!doc) return null;
    const efetivo = resolver(escolha, opcoes);
    doc.dataset.modo = efetivo.modo;
    doc.dataset.tema = efetivo.tema;
    // "Menos animação" é da aparência e vale em toda página, não só na sala: o início e a conta
    // também animam, e quem pediu menos movimento pediu para o Nexo inteiro (tema.css).
    doc.classList.toggle('menos-movimento', escolha.menosMovimento === true);
    doc.style.colorScheme = efetivo.modo === 'claro' ? 'light' : 'dark';
    aplicadas.forEach(nome => doc.style.removeProperty(nome));
    aplicadas.clear();
    // O `--bg` posto pelo trecho do <head> (a cor da última vez) sai: quem manda agora é o tema de agora.
    doc.style.removeProperty('--bg');
    const paleta = efetivo.padrao ? null : derivar(efetivo);
    if (paleta) {
      for (const [nome, valor] of Object.entries(paleta)) { doc.style.setProperty(nome, valor); aplicadas.add(nome); }
    }
    // A barra do navegador no celular acompanha o fundo.
    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = paleta ? paleta['--bg'] : '#191a24';
    // A cor do fundo fica guardada para a PRÓXIMA página, que a usa antes de qualquer arquivo chegar: o
    // <head> de cada página pinta o <html> com ela (`--bg`), e é isso que impede o canvas de aparecer
    // branco -- num tema escuro, ou num claro --, nos instantes entre a página velha sair e a nova pintar.
    try {
      if (paleta) root.localStorage?.setItem(CHAVE_DO_FUNDO, paleta['--bg']);
      else root.localStorage?.removeItem(CHAVE_DO_FUNDO);
    } catch (_) { /* sem a dica, o fundo escuro de sempre */ }
    return efetivo;
  }

  // Trocar de tema de uma vez é um clarão; as cores deslizam por um instante, só na troca.
  function aplicarComTransicao(escolha, opcoes) {
    const doc = root.document?.documentElement;
    doc?.classList.add('trocando-tema');
    const efetivo = aplicar(escolha, opcoes);
    clearTimeout(aplicarComTransicao.timer);
    aplicarComTransicao.timer = setTimeout(() => doc?.classList.remove('trocando-tema'), 320);
    return efetivo;
  }

  function definirPermissao(pode) {
    try { root.localStorage?.setItem(CHAVE_DA_PERMISSAO, pode ? '1' : '0'); } catch (_) { /* vale só agora */ }
  }

  const api = {
    TEMAS, TEMA_PADRAO, DESTAQUES, NOMES_DOS_DESTAQUES, MODOS, CHAVE,
    hexValido, contraste, derivar, resolver, aplicar, aplicarComTransicao, lerEscolha, lerPermissao, definirPermissao, temaPorId
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.NexoTema = api;
  aplicar();

  // A troca de página animada (chassi.css) só acontece quando as DUAS páginas aderem; o início e a sala
  // aderem, e a apresentação, a conta e o 404 não. Quando a página de destino não participa, o navegador
  // pula a transição e rejeita as promessas dela com "Transition was skipped" -- e uma rejeição que ninguém
  // ouve vira erro na página (no console, e no `pageerror` dos testes). Pular não é erro: a navegação foi
  // normal. Por isso a escuta mora aqui, no <head> de toda página, e não só nas duas que aderem. O filtro
  // do `unhandledrejection` é só para esse erro: qualquer outro continua aparecendo.
  const ehTransicaoPulada = motivo => motivo?.name === 'AbortError' && /Transition was skipped/i.test(String(motivo.message || ''));
  const calarTransicao = evento => {
    const transicao = evento.viewTransition;
    if (!transicao) return;
    for (const promessa of [transicao.ready, transicao.finished, transicao.updateCallbackDone]) promessa?.catch?.(() => {});
  };
  root.addEventListener('pageswap', calarTransicao);
  root.addEventListener('pagereveal', calarTransicao);
  root.addEventListener('unhandledrejection', evento => { if (ehTransicaoPulada(evento.reason)) evento.preventDefault(); });
  consultaDoSistema?.addEventListener?.('change', () => { if (lerEscolha().modo === 'sistema') aplicarComTransicao(); });
  // Outra aba mudou o tema: esta acompanha.
  root.addEventListener('storage', evento => { if (evento.key === CHAVE || evento.key === CHAVE_DA_PERMISSAO) aplicar(); });
})(typeof window === 'undefined' ? globalThis : window);
