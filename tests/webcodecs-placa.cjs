// A tela por WebCodecs na PLACA DE VÍDEO de verdade, com o interruptor no Automático.
//
// O teste de sempre (webcodecs-browser.cjs) roda no Chromium do Playwright, que não tem placa,
// e por isso só prova o caminho. Este usa o Chrome instalado na máquina, que alcança a placa
// (NVENC, AMF, QSV) pelo codificador do Windows, e confere o que o automático entrega em cada
// combinação de transmissão: 720p, 1080p e 1440p, a 30 e a 60 quadros -- mais a troca de
// qualidade no meio da transmissão.
//
// Foi escrito depois de um defeito real: o Chrome recusa 1440p a 60 na placa quando a taxa é
// declarada, o Nexo caía para o caminho de hoje com "o codificador recusou a configuração da
// imagem cheia", e o teste sem placa nunca teria visto.
//
// Pula (e diz por quê) numa máquina sem o Chrome, sem codificação de H.264 pela placa, ou com o
// servidor de mídia anterior à 1.13.7 -- ali o automático não liga de propósito.
//
//   npm run test:webcodecs:placa
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3233;
const sala = 'squad-webcodecs-placa';
let instancia, navegador;

// A captura respeita o tamanho e a taxa pedidos, como o getDisplayMedia de verdade, e desenha
// texto e blocos em movimento -- o codificador precisa ter o que fazer.
async function capturaQueRespeitaRestricoes(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const limite = (restricao, padrao) => Math.min(padrao, Number(restricao?.max || restricao?.ideal || restricao) || padrao);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async pedido => {
      const canvas = document.createElement('canvas');
      canvas.width = limite(pedido?.video?.width, 2560);
      canvas.height = limite(pedido?.video?.height, 1440);
      const quadros = limite(pedido?.video?.frameRate, 60);
      const ctx = canvas.getContext('2d');
      let quadro = 0;
      const timer = setInterval(() => {
        quadro++;
        ctx.fillStyle = `hsl(${quadro * 3 % 360} 45% 30%)`; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#eee'; ctx.font = `${Math.round(canvas.height / 18)}px sans-serif`;
        for (let k = 0; k < 8; k++) ctx.fillText(`quadro ${quadro} linha ${k}`, (quadro * 9 + k * 70) % canvas.width, (k + 1) * canvas.height / 9);
        ctx.fillRect((quadro * 15) % canvas.width, canvas.height / 2, canvas.width / 10, canvas.height / 6);
      }, 1000 / quadros);
      const fluxo = canvas.captureStream(quadros);
      fluxo.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return fluxo;
    } });
  });
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => console.error(`erro na página de ${nome}:`, erro.message));
  await pagina.goto(`${instancia.origem.replace('127.0.0.1', 'localhost')}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

const PERFIS = [['economical', 720], ['high', 1080], ['ultra', 1440]];

const envio = pagina => pagina.evaluate(() => transporte.telaWebCodecs.estadoDoEnvio());

async function esperarCamadaCheia(pagina, rotulo) {
  await pagina.waitForFunction(() => {
    const e = transporte.telaWebCodecs.estadoDoEnvio();
    return e?.modo === 'webcodecs' && e.camadas.some(c => c.camada === 'alta' && c.fps > 0);
  }, null, { timeout: 30000 }).catch(async erro => { console.error(`${rotulo}: envio =`, JSON.stringify(await envio(pagina))); throw erro; });
  // Uma janela inteira de medição com a camada no ar, para o número de quadros ser do regime.
  await pagina.waitForTimeout(2500);
  return (await envio(pagina)).camadas.find(c => c.camada === 'alta');
}

(async () => {
  try {
    navegador = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist'] });
  } catch (erro) {
    console.log(`SKIP: o Chrome não está instalado nesta máquina (${erro.message.split('\n')[0]}).`);
    return;
  }
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(porta) } });

  const contextoAna = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  await capturaQueRespeitaRestricoes(contextoAna);
  const ana = await entrar(contextoAna, 'Ana');
  const capacidade = await ana.evaluate(async () => { await transporte.telaWebCodecs.sondagens; return transporte.telaWebCodecs.capacidade(); });
  const versao = await ana.evaluate(() => transporte.sala.serverInfo?.version || '');
  console.log(`Chrome ${await navegador.version()} · servidor de mídia ${versao} · envio ${JSON.stringify(capacidade.envio)}`);
  if (!capacidade.envio?.h264Hardware) { console.log('SKIP: este Chrome não codifica H.264 pela placa de vídeo nesta máquina.'); return; }
  const [a, b, c] = versao.split('.').map(Number);
  if (!(a > 1 || (a === 1 && (b > 13 || (b === 13 && c >= 7))))) {
    console.log(`SKIP: o servidor de mídia é a ${versao}; o automático pede a 1.13.7 ou mais nova ($env:NEXO_LIVEKIT = '1.13.7'; npm run build:sfu).`);
    return;
  }
  const bia = await entrar(await navegador.newContext({ viewport: { width: 1440, height: 900 } }), 'Bia');
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana'), null, { timeout: 20000 });

  const resultados = [];
  for (const [perfil, altura] of PERFIS) {
    for (const quadros of [30, 60]) {
      const rotulo = `${altura}p${quadros}`;
      await ana.locator('#screenBtn').click();
      // Ficam na aba "Qualidade" do painel de compartilhar, fechada por padrão.
      await ana.locator('#shareQuality').selectOption(perfil, { force: true });
      await ana.locator('#shareFps').selectOption(String(quadros), { force: true });
      await ana.locator('#audioPolicy').selectOption('none');
      await ana.locator('#confirmScreenBtn').click();
      await ana.waitForFunction(() => Boolean(screenStream));
      await bia.waitForFunction(() => [...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
      if (!await bia.evaluate(() => [...peers.values()][0].assistindo)) await bia.locator('.participant-tela .assistir-btn').first().click();
      const cheia = await esperarCamadaCheia(ana, rotulo);
      const estado = await envio(ana);
      resultados.push({ rotulo, cheia, motivo: estado.motivo });
      console.log(`  ${rotulo.padEnd(8)} → ${cheia.largura}×${cheia.altura} a ${Math.round(cheia.fps)}/${cheia.quadrosAlvo} fps, ${(cheia.bps / 1e6).toFixed(1)} Mbps,`
        + ` ${cheia.hardware ? 'PLACA' : 'processador'}, ${cheia.codec}, taxa ${cheia.taxaDeclarada ? 'declarada' : 'não declarada'}`
        + `${estado.motivo.includes('a placa não aceita') ? ` (${estado.motivo.split('; ')[1]})` : ''}`
        + ` · pulados ${JSON.stringify(cheia.descartes)} · ${cheia.msDeCodificacao?.toFixed(1)} ms por quadro`
        + `${cheia.escala > 1 ? ` · ENCOLHIDA por ${cheia.ultimaMudanca}` : ''}`);
      assert.equal(cheia.hardware, true, `${rotulo}: a imagem cheia sai pela placa de vídeo`);
      assert.equal(cheia.altura, altura, `${rotulo}: no tamanho pedido`);
      assert.equal(cheia.quadrosAlvo, quadros, `${rotulo}: na taxa pedida`);
      // A captura sintética em canvas não sustenta 60 exatos; o que se confere é que os quadros
      // não caíram para a metade, que é o sintoma de um codificador que não acompanha.
      assert.ok(cheia.fps >= quadros * 0.6, `${rotulo}: ${cheia.fps.toFixed(1)} quadros por segundo saindo`);
      await bia.waitForFunction(() => stageVideo.videoWidth > 0, null, { timeout: 15000 });
      await ana.locator('#screenBtn').click();
      await ana.waitForFunction(() => !screenStream && !transporte.telaWebCodecs.estadoDoEnvio());
      await bia.waitForFunction(() => ![...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
    }
  }
  console.log('PASS: todas as combinações de transmissão saem pela placa de vídeo, no tamanho e na taxa pedidos');

  // ---------- Troca de qualidade no meio da transmissão ----------
  // De 1080p a 30 para 1440p a 60 sem parar: a escolha feita para o pedido antigo declararia uma
  // taxa que a placa recusa no tamanho novo.
  await ana.locator('#screenBtn').click();
  await ana.locator('#shareQuality').selectOption('high', { force: true });
  await ana.locator('#shareFps').selectOption('30', { force: true });
  await ana.locator('#audioPolicy').selectOption('none');
  await ana.locator('#confirmScreenBtn').click();
  await bia.waitForFunction(() => [...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
  if (!await bia.evaluate(() => [...peers.values()][0].assistindo)) await bia.locator('.participant-tela .assistir-btn').first().click();
  await esperarCamadaCheia(ana, 'antes da troca');
  await ana.evaluate(async () => {
    const qualidade = document.getElementById('videoQuality');
    qualidade.value = 'ultra'; await qualidade.onchange();
    await definirQuadrosDaTela(60);
  });
  // A captura sintética nasceu em 1080p e um canvas não cresce com `applyConstraints` -- numa tela
  // de verdade ela subiria para 1440p. O que se confere é o pedido novo (60 quadros, alvo 1440p)
  // valendo na placa, com a imagem do tamanho da fonte.
  await ana.waitForFunction(() => {
    const e = transporte.telaWebCodecs.estadoDoEnvio();
    const cheia = e?.camadas.find(c => c.camada === 'alta');
    return cheia && cheia.quadrosAlvo === 60 && cheia.altura === Math.min(1440, e.fonte.altura) && cheia.fps > 0;
  }, null, { timeout: 30000 }).catch(async erro => { console.error('troca: envio =', JSON.stringify(await envio(ana))); throw erro; });
  await ana.waitForTimeout(2500);
  const trocada = (await envio(ana)).camadas.find(c => c.camada === 'alta');
  assert.equal((await envio(ana)).modo, 'webcodecs', 'a troca não derruba o caminho novo');
  assert.equal(trocada.hardware, true);
  assert.ok(trocada.fps > 0, 'e os quadros continuam saindo');
  console.log(`PASS: trocar de 1080p30 para 1440p60 no meio da transmissão continua na placa (${trocada.largura}×${trocada.altura} a ${trocada.quadrosAlvo} pedidos, taxa ${trocada.taxaDeclarada ? 'declarada' : 'não declarada'})`);
  console.log('Tela por WebCodecs na placa de vídeo: tudo certo.');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros?.());
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
