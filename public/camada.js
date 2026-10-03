/* O lado de dentro da camada da sala.
 *
 * Dentro de uma chamada, o início de quem tem conta (e a página da conta) abrem por cima da sala
 * (public/inicio-na-sala.js), num <iframe> da própria origem: a chamada segue conectada por baixo, e
 * a pessoa vê os amigos, as conversas, as conquistas e o cartão sem sair dela. Este arquivo é o que
 * essas páginas carregam para saber que estão ali e falar com a sala.
 *
 * Por que um <iframe> e não o mesmo código dentro de sala.html: o início e a sala têm regras
 * globais de `button`, `input`, `h2` e ids repetidos (`atualizarAppBtn`…), e cada um se defende
 * dos estilos do outro só quando é a página inteira (docs/interface.md, seção 8). Reaproveitar a
 * página pronta, isolada, é o que mantém uma tela só em dois lugares.
 *
 * A conversa entre as duas páginas é por `postMessage`, e só entre elas: a sala confere a origem e
 * a janela de quem mandou (inicio-na-sala.js), e esta página confere que a mensagem veio da janela
 * de cima, da mesma origem. O endereço leva `?camada=<código da sala>` -- sem ele, ou fora de um
 * quadro, a página é a de sempre.
 *
 * Mensagens daqui para a sala (`avisar`):
 *   pronto             a página carregou e a conta respondeu
 *   fechar             a pessoa quer voltar para a sala (Esc, "Voltar para a sala")
 *   entrar {sala}      ir para outra sala: a sala pergunta, porque entrar sai da chamada
 *   sem-conta          a sessão da conta terminou
 *   conta-encerrada    saiu da conta ou apagou a conta: a sala sai junto
 *   atalho {tecla}     Ctrl+Shift+M ou D, que a sala não ouve com o foco aqui dentro
 * Da sala para cá (`ao`):
 *   buscar             levar o foco à busca (Ctrl K de dentro da sala)
 *   abrir-conversa     {com} abrir a conversa com um amigo
 *   secao              {nome} ir a uma seção do início
 */
(() => {
  const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
  const ouvintes = new Map();

  let emQuadro = false;
  try { emQuadro = window.parent !== window; } catch (_) { emQuadro = true; }
  const pedida = (new URLSearchParams(window.location.search).get('camada') || '').toLowerCase();
  const sala = CODIGO_DE_SALA.test(pedida) ? pedida : null;
  const embutida = emQuadro && Boolean(sala);

  function avisar(tipo, dados = {}) {
    if (!embutida) return;
    try { window.parent.postMessage({ nexo: 'camada', tipo, ...dados }, window.location.origin); } catch (_) { /* a sala saiu de cena */ }
  }
  function ao(tipo, ouvir) {
    if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
    ouvintes.get(tipo).push(ouvir);
  }

  // O endereço de uma página do Nexo que continua dentro da camada. Só caminhos deste site.
  function link(caminho, parametros = {}) {
    const destino = new URL(caminho, window.location.origin);
    if (embutida) destino.searchParams.set('camada', sala);
    for (const [chave, valor] of Object.entries(parametros)) if (valor != null) destino.searchParams.set(chave, valor);
    return destino.pathname + destino.search;
  }
  // Trocar de página dentro da camada SEM acrescentar uma entrada ao histórico: o "voltar" do
  // navegador pertence à sala (que fecha a camada com ele), e uma entrada a mais faria o fechar
  // desfazer a navegação do quadro em vez de fechar.
  function irPara(caminho, parametros) {
    window.location.replace(link(caminho, parametros));
  }

  if (embutida) {
    document.documentElement.classList.add('na-camada');
    window.addEventListener('message', evento => {
      if (evento.source !== window.parent || evento.origin !== window.location.origin) return;
      const dados = evento.data;
      if (!dados || dados.nexo !== 'camada' || typeof dados.tipo !== 'string') return;
      for (const ouvir of ouvintes.get(dados.tipo) || []) {
        try { ouvir(dados); } catch (erro) { console.error('[camada]', erro); }
      }
    });
    // O microfone e o fone são da chamada, e a chamada é da sala: Ctrl+Shift+M e D funcionam com
    // o foco aqui dentro também. A sala só ouve o teclado da janela dela.
    document.addEventListener('keydown', evento => {
      if (!(evento.ctrlKey && evento.shiftKey) || evento.repeat) return;
      const tecla = evento.key.toLowerCase();
      if (tecla !== 'm' && tecla !== 'd') return;
      evento.preventDefault();
      avisar('atalho', { tecla });
    });
  }

  window.NexoCamada = Object.freeze({ embutida, sala, avisar, ao, link, irPara });
})();
