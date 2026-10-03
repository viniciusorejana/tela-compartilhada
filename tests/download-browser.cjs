const { chromium } = require('playwright');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, '../test-results/download');
let browser, server;
const artifact = path.join(output, 'fixture.exe');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const bytes = Buffer.from('MZ-download-fixture-not-an-executable');
  await fs.writeFile(artifact, bytes);
  const app = express();
  require('../desktop-download')(app, artifact);
  app.use(express.static(path.join(__dirname, '../public')));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  // Este servidor não tem a rota da conta, então nada diz à página que a apresentação não deve
  // abrir sozinha -- e ela cobriria o botão de download. Aqui ela já foi lida.
  await page.addInitScript(() => localStorage.setItem('nexo.pref.novidades', '1000000'));
  await page.goto(origin);
  await page.waitForFunction(() => document.getElementById('desktopBuild').textContent.includes('build de'));
  const downloading = page.waitForEvent('download');
  await page.locator('#desktopDownload').click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'SalaCompartilhada.exe');
  assert.deepEqual(await fs.readFile(await download.path()), bytes);
  // O progresso aparece num aviso no canto, e o fim dele diz o que fazer com o arquivo.
  await page.locator('.nexo-toast', { hasText: 'Download concluído' }).waitFor({ timeout: 5000 });
  assert.match(await page.locator('.nexo-toast small').last().textContent(), /SalaCompartilhada\.exe/);
  await page.locator('.nexo-toasts').screenshot({ path: path.join(output, 'toast.png') });
  await page.locator('.desktop-download').screenshot({ path: path.join(output, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.desktop-download').screenshot({ path: path.join(output, 'mobile.png') });
  await fs.unlink(artifact);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('desktopDownload').getAttribute('aria-disabled') === 'true');
  assert.equal(await page.locator('#desktopDownload').getAttribute('href'), null);
  console.log('PASS: homepage downloads exact portable bytes, displays build details, fits mobile and handles missing build');

  // ---------- Várias formas: o instalador, o portátil e o celular ----------
  //
  // O botão cheio é o do sistema de quem vê, na forma que se instala; o resto vira pílula. No
  // celular Android, o botão cheio é o APK -- antes, o "Linux" do Android ganhava o AppImage.
  const pasta = path.join(output, 'formas');
  await fs.mkdir(pasta, { recursive: true });
  const formas = {
    'windows-instalador': path.join(pasta, 'Nexo-Setup.exe'),
    windows: path.join(pasta, 'SalaCompartilhada.exe'),
    linux: path.join(pasta, 'Nexo.AppImage'),
    android: path.join(pasta, 'Nexo.apk')
  };
  for (const [chave, caminho] of Object.entries(formas)) await fs.writeFile(caminho, `fixture-${chave}`);
  const outro = express();
  require('../desktop-download')(outro, formas);
  outro.use(express.static(path.join(__dirname, '../public')));
  const servidor2 = outro.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor2.once('listening', resolve));
  const origem2 = `http://127.0.0.1:${servidor2.address().port}`;
  try {
    const noWindows = await browser.newPage({ viewport: { width: 1440, height: 940 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    await noWindows.addInitScript(() => localStorage.setItem('nexo.pref.novidades', '1000000'));
    await noWindows.goto(origem2);
    await noWindows.waitForFunction(() => document.getElementById('desktopBuild').textContent.includes('build de'));
    assert.equal(await noWindows.locator('#desktopDownload').textContent(), 'Baixar para Windows instalador .exe');
    assert.match(await noWindows.locator('#desktopBuild').textContent(), /se atualiza sozinho/);
    assert.deepEqual(await noWindows.locator('.download-outro').evaluateAll(links => links.map(a => a.dataset.chave)), ['windows', 'linux', 'android'],
      'o portátil, o Linux e o Android ficam nas pílulas, nessa ordem');
    await noWindows.locator('.desktop-download').screenshot({ path: path.join(output, 'formas-windows.png') });
    const baixandoApk = noWindows.waitForEvent('download');
    await noWindows.locator('.download-outro[data-chave="android"]').click();
    assert.equal((await baixandoApk).suggestedFilename(), 'Nexo.apk', 'a pílula baixa o arquivo dela');
    await noWindows.close();

    const noCelular = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
    await noCelular.addInitScript(() => localStorage.setItem('nexo.pref.novidades', '1000000'));
    await noCelular.goto(origem2);
    await noCelular.waitForFunction(() => document.getElementById('desktopBuild').textContent.includes('build de'));
    assert.equal(await noCelular.locator('#desktopDownload').textContent(), 'Baixar para Android .apk', 'no celular Android, o APK é o botão cheio');
    assert.ok(await noCelular.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'as pílulas não fazem a página rolar de lado');
    await noCelular.locator('.desktop-download').screenshot({ path: path.join(output, 'formas-android.png') });
    await noCelular.close();
  } finally {
    await new Promise(resolve => servidor2.close(resolve));
    await fs.rm(pasta, { recursive: true, force: true });
  }
  console.log('PASS: o sistema de quem vê ganha o botão cheio (o APK no Android), e as outras formas viram pílulas que baixam');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.unlink(artifact).catch(() => {});
});
