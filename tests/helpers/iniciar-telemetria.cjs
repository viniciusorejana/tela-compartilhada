// O servidor de teste não administra pipelines de música de outras execuções.
const musica = require('../../musica');
musica.encerrarOrfaos = () => {};
require('../../server');

// A tela da fila é testada sem yt-dlp e sem servidor de mídia: o teste monta a fila à mão.
process.on('message', mensagem => {
  if (mensagem?.tipo === 'fila-de-teste') musica.filaDeTeste(mensagem.sala, mensagem);
});
