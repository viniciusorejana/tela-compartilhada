/* Uma alça para mudar o tamanho de um painel: arrastar com o mouse ou o dedo, as setas no teclado.
 *
 * O chat da sala nasceu com a largura que coube no desenho (266 a 320 px conforme a janela), e quem
 * conversa muito quer uma coluna larga, enquanto quem só assiste a quer fina. O tamanho certo é de
 * quem usa: a alça fica na borda do painel, e a escolha é lembrada.
 *
 * A alça é focável, e não só uma faixa que reage ao mouse: sem o teclado, quem não arrasta não teria
 * como mudar nada. De um eixo só (a largura do chat) ela é um `role="separator"` e diz o valor atual
 * (`aria-valuenow`) e os limites, que é o que o leitor de tela precisa para anunciá-la como uma
 * divisória que se move. De dois eixos (o painel de mensagens, pelo canto) não existe papel no ARIA
 * para "um valor em duas direções": ela é um botão com o nome e a dica das setas.
 *
 * Este arquivo não sabe o que está sendo redimensionado: quem usa diz, para cada eixo, como ler o
 * valor de agora, os limites e como aplicar um valor novo. Assim a mesma peça serve a coluna do chat
 * e o painel de mensagens, cada um com a sua conta.
 *
 *   NexoRedimensionar.ligar(alca, {
 *     rotulo:  'Mudar o tamanho do painel',   // só nas alças de dois eixos
 *     eixos: [{                               // ou, de um eixo só, estas chaves direto em `opcoes`
 *       eixo:      'x' | 'y',                 // por onde se arrasta
 *       sentido:   -1 | 1,                    // -1: arrastar para a esquerda (ou para cima) AUMENTA
 *       fator:     número,                    // 2 num painel centralizado: os dois lados crescem
 *       passo:     px por tecla (16),
 *       ler:       () => valor de agora, em px,
 *       limites:   () => [minimo, maximo],
 *       aplicar:   (valor, { final }) => ..., // `final` quando o arrasto ou a tecla terminou
 *       padrao:    () => o valor de "voltar ao normal" (duplo clique ou Enter),
 *       descrever: valor => texto para o leitor de tela
 *     }]
 *   }) -> { atualizar }
 */
(function (root) {
  const PASSO = 16;

  function ligar(alca, opcoes) {
    const eixos = (opcoes.eixos || [opcoes]).map(e => ({
      ...e,
      eixo: e.eixo === 'y' ? 'y' : 'x',
      sentido: e.sentido === 1 ? 1 : -1,
      fator: e.fator || 1,
      passo: e.passo || PASSO,
      descrever: e.descrever || (valor => `${Math.round(valor)} px`)
    }));
    const unico = eixos.length === 1 ? eixos[0] : null;
    const limitar = (e, valor) => {
      const [minimo, maximo] = e.limites();
      return Math.round(Math.min(Math.max(valor, minimo), Math.max(minimo, maximo)));
    };

    alca.tabIndex = 0;
    if (unico) {
      alca.setAttribute('role', 'separator');
      alca.setAttribute('aria-orientation', unico.eixo === 'x' ? 'vertical' : 'horizontal');
    } else {
      alca.setAttribute('role', 'button');
      alca.setAttribute('aria-label', opcoes.rotulo || 'Mudar o tamanho');
      alca.setAttribute('aria-description', 'Use as setas do teclado para mudar o tamanho, e Enter para voltar ao normal.');
    }

    function atualizar() {
      if (!unico) return;
      const [minimo, maximo] = unico.limites();
      const valor = unico.ler();
      alca.setAttribute('aria-valuemin', String(Math.round(minimo)));
      alca.setAttribute('aria-valuemax', String(Math.round(Math.max(minimo, maximo))));
      alca.setAttribute('aria-valuenow', String(Math.round(valor)));
      alca.setAttribute('aria-valuetext', unico.descrever(valor));
    }

    function aplicar(e, valor, final) {
      e.aplicar(limitar(e, valor), { final });
      atualizar();
    }

    let arrasto = null;
    alca.addEventListener('pointerdown', evento => {
      // Só o botão principal: o do meio e o da direita têm o que fazer no navegador.
      if (evento.button !== 0 || arrasto) return;
      evento.preventDefault();
      arrasto = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, valores: eixos.map(e => e.ler()) };
      // A captura mantém os eventos nesta alça mesmo com o ponteiro sobre o vídeo, o iframe da camada
      // ou fora da janela: sem ela o arrasto soltava ao cruzar o palco.
      try { alca.setPointerCapture(evento.pointerId); } catch (_) { /* ponteiro que já não existe */ }
      alca.classList.add('arrastando');
      document.documentElement.classList.add('redimensionando', ...(unico ? [`redimensionando-${unico.eixo}`] : ['redimensionando-xy']));
      alca.focus({ preventScroll: true });
    });
    alca.addEventListener('pointermove', evento => {
      if (!arrasto || evento.pointerId !== arrasto.id) return;
      eixos.forEach((e, i) => {
        const delta = e.eixo === 'x' ? evento.clientX - arrasto.x : evento.clientY - arrasto.y;
        aplicar(e, arrasto.valores[i] + delta * e.sentido * e.fator, false);
      });
    });
    const terminar = evento => {
      if (!arrasto || evento.pointerId !== arrasto.id) return;
      arrasto = null;
      try { alca.releasePointerCapture(evento.pointerId); } catch (_) { /* já solto */ }
      alca.classList.remove('arrastando');
      document.documentElement.classList.remove('redimensionando', 'redimensionando-x', 'redimensionando-y', 'redimensionando-xy');
      for (const e of eixos) aplicar(e, e.ler(), true);
    };
    alca.addEventListener('pointerup', terminar);
    alca.addEventListener('pointercancel', terminar);

    // Voltar ao normal é o gesto de "desfazer" de quem se arrependeu do tamanho.
    const voltar = () => { for (const e of eixos) aplicar(e, e.padrao(), true); };
    alca.addEventListener('dblclick', voltar);

    alca.addEventListener('keydown', evento => {
      if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); voltar(); return; }
      const setas = { ArrowRight: ['x', 1], ArrowLeft: ['x', -1], ArrowDown: ['y', 1], ArrowUp: ['y', -1] }[evento.key];
      // A seta aponta para onde a divisória vai: para a esquerda, a divisória de um painel à direita
      // anda para a esquerda, e o painel cresce.
      const e = setas && eixos.find(outro => outro.eixo === setas[0]);
      if (e) {
        evento.preventDefault();
        aplicar(e, e.ler() + setas[1] * e.sentido * e.passo * (evento.shiftKey ? 4 : 1), true);
      } else if (unico && (evento.key === 'Home' || evento.key === 'End')) {
        // Home e End levam ao menor e ao maior valor, como em qualquer separador: o valor é o tamanho
        // do painel, e não a posição da divisória.
        evento.preventDefault();
        const [minimo, maximo] = unico.limites();
        aplicar(unico, evento.key === 'Home' ? minimo : maximo, true);
      }
    });

    atualizar();
    return { atualizar };
  }

  root.NexoRedimensionar = { ligar };
})(window);
