// Perfis de captura. Repartir banda entre espectadores era tarefa desta pagina enquanto a
// sala era uma malha; o servidor de midia faz isso por pessoa, com simulcast, entao o
// orcamento por par, a histerese de resolucao e o limite de upload sairam daqui.
//
// A escada de simulcast, porem, PRECISA ser declarada aqui -- e essa e a licao mais cara
// que este arquivo guarda. Deixada por conta do cliente do servidor de midia, ela nasce com
// um degrau so abaixo do original: metade da resolucao e um quarto do bitrate. Numa captura
// de 1080p a 8 Mbps isso da 2 Mbps e 8 Mbps, e nada entre zero e 2 Mbps.
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
      label: '720p · Econômica', width: 1280, height: 720, bitrate: 4_000_000,
      camadas: [[640, 360, 300_000, 15], [960, 540, 900_000, 30]]
    },
    high: {
      label: '1080p · Alta', width: 1920, height: 1080, bitrate: 8_000_000,
      camadas: [[640, 360, 300_000, 15], [1280, 720, 1_500_000, 30]]
    },
    ultra: {
      label: '1440p · Máxima', width: 2560, height: 1440, bitrate: 14_000_000,
      camadas: [[640, 360, 300_000, 15], [1280, 720, 2_000_000, 30]]
    }
  };
  const api = { profiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
