/* O início de quem tem conta (e a página da conta) por cima da sala, sem sair da chamada.
 *
 * Antes, a marca do Nexo na lateral e "Senha e conta" tiravam a pessoa da chamada: para ver os
 * amigos, as mensagens ou as conquistas, era sair da sala (o microfone, a câmera e a tela
 * param, e a sala vê a saída) e voltar depois. Agora a página abre numa camada por cima da sala, e
 * a chamada segue conectada por baixo: a mesma conexão, o mesmo microfone, o mesmo som.
 *
 * A camada é um painel como os outros (room-ui.js): a sala fica `inert`, o Esc fecha e o foco volta
 * a quem abriu. A página dentro dela é a de sempre -- `/` e `/conta`, num <iframe> da própria origem
 * (public/camada.js é o lado de lá). Reaproveitá-la inteira, isolada, é o que mantém uma tela só
 * para dois lugares; o <iframe> nasce a cada abertura e morre ao fechar, e com ele o socket de
 * amigos que abriu (o servidor já aceita várias abas da mesma conta), então fechada a camada não
 * sobra nada rodando por baixo.
 *
 * O que a camada acrescenta ao redor da página:
 *   - uma barra com a sala, o microfone, o ouvir, o sair e a volta, porque a barra de controles da
 *     sala fica por baixo (e `inert`);
 *   - os avisos de mensagem, convite e conquista passam a ser os da página de dentro: sem isso, a
 *     sala e a página avisariam duas vezes (social-sala.js);
 *   - o "voltar" do navegador fecha a camada, e não a sala;
 *   - entrar noutra sala pergunta antes: entrar sai desta chamada.
 *
 * Só com conta e só dentro da chamada. Sem conta não há amigos, e fora da chamada a marca do Nexo
 * leva ao início de verdade, como sempre levou (sala.js).
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('camadaPanel');
  const barra = painel.querySelector('.camada-barra');
  const corpo = $('camadaCorpo');
  const espera = $('camadaEspera');
  const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
  const PAGINAS = {
    inicio: { caminho: '/', titulo: 'Início do Nexo' },
    conta: { caminho: '/conta', titulo: 'Sua conta' }
  };
  // Uma página que não diz "pronto" nesse prazo é uma página que não abriu (servidor fora, rede
  // caída): a camada diz isso e oferece tentar de novo, em vez de ficar girando.
  const PRAZO_DE_ABERTURA_MS = 10000;
  // Quanto o painel leva para sair (--dur-lenta). A página só é tirada depois: durante a saída o
  // painel ainda aparece, e uma página já removida seria um quadro vazio sumindo.
  const SAIDA_MS = 320;
  const salaDaChamada = String(roomCode).toLowerCase();

  let quadro = null;
  let pronta = false;
  let paginaAtual = 'inicio';
  let enderecoAtual = '';
  let aoFicarPronta = [];
  let prazo = null;
  let relogio = null;
  let estavaAberta = false;
  // O "voltar" do navegador: abrir a camada acrescenta uma entrada ao histórico, e voltar a tira.
  let empilhouHistorico = false;
  let fechandoPeloHistorico = false;
  let trincoDoHistorico = null;
  let destinoPendente = '';

  const aberta = () => !painel.classList.contains('hidden');
  const comConta = () => Boolean(window.NexoConta?.atual?.().conta);
  const naChamada = () => typeof tiles !== 'undefined' && tiles.has('self');
  // No modo compacto a janela é só o palco, pequena, por cima do jogo (e o botão de sair dele fica
  // acima de qualquer camada): ali não há o que abrir.
  const compacto = () => document.querySelector('.app')?.classList.contains('compacto-local');
  const pode = () => comConta() && naChamada() && CODIGO_DE_SALA.test(salaDaChamada) && !compacto();

  function enviar(tipo, dados = {}) {
    try { quadro?.contentWindow?.postMessage({ nexo: 'camada', tipo, ...dados }, window.location.origin); } catch (_) { /* o quadro saiu de cena */ }
  }

  // ---------- A barra: a chamada à mão ----------
  // Os botões daqui não têm estado próprio: espelham os da barra de controles da sala (que fica
  // por baixo, `inert`) e chamam as mesmas funções. Quem muda o microfone é sempre sala.js.
  const micDaSala = $('micBtn');
  const fonesDaSala = $('deafenBtn');
  function espelhar(origem, destino) {
    destino.setAttribute('aria-pressed', origem.getAttribute('aria-pressed') || 'false');
    destino.title = origem.title;
    destino.setAttribute('aria-label', origem.title);
    destino.disabled = origem.disabled;
  }
  function pintarBotoes() {
    espelhar(micDaSala, $('camadaMic'));
    espelhar(fonesDaSala, $('camadaOuvir'));
  }
  for (const botao of [micDaSala, fonesDaSala]) {
    new MutationObserver(pintarBotoes).observe(botao, { attributes: true, attributeFilter: ['aria-pressed', 'title', 'disabled'] });
  }
  $('camadaMic').addEventListener('click', () => alternarMicPorGesto());
  $('camadaOuvir').addEventListener('click', () => alternarEnsurdecimento());
  $('camadaSair').addEventListener('click', () => sairDaSala());
  $('camadaVoltar').addEventListener('click', () => fechar());

  // A sala e o relógio saem dos textos que a própria sala já mantém, em vez de uma segunda conta.
  function pintarSala() {
    const total = Number($('sidebarCount').textContent) || 0;
    const desde = $('sessionClock').textContent.replace(/^Você está /, '');
    $('camadaSalaNome').textContent = `#${roomCode}`;
    $('camadaSalaMeta').textContent = `${total} ${total === 1 ? 'pessoa' : 'pessoas'} · ${desde}`;
    barra.classList.toggle('instavel', !document.querySelector('.connection-box')?.classList.contains('connected'));
  }

  // ---------- A página ----------
  function endereco(pagina, { secao = null, conversa = null } = {}) {
    const url = new URL(PAGINAS[pagina].caminho, window.location.origin);
    url.searchParams.set('camada', salaDaChamada);
    if (secao) url.searchParams.set('secao', secao);
    if (conversa) url.searchParams.set('conversa', conversa);
    return url.pathname + url.search;
  }
  function montarQuadro(url) {
    desmontarQuadro();
    pronta = false;
    enderecoAtual = url;
    espera.hidden = false;
    espera.classList.remove('falhou');
    $('camadaEsperaTexto').textContent = 'Abrindo…';
    $('camadaTentar').hidden = true;
    quadro = document.createElement('iframe');
    quadro.className = 'camada-quadro';
    quadro.title = PAGINAS[paginaAtual].titulo;
    // O foco entra na página, e não no primeiro botão da barra (room-ui.js, `data-foco-inicial`).
    quadro.setAttribute('data-foco-inicial', '');
    quadro.src = url;
    corpo.append(quadro);
    $('camadaTitulo').textContent = PAGINAS[paginaAtual].titulo;
    clearTimeout(prazo);
    prazo = setTimeout(() => { if (!pronta) falhou(); }, PRAZO_DE_ABERTURA_MS);
  }
  function desmontarQuadro() {
    clearTimeout(prazo);
    quadro?.remove();
    quadro = null;
    pronta = false;
    aoFicarPronta = [];
  }
  function falhou() {
    espera.classList.add('falhou');
    $('camadaEsperaTexto').textContent = 'Não foi possível abrir agora. A chamada continua; confira a conexão e tente de novo.';
    $('camadaTentar').hidden = false;
  }
  $('camadaTentar').addEventListener('click', () => montarQuadro(enderecoAtual));

  function ficouPronta() {
    if (pronta || !quadro) return;
    pronta = true;
    clearTimeout(prazo);
    espera.hidden = true;
    quadro.classList.add('pronto');
    // `data-foco-inicial` pôs o foco no quadro; aqui ele passa para a página dentro dele.
    try { quadro.contentWindow.focus(); } catch (_) { /* o quadro saiu de cena */ }
    for (const fazer of aoFicarPronta.splice(0)) fazer();
  }
  const quandoPronta = fazer => (pronta ? fazer() : aoFicarPronta.push(fazer));

  // ---------- Abrir e fechar ----------
  // `secao`: uma seção do início (perfil, conquistas, adicionar, pedidos); `conversa`: o código de
  // um amigo; `buscar`: levar o foco à busca (o Ctrl K de dentro da sala).
  function abrir({ pagina = 'inicio', secao = null, conversa = null, buscar = false } = {}) {
    if (!PAGINAS[pagina] || !pode()) return false;
    const comandos = () => {
      if (secao) enviar('secao', { nome: secao });
      if (conversa) enviar('abrir-conversa', { com: conversa });
      if (buscar) enviar('buscar');
    };
    if (aberta()) {
      // Já aberta: outra página troca o quadro; a mesma só recebe o pedido.
      if (pagina !== paginaAtual) {
        paginaAtual = pagina;
        montarQuadro(endereco(pagina, { secao, conversa }));
        if (buscar) quandoPronta(() => enviar('buscar'));
      } else quandoPronta(comandos);
      return true;
    }
    paginaAtual = pagina;
    // Um elemento em tela cheia (o palco) cobre a página inteira, camada incluída: ela abriria
    // invisível, com a sala `inert` por baixo e ninguém para ver. Sai da tela cheia antes (o Ctrl K
    // chega aqui sem que a marca esteja à vista).
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* já tinha saído */ });
    // Na gaveta do celular, a marca é o que se toca para chegar aqui: ela não deve ficar aberta
    // por baixo quando a camada fechar.
    document.querySelector('.app')?.classList.remove('sidebar-open');
    $('sidebarToggle')?.setAttribute('aria-expanded', 'false');
    pintarBotoes();
    pintarSala();
    clearInterval(relogio);
    relogio = setInterval(pintarSala, 1000);
    montarQuadro(endereco(pagina, { secao, conversa }));
    // Sem espaço para repetir o pedido no endereço: `buscar` não é uma seção.
    if (buscar) quandoPronta(() => enviar('buscar'));
    estavaAberta = true;
    painel.classList.remove('hidden');
    window.NexoAndroid?.camada?.(true);
    // Se o "voltar" da abertura anterior ainda não chegou, esta abertura fica sem entrada própria:
    // empilhar agora embaralharia as duas.
    if (!fechandoPeloHistorico) {
      try { history.pushState({ nexoCamada: true }, ''); empilhouHistorico = true; } catch (_) { /* sem histórico, só não há o "voltar" */ }
    }
    return true;
  }
  function fechar() {
    if (!aberta()) return;
    $('camadaSairPanel').classList.add('hidden');
    painel.classList.add('hidden');
  }
  // Quem fecha é sempre a classe `hidden`: o X, o Esc e o clique fora de room-ui.js também a põem,
  // e o que precisa ser desfeito mora num lugar só.
  function aoFechar() {
    clearInterval(relogio);
    window.NexoAndroid?.camada?.(false);
    $('camadaSairPanel').classList.add('hidden');
    setTimeout(() => { if (!aberta()) desmontarQuadro(); }, SAIDA_MS);
    if (empilhouHistorico) {
      empilhouHistorico = false;
      if (history.state?.nexoCamada) {
        fechandoPeloHistorico = true;
        // O trinco solta sozinho se o navegador não avisar da volta: preso, ele ignoraria o próximo
        // "voltar" de verdade.
        clearTimeout(trincoDoHistorico);
        trincoDoHistorico = setTimeout(() => { fechandoPeloHistorico = false; }, 1000);
        history.back();
      }
    }
  }
  new MutationObserver(() => {
    const agora = aberta();
    if (agora === estavaAberta) return;
    estavaAberta = agora;
    if (!agora) aoFechar();
  }).observe(painel, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('popstate', () => {
    if (fechandoPeloHistorico) { fechandoPeloHistorico = false; clearTimeout(trincoDoHistorico); return; }
    // O "voltar" já tirou a entrada que a camada acrescentou.
    if (aberta()) { empilhouHistorico = false; fechar(); }
  });

  // Ser removido da sala, ou voltar à espera, pede a atenção inteira: esses avisos moram abaixo da
  // camada, e ficariam invisíveis atrás dela.
  for (const id of ['removidoPanel', 'waitingPanel']) {
    new MutationObserver(() => { if (!$(id).classList.contains('hidden')) fechar(); }).observe($(id), { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- Entrar noutra sala ----------
  // Uma conta está em uma sala só, então entrar noutra sai desta: o que a página pede, a camada
  // pergunta. A mesma sala é só voltar.
  function pedirEntrada(sala) {
    if (!CODIGO_DE_SALA.test(sala)) return;
    if (sala === salaDaChamada) { fechar(); return; }
    destinoPendente = `/${encodeURIComponent(sala)}/sala`;
    $('camadaSairTitulo').textContent = `Sair desta sala para entrar em #${sala}?`;
    $('camadaSairTexto').textContent = `Você sai da chamada de #${roomCode}: o microfone, a câmera e a tela param, e a sala vê você sair. Em seguida você entra em #${sala}.`;
    $('camadaSairConfirmar').textContent = `Sair e entrar em #${sala}`;
    $('camadaSairConfirmar').disabled = false;
    $('camadaSairPanel').classList.remove('hidden');
  }
  $('camadaSairConfirmar').addEventListener('click', () => {
    if (!destinoPendente) return;
    $('camadaSairConfirmar').disabled = true;
    $('camadaSairConfirmar').textContent = 'Saindo da sala…';
    sairDaSala(destinoPendente);
  });

  // ---------- O que a página diz ----------
  window.addEventListener('message', evento => {
    if (!quadro || evento.source !== quadro.contentWindow || evento.origin !== window.location.origin) return;
    const dados = evento.data;
    if (!dados || dados.nexo !== 'camada' || typeof dados.tipo !== 'string') return;
    switch (dados.tipo) {
      case 'pronto':
        // A página pode trocar de uma para a outra por dentro (do início para a conta, pela
        // engrenagem): a camada acompanha, para o título e para o próximo pedido.
        if (PAGINAS[dados.pagina] && dados.pagina !== paginaAtual) {
          paginaAtual = dados.pagina;
          quadro.title = $('camadaTitulo').textContent = PAGINAS[paginaAtual].titulo;
        }
        ficouPronta();
        break;
      case 'fechar': fechar(); break;
      case 'entrar': pedirEntrada(String(dados.sala || '').toLowerCase()); break;
      case 'sem-conta':
        fechar();
        window.NexoToast?.mostrar({ icone: 'erro', tom: 'erro', titulo: 'A sessão da sua conta terminou', detalhe: 'A chamada continua. Para entrar de novo, saia da sala e abra a conta.', fecharEm: 9000 });
        break;
      // Sair da conta, ou apagá-la, deixa a chamada sem a conta que a abriu: a sala sai junto, pelo
      // caminho de sempre, e o servidor e os outros ficam sabendo.
      case 'conta-encerrada': sairDaSala('/'); break;
      // O foco está na página, e o teclado da sala só ouve a janela dela.
      case 'atalho':
        if (dados.tecla === 'm') alternarMicPorGesto();
        else if (dados.tecla === 'd') alternarEnsurdecimento();
        break;
      default: break;
    }
  });

  // ---------- Como se chega aqui ----------
  // A marca do Nexo na lateral. A escuta é na captura do documento, como a do convite em
  // social-sala.js: chega antes da do próprio link (sala.js), que sai da sala. Sem conta, ou fora da
  // chamada (a porta de entrada), `pode()` é falso e o link faz o que sempre fez.
  document.addEventListener('click', evento => {
    const marca = evento.target.closest?.('.workspace-name');
    if (!marca || evento.button || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
    if (!pode()) return;
    evento.preventDefault();
    evento.stopPropagation();
    abrir();
  }, true);
  // Ctrl K, como no início: abre a camada com o foco na busca de amigos e conversas.
  document.addEventListener('keydown', evento => {
    if (!(evento.ctrlKey || evento.metaKey) || evento.shiftKey || evento.altKey || evento.key.toLowerCase() !== 'k') return;
    if (!pode()) return;
    evento.preventDefault();
    abrir({ buscar: true });
  });
  // O gesto de voltar do aplicativo Android, com a camada aberta: fecha a camada, e não guarda o
  // Nexo (MainActivity.voltar). O aplicativo só sabe que ela está aberta pelo aviso de `abrir`.
  window.NexoAndroid?.ao('voltar-camada', () => fechar());
  window.NexoConta?.pronto.then(() => {
    const marca = document.querySelector('.workspace-name');
    if (marca && comConta()) marca.title = 'Abrir o início: amigos, conversas e conquistas. A chamada continua.';
  });

  window.NexoInicioNaSala = {
    pode, abrir, fechar, aberta, pedirEntrada,
    abrirConversa: com => abrir({ conversa: com })
  };
})();
