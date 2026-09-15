// Synthetic capture, real WebRTC between isolated browser contexts. No real camera,
// microphone, desktop content, public server, or audio helper is used by this test.
const { chromium, webkit } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const port = process.env.TEST_BROWSER === 'webkit' ? 3218 : 3217;
const origin = `http://localhost:${port}`;
const output = path.join(__dirname, '..', 'test-results', process.env.TEST_BROWSER || 'chromium');
fs.mkdirSync(output, { recursive: true });
let server, browser, instancia;
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
  page.on('pageerror', e => { errors.push(e.message); console.error('page error:', e.message); });
  page.on('console', message => { if (message.type() === 'warning') console.log('browser warning:', message.text()); });
  await page.goto(`${origin}/${room}/sala`);
  await page.locator('#nameInput').fill(name);
  await page.locator('#nameConfirmBtn').click();
  // Entrar na sala e uma coisa; ter transporte de midia e outra. Sem esperar aqui, o
  // primeiro clique em camera publicaria no vazio.
  try {
    await page.waitForFunction(() => tiles.has('self'), null, { timeout: 40000 });
    await page.waitForFunction(() => !transporte || transporte.sala.state === 'connected', null, { timeout: 40000 });
  } catch (erro) {
    // Sem isto, uma entrada que falha vira um tempo limite mudo, sem dizer onde parou.
    console.log(`entrada de "${name}" em ${room} falhou:`, await page.evaluate(() => ({
      status: document.getElementById('status')?.textContent,
      temConfig: Boolean(salaConfig),
      estadoDaSala: transporte?.sala?.state || 'sem transporte',
      socket: Boolean(socket?.connected),
      tem_self: tiles.has('self')
    })).catch(() => 'página não respondeu'));
    throw erro;
  }
  return page;
}

async function syntheticCapture(context) {
  await context.addInitScript(() => {
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
      const timer = setInterval(draw, kind === 'camera' ? 100 : 66);
      const stream = canvas.captureStream(kind === 'camera' ? 10 : 15);
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
  });
}

async function share(page) {
  await page.locator('#screenBtn').click();
  await page.locator('#audioPolicy').selectOption('none');
  await page.locator('#confirmScreenBtn').click();
  await page.waitForFunction(() => Boolean(screenStream));
}

// Com o servidor de midia no meio, as estatisticas vem por FAIXA -- nao ha mais uma
// conexao por participante para consultar.
async function waitForDecodedVideos(page) {
  await page.waitForFunction(async () => {
    const peer = [...peers.values()][0];
    if (!peer) return false;
    let decoded = 0;
    for (const publication of peer.publicacoes.values()) {
      if (publication.kind !== 'video' || !publication.track?.getRTCStatsReport) continue;
      const stats = await publication.track.getRTCStatsReport();
      if ([...(stats?.values() || [])].some(s => s.type === 'inbound-rtp' && s.framesDecoded >= 3)) decoded++;
    }
    return decoded >= 2 && stageVideo.videoWidth > 0 && stageVideo.readyState >= 2 && !stageVideo.paused;
  }, null, { timeout: 40000 });
}

// O codec de uma fonte recebida, lido do relatorio da propria faixa.
async function codecRecebido(page, fonte) {
  return page.evaluate(async source => {
    const peer = [...peers.values()][0];
    const publication = [...peer.publicacoes.values()].find(p => RoomTransport.fonteDaPublicacao(p) === source);
    const stats = await publication?.track?.getRTCStatsReport();
    const inbound = [...(stats?.values() || [])].find(s => s.type === 'inbound-rtp');
    return inbound && stats.get(inbound.codecId)?.mimeType?.toLowerCase();
  }, fonte);
}

async function esperarCodec(page, fonte, esperado) {
  await page.waitForFunction(async ([source, alvo]) => {
    const peer = [...peers.values()][0];
    const publication = [...peer.publicacoes.values()].find(p => RoomTransport.fonteDaPublicacao(p) === source);
    const stats = await publication?.track?.getRTCStatsReport();
    const inbound = [...(stats?.values() || [])].find(s => s.type === 'inbound-rtp');
    return inbound && stats.get(inbound.codecId)?.mimeType?.toLowerCase() === alvo;
  }, [fonte, esperado], { timeout: 40000 });
}

(async () => {
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(port), PUBLIC_URL: 'https://convite.example' } });
  server = instancia.filho;
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
  await syntheticCapture(mobile);
  // Uma configuracao lenta nao pode fazer a entrada desistir: o servidor de midia leva
  // alguns segundos para ficar pronto depois de subir.
  await mobile.route('**/api/sala-config*', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  const viewer = await join(mobile, '<img src=x onerror="window.xss=1">');
  await viewer.evaluate(() => {
    window.eventosDeFaixas = [];
    for (const evento of ['trackPublished', 'trackUnpublished', 'trackSubscribed', 'trackUnsubscribed']) {
      transporte.sala.on(evento, (...args) => {
        const p = args.find(a => a?.trackSid);
        window.eventosDeFaixas.push({ evento, sid: p?.trackSid, fonte: p?.source });
        if (window.eventosDeFaixas.length > 256) window.eventosDeFaixas.shift();
      });
    }
  });
  // A camera chega sozinha e vai ao palco; a tela espera ser pedida. Ate aqui o palco
  // mostra a camera, e nao a tela -- e e assim que tem de ser.
  await viewer.waitForFunction(() => peers.size === 1 && stageVideo.videoWidth > 0 && !stageVideo.paused, null, { timeout: 40000 });
  assert.equal(await viewer.evaluate(() => pinned.source), 'camera');
  await viewer.locator('.assistir-btn').click();
  await viewer.waitForFunction(() => pinned?.source === 'screen' && stageVideo.videoWidth > 0 && !stageVideo.paused, null, { timeout: 40000 });
  await waitForDecodedVideos(viewer);
  const receiving = await viewer.evaluate(() => {
    const peer = [...peers.values()][0];
    return { screen: peer.remoteStreams.screen.getVideoTracks().length, camera: peer.remoteStreams.camera.getVideoTracks().length, source: pinned.source, audio: stageVideo.srcObject.getAudioTracks().length, xss: window.xss || 0 };
  });
  assert.deepEqual(receiving, { screen: 1, camera: 1, source: 'screen', audio: 0, xss: 0 });
  // H.264 leads by default: on an iPhone it is the only codec decoded in hardware.
  assert.equal(await codecRecebido(viewer, 'screen'), 'video/h264');
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
  console.log('PASS: late spectator receives camera + screen; names remain text');

  // As telas ficam agrupadas a esquerda, na ordem em que comecaram; as pessoas vem depois.
  // A posicao e conferida pelo x na tela, nao pela ordem no DOM: quem reordena e o CSS,
  // justamente para nao tirar um <video> do lugar e fazer a imagem piscar.
  const faixaDeQuadradinhos = pagina => pagina.evaluate(() =>
    [...document.querySelectorAll('#participants .participant')]
      .map(el => ({ nome: el.querySelector('.participant-name').textContent, tela: el.dataset.source === 'screen', x: el.getBoundingClientRect().left }))
      .sort((a, b) => a.x - b.x));
  const faixaDoViewer = await faixaDeQuadradinhos(viewer);
  const primeiraPessoa = faixaDoViewer.findIndex(item => !item.tela);
  assert.ok(faixaDoViewer.slice(0, primeiraPessoa).every(item => item.tela), 'as telas deveriam vir todas antes das pessoas');
  assert.ok(faixaDoViewer.slice(primeiraPessoa).every(item => !item.tela), 'nenhuma tela deveria aparecer depois de uma pessoa');
  assert.ok(primeiraPessoa >= 1, 'a tela do host deveria estar na faixa');
  console.log('PASS: screens grouped to the left, people after them');
  // Com simulcast, o servidor de midia entrega a CADA pessoa a camada que a conexao dela
  // aguenta. Exigir 1080p decodificado de todo mundo contrariaria justamente o ganho da
  // mudanca -- e, num Chromium sem placa de video, a estimativa de banda inicial nem chega
  // a subir para a camada alta. O que precisa valer e o que a mudanca promete:
  //   a captura esta em 1080p, e ela sobe UMA vez repartida em varias camadas.
  const captura = await host.evaluate(() => screenStream.getVideoTracks()[0].getSettings());
  assert.equal(captura.height, 1080, `a captura deveria ser 1080p, veio ${JSON.stringify(captura)}`);
  const camadas = await host.evaluate(async () => {
    const stats = await publicacoesLocais.screen.track.getRTCStatsReport();
    return [...stats.values()].filter(s => s.type === 'outbound-rtp' && s.kind === 'video')
      .map(s => ({ rid: s.rid || 'única', altura: s.frameHeight, escala: s.scalabilityMode }));
  });
  assert.ok(camadas.length > 1, `simulcast deveria publicar várias camadas, veio ${JSON.stringify(camadas)}`);
  // O que se confere aqui NAO e quantas camadas estao enviando agora -- isso depende da
  // banda estimada, e num Chromium sem placa de video ela nem sobe. E a ESCADA declarada,
  // que e o que o servidor tem disponivel para oferecer a cada espectador.
  //
  // O degrau de baixo e o que importa: deixada por conta da lib, a escada nasce com dois
  // degraus e o menor custa um quarto da captura -- 2 Mbps numa captura de 8. Quem assiste
  // de uma rede ruim nao alcanca nem esse, o servidor empurra assim mesmo, e o canal afoga
  // junto com a sinalizacao que o mantem na sala. A pessoa nao fica com video ruim: ela cai.
  const escada = await host.evaluate(() =>
    (publicacoesLocais.screen.track.sender.getParameters().encodings || [])
      .map(e => ({ rid: e.rid || 'única', teto: e.maxBitrate, reducao: e.scaleResolutionDownBy })));
  assert.equal(escada.length, 3, `a tela deveria subir em três degraus, veio ${JSON.stringify(escada)}`);
  const degrauDeBaixo = Math.min(...escada.map(e => e.teto).filter(Boolean));
  assert.ok(degrauDeBaixo <= 400_000,
    `o degrau mais baixo precisa caber numa rede ruim, veio ${degrauDeBaixo} bps em ${JSON.stringify(escada)}`);
  console.log(`Escada de simulcast declarada: ${JSON.stringify(escada)}`);
  // Uma copia so sai daqui, por mais gente que entre: e isso que tira o upload do gargalo.
  const publicacoesDeTela = await host.evaluate(() =>
    [...transporte.sala.localParticipant.trackPublications.values()].filter(p => p.source === 'screen_share').length);
  assert.equal(publicacoesDeTela, 1);
  console.log(`Camadas de simulcast publicadas: ${JSON.stringify(camadas)}`);

  await host.locator('#devicesBtn').click();
  // Qualidade e codec moraram numa lista unica e rolante ate virarem aba propria.
  await host.locator('#abaQualidade').click();
  await host.locator('#videoQuality').selectOption('ultra');
  await host.waitForFunction(() => perfilDeQualidade === 'ultra');
  // A fonte deste teste e um canvas de tamanho fixo, entao applyConstraints nao muda a
  // captura. O que da para afirmar -- e o que importa -- e que o perfil novo chegou as
  // opcoes de publicacao. O bitrate por espectador quem decide e o servidor de midia.
  await host.waitForFunction(() => publicacoesLocais.screen?.options?.screenShareEncoding?.maxBitrate === 6_000_000, null, { timeout: 30000 });
  assert.equal(await host.locator('#shareQuality').inputValue(), 'ultra');
  await waitForDecodedVideos(viewer);
  await host.screenshot({ path: path.join(output, 'qualidade.png') });
  await host.locator('#videoQuality').selectOption('high');

  // O servidor de midia nao transcodifica: trocar o codec exige republicar a faixa, e quem
  // ja esta assistindo precisa passar a receber o fluxo novo.
  // O codec agora mora num <details> recolhido -- e um ajuste de quem sabe o que procura,
  // e nao mais a terceira pergunta feita a quem so queria compartilhar a tela.
  await host.locator('#painelQualidade .avancado > summary').click();
  await host.locator('#videoCodec').selectOption('vp8');
  await host.waitForFunction(() => codecDeVideoEscolhido() === 'vp8');
  assert.equal(await host.locator('#shareCodec').inputValue(), 'vp8');
  await esperarCodec(viewer, 'screen', 'video/vp8');
  await waitForDecodedVideos(viewer);
  await host.locator('#videoCodec').selectOption('auto');
  await esperarCodec(viewer, 'screen', 'video/h264');
  await waitForDecodedVideos(viewer);
  console.log('PASS: live codec switch republishes and video keeps decoding');

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
  console.log('PASS: 1080p capture goes up once as several simulcast layers, live profile changes, idle fullscreen controls');
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
  try { await viewer.waitForFunction(() => pinned?.source === 'camera'); }
  catch (erro) {
    console.error('Publicações do SDK e eventos:', await viewer.evaluate(() => ({ sdk: [...transporte.sala.remoteParticipants.values()].map(p => ({ id: p.identity, faixas: [...p.trackPublications.values()].map(t => ({ sid: t.trackSid, fonte: t.source })) })), eventos: window.eventosDeFaixas })));
    console.error('Estado após parar tela:', await viewer.evaluate(() => ({ pinned, estado: [...peers.values()][0]?.state, publicacoes: [...([...peers.values()][0]?.publicacoes.values() || [])].map(p => ({ fonte: p.source, muda: p.isMuted, recebida: p.isSubscribed })), visibilidade: document.visibilityState, conectado: transporte?.conectada })), await host.evaluate(() => ({ screen: Boolean(screenStream), camera: Boolean(cameraStream), faixas: [...transporte.sala.localParticipant.trackPublications.values()].map(p => ({ fonte: p.source, muda: p.isMuted, estado: p.track?.mediaStreamTrack?.readyState })), aviso: status.textContent })));
    throw erro;
  }
  await share(host);
  await viewer.waitForFunction(() => pinned?.source === 'screen' && stageVideo.videoWidth > 0);
  console.log('PASS: replace, stop, and restart screen sharing while camera remains active');

  await Promise.all([viewer.locator('#cameraBtn').click(), host.locator('#micBtn').click()]);
  await share(viewer);
  // A tela de quem chegou nao se impoe a ninguem: o host so recebe depois de pedir.
  await host.waitForFunction(() => [...peers.values()][0]?.state.screen, null, { timeout: 40000 });
  await host.locator('.assistir-btn').click();
  try {
    await host.waitForFunction(() => [...peers.values()][0].remoteStreams.screen.getVideoTracks().length === 1 && pinned?.source === 'screen' && stageVideo.videoWidth > 0, null, { timeout: 40000 });
  } catch (erro) {
    console.log('estado do host:', JSON.stringify(await host.evaluate(() => ({
      pinned, pares: [...peers.values()].map(p => ({
        nome: p.name, estado: p.state, ordem: p.ordem,
        fluxos: Object.fromEntries(Object.entries(p.remoteStreams).map(([k, v]) => [k, v.getTracks().length])),
        publicacoes: [...p.publicacoes.values()].map(x => ({ fonte: x.source, inscrita: x.isSubscribed, muda: x.isMuted }))
      })),
      todasAsPublicacoesRemotas: [...transporte.sala.remoteParticipants.values()].flatMap(rp => [...rp.trackPublications.values()].map(x => ({ de: rp.identity, fonte: x.source, inscrita: x.isSubscribed })))
    })), null, 1));
    throw erro;
  }
  await viewer.waitForFunction(() => [...peers.values()][0].remoteStreams.micAudio.getAudioTracks().length === 1, null, { timeout: 40000 });
  await waitForDecodedVideos(host);
  await waitForDecodedVideos(viewer);
  console.log('PASS: bidirectional simultaneous media, both sharing screen at once');

  // O som da tela nao pode viajar com DTX nem RED: os dois sao feitos para voz e cortam
  // musica e som de jogo. O servidor de midia os liga por padrao em faixa mono.
  // O som da tela nao pode viajar com DTX nem RED: os dois sao feitos para VOZ -- DTX corta
  // a transmissao no silencio, RED duplica pacotes -- e estragam musica e som de jogo. O
  // servidor de midia liga os dois por padrao em faixa mono, entao a escolha e explicita.
  const opcoesPorFonte = await host.evaluate(() => ({
    screenAudio: opcoesDePublicacao('screenAudio'),
    mic: opcoesDePublicacao('mic'),
    screen: opcoesDePublicacao('screen')
  }));
  assert.equal(opcoesPorFonte.screenAudio.dtx, false);
  assert.equal(opcoesPorFonte.screenAudio.red, false);
  assert.equal(opcoesPorFonte.screenAudio.source, 'screen_share_audio');
  // A voz continua com o padrao: DTX economiza banda no silencio e ali isso e desejável.
  assert.equal(opcoesPorFonte.mic.dtx, undefined);
  // Quando falta banda ou processador, alguma coisa cede. O padrão equilibra; as outras
  // opções existem porque ler código e jogar pedem coisas opostas -- e a escolha precisa
  // chegar de verdade às opções de publicação, senão o seletor é enfeite.
  assert.equal(opcoesPorFonte.screen.degradationPreference, 'maintain-framerate');
  const porPrioridade = await host.evaluate(async () => {
    const saida = {};
    for (const escolha of ['nitidez', 'fluidez', 'automatico']) {
      await definirPrioridadeDaTela(escolha);
      const o = opcoesDePublicacao('screen');
      saida[escolha] = { degradacao: o.degradationPreference, fps: o.screenShareEncoding.maxFramerate, pista: screenStream.getVideoTracks()[0].contentHint };
    }
    return saida;
  });
  assert.equal(porPrioridade.nitidez.degradacao, 'maintain-resolution');
  assert.equal(porPrioridade.nitidez.pista, 'detail');
  assert.equal(porPrioridade.fluidez.degradacao, 'maintain-framerate');
  assert.equal(porPrioridade.fluidez.pista, 'motion');
  assert.equal(porPrioridade.fluidez.fps, 60);
  // O padrão segura os quadros e deixa a resolução ceder: é o que evita a imagem ficar
  // nítida e travar logo depois.
  assert.equal(porPrioridade.automatico.degradacao, 'maintain-framerate');
  assert.equal(porPrioridade.automatico.fps, 30);
  // A câmera é movimento: perder nitidez incomoda menos que ver a pessoa aos solavancos.
  assert.equal(await host.evaluate(() => opcoesDePublicacao('camera').degradationPreference), 'maintain-framerate');
  console.log('PASS: screen audio is published without DTX or RED, while voice keeps the defaults');

  // Perder a sinalizacao do servidor de midia nao pode derrubar a sala em silencio: a
  // conexao precisa voltar sozinha e a midia junto com ela.
  await viewer.evaluate(() => transporte.sala.engine?.client?.close?.());
  await viewer.waitForFunction(() => transporte.sala.state === 'connected', null, { timeout: 60000 });
  await viewer.waitForFunction(() => [...peers.values()][0]?.remoteStreams.camera.getVideoTracks().length === 1, null, { timeout: 60000 });
  await waitForDecodedVideos(viewer);
  console.log('PASS: media reconnects on its own after the signalling link drops');

  // Virar a camera no celular. No iOS a segunda camera nao pode abrir com a primeira viva:
  // a antiga tem de estar encerrada ANTES do getUserMedia.
  const virada = await viewer.evaluate(async () => {
    const anterior = cameraStream.getVideoTracks()[0];
    const capturaOriginal = navigator.mediaDevices.getUserMedia;
    const registro = [];
    const espionar = value => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value });
    espionar(async constraints => {
      registro.push({ lado: constraints.video?.facingMode || null, anteriorEncerrada: anterior.readyState === 'ended' });
      return capturaOriginal.call(navigator.mediaDevices, constraints);
    });
    // applyConstraints não vira a câmera sintética do teste: força o segundo caminho.
    anterior.applyConstraints = () => Promise.reject(new DOMException('sem suporte', 'OverconstrainedError'));
    await virarCamera();
    espionar(capturaOriginal);
    return { registro, lado: ladoDaCamera, viva: cameraStream.getVideoTracks()[0].readyState, trocou: cameraStream.getVideoTracks()[0] !== anterior };
  });
  assert.deepEqual(virada.registro, [{ lado: 'environment', anteriorEncerrada: true }]);
  assert.equal(virada.lado, 'environment');
  assert.equal(virada.viva, 'live');
  assert.equal(virada.trocou, true);
  await host.waitForFunction(() => [...peers.values()][0].remoteStreams.camera.getVideoTracks().length === 1, null, { timeout: 40000 });
  await waitForDecodedVideos(host);

  // Se a camera pedida nao abrir, a anterior volta: ninguem fica sem imagem por ter tentado.
  const recuperada = await viewer.evaluate(async () => {
    const capturaOriginal = navigator.mediaDevices.getUserMedia;
    const espionar = value => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value });
    let tentativas = 0;
    espionar(async constraints => {
      if (++tentativas === 1) throw new DOMException('ocupada', 'NotReadableError');
      return capturaOriginal.call(navigator.mediaDevices, constraints);
    });
    cameraStream.getVideoTracks()[0].applyConstraints = () => Promise.reject(new DOMException('sem suporte', 'OverconstrainedError'));
    await virarCamera();
    espionar(capturaOriginal);
    return { lado: ladoDaCamera, viva: cameraStream?.getVideoTracks()[0]?.readyState, aviso: status.textContent, tentativas };
  });
  assert.equal(recuperada.tentativas, 2);
  assert.equal(recuperada.lado, 'environment');
  assert.equal(recuperada.viva, 'live');
  assert.match(recuperada.aviso, /anterior foi mantida/);
  await waitForDecodedVideos(host);
  console.log('PASS: flipping the camera stops the old track first and restores it when the other side fails');

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
  // O socket cuida so do chat: uma queda dele nao pode derrubar video nem voz.
  await viewer.waitForFunction(() => peers.size === 1 && transporte.sala.state === 'connected' && stageVideo.videoWidth > 0, null, { timeout: 40000 });
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

  await host.waitForFunction(() => cadeiaDeRuido?.contexto.state === 'running' && faixaEnviadaDoMic === cadeiaDeRuido.faixa);
  await host.evaluate(() => noiseBtn.click());
  await host.waitForFunction(() => !cadeiaDeRuido && faixaEnviadaDoMic === micTrack);
  await host.evaluate(() => noiseBtn.click());
  await host.waitForFunction(() => cadeiaDeRuido && faixaEnviadaDoMic === cadeiaDeRuido.faixa);
  // O mudo tem de ATRAVESSAR a sala. "enabled = false" cala o som, mas e uma decisao que
  // morre neste navegador: quem conta a mudanca para os outros e o mute() da publicacao.
  // Sem ele o som sumia e o icone do outro lado continuava aceso -- pior que nao ter
  // indicador, porque a pessoa aparece disponivel enquanto ninguem a ouve. Verificar so o
  // lado local (era o que este teste fazia) nunca pegaria isso.
  const vistoPeloOutro = quantos => viewer.waitForFunction(
    alvo => [...peers.values()].find(p => p.name === 'Molejo')?.state.micMuted === alvo,
    quantos, { timeout: 20000 });

  await host.evaluate(() => alternarMic());
  assert.equal(await host.evaluate(() => faixaEnviadaDoMic.enabled), false);
  await vistoPeloOutro(true);
  // A republicacao da faixa (trocar o filtro de ruido) nao pode desfazer o anuncio: a faixa
  // nova nasce anunciada como ativa, com a pessoa ainda muda.
  await host.evaluate(() => noiseBtn.click());
  await host.waitForFunction(() => !cadeiaDeRuido && faixaEnviadaDoMic === micTrack);
  await vistoPeloOutro(true);

  // O desmute e o caminho onde o aviso do servidor de midia chega tarde (ou nao chega): a
  // publicacao do outro lado ja diz "nao muda" e o estado derivado continuava dizendo
  // "muda". Quem fecha essa janela e a conferencia periodica, que recalcula o estado de
  // quem ja esta na lista em vez de so conferir quem entrou e quem saiu.
  await host.evaluate(() => alternarMic());
  assert.equal(await host.evaluate(() => faixaEnviadaDoMic.enabled), true);
  await vistoPeloOutro(false);
  console.log('PASS: RNNoise AudioWorklet loads, toggles, and mic mute reaches the other side');

  // Daqui em diante o teste nao usa mais a transmissao. Encerrar as duas paginas libera a
  // captura, o simulcast e as conexoes: mante-las vivas so por inercia deixava as etapas
  // finais falhando de forma intermitente, por falta de recursos e nao por defeito.
  await viewer.close();
  await host.close();
  await mobile.close();
  await desktop.close();

  const mobileLimpo = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await syntheticCapture(mobileLimpo);
  const emptyMobile = await join(mobileLimpo, 'Visitante', 'outra-sala');
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

  const desktopLimpo = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  await syntheticCapture(desktopLimpo);
  const solo = await join(desktopLimpo, 'Solo', 'entrada-saida');
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
  const companion = await join(mobileLimpo, 'Companhia', 'entrada-saida');
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
  const capturePage = await join(desktopLimpo, 'Captura', 'politica-captura');
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

  // O aplicativo abre em "tela inteira": capturar UMA janela obriga o Windows a compor
  // aquela janela de novo so para a captura, e quem perde quadros e o JOGO. Quem escolher a
  // janela mesmo assim ve por que ela custa, e troca num clique.
  const custoDaJanela = await nativePage.evaluate(() => {
    const padrao = captureMode.value;
    captureMode.value = 'window';
    atualizarExplicacaoDeAudio();
    const avisando = !capturaAviso.hidden;
    usarTelaInteiraBtn.click();
    return { padrao, windows: ehWindows, avisando, depoisDoBotao: captureMode.value };
  });
  assert.equal(custoDaJanela.padrao, 'monitor');
  assert.equal(custoDaJanela.avisando, custoDaJanela.windows);
  assert.equal(custoDaJanela.depoisDoBotao, 'monitor');
  console.log('PASS: native app defaults to full screen and explains what a single window costs');

  const nativeCapture = await nativePage.evaluate(async () => {
    audioPolicy.value = 'auto';
    // O audio por PID e do modo janela: aqui a escolha e explicita, nao o padrao.
    captureMode.value = 'window';
    atualizarExplicacaoDeAudio();
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

  // Tela de outra pessoa so desce depois de pedir, como no Discord. O que se mede aqui e o
  // que custa: quantas FAIXAS chegaram -- nao se um video esta visivel.
  const palcoContext = await browser.newContext();
  await syntheticCapture(palcoContext);
  const quemMostra = await join(palcoContext, 'Mostra', 'assistir-sob-demanda');
  const quemAssiste = await join(palcoContext, 'Assiste', 'assistir-sob-demanda');
  await quemAssiste.waitForFunction(() => peers.size === 1);
  await quemMostra.locator('#screenBtn').click();
  await quemMostra.locator('#audioPolicy').selectOption('none');
  await quemMostra.locator('#confirmScreenBtn').click();
  await quemMostra.waitForFunction(() => Boolean(screenStream) && publicacoesLocais.screen);
  await quemAssiste.waitForFunction(() => [...peers.values()][0]?.state.screen, null, { timeout: 20000 });
  const semPedir = await quemAssiste.evaluate(() => {
    const par = [...peers.values()][0];
    return { anunciada: par.state.screen, assistindo: par.assistindo,
      faixas: par.remoteStreams.screen.getTracks().length,
      convidando: !document.querySelector('.convite-de-tela')?.hidden,
      palco: pinned?.source || null };
  });
  assert.deepEqual(semPedir, { anunciada: true, assistindo: false, faixas: 0, convidando: true, palco: null });
  await quemAssiste.locator('.assistir-btn').click();
  await quemAssiste.waitForFunction(() => [...peers.values()][0]?.remoteStreams.screen.getTracks().length === 1, null, { timeout: 20000 });
  assert.equal(await quemAssiste.evaluate(() => pinned?.source), 'screen');
  // Assistir poe a tela no palco, e uma fonte em destaque sai da plateia -- entao o botao de
  // parar que vale aqui e o do palco, nao o do quadradinho (que nem existe mais neste estado).
  // O do quadradinho continua servindo para uma segunda tela assistida fora do destaque.
  await quemAssiste.locator('#stageStopBtn').click();
  await quemAssiste.waitForFunction(() => [...peers.values()][0]?.remoteStreams.screen.getTracks().length === 0, null, { timeout: 20000 });
  // Parar de assistir nao pode fazer a tela sumir da sala: ela continua no ar para os outros.
  assert.deepEqual(await quemAssiste.evaluate(() => {
    const par = [...peers.values()][0];
    return { anunciada: par.state.screen, assistindo: par.assistindo, quadradinhos: tilesDeTela.size };
  }), { anunciada: true, assistindo: false, quadradinhos: 1 });
  // A camera nunca precisou ser pedida, e nao passa a precisar.
  await quemMostra.locator('#cameraBtn').click();
  await quemAssiste.waitForFunction(() => [...peers.values()][0]?.remoteStreams.camera.getTracks().length > 0, null, { timeout: 20000 });
  console.log('PASS: a remote screen only streams after you ask, and stops when you stop watching');

  // O fantasma: quando a saida vem do servidor de midia, a pessoa ja saiu do mapa ANTES de a
  // limpeza rodar. Se a limpeza depender de encontra-la la, o quadradinho fica orfao para
  // sempre -- que era o defeito relatado em sala cheia e em celular.
  const orfao = await quemAssiste.evaluate(() => {
    const id = [...peers.keys()][0];
    peers.delete(id);
    removerPar(id);
    return { restou: tiles.has(id), telaRestou: tilesDeTela.has(id) };
  });
  assert.deepEqual(orfao, { restou: false, telaRestou: false });
  await palcoContext.close();
  console.log('PASS: leaving cleans the tile even when the peer is already out of the map');

  assert.deepEqual(errors, []);
  console.log(`PASS: responsive layout, dialogs, diagnostics. Engine: ${process.env.TEST_BROWSER || 'chromium'}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  await instancia?.encerrar();
});
