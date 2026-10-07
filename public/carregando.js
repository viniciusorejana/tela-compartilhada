/* A tela de carregamento do Nexo (docs/interface.md, 4.19).
 *
 * Síncrono, no <head>, depois do tema.js: a tela precisa existir antes da primeira pintura da página, para
 * a pessoa ver o Nexo -- e não uma página pela metade -- enquanto ela abre. Ela aparece em três momentos:
 *
 *   - a página abre (`chegando`): a tela nasce com a página e some quando a página diz que está pronta
 *     (`concluir()`), ou sozinha no DOMContentLoaded nas páginas que não têm o que esperar;
 *   - a pessoa sai da página (`navegando`): sair da sala, entrar numa sala, abrir a conta. A tela acende na
 *     página que sai e deixa um recado (`sessionStorage`); a página que chega a abre já acesa e continua de onde
 *     o andamento parou -- as duas telas parecem uma só;
 *   - o aplicativo abre (app/carregando.html, que tem o mesmo desenho).
 *
 * Calma (docs/interface.md, 1): a tela só se acende depois de uma fração de segundo. Uma página que abre depressa
 * não a mostra nunca, e uma que ainda está abrindo mostra um Nexo que anda: o anel enche com o que de fato já
 * carregou (e, entre um sinal e outro, devagar, para a barra nunca parecer parada), a etapa diz o que falta, e uma
 * dica rotaciona. Quem quiser, pega as faíscas que passam: cada dez sobem o nível, só aqui, só neste navegador.
 *
 * Progressiva: a espera não é sempre do mesmo tamanho (sair de uma sala dura meio segundo; abrir o aplicativo
 * numa rede ruim, dez), e a tela não finge que é. Ela nasce MÍNIMA -- só a marca com o anel, sem uma palavra -- e,
 * conforme a espera se alonga, vai se completando em fusão (`data-nivel`): no 2, o título e a etapa; no 3, a
 * barra de XP, a dica, a órbita, as faíscas. Quem espera pouco nunca vê mais que a marca, e some depressa. O
 * relógio é o da ESPERA, e não o da página: ele atravessa a troca de página junto com o recado.
 *
 * Nunca prende ninguém: depois de alguns segundos ela admite que está demorando e oferece "Tentar de novo", e
 * depois de mais alguns sai sozinha e deixa a página como está.
 *
 * Em quadro (a camada do início por cima da sala) não há tela cheia: a camada tem a espera dela.
 */
(() => {
  const raiz = document.documentElement;
  const CHAVE_DA_TRAVESSIA = 'nexo.carregando';
  const CHAVE_DAS_FAISCAS = 'nexoFaiscas';
  const CHAVE_DA_DICA = 'nexoDicaVista';
  const VALIDADE_DO_RECADO_MS = 8000;
  const CIRCUNFERENCIA = 2 * Math.PI * 76;   // o anel do emblema tem 76 de raio (carregando.css)
  const SEGMENTOS = 12;
  const ESTRELA = '<svg class="nx-estrela" viewBox="38 10 12 12" aria-hidden="true"><path d="m44 10 1.7 4.3L50 16l-4.3 1.7L44 22l-1.7-4.3L38 16l4.3-1.7z"/></svg>';
  // A marca, em linha: a imagem tem de estar na primeira pintura, e um <img> ainda por baixar apareceria vazio.
  // O violeta e o verde da marca são cor de ilustração e não mudam com o tema.
  const MARCA = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="20" fill="#8174fa"/><path d="M18 45V19h7l14 17V19h7v26h-7L25 28v17z" fill="#fff"/><path d="m44 10 1.7 4.3L50 16l-4.3 1.7L44 22l-1.7-4.3L38 16l4.3-1.7z" fill="#d1ffc1"/></svg>';

  // Só frases que o Nexo cumpre hoje (cada uma tem teste ou seção em docs/interface.md).
  const DICAS = [
    'Ctrl K abre a busca de amigos e de salas — até no meio de uma chamada.',
    'Clique no número do volume para digitar o valor exato, de 0 a 200%.',
    'Arraste a borda do chat para deixá-lo do tamanho que você preferir. O Nexo lembra.',
    'A mesa de sons toca um som para a sala toda: um de cada pessoa por vez.',
    'Ctrl+Shift+M liga e desliga o microfone, e Ctrl+Shift+D, o fone.',
    'Seu cartão de perfil aparece para todo mundo na sala: borda, moldura, bolha e conquistas.',
    'Com uma conta você vê em que sala os amigos estão e entra com um clique.',
    'O botão Focar do chat esconde o palco e deixa só a conversa.',
    'No aplicativo de mesa, o som do sistema vai junto com a tela compartilhada.',
    'Passe o mouse numa mensagem para reagir com qualquer emoji.',
    '"Menos animação", nas configurações, deixa o Nexo mais quieto.'
  ];
  const DICA_DAS_FAISCAS = 'Pegue as faíscas que passam: a cada dez, o seu nível sobe.';

  // Os tempos, em ms. Um teste os encurta antes de a página carregar (`window.NexoCarregandoAjustes`, posto por um
  // script de início) -- a espera de verdade, de 12 s, não cabe num teste.
  // `nivel2` e `nivel3` são os instantes, desde que a ESPERA começou, em que a tela ganha o título e depois o resto;
  // `minimoVisivel` é quanto o nível 3 segura a tela depois de pronta (a marca dá o pulinho); os níveis 1 e 2 saem
  // mais depressa (`SAIDA_POR_NIVEL`).
  let ajustes = { atraso: 220, atrasoAoSair: 160, devagar: 12000, desistir: 24000, desistirAoSair: 10000, minimoVisivel: 380, nivel2: 1200, nivel3: 3000, ...(window.NexoCarregandoAjustes || {}) };
  // Depois de pronta: [quanto a tela se segura desde que ficou visível, quanto dura a fusão para fora], em ms. Quanto menos
  // a tela mostrou, menos ela se demora: a marca sozinha se vai logo, e o nível 3 comemora ("Pronto") antes.
  const SAIDA_POR_NIVEL = { 1: [260, 200], 2: [320, 280] };
  const reduzido = () => raiz.classList.contains('menos-movimento') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let emQuadro = false;
  try { emQuadro = window.parent !== window; } catch (_) { emQuadro = true; }
  // Dentro dos aplicativos (o de mesa e o Android) a splash do aplicativo acabou de cobrir a abertura -- app/splash.html,
  // `docs/interface.md` 4.21 --, e a página nasce com a tela de carregamento JÁ acesa, sem os 220 ms de espera: a passagem
  // da splash para ela (a mesma marca, o mesmo fundo) não deixa um vazio no meio. `appNativo` é do preload do Electron; o
  // Android se anuncia no user agent ("NexoAndroid/1.2.0", app-android.js).
  const emAplicativo = Boolean(window.appNativo) || /\bNexoAndroid\//.test(navigator.userAgent || '');

  // ---------- O esqueleto ----------
  // Serve em qualquer página, também em quadro: o lugar de uma lista que ainda não chegou.
  function esqueleto(tipo = 'amigos', quantos = 4) {
    const caixa = document.createElement('div');
    caixa.className = 'nx-esq-lista';
    caixa.setAttribute('aria-hidden', 'true');
    const peca = classe => { const e = document.createElement('span'); e.className = `nx-esq ${classe}`; return e; };
    // O cartão de perfil: o banner, o avatar que sobe por cima dele e as linhas do nome e da frase.
    if (tipo === 'cartao') {
      caixa.className = 'nx-esq-cartao';
      const textos = document.createElement('div');
      textos.className = 'nx-esq-textos';
      textos.append(peca('linha'), peca('linha'), peca('linha'));
      caixa.append(peca('banner'), peca('avatar grande'), textos);
      return caixa;
    }
    if (tipo === 'cartoes') {
      caixa.classList.add('nx-esq-grade');
      for (let i = 0; i < quantos; i++) caixa.append(peca('bloco'));
      return caixa;
    }
    for (let i = 0; i < quantos; i++) {
      const linha = document.createElement('div');
      linha.className = 'nx-esq-item';
      if (tipo === 'linhas') { linha.append(peca('linha')); linha.firstChild.style.width = `${88 - ((i * 17) % 40)}%`; caixa.append(linha); continue; }
      const textos = document.createElement('div');
      textos.className = 'nx-esq-textos';
      textos.append(peca('linha'), peca('linha'));
      linha.append(peca(`avatar${tipo === 'conversas' ? ' quadrado' : ''}`), textos);
      caixa.append(linha);
    }
    return caixa;
  }

  if (emQuadro) {
    window.NexoCarregando = Object.freeze({ mostrar() {}, navegando() {}, etapa() {}, concluir() {}, configurar() {}, tituloDe: () => '', ativo: () => false, esqueleto });
    return;
  }

  // ---------- O que a tela diz ----------
  const codigoDaSala = caminho => (caminho.match(/^\/([a-z0-9_-]{4,32})\/sala\/?$/i) || [])[1] || null;
  function tituloDoCaminho(caminho, deOnde = '') {
    const sala = codigoDaSala(caminho);
    if (sala) return `Entrando em #${sala}`;
    if (/^\/conta\/?$/.test(caminho)) return 'Abrindo a sua conta';
    if (caminho === '/' && codigoDaSala(deOnde)) return 'Saindo da sala';
    return 'Abrindo o Nexo';
  }
  const ETAPAS = [[0, 'Carregando o Nexo'], [0.35, 'Preparando as telas'], [0.7, 'Quase lá']];
  const etapaDoAndamento = p => ETAPAS.reduce((texto, [minimo, frase]) => (p >= minimo ? frase : texto), ETAPAS[0][1]);

  // ---------- O recado entre a página que sai e a que chega ----------
  function gravarRecado(dados) {
    try { sessionStorage.setItem(CHAVE_DA_TRAVESSIA, JSON.stringify({ ...dados, em: Date.now() })); } catch (_) { /* sem recado, a página que chega acende devagar */ }
  }
  function lerRecado() {
    try {
      const dados = JSON.parse(sessionStorage.getItem(CHAVE_DA_TRAVESSIA) || 'null');
      sessionStorage.removeItem(CHAVE_DA_TRAVESSIA);
      return dados && Date.now() - dados.em < VALIDADE_DO_RECADO_MS ? dados : null;
    } catch (_) { return null; }
  }

  // ---------- As faíscas e o nível ----------
  const lerFaiscas = () => { try { return Math.max(0, parseInt(localStorage.getItem(CHAVE_DAS_FAISCAS), 10) || 0); } catch (_) { return 0; } };
  const gravarFaiscas = n => { try { localStorage.setItem(CHAVE_DAS_FAISCAS, String(Math.min(n, 1e6))); } catch (_) { /* vale só agora */ } };
  const nivelDe = faiscas => 1 + Math.floor(faiscas / 10);
  const entre = (a, b) => a + Math.random() * (b - a);

  // ---------- A tela ----------
  let tela = null;
  let progresso = 0;           // o que está desenhado agora; nunca diminui
  let piso = 0;                // o que a página já provou (carregou isto, aquilo)
  let comecouEm = 0;           // quando a ESPERA começou (atravessa a troca de página: ver o recado)
  let visivelDesde = 0;        // quando a tela se acendeu de verdade
  let nivel = 0;               // 1 mínima, 2 com título, 3 completa
  let saindo = false;
  let concluindo = false;
  let etapaEscolhida = '';
  let temporizadores = [];
  let faiscas = lerFaiscas();

  const depois = (fazer, ms) => { const id = setTimeout(fazer, ms); temporizadores.push(id); return id; };
  const sempre = (fazer, ms) => { const id = setInterval(fazer, ms); temporizadores.push(id); return id; };
  const $ = seletor => tela?.querySelector(seletor);

  function desenharNivel(subiu) {
    const chip = $('.nx-nivel');
    if (!chip) return;
    chip.hidden = faiscas === 0;
    chip.querySelector('span').textContent = `Nv ${nivelDe(faiscas)} · ${faiscas}`;
    chip.title = `Nível ${nivelDe(faiscas)}: ${faiscas} faíscas`;
    if (subiu) { chip.classList.remove('subiu'); void chip.offsetWidth; chip.classList.add('subiu'); }
  }

  function soltarFaisca() {
    if (!tela || concluindo || reduzido()) return;
    const faisca = document.createElement('span');
    faisca.className = 'nx-faisca';
    faisca.setAttribute('aria-hidden', 'true');
    faisca.innerHTML = ESTRELA;
    // Longe do meio, onde está a caixa: nas bordas esquerda e direita da tela larga e, na estreita (onde a caixa
    // ocupa a largura toda), nas faixas de cima e de baixo.
    if (window.innerWidth < 560) {
      faisca.style.setProperty('--x', `${entre(8, 92).toFixed(1)}%`);
      faisca.style.setProperty('--y', `${(Math.random() < 0.5 ? entre(5, 20) : entre(80, 94)).toFixed(1)}%`);
    } else {
      faisca.style.setProperty('--x', `${(Math.random() < 0.5 ? entre(6, 24) : entre(76, 94)).toFixed(1)}%`);
      faisca.style.setProperty('--y', `${entre(14, 86).toFixed(1)}%`);
    }
    faisca.style.setProperty('--t', `${entre(7, 12).toFixed(1)}s`);
    faisca.addEventListener('pointerdown', evento => {
      evento.preventDefault();
      if (faisca.classList.contains('pegou')) return;
      faisca.classList.add('pegou');
      faiscas += 1;
      gravarFaiscas(faiscas);
      desenharNivel(faiscas % 10 === 0);
      depois(() => { faisca.remove(); soltarFaisca(); }, 900);
    });
    // Antes da caixa no DOM: a caixa fica por cima, e tocar nela nunca pega uma faísca sem querer.
    tela.insertBefore(faisca, $('.nx-tela-caixa'));
  }

  function proximaDica() {
    const usadas = DICAS.length;
    let indice = Math.floor(Math.random() * usadas);
    try {
      const ultima = parseInt(sessionStorage.getItem(CHAVE_DA_DICA), 10);
      if (indice === ultima) indice = (indice + 1) % usadas;
      sessionStorage.setItem(CHAVE_DA_DICA, String(indice));
    } catch (_) { /* uma repetida não faz mal */ }
    return indice;
  }
  function girarDicas() {
    const paragrafo = $('.nx-dica p');
    if (!paragrafo) return;
    let indice = proximaDica();
    // A primeira dica, quando há faíscas passando, é a que explica o jogo.
    paragrafo.textContent = reduzido() ? DICAS[indice] : DICA_DAS_FAISCAS;
    sempre(() => {
      paragrafo.classList.add('troca');
      depois(() => { indice = (indice + 1) % DICAS.length; paragrafo.textContent = DICAS[indice]; paragrafo.classList.remove('troca'); }, 240);
    }, 5500);
  }

  function desenhar(p) {
    if (!tela) return;
    progresso = Math.max(progresso, p);
    const emblema = $('.nx-emblema');
    emblema.style.setProperty('--p', progresso.toFixed(3));
    $('.nx-anel-arco').style.strokeDasharray = `${(Math.max(progresso, 0.04) * CIRCUNFERENCIA).toFixed(1)} ${CIRCUNFERENCIA.toFixed(1)}`;
    const acesos = Math.floor(progresso * SEGMENTOS);
    $('.nx-xp-seg').childNodes.forEach((seg, i) => { seg.classList.toggle('on', i < acesos); seg.classList.toggle('prox', i === acesos && progresso < 1); });
    $('.nx-xp-rotulos b').textContent = `${Math.round(progresso * 100)}%`;
    $('.nx-etapa-texto').textContent = etapaEscolhida || etapaDoAndamento(progresso);
  }

  // O andamento: o que a página já provou (o piso) e, entre um sinal e outro, uma subida que desacelera e nunca
  // passa de 92% -- a barra nunca parece parada, e nunca mente que acabou.
  function andar() {
    if (!tela || concluindo) return;
    const decorrido = Date.now() - comecouEm;
    definirNivel(decorrido >= ajustes.nivel3 ? 3 : decorrido >= ajustes.nivel2 ? 2 : 1);
    const suave = 0.92 * (1 - Math.exp(-decorrido / 4200));
    desenhar(Math.min(0.97, Math.max(piso, suave)));
  }

  // O nível só sobe, nunca desce: uma tela que já mostrou o título não o esconde de novo no meio da espera. É o
  // atributo que o CSS lê (`[data-nivel]`) para a fusão; aqui só entra o que precisa de JavaScript -- as dicas e as
  // faíscas, que só começam a girar quando a tela é completa (e quem espera pouco nunca as paga).
  function definirNivel(novo) {
    if (!tela || novo <= nivel) return;
    nivel = novo;
    tela.dataset.nivel = String(novo);
    if (novo === 3) {
      girarDicas();
      if (!reduzido()) for (let i = 0; i < 4; i++) depois(soltarFaisca, i * 260);
    }
  }

  function montar(titulo, { imediato, partindoDe = 0, aoSair = false, desde = 0 }) {
    if (tela) return;
    saindo = aoSair;
    concluindo = false;
    // A espera começou quando a pessoa pediu -- na página que saiu, se foi ela --, e não agora: o recado traz o instante.
    comecouEm = desde > 0 && desde <= Date.now() ? desde : Date.now();
    nivel = 0;
    visivelDesde = 0;
    piso = partindoDe;
    progresso = 0;
    etapaEscolhida = aoSair ? 'Um instante' : '';
    tela = document.createElement('div');
    tela.className = 'nx-tela';
    tela.id = 'nexoCarregando';
    tela.setAttribute('role', 'status');
    tela.setAttribute('aria-live', 'polite');
    tela.innerHTML = `<div class="nx-nivel" hidden>${ESTRELA}<span></span></div>
<div class="nx-tela-caixa">
  <div class="nx-emblema" aria-hidden="true">
    <div class="nx-orbita"><i>${ESTRELA}</i><i>${ESTRELA}</i><i>${ESTRELA}</i></div>
    <svg viewBox="0 0 168 168"><circle class="nx-anel-trilha" cx="84" cy="84" r="76"/><circle class="nx-anel-arco" cx="84" cy="84" r="76" transform="rotate(-90 84 84)" stroke-dasharray="0 ${CIRCUNFERENCIA.toFixed(1)}"/></svg>
    <div class="nx-ponta"><i>${ESTRELA}</i></div>
    <div class="nx-marca">${MARCA}</div>
  </div>
  <div class="nx-resto nx-resto-2"><div class="nx-resto-miolo">
    <div class="nx-tela-titulo"></div>
    <p class="nx-tela-etapa"><span class="nx-etapa-texto"></span><span class="nx-pontos" aria-hidden="true"><i></i><i></i><i></i></span></p>
    <div class="nx-resto nx-resto-3"><div class="nx-resto-miolo">
      <div class="nx-xp" aria-hidden="true"><div class="nx-xp-seg">${'<i></i>'.repeat(SEGMENTOS)}</div><div class="nx-xp-rotulos"><span>Carregando</span><b>0%</b></div></div>
      <div class="nx-dica" aria-hidden="true"><small>Dica</small><p></p></div>
    </div></div>
    <div class="nx-devagar"><span>Está demorando mais que o normal. Confira a sua conexão.</span><button type="button" class="nx-tela-botao">Tentar de novo</button></div>
  </div></div>
</div>`;
    // O texto de quem vem de fora (o código da sala, no título) entra por `textContent`, nunca como marcação.
    $('.nx-tela-titulo').textContent = titulo;
    $('.nx-devagar button').addEventListener('click', () => window.location.reload());
    // No <html>, e não no <body>: o <body> ainda nem existe quando este script roda no <head>.
    raiz.appendChild(tela);
    raiz.setAttribute('aria-busy', 'true');
    desenharNivel(false);
    desenhar(Math.max(partindoDe, 0.06));
    // Nasce no grau que a espera já tem: quem chega de outra página depois de dois segundos de espera não recomeça do
    // mínimo. As dicas e as faíscas só começam no nível 3 (`definirNivel`).
    const decorrido = Date.now() - comecouEm;
    definirNivel(decorrido >= ajustes.nivel3 ? 3 : decorrido >= ajustes.nivel2 ? 2 : 1);
    sempre(andar, 140);
    // Acesa já, quando a pessoa acabou de pedir (veio de outra página nossa: as duas telas são uma); senão, só depois
    // de uma fração de segundo -- uma página que abre depressa nunca a mostra.
    const acender = () => { if (!tela) return; tela.classList.add('visivel'); visivelDesde = Date.now(); };
    if (imediato) acender();
    else depois(acender, aoSair ? ajustes.atrasoAoSair : ajustes.atraso);
    // Admitir a demora é coisa de nível 2 no mínimo: o aviso mora na parte da tela que só abre ali.
    depois(() => { definirNivel(2); tela?.classList.add('devagar'); }, aoSair ? ajustes.desistirAoSair : ajustes.devagar);
    depois(concluir, aoSair ? ajustes.desistirAoSair : ajustes.desistir);
  }

  function remover() {
    temporizadores.forEach(id => { clearTimeout(id); clearInterval(id); });
    temporizadores = [];
    tela?.remove();
    tela = null;
    nivel = 0;
    saindo = false;
    raiz.removeAttribute('aria-busy');
  }

  function concluir() {
    if (!tela || concluindo) return;
    concluindo = true;
    try { sessionStorage.removeItem(CHAVE_DA_TRAVESSIA); } catch (_) { /* expira sozinho */ }
    // Ainda nem se acendeu (a página abriu depressa): sai sem nunca ter aparecido.
    if (!tela.classList.contains('visivel')) { remover(); return; }
    // Acesa: o anel fecha, a marca dá um pulinho, e só então a tela se apaga. Quanto menos a tela mostrou, menos ela
    // se demora: a marca sozinha só se segura o tempo de não piscar (e nem isso, se já esteve acesa por mais), e a
    // fusão para fora é curta; a tela completa comemora um instante, como sempre.
    desenhar(1);
    etapaEscolhida = 'Pronto';
    $('.nx-etapa-texto').textContent = etapaEscolhida;
    tela.classList.add('pronta');
    const [segurar, sumir] = SAIDA_POR_NIVEL[nivel] || [ajustes.minimoVisivel, 360];
    const espera = SAIDA_POR_NIVEL[nivel] ? Math.max(0, segurar - (Date.now() - visivelDesde)) : segurar;
    tela.style.setProperty('--nx-saida', `${sumir}ms`);
    depois(() => tela?.classList.remove('visivel'), espera);
    depois(remover, espera + sumir + 40);
  }

  function etapa(texto, minimo = 0) {
    if (texto) etapaEscolhida = texto;
    piso = Math.max(piso, Math.min(minimo, 0.97));
    andar();
  }

  // A pessoa está saindo desta página. Se a navegação não acontecer (cancelada, aberta noutra aba, erro), a tela
  // sai sozinha -- `desistirAoSair`.
  function navegando(titulo = 'Abrindo o Nexo') {
    // `desde` é quando a espera começou: a página que chega continua a contagem dos níveis, e não a recomeça.
    gravarRecado({ titulo, p: Math.max(progresso, 0.2), desde: tela ? comecouEm : Date.now() });
    if (tela) {
      $('.nx-tela-titulo').textContent = titulo;
      return;
    }
    montar(titulo, { imediato: false, aoSair: true });
  }

  function mostrar(titulo, opcoes = {}) { montar(titulo, { imediato: false, ...opcoes }); }
  function configurar(novos) { ajustes = { ...ajustes, ...novos }; }

  // Voltar com o botão do navegador pode trazer a página inteira do cache, com a tela de "saindo" ainda nela.
  window.addEventListener('pageshow', evento => { if (evento.persisted) { concluindo = false; concluir(); } });

  // Um clique num link do Nexo é uma saída: o que o resto do código não trata (um `<a href>` simples) também
  // acende a tela. Espera o evento terminar para saber se alguém cancelou a navegação (`preventDefault`).
  document.addEventListener('click', evento => {
    if (evento.defaultPrevented || evento.button || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
    const link = evento.target?.closest?.('a[href]');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    setTimeout(() => {
      if (evento.defaultPrevented) return;
      let destino;
      try { destino = new URL(link.href, window.location.href); } catch (_) { return; }
      if (destino.origin !== window.location.origin) return;
      if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
      // Arquivo e API não são páginas: baixam sem trocar a tela.
      if (/^\/(api|downloads|midia)\//.test(destino.pathname) || /\.[a-z0-9]{2,5}$/i.test(destino.pathname)) return;
      navegando(tituloDoCaminho(destino.pathname, window.location.pathname));
    }, 0);
  });

  // ---------- Chegando ----------
  const recado = lerRecado();
  montar(recado?.titulo || tituloDoCaminho(window.location.pathname), { imediato: Boolean(recado) || emAplicativo, partindoDe: recado ? Math.min(recado.p || 0, 0.6) : 0, desde: recado?.desde || 0 });
  // O que o navegador já provou sozinho: o HTML veio, a página inteira veio.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => etapa('', 0.45), { once: true });
  else etapa('', 0.45);
  window.addEventListener('load', () => etapa('', 0.7), { once: true });
  // Páginas que não têm o que esperar (a apresentação, o "não encontrada") se resolvem sozinhas; as que esperam a conta
  // e os amigos (a sala, o início, a conta) marcam `data-carregando="manual"` e chamam `concluir()` quando estão prontas.
  const decidirSozinha = () => { if (raiz.dataset.carregando !== 'manual') requestAnimationFrame(() => concluir()); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decidirSozinha, { once: true });
  else decidirSozinha();

  // O título de um destino (um caminho ou um endereço do Nexo), para quem navega por JavaScript: "Saindo da sala",
  // "Entrando em #sala", "Abrindo a sua conta".
  const tituloDe = destino => {
    try { return tituloDoCaminho(new URL(destino, window.location.href).pathname, window.location.pathname); } catch (_) { return 'Abrindo o Nexo'; }
  };

  window.NexoCarregando = Object.freeze({ mostrar, navegando, etapa, concluir, configurar, tituloDe, ativo: () => Boolean(tela), esqueleto });
})();
