'use strict';

// Anota em dist/versao.json a versão do build que acabou de sair, por sistema.
//
// É daqui, e não do package.json, que o servidor tira a versão que anuncia: o package.json diz
// qual versão está sendo ESCRITA, e só o build diz qual está sendo SERVIDA. Anunciar a do
// package.json antes de empacotar mandaria todo mundo baixar o mesmo arquivo velho, em laço.
//
// Cada sistema é empacotado numa máquina diferente (o .dmg só sai num Mac), então cada um
// tem a sua linha, e reescrever uma não apaga as outras.
//
//   node escrever-versao.js windows|linux|mac
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('./package.json');

const sistema = process.argv[2];
if (!['windows', 'linux', 'mac'].includes(sistema)) {
  console.error('Use: node escrever-versao.js windows|linux|mac');
  process.exit(1);
}
const arquivo = path.join(__dirname, 'dist', 'versao.json');
let atual = {};
try { atual = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { /* primeiro build */ }
const sistemas = { ...(atual.sistemas || {}), [sistema]: { versao: version, em: new Date().toISOString() } };
fs.mkdirSync(path.dirname(arquivo), { recursive: true });
fs.writeFileSync(arquivo, JSON.stringify({ sistemas }, null, 2) + '\n');
console.log(`dist/versao.json: ${sistema} ${version}`);
