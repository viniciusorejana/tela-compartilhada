// O volume de cada pessoa até 200%, com mídia de verdade.
//
// Acima de 100% o som sai pelo Web Audio, com o elemento de áudio mudo (sala.js, "Acima de
// 100%"). O que só um navegador de verdade mostra é se o som CHEGA por esse caminho: no
// Chromium, o áudio remoto do WebRTC fica em silêncio no Web Audio quando nenhum elemento o
// toca -- e esse é o tipo de coisa que quebra calada numa atualização. Por isso o teste mede
// o sinal que sai do ganho, e não só que o ganho existe.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const port = 3227;
const origin = `http://localhost:${port}`;
const SALA = 'sala-do-volume';
const erros = [];
let instancia, browser;

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error(`erro na página de ${nome}:`, e.message); });
  await pagina.goto(`${origin}/${SALA}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 30000 });
  return pagina;
}
const vozChegou = pagina => pagina.waitForFunction(() => [...peers.values()].some(p => p.remoteStreams.micAudio.getAudioTracks().length), null, { timeout: 30000 });
const estadoDaVoz = (pagina, id) => pagina.evaluate(id => {
  const refs = tiles.get(id);
  return { volume: refs.volumeDeVoz, reforco: reforcos.has(refs.peerAudio), mudo: refs.peerAudio.muted, volumeDoElemento: refs.peerAudio.volume };
}, id);

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(port) }, midia: true });
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ana = await entrar(await browser.newContext({ permissions: ['microphone'] }), 'Ana');
  const bia = await entrar(await browser.newContext(), 'Bia');
  await ana.locator('#micBtn').click();
  await vozChegou(bia);
  const idDaAna = await bia.evaluate(() => [...peers.keys()][0]);
  const linha = bia.locator(`.participant[data-id="${idDaAna}"] .volume-row`);
  const valor = linha.locator('.volume-valor');

  assert.equal(await linha.locator('.volume-slider').getAttribute('max'), '200');
  assert.equal(await valor.textContent(), '100%', 'o número está sempre à vista');
  assert.equal(await valor.isDisabled(), false, 'o número se clica para digitar, mesmo em 100%');

  // ---------- 150%: pelo ganho, com o elemento mudo, e o som chegando ----------
  await linha.locator('.volume-slider').fill('150');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 1.5, reforco: true, mudo: true, volumeDoElemento: 1 });
  // O microfone falso do Chromium é um bipe curto por segundo, e não um tom contínuo: uma
  // janela só pode cair no silêncio entre dois bipes. Vale o pico ao longo de 1,5 s.
  const sinal = await bia.evaluate(async id => {
    const reforco = reforcos.get(tiles.get(id).peerAudio);
    const analisador = contextoDeReforco.createAnalyser();
    reforco.ganho.connect(analisador);
    const dados = new Float32Array(analisador.fftSize);
    let rms = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      analisador.getFloatTimeDomainData(dados);
      rms = Math.max(rms, Math.sqrt(dados.reduce((soma, v) => soma + v * v, 0) / dados.length));
    }
    reforco.ganho.disconnect(analisador);
    return { ganho: reforco.ganho.gain.value, rms };
  }, idDaAna);
  assert.equal(sinal.ganho, 1.5);
  assert.ok(sinal.rms > 0.001, `o som não chegou pelo ganho (RMS ${sinal.rms}): o elemento mudo não está alimentando o Web Audio`);
  assert.equal(await valor.textContent(), '150%');
  assert.match(await valor.getAttribute('class'), /reforcado/, 'acima de 100% o número fica âmbar');
  console.log(`PASS: 150% sai pelo ganho, com o elemento mudo e sinal de verdade (RMS ${sinal.rms.toFixed(3)})`);

  // ---------- 100% gruda no arrasto; o número se digita (valor-digitado.js) ----------
  await linha.locator('.volume-slider').fill('97');
  assert.equal(await linha.locator('.volume-slider').inputValue(), '100', 'perto do meio, gruda em 100');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 1, reforco: false, mudo: false, volumeDoElemento: 1 }, 'em 100% o elemento toca sozinho, sem ganho');
  const campo = linha.locator('input.valor-digitado');
  await linha.locator('.volume-slider').fill('180');
  await valor.click();
  assert.equal(await campo.inputValue(), '180', 'o campo abre com o volume de agora');
  assert.equal(await campo.evaluate(el => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length), true, 'e já selecionado, para escrever por cima');
  await campo.fill('97');
  await campo.press('Enter');
  assert.equal(await campo.count(), 0, 'o Enter aplica e o número volta');
  assert.equal(await linha.locator('.volume-slider').inputValue(), '97', 'o que se escreve não gruda em 100');
  assert.equal(await valor.textContent(), '97%');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 0.97, reforco: false, mudo: false, volumeDoElemento: 0.97 });
  await valor.click();
  await campo.fill('150');
  await campo.press('Escape');
  assert.equal(await campo.count(), 0);
  assert.equal(await valor.textContent(), '97%', 'Esc desiste');
  await valor.click();
  await campo.fill('350%');
  await campo.press('Enter');
  assert.equal(await valor.textContent(), '200%', 'acima do máximo, fica no máximo');
  assert.equal((await estadoDaVoz(bia, idDaAna)).reforco, true, 'e passa pelo ganho, como a régua');
  await valor.click();
  await campo.fill('60');
  await bia.locator('.participants-heading strong').click();
  assert.equal(await campo.count(), 0, 'sair do campo também aplica');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 0.6, reforco: false, mudo: false, volumeDoElemento: 0.6 }, 'abaixo de 100%, como sempre foi');
  console.log('PASS: 100% gruda no arrasto, e o número se digita: Enter e sair aplicam, Esc desiste, o máximo segura');

  // ---------- Lembrado, e calado pelo ensurdecer ----------
  await linha.locator('.volume-slider').fill('130');
  await bia.waitForTimeout(700);
  await bia.reload();
  await bia.locator('#nameInput').fill('Bia');
  await bia.locator('#nameConfirmBtn').click();
  await vozChegou(bia);
  await bia.waitForFunction(() => { const [id] = peers.keys(); return reforcos.has(tiles.get(id)?.peerAudio); }, null, { timeout: 10000 });
  const idDepois = await bia.evaluate(() => [...peers.keys()][0]);
  assert.equal((await estadoDaVoz(bia, idDepois)).volume, 1.3, 'o volume da Ana volta como foi deixado');
  await bia.locator('#deafenBtn').click();
  assert.deepEqual(await estadoDaVoz(bia, idDepois), { volume: 1.3, reforco: false, mudo: true, volumeDoElemento: 1 }, 'ensurdecer cala também o que passa pelo ganho');
  await bia.locator('#deafenBtn').click();
  assert.equal((await estadoDaVoz(bia, idDepois)).reforco, true, 'e ao voltar a ouvir, o reforço volta');
  console.log('PASS: 130% é lembrado ao voltar, e ensurdecer cala o reforço');

  // ---------- No celular: a pílula e a folha de volume ----------
  // A régua fina não cabe no dedo: no toque ela sai do quadradinho, e o número vira a porta de
  // uma folha com a régua grande (volume-folha.js). O volume é o mesmo, pelas mesmas funções.
  const celular = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const carla = await entrar(celular, 'Carla');
  await vozChegou(carla);
  const idNoCelular = await carla.evaluate(() => [...peers.values()].find(p => p.name === 'Ana').id);
  const linhaNoCelular = carla.locator(`.participant[data-id="${idNoCelular}"] .volume-row`);
  assert.equal(await linhaNoCelular.locator('.volume-slider').isVisible(), false, 'no toque, a régua fina sai do quadradinho');
  const pilula = linhaNoCelular.locator('.volume-valor');
  assert.equal(await pilula.isDisabled(), false, 'a pílula abre a folha mesmo em 100%');
  const alturaDaPilula = await pilula.evaluate(el => el.getBoundingClientRect().height);
  assert.ok(alturaDaPilula >= 32, `a pílula tem o tamanho do dedo (${alturaDaPilula}px)`);
  await pilula.tap();
  await carla.locator('#volumePanel').waitFor({ state: 'visible' });
  assert.equal(await carla.locator('#volumeTitulo').textContent(), 'Ana');
  // A folha sobe de baixo: mede depois de a animação de entrada terminar.
  await carla.locator('#volumePanel .volume-card').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const folha = await carla.locator('#volumePanel .volume-card').boundingBox();
  assert.ok(Math.abs(folha.y + folha.height - 844) <= 1 && folha.width >= 389, `no celular, a folha fica presa embaixo e da largura da tela (${JSON.stringify(folha)})`);
  await carla.locator('#volumeAtalhos button[data-nivel="150"]').tap();
  assert.deepEqual(await estadoDaVoz(carla, idNoCelular), { volume: 1.5, reforco: true, mudo: true, volumeDoElemento: 1 }, 'o atalho de 150% reforça como a régua fina');
  assert.equal(await carla.locator('#volumeValor').textContent(), '150%');
  assert.equal(await pilula.textContent(), '150%', 'a pílula acompanha a folha');
  await carla.locator('#volumeRegua').fill('70');
  assert.equal((await estadoDaVoz(carla, idNoCelular)).volume, 0.7, 'a régua grande mexe no mesmo volume');
  // O número grande da folha também se digita, com o teclado de números do celular.
  await carla.locator('#volumeValor').tap();
  const campoDaFolha = carla.locator('#volumePanel input.valor-digitado');
  assert.equal(await campoDaFolha.getAttribute('inputmode'), 'numeric');
  await campoDaFolha.fill('97');
  await campoDaFolha.press('Enter');
  assert.equal((await estadoDaVoz(carla, idNoCelular)).volume, 0.97, 'o número digitado na folha vale, sem grudar em 100');
  assert.equal(await pilula.textContent(), '97%', 'e a pílula acompanha');
  await carla.locator('#volumeMudo').tap();
  assert.equal((await estadoDaVoz(carla, idNoCelular)).mudo, true, 'o silenciar da folha cala a pessoa');
  await carla.locator('#volumeMudo').tap();
  await carla.locator('#volumePanel [data-close="volumePanel"]').tap();
  await carla.locator('#volumePanel').waitFor({ state: 'hidden' });
  console.log('PASS: no celular, a pílula abre a folha, e a régua grande, os atalhos e o silenciar mexem no mesmo volume');

  assert.deepEqual(erros, []);
  console.log('Volume até 200%: tudo certo.');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await instancia?.encerrar();
});
