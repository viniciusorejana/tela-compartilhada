// Perfis de captura. Repartir banda entre espectadores era tarefa desta pagina enquanto a
// sala era uma malha; o servidor de midia faz isso por pessoa, com simulcast, entao o
// orcamento por par, a histerese de resolucao e o limite de upload sairam daqui.
//
// A escada de simulcast, porem, PRECISA ser declarada aqui -- e essa e a licao mais cara
// que este arquivo guarda. Deixada por conta do cliente do servidor de midia, ela nasce com
// um degrau so abaixo do original: metade da resolucao e um quarto do bitrate. Numa captura
// de 1080p a 4 Mbps isso da 1 Mbps e 4 Mbps, e nada entre zero e 1 Mbps.
//
// O teto de cada perfil é orçamento, não meta: o codificador gasta o que receber. Ele já
// foi 4, 8 e 14 Mbps -- números de gravação local, não de transmissão -- e o custo disso
// não aparecia aqui, e sim do outro lado: o servidor envia UMA cópia por espectador, então
// cada Mbps a mais no teto é multiplicado pelo tamanho da sala. Numa sala de quinze com uma
// tela aberta, os 8 Mbps do perfil alto viravam 112 Mbps de saída.
//
// Os valores de hoje são a faixa em que Discord e Meet operam para a mesma tarefa. A perda
// de nitidez em texto parado é imperceptível; em cena de muito movimento a 60 quadros ela
// existe, e é por isso que "Fluidez máxima" continua a escolha de quem compartilha jogo.
//
// O estrago aparece do lado de quem assiste numa rede ruim. A estimativa de banda dele cai
// para algumas centenas de kbps; o servidor procura uma camada que caiba, nao encontra
// nenhuma, e manda a de 2 Mbps assim mesmo. O canal afoga, e junto com a imagem afoga a
// sinalizacao -- que viaja no MESMO transporte e e o que mantem a pessoa na sala. Ela nao
// fica com video ruim: ela CAI.
//
// Cada degrau declarado vira uma camada, e a captura fica sendo a de cima. Declarar UM
// degrau, portanto, publica duas camadas.
//
// Eram três, e a do meio foi retirada porque ela é paga por quem transmite, em processador.
//
// O custo de codificar acompanha os pixels por segundo, e as três camadas não custam o
// mesmo. Numa captura de 1920x810 a 30 quadros: a de cima são 47 Mpx/s, a do meio
// (1280x540) são 21, e a de baixo (640x270 a 15 quadros) são 2,6. A do meio sozinha é
// 30% de tudo -- treze vezes o que custa a de baixo.
//
// Quem paga isso é o computador de quem compartilha, e sem placa de vídeo que codifique
// H.264 é o processador dele. Quando ele não dá conta, o codificador engasga: a imagem
// congela do lado de quem assiste, sem perda de pacote, sem quadro descartado e sem nada
// no log da rede -- porque os quadros não se perderam, eles não chegaram a existir.
//
// O degrau de baixo FICA, e é o que não podia sair. A 300 kbps e 15 quadros ele cabe em
// praticamente qualquer lugar; quem está com a rede ruim vê a tela borrada em vez de não
// ver nada e perder o lugar na sala. É também o degrau que a plateia e a grade usam.
//
// O que se perde: em multi-view, a tela dos outros vem no degrau de baixo em vez de um
// intermediário. É uma troca deliberada -- multi-view é para acompanhar de canto de olho,
// e quem quer LER a tela põe ela no palco, onde a camada de cima continua inteira.
(function(root) {
  const profiles = {
    economical: {
      label: '720p · Econômica', width: 1280, height: 720, bitrate: 2_000_000,
      camadas: [[640, 360, 300_000, 15]]
    },
    high: {
      label: '1080p · Alta', width: 1920, height: 1080, bitrate: 4_000_000,
      camadas: [[640, 360, 300_000, 15]]
    },
    ultra: {
      label: '1440p · Máxima', width: 2560, height: 1440, bitrate: 6_000_000,
      camadas: [[640, 360, 300_000, 15]]
    }
  };
  const api = { profiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
