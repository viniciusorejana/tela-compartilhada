// O servidor de teste não administra pipelines de música de outras execuções.
require('../../musica').encerrarOrfaos = () => {};
require('../../server');
