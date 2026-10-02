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
      id: 4,
      data: '2026-10-01',
      titulo: 'Amigos, conversas e um perfil só seu',
      resumo: 'Quem tem conta ganhou um início com os amigos, as conversas e as salas recentes, um cartão de perfil para montar do seu jeito e conquistas que se ganham usando o Nexo.',
      aparecer: true,
      itens: [
        { icone: 'casa', titulo: 'Um início para quem tem conta', texto: 'Abrindo o Nexo com a conta, você cai direto nos seus amigos: quem está conectado, em que sala cada um está, e um botão para entrar junto. As salas recentes ficam na trilha da esquerda.', onde: 'O endereço do Nexo, com a conta aberta' },
        { icone: 'amigos', titulo: 'Amigos', texto: 'Peça amizade pelo nome de usuário ou pelo código, aceite, recuse e bloqueie. Dê um apelido a cada amigo: só você vê.', onde: 'Início → Adicionar amigo, ou o cartão de alguém na sala' },
        { icone: 'chat', titulo: 'Mensagens diretas e convites', texto: 'Converse com um amigo fora da chamada, mande imagem e chame para uma sala com um clique; o convite chega como aviso, onde a pessoa estiver. As mensagens ficam só na memória do servidor e somem três dias depois da última.', onde: 'Início → Mensagens diretas, ou o botão de mensagens na sala' },
        { icone: 'tema', titulo: 'Um cartão de perfil do seu jeito', texto: 'Banner e fundo animados ou com imagem, borda no avatar, moldura, um efeito que toca quando alguém abre o seu cartão, estilo do nome, bio, pronomes e uma bolha de pensamento que dura um dia. A borda e o nome aparecem na lista da sala, no chat e nas conversas; a moldura e o fundo, no seu quadradinho da plateia. Dá para montar no meio da chamada, sem sair da sala.', onde: 'Início → Personalizar perfil, ou Meu perfil → Personalizar o cartão, na sala' },
        { icone: 'trofeu', titulo: 'Conquistas', texto: 'Horas em sala, salas abertas, telas e mensagens viram conquistas, e algumas liberam peças do cartão. São só somas: o Nexo não guarda onde, com quem nem quando.', onde: 'Início → Conquistas' },
        { icone: 'estudio', titulo: 'O Estúdio ganhou desenho próprio', texto: 'O botão do Estúdio deixou de ser uma câmera: agora é o sinal de transmissão, e não se confunde mais com o da câmera, logo ao lado.', onde: 'Barra de baixo da sala' }
      ]
    },
    {
      id: 3,
      data: '2026-09-29',
      titulo: 'A sala no seu OBS',
      resumo: 'A câmera, a tela e a voz de quem está na sala viram fontes do OBS por um link, os rostos da sala reagem a quem fala, e o seu perfil ganhou foto.',
      aparecer: true,
      itens: [
        { icone: 'estudio', titulo: 'Qualquer fonte da sala no OBS', texto: 'Copie o link da câmera, da tela, da voz ou do som da tela de alguém e cole como fonte Navegador no OBS. Sem capturar janela: a imagem chega direto do Nexo, na qualidade de quem transmite.', onde: 'Clique no nome da pessoa → Levar para o OBS' },
        { icone: 'rosto', titulo: 'Rostos que reagem à voz', texto: 'Uma fonte com o rosto de cada pessoa da sala: quem fala pula, quem está quieto fica apagado. Escolha o efeito, o formato e o tamanho dos rostos e dos nomes, e dê a cada pessoa uma imagem parada e outra falando — só no seu OBS.', onde: 'Botão Estúdio, na barra de baixo (no computador)' },
        { icone: 'link', titulo: 'Os links seguem você', texto: 'Monte a cena uma vez: a câmera da Ana funciona em qualquer chamada com a Ana, em qualquer sala. Colou um link no lugar errado? Desligue todos de uma vez.', onde: 'Estúdio → Desligar meus links' },
        { icone: 'olho', titulo: 'Quem aparece fica sabendo', texto: 'Um selo OBS mostra na sala quem está levando o quê, e cada pessoa decide se pode ser levada. Desligar tira do ar na hora.', onde: 'Configurações → Estúdio (OBS)' },
        { icone: 'escudo', titulo: 'Quem abriu a sala decide', texto: 'Um controle a mais na moderação desliga o OBS para os participantes, e o que eles tinham no ar sai na hora.', onde: 'Moderação → Controles da sala' },
        { icone: 'foto', titulo: 'Foto de perfil', texto: 'Uma foto no lugar das iniciais — ou um GIF animado. Aparece na sala para todo mundo e é o seu rosto nos rostos do OBS.', onde: 'Meu perfil, ou a página da conta' }
      ]
    },
    {
      id: 2,
      data: '2026-09-28',
      titulo: 'A tela pela placa de vídeo',
      resumo: 'Com placa de vídeo, é ela que codifica a sua tela agora — e a transmissão segue lisa no alt+tab, se recupera sozinha e explica melhor o que está acontecendo.',
      aparecer: true,
      itens: [
        { icone: 'placa', titulo: 'Sua tela codificada pela placa de vídeo', texto: 'Com uma placa que faz H.264, é ela que codifica a sua tela, e não o processador — que fica livre para o jogo. Até 1440p, a 30 ou 60 quadros. Liga sozinho quando todo mundo na sala consegue receber; se alguém não consegue, a tela vai pelo WebRTC, sem ninguém mexer em nada.', onde: 'Automático ao compartilhar a tela' },
        { icone: 'grade', titulo: 'Lisa no alt+tab', texto: 'Com a tela pela placa, trocar de janela, dar alt+tab, minimizar ou arrastar programas depressa não trava mais a transmissão nem derruba a nitidez.' },
        { icone: 'tela', titulo: 'A captura que caiu para 30 avisa', texto: 'Depois de uma troca de resolução ou de monitor, o Windows às vezes prende a captura da tela em uns 30 quadros até ela ser feita de novo. O Nexo percebe e oferece “Capturar de novo”, sem tirar a tela do ar.', onde: 'Aviso no canto da sala' },
        { icone: 'atualizar', titulo: 'Volta sozinha depois de uma falha', texto: 'Se a codificação pela placa falhar no meio da transmissão, a tela segue pelo WebRTC e tenta a placa de novo em alguns segundos — ninguém precisa parar e compartilhar outra vez.' },
        { icone: 'volume', titulo: 'A codificação da tela, explicada', texto: 'Escolha entre Automática, Forçar WebCodecs e Só WebRTC, e leia logo embaixo o que a opção escolhida faz. Na dúvida, fique na Automática.', onde: 'Dispositivos → Qualidade → Codec e codificação da tela' },
        { icone: 'pulso', titulo: 'Diagnóstico mais direto', texto: 'A sua tela tem um cartão só, que diz por onde ela vai e onde é codificada. A medição mostra quantos quadros você pediu, quantos a captura entregou e quantos subiram — e explica quando a imagem sai menor que o pedido.', onde: 'Diagnóstico, na barra lateral · Dispositivos → Qualidade' },
        { icone: 'brilho', titulo: 'Ícones desenhados', texto: 'Os ícones da página inicial e da sala eram letras e símbolos que cada computador desenhava de um jeito. Agora são desenhos nítidos, iguais em todo lugar.', onde: 'Página inicial e barra lateral da sala' },
        { icone: 'servidor', titulo: 'Para quem hospeda', texto: 'A tela pela placa pede o servidor de mídia 1.13.7, que agora é o padrão, também no Linux. E o painel ganhou a seção Mídia, com o botão que desliga o WebCodecs para todo mundo na hora.', onde: 'Painel privado → Mídia' }
      ]
    },
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
