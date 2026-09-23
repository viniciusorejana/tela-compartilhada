// Real Electron/preload/picker UI, with synthetic sources. No desktop or device
// capture, no existing user profile, and no running audio agent is touched.
const { _electron } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, '../test-results/electron');
const origin = 'http://localhost:3219';
let server, electron;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ endereco: origin + '/electron-teste/sala' }));
  const harness = path.join(output, 'harness.cjs');
  fs.writeFileSync(harness, `
    const electron = require('electron');
    const { app, session, desktopCapturer, nativeImage, ipcMain } = electron;
    app.setPath('userData', ${JSON.stringify(profile)});
    app.disableHardwareAcceleration();
    const NativeWindow = electron.BrowserWindow;
    const TestWindow = new Proxy(NativeWindow, { construct(Target, [options]) {
      return new Target({ ...options, show: false });
    }});
    // Um destino fora da sala abre no navegador de verdade. No teste, isso só é anotado.
    const FakeShell = { openExternal: async url => { (global.abertosFora ||= []).push(url); } };
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, parent, ...args) {
      if (name === 'electron' && parent?.filename === ${JSON.stringify(path.join(__dirname, '../app/main.js'))}) return { ...electron, BrowserWindow: TestWindow, shell: FakeShell };
      return load.call(this, name, parent, ...args);
    };
    app.whenReady().then(() => {
      session.defaultSession.setDisplayMediaRequestHandler = handler => { global.captureHandler = handler; };
      desktopCapturer.getSources = async options => {
        global.sourceTypes = options.types;
        const main = NativeWindow.getAllWindows().find(w => !w.getParentWindow());
        const handle = main.getNativeWindowHandle().readBigUInt64LE().toString();
        global.fixtureHwnd = handle;
        return [{ id: options.types[0] === 'window' ? 'window:' + handle + ':0' : 'screen:0:0',
          name: 'Fonte de teste Nexo', thumbnail: nativeImage.createEmpty() }];
      };
      global.resolveFixtureInNative = async () => {
        const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(
          ${JSON.stringify(path.join(__dirname, '../native/audio-agent/x64/Release/AgenteAudio.exe'))}, ['--janela', global.fixtureHwnd], { windowsHide: true });
        return { pid: JSON.parse(stdout).pid, expected: process.pid };
      };
      require(${JSON.stringify(path.join(__dirname, '../app/main.js'))});
      ipcMain.removeHandler('agente:iniciar');
      ipcMain.handle('agente:iniciar', () => ({ rodando: false, motivo: 'test-fixture' }));
    });
  `);
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3219', HOST: '127.0.0.1' }, windowsHide: true, stdio: 'ignore' });
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(origin)).ok) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({ executablePath: path.join(__dirname, '../app/node_modules/electron/dist/electron.exe'), args: [harness], env, timeout: 20000 });
  electron.process().stderr.on('data', chunk => process.stderr.write(chunk));
  console.log('Electron launched');
  const room = await electron.firstWindow({ timeout: 15000 });
  room.setDefaultTimeout(15000);
  await room.waitForURL('**/electron-teste/sala');
  const errors = [];
  room.on('pageerror', error => errors.push(error.message));
  await room.locator('#nameInput').fill('Electron');
  await room.locator('#nameConfirmBtn').click();
  await room.waitForFunction(() => tiles.has('self'));
  assert.equal(await room.locator('#captureMode option[value="browser"]').count(), 0);
  assert.equal(await room.evaluate(() => appNativo.prepararCaptura('browser')), false);

  async function openPicker(type) {
    assert.equal(await room.evaluate(type => appNativo.prepararCaptura(type), type), true);
    const opening = electron.waitForEvent('window');
    opening.catch(() => {});
    await electron.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => !w.getParentWindow());
      global.captureResult = 'pending';
      global.captureDone = global.captureHandler({ frame: main.webContents.mainFrame }, result => { global.captureResult = result || null; });
    });
    const picker = await opening;
    await picker.waitForFunction(() => document.querySelector('.fonte'));
    return picker;
  }
  const windowPicker = await openPicker('window');
  assert.deepEqual(await electron.evaluate(() => global.sourceTypes), ['window']);
  assert.equal(await windowPicker.locator('.grupo-titulo').textContent(), 'Janelas');
  await windowPicker.evaluate(() => document.querySelector('.fonte').click());
  await electron.evaluate(async () => { await global.captureDone; });
  const selected = await room.evaluate(() => appNativo.capturaSelecionada());
  assert.equal(selected.tipo, 'window');
  assert.equal(selected.pid, 0, 'native HWND resolver must reject capturing this app audio');
  const resolved = await electron.evaluate(() => global.resolveFixtureInNative());
  assert.equal(resolved.pid, resolved.expected, 'the compiled native resolver identifies the real window owner');

  // Fechar o aplicativo compartilhado encerra a transmissao. Quem vigia o processo dono da
  // janela e o processo principal; a sala so precisa ser avisada.
  assert.equal(await room.evaluate(() => typeof appNativo.aoEncerrarCaptura), 'function',
    'a sala precisa conseguir ouvir o fim da captura');
  // Parar de compartilhar apaga a selecao. Sem isto o vigia continuaria de pe depois da
  // transmissao acabar e dispararia fora de hora -- ao fechar aquele programa horas depois,
  // sem estar compartilhando nada.
  await room.evaluate(() => appNativo.encerreiCaptura());
  assert.equal(await room.evaluate(() => appNativo.capturaSelecionada()), null,
    'parar de compartilhar precisa encerrar a vigilancia da janela');
  const monitorPicker = await openPicker('monitor');
  assert.deepEqual(await electron.evaluate(() => global.sourceTypes), ['screen']);
  assert.equal(await monitorPicker.locator('.grupo-titulo').textContent(), 'Telas');
  await monitorPicker.evaluate(() => window.close());
  assert.equal(await room.evaluate(() => appNativo.capturaSelecionada()), null);
  console.log('PASS: real Electron preload, filtered window/screen picker, cancellation, unavailable tab mode, and native exclusion of own HWND process');

  // ---------- O aplicativo fica preso à origem que a pessoa escolheu ----------
  // A sala é conteúdo remoto. Uma falha de XSS nela, ou um servidor malicioso aberto uma vez,
  // não pode trocar o servidor salvo nem levar a janela para fora -- e, com ela, a ponte
  // nativa que liga o agente de áudio desta máquina.
  assert.equal(await room.evaluate(() => Notification.requestPermission()), 'granted',
    'a origem escolhida continua recebendo as permissões de que a sala precisa');
  assert.deepEqual(await room.evaluate(() => appNativo.definirEndereco('http://127.0.0.1:9/fora')), { ok: false },
    'a sala não pode trocar o servidor do aplicativo');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8')).endereco, origin + '/electron-teste/sala',
    'o servidor salvo tem de continuar o mesmo');
  await room.evaluate(() => { setTimeout(() => { location.href = 'https://exemplo.invalid/fora'; }, 0); });
  await electron.evaluate(async () => {
    for (let n = 0; n < 50 && !(global.abertosFora || []).length; n++) await new Promise(r => setTimeout(r, 100));
  });
  assert.deepEqual(await electron.evaluate(() => global.abertosFora || []), ['https://exemplo.invalid/fora'],
    'um destino de fora abre no navegador de verdade');
  assert.equal(new URL(room.url()).origin, origin, 'a janela não pode sair da origem da sala');
  assert.equal(await room.evaluate(() => appNativo.prepararCaptura('window')), true,
    'a ponte continua falando com a sala depois da recusa');
  // Dentro da própria origem, a navegação continua livre: é assim que o logo leva ao início.
  await room.evaluate(() => { setTimeout(() => { location.href = '/'; }, 0); });
  await room.waitForURL(origin + '/');
  // E a tela local continua trocando o servidor. É o único caminho legítimo para isso, e o de
  // quem abre o aplicativo pela primeira vez: travá-lo junto deixaria a pessoa sem como entrar.
  await room.evaluate(() => { setTimeout(() => appNativo.trocarServidor(), 0); });
  await room.waitForURL(/endereco\.html/);
  await room.locator('#endereco').fill(origin + '/electron-teste/sala');
  await room.locator('#entrar').click();
  await room.waitForURL('**/electron-teste/sala');
  assert.deepEqual(errors, []);
  console.log('PASS: o aplicativo fica na origem escolhida -- a sala não troca o servidor, destinos de fora abrem no navegador, a origem continua livre por dentro, e a tela local troca o servidor');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await electron?.close();
  server?.kill();
});
