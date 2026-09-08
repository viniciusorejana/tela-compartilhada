'use strict';

// Sobe o aplicativo com o ambiente limpo.
//
// O terminal integrado do VS Code exporta ELECTRON_RUN_AS_NODE=1 (é assim que ele roda os
// próprios processos auxiliares). Herdando essa variável, o Electron inicia como Node puro:
// nenhuma janela abre, `require('electron')` devolve um caminho de arquivo em vez da API, e
// o erro que aparece é um "Cannot read properties of undefined" sem relação aparente com o
// motivo. Rodar por aqui evita isso venha o terminal de onde vier.
const { spawn } = require('child_process');
const electron = require('electron');

const ambiente = { ...process.env };
delete ambiente.ELECTRON_RUN_AS_NODE;

const processo = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: ambiente
});
processo.on('close', (codigo) => process.exit(codigo === null ? 1 : codigo));
