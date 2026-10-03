'use strict';

// A ponte entre a sala (conteúdo remoto, isolado) e o aplicativo. Estreita de propósito:
// só o que a página precisa saber e mandar fazer.
const { contextBridge, ipcRenderer } = require('electron');

const argumento = process.argv.find(a => a.startsWith('--pid-do-app='));
const pid = argumento ? Number(argumento.split('=')[1]) : 0;
// Só o formato de versão atravessa: o argumento vem do processo principal, mas a página é
// conteúdo remoto, e nada solto passa pela ponte.
const versao = (process.argv.find(a => a.startsWith('--versao-do-app=')) || '').split('=')[1] || '';
// Instalado (atualiza sozinho), portátil (baixa o arquivo novo) ou desenvolvimento. Lista fechada.
const instalacao = (process.argv.find(a => a.startsWith('--instalacao=')) || '').split('=')[1] || '';
const OPCOES = ['atualizarSozinho', 'abrirAoEntrar'];

contextBridge.exposeInMainWorld('appNativo', {
  // O PID da raiz da árvore deste aplicativo. É o que a sala manda para o agente para que
  // ele exclua da captura tudo o que este aplicativo toca -- a voz e as telas dos outros.
  pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
  // Qual aplicativo é este, para a sala comparar com o que o servidor distribui.
  versao: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao) ? versao : '',
  plataforma: ['win32', 'linux', 'darwin'].includes(process.platform) ? process.platform : '',
  instalacao: ['instalador', 'appimage', 'deb', 'portatil', 'desenvolvimento', 'outro'].includes(instalacao) ? instalacao : '',
  // Atualizar sozinho e abrir ao entrar no computador. Na volta, só booleanos e o tipo.
  opcoesDoAplicativo: () => ipcRenderer.invoke('app:opcoes').then(limparOpcoes),
  definirOpcaoDoAplicativo: (nome, valor) => (OPCOES.includes(nome) ? ipcRenderer.invoke('app:opcao', nome, valor === true).then(limparOpcoes) : Promise.resolve(null)),
  procurarAtualizacao: () => ipcRenderer.invoke('atualizacao:procurar').then(r => ({ ok: r?.ok === true, nova: r?.nova === true, versao: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(r?.versao || '')) ? String(r.versao) : '' })),
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
  trocarServidor: () => ipcRenderer.invoke('endereco:esquecer'),
  // A versão nova, baixada pelo aplicativo com o progresso na sala. Na ida só atravessa o
  // número da versão; na volta, um estado de uma lista fechada e números -- nunca um caminho.
  baixarAtualizacao: versao => ipcRenderer.invoke('atualizacao:baixar', String(versao || '')),
  cancelarAtualizacao: () => ipcRenderer.invoke('atualizacao:cancelar'),
  estadoDaAtualizacao: () => ipcRenderer.invoke('atualizacao:estado').then(limparAtualizacao),
  mostrarAtualizacao: () => ipcRenderer.invoke('atualizacao:mostrar'),
  abrirAtualizacao: () => ipcRenderer.invoke('atualizacao:abrir'),
  aoProgressoDaAtualizacao: retorno => {
    if (typeof retorno !== 'function') return;
    ipcRenderer.on('atualizacao:progresso', (_evento, dados) => { const limpo = limparAtualizacao(dados); if (limpo) retorno(limpo); });
  }
});

function limparAtualizacao(dados) {
  if (!dados || !['disponivel', 'pedido', 'baixando', 'pronto', 'cancelado', 'falhou'].includes(dados.estado)) return null;
  const numero = valor => (Number.isFinite(Number(valor)) && Number(valor) >= 0 ? Number(valor) : 0);
  return {
    estado: dados.estado,
    versao: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(dados.versao || '')) ? String(dados.versao) : '',
    recebidos: numero(dados.recebidos),
    total: numero(dados.total),
    arquivo: String(dados.arquivo || '').slice(0, 120),
    // Descendo sozinha, sem ninguém ter pedido: a sala não mostra o progresso.
    silenciosa: dados.silenciosa === true
  };
}

function limparOpcoes(dados) {
  if (!dados) return null;
  return {
    tipo: String(dados.tipo || ''),
    atualizaSozinho: dados.atualizaSozinho === true,
    atualizarSozinho: dados.atualizarSozinho === true,
    podeAbrirAoEntrar: dados.podeAbrirAoEntrar === true,
    abrirAoEntrar: dados.abrirAoEntrar === true
  };
}
