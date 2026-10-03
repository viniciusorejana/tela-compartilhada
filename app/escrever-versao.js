'use strict';

// Anota em dist/versao.json a versão do build que acabou de sair, por sistema.
//
// É daqui, e não do package.json, que o servidor tira a versão que anuncia: o package.json diz
// qual versão está sendo ESCRITA, e só o build diz qual está sendo SERVIDA. Anunciar a do
// package.json antes de empacotar mandaria todo mundo baixar o mesmo arquivo velho, em laço.
//
// Cada sistema é empacotado numa máquina diferente (o .dmg só sai num Mac), então cada um
// tem a sua linha, e reescrever uma não apaga as outras. Um mesmo build pode sair em mais de
// uma forma (o instalador e o portátil do Windows, o AppImage e o .deb do Linux), e aí vão
// todas as chaves de uma vez.
//
//   node escrever-versao.js windows windows-instalador
//
// O Android tem a versão dele (android/app/build.gradle), e é scripts/copiar-apk.cjs quem anota.
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('./package.json');

const CHAVES = ['windows', 'windows-instalador', 'linux', 'linux-deb', 'mac'];
const pedidas = process.argv.slice(2);
if (!pedidas.length || pedidas.some(chave => !CHAVES.includes(chave))) {
  console.error(`Use: node escrever-versao.js <${CHAVES.join('|')}> [...]`);
  process.exit(1);
}
const arquivo = path.join(__dirname, 'dist', 'versao.json');
let atual = {};
try { atual = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { /* primeiro build */ }
const em = new Date().toISOString();
const sistemas = { ...(atual.sistemas || {}) };
for (const chave of pedidas) sistemas[chave] = { versao: version, em };
fs.mkdirSync(path.dirname(arquivo), { recursive: true });
fs.writeFileSync(arquivo, JSON.stringify({ sistemas }, null, 2) + '\n');
console.log(`dist/versao.json: ${pedidas.join(', ')} ${version}`);
