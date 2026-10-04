/* O painelzinho que abre ao lado de um botão: a base do seletor de cor (seletor-cor.js) e do seletor de
 * emojis (emojis.js). Uma peça só, para os dois não repetirem o que é difícil acertar.
 *
 *   const p = NexoPopover.abrir(botao, caixa => { caixa.append(...); }, { rotulo, classe, aoFechar, foco });
 *   p.fechar();   NexoPopover.fechar();   NexoPopover.atual();
 *
 * O que ele resolve:
 *   - ancora no botão e cabe na janela (abre para baixo; sem lugar, para cima; nunca sai pelos lados). No
 *     celular (até 520 px) vira uma folha embaixo, com o fundo escurecido -- o polegar alcança, e o teclado
 *     da tela não esconde o campo de busca;
 *   - um de cada vez: abrir outro fecha o primeiro;
 *   - o Esc fecha só ele (a janela, antes de qualquer outro ouvinte: o painel de onde veio continua aberto),
 *     o Tab gira dentro dele, e o foco volta ao botão quando se fecha pelo teclado;
 *   - clicar fora fecha. O clique que fechou NÃO vale para o que estiver embaixo quando é no fundo de um
 *     painel (senão o painel fechava junto), no próprio botão (senão fechar e reabrir era um clique só) ou
 *     no fundo escurecido da folha do celular (que cobre a tela: o toque só a dispensa, e o `click` que
 *     sobra cairia num botão da página). Em qualquer outro botão ele passa: fechar e agir é um gesto só;
 *   - acompanha o botão quando a página rola ou a janela muda de tamanho, e fecha se o botão sai da tela.
 *
 * Não é `role="dialog"` de propósito: public/room-ui.js trata todo dialog como modal e marca a sala
 * inteira como `inert` (docs/interface.md, seção 8). É um `group`, em `body`, fora de qualquer painel --
 * camada 106 (docs/interface.md, 2.9).
 */
(function (root) {
  const doc = root.document;
  const FOLGA = 10;
  let atual = null;

  const celular = () => root.matchMedia('(max-width:520px)').matches;
  const focaveis = caixa => [...caixa.querySelectorAll('button:not(:disabled),input:not([type="hidden"]):not(:disabled),select,textarea,[tabindex="0"]')]
    .filter(el => el.getClientRects().length);

  function abrir(ancora, montar, { rotulo = '', classe = '', aoFechar = null, foco = null } = {}) {
    fechar();
    const caixa = doc.createElement('div');
    caixa.className = `nx-pop${classe ? ` ${classe}` : ''}`;
    caixa.setAttribute('role', 'group');
    if (rotulo) caixa.setAttribute('aria-label', rotulo);
    // O fundo escurecido só existe na folha do celular; no computador o resto da página segue à vista.
    const fundo = celular() ? doc.createElement('div') : null;
    if (fundo) { fundo.className = 'nx-pop-fundo'; doc.body.append(fundo); }
    doc.body.append(caixa);
    montar(caixa);
    ancora?.setAttribute('aria-expanded', 'true');

    let engolir = null;   // o alvo do clique de fora, para decidir se ele ainda vale
    let fechado = false;
    let primeira = true;

    function posicionar() {
      if (!ancora?.isConnected) { instancia.fechar(); return; }
      caixa.classList.toggle('folha', celular());
      if (celular()) { caixa.style.left = caixa.style.top = ''; return; }
      const a = ancora.getBoundingClientRect();
      // O botão saiu da janela (a lista rolou por baixo dele): o painelzinho não tem mais a quem se agarrar.
      // Não vale na abertura: uma gaveta que ainda desliza para dentro da tela tem o botão fora dela por
      // alguns quadros, e o painelzinho que ela acabou de pedir não pode nascer fechado.
      const fora = a.bottom < 0 || a.top > root.innerHeight || a.right < 0 || a.left > root.innerWidth;
      if (fora && !primeira) { instancia.fechar(); return; }
      primeira = false;
      const largura = caixa.offsetWidth, altura = caixa.offsetHeight;
      const esquerda = Math.min(Math.max(FOLGA, a.left), Math.max(FOLGA, root.innerWidth - largura - FOLGA));
      // Para baixo, e para cima quando não cabe: o botão de emojis do chat fica no pé da janela. E sempre
      // inteiro dentro da janela, mesmo que o botão esteja meio fora dela (um painel que rola por baixo).
      const cabeEmBaixo = a.bottom + 8 + altura <= root.innerHeight - FOLGA;
      const sugerido = cabeEmBaixo ? a.bottom + 8 : a.top - altura - 8;
      const topo = Math.min(Math.max(FOLGA, sugerido), Math.max(FOLGA, root.innerHeight - altura - FOLGA));
      caixa.dataset.lado = cabeEmBaixo ? 'baixo' : 'cima';
      caixa.style.left = `${Math.round(esquerda)}px`;
      caixa.style.top = `${Math.round(topo)}px`;
    }

    const teclas = evento => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        instancia.fechar({ devolverFoco: true });
      } else if (evento.key === 'Tab' && caixa.contains(doc.activeElement)) {
        const itens = focaveis(caixa);
        const primeiro = itens[0], ultimo = itens[itens.length - 1];
        if (evento.shiftKey && doc.activeElement === primeiro) { evento.preventDefault(); ultimo?.focus(); }
        else if (!evento.shiftKey && doc.activeElement === ultimo) { evento.preventDefault(); primeiro?.focus(); }
      }
    };
    const aoApertarFora = evento => {
      if (caixa.contains(evento.target)) return;
      engolir = evento.target;
      // O fundo escurecido da folha cobre a tela inteira: um toque nele só serve para dispensá-la. Ela fecha
      // já no `pointerdown` e o fundo sai da página, então o `click` que o navegador sintetiza no fim do toque
      // cairia no que estava por baixo -- um botão da página que o dedo nem mirava (era o menu da barra).
      const noFundoDaFolha = Boolean(engolir.classList?.contains('nx-pop-fundo'));
      instancia.fechar();
      // O clique que vem logo depois: se é no fundo de um painel, no próprio botão ou no fundo da folha, ele
      // só fecha o painelzinho. Registrado uma vez, e retirado quando a espera acaba: com o clique, com o
      // prazo, ou com o próximo toque -- um toque que virou rolagem não clica (o navegador manda
      // `pointercancel`), e não pode deixar engolido o clique do toque seguinte, que o clique do anterior
      // já teria precedido. O `pointerdown` que está sendo tratado agora não conta: a janela já o passou.
      let prazo = 0;
      const retirar = () => {
        root.removeEventListener('click', engolirClique, true);
        root.removeEventListener('pointerdown', retirar, true);
        clearTimeout(prazo);
      };
      const engolirClique = clique => {
        retirar();
        const noBotao = ancora?.contains(clique.target);
        const noFundoDePainel = clique.target === engolir && clique.target.matches?.('.modal, .nx-pop-fundo, [role="dialog"]');
        if (noFundoDaFolha || noBotao || noFundoDePainel) { clique.stopPropagation(); clique.preventDefault(); }
      };
      root.addEventListener('click', engolirClique, true);
      root.addEventListener('pointerdown', retirar, true);
      prazo = setTimeout(retirar, 600);
    };
    // Rolar o que está por baixo MOVE o painelzinho junto com o botão (e o fecha só se o botão sai da janela).
    // Fechar a cada rolagem era um defeito: o chat da sala rola sozinho quando chega uma mensagem, e no
    // celular o teclado da tela que sobe rola a página para mostrar o campo que acabou de ganhar o foco.
    // Uma vez por quadro: a rolagem dispara dezenas de eventos por segundo.
    let quadro = 0;
    const aoRolar = evento => {
      if (caixa.contains(evento.target) || quadro) return;
      quadro = root.requestAnimationFrame(() => { quadro = 0; if (!fechado) posicionar(); });
    };
    const aoRedimensionar = () => posicionar();

    const instancia = {
      el: caixa,
      reposicionar: posicionar,
      fechar({ devolverFoco = false } = {}) {
        if (fechado) return;
        fechado = true;
        if (atual === instancia) atual = null;
        root.removeEventListener('keydown', teclas, true);
        doc.removeEventListener('pointerdown', aoApertarFora, true);
        root.removeEventListener('scroll', aoRolar, true);
        root.removeEventListener('resize', aoRedimensionar);
        const comFoco = caixa.contains(doc.activeElement);
        caixa.remove();
        fundo?.remove();
        ancora?.setAttribute('aria-expanded', 'false');
        // O foco volta ao botão quando saiu do painelzinho por um gesto de teclado, ou quando estava nele
        // e ele sumiu: sem isto o foco cai no `body`, e o Tab recomeça da primeira peça da página.
        if ((devolverFoco || comFoco) && ancora?.isConnected) ancora.focus({ preventScroll: true });
        aoFechar?.();
      }
    };
    atual = instancia;
    root.addEventListener('keydown', teclas, true);
    doc.addEventListener('pointerdown', aoApertarFora, true);
    root.addEventListener('scroll', aoRolar, true);
    root.addEventListener('resize', aoRedimensionar);
    posicionar();
    // O foco entra no painelzinho: onde a pessoa vai agir (o campo de busca, a área da cor), ou na primeira peça.
    const alvo = typeof foco === 'function' ? foco(caixa) : foco ? caixa.querySelector(foco) : null;
    (alvo || focaveis(caixa)[0])?.focus({ preventScroll: true });
    return instancia;
  }

  function fechar(opcoes) { atual?.fechar(opcoes); }

  root.NexoPopover = { abrir, fechar, atual: () => atual };
})(window);
