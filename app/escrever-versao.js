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
// O Android tem a versão dele (android/app/build.gradle); scripts/empacotar-android.cjs anota por aqui.
//
// Junto da versão vão o commit de onde o build saiu e o servidor que ele traz preenchido. É com
// eles que o lançamento (deploy/lancamento, docs/lancar-aplicativos.md) sabe se o código mudou depois do
// build -- e um número que já está no ar com outro código precisa subir. Um build feito com
// mudanças não commitadas no que entra nele fica marcado `sujo`: o commit não diz o que ele tem.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHAVES = ['windows', 'windows-instalador', 'linux', 'linux-deb', 'mac', 'android'];
const RAIZ = path.join(__dirname, '..');
const ARQUIVO = path.join(__dirname, 'dist', 'versao.json');
const GRADLE = path.join(RAIZ, 'android', 'app', 'build.gradle');

// O que entra em cada build, em caminhos do repositório. Do aplicativo de mesa, só os arquivos que
// o electron-builder empacota (build.files), as dependências e o agente de áudio do Windows: mexer
// no escrever-versao.js ou num teste não muda o aplicativo de ninguém e não deve pedir versão nova.
function caminhosDoBuild(produto) {
  if (produto === 'android') return ['android'];
  const pacote = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const empacotados = (pacote.build?.files || []).filter(arquivo => !/[*!]/.test(arquivo));
  return [...new Set(['package.json', 'package-lock.json', ...empacotados])]
    .map(arquivo => `app/${arquivo}`)
    .concat('native/audio-agent');
}

function versaoDe(chave) {
  if (chave === 'android') {
    const versao = /versionName\s*=?\s*['"](\d{1,4}\.\d{1,4}\.\d{1,4})['"]/.exec(fs.readFileSync(GRADLE, 'utf8'))?.[1];
    if (!versao) throw new Error('Não achei versionName (no formato 1.2.3) em android/app/build.gradle.');
    return versao;
  }
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
}

function git(args) {
  const r = spawnSync('git', ['-C', RAIZ, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Sem Git (uma cópia baixada em .zip), o build sai sem commit -- e o lançamento o trata como
// desconhecido, que é o lado seguro: desconhecido pede versão nova em vez de esconder uma mudança.
function origemDoCodigo(chave) {
  const commit = git(['rev-parse', 'HEAD']);
  if (!commit) return {};
  const pendente = git(['status', '--porcelain', '--', ...caminhosDoBuild(chave === 'android' ? 'android' : 'desktop')]);
  return pendente ? { commit, sujo: true } : { commit };
}

function servidorPadrao(servidor) {
  const bruto = servidor || process.env.NEXO_SERVIDOR_PADRAO
    || (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'servidor-padrao.json'), 'utf8')).endereco; } catch (_) { return ''; } })();
  try { return bruto ? new URL(bruto).origin : null; } catch (_) { return null; }
}

function anotar(pedidas, { arquivo = ARQUIVO, servidor = null } = {}) {
  if (!pedidas.length || pedidas.some(chave => !CHAVES.includes(chave))) {
    throw new Error(`Use: node escrever-versao.js <${CHAVES.join('|')}> [...]`);
  }
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { /* primeiro build */ }
  const em = new Date().toISOString();
  const sistemas = { ...(atual.sistemas || {}) };
  const endereco = servidorPadrao(servidor);
  for (const chave of pedidas) {
    sistemas[chave] = { versao: versaoDe(chave), em, ...origemDoCodigo(chave), ...(endereco ? { servidor: endereco } : {}) };
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ sistemas }, null, 2) + '\n');
  return pedidas.map(chave => ({ chave, ...sistemas[chave] }));
}

module.exports = { anotar, caminhosDoBuild, CHAVES };

if (require.main === module) {
  try {
    const anotadas = anotar(process.argv.slice(2));
    console.log(`dist/versao.json: ${anotadas.map(a => a.chave).join(', ')} ${anotadas[0].versao}`);
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
