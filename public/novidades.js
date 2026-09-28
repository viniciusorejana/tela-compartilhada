/* A apresentação e as novidades do Nexo: um modal quase da tela inteira que aparece uma vez.
 *
 * Aparece sozinho em dois casos, e só nesses:
 *
 *   - na primeira vez da pessoa, abrindo em "Conheça o Nexo" (vídeo + demonstrações);
 *   - quando sai uma edição de novidades marcada com `aparecer` (public/novidades-edicoes.js)
 *     que ela ainda não leu, abrindo na lista de novidades.
 *
 * Fora disso, só pelo botão "✦ Novidades" (qualquer elemento com `data-novidades`), que ganha um
 * ponto quando há edição não lida.
 *
 * Quatro decisões dão forma a este arquivo:
 *
 *   - Na sala, abre sobre a tela de entrada, ANTES de conectar. É o único momento em que a pessoa
 *     não está numa conversa: depois de entrar, o vídeo tocaria por cima da voz dos amigos, e o
 *     som dele iria para o microfone de quem estivesse sem fone. E é de lá que chega quem vem por
 *     convite -- a maioria, que nunca passa pela página inicial.
 *   - "Lida" é o `id` da edição mais nova que a pessoa FECHOU, guardado como um ajuste da conta
 *     (public/perfil.js). Com conta, segue a pessoa em todo aparelho; sem conta, fica no
 *     navegador. Entre os dois vale o maior: ler no celular sem estar logado e entrar depois não
 *     faz a apresentação voltar.
 *   - Quando abre sozinho, só fecha depois de alguns segundos OU de chegar ao fim do conteúdo, o
 *     que vier antes. A trava é contra o fechar por reflexo, não uma prova de leitura: esperar
 *     sempre funciona, e ninguém fica preso.
 *   - Não usa os modais da sala. room-ui.js trata todo `[role="dialog"]` que existe no começo
 *     como modal dela -- com X próprio, clique fora que fecha e o `inert` da sala (ver a memória
 *     sobre isso). Este nasce depois, cuida do próprio foco e não mexe no `inert` de ninguém.
 */
(function (root) {
  // ---------- A decisão, pura (tests/novidades.test.js) ----------

  const inteiro = valor => (Number.isInteger(valor) && valor > 0 ? valor : 0);

  // O que fazer ao carregar a página: abrir ou não, em que aba, e se o botão ganha ponto.
  // `automatico` é o servidor dizendo se o modal pode abrir sozinho (NEXO_NOVIDADES=0 desliga).
  function decidir({ edicoes = [], lida = 0, automatico = true } = {}) {
    const ultima = edicoes.reduce((maior, edicao) => Math.max(maior, inteiro(edicao.id)), 0);
    const jaLida = inteiro(lida);
    if (!ultima) return { abrir: false, aba: 'conheca', ultima, naoLidas: [], ponto: false, primeiraVez: !jaLida };
    // Primeira vez: a apresentação, e não a lista. Quem nunca usou não tem o que comparar com
    // "novo" -- e o que é novo já está dentro da apresentação.
    if (!jaLida) return { abrir: Boolean(automatico), aba: 'conheca', ultima, naoLidas: [], ponto: true, primeiraVez: true };
    const naoLidas = edicoes.filter(edicao => inteiro(edicao.id) > jaLida);
    const chamativa = naoLidas.find(edicao => edicao.aparecer);
    return {
      abrir: Boolean(automatico && chamativa),
      aba: chamativa?.abrirEm === 'conheca' ? 'conheca' : 'novidades',
      ultima, naoLidas, ponto: naoLidas.length > 0, primeiraVez: false
    };
  }

  const juntarLidas = (...valores) => Math.max(0, ...valores.map(inteiro));

  // Segundos até poder fechar quando o modal abriu sozinho. A apresentação é longa e tem vídeo;
  // uma edição de novidades se lê em menos.
  const ESPERA_PRIMEIRA_VEZ = 8;
  const ESPERA_NOVIDADE = 5;
  // Mesmo com o fim à vista, um instante de trava: uma edição curta cabe inteira na tela, e sem
  // isto o marcador de fim nasceria visível e o modal fecharia no mesmo reflexo que o abriu.
  const TRAVA_MINIMA_MS = 1500;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decidir, juntarLidas, ESPERA_PRIMEIRA_VEZ, ESPERA_NOVIDADE };
    return;
  }

  // ---------- Daqui para baixo, só no navegador ----------

  const doc = root.document;
  const EDICOES = root.NexoEdicoes?.EDICOES || [];
  const contexto = doc.getElementById('nameGate') ? 'sala' : 'inicio';

  // Ícones em traço, no mesmo desenho dos da sala (24×24, linha de 1,8).
  const ICONES = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
    fone: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 14h3v7H5a1 1 0 0 1-1-1ZM20 14h-3v7h2a1 1 0 0 0 1-1Z"/>',
    camera: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
    tela: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    tema: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.5 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    arroba: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    som: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    volume: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    musica: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    compacto: '<rect x="2" y="5" width="20" height="14" rx="2"/><rect x="12" y="11" width="7.5" height="5.5" rx="1"/>',
    conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    onda: '<path d="M2 12h3l3-7 4 14 3-9 2 2h5"/>',
    brilho: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 3v4M17 5h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>',
    grade: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    teatro: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h12v6H6z"/>',
    cheia: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    pulso: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    teclado: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    placa: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    atualizar: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
    servidor: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'
  };
  const ico = (nome, classe = '') => `<svg class="nx-ico ${classe}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ICONES.brilho}</svg>`;
  const esc = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dataLonga = iso => {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ---------- O "lido", da conta e do navegador ----------

  // Lido AGORA, antes de a conta responder: o que chegar dela sobrescreve este navegador
  // (preferencias.js), e sem esta foto o maior dos dois se perderia.
  const Pref = root.Preferencias;
  const lidaNoNavegador = inteiro(Pref?.lerAjuste('novidades', 0));
  let lida = lidaNoNavegador;
  let automatico = true;

  function gravarLida(valor) {
    lida = juntarLidas(lida, valor);
    // Gravar pelo leitor único faz a conta ficar sabendo e subir junto dos outros ajustes.
    if (inteiro(Pref?.lerAjuste('novidades', 0)) !== lida) Pref?.gravarAjuste('novidades', lida);
  }

  // A conta pode demorar ou nem responder (servidor fora, rede ruim). Três segundos depois, vale
  // o que este navegador sabe: melhor mostrar uma vez a mais do que travar a página esperando.
  const contaPronta = new Promise(resolve => {
    const prazo = setTimeout(() => resolve(null), 3000);
    Promise.resolve(root.NexoConta?.pronto).then(estado => { clearTimeout(prazo); resolve(estado || null); }, () => { clearTimeout(prazo); resolve(null); });
  }).then(estado => {
    if (estado && estado.novidadesAutomaticas === false) automatico = false;
    const daConta = inteiro(Pref?.lerAjuste('novidades', 0));
    gravarLida(juntarLidas(lidaNoNavegador, daConta));
    return estado;
  });

  // ---------- Os botões que abrem ----------

  function atualizarBotoes() {
    const { naoLidas, primeiraVez, ponto } = decidir({ edicoes: EDICOES, lida });
    const novas = primeiraVez ? 0 : naoLidas.length;
    // Só o botão "Novidades" ganha ponto e rótulo; um atalho para a apresentação diz o que é.
    doc.querySelectorAll('[data-novidades]:not([data-novidades="conheca"])').forEach(botao => {
      botao.classList.toggle('tem-novidade', ponto);
      const rotulo = novas ? `Novidades do Nexo (${novas === 1 ? '1 nova' : `${novas} novas`})` : 'Novidades e apresentação do Nexo';
      botao.setAttribute('aria-label', rotulo);
      botao.title = rotulo;
    });
  }
  doc.addEventListener('click', evento => {
    const botao = evento.target.closest?.('[data-novidades]');
    if (!botao) return;
    evento.preventDefault();
    // O botão se chama "Novidades" e abre nelas; quem nunca fechou a apresentação abre nela, e
    // `data-novidades="conheca"` (o "conheça em detalhes" da página inicial) também.
    const { primeiraVez } = decidir({ edicoes: EDICOES, lida });
    abrir({ aba: primeiraVez || botao.dataset.novidades === 'conheca' ? 'conheca' : 'novidades', obrigatorio: false, gatilho: botao });
  });

  // ---------- O modal ----------

  let raiz = null, janela = null, rolagem = null, indice = null, dica = null, principal = null, fecharBtn = null;
  let aberto = false, trancado = false, abaAtual = 'conheca', gatilho = null, relogio = null, observadorFim = null, observadorSecoes = null;
  let fimDaEspera = 0, abertoEm = 0;
  const sons = new Map();

  const SECOES = [
    ['inicio', 'Boas-vindas'], ['link', 'Uma sala é um link'], ['controles', 'Fale, mostre, compartilhe'],
    ['palco', 'Assista só o que quiser'], ['ouvir', 'Cada um ouve do seu jeito'], ['chat', 'Chat, música e sons'],
    ['jeito', 'Do seu jeito'], ['mais', 'Aplicativo e ajuda'], ['fim', 'Pronto!']
  ];

  function montar() {
    raiz = doc.createElement('div');
    raiz.className = 'nx-novidades';
    raiz.hidden = true;
    raiz.innerHTML = `
      <div class="nx-nov-fundo"></div>
      <section class="nx-nov-janela" role="dialog" aria-modal="true" aria-labelledby="nxNovTitulo" tabindex="-1">
        <header class="nx-nov-topo">
          <div class="nx-nov-marca"><img src="/mark.svg" alt="" width="30" height="30"><strong>NEXO</strong><span aria-hidden="true">/</span><h2 id="nxNovTitulo">apresentação</h2></div>
          <div class="nx-nov-abas" role="tablist" aria-label="Seções">
            <button type="button" role="tab" id="nxAbaConheca" aria-controls="nxPainelConheca" data-aba="conheca">${ico('brilho')}Conheça o Nexo</button>
            <button type="button" role="tab" id="nxAbaNovidades" aria-controls="nxPainelNovidades" data-aba="novidades">Novidades<span class="nx-nov-contagem" hidden></span></button>
          </div>
          <button type="button" class="nx-nov-fechar" aria-label="Fechar"><svg class="nx-anel" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16"/></svg>${ico('fechar')}</button>
        </header>
        <div class="nx-nov-corpo">
          <nav class="nx-nov-indice" aria-label="Nesta página"></nav>
          <div class="nx-nov-rolagem">
            <div class="nx-nov-progresso" aria-hidden="true"><i></i></div>
            <div role="tabpanel" id="nxPainelConheca" aria-labelledby="nxAbaConheca" class="nx-painel">${conteudoConheca()}</div>
            <div role="tabpanel" id="nxPainelNovidades" aria-labelledby="nxAbaNovidades" class="nx-painel" hidden>${conteudoNovidades()}</div>
          </div>
        </div>
        <footer class="nx-nov-rodape">
          <span class="nx-nov-dica" aria-live="polite"></span>
          <button type="button" class="nx-nov-principal"><span></span>${ico('seta')}</button>
        </footer>
      </section>`;
    doc.body.append(raiz);
    janela = raiz.querySelector('.nx-nov-janela');
    rolagem = raiz.querySelector('.nx-nov-rolagem');
    indice = raiz.querySelector('.nx-nov-indice');
    dica = raiz.querySelector('.nx-nov-dica');
    principal = raiz.querySelector('.nx-nov-principal');
    fecharBtn = raiz.querySelector('.nx-nov-fechar');

    raiz.querySelectorAll('[role="tab"]').forEach(aba => aba.addEventListener('click', () => mostrarAba(aba.dataset.aba)));
    fecharBtn.addEventListener('click', fechar);
    principal.addEventListener('click', fechar);
    rolagem.addEventListener('scroll', () => {
      const total = rolagem.scrollHeight - rolagem.clientHeight;
      raiz.style.setProperty('--nx-rolado', total > 0 ? String(Math.min(1, rolagem.scrollTop / total)) : '1');
    }, { passive: true });

    // Chegar ao fim destrava. O fim de cada aba tem a sua marca; qualquer uma serve.
    observadorFim = new IntersectionObserver(entradas => {
      if (!trancado || !entradas.some(e => e.isIntersecting && !e.target.closest('[hidden]'))) return;
      const falta = abertoEm + TRAVA_MINIMA_MS - Date.now();
      if (falta <= 0) destravar('fim');
      else setTimeout(() => { if (trancado) destravar('fim'); }, falta);
    }, { root: rolagem, threshold: 0 });
    raiz.querySelectorAll('.nx-fim-marca').forEach(marca => observadorFim.observe(marca));

    // O índice acompanha a seção que está no meio da tela.
    observadorSecoes = new IntersectionObserver(entradas => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        indice.querySelectorAll('a').forEach(a => a.classList.toggle('atual', a.getAttribute('href') === `#${entrada.target.id}`));
      }
    }, { root: rolagem, rootMargin: '-40% 0px -55% 0px' });

    ligarDemonstracoes();
  }

  function mostrarAba(aba) {
    abaAtual = aba === 'novidades' ? 'novidades' : 'conheca';
    raiz.querySelectorAll('[role="tab"]').forEach(botao => {
      const ativa = botao.dataset.aba === abaAtual;
      botao.setAttribute('aria-selected', String(ativa));
      botao.tabIndex = ativa ? 0 : -1;
    });
    raiz.querySelector('#nxPainelConheca').hidden = abaAtual !== 'conheca';
    raiz.querySelector('#nxPainelNovidades').hidden = abaAtual !== 'novidades';
    raiz.querySelector('#nxNovTitulo').textContent = abaAtual === 'conheca' ? 'apresentação' : 'novidades';
    // O índice é o da aba aberta: as seções da apresentação, ou as edições.
    const alvos = [...raiz.querySelectorAll(abaAtual === 'conheca' ? '#nxPainelConheca .nx-secao' : '#nxPainelNovidades .nx-edicao')];
    indice.innerHTML = `<span class="nx-indice-titulo">${abaAtual === 'conheca' ? 'Nesta apresentação' : 'Edições'}</span>` + alvos.map(alvo =>
      `<a href="#${alvo.id}">${esc(alvo.dataset.rotulo)}</a>`).join('');
    indice.querySelectorAll('a').forEach(link => link.addEventListener('click', evento => {
      evento.preventDefault();
      const calmo = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      raiz.querySelector(link.getAttribute('href'))?.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
    }));
    observadorSecoes.disconnect();
    alvos.forEach(alvo => observadorSecoes.observe(alvo));
    indice.querySelector('a')?.classList.add('atual');
    rolagem.scrollTop = 0;
    raiz.style.setProperty('--nx-rolado', '0');
    pausarMidia();
  }

  function abrir({ aba = 'conheca', obrigatorio = false, gatilho: quem = null } = {}) {
    if (!raiz) montar();
    const { naoLidas, primeiraVez } = decidir({ edicoes: EDICOES, lida });
    // As edições não lidas ganham o selo "nova" enquanto o modal estiver aberto; fechar as lê.
    raiz.querySelectorAll('.nx-edicao').forEach(el => el.classList.toggle('nao-lida', !primeiraVez && naoLidas.some(e => String(e.id) === el.dataset.id)));
    const contagem = raiz.querySelector('.nx-nov-contagem');
    contagem.hidden = primeiraVez || !naoLidas.length;
    contagem.textContent = String(naoLidas.length);
    mostrarAba(aba);
    gatilho = quem || doc.activeElement;
    aberto = true;
    raiz.hidden = false;
    doc.documentElement.classList.add('nx-nov-aberto');
    principal.querySelector('span').textContent = obrigatorio ? (contexto === 'sala' ? 'Bora para a sala' : 'Bora começar') : 'Fechar';
    if (obrigatorio) travar(primeiraVez ? ESPERA_PRIMEIRA_VEZ : Math.max(1, Number(naoLidas.find(e => e.aparecer)?.espera) || ESPERA_NOVIDADE));
    else destravar('manual');
    // O foco vai para a janela, e não para o primeiro botão: quem usa leitor de tela ouve o
    // título, e quem usa teclado começa do alto.
    requestAnimationFrame(() => janela.focus({ preventScroll: true }));
  }

  function travar(segundos) {
    trancado = true;
    abertoEm = Date.now();
    fimDaEspera = abertoEm + segundos * 1000;
    raiz.style.setProperty('--nx-espera', `${segundos}s`);
    raiz.classList.remove('destravado');
    // Recomeça a animação do anel mesmo que o modal já tenha contado antes.
    raiz.classList.remove('contando'); void raiz.offsetWidth; raiz.classList.add('contando');
    principal.disabled = true;
    fecharBtn.disabled = true;
    const passo = () => {
      const faltam = Math.ceil((fimDaEspera - Date.now()) / 1000);
      if (faltam <= 0) return destravar('tempo');
      dica.textContent = `Dá para fechar em ${faltam} s — ou quando chegar ao fim.`;
    };
    clearInterval(relogio);
    relogio = setInterval(passo, 250);
    passo();
  }

  function destravar(motivo) {
    if (!raiz) return;
    clearInterval(relogio);
    const estavaTrancado = trancado;
    trancado = false;
    raiz.classList.remove('contando');
    raiz.classList.add('destravado');
    principal.disabled = false;
    fecharBtn.disabled = false;
    dica.textContent = motivo === 'manual' ? 'Tudo isto fica aqui, no botão ✦ Novidades.' : 'Pronto! Para rever depois, use o botão ✦ Novidades.';
    // Quem estava esperando o botão acender recebe o foco nele: é o próximo passo.
    if (estavaTrancado && doc.activeElement === janela) principal.focus({ preventScroll: true });
  }

  function fechar() {
    if (!aberto || trancado) return;
    aberto = false;
    clearInterval(relogio);
    pausarMidia();
    raiz.hidden = true;
    doc.documentElement.classList.remove('nx-nov-aberto');
    gravarLida(decidir({ edicoes: EDICOES, lida }).ultima);
    atualizarBotoes();
    // Na sala, o próximo gesto é escrever o nome; em qualquer outro lugar, voltar ao botão.
    const alvo = contexto === 'sala' && !doc.getElementById('nameGate').classList.contains('hidden') ? doc.getElementById('nameInput') : gatilho;
    if (alvo?.isConnected) alvo.focus({ preventScroll: true });
  }

  function pausarMidia() {
    raiz?.querySelectorAll('video').forEach(video => video.pause());
    sons.forEach(som => { som.pause(); som.currentTime = 0; });
  }

  // O teclado enquanto o modal está aberto. Fase de captura na janela, antes de qualquer outro
  // ouvinte: os atalhos da sala (Ctrl+Shift+letra) não podem agir atrás do modal, e o Esc da
  // sala não pode fechar outro painel embaixo dele.
  root.addEventListener('keydown', evento => {
    if (!aberto) return;
    if (evento.key === 'Escape') {
      evento.preventDefault(); evento.stopImmediatePropagation();
      if (fecharMenuDeMencao()) return;
      fechar();
      return;
    }
    if (evento.key === 'Tab') {
      const focaveis = [...janela.querySelectorAll('button:not(:disabled), input, a[href], video[controls], [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
      if (!focaveis.length) return;
      const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
      const dentro = janela.contains(doc.activeElement);
      if (evento.shiftKey && (doc.activeElement === primeiro || !dentro || doc.activeElement === janela)) { evento.preventDefault(); ultimo.focus(); }
      else if (!evento.shiftKey && (doc.activeElement === ultimo || !dentro)) { evento.preventDefault(); primeiro.focus(); }
      evento.stopImmediatePropagation();
      return;
    }
    if (evento.ctrlKey && evento.shiftKey && /^Key[A-Z]$/.test(evento.code)) {
      evento.preventDefault(); evento.stopImmediatePropagation();
      atalhoDaDemonstracao(evento.code);
      return;
    }
    // Setas trocam de aba quando o foco está nelas, como em qualquer lista de abas.
    if ((evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') && evento.target.getAttribute?.('role') === 'tab') {
      evento.preventDefault();
      mostrarAba(abaAtual === 'conheca' ? 'novidades' : 'conheca');
      raiz.querySelector('[role="tab"][aria-selected="true"]').focus();
    }
  }, true);

  // ---------- O conteúdo: "Conheça o Nexo" ----------

  function secao(id, numero, titulo, texto, demo, extra = '') {
    const rotulo = SECOES.find(([chave]) => chave === id)?.[1] || titulo;
    return `
      <section class="nx-secao" id="nx-${id}" data-rotulo="${esc(rotulo)}">
        <div class="nx-secao-texto">
          <span class="nx-olho">${numero}</span>
          <h3>${titulo}</h3>
          ${texto}
        </div>
        <div class="nx-demo">${demo}</div>
        ${extra}
      </section>`;
  }

  function tabelaDePlanos() {
    const P = root.NexoPlanos;
    const lim = nivel => (P ? P.LIMITES[nivel] : { anonimo: { altura: 720, quadros: 30 }, gratis: { altura: 720, quadros: 60 }, premium: { altura: 1440, quadros: 60 } }[nivel]);
    const pessoas = P ? P.PESSOAS : { base: 25, comAssinante: 50 };
    const tela = nivel => (nivel === 'premium' ? `1080p e ${lim(nivel).altura}p a ${lim(nivel).quadros}` : `${lim(nivel).altura}p a ${lim(nivel).quadros}`);
    return `
      <table class="nx-planos">
        <thead><tr><th scope="col"><span class="so-leitor">Recurso</span></th><th scope="col">sem conta</th><th scope="col">conta grátis</th><th scope="col">premium</th></tr></thead>
        <tbody>
          <tr><th scope="row">Transmitir tela</th><td>${tela('anonimo')}</td><td>${tela('gratis')}</td><td><b>${tela('premium')}</b></td></tr>
          <tr><th scope="row">Assistir telas</th><td colspan="3">na qualidade de quem transmite, para todo mundo</td></tr>
          <tr><th scope="row">Pessoas na sala</th><td>${pessoas.base}</td><td>${pessoas.base}</td><td><b>leva a ${pessoas.comAssinante}</b></td></tr>
          <tr><th scope="row">Abrir uma sala</th><td>—</td><td>✓</td><td>✓</td></tr>
        </tbody>
      </table>`;
  }

  function conteudoConheca() {
    const host = esc(root.location.host);
    const temas = (root.NexoTema?.TEMAS || []).map(tema => `<button type="button" class="nx-tema" data-tema="${esc(tema.id)}" aria-pressed="false"><i></i><span>${esc(tema.nome)}</span></button>`).join('');
    return `
      <section class="nx-secao nx-abertura" id="nx-inicio" data-rotulo="Boas-vindas">
        <div class="nx-abertura-texto">
          <span class="nx-olho">✦ BEM-VINDO AO NEXO</span>
          <h3>Seu squad, <em>mais perto.</em></h3>
          <p>O Nexo é uma sala de voz, câmera e tela para jogar junto, assistir junto e conversar sem hora para acabar. O vídeo mostra o essencial em um minuto; logo abaixo, cada parte com calma — e dá para experimentar tudo aqui mesmo.</p>
          <ul class="nx-fichas"><li>${ico('link')}Um link é o convite</li><li>${ico('tela')}Tela com som</li><li>${ico('brilho')}Sem instalar nada</li></ul>
        </div>
        <figure class="nx-video contexto-escuro">
          <video preload="none" playsinline poster="/midia/apresentacao.jpg"><source src="/midia/apresentacao.mp4" type="video/mp4"></video>
          <button type="button" class="nx-video-play" aria-label="Assistir ao vídeo de apresentação: 1 minuto, com som"><span class="nx-video-play-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg></span><span><strong>Assistir</strong><small>1 minuto, com som</small></span></button>
        </figure>
      </section>

      ${secao('link', '01', 'Uma sala é um link', `
          <p>Crie uma sala e mande o link no grupo. Quem recebe entra direto pelo navegador — no computador ou no celular — escolhendo só um nome.</p>
          <ul>
            <li><b>Entrar</b> numa sala não pede cadastro.</li>
            <li><b>Abrir</b> uma sala nova pede uma conta grátis: nome de usuário e senha, sem e-mail.</li>
            <li>A sala vive enquanto tiver gente. Vazia, ela espera um minuto — um F5 não derruba ninguém.</li>
          </ul>`, `
          <label class="nx-rotulo" for="nxDemoSala">Experimente: dê um nome para a sala</label>
          <div class="nx-campo"><span aria-hidden="true">#</span><input id="nxDemoSala" type="text" maxlength="32" value="squad-da-noite" autocomplete="off" spellcheck="false"></div>
          <div class="nx-convite"><small>É isto que seus amigos recebem</small><code><span>${host}/</span><b id="nxDemoCodigo">squad-da-noite</b><span>/sala</span></code></div>
          <p class="nx-demo-nota">${ico('link')}Na sala, o botão <b>Convidar amigos</b> copia esse link.</p>`)}

      ${secao('controles', '02', 'Fale, mostre, compartilhe', `
          <p>Você entra com microfone e câmera <b>desligados</b>: nada liga sem você pedir. Tudo fica na barra de baixo da sala.</p>
          <ul>
            <li><b>Tela</b> compartilha uma aba, uma janela ou a tela inteira — com o som junto. Com placa de vídeo, é ela que codifica, e o processador fica para o jogo.</li>
            <li><b>Ouvir</b> ensurdece: você para de ouvir a sala e o microfone fecha junto.</li>
            <li>Prefere <b>push-to-talk</b>? Segure Espaço para falar (liga em Configurações).</li>
          </ul>`, `
          <div class="nx-barra" role="group" aria-label="Demonstração da barra de controles">
            <button type="button" class="nx-ctl" data-ctl="mic" aria-pressed="false">${ico('mic')}<span>Microfone</span></button>
            <button type="button" class="nx-ctl" data-ctl="ouvir" aria-pressed="false">${ico('fone')}<span>Ouvir</span></button>
            <button type="button" class="nx-ctl" data-ctl="camera" aria-pressed="false">${ico('camera')}<span>Câmera</span></button>
            <button type="button" class="nx-ctl" data-ctl="tela" aria-pressed="false">${ico('tela')}<span>Tela</span></button>
          </div>
          <p class="nx-legenda" aria-live="polite">Clique nos botões — ou aperte <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd> agora.</p>`)}

      ${secao('palco', '03', 'Assista só o que quiser', `
          <p>Quando alguém compartilha, todo mundo vê que a tela está no ar — mas a imagem só chega para quem clicar em <b>Assistir</b>. Quem só quer conversar não gasta internet com isso.</p>
          <ul>
            <li>Um <b>selo com olho</b> mostra quantos estão vendo cada tela, e quem.</li>
            <li>Clique numa câmera ou tela para <b>destacar no palco</b>. Várias ao mesmo tempo? Use a <b>grade</b>.</li>
            <li><b>Compacto</b> põe a tela numa janelinha por cima das outras; <b>teatro</b> e <b>tela cheia</b> fazem o contrário.</li>
          </ul>`, `
          <div class="nx-palco contexto-escuro" data-estado="parado">
            <div class="nx-palco-jogo" aria-hidden="true"><i class="nx-sol"></i><i class="nx-morro nx-morro-a"></i><i class="nx-morro nx-morro-b"></i><i class="nx-pista"></i><span class="nx-hud">VOLTA 2/3 · 01:42</span></div>
            <div class="nx-palco-capa"><span class="nx-ao-vivo">AO VIVO</span><strong>Rafa está compartilhando a tela</strong><button type="button" class="nx-assistir">${ico('olho')}Assistir</button></div>
            <span class="nx-espectadores" aria-live="polite">${ico('olho')}<b>2</b><span class="nx-rostos"><i style="--c:#7fd1ae">A</i><i style="--c:#e6b86a">L</i></span></span>
            <div class="nx-palco-barra"><span title="Grade">${ico('grade')}</span><span title="Compacto">${ico('compacto')}</span><span title="Teatro">${ico('teatro')}</span><span title="Tela cheia">${ico('cheia')}</span><button type="button" class="nx-parar">Parar</button></div>
          </div>`)}

      ${secao('ouvir', '04', 'Cada um ouve do seu jeito', `
          <p>O volume de cada pessoa vai de 0 a <b>200%</b>, e só você ouve a diferença — ninguém fica sabendo. A voz e o som da tela têm volumes separados, e o Nexo lembra do ajuste na próxima vez.</p>
          <p>Avisos curtos e discretos contam o que acontece na sala sem você olhar: quem entrou, quem saiu, uma tela no ar, alguém chamando você. Tudo ajustável em <b>Configurações → Sons</b>.</p>`, `
          <div class="nx-pessoa">
            <span class="nx-avatar" style="--c:#7fb5ee">L</span>
            <div class="nx-pessoa-info"><strong>Léo</strong><small>fala baixinho</small></div>
            <span class="nx-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="nx-volume">
            <input type="range" id="nxDemoVolume" min="0" max="200" step="5" value="100" aria-label="Volume do Léo, só para você">
            <output for="nxDemoVolume" id="nxDemoVolumeValor">100%</output>
          </div>
          <span class="nx-rotulo">Ouça os avisos da sala</span>
          <div class="nx-avisos">
            <button type="button" data-som="/sons/entrada.mp3">Alguém entrou</button>
            <button type="button" data-som="/sons/saida.mp3">Alguém saiu</button>
            <button type="button" data-som="/sons/tela.mp3">Tela no ar</button>
            <button type="button" data-som="/sons/mencao.mp3">Chamaram você</button>
          </div>`)}

      ${secao('chat', '05', 'Chat, música e mesa de sons', `
          <p>O <b>chat</b> aceita imagens (cole ou arraste), respostas, edição e mensagens fixadas. Digite <b>@</b> para chamar alguém da sala.</p>
          <ul>
            <li>No canal <b>música</b>, peça pelo nome ou pelo link, e o bot toca para todo mundo. A fila se arrasta, e <kbd>Ctrl</kbd><kbd>Enter</kbd> passa na frente.</li>
            <li>Na <b>mesa de sons</b> ficam efeitos curtos que o pessoal envia e dispara para a sala inteira. Vivem enquanto a sala existir.</li>
          </ul>`, `
          <div class="nx-chat">
            <div class="nx-chat-msgs" aria-live="polite">
              <p><b style="--c:#e6b86a">Ana</b>alguém sobe a tela? 👀</p>
              <p><b style="--c:#7fd1ae">Rafa</b>já tô compartilhando!</p>
            </div>
            <div class="nx-chat-caixa">
              <input type="text" id="nxDemoChat" maxlength="120" placeholder="Digite @ para chamar alguém…" autocomplete="off" aria-label="Mensagem de demonstração" aria-autocomplete="list" aria-controls="nxDemoMencoes">
              <button type="button" class="nx-chat-enviar" aria-label="Enviar">${ico('enviar')}</button>
              <ul class="nx-mencoes" id="nxDemoMencoes" role="listbox" hidden></ul>
            </div>
          </div>
          <span class="nx-rotulo">Mesa de sons</span>
          <div class="nx-mesa">
            <button type="button" data-som="/midia/mesa/piada.mp3"><b>🥁</b>Ba-dum-tss</button>
            <button type="button" data-som="/midia/mesa/uhh.mp3"><b>😮</b>Uhhh</button>
            <button type="button" data-som="/midia/mesa/palmas.mp3"><b>👏</b>Palmas</button>
            <button type="button" data-som="/midia/mesa/boing.mp3"><b>🌀</b>Boing</button>
          </div>`)}

      ${secao('jeito', '06', 'Do seu jeito', `
          <p>Com uma conta grátis você escolhe <b>apelido, cor e marca</b>, e o perfil segue você em todo aparelho — com os seus ajustes.</p>
          <p>Em <b>Configurações → Aparência</b>: escuro, claro ou o do sistema, oito temas prontos e a cor de destaque. Toque num tema para ver:</p>`, `
          <div class="nx-temas" role="group" aria-label="Temas prontos">${temas}</div>
          <div class="nx-miniatura" aria-hidden="true">
            <div class="nx-mini-lado"><i></i><i></i><i></i></div>
            <div class="nx-mini-palco"><span></span></div>
            <div class="nx-mini-chat"><i></i><i class="curta"></i><b></b></div>
          </div>`,
        `<div class="nx-secao-largo"><span class="nx-rotulo">O que cada um transmite</span>${tabelaDePlanos()}<p class="nx-demo-nota">Cobra-se resolução porque é ela que custa no servidor. Assistir nunca é limitado: um premium no grupo faz todo mundo ver a tela dele em alta.</p></div>`)}

      ${secao('mais', '07', 'Aplicativo, ajuda e atalhos', `
          <p>O <b>aplicativo de mesa</b> faz o que o navegador não faz: no Windows ele manda o som de <b>um programa só</b> e tira o Nexo da captura — a voz dos outros não volta como eco. Baixe na página inicial.</p>
          <p>Algo estranho? O <b>Diagnóstico</b> (o ícone de pulso, na barra lateral) diz o que está chegando e de quem é o limite — sua máquina, sua rede ou o servidor. E <b>Sugestões e problemas</b> chega direto em quem cuida do Nexo.</p>`, `
          <dl class="nx-atalhos">
            <div data-atalho="KeyM"><dt>Microfone</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd></dd></div>
            <div data-atalho="KeyD"><dt>Ensurdecer</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>D</kbd></dd></div>
            <div data-atalho="KeyC"><dt>Câmera</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>C</kbd></dd></div>
            <div data-atalho="KeyH"><dt>Chat</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>H</kbd></dd></div>
            <div data-atalho="KeyE"><dt>Configurações</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>E</kbd></dd></div>
            <div data-atalho="KeyP"><dt>Status e reações</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd></dd></div>
          </dl>
          <p class="nx-demo-nota">${ico('teclado')}Aperte um deles agora: o atalho acende aqui.</p>`)}

      <section class="nx-secao nx-final" id="nx-fim" data-rotulo="Pronto!">
        <span class="nx-final-brilho" aria-hidden="true">✦</span>
        <h3>É isso. Bora?</h3>
        <p>${contexto === 'sala' ? 'Escolha seu nome e entre — o squad está logo ali.' : 'Crie uma sala ou entre na de alguém. Um link é tudo que separa vocês.'}</p>
        <p class="nx-demo-nota">Esta apresentação e as novidades ficam no botão <b>✦ Novidades</b>, ${contexto === 'sala' ? 'na barra lateral da sala' : 'no alto da página inicial'}.</p>
        <span class="nx-fim-marca" aria-hidden="true"></span>
      </section>`;
  }

  // ---------- O conteúdo: "Novidades" ----------

  function conteudoNovidades() {
    if (!EDICOES.length) return '<p class="nx-vazio">Nenhuma novidade por enquanto.</p><span class="nx-fim-marca" aria-hidden="true"></span>';
    return EDICOES.map(edicao => `
      <article class="nx-edicao" id="nx-edicao-${edicao.id}" data-id="${edicao.id}" data-rotulo="${esc(edicao.titulo)}">
        <header>
          <span class="nx-olho"><time datetime="${esc(edicao.data)}">${esc(dataLonga(edicao.data))}</time><span class="nx-selo-nova">NOVA</span></span>
          <h3>${esc(edicao.titulo)}</h3>
          ${edicao.resumo ? `<p>${esc(edicao.resumo)}</p>` : ''}
        </header>
        <ul class="nx-itens">${(edicao.itens || []).map(item => `
          <li>
            <span class="nx-item-ico">${ico(item.icone)}</span>
            <div><strong>${esc(item.titulo)}</strong><p>${esc(item.texto)}</p>${item.onde ? `<small>${ico('seta', 'nx-ico-p')}${esc(item.onde)}</small>` : ''}</div>
          </li>`).join('')}
        </ul>
      </article>`).join('') + '<span class="nx-fim-marca" aria-hidden="true"></span>';
  }

  // ---------- As demonstrações ----------

  const LEGENDAS = {
    mic: ['Microfone ligado. Atalho: Ctrl+Shift+M.', 'Microfone desligado.'],
    ouvir: ['Ensurdecido: a sala fica em silêncio para você, e o microfone fecha junto.', 'Ouvindo a sala de novo.'],
    camera: ['Câmera ligada. No celular, “Virar” troca para a traseira.', 'Câmera desligada.'],
    tela: ['Escolha aba, janela ou tela inteira e marque “Compartilhar áudio”. Sem eco garantido: uma aba, ou o aplicativo de mesa.', 'Parou de compartilhar.']
  };

  function alternarControle(nome) {
    const botao = raiz.querySelector(`.nx-ctl[data-ctl="${nome}"]`);
    if (!botao) return;
    const ligado = botao.getAttribute('aria-pressed') !== 'true';
    botao.setAttribute('aria-pressed', String(ligado));
    // Ensurdecer fecha o microfone junto, como na sala.
    if (nome === 'ouvir' && ligado) raiz.querySelector('.nx-ctl[data-ctl="mic"]').setAttribute('aria-pressed', 'false');
    raiz.querySelector('.nx-legenda').textContent = LEGENDAS[nome][ligado ? 0 : 1];
  }

  function atalhoDaDemonstracao(codigo) {
    const nome = { KeyM: 'mic', KeyD: 'ouvir', KeyC: 'camera' }[codigo];
    if (nome && abaAtual === 'conheca') alternarControle(nome);
    const linha = raiz.querySelector(`.nx-atalhos [data-atalho="${codigo}"]`);
    if (!linha) return;
    linha.classList.remove('aceso'); void linha.offsetWidth; linha.classList.add('aceso');
  }

  function tocar(caminho) {
    let som = sons.get(caminho);
    if (!som) { som = new Audio(caminho); som.volume = 0.8; sons.set(caminho, som); }
    som.currentTime = 0;
    som.play().catch(() => { /* sem permissão de tocar ainda, ou arquivo ausente: a demonstração segue muda */ });
  }

  const PESSOAS = [['Ana', '#e6b86a'], ['Bia', '#e994c4'], ['Léo', '#7fb5ee'], ['Rafa', '#7fd1ae']];
  const semAcento = texto => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let mencaoAtiva = -1;
  function fecharMenuDeMencao() {
    const lista = raiz?.querySelector('#nxDemoMencoes');
    if (!lista || lista.hidden) return false;
    lista.hidden = true; mencaoAtiva = -1;
    return true;
  }

  function ligarDemonstracoes() {
    // O vídeo só carrega quando a pessoa pede: o modal abre para todo mundo, e 1 minuto de
    // vídeo baixado à toa por quem só queria fechar é banda da casa de quem hospeda.
    const figura = raiz.querySelector('.nx-video');
    const video = figura.querySelector('video');
    const play = figura.querySelector('.nx-video-play');
    play.addEventListener('click', () => {
      play.hidden = true;
      video.controls = true;
      video.play().catch(() => { play.hidden = false; video.controls = false; });
    });
    video.addEventListener('ended', () => { play.hidden = false; video.controls = false; video.load(); });
    video.querySelector('source').addEventListener('error', () => { figura.hidden = true; });

    const campo = raiz.querySelector('#nxDemoSala');
    campo.addEventListener('input', () => {
      const codigo = campo.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      raiz.querySelector('#nxDemoCodigo').textContent = codigo || 'sua-sala';
    });

    raiz.querySelectorAll('.nx-ctl').forEach(botao => botao.addEventListener('click', () => alternarControle(botao.dataset.ctl)));

    const palco = raiz.querySelector('.nx-palco');
    const contagem = palco.querySelector('.nx-espectadores b');
    const rostos = palco.querySelector('.nx-rostos');
    palco.querySelector('.nx-assistir').addEventListener('click', () => {
      palco.dataset.estado = 'assistindo';
      contagem.textContent = '3';
      rostos.insertAdjacentHTML('afterbegin', '<i style="--c:var(--accent)" class="voce">V</i>');
    });
    palco.querySelector('.nx-parar').addEventListener('click', () => {
      palco.dataset.estado = 'parado';
      contagem.textContent = '2';
      rostos.querySelector('.voce')?.remove();
    });

    const volume = raiz.querySelector('#nxDemoVolume');
    const valor = raiz.querySelector('#nxDemoVolumeValor');
    const pessoa = raiz.querySelector('.nx-pessoa');
    const aoMudarVolume = () => {
      valor.textContent = `${volume.value}%`;
      volume.style.setProperty('--nx-cheio', `${volume.value / 2}%`);
      pessoa.style.setProperty('--nx-volume', String(volume.value / 100));
      pessoa.classList.toggle('mudo', Number(volume.value) === 0);
      valor.classList.toggle('acima', Number(volume.value) > 100);
    };
    volume.addEventListener('input', aoMudarVolume);
    aoMudarVolume();

    raiz.querySelectorAll('[data-som]').forEach(botao => botao.addEventListener('click', () => {
      tocar(botao.dataset.som);
      botao.classList.remove('tocando'); void botao.offsetWidth; botao.classList.add('tocando');
    }));

    // A sugestão de @, do mesmo jeito que public/mencoes.js: sem acento e sem maiúscula.
    const chat = raiz.querySelector('#nxDemoChat');
    const lista = raiz.querySelector('#nxDemoMencoes');
    const msgs = raiz.querySelector('.nx-chat-msgs');
    const termo = () => /(^|\s)@([^\s@]*)$/.exec(chat.value.slice(0, chat.selectionStart ?? chat.value.length));
    const pintarLista = () => {
      const achado = termo();
      if (!achado) return fecharMenuDeMencao();
      const busca = semAcento(achado[2]);
      const opcoes = PESSOAS.filter(([nome]) => semAcento(nome).startsWith(busca));
      if (!opcoes.length) return fecharMenuDeMencao();
      mencaoAtiva = Math.min(Math.max(mencaoAtiva, 0), opcoes.length - 1);
      lista.innerHTML = opcoes.map(([nome, cor], i) => `<li role="option" id="nxMencao${i}" aria-selected="${i === mencaoAtiva}" data-nome="${nome}"><i style="--c:${cor}">${nome[0]}</i>${nome}</li>`).join('');
      lista.hidden = false;
      chat.setAttribute('aria-activedescendant', `nxMencao${mencaoAtiva}`);
    };
    const escolher = nome => {
      const achado = termo();
      if (!achado) return;
      const inicio = achado.index + achado[1].length;
      chat.value = `${chat.value.slice(0, inicio)}@${nome} ${chat.value.slice(chat.selectionStart ?? chat.value.length)}`;
      fecharMenuDeMencao();
      chat.focus();
    };
    const enviar = () => {
      const texto = chat.value.trim();
      if (!texto) return;
      const p = doc.createElement('p');
      p.innerHTML = `<b style="--c:var(--accent)">Você</b>${esc(texto).replace(/@(Ana|Bia|Léo|Rafa)\b/g, '<span class="nx-pilula">@$1</span>')}`;
      msgs.append(p);
      while (msgs.children.length > 4) msgs.firstElementChild.remove();
      chat.value = '';
      fecharMenuDeMencao();
    };
    chat.addEventListener('input', () => { mencaoAtiva = 0; pintarLista(); });
    chat.addEventListener('keydown', evento => {
      if (!lista.hidden && (evento.key === 'ArrowDown' || evento.key === 'ArrowUp')) {
        evento.preventDefault();
        const total = lista.children.length;
        mencaoAtiva = (mencaoAtiva + (evento.key === 'ArrowDown' ? 1 : total - 1)) % total;
        pintarLista();
      } else if (!lista.hidden && (evento.key === 'Enter' || evento.key === 'Tab')) {
        evento.preventDefault();
        escolher(lista.children[mencaoAtiva]?.dataset.nome);
      } else if (evento.key === 'Enter') {
        evento.preventDefault();
        enviar();
      }
    });
    lista.addEventListener('mousedown', evento => {
      const item = evento.target.closest('li');
      if (item) { evento.preventDefault(); escolher(item.dataset.nome); }
    });
    raiz.querySelector('.nx-chat-enviar').addEventListener('click', enviar);

    // Cada tema pinta a miniatura com as cores que ele produz de verdade (tema.js), sem mexer
    // no tema da página: experimentar não é escolher.
    const miniatura = raiz.querySelector('.nx-miniatura');
    const pintarTema = id => {
      const T = root.NexoTema;
      if (!T) return;
      const cores = T.derivar(T.resolver({ tema: id }));
      for (const [nome, cor] of Object.entries(cores)) miniatura.style.setProperty(nome, cor);
      raiz.querySelectorAll('.nx-tema').forEach(botao => botao.setAttribute('aria-pressed', String(botao.dataset.tema === id)));
    };
    raiz.querySelectorAll('.nx-tema').forEach(botao => {
      const cores = root.NexoTema?.derivar(root.NexoTema.resolver({ tema: botao.dataset.tema }));
      if (cores) botao.style.cssText = `--t-fundo:${cores['--bg']};--t-destaque:${cores['--accent']};--t-painel:${cores['--bg-2']}`;
      botao.addEventListener('click', () => pintarTema(botao.dataset.tema));
    });
    pintarTema(root.NexoTema?.lerEscolha?.().tema || root.NexoTema?.TEMA_PADRAO || 'nexo');
  }

  // ---------- A abertura sozinha ----------

  atualizarBotoes();
  contaPronta.then(() => {
    atualizarBotoes();
    const decisao = decidir({ edicoes: EDICOES, lida, automatico });
    if (!decisao.abrir) return;
    // Na sala, só enquanto a pessoa está na tela de entrada. Quem já entrou (clicou antes de a
    // conta responder) está na conversa: fica o ponto no botão, e a próxima visita mostra.
    const podeAbrir = () => contexto !== 'sala' || !doc.getElementById('nameGate').classList.contains('hidden');
    if (!podeAbrir()) return;
    // Um instante depois da página pintar: o modal que surge junto com a página parece parte
    // dela, e ninguém percebe que é outra coisa.
    setTimeout(() => { if (podeAbrir() && !aberto) abrir({ aba: decisao.aba, obrigatorio: true }); }, 450);
  });

  root.NexoNovidades = {
    abrir: (opcoes = {}) => abrir({ obrigatorio: false, ...opcoes }),
    fechar, destravar: () => destravar('manual'),
    estado: () => ({ aberto, trancado, aba: abaAtual, lida, automatico, ...decidir({ edicoes: EDICOES, lida, automatico }) }),
    decidir
  };
})(typeof window === 'undefined' ? globalThis : window);
