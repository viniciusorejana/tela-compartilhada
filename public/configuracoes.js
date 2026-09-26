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
  const PADRAO = Object.freeze({ densidade: 'confortavel', texto: 'normal', tempos: false, reacoes: true, menosMovimento: false });
  let aparencia = { ...PADRAO };

  function limpar(bruto) {
    const limpo = { ...PADRAO };
    if (!bruto || typeof bruto !== 'object') return limpo;
    if (['confortavel', 'compacta'].includes(bruto.densidade)) limpo.densidade = bruto.densidade;
    if (['normal', 'grande', 'maior'].includes(bruto.texto)) limpo.texto = bruto.texto;
    for (const chave of ['tempos', 'reacoes', 'menosMovimento']) if (typeof bruto[chave] === 'boolean') limpo[chave] = bruto[chave];
    return limpo;
  }

  // As classes vão no `.app` (a sala inteira) e na prévia do painel, que fica fora dela: a
  // prévia mostra a escolha com as mesmas regras de estilo que a sala vai usar.
  function aplicar() {
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
  }

  function pintarControles() {
    const marcar = (nome, valor) => { const opcao = painel.querySelector(`input[name="${nome}"][value="${valor}"]`); if (opcao) opcao.checked = true; };
    marcar('densidade', aparencia.densidade);
    marcar('textoChat', aparencia.texto);
    $('aparenciaTempos').checked = aparencia.tempos;
    $('aparenciaReacoes').checked = aparencia.reacoes;
    $('aparenciaMovimento').checked = aparencia.menosMovimento;
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
    aplicar();
  }

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

  window.NexoConfig = { abrir, recarregar };
})();
