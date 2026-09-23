// A versão do aplicativo de mesa: comparada como número, e anunciada só quando o BUILD a
// anotou. Anunciar a do código antes de empacotar mandaria todo mundo baixar o arquivo velho.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const versao = require('../public/versao-app');
const desktopDownload = require('../desktop-download');

test('a versão é comparada como número, e ilegível nunca conta como atualizada', () => {
  assert.ok(versao.comparar('1.10.0', '1.9.2') > 0, 'como texto, 1.10 viria antes de 1.9');
  assert.ok(versao.comparar('1.1.0', '1.0.0') > 0);
  assert.equal(versao.comparar('2.0.0', '2.0.0'), 0);
  assert.ok(versao.comparar('lixo', '0.0.1') < 0);
  assert.equal(versao.doAplicativo(null), null, 'no navegador não há aplicativo');
  assert.equal(versao.doAplicativo({ pid: 1 }), '1.0.0', 'um aplicativo que não diz a versão é anterior a ela');
  assert.equal(versao.doAplicativo({ versao: '1.1.0' }), '1.1.0');
});

async function servidorComBuilds(t, arquivos) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-builds-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  for (const [nome, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(pasta, nome), conteudo);
  const app = express();
  desktopDownload(app, { windows: path.join(pasta, 'SalaCompartilhada.exe'), linux: path.join(pasta, 'Nexo.AppImage') }, { versoes: path.join(pasta, 'versao.json') });
  const servidor = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  return `http://127.0.0.1:${servidor.address().port}`;
}

test('o /api/desktop-app diz a versão de cada build que foi anotada, e só dela', async t => {
  const origem = await servidorComBuilds(t, {
    'SalaCompartilhada.exe': 'exe', 'Nexo.AppImage': 'appimage',
    'versao.json': JSON.stringify({ sistemas: { windows: { versao: '1.1.0' }, mac: { versao: '1.1.0' }, linux: { versao: 'não é versão' } } })
  });
  const { sistemas } = await (await fetch(`${origem}/api/desktop-app`)).json();
  assert.equal(sistemas.find(s => s.chave === 'windows').versao, '1.1.0');
  assert.equal(sistemas.find(s => s.chave === 'linux').versao, null, 'versão ilegível fica desconhecida');
  assert.equal(sistemas.some(s => s.chave === 'mac'), false, 'build que não existe não aparece, mesmo anotado');
});

test('sem o arquivo de versões, a versão é desconhecida -- e ninguém é mandado atualizar', async t => {
  const origem = await servidorComBuilds(t, { 'SalaCompartilhada.exe': 'exe' });
  const { sistemas } = await (await fetch(`${origem}/api/desktop-app`)).json();
  assert.equal(sistemas[0].versao, null);
});
