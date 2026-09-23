// A versão do aplicativo de mesa, igual no servidor e na página.
//
// O aplicativo nasceu sem versão à vista: quem estava com um .exe de meses atrás não tinha
// como saber, e quem hospeda não tinha como dizer. Aqui fica só a comparação -- "1.10.0" vem
// depois de "1.9.2", o que comparar como texto erraria.
(function (root) {
  // Um aplicativo anterior a este arquivo não conta a própria versão para a página. Ele é,
  // por definição, desta versão ou de antes -- e é assim que ele é tratado.
  const ANTERIOR_A_VERSAO = '1.0.0';
  const FORMATO = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

  const valida = versao => typeof versao === 'string' && FORMATO.test(versao);

  // Negativo se `a` vem antes de `b`, positivo se depois, zero se iguais. Versão ilegível
  // conta como "antes de tudo": nunca é motivo para dizer que alguém está atualizado.
  function comparar(a, b) {
    const partes = versao => (valida(versao) ? versao.split('.').map(Number) : [-1, -1, -1]);
    const [x, y] = [partes(a), partes(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }

  // O que o aplicativo aberto é, dito pela ponte do Electron (preload.js).
  function doAplicativo(appNativo) {
    if (!appNativo) return null;
    return valida(appNativo.versao) ? appNativo.versao : ANTERIOR_A_VERSAO;
  }

  // A chave de sistema que o servidor usa (desktop-download.js) para o `process.platform`.
  const SISTEMA_DA_PLATAFORMA = Object.freeze({ win32: 'windows', linux: 'linux', darwin: 'mac' });

  const api = { ANTERIOR_A_VERSAO, valida, comparar, doAplicativo, SISTEMA_DA_PLATAFORMA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoVersao = api;
})(typeof window === 'undefined' ? globalThis : window);
