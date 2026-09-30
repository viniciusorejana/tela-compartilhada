/* O Estúdio dentro da sala: a permissão, os links do cartão de perfil e quem está no OBS.
 *
 * Três coisas, e o caminho até o painel do Estúdio (estudio.js), que é onde moram os rostos que
 * reagem e os links de todo mundo de uma vez:
 *
 *  - a permissão de cada um. "Deixar que me levem para o OBS" é uma decisão sobre si mesmo:
 *    segue a conta (perfil.js), vai no aperto de mão do socket para valer desde a entrada
 *    (sala.js), e desligar derruba na hora o que já estava no ar (estudio-ao-vivo.js);
 *
 *  - os links. Saem do cartão de perfil de cada pessoa, que é onde se pergunta "quem é essa":
 *    Câmera, Tela, Voz, Som da tela e o Rosto que reage. O servidor devolve todos de uma vez ao
 *    abrir o cartão, e o clique só copia -- a área de transferência não espera resposta de rede;
 *
 *  - o aviso. Um selo "OBS" no quadradinho de quem está sendo levado, com o nome de quem leva e
 *    o quê, e um selo na barra de cima enquanto houver qualquer captura na sala. Oculta no
 *    servidor de mídia não é escondida de quem está na sala.
 *
 * Usa as globais de sala.js (socket, peers, myId, perfilAberto, nomeDe, publicInviteUrl,
 * ehCelular), como os outros scripts da sala.
 */
(() => {
  const $ = id => document.getElementById(id);
  const O_QUE = { camera: 'a câmera', tela: 'a tela', voz: 'a voz', somDaTela: 'o som da tela', reativo: 'o rosto que reage' };
  const O_SEU = { camera: 'a sua câmera', tela: 'a sua tela', voz: 'a sua voz', somDaTela: 'o som da sua tela', reativo: 'o seu rosto que reage' };
  const DO_LINK = { camera: 'da câmera', tela: 'da tela', voz: 'da voz', somDaTela: 'do som da tela', reativo: 'do rosto que reage' };
  let capturas = [];

  // ---------- A permissão ----------
  const lerPermissao = () => window.Preferencias?.lerAjuste('estudio', null)?.permitir !== false;
  let permitir = lerPermissao();

  function avisarServidor() {
    if (typeof socket !== 'undefined' && socket?.connected) socket.emit('estudio-permissao', { permitir });
  }

  $('estudioPermitir').checked = permitir;
  $('estudioPermitir').addEventListener('change', evento => {
    permitir = evento.target.checked;
    window.Preferencias?.gravarAjuste('estudio', { permitir });
    avisarServidor();
  });
  // A escolha feita em outro aparelho chega com a conta, depois de a página carregar.
  window.NexoConta?.pronto.then(() => {
    const daConta = lerPermissao();
    if (daConta === permitir) return;
    permitir = daConta;
    $('estudioPermitir').checked = permitir;
    avisarServidor();
  }).catch(() => {});

  // ---------- Quem está no OBS ----------
  const identidadeDaTela = id => (id === 'self' ? (typeof myId !== 'undefined' ? myId : null) : id);
  const nomeDaIdentidade = identidade => (identidade && typeof myId !== 'undefined' && identidade === myId ? 'Você' : (typeof nomeDe === 'function' && nomeDe(identidade)) || 'Alguém');
  // "Ana leva a sua câmera para o OBS", "Você leva a tela de Bia para o OBS".
  const frase = c => {
    const quem = nomeDaIdentidade(c.diretor);
    if (c.fonte === 'reativo' && !c.alvo) return `${quem} leva os rostos da sala para o OBS`;
    const eu = typeof myId !== 'undefined' && c.alvo === myId;
    const coisa = eu ? O_SEU[c.fonte] : O_QUE[c.fonte] && `${O_QUE[c.fonte]} de ${nomeDaIdentidade(c.alvo)}`;
    return `${quem} leva ${coisa || 'uma fonte'} para o OBS`;
  };

  function pintarSelos() {
    document.querySelectorAll('#participants .participant').forEach(tile => {
      const identidade = identidadeDaTela(tile.dataset.id);
      const fontes = tile.dataset.source === 'screen' ? ['tela', 'somDaTela'] : ['camera', 'voz', 'reativo'];
      const linhas = capturas.filter(c => c.alvo && c.alvo === identidade && fontes.includes(c.fonte));
      let selo = tile.querySelector('.obs-selo');
      if (!linhas.length) { selo?.remove(); return; }
      if (!selo) {
        selo = document.createElement('span');
        selo.className = 'obs-selo';
        selo.textContent = 'OBS';
        tile.querySelector('.avatar-wrap')?.append(selo);
      }
      const texto = linhas.map(frase).join(' · ');
      selo.title = texto;
      selo.setAttribute('aria-label', texto);
    });
  }

  function pintarLista() {
    const lista = $('estudioCapturasLista');
    lista.replaceChildren(...capturas.map(c => {
      const item = document.createElement('li');
      item.textContent = frase(c);
      return item;
    }));
    $('estudioNada').hidden = capturas.length > 0;
    const chip = $('obsNaSala');
    chip.hidden = !capturas.length;
    const resumo = capturas.map(frase).join(' · ');
    chip.title = resumo;
    chip.setAttribute('aria-label', `No OBS agora: ${resumo}`);
  }

  function repintar() { pintarSelos(); pintarLista(); }

  function atualizar(lista) {
    capturas = Array.isArray(lista) ? lista.filter(c => c && typeof c.diretor === 'string' && typeof c.fonte === 'string') : [];
    repintar();
  }

  // Os quadradinhos nascem e morrem com a mídia, bem depois de o aviso ter chegado: cada um que
  // aparece recebe o selo que já valia para ele.
  const participantes = $('participants');
  if (participantes) new MutationObserver(pintarSelos).observe(participantes, { childList: true });
  document.addEventListener('room-update', repintar);

  // ---------- Os links, no cartão de perfil ----------
  let links = null;
  let pedido = 0;

  function dizer(texto) { $('perfilObsStatus').textContent = texto || ''; }

  function prepararCartao(id) {
    const secao = $('perfilObs');
    const botoes = [...document.querySelectorAll('[data-fonte-obs]')];
    links = null;
    dizer('');
    // O bot de música não tem câmera nem rosto para levar a lugar nenhum.
    secao.hidden = !id || Boolean(typeof peers !== 'undefined' && peers.get(id)?.ehBot);
    if (secao.hidden) return;
    const conta = window.NexoConta?.atual()?.conta;
    botoes.forEach(botao => { botao.disabled = true; });
    if (!conta) { dizer('Levar alguém para o OBS exige uma conta grátis: é ela que responde pela captura.'); return; }
    if (typeof socket === 'undefined' || !socket?.connected) { dizer('Sem conexão com a sala agora. Abra o cartão de novo em instantes.'); return; }
    const este = ++pedido;
    socket.emit('estudio-links', { alvo: id }, resposta => {
      if (este !== pedido) return;
      if (!resposta?.ok) { dizer(resposta?.error || 'Não foi possível preparar os links.'); return; }
      if (!resposta.permite) { dizer(id === 'self' ? 'Você desligou a captura nas configurações (Estúdio).' : 'Esta pessoa não deixa ser levada para o OBS.'); return; }
      links = { ...resposta.links, base: resposta.publicUrl || publicInviteUrl || location.origin };
      botoes.forEach(botao => { botao.disabled = false; });
      dizer('Copie e cole como fonte Navegador no OBS. O link segue você: vale em qualquer sala com essa pessoa.');
    });
  }

  function enderecoDe(fonte) {
    const caminho = links?.[fonte];
    if (!caminho) return null;
    const url = new URL(caminho, links.base);
    if (['camera', 'tela'].includes(fonte) && !$('perfilObsSom').checked) url.searchParams.set('som', '0');
    return url.href;
  }

  // Os mesmos chips do painel do Estúdio: ícone da fonte, e "Copiado" no lugar ao copiar.
  document.querySelectorAll('[data-fonte-obs]').forEach(botao => {
    const fonte = botao.dataset.fonteObs;
    if (window.NexoEstudio) botao.innerHTML = `${NexoEstudio.icone(fonte)}${botao.textContent}`;
    botao.addEventListener('click', async () => {
      const endereco = enderecoDe(fonte);
      if (!endereco) return;
      if (await window.NexoEstudio?.copiar(botao, endereco)) dizer(`Link ${DO_LINK[fonte]} copiado. No OBS: Fontes → Navegador → cole em URL.`);
      else dizer(`Não deu para copiar sozinho. O link: ${endereco}`);
    });
  });

  // O cartão é de sala.js; aqui se escuta ele abrir. `perfilAberto` diz de quem é.
  const cartao = $('perfilPanel');
  const cartaoAberto = () => !cartao.classList.contains('hidden');
  new MutationObserver(() => {
    if (!cartaoAberto()) { pedido++; return; }
    prepararCartao(typeof perfilAberto === 'undefined' ? null : perfilAberto);
  }).observe(cartao, { attributes: true, attributeFilter: ['class'] });

  // ---------- O caminho até o painel ----------
  //
  // O botão da barra de baixo é de quem tem conta, e só no computador: montar uma cena de OBS
  // não é coisa de celular, e a barra de lá já está no limite (estudio.css também o esconde em
  // tela estreita). Sem conta, a aba das configurações explica e leva ao cadastro.
  const noCelular = typeof ehCelular !== 'undefined' && ehCelular;
  function pintarCaminho() {
    const comConta = Boolean(window.NexoConta?.atual()?.conta);
    $('estudioBtn').hidden = !comConta || noCelular;
    $('estudioAbrir').hidden = !comConta;
    $('estudioCriarConta').hidden = comConta;
    $('estudioCriarConta').href = `/conta?voltar=${encodeURIComponent(location.pathname)}`;
    $('estudioConviteTexto').textContent = comConta
      ? (noCelular ? 'No painel do Estúdio, que fica melhor num computador.' : 'No painel do Estúdio, que também abre pelo botão Estúdio da barra de baixo.')
      : 'O painel do Estúdio é de quem tem conta: é ela que responde pelas capturas e guarda as suas imagens.';
  }
  window.NexoConta?.pronto.then(pintarCaminho).catch(() => {});
  pintarCaminho();

  $('estudioBtn').addEventListener('click', () => window.NexoEstudio?.abrir());
  $('estudioAbrir').addEventListener('click', () => {
    $('devicesPanel').classList.add('hidden');
    window.NexoEstudio?.abrir();
  });

  window.NexoEstudioSala = {
    permite: () => permitir,
    aoEntrar: lista => { atualizar(lista); avisarServidor(); },
    // Quem abriu a sala mudou o controle do OBS, ou a sala mudou de dono: o cartão aberto pede os
    // links de novo, porque a resposta pode ter mudado.
    aoMudarSala: () => { if (cartaoAberto()) prepararCartao(typeof perfilAberto === 'undefined' ? null : perfilAberto); },
    atualizar,
    repintar,
    capturas: () => [...capturas]
  };
})();
