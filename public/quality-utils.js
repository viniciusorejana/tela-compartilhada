// Perfis de captura. Repartir banda entre espectadores era tarefa desta pagina enquanto a
// sala era uma malha; o servidor de midia faz isso por pessoa, com simulcast, entao o
// orcamento por par, a histerese de resolucao e o limite de upload sairam daqui.
(function(root) {
  const profiles = {
    economical: { label: '720p · Econômica', width: 1280, height: 720, bitrate: 4_000_000 },
    high: { label: '1080p · Alta', width: 1920, height: 1080, bitrate: 8_000_000 },
    ultra: { label: '1440p · Máxima', width: 2560, height: 1440, bitrate: 14_000_000 }
  };
  const api = { profiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
