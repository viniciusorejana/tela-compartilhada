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
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, parent, ...args) {
      if (name === 'electron' && parent?.filename === ${JSON.stringify(path.join(__dirname, '../app/main.js'))}) return { ...electron, BrowserWindow: TestWindow };
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
  assert.deepEqual(errors, []);
  console.log('PASS: real Electron preload, filtered window/screen picker, cancellation, unavailable tab mode, and native exclusion of own HWND process');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await electron?.close();
  server?.kill();
});
