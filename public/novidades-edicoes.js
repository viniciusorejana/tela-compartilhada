/* As novidades do Nexo, uma edição por vez. É ESTE o arquivo para mexer quando houver coisa nova.
 *
 * Como publicar uma novidade:
 *
 *   1. Acrescente uma edição NO TOPO da lista, com o `id` seguinte ao maior que já existe.
 *   2. `aparecer: true` faz o modal abrir sozinho, uma vez, para todo mundo que ainda não a leu
 *      -- é para novidade grande, que precisa ser vista. `aparecer: false` só acende o ponto no
 *      botão "Novidades": quem quiser, abre.
 *   3. `abrirEm: 'conheca'` abre na apresentação em vez da lista de novidades. Serve para quando a
 *      própria apresentação mudou muito (um vídeo novo, um jeito novo de usar a sala).
 *   4. Suba o servidor. `npm test` confere a lista (ids, datas, campos) antes.
 *
 * "Lida" é o `id` da edição mais nova que a pessoa fechou. Com conta, ele segue a pessoa em todo
 * aparelho (é um dos ajustes sincronizados, public/perfil.js); sem conta, fica no navegador. Por
 * isso uma edição nunca muda de `id` depois de publicada: renumerar faria todo mundo rever tudo,
 * ou ninguém ver a nova.
 *
 * Cada item: `icone` (um dos nomes de ICONES em public/novidades.js), `titulo`, `texto` e,
 * opcional, `onde` -- o caminho até a coisa, que é o que a pessoa mais procura depois de ler.
 */
(function (root) {
  const EDICOES = Object.freeze([
    {
      id: 1,
      data: '2026-09-26',
      titulo: 'O Nexo de cara nova',
      resumo: 'Tema claro, quem está vendo a sua tela, @ no chat, avisos sonoros e mais uma porção de coisas que chegaram nas últimas semanas.',
      aparecer: true,
      itens: [
        { icone: 'tema', titulo: 'Tema claro, escuro e oito temas prontos', texto: 'Escuro, claro ou o do sistema; temas como Meia-noite, Floresta e Sakura; e a cor de destaque que você quiser. No premium, qualquer cor para o destaque e para o fundo.', onde: 'Configurações → Aparência' },
        { icone: 'olho', titulo: 'Quem está vendo a sua tela', texto: 'Um selo no canto de cada tela mostra quantas pessoas estão assistindo. Passe o mouse (ou toque) para ver os nomes.', onde: 'No palco e em cada tela da grade' },
        { icone: 'arroba', titulo: '@ para chamar alguém', texto: 'Digite @ no chat e escolha da lista quem está na sala. Setas escolhem, Enter ou Tab completam — e a pessoa ouve um aviso.', onde: 'Chat da sala' },
        { icone: 'som', titulo: 'Avisos sonoros discretos', texto: 'Sons curtos e graves contam quem entrou, quem saiu, quem começou a transmitir e quando chamaram você. Cada um liga e desliga, com prévia.', onde: 'Configurações → Sons' },
        { icone: 'relogio', titulo: 'Tempo na sala', texto: 'O relógio da sala e o de cada pessoa, que sobrevivem ao F5. Clique nele para ver quem está há quanto tempo.', onde: 'Barra de cima da sala' },
        { icone: 'volume', titulo: 'Volume de cada pessoa até 200%', texto: 'O amigo que fala baixinho agora vai a 200%, com o número à vista. Só você ouve a diferença, e o Nexo lembra na próxima vez.', onde: 'No quadradinho de cada pessoa' },
        { icone: 'musica', titulo: 'Fila de música que se arruma', texto: 'Arraste para mudar a ordem, embaralhe ou esvazie. Ctrl+Enter pede para tocar logo a seguir.', onde: 'Canal música, na barra lateral' },
        { icone: 'compacto', titulo: 'Vídeo compacto', texto: 'A tela que você está assistindo numa janelinha por cima das outras, para continuar vendo enquanto faz outra coisa.', onde: 'Barra do palco' },
        { icone: 'conta', titulo: 'Perfil de dentro da sala', texto: 'Apelido, cor e marca mudam sem sair da conversa, e todo mundo vê na hora. Entrou com a mesma conta em outro aparelho? A conexão antiga avisa e oferece “Usar a conta aqui”.', onde: 'Clique no seu nome, embaixo à esquerda' },
        { icone: 'onda', titulo: 'Som da tela sem chiado', texto: 'O som de quem transmite não chia mais depois de alguns minutos de sessão.' },
        { icone: 'brilho', titulo: 'Esta apresentação', texto: 'Quando houver novidade grande, ela aparece aqui uma vez. Para rever quando quiser, use o botão ✦ Novidades.', onde: 'Página inicial e barra lateral da sala' }
      ]
    }
  ]);

  const api = { EDICOES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoEdicoes = api;
})(typeof window === 'undefined' ? globalThis : window);
