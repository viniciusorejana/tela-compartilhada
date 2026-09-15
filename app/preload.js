'use strict';

// A ponte entre a sala (conteúdo remoto, isolado) e o aplicativo. Estreita de propósito:
// só o que a página precisa saber e mandar fazer.
const { contextBridge, ipcRenderer } = require('electron');

const argumento = process.argv.find(a => a.startsWith('--pid-do-app='));
const pid = argumento ? Number(argumento.split('=')[1]) : 0;

contextBridge.exposeInMainWorld('appNativo', {
  // O PID da raiz da árvore deste aplicativo. É o que a sala manda para o agente para que
  // ele exclua da captura tudo o que este aplicativo toca -- a voz e as telas dos outros.
  pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
  iniciarAgente: (url) => ipcRenderer.invoke('agente:iniciar', url),
  prepararCaptura: tipo => ipcRenderer.invoke('captura:preparar', tipo),
  capturaSelecionada: () => ipcRenderer.invoke('captura:selecionada'),
  // O aplicativo dono da janela compartilhada fechou. Só o motivo atravessa a ponte: nada
  // do processo principal entra na página, que é conteúdo remoto.
  aoEncerrarCaptura: retorno => {
    if (typeof retorno !== 'function') return;
    ipcRenderer.on('captura:encerrada', (_evento, dados) => retorno(String(dados?.motivo || '')));
  },
  encerreiCaptura: () => ipcRenderer.invoke('captura:encerrei'),
  // A tela de endereco tambem passa por aqui: a janela roda isolada do Node, e uma pagina
  // local nao e excecao a isso.
  definirEndereco: (endereco) => ipcRenderer.invoke('endereco:definir', endereco),
  estadoDoAgente: () => ipcRenderer.invoke('agente:estado'),
  trocarServidor: () => ipcRenderer.invoke('endereco:esquecer')
});
