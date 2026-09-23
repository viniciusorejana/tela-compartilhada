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
  assert.equal(await valor.isDisabled(), true, 'em 100% não há o que desfazer');

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

  // ---------- Voltar a 100%: grudando, e pelo clique no número ----------
  await linha.locator('.volume-slider').fill('97');
  assert.equal(await linha.locator('.volume-slider').inputValue(), '100', 'perto do meio, gruda em 100');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 1, reforco: false, mudo: false, volumeDoElemento: 1 }, 'em 100% o elemento toca sozinho, sem ganho');
  await linha.locator('.volume-slider').fill('180');
  await valor.click();
  assert.equal(await valor.textContent(), '100%', 'clicar no número volta a 100%');
  assert.equal((await estadoDaVoz(bia, idDaAna)).reforco, false);
  await linha.locator('.volume-slider').fill('60');
  assert.deepEqual(await estadoDaVoz(bia, idDaAna), { volume: 0.6, reforco: false, mudo: false, volumeDoElemento: 0.6 }, 'abaixo de 100%, como sempre foi');
  console.log('PASS: 100% gruda, e o clique no número desfaz o ajuste');

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
