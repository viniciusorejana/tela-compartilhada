// Real Electron/preload/picker UI, with synthetic sources. No desktop or device
// capture, no existing user profile, and no running audio agent is touched.
const { _electron } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, '../test-results/electron');
const origin = 'http://localhost:3219';
let server, electron;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ endereco: origin + '/electron-teste/sala' }));
  fs.mkdirSync(path.join(profile, 'downloads'));
  const harness = path.join(output, 'harness.cjs');
  fs.writeFileSync(harness, `
    const electron = require('electron');
    const { app, session, desktopCapturer, nativeImage, ipcMain } = electron;
    app.setPath('userData', ${JSON.stringify(profile)});
    // A atualização baixada pelo aplicativo vai para Downloads: no teste, uma pasta do perfil.
    app.setPath('downloads', ${JSON.stringify(path.join(profile, 'downloads'))});
    app.disableHardwareAcceleration();
    const NativeWindow = electron.BrowserWindow;
    const TestWindow = new Proxy(NativeWindow, { construct(Target, [options]) {
      return new Target({ ...options, show: false });
    }});
    // Um destino fora da sala abre no navegador de verdade. No teste, isso só é anotado.
    const FakeShell = { openExternal: async url => { (global.abertosFora ||= []).push(url); },
      showItemInFolder: caminho => { (global.mostradosNaPasta ||= []).push(caminho); }, openPath: async caminho => { (global.abertosNoSistema ||= []).push(caminho); return ''; } };
    // A pergunta nativa de "reiniciar agora?" responde "Depois": o teste não pode se reiniciar.
    const FakeDialog = { showMessageBox: async (...args) => { (global.perguntas ||= []).push(args.at(-1)?.message); return { response: 1 }; } };
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, parent, ...args) {
      if (name === 'electron' && parent?.filename === ${JSON.stringify(path.join(__dirname, '../app/main.js'))}) return { ...electron, BrowserWindow: TestWindow, shell: FakeShell, dialog: FakeDialog };
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
    // A atualização sozinha do aplicativo instalado, com o electron-updater de verdade. O aplicativo
    // daqui roda sem empacotar; o módulo recebe o tipo "instalador" e a configuração do teste.
    global.testarAtualizacaoAutomatica = async ({ configDoTeste, origem }) => {
      const { autoUpdater } = require(${JSON.stringify(path.join(__dirname, '../app/node_modules/electron-updater'))});
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.updateConfigPath = configDoTeste;
      const { criarAtualizador } = require(${JSON.stringify(path.join(__dirname, '../app/atualizacao-automatica.js'))});
      const avisos = [];
      let config = { atualizarSozinho: true };
      const atualizador = criarAtualizador({ tipo: 'instalador', lerConfig: () => config, salvarConfig: novo => { config = novo; }, avisar: dados => avisos.push(dados) });
      atualizador.definirOrigem(origem);
      const resposta = await atualizador.baixar();
      for (let n = 0; n < 300 && !avisos.some(a => ['pronto', 'falhou'].includes(a.estado)); n++) await new Promise(r => setTimeout(r, 100));
      // O "instalador" do teste são bytes quaisquer: fechar o aplicativo não pode tentar rodá-lo.
      autoUpdater.autoInstallOnAppQuit = false;
      return { resposta, avisos, estado: atualizador.estado(), arquivo: autoUpdater.installerPath, ativo: atualizador.ativo };
    };
  `);
  // Pelo ajudante, e não com `node server.js`: ele isola as contas, o painel e a medição numa
  // pasta temporária e usa uma cópia do servidor de mídia -- o binário instalado faria o
  // encerrarOrfaos() derrubar a sala de verdade aberta nesta máquina. E ele abre a janela de
  // transição, porque o "Electron" entra sem conta numa sala vazia.
  server = await iniciarServidor({ ambiente: { PORT: '3219' }, midia: true });
  const env = { ...process.env, NEXO_SEM_SPLASH: '1' };   // a splash tem o teste dela (test:splash)
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

  // ---------- A atualização baixada pelo próprio aplicativo ----------
  //
  // A sala só pede a versão; o endereço, o nome do arquivo e a pasta são do processo principal.
  // O progresso atravessa a ponte, o arquivo chega inteiro em Downloads, e "reiniciar" passa por
  // uma pergunta nativa -- que aqui responde "Depois".
  const build = path.join(__dirname, '../app/dist/SalaCompartilhada.exe');
  if (fs.existsSync(build)) {
    await room.evaluate(() => { window.progressoDaAtualizacao = [];appNativo.aoProgressoDaAtualizacao(dados => progressoDaAtualizacao.push(dados)); });
    assert.deepEqual(await room.evaluate(() => appNativo.baixarAtualizacao('../../fora')), { ok: false, motivo: 'versao-invalida' }, 'só uma versão bem formada atravessa');
    assert.deepEqual(await room.evaluate(() => appNativo.baixarAtualizacao('9.9.9')), { ok: true });
    await room.waitForFunction(() => progressoDaAtualizacao.some(p => p.estado === 'pronto' || p.estado === 'falhou'), null, { timeout: 60000 });
    const eventos = await room.evaluate(() => progressoDaAtualizacao);
    const fim = eventos.at(-1);
    assert.equal(fim.estado, 'pronto', JSON.stringify(eventos.slice(-3)));
    assert.equal(fim.arquivo, 'Nexo 9.9.9.exe', 'o nome é montado pelo aplicativo, com a versão');
    assert.ok(eventos.some(p => p.estado === 'baixando'), 'o progresso atravessa a ponte enquanto baixa');
    const baixado = path.join(profile, 'downloads', 'Nexo 9.9.9.exe');
    assert.equal(fs.statSync(baixado).size, fs.statSync(build).size, 'o arquivo chega inteiro');
    // A sala recarregada no meio do caminho pergunta de novo, e recebe onde parou.
    const estado = await room.evaluate(() => appNativo.estadoDaAtualizacao());
    assert.equal(estado.estado, 'pronto');
    assert.equal(estado.versao, '9.9.9');
    assert.equal(estado.recebidos, fs.statSync(build).size);
    assert.equal(await room.evaluate(() => appNativo.mostrarAtualizacao()), true);
    assert.deepEqual(await electron.evaluate(() => global.mostradosNaPasta), [baixado]);
    assert.equal(await room.evaluate(() => appNativo.abrirAtualizacao()), false, '"Depois" não reinicia nada');
    assert.match((await electron.evaluate(() => global.perguntas))[0], /Abrir o Nexo 9\.9\.9 agora\?/);
    // Uma página de fora da origem escolhida não alcança nada disso (a ponte recusa o remetente):
    // é a mesma trava das outras funções nativas, conferida acima pela troca de servidor.
    fs.rmSync(baixado, { force: true });
    console.log('PASS: o aplicativo baixa a própria atualização com progresso, salva com o nome da versão em Downloads e só reinicia com a resposta nativa');
  } else console.log('SKIP: sem app/dist/SalaCompartilhada.exe, o download da atualização não foi testado');

  // ---------- A atualização sozinha do aplicativo instalado ----------
  //
  // O electron-updater de verdade contra a pasta de atualizações de verdade (desktop-download.js,
  // num servidor de fixtures): a ficha latest.yml com o sha512 do instalador, o download conferido
  // por ele, e o estado atravessando para quem avisa a sala. Instalar fica de fora -- o
  // "instalador" daqui são bytes quaisquer, e o teste não pode se reinstalar.
  const pastaDaFicha = fs.mkdtempSync(path.join(output, 'atualizacoes-'));
  const cacheDoAtualizador = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'nexo-teste-atualizacao');
  const instalador = path.join(pastaDaFicha, 'Nexo-Setup.exe');
  const bytes = crypto.randomBytes(512 * 1024);
  fs.writeFileSync(instalador, bytes);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(pastaDaFicha, 'latest.yml'), ['version: 99.0.0', 'files:', '  - url: Nexo-Setup.exe', `    sha512: ${sha512}`, `    size: ${bytes.length}`,
    'path: Nexo-Setup.exe', `sha512: ${sha512}`, `releaseDate: '${new Date().toISOString()}'`, ''].join('\n'));
  const fixtures = express();
  require('../desktop-download')(fixtures, { 'windows-instalador': instalador }, { atualizacoes: pastaDaFicha });
  const servidorDeFixtures = fixtures.listen(0, '127.0.0.1');
  await new Promise(resolve => servidorDeFixtures.once('listening', resolve));
  const origemDasFixtures = `http://127.0.0.1:${servidorDeFixtures.address().port}`;
  // O endereço daqui é o lugar-reservado do build; o módulo troca pela origem antes de procurar.
  const configDoTeste = path.join(pastaDaFicha, 'dev-app-update.yml');
  fs.writeFileSync(configDoTeste, 'provider: generic\nurl: https://nexo.invalid/downloads/atualizacoes\nupdaterCacheDirName: nexo-teste-atualizacao\n');
  try {
    const resultado = await electron.evaluate((_electron, dados) => global.testarAtualizacaoAutomatica(dados), { configDoTeste, origem: origemDasFixtures });
    assert.equal(resultado.ativo, true);
    assert.deepEqual(resultado.resposta, { ok: true }, JSON.stringify(resultado));
    const estados = resultado.avisos.map(a => a.estado);
    assert.equal(estados[0], 'pedido', 'o clique aparece na hora, antes de a ficha chegar');
    assert.ok(estados.includes('baixando'), `o progresso atravessa: ${estados.join(' → ')}`);
    assert.equal(resultado.estado.estado, 'pronto', `a versão nova tinha de ficar pronta: ${estados.join(' → ')}`);
    assert.equal(resultado.estado.versao, '99.0.0');
    assert.equal(resultado.estado.silenciosa, false, 'quem clicou vê o progresso');
    assert.deepEqual(fs.readFileSync(resultado.arquivo), bytes, 'o instalador chega inteiro, conferido pelo sha512 da ficha');
    console.log('PASS: o aplicativo instalado acha a versão nova no servidor escolhido, baixa o instalador conferido e fica pronto para instalar');
  } finally {
    await new Promise(resolve => servidorDeFixtures.close(resolve));
    fs.rmSync(pastaDaFicha, { recursive: true, force: true });
    fs.rmSync(cacheDoAtualizador, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await electron?.close();
  await server?.encerrar();
});
