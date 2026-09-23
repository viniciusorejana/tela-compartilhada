// O teto do plano com mídia de verdade: servidor de mídia, webhook assinada e WebRTC entre
// dois navegadores. O que só existe aqui é o caminho inteiro -- a publicação chega ao servidor
// de mídia, a webhook traz a resolução, o servidor avisa, espera e desliga a faixa.
//
// A captura é sintética e RESPEITA as restrições pedidas, como o getDisplayMedia de verdade:
// é isso que faz o cliente honesto publicar dentro do plano sozinho.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const port = 3223;
const origin = `http://localhost:${port}`;
const SALA = 'teto-do-plano';
const saida = path.join(__dirname, '..', 'test-results', 'planos');
fs.mkdirSync(saida, { recursive: true });
let instancia, browser;

async function capturaQueRespeitaRestricoes(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const limite = (restricao, padrao) => Math.min(padrao, Number(restricao?.max || restricao?.ideal || restricao) || padrao);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async pedido => {
      const canvas = document.createElement('canvas');
      canvas.width = limite(pedido?.video?.width, 1920);
      canvas.height = limite(pedido?.video?.height, 1080);
      const ctx = canvas.getContext('2d');
      let quadro = 0;
      const timer = setInterval(() => { ctx.fillStyle = '#493b83'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#eee'; ctx.fillRect(40 + (++quadro % 300), 60, 120, 80); }, 66);
      const fluxo = canvas.captureStream(15);
      fluxo.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return fluxo;
    } });
  });
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => console.error(`erro na página de ${nome}:`, erro.message));
  await pagina.goto(`${origin}/${SALA}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

async function compartilhar(pagina) {
  await pagina.locator('#screenBtn').click();
  await pagina.locator('#audioPolicy').selectOption('none');
  await pagina.locator('#confirmScreenBtn').click();
  await pagina.waitForFunction(() => Boolean(screenStream) && Boolean(publicacoesLocais.screen), null, { timeout: 20000 });
}

(async () => {
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(port), NEXO_PLANOS: '1', NEXO_ESPERA_TETO_MS: '1500' } });
  instancia.filho.stderr.on('data', pedaco => process.stderr.write(pedaco));
  browser = await chromium.launch({ headless: true });
  const contextoDaAna = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await capturaQueRespeitaRestricoes(contextoDaAna);
  const ana = await entrar(contextoDaAna, 'Ana');
  const bia = await entrar(await browser.newContext({ viewport: { width: 1280, height: 860 } }), 'Bia');

  // ---------- O cadeado: sem conta, 720p a 30 quadros ----------
  const opcoes = await ana.evaluate(() => [...document.querySelectorAll('#videoQuality option, #videoFps option')].map(o => ({ valor: o.value, desligada: o.disabled, texto: o.textContent })));
  assert.deepEqual(opcoes.filter(o => o.desligada).map(o => o.valor).sort(), ['60', 'high', 'ultra']);
  assert.ok(opcoes.filter(o => o.desligada).every(o => o.texto.startsWith('🔒')), 'o que o plano não libera aparece com cadeado, e não some');
  await ana.locator('#devicesBtn').click();
  await ana.locator('#abaQualidade').click();
  await ana.locator('#painelQualidade').waitFor();
  await ana.locator('#painelQualidade [data-plano-dica]').waitFor();
  await ana.waitForTimeout(400);
  await ana.screenshot({ path: path.join(saida, 'cadeado-no-seletor.png') });
  await ana.keyboard.press('Escape');

  // ---------- O cliente honesto publica dentro do plano, e fica ----------
  await compartilhar(ana);
  assert.deepEqual(await ana.evaluate(() => { const s = screenStream.getVideoTracks()[0].getSettings(); return [s.width, s.height]; }), [1280, 720]);
  await bia.waitForTimeout(4000);
  assert.ok(await ana.evaluate(() => Boolean(screenStream)), 'a tela dentro do plano não cai');
  await ana.evaluate(() => pararTela());
  await ana.waitForFunction(() => !screenStream && !publicacoesLocais.screen, null, { timeout: 15000 });
  console.log('PASS: sem conta, o seletor mostra o cadeado e a tela sobe em 720p, e fica');

  // ---------- Um cliente desatualizado passa do teto: aviso, espera, e a tela cai ----------
  // O desatualizado é simulado tirando a trava do cliente e ignorando o aviso -- o servidor não
  // tem como saber a diferença, e é justamente isso que ele confere.
  await ana.evaluate(() => {
    nivelDoPlano = 'premium'; perfilDeQualidade = 'high';
    socket.off('limite-do-plano');
    socket.on('limite-do-plano', () => { window.avisoDoPlano = true; });
  });
  await compartilhar(ana);
  assert.deepEqual(await ana.evaluate(() => { const s = screenStream.getVideoTracks()[0].getSettings(); return [s.width, s.height]; }), [1920, 1080]);
  await ana.waitForFunction(() => window.avisoDoPlano === true, null, { timeout: 20000 });
  await ana.waitForFunction(() => !screenStream, null, { timeout: 20000 });
  const status = await ana.locator('#status').textContent();
  assert.match(status, /desligada/, `a pessoa precisa saber por que a tela caiu: ${status}`);
  assert.equal(await ana.evaluate(() => nivelDoPlano), 'anonimo', 'o aviso devolve o plano de verdade ao cliente');
  // A tela caiu; a pessoa, não.
  assert.ok(await ana.evaluate(() => socket.connected && transporte.sala.state === 'connected'));
  await ana.screenshot({ path: path.join(saida, 'tela-desligada.png') });
  console.log('PASS: acima do plano, o servidor avisa, espera e desliga só a tela');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await instancia?.encerrar();
});
