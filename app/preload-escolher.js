'use strict';

// A ponte do seletor de tela. A página é local e do próprio aplicativo, mas os NOMES que ela
// mostra não são: o título de uma janela é escolhido por qualquer programa aberto, inclusive
// por uma aba de navegador. Com o Node ligado ali, um `innerHTML` descuidado um dia viraria
// execução de código nesta máquina. Isolada, a página alcança só as duas coisas abaixo.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seletor', {
  aoReceber: retorno => {
    if (typeof retorno !== 'function') return;
    ipcRenderer.on('escolher:fontes', (_evento, fontes) => retorno(Array.isArray(fontes) ? fontes : []));
  },
  escolher: id => ipcRenderer.send('escolher:pronto', String(id))
});
