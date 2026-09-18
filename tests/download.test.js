const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// O `fetch` do Node não repassa cabeçalhos condicionais: com ele, um pedido que deveria
// voltar "304, não mudou" volta 200 com o arquivo inteiro, e o teste mediria o cliente em
// vez do servidor. O cliente HTTP cru envia o que se manda.
function pedir(origin, caminho, headers = {}) {
  return new Promise((resolve, reject) => {
    const pedido = http.request(new URL(caminho, origin), { headers }, resposta => {
      const pedacos = [];
      resposta.on('data', p => pedacos.push(p));
      resposta.on('end', () => resolve({
        status: resposta.statusCode,
        headers: resposta.headers,
        corpo: Buffer.concat(pedacos)
      }));
    });
    pedido.on('error', reject);
    pedido.end();
  });
}

test('portable download reports availability, streams exact bytes/ranges and picks up a replacement build', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-download-'));
  const file = path.join(dir, 'portable.exe');
  const app = express();
  require('../desktop-download')(app, file);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(dir);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Sem build nenhuma: `available` continua falso -- é o campo que a página antiga lê -- e a
  // lista de sistemas vem vazia, que é o que a página nova lê. As duas formas convivem de
  // propósito: uma página em cache não pode parar de funcionar por causa do formato novo.
  assert.deepEqual(await (await fetch(origin + '/api/desktop-app')).json(), { available: false, sistemas: [] });
  assert.equal((await fetch(origin + '/downloads/SalaCompartilhada.exe')).status, 503);
  // Os outros sistemas ganharam rota própria, e sem arquivo elas respondem o mesmo 503 --
  // nunca 404, porque a rota existe: é o BUILD que ainda não foi feito.
  assert.equal((await fetch(origin + '/downloads/Nexo.AppImage')).status, 503);
  assert.equal((await fetch(origin + '/downloads/Nexo.dmg')).status, 503);
  const bytes = Buffer.from('MZ-portable-test-fixture');
  await fs.writeFile(file, bytes);
  const metadata = await fetch(origin + '/api/desktop-app');
  assert.equal(metadata.headers.get('cache-control'), 'no-store');
  const info = await metadata.json();
  assert.equal(info.size, bytes.length);
  assert.equal(info.available, true);
  assert.ok(Number.isFinite(Date.parse(info.builtAt)));
  // Só o Windows foi construído aqui, então só ele entra na lista. Anunciar um sistema cujo
  // build não existe daria à página um botão que responde 503 -- pior do que um botão ausente.
  assert.deepEqual(info.sistemas.map(s => s.chave), ['windows']);
  assert.equal(info.sistemas[0].url, '/downloads/SalaCompartilhada.exe');
  const response = await fetch(origin + info.url);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="SalaCompartilhada.exe"/);
  // Era "no-store", que mandava o navegador esquecer o arquivo assim que ele chegava:
  // clicar de novo rebaixava os noventa e cinco megabytes inteiros. Agora ele pode
  // guardar, mas é obrigado a revalidar antes de reusar -- o que preserva a garantia que
  // este teste sempre protegeu (build nova nunca vem da cache) sem pagar o download duas
  // vezes. A prova disso é a troca de build no fim deste mesmo teste.
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);

  // Revalidar com o ETag da build ATUAL não traz bytes de novo.
  const etag = response.headers.get('etag');
  assert.ok(etag, 'sem ETag não há revalidação possível');
  const naoMudou = await pedir(origin, info.url, { 'If-None-Match': etag });
  assert.equal(naoMudou.status, 304);
  assert.equal(naoMudou.corpo.length, 0);
  const range = await fetch(origin + info.url, { headers: { Range: 'bytes=0-1' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'MZ');
  await fs.writeFile(file, 'MZ-new-build');
  assert.equal((await (await fetch(origin + '/api/desktop-app')).json()).size, 12);
  assert.equal(await (await fetch(origin + info.url)).text(), 'MZ-new-build');
  // O ETag de antes é de uma build que não existe mais: revalidar com ele tem de trazer a
  // nova, e não um 304. É esta linha que garante que permitir cache não passou a servir
  // versão velha para ninguém.
  const comEtagVelho = await pedir(origin, info.url, { 'If-None-Match': etag });
  assert.equal(comEtagVelho.status, 200);
  assert.equal(comEtagVelho.corpo.toString(), 'MZ-new-build');
});

// O executável é grande e sai pela conexão de quem hospeda. Sem teto, uma aba com defeito
// (ou alguém se divertindo) ocupa a subida da casa inteira e a sala inteira sente.
test('o download tem teto por endereço, e um endereço não gasta a cota do outro', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-limite-'));
  const file = path.join(dir, 'portable.exe');
  await fs.writeFile(file, 'MZ-fixture');
  const app = express();
  // O transporte desta fixture é o proxy conhecido; produção usa a lista explícita
  // NEXO_PROXIES_CONFIAVEIS, verificada também nos testes de acesso do painel.
  require('../desktop-download')(app, file, { identificar: req => req.headers['x-forwarded-for'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(dir);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baixar = (ip) => pedir(origin, '/downloads/SalaCompartilhada.exe', { 'X-Forwarded-For': ip });

  // Atrás do túnel toda conexão chega do mesmo lugar (127.0.0.1) e o IP real vem no
  // cabeçalho. Sem lê-lo, o teto viraria um teto para a sala toda: o primeiro a baixar
  // gastaria a cota de todo mundo -- que é o oposto de proteger.
  let ultimo;
  for (let i = 0; i < 25; i++) ultimo = await baixar('203.0.113.10');
  assert.equal(ultimo.status, 429, 'o mesmo endereço tinha de ser barrado');
  assert.ok(Number(ultimo.headers['retry-after']) > 0, 'precisa dizer quando tentar de novo');

  const outroAmigo = await baixar('198.51.100.20');
  assert.equal(outroAmigo.status, 200, 'quem nunca baixou não pode pagar pelo excesso alheio');
  assert.equal(outroAmigo.corpo.toString(), 'MZ-fixture');
});

// Cada sistema é compilado num lugar diferente -- o Windows aqui, o macOS e o Linux onde
// houver macOS e Linux --, então a página precisa mostrar o que EXISTE em vez de um botão
// fixo. Um link de download que responde 503 é pior do que um link que não aparece.
test('cada sistema tem rota própria, e a lista traz só as builds que existem', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-download-multi-'));
  const caminhos = {
    windows: path.join(dir, 'SalaCompartilhada.exe'),
    linux: path.join(dir, 'Nexo.AppImage'),
    mac: path.join(dir, 'Nexo.dmg')
  };
  await fs.writeFile(caminhos.linux, Buffer.from('AppImage-fixture'));
  await fs.writeFile(caminhos.mac, Buffer.from('dmg-fixture-maior'));

  const app = express();
  require('../desktop-download')(app, caminhos);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const info = await (await fetch(origin + '/api/desktop-app')).json();
  // O Windows não foi construído, e é dele que vêm os campos soltos: sem ele, `available` é
  // falso mesmo havendo dois outros sistemas prontos. Isso é deliberado -- os campos antigos
  // descrevem o Windows, e mentir sobre eles quebraria a página que os lê.
  assert.equal(info.available, false);
  assert.deepEqual(info.sistemas.map(s => s.chave).sort(), ['linux', 'mac']);
  assert.equal(info.sistemas.find(s => s.chave === 'linux').url, '/downloads/Nexo.AppImage');
  assert.ok(info.sistemas.every(s => s.nome && s.tipo && s.size > 0 && Number.isFinite(Date.parse(s.builtAt))));

  // O arquivo servido é o do sistema pedido, e não o primeiro que houver: trocar os dois
  // entregaria um .dmg a quem clicou em Linux, e o erro só apareceria ao tentar executar.
  const linux = await fetch(origin + '/downloads/Nexo.AppImage');
  assert.equal(linux.status, 200);
  assert.equal(await linux.text(), 'AppImage-fixture');
  const mac = await fetch(origin + '/downloads/Nexo.dmg');
  assert.equal(await mac.text(), 'dmg-fixture-maior');
  // O que não foi construído recusa com 503, e a mensagem nomeia o sistema.
  const windows = await fetch(origin + '/downloads/SalaCompartilhada.exe');
  assert.equal(windows.status, 503);
  assert.match(await windows.text(), /Windows/);
});
