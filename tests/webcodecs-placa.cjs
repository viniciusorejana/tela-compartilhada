// A tela pela PLACA DE VÍDEO de verdade, com o interruptor no Automático.
//
// O teste de sempre (webcodecs-browser.cjs) roda no Chromium do Playwright, que não tem placa,
// e por isso só prova o caminho. Este usa o Chrome instalado na máquina, que alcança a placa
// (NVENC, AMF, QSV) pelo codificador do Windows, e confere o que o automático entrega em cada
// combinação de transmissão: 720p, 1080p e 1440p, a 30 e a 60 quadros -- mais a troca de
// qualidade no meio da transmissão.
//
// No automático, a placa codifica e o RTP transporta (tela-placa-rtp.js): quem transmite
// confere que a camada cheia sai da placa no tamanho e na taxa pedidos, e quem assiste confere
// que recebe exatamente isso pelo RTP -- e não a miniatura que o codificador do WebRTC produz.
//
// Foi escrito depois de um defeito real: o Chrome recusa 1440p a 60 na placa quando a taxa é
// declarada, o Nexo caía para o caminho de hoje com "o codificador recusou a configuração da
// imagem cheia", e o teste sem placa nunca teria visto.
//
// Pula (e diz por quê) numa máquina sem o Chrome ou sem codificação de H.264 pela placa -- ali o
// automático não liga de propósito.
//
//   npm run test:webcodecs:placa
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3233;
const sala = 'squad-webcodecs-placa';
let instancia, navegador;

// A captura respeita o tamanho e a taxa pedidos, como o getDisplayMedia de verdade, e desenha
// texto e blocos em movimento -- o codificador precisa ter o que fazer. `window.fonteDoTeste`
// troca a fonte: 'camera' é a câmera falsa do Chrome, que entrega quadros de um conjunto pequeno
// de buffers como a captura de tela de verdade (o canvas não tem esse limite); 'aba' é a captura
// DE VERDADE de uma aba parada (ABA_PARADA), que, como a tela, só entrega quadro quando algo muda.
const ABA_PARADA = 'Aba parada do teste';
async function capturaQueRespeitaRestricoes(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const limite = (restricao, padrao) => Math.min(padrao, Number(restricao?.max || restricao?.ideal || restricao) || padrao);
    const deVerdade = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async pedido => {
      if (window.fonteDoTeste === 'camera') {
        return navigator.mediaDevices.getUserMedia({ video: { width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { ideal: 60 } } });
      }
      if (window.fonteDoTeste === 'aba') return deVerdade(pedido);
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

// Os eventos da tela (`tela.*`, do diagnóstico da sala) de cada página: impressos quando algo
// falha, porque são eles que dizem POR QUE a tela saiu da placa.
const eventos = [];
async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => console.error(`erro na página de ${nome}:`, erro.message));
  pagina.on('console', m => { if (/\[bg\] .*tela\./.test(m.text())) eventos.push(`${nome} ${m.text()}`); });
  await pagina.goto(`${instancia.origem.replace('127.0.0.1', 'localhost')}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

const PERFIS = [['economical', 720], ['high', 1080], ['ultra', 1440]];

const envio = pagina => pagina.evaluate(() => telaPelaPlaca?.estadoDoEnvio() ?? null);

async function esperarCamadaCheia(pagina, rotulo) {
  await pagina.waitForFunction(() => {
    const e = telaPelaPlaca?.estadoDoEnvio();
    return e?.transporte === 'rtp' && e.camadas.some(c => c.camada === 'alta' && c.fps > 0);
  }, null, { timeout: 30000 }).catch(async erro => {
    console.error(`${rotulo}: envio =`, JSON.stringify(await envio(pagina)), '· caminho =', await pagina.evaluate(() => telaPelaPlaca?.ultimaFalha()));
    throw erro;
  });
  // Uma janela inteira de medição com a camada no ar, para o número de quadros ser do regime.
  await pagina.waitForTimeout(2500);
  return (await envio(pagina)).camadas.find(c => c.camada === 'alta');
}

async function compartilhar(pagina, perfil, quadros) {
  await pagina.locator('#screenBtn').click();
  // Ficam na aba "Qualidade" do painel de compartilhar, fechada por padrão.
  await pagina.locator('#shareQuality').selectOption(perfil, { force: true });
  await pagina.locator('#shareFps').selectOption(String(quadros), { force: true });
  await pagina.locator('#audioPolicy').selectOption('none');
  await pagina.locator('#confirmScreenBtn').click();
  await pagina.waitForFunction(() => Boolean(screenStream));
}

async function assistir(pagina) {
  await pagina.waitForFunction(() => [...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
  if (!await pagina.evaluate(() => [...peers.values()].find(p => p.state?.screen).assistindo)) await pagina.locator('.participant-tela .assistir-btn').first().click();
}

async function pararDeCompartilhar(pagina, ...quemAssiste) {
  await pagina.locator('#screenBtn').click();
  await pagina.waitForFunction(() => !screenStream && !telaPelaPlaca.estadoDoEnvio());
  for (const outra of quemAssiste) await outra.waitForFunction(() => ![...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
}

// O que chega a quem assiste, pelo RTP: o tamanho decodificado e os quadros por segundo.
const recebido = pagina => pagina.evaluate(async () => {
  const publicacao = [...peers.values()].flatMap(p => [...p.publicacoes.values()]).find(p => RoomTransport.fonteDaPublicacao(p) === 'screen');
  let r = null;
  (await publicacao?.track?.getRTCStatsReport?.())?.forEach(s => {
    if (s.type === 'inbound-rtp' && s.kind === 'video' && s.framesDecoded) r = { largura: s.frameWidth, altura: s.frameHeight, fps: s.framesPerSecond || 0, congelamentos: s.freezeCount || 0 };
  });
  return r;
});

(async () => {
  try {
    navegador = await chromium.launch({ channel: 'chrome', headless: true, args: [
      '--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist',
      '--use-fake-device-for-media-stream=fps=60', '--use-fake-ui-for-media-stream',
      `--auto-select-tab-capture-source-by-title=${ABA_PARADA}`
    ] });
  } catch (erro) {
    console.log(`SKIP: o Chrome não está instalado nesta máquina (${erro.message.split('\n')[0]}).`);
    return;
  }
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(porta) } });

  const contextoAna = await navegador.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
  await capturaQueRespeitaRestricoes(contextoAna);
  const ana = await entrar(contextoAna, 'Ana');
  const capacidade = await ana.evaluate(async () => ({ envio: await NexoTelaCodificador.sondarEnvio(), placaPeloRtp: Boolean(telaPelaPlaca) }));
  const versao = await ana.evaluate(() => transporte.sala.serverInfo?.version || '');
  console.log(`Chrome ${await navegador.version()} · servidor de mídia ${versao} · envio ${JSON.stringify(capacidade.envio)}`);
  if (!capacidade.envio?.h264Hardware) { console.log('SKIP: este Chrome não codifica H.264 pela placa de vídeo nesta máquina.'); return; }
  assert.ok(capacidade.placaPeloRtp, 'este Chrome troca o conteúdo dos quadros do RTP (RTCRtpScriptTransform)');
  // Uma janela de 1440x900 põe o palco grande o bastante para o servidor mandar a camada cheia.
  const bia = await entrar(await navegador.newContext({ viewport: { width: 1440, height: 900 } }), 'Bia');
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana'), null, { timeout: 20000 });

  for (const [perfil, altura] of PERFIS) {
    for (const quadros of [30, 60]) {
      const rotulo = `${altura}p${quadros}`;
      await compartilhar(ana, perfil, quadros);
      await assistir(bia);
      const cheia = await esperarCamadaCheia(ana, rotulo);
      // Quem assiste recebe o que a placa produziu, e não a miniatura do codificador do WebRTC.
      await bia.waitForFunction(h => stageVideo.videoHeight === h, cheia.altura, { timeout: 15000 })
        .catch(async erro => { console.error(`${rotulo}: palco =`, await bia.evaluate(() => `${stageVideo.videoWidth}×${stageVideo.videoHeight}`)); throw erro; });
      await bia.waitForTimeout(2000);
      const chegou = await recebido(bia);
      const faixaDeDados = await ana.evaluate(() => transporte.telaWebCodecs?.estadoDoEnvio()?.modo ?? 'desligada');
      console.log(`  ${rotulo.padEnd(8)} → ${cheia.largura}×${cheia.altura} a ${Math.round(cheia.fps)}/${cheia.quadrosAlvo} fps, ${(cheia.bps / 1e6).toFixed(1)} Mbps,`
        + ` ${cheia.hardware ? 'PLACA' : 'processador'}, ${cheia.codec}, taxa ${cheia.taxaDeclarada ? 'declarada' : 'não declarada'}, ${cheia.msDeCodificacao?.toFixed(1)} ms na placa`
        + ` · quem assiste: ${chegou?.largura}×${chegou?.altura} a ${Math.round(chegou?.fps || 0)} fps pelo RTP · faixa de dados: ${faixaDeDados}`);
      assert.equal(cheia.hardware, true, `${rotulo}: a imagem cheia sai pela placa de vídeo`);
      assert.equal(cheia.altura, altura, `${rotulo}: no tamanho pedido`);
      assert.equal(cheia.quadrosAlvo, quadros, `${rotulo}: na taxa pedida`);
      // A captura sintética em canvas não sustenta 60 exatos; o que se confere é que os quadros
      // não caíram para a metade, que é o sintoma de um codificador que não acompanha.
      assert.ok(cheia.fps >= quadros * 0.6, `${rotulo}: ${cheia.fps.toFixed(1)} quadros por segundo saindo`);
      assert.equal(chegou?.altura, altura, `${rotulo}: quem assiste recebe ${altura}p pelo RTP`);
      assert.ok(chegou.fps >= quadros * 0.5, `${rotulo}: e ${Math.round(chegou.fps)} quadros por segundo chegando`);
      assert.notEqual(faixaDeDados, 'webcodecs', `${rotulo}: a faixa de dados fica desligada`);
      await pararDeCompartilhar(ana, bia);
    }
  }
  console.log('PASS: todas as combinações saem pela placa de vídeo e chegam pelo RTP no tamanho e na taxa pedidos');

  // ---------- Troca de qualidade no meio da transmissão ----------
  // De 1080p a 30 para 1440p a 60 sem parar: a transmissão é republicada, e a placa tem de ser
  // escolhida de novo para o pedido novo (a taxa declarada no tamanho antigo seria recusada).
  await compartilhar(ana, 'high', 30);
  await assistir(bia);
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
    const e = telaPelaPlaca.estadoDoEnvio();
    const cheia = e?.camadas.find(c => c.camada === 'alta');
    return cheia && cheia.quadrosAlvo === 60 && cheia.altura === Math.min(1440, e.fonte.altura) && cheia.fps > 0;
  }, null, { timeout: 30000 }).catch(async erro => { console.error('troca: envio =', JSON.stringify(await envio(ana))); throw erro; });
  await ana.waitForTimeout(2500);
  const trocada = (await envio(ana)).camadas.find(c => c.camada === 'alta');
  assert.equal(trocada.hardware, true);
  assert.ok(trocada.fps > 0, 'e os quadros continuam saindo');
  console.log(`PASS: trocar de 1080p30 para 1440p60 no meio da transmissão continua na placa (${trocada.largura}×${trocada.altura} a ${trocada.quadrosAlvo} pedidos, taxa ${trocada.taxaDeclarada ? 'declarada' : 'não declarada'})`);
  await pararDeCompartilhar(ana, bia);

  // ---------- Uma fonte com poucos buffers ----------
  // A captura de tela de verdade, como a câmera, entrega quadros de um conjunto pequeno de
  // buffers. O Worker que guardava 20 quadros esgotava o conjunto: chegavam 3 quadros e a captura
  // parava de vez -- quem assiste ficava sem imagem --, e o canvas das seções acima, sem esse
  // limite, passava.
  await ana.evaluate(() => { window.fonteDoTeste = 'camera'; });
  await compartilhar(ana, 'high', 60);
  await assistir(bia);
  const daCamera = await esperarCamadaCheia(ana, 'câmera');
  await bia.waitForFunction(() => stageVideo.videoHeight === 1080, null, { timeout: 15000 })
    .catch(async erro => { console.error('câmera: envio =', JSON.stringify(await envio(ana))); throw erro; });
  await bia.waitForTimeout(2000);
  const chegouDaCamera = await recebido(bia);
  const capturaDaCamera = (await envio(ana))?.capturaFps ?? 0;
  console.log(`  câmera   → captura a ${Math.round(capturaDaCamera)} fps, camada cheia a ${Math.round(daCamera.fps)} fps · quem assiste: ${chegouDaCamera?.altura}p a ${Math.round(chegouDaCamera?.fps || 0)} fps`);
  // A captura primeiro: quadros saindo sem captura chegando são a mesma imagem repetida.
  assert.ok(capturaDaCamera >= 30, `câmera: ${capturaDaCamera.toFixed(1)} quadros por segundo chegando da captura ao Worker`);
  assert.ok(daCamera.fps >= 30, `câmera: ${daCamera.fps.toFixed(1)} quadros por segundo saindo da placa`);
  assert.ok(chegouDaCamera?.fps >= 30, `câmera: ${Math.round(chegouDaCamera?.fps || 0)} quadros por segundo chegando`);
  console.log('PASS: uma fonte com poucos buffers (a câmera) não para de entregar quadros');
  await pararDeCompartilhar(ana, bia);

  // ---------- Tela parada, e alguém chega depois ----------
  // A captura só entrega quadro quando algo muda. Quem chega com a tela parada pede um
  // quadro-chave, e o Worker precisa ter uma imagem para codificar -- e não descartar o pedido.
  const aba = await (await navegador.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await aba.setContent(`<title>${ABA_PARADA}</title><body style="margin:0;background:#234;color:#eee;font:64px sans-serif;padding:80px">Uma tela em que nada se mexe</body>`);
  await ana.evaluate(() => { window.fonteDoTeste = 'aba'; });
  await compartilhar(ana, 'high', 30);
  await assistir(bia);
  await bia.waitForFunction(() => stageVideo.videoHeight === 1080, null, { timeout: 15000 });
  await ana.waitForTimeout(3000);
  const caio = await entrar(await navegador.newContext({ viewport: { width: 1440, height: 900 } }), 'Caio');
  await assistir(caio);
  await caio.waitForFunction(() => stageVideo.videoHeight === 1080, null, { timeout: 15000 })
    .catch(async erro => { console.error('tela parada: palco de Caio =', await caio.evaluate(() => `${stageVideo.videoWidth}×${stageVideo.videoHeight}`), '· envio =', JSON.stringify(await envio(ana))); throw erro; });
  const parada = (await envio(ana))?.camadas.find(c => c.camada === 'alta');
  console.log(`PASS: com a tela parada há 3 s, quem chega depois vê a imagem (${parada ? `${parada.repetidos} repetições e ${parada.chaves} quadros-chave na última janela` : 'camada sem quadros na última janela'})`);
  console.log('Tela pela placa de vídeo, pelo RTP: tudo certo.');
})().catch(erro => {
  console.error(erro);
  console.error('eventos da tela:\n' + eventos.slice(-30).join('\n'));
  console.error(instancia?.erros?.());
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
