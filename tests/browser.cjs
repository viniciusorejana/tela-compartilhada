// Synthetic capture, real WebRTC between isolated browser contexts. No real camera,
// microphone, desktop content, public server, or audio helper is used by this test.
const { chromium, webkit } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const port = process.env.TEST_BROWSER === 'webkit' ? 3218 : 3217;
const origin = `http://localhost:${port}`;
const output = path.join(__dirname, '..', 'test-results', process.env.TEST_BROWSER || 'chromium');
fs.mkdirSync(output, { recursive: true });
let server, browser;
const errors = [];

async function waitServer() {
  for (let n = 0; n < 60; n++) {
    if (server.exitCode !== null) throw new Error('Test server exited before becoming ready');
    try { if ((await fetch(origin)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}

async function join(context, name, room = 'squad-teste') {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => { errors.push(e.message); console.error('page error:', e.message); });
  page.on('console', message => { if (message.type() === 'warning') console.log('browser warning:', message.text()); });
  await page.goto(`${origin}/${room}/sala`);
  await page.locator('#nameInput').fill(name);
  await page.locator('#nameConfirmBtn').click();
  await page.waitForFunction(() => tiles.has('self'));
  return page;
}

async function syntheticCapture(context, streamless = false) {
  await context.addInitScript(({ streamless }) => {
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return;
    let sequence = 0;
    function capture(kind) {
      const canvas = document.createElement('canvas');
      canvas.width = kind === 'camera' ? 480 : 1920;
      canvas.height = kind === 'camera' ? 640 : 1080;
      const ctx = canvas.getContext('2d');
      const number = ++sequence;
      let frame = 0;
      const draw = () => {
        ctx.fillStyle = kind === 'camera' ? '#548f91' : number % 2 ? '#493b83' : '#284e75';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#eee8ff'; ctx.font = '28px sans-serif';
        ctx.fillText(`${kind === 'camera' ? 'CÂMERA' : 'TELA'} DE TESTE ${number}`, 35, 80);
        ctx.fillStyle = '#b9d8a7';
        ctx.fillRect(35 + (++frame % 240), 130, 100, 75);
      };
      draw();
      const timer = setInterval(draw, kind === 'camera' ? 100 : 33);
      const stream = canvas.captureStream(kind === 'camera' ? 10 : 30);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    }
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => capture('screen') });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      if (constraints.video) return capture('camera');
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const output = audio.createMediaStreamDestination();
      oscillator.connect(output); oscillator.start();
      return output.stream;
    } });
    if (streamless) {
      const Native = RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        set ontrack(handler) {
          super.ontrack = handler ? e => handler({ track: e.track, receiver: e.receiver, transceiver: e.transceiver, streams: [] }) : null;
        }
      };
    }
  }, { streamless });
}

async function share(page) {
  await page.locator('#screenBtn').click();
  await page.locator('#audioPolicy').selectOption('none');
  await page.locator('#confirmScreenBtn').click();
  await page.waitForFunction(() => Boolean(screenStream));
}

async function waitForDecodedVideos(page) {
  await page.waitForFunction(async () => {
    const peer = [...peers.values()][0];
    if (!peer) return false;
    const stats = await peer.pc.getStats();
    const decoded = [...stats.values()].filter(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.framesDecoded >= 3);
    return decoded.length >= 2 && stageVideo.videoWidth > 0 && stageVideo.readyState >= 2 && !stageVideo.paused;
  });
}

(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: 'https://convite.example' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', chunk => process.stderr.write(chunk));
  await waitServer();
  const engine = process.env.TEST_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE || undefined, args: engine === chromium ? ['--autoplay-policy=no-user-gesture-required'] : [] });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  await syntheticCapture(desktop);
  const home = await desktop.newPage();
  await home.goto(origin);
  await home.locator('#joinBtn').click();
  assert.equal(await home.locator('#roomError').isVisible(), true);
  await home.locator('#roomCode').fill('minha-sala');
  await home.screenshot({ path: path.join(output, 'home.png'), fullPage: true });
  await home.locator('#createBtn').click();
  await home.waitForURL('**/minha-sala/sala');
  assert.equal(new URL(home.url()).pathname, '/minha-sala/sala');
  await home.close();

  const host = await join(desktop, 'Molejo');
  console.log('Host joined');
  await host.screenshot({ path: path.join(output, 'sala-desktop.png') });
  await host.setViewportSize({ width: 1366, height: 768 });
  await host.screenshot({ path: path.join(output, 'sala-laptop.png') });
  await host.setViewportSize({ width: 1440, height: 940 });
  const mediaSupported = await host.evaluate(() => Boolean(window.RTCPeerConnection && navigator.mediaDevices));
  if (!mediaSupported) {
    assert.equal(process.env.TEST_BROWSER, 'webkit', 'Chromium should support WebRTC');
    await host.locator('#chatInput').fill('Teste de interface WebKit');
    await host.locator('#chatSend').click();
    await host.getByText('Teste de interface WebKit', { exact: true }).waitFor();
    await host.locator('#devicesBtn').click();
    await host.keyboard.press('Escape');
    assert.equal(await host.locator('#devicesPanel').isVisible(), false);
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({ path: path.join(output, 'sala-mobile.png') });
    assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await host.locator('#chatToggle').click();
    assert.equal(await host.locator('#chatPanel').isVisible(), true);
    await host.locator('#chatClose').click();
    assert.deepEqual(errors, []);
    console.log('PASS: WebKit navigation, chat, dialogs, and mobile layout. This Windows WebKit build has no WebRTC; media tests require Safari on Apple hardware.');
    return;
  }
  await host.locator('#cameraBtn').click();
  await share(host);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await syntheticCapture(mobile, true);
  // A delayed RTC config must not lose Socket.IO's initial connect event.
  await mobile.route('**/api/rtc-config', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  const viewer = await join(mobile, '<img src=x onerror="window.xss=1">');
  await viewer.waitForFunction(() => peers.size === 1 && stageVideo.videoWidth > 0 && !stageVideo.paused);
  await waitForDecodedVideos(viewer);
  const receiving = await viewer.evaluate(() => {
    const peer = [...peers.values()][0];
    return { screen: peer.remoteStreams.screen.getVideoTracks().length, camera: peer.remoteStreams.camera.getVideoTracks().length, source: pinned.source, audio: stageVideo.srcObject.getAudioTracks().length, xss: window.xss || 0 };
  });
  assert.deepEqual(receiving, { screen: 1, camera: 1, source: 'screen', audio: 0, xss: 0 });
  const screenCodec = await viewer.evaluate(async () => {
    const peer = [...peers.values()][0];
    const stats = await peer.pc.getStats();
    const inbound = [...stats.values()].find(s => s.type === 'inbound-rtp' && peer.remoteStreamIds.mids[s.mid] === 'screen');
    return stats.get(inbound?.codecId)?.mimeType;
  });
  assert.equal(screenCodec?.toLowerCase(), 'video/vp8');
  assert.equal(await host.locator('.participant-name img').count(), 0);
  // A real remote camera and screen must both keep decoding in the responsive grid.
  await viewer.evaluate(() => mostrarControlesDoPalco());
  await viewer.locator('#multiViewBtn').click();
  await viewer.waitForFunction(() => document.querySelectorAll('.multi-card video').length === 2 &&
    [...document.querySelectorAll('.multi-card video')].every(v => v.videoWidth > 0 && !v.paused));
  assert.ok(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await viewer.locator('.multi-card').first().getByRole('button', { name: 'Aumentar zoom deste vídeo', exact: true }).click();
  assert.match(await viewer.locator('.multi-card video').first().getAttribute('style'), /scale\(1.25\)/);
  assert.equal(await viewer.locator('.multi-card video').nth(1).evaluate(v => v.style.transform.includes('scale(1.25)')), false);
  await viewer.locator('#theaterBtn').click();
  assert.equal(await viewer.locator('.app').evaluate(el => el.classList.contains('teatro')), true);
  await viewer.screenshot({ path: path.join(output, 'multi-mobile.png') });
  await viewer.setViewportSize({ width: 1440, height: 940 });
  await viewer.screenshot({ path: path.join(output, 'multi-desktop.png') });
  await host.locator('#cameraBtn').click();
  await viewer.waitForFunction(() => document.querySelectorAll('.multi-card').length === 1);
  await host.locator('#cameraBtn').click();
  await viewer.waitForFunction(() => document.querySelectorAll('.multi-card video').length === 2 &&
    [...document.querySelectorAll('.multi-card video')].every(v => v.videoWidth > 0 && !v.paused));
  await viewer.locator('.multi-card').first().getByRole('button', { name: 'Ver somente este vídeo', exact: true }).click();
  assert.equal(await viewer.locator('.multi-card').count(), 0);
  assert.equal(await viewer.locator('#multiViewBtn').getAttribute('aria-pressed'), 'false');
  await viewer.locator('#theaterBtn').click();
  await viewer.setViewportSize({ width: 390, height: 844 });
  console.log('PASS: multiple remote videos decode, independent zoom, responsive theater, and single-view cleanup');
  if (process.env.TEST_MULTI_ONLY === '1') { assert.deepEqual(errors, []); return; }
  console.log('PASS: late spectator receives camera + screen, including streamless track events; names remain text');
  try { await viewer.waitForFunction(() => stageVideo.videoWidth === 1920 && stageVideo.videoHeight === 1080); }
  catch (error) {
    console.log('HD diagnostics', await host.evaluate(async () => ({ capture: screenStream.getVideoTracks()[0].getSettings(), peers: await Promise.all([...peers.values()].map(async p => ({ budget: p.videoBudget, allocation: p.videoAllocation, parameters: p.senders.screen.getParameters(), stats: [...(await p.pc.getStats()).values()].filter(s => ['outbound-rtp', 'candidate-pair'].includes(s.type)) }))) })));
    console.log('Encoder', JSON.stringify(await host.evaluate(async () => [...(await [...peers.values()][0].pc.getStats()).values()].filter(s => ['outbound-rtp','codec'].includes(s.type)))));
    console.log('Decoded size', await viewer.evaluate(() => [stageVideo.videoWidth, stageVideo.videoHeight]));
    throw error;
  }
  await host.locator('#devicesBtn').click();
  await host.locator('#videoQuality').selectOption('ultra');
  await host.waitForFunction(() => perfilDeQualidade === 'ultra');
  await host.waitForFunction(() => [...peers.values()][0].senders.screen.getParameters().encodings[0].maxFramerate === 30);
  assert.equal(await host.locator('#shareQuality').inputValue(), 'ultra');
  await host.locator('#uploadLimit').selectOption('20');
  assert.equal(await host.evaluate(() => limiteDeUpload), 20_000_000);
  await host.screenshot({ path: path.join(output, 'qualidade.png') });
  await host.locator('#videoQuality').selectOption('high');
  await host.keyboard.press('Escape');
  await host.mouse.move(500, 350);
  await host.locator('#fullscreenBtn').click();
  await host.waitForFunction(() => document.fullscreenElement === stage);
  await host.waitForFunction(() => stage.classList.contains('ocioso') && getComputedStyle(stageControls).opacity === '0');
  await host.mouse.move(500, 350);
  await host.waitForFunction(() => getComputedStyle(stageControls).opacity === '1');
  await host.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    zoomInBtn.focus();
  });
  await host.waitForTimeout(2800);
  assert.equal(await host.evaluate(() => getComputedStyle(stageControls).opacity), '1');
  await host.evaluate(() => document.exitFullscreen());
  await host.mouse.click(500, 350);
  console.log('PASS: decoded 1080p, live profile changes, 30 fps ceiling, and idle fullscreen controls with keyboard accessibility');
  await viewer.screenshot({ path: path.join(output, 'sala-mobile-video.png') });
  assert.ok(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await viewer.evaluate(() => {
    window.originalPlay = stageVideo.play.bind(stageVideo);
    stageVideo.pause();
    stageVideo.play = () => Promise.reject(new DOMException('Simulated autoplay denial', 'NotAllowedError'));
    garantirReproducao(stageVideo);
  });
  await viewer.locator('#enableSoundBtn').waitFor({ state: 'visible' });
  await viewer.locator('#enableSoundBtn').click();
  assert.equal(await viewer.locator('#enableSoundBtn').isVisible(), true);
  await viewer.evaluate(() => { stageVideo.play = window.originalPlay; });
  await viewer.locator('#enableSoundBtn').click();
  await viewer.waitForFunction(() => !stageVideo.paused && !needsUserGesture);
  console.log('PASS: denied autoplay retains recovery until playback really succeeds');

  const originalTrack = await viewer.evaluate(() => [...peers.values()][0].remoteStreams.screen.getVideoTracks()[0].id);
  await host.evaluate(() => {
    window.previousCapture = navigator.mediaDevices.getDisplayMedia;
    window.previousScreen = screenStream;
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Cancelled', 'NotAllowedError'));
  });
  await host.locator('#updateScreenBtn').click();
  await host.locator('#confirmScreenBtn').click();
  await host.waitForFunction(() => !document.getElementById('confirmScreenBtn').disabled);
  assert.ok(await host.evaluate(() => screenStream === window.previousScreen && screenStream.getVideoTracks()[0].readyState === 'live'));
  await host.evaluate(() => { navigator.mediaDevices.getDisplayMedia = window.previousCapture; });
  await host.locator('#cancelScreenBtn').click();
  await host.locator('#updateScreenBtn').click();
  await host.locator('#confirmScreenBtn').click();
  await host.waitForFunction(() => !document.getElementById('settingsPanel').classList.contains('hidden') === false);
  await viewer.waitForFunction(() => stageVideo.videoWidth > 0 && !stageVideo.paused);
  assert.equal(await viewer.evaluate(() => [...peers.values()][0].remoteStreams.screen.getVideoTracks()[0].id), originalTrack);
  await host.locator('#screenBtn').click();
  await viewer.waitForFunction(() => pinned?.source === 'camera');
  await share(host);
  await viewer.waitForFunction(() => pinned?.source === 'screen' && stageVideo.videoWidth > 0);
  console.log('PASS: replace, stop, and restart screen sharing while camera remains active');

  // Force the negotiated-envelope failure that replaceTrack is allowed to return.
  await host.evaluate(() => {
    const sender = [...peers.values()][0].senders.screen;
    sender.replaceTrack = () => Promise.reject(new DOMException('Needs renegotiation', 'InvalidModificationError'));
  });
  await host.locator('#updateScreenBtn').click();
  await host.locator('#confirmScreenBtn').click();
  await viewer.waitForFunction(old => [...peers.values()][0].remoteStreams.screen.getVideoTracks()[0]?.id !== old && pinned?.source === 'screen' && stageVideo.videoWidth > 0, originalTrack);
  await Promise.all([viewer.locator('#cameraBtn').click(), host.locator('#micBtn').click()]);
  await share(viewer);
  await host.waitForFunction(() => [...peers.values()][0].remoteStreams.screen.getVideoTracks().length === 1 && pinned?.source === 'screen' && stageVideo.videoWidth > 0);
  await viewer.waitForFunction(() => [...peers.values()][0].remoteStreams.micAudio.getAudioTracks().length === 1);
  await waitForDecodedVideos(host);
  await waitForDecodedVideos(viewer);
  console.log('PASS: renegotiation after replaceTrack rejection and bidirectional simultaneous media');

  const token = await host.evaluate(() => tokenDoAgente);
  const agent = new WebSocket(`${origin.replace('http:', 'ws:')}/agente?token=${token}`);
  await new Promise((resolve, reject) => { agent.once('open', resolve); agent.once('error', reject); });
  await host.waitForFunction(() => audioCapabilities.agenteConectado);
  await host.evaluate(() => { window.agentMode = new Promise(resolve => socket.once('agente-aplicativos', data => resolve(data.modo))); });
  agent.send(JSON.stringify({ evento: 'aplicativos', lista: [], atual: '', modo: 'excluir-pid' }));
  assert.equal(await host.evaluate(() => window.agentMode), 'excluir-pid');
  agent.close();
  console.log('PASS: server preserves the native agent audio exclusion mode');

  await viewer.locator('#chatToggle').click();
  await viewer.locator('#chatInput').fill('Olá, squad!');
  await viewer.locator('#chatSend').click();
  await host.getByText('Olá, squad!', { exact: true }).waitFor();
  await viewer.evaluate(() => socket.disconnect());
  await viewer.locator('#chatInput').fill('Mensagem preservada');
  await viewer.locator('#chatSend').click();
  assert.equal(await viewer.locator('#chatInput').inputValue(), 'Mensagem preservada');
  await viewer.evaluate(() => socket.connect());
  await viewer.waitForFunction(() => peers.size === 1 && [...peers.values()][0].pc.connectionState === 'connected' && stageVideo.videoWidth > 0);
  await waitForDecodedVideos(viewer);
  await viewer.locator('#chatClose').click();
  console.log('PASS: chat delivery, offline draft preservation, and socket reconnection');

  await viewer.locator('#devicesBtn').click();
  await viewer.keyboard.press('Escape');
  assert.equal(await viewer.locator('#devicesPanel').isVisible(), false);
  await viewer.locator('#sidebarToggle').click();
  await viewer.locator('.connection-box [data-action="diagnostics"]').click();
  await viewer.waitForFunction(() => document.getElementById('diagnosticsReport').textContent.includes('quadros decodificados='));
  const diagnostic = await viewer.locator('#diagnosticsReport').textContent();
  assert.ok(!diagnostic.includes('credential') && !diagnostic.includes('127.0.0.1') && !diagnostic.includes('squad-teste'));
  fs.writeFileSync(path.join(output, 'diagnostic.txt'), diagnostic);
  await viewer.keyboard.press('Escape');
  await viewer.locator('#sidebarToggle').click();
  await viewer.keyboard.press('Escape');

  const emptyMobile = await join(mobile, 'Visitante', 'outra-sala');
  await emptyMobile.screenshot({ path: path.join(output, 'sala-mobile.png') });
  assert.ok(await emptyMobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await emptyMobile.setViewportSize({ width: 320, height: 568 });
  await emptyMobile.screenshot({ path: path.join(output, 'sala-mobile-pequeno.png') });
  assert.ok(await emptyMobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await emptyMobile.setViewportSize({ width: 844, height: 390 });
  await emptyMobile.screenshot({ path: path.join(output, 'sala-paisagem.png') });
  assert.ok(await emptyMobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const privateContext = await browser.newContext();
  await privateContext.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } });
  });
  const privatePage = await join(privateContext, 'Privado', 'sem-storage');
  assert.equal(await privatePage.locator('.participant-name').textContent(), 'Privado (você)');
  await privateContext.close();
  await host.waitForFunction(() => cadeiaDeRuido?.contexto.state === 'running' && faixaEnviadaDoMic === cadeiaDeRuido.faixa);
  await host.evaluate(() => noiseBtn.click());
  await host.waitForFunction(() => !cadeiaDeRuido && faixaEnviadaDoMic === micTrack);
  await host.evaluate(() => noiseBtn.click());
  await host.waitForFunction(() => cadeiaDeRuido && faixaEnviadaDoMic === cadeiaDeRuido.faixa);
  await host.evaluate(() => alternarMic());
  assert.equal(await host.evaluate(() => faixaEnviadaDoMic.enabled), false);
  await host.evaluate(() => alternarMic());
  assert.equal(await host.evaluate(() => faixaEnviadaDoMic.enabled), true);
  console.log('PASS: RNNoise AudioWorklet loads, toggles, and respects microphone mute');

  const solo = await join(desktop, 'Solo', 'entrada-saida');
  await solo.locator('#chatInput').fill('Histórico antigo');
  await solo.locator('#chatSend').click();
  await solo.locator('.workspace-name').click();
  await solo.waitForURL(origin + '/');
  await solo.goBack();
  await solo.locator('#nameConfirmBtn').click();
  await solo.waitForFunction(() => tiles.has('self'));
  assert.equal(await solo.evaluate(() => peers.size), 0);
  assert.equal(await solo.locator('.participant').count(), 1);
  assert.equal(await solo.locator('#chatMsgs').textContent().then(text => text.includes('Histórico antigo')), false);
  const companion = await join(mobile, 'Companhia', 'entrada-saida');
  await solo.waitForFunction(() => peers.size === 1);
  await solo.locator('.workspace-name').click();
  await companion.waitForFunction(() => peers.size === 0);
  await solo.waitForURL(origin + '/');
  await solo.goBack();
  await solo.locator('#nameConfirmBtn').click();
  await companion.waitForFunction(() => peers.size === 1);
  assert.equal(await solo.locator('.participant').count(), 2);
  await solo.locator('#leaveBtn').click();
  await companion.waitForFunction(() => peers.size === 0);
  await solo.close(); await companion.close();
  console.log('PASS: logo navigation, back/re-entry alone and with peers, and explicit leave');
  const capturePage = await join(desktop, 'Captura', 'politica-captura');
  const capturePolicy = await capturePage.evaluate(async () => {
    audioCapabilities.agenteConectado = true;
    captureMode.value = 'window'; audioPolicy.value = 'auto';
    const plan = planoDeAudio();
    const original = navigator.mediaDevices.getDisplayMedia;
    let constraints, wrong;
    navigator.mediaDevices.getDisplayMedia = async options => {
      constraints = options;
      const stream = await original(options);
      const track = stream.getVideoTracks()[0];
      track.getSettings = () => ({ displaySurface: 'window' });
      return stream;
    };
    const stream = await capturarTela();
    stream.getTracks().forEach(t => t.stop());
    const windowRequest = constraints;
    navigator.mediaDevices.getDisplayMedia = async options => {
      wrong = await original(options);
      wrong.getVideoTracks()[0].getSettings = () => ({ displaySurface: 'monitor' });
      return wrong;
    };
    let rejected = false;
    try { await capturarTela(); } catch (_) { rejected = true; }
    navigator.mediaDevices.getDisplayMedia = original;
    return { plan, windowRequest, rejected, stopped: wrong.getTracks().every(t => t.readyState === 'ended') };
  });
  assert.equal(capturePolicy.plan, 'janela-navegador');
  assert.equal(capturePolicy.windowRequest.systemAudio, 'exclude');
  assert.equal(capturePolicy.windowRequest.windowAudio, 'window');
  assert.equal(capturePolicy.windowRequest.monitorTypeSurfaces, 'exclude');
  assert.equal(capturePolicy.windowRequest.video.width.max, 1920);
  assert.equal(capturePolicy.windowRequest.video.height.max, 1080);
  assert.equal(capturePolicy.windowRequest.video.frameRate.max, 30);
  assert.ok(capturePolicy.rejected && capturePolicy.stopped);
  await capturePage.close();
  console.log('PASS: browser window capture excludes system audio and rejects the wrong surface');
  const nativeContext = await browser.newContext();
  await syntheticCapture(nativeContext);
  await nativeContext.addInitScript(() => {
    Object.defineProperty(window, 'appNativo', { value: {
      pid: 43210, prepararCaptura: async () => true,
      capturaSelecionada: async () => ({ tipo: 'window', nome: 'Programa de teste', pid: 7654 })
    } });
  });
  const nativePage = await join(nativeContext, 'Áudio por janela', 'audio-janela');
  const nativeToken = await nativePage.evaluate(() => tokenDoAgente);
  const nativeAgent = new WebSocket(`${origin.replace('http:', 'ws:')}/agente?token=${nativeToken}`);
  const commands = [];
  let captureStarted;
  const startReceived = new Promise(resolve => { captureStarted = resolve; });
  let supported = true;
  nativeAgent.on('message', data => {
    const message = JSON.parse(data.toString());
    commands.push(message);
    if (message.acao === 'iniciar') captureStarted();
    if (message.acao === 'escolha') nativeAgent.send(JSON.stringify({ evento: 'aplicativos', lista: [], atual: '', modo: supported ? message.modo : 'excluir' }));
  });
  await new Promise((resolve, reject) => { nativeAgent.once('open', resolve); nativeAgent.once('error', reject); });
  await nativePage.waitForFunction(() => audioCapabilities.agenteConectado);
  const nativeCapture = await nativePage.evaluate(async () => {
    audioPolicy.value = 'auto';
    const stream = await capturarTela();
    const result = { tracks: stream.getAudioTracks().length, pid: audioDaJanela?.pid };
    stream.getTracks().forEach(t => t.stop());
    await limparAudioDoAplicativo();
    return result;
  });
  assert.deepEqual(nativeCapture, { tracks: 1, pid: 7654 });
  await Promise.race([startReceived, new Promise((_, reject) => setTimeout(() => reject(new Error('Native capture start was not received')), 3000))]);
  const startIndex = commands.findIndex(c => c.acao === 'iniciar');
  assert.ok(startIndex >= 0);
  const lastChoice = commands.slice(0, startIndex).filter(c => c.acao === 'escolha').at(-1);
  assert.equal(lastChoice.modo, 'incluir-pid');
  assert.equal(lastChoice.pid, '7654');
  supported = false;
  const startsBefore = commands.filter(c => c.acao === 'iniciar').length;
  const unsupportedCapture = await nativePage.evaluate(async () => {
    const stream = await capturarTela();
    const result = { tracks: stream.getAudioTracks().length, warning: stream.nexoAudioAviso };
    stream.getTracks().forEach(t => t.stop());
    return result;
  });
  assert.equal(unsupportedCapture.tracks, 0);
  assert.match(unsupportedCapture.warning, /atualize/);
  assert.equal(commands.filter(c => c.acao === 'iniciar').length, startsBefore);
  nativeAgent.close();
  await nativeContext.close();
  console.log('PASS: selected window PID reaches agent before capture; an old agent never falls back to system-wide audio');

  const fallbackContext = await browser.newContext();
  await syntheticCapture(fallbackContext);
  await fallbackContext.addInitScript(() => {
    AudioWorklet.prototype.addModule = async () => { throw new DOMException('Test module unavailable', 'NetworkError'); };
  });
  const fallbackPage = await join(fallbackContext, 'Fallback', 'ruido-fallback');
  await fallbackPage.locator('#micBtn').click();
  await fallbackPage.waitForFunction(() => erroDoFiltro && !carregandoFiltro);
  assert.equal(await fallbackPage.evaluate(() => micTrack === faixaEnviadaDoMic && micTrack.enabled), true);
  assert.equal(await fallbackPage.locator('#noiseBtn').textContent(), 'Filtro do navegador');
  await fallbackContext.close();
  console.log('PASS: failure to load RNNoise preserves live microphone with browser filtering');
  assert.deepEqual(errors, []);
  console.log(`PASS: responsive layout, dialogs, diagnostics. Engine: ${process.env.TEST_BROWSER || 'chromium'}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server?.kill();
});
