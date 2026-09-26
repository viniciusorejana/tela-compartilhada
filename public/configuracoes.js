/* As configurações do Nexo: o que é da pessoa e o jeito dela de usar a sala.
 *
 * O painel era "Áudio e vídeo", com duas abas. Com sons, aparência e atalhos ele virou o lugar
 * de tudo o que a pessoa ajusta para si -- e, como no Discord, as seções ficam numa coluna à
 * esquerda, cada uma com uma página só. Aparelhos e qualidade continuam onde sempre estiveram,
 * com os mesmos controles (sala.js); este arquivo cuida das seções novas.
 *
 * A aparência vale na hora, só para quem mexeu, e segue a conta como a qualidade: quem prefere
 * letra grande no computador também prefere no celular.
 */
(() => {
  const $ = id => document.getElementById(id);
  const raiz = document.querySelector('.app');
  const painel = $('devicesPanel');
  const abas = painel.querySelector('[data-abas]');
  const Tema = window.NexoTema;
  // `modo` vazio quer dizer "o do tema": escolher o Areia traz o claro junto, e o Floresta o
  // escuro. Só quem mexe no seletor de modo fixa um -- e "do sistema" sobrevive à troca de tema.
  const PADRAO = Object.freeze({ densidade: 'confortavel', texto: 'normal', tempos: false, reacoes: true, menosMovimento: false, tema: Tema.TEMA_PADRAO, modo: '', destaque: '', cores: null });
  let aparencia = { ...PADRAO };
  // Se as cores exatas valem agora. O plano chega depois da página; até lá vale o último que
  // esta página soube (tema.js guarda), para o tema de um premium não piscar.
  let coresLivres = Tema.lerPermissao();

  function limpar(bruto) {
    const limpo = { ...PADRAO };
    if (!bruto || typeof bruto !== 'object') return limpo;
    if (['confortavel', 'compacta'].includes(bruto.densidade)) limpo.densidade = bruto.densidade;
    if (['normal', 'grande', 'maior'].includes(bruto.texto)) limpo.texto = bruto.texto;
    for (const chave of ['tempos', 'reacoes', 'menosMovimento']) if (typeof bruto[chave] === 'boolean') limpo[chave] = bruto[chave];
    if (Tema.TEMAS.some(t => t.id === bruto.tema)) limpo.tema = bruto.tema;
    if (Tema.MODOS.includes(bruto.modo)) limpo.modo = bruto.modo;
    if (Object.prototype.hasOwnProperty.call(Tema.DESTAQUES, bruto.destaque)) limpo.destaque = bruto.destaque;
    const cores = { destaque: Tema.hexValido(bruto.cores?.destaque), fundo: Tema.hexValido(bruto.cores?.fundo) };
    if (cores.destaque || cores.fundo) limpo.cores = Object.fromEntries(Object.entries(cores).filter(([, valor]) => valor));
    return limpo;
  }

  // As classes vão no `.app` (a sala inteira) e na prévia do painel, que fica fora dela: a
  // prévia mostra a escolha com as mesmas regras de estilo que a sala vai usar. O tema vai na
  // raiz do documento, pelo tema.js -- o mesmo caminho da primeira pintura.
  function aplicar({ comTransicao = false } = {}) {
    const alvos = [raiz, $('previaChat')].filter(Boolean);
    for (const alvo of alvos) {
      alvo.classList.toggle('densidade-compacta', aparencia.densidade === 'compacta');
      alvo.classList.toggle('texto-grande', aparencia.texto === 'grande');
      alvo.classList.toggle('texto-maior', aparencia.texto === 'maior');
    }
    raiz.classList.toggle('mostrar-tempos', aparencia.tempos);
    raiz.classList.toggle('sem-reacoes', !aparencia.reacoes);
    // Na raiz do documento: painéis e menus vivem fora do `.app`, e também param de deslizar.
    document.documentElement.classList.toggle('menos-movimento', aparencia.menosMovimento);
    (comTransicao ? Tema.aplicarComTransicao : Tema.aplicar)(aparencia, { coresLivres });
  }

  // ---------- Os temas prontos e as cores ----------
  // Cada cartão é uma miniatura do próprio tema -- barra lateral, painel, duas linhas de texto e
  // o botão --, pintada com as cores que ele produz de verdade: escolher por uma amostra que
  // não é o tema seria escolher no escuro.
  function montarTemas() {
    const grade = $('temasProntos');
    for (const tema of Tema.TEMAS) {
      const cores = Tema.derivar(Tema.resolver({ tema: tema.id }));
      const opcao = document.createElement('label');
      opcao.className = 'tema-cartao';
      opcao.innerHTML = `<input type="radio" name="temaPronto" value="${tema.id}"><span class="tema-amostra" aria-hidden="true"><i class="tema-lateral"></i><i class="tema-painel"><b></b><b></b><em></em></i></span><span class="tema-nome"></span>`;
      opcao.querySelector('.tema-nome').textContent = tema.nome;
      opcao.querySelector('input').setAttribute('aria-label', `${tema.nome}, ${tema.modo === 'claro' ? 'claro' : 'escuro'}`);
      const amostra = opcao.querySelector('.tema-amostra');
      for (const [nome, valor] of Object.entries({ '--pv-bg': cores['--bg'], '--pv-lateral': cores['--bg-1'], '--pv-painel': cores['--bg-cartao'], '--pv-texto': cores['--text'], '--pv-fraco': cores['--faint'], '--pv-destaque': cores['--accent-forte'], '--pv-linha': cores['--line-2'] })) amostra.style.setProperty(nome, valor);
      grade.append(opcao);
    }
    const destaques = $('destaques');
    const nenhum = document.createElement('label');
    nenhum.className = 'destaque-opcao do-tema';
    nenhum.innerHTML = '<input type="radio" name="corDestaque" value="" aria-label="A cor do tema"><span>Do tema</span>';
    destaques.append(nenhum);
    for (const [id, cor] of Object.entries(Tema.DESTAQUES)) {
      const opcao = document.createElement('label');
      opcao.className = 'destaque-opcao';
      opcao.title = Tema.NOMES_DOS_DESTAQUES[id] || id;
      opcao.innerHTML = `<input type="radio" name="corDestaque" value="${id}"><span style="--cor:${cor}"></span>`;
      opcao.querySelector('input').setAttribute('aria-label', opcao.title);
      destaques.append(opcao);
    }
  }

  function pintarControles() {
    const marcar = (nome, valor) => { const opcao = painel.querySelector(`input[name="${nome}"][value="${valor}"]`); if (opcao) opcao.checked = true; };
    marcar('densidade', aparencia.densidade);
    marcar('textoChat', aparencia.texto);
    $('aparenciaTempos').checked = aparencia.tempos;
    $('aparenciaReacoes').checked = aparencia.reacoes;
    $('aparenciaMovimento').checked = aparencia.menosMovimento;
    const efetivo = Tema.resolver(aparencia, { coresLivres });
    marcar('modoTema', efetivo.modoEscolhido);
    marcar('temaPronto', aparencia.tema);
    // Com uma cor exata valendo, nenhuma das oito está escolhida -- a escolhida é a do seletor.
    if (aparencia.cores?.destaque && coresLivres) painel.querySelectorAll('input[name="corDestaque"]').forEach(opcao => { opcao.checked = false; });
    else marcar('corDestaque', aparencia.destaque);
    pintarCoresExatas(efetivo);
  }

  function pintarCoresExatas(efetivo = Tema.resolver(aparencia, { coresLivres })) {
    const cores = aparencia.cores || {};
    $('corExataDestaque').value = cores.destaque || efetivo.destaque;
    $('corExataFundo').value = cores.fundo || Tema.derivar(efetivo)['--bg'];
    pintarAmostras();
    $('corExataDestaqueHex').textContent = cores.destaque ? cores.destaque.toUpperCase() : 'do tema';
    $('corExataFundoHex').textContent = cores.fundo ? cores.fundo.toUpperCase() : 'do tema';
    $('corExataRestaurar').hidden = !aparencia.cores;
    $('coresExatas').classList.toggle('bloqueado', !coresLivres);
    $('coresExatasSelo').hidden = coresLivres;
    $('corExataDestaque').disabled = !coresLivres;
    $('corExataFundo').disabled = !coresLivres;
    $('coresExatasDica').textContent = coresLivres
      ? 'Qualquer cor para o destaque e para o fundo. O Nexo ajusta textos e botões sozinho, para tudo continuar legível.'
      : aparencia.cores
        ? 'Escolher qualquer cor é do premium. As suas estão guardadas e voltam quando o plano estiver ativo.'
        : 'Escolher qualquer cor para o destaque e para o fundo é do premium. Os temas e as cores acima são de todo mundo.';
  }

  // A bolinha de cada seletor mostra a cor dele -- inclusive a guardada de quem está sem o
  // premium agora, que não vale na tela mas continua sendo a escolha.
  function pintarAmostras() {
    for (const campo of ['corExataDestaque', 'corExataFundo']) $(campo).nextElementSibling.style.background = $(campo).value;
  }

  function recarregar() {
    aparencia = limpar(window.Preferencias?.lerAjuste('aparencia', null));
    aplicar();
    pintarControles();
  }

  // Só o que difere do padrão é guardado, como nos sons.
  function definir(parcial) {
    aparencia = limpar({ ...aparencia, ...parcial });
    const diferente = Object.fromEntries(Object.entries(aparencia).filter(([chave, valor]) => PADRAO[chave] !== valor));
    window.Preferencias?.gravarAjuste('aparencia', Object.keys(diferente).length ? diferente : null);
    aplicar({ comTransicao: 'tema' in parcial || 'modo' in parcial || 'destaque' in parcial || 'cores' in parcial });
    pintarControles();
  }

  function aoMudarPlano(pode) {
    if (pode === coresLivres) return;
    coresLivres = pode;
    Tema.definirPermissao(pode);
    aplicar();
    pintarControles();
  }

  montarTemas();
  painel.querySelectorAll('input[name="modoTema"]').forEach(opcao => opcao.addEventListener('change', () => definir({ modo: opcao.value })));
  // Um tema pronto é um ponto de partida inteiro: traz o modo dele (a menos que o modo siga o
  // sistema), a cor dele, e deixa de lado as cores exatas -- senão o clique não mudaria nada.
  painel.querySelectorAll('input[name="temaPronto"]').forEach(opcao => opcao.addEventListener('change', () => definir({ tema: opcao.value, modo: aparencia.modo === 'sistema' ? 'sistema' : '', destaque: '', cores: null })));
  painel.querySelectorAll('input[name="corDestaque"]').forEach(opcao => opcao.addEventListener('change', () => {
    const cores = aparencia.cores?.fundo ? { fundo: aparencia.cores.fundo } : null;
    definir({ destaque: opcao.value, cores });
  }));
  // O seletor de cor dispara a cada movimento: o tema acompanha ao vivo, e só grava ao soltar.
  for (const [campo, chave] of [['corExataDestaque', 'destaque'], ['corExataFundo', 'fundo']]) {
    $(campo).addEventListener('input', evento => {
      if (!coresLivres) return;
      aparencia = limpar({ ...aparencia, cores: { ...(aparencia.cores || {}), [chave]: evento.target.value } });
      Tema.aplicar(aparencia, { coresLivres });
      pintarAmostras();
    });
    $(campo).addEventListener('change', evento => {
      if (!coresLivres) return;
      definir({ cores: { ...(aparencia.cores || {}), [chave]: evento.target.value } });
    });
  }
  $('corExataRestaurar').addEventListener('click', () => definir({ cores: null }));

  painel.querySelectorAll('input[name="densidade"]').forEach(opcao => opcao.addEventListener('change', () => definir({ densidade: opcao.value })));
  painel.querySelectorAll('input[name="textoChat"]').forEach(opcao => opcao.addEventListener('change', () => definir({ texto: opcao.value })));
  $('aparenciaTempos').addEventListener('change', evento => definir({ tempos: evento.target.checked }));
  $('aparenciaReacoes').addEventListener('change', evento => definir({ reacoes: evento.target.checked }));
  $('aparenciaMovimento').addEventListener('change', evento => definir({ menosMovimento: evento.target.checked }));

  // ---------- Perfil ----------
  // Um resumo de como a sala vê a pessoa, com o caminho para mudar. O editor em si continua
  // sendo o de perfil-sala.js: dois editores do mesmo perfil acabariam discordando.
  const NOMES_DOS_PLANOS = { anonimo: 'Sem conta', gratis: 'Conta grátis', premium: 'Premium' };
  function pintarPerfil() {
    const perfil = typeof perfilDe === 'function' ? perfilDe('self') : null;
    const nome = (typeof myName === 'string' && myName) || window.NexoConta?.atual()?.conta?.apelido || $('nameInput')?.value || 'Você';
    const aparenciaDoPerfil = NexoPerfil.aparencia(nome, perfil);
    pintarAvatar($('configAvatar'), nome, perfil);
    $('configFaixa').style.background = `linear-gradient(120deg, ${aparenciaDoPerfil.cor}, ${aparenciaDoPerfil.cor}66)`;
    $('configNome').textContent = nome;
    const conta = window.NexoConta?.atual()?.conta;
    $('configCodigo').textContent = perfil?.conta ? `Código ${perfil.codigo}` : conta ? `@${conta.usuario}` : 'Entrou sem conta';
    const nivel = typeof nivelDoPlano === 'string' ? nivelDoPlano : conta?.nivel || 'anonimo';
    $('configPlano').textContent = typeof planosLivres !== 'undefined' && planosLivres ? 'Tudo liberado neste servidor' : NOMES_DOS_PLANOS[nivel] || nivel;
    const desde = window.NexoTempo?.desdeDe('self');
    $('configTempo').textContent = Number.isFinite(desde) ? NexoTempo.extenso(Date.now() - desde) : 'fora de uma sala';
    const temConta = Boolean(perfil?.conta || conta);
    $('configEditarPerfil').hidden = !temConta;
    $('configCriarConta').hidden = temConta;
    $('configConta').hidden = !temConta;
    $('configPerfilDica').textContent = temConta
      ? 'Apelido, cor e marca mudam na hora para todo mundo nesta sala, e valem nas próximas.'
      : 'Sem conta, o nome vale só nesta entrada. Com uma conta grátis você escolhe apelido, cor e marca, e o perfil segue você em todo aparelho.';
  }
  $('configEditarPerfil').addEventListener('click', () => {
    painel.classList.add('hidden');
    window.NexoPerfilSala?.abrir();
  });
  $('configCriarConta').href = `/conta?voltar=${encodeURIComponent(location.pathname)}`;

  // ---------- Abrir numa seção ----------
  function abrir(secao) {
    const aba = { perfil: 'abaPerfil', aparelhos: 'abaAparelhos', qualidade: 'abaQualidade', sons: 'abaSons', aparencia: 'abaAparencia', atalhos: 'abaAtalhos' }[secao];
    if (painel.classList.contains('hidden')) devicesBtn.click();
    if (aba) abas.mostrarAba?.(aba);
  }
  document.querySelectorAll('[data-abrir-secao]').forEach(botao => botao.addEventListener('click', () => abrir(botao.dataset.abrirSecao)));

  // O perfil muda com a sala (entrar, trocar de apelido, virar premium): ele é repintado sempre
  // que o painel abre ou que a seção dele aparece.
  new MutationObserver(() => { if (!painel.classList.contains('hidden')) pintarPerfil(); })
    .observe(painel, { attributes: true, attributeFilter: ['class'] });
  $('abaPerfil').addEventListener('click', pintarPerfil);
  setInterval(() => { if (!painel.classList.contains('hidden') && !$('painelPerfil').hidden) pintarPerfil(); }, 15000);

  recarregar();
  window.NexoConta?.pronto.then(() => { recarregar(); pintarPerfil(); }).catch(() => {});

  window.NexoConfig = { abrir, recarregar, aoMudarPlano };
})();
