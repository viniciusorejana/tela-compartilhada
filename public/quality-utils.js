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
// Declarar dois degraus faz o cliente montar tres camadas (ele usa presets[0] e presets[1]
// como as duas de baixo e mantem a captura como a de cima). O degrau de baixo, a 300 kbps e
// 15 quadros, cabe em praticamente qualquer lugar -- e quem esta mal ve a tela borrada em
// vez de nao ver nada e perder o lugar na sala.
(function(root) {
  const profiles = {
    economical: {
      label: '720p · Econômica', width: 1280, height: 720, bitrate: 2_000_000,
      camadas: [[640, 360, 300_000, 15], [960, 540, 900_000, 30]]
    },
    high: {
      label: '1080p · Alta', width: 1920, height: 1080, bitrate: 4_000_000,
      camadas: [[640, 360, 300_000, 15], [1280, 720, 1_500_000, 30]]
    },
    ultra: {
      label: '1440p · Máxima', width: 2560, height: 1440, bitrate: 6_000_000,
      camadas: [[640, 360, 300_000, 15], [1280, 720, 2_000_000, 30]]
    }
  };
  const api = { profiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
