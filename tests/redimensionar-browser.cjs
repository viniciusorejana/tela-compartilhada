// A largura do chat é de quem conversa: a alça na borda do painel arrasta, as setas andam, o duplo
// clique volta ao normal, e a escolha sobrevive ao F5. Vale na coluna (tela larga) e na gaveta
// (até 1100 px); no celular, onde o chat é a tela inteira, a alça não existe. Sem servidor de mídia.
//
//   npm run test:redimensionar
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3241;
const origem = `http://localhost:${porta}`;
const sala = 'squad-largura';
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function entrar(pagina) {
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
}

// A coluna desliza ao mudar (240 ms, `--dur-lenta`) quando o valor vem do teclado: mede-se quando
// duas leituras seguidas dão o mesmo número, e não no meio do deslize.
async function largura(pagina, seletor = '#chatPanel') {
  let anterior = -1;
  for (let i = 0; i < 30; i++) {
    const atual = await pagina.locator(seletor).evaluate(el => Math.round(el.getBoundingClientRect().width));
    if (atual === anterior) return atual;
    anterior = atual;
    await pagina.waitForTimeout(90);
  }
  return anterior;
}
const guardada = pagina => pagina.evaluate(() => localStorage.getItem('nexo.pref.chatLargura'));
const valor = (pagina, atributo) => pagina.locator('#chatAlca').getAttribute(atributo);

async function arrastar(pagina, de, ate) {
  const caixa = await pagina.locator('#chatAlca').boundingBox();
  const y = caixa.y + caixa.height / 2;
  await pagina.mouse.move(caixa.x + 4, y);
  await pagina.mouse.down();
  await pagina.mouse.move(caixa.x + 4 + (ate - de), y, { steps: 8 });
  await pagina.mouse.up();
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await entrar(pagina);

  // ---------- A coluna, na tela larga ----------
  assert.equal(await largura(pagina), 292, 'de fábrica, o chat é o que sempre foi');
  const alca = pagina.locator('#chatAlca');
  assert.equal(await alca.getAttribute('role'), 'separator', 'a alça é um separador de verdade, e não só uma faixa que reage ao mouse');
  assert.equal(await alca.getAttribute('tabindex'), '0', 'e se alcança pelo teclado');
  assert.deepEqual(
    [await valor(pagina, 'aria-valuemin'), await valor(pagina, 'aria-valuenow'), await valor(pagina, 'aria-valuemax')],
    ['240', '292', '720'], 'ela diz o tamanho de agora e até onde vai');

  await arrastar(pagina, 0, -100);
  assert.equal(await largura(pagina), 392, 'arrastar 100 px para a esquerda alarga o chat em 100 px');
  assert.equal(await guardada(pagina), '392', 'e a escolha é lembrada');
  assert.equal(await valor(pagina, 'aria-valuenow'), '392', 'e a alça anuncia o novo valor');
  const palco = await pagina.locator('.palco-area').evaluate(el => Math.round(el.getBoundingClientRect().width));
  assert.ok(palco > 400, `o palco continua com chão (${palco} px)`);
  assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('redimensionando')), false, 'soltar tira o estado de arrasto da página');

  // Os limites: nem fino demais, nem largo a ponto de engolir o palco.
  await arrastar(pagina, 0, -3000);
  assert.equal(await largura(pagina), 720, 'o teto do chat é 720 px');
  await arrastar(pagina, 0, 3000);
  assert.equal(await largura(pagina), 240, 'o piso é 240 px');

  // ---------- O teclado ----------
  await alca.focus();
  await pagina.keyboard.press('ArrowLeft');
  assert.equal(await largura(pagina), 256, 'a seta para a esquerda alarga o chat de 16 em 16');
  await pagina.keyboard.press('ArrowRight');
  await pagina.keyboard.press('ArrowRight');
  assert.equal(await largura(pagina), 240, 'a da direita estreita, e para no piso');
  await pagina.keyboard.press('Shift+ArrowLeft');
  assert.equal(await largura(pagina), 304, 'Shift anda de 64 em 64');
  await pagina.keyboard.press('End');
  assert.equal(await largura(pagina), 720);
  await pagina.keyboard.press('Home');
  assert.equal(await largura(pagina), 240);

  // ---------- Lembrar, e voltar ao normal ----------
  await pagina.keyboard.press('Shift+ArrowLeft');
  await pagina.keyboard.press('Shift+ArrowLeft');
  assert.equal(await largura(pagina), 368);
  await pagina.reload();
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await largura(pagina), 368, 'o F5 não desfaz a escolha');

  await alca.dblclick();
  assert.equal(await largura(pagina), 292, 'o duplo clique volta ao tamanho de fábrica');
  assert.equal(await guardada(pagina), null, 'e apaga a escolha, em vez de guardar o número de hoje');
  await pagina.keyboard.press('Shift+ArrowLeft');
  await alca.focus();
  await pagina.keyboard.press('Enter');
  assert.equal(await largura(pagina), 292, 'o Enter na alça também volta ao normal');

  // O que se escolheu vale com o chat fechado e aberto de novo.
  await alca.focus();
  await pagina.keyboard.press('Shift+ArrowLeft');
  await pagina.locator('#chatClose').click();
  await pagina.locator('#chatPanel').waitFor({ state: 'hidden' });
  await pagina.locator('#chatToggle').click();
  await pagina.locator('#chatPanel').waitFor({ state: 'visible' });
  await pagina.waitForTimeout(400);
  assert.equal(await largura(pagina), 356, 'fechar e abrir o chat não muda a largura escolhida');
  await alca.dblclick();

  // O canal de música divide a coluna com o chat: a alça dele mexe na mesma largura.
  assert.equal(await pagina.locator('#musicaAlca').getAttribute('aria-valuenow'), '292');

  // ---------- O chat em foco: ele já é a tela inteira ----------
  await pagina.locator('#chatFocusBtn').click();
  assert.equal(await alca.isVisible(), false, 'em foco, o chat ocupa a tela e não há alça');
  await pagina.locator('#chatFocusBtn').click();
  assert.equal(await alca.isVisible(), true);

  // ---------- A gaveta, até 1100 px ----------
  await pagina.setViewportSize({ width: 1000, height: 800 });
  // Abrir o chat na coluna já marcou o painel como aberto; só falta o botão se ele ainda não está.
  if (!(await pagina.locator('#chatPanel.aberto').count())) await pagina.locator('#chatToggle').click();
  await pagina.locator('#chatPanel.aberto').waitFor();
  await pagina.waitForTimeout(400);
  assert.equal(await largura(pagina), 360, 'a gaveta nasce com os 360 px de sempre');
  await arrastar(pagina, 0, -120);
  assert.equal(await largura(pagina), 480, 'a gaveta também se alarga pela alça');
  assert.equal(await guardada(pagina), '480');
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(400);
  assert.equal(await largura(pagina), 480, 'a escolha segue para a coluna quando a janela volta a ser larga');
  await alca.dblclick();

  // ---------- Janela que encolhe: a escolha não some, só cabe ----------
  await alca.focus();
  await pagina.keyboard.press('End');
  assert.equal(await largura(pagina), 720);
  await pagina.setViewportSize({ width: 1200, height: 800 });
  await pagina.waitForTimeout(400);
  const cabe = await largura(pagina);
  // A lateral toma o que a moldura manda para esta janela (208 px a 1200, mais os 64 do trilho para quem tem conta).
  const lateral = await pagina.locator('.room-sidebar').evaluate(el => Math.round(el.getBoundingClientRect().width));
  assert.ok(lateral >= 200, `a lateral está aberta (${lateral} px)`);
  assert.ok(cabe <= 1200 - lateral - 420 + 1 && cabe >= 240, `o chat cede para o palco ter chão (${cabe} px, com a lateral em ${lateral} px)`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(400);
  assert.equal(await largura(pagina), 720, 'e volta a ter o que se escolheu quando a janela alarga');
  await alca.dblclick();
  await pagina.close();

  // ---------- O celular: o chat é a tela inteira ----------
  const celular = await navegador.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const tel = await celular.newPage();
  tel.on('pageerror', erro => { throw erro; });
  await entrar(tel);
  assert.equal(await tel.locator('#chatAlca').isVisible(), false, 'no celular não há alça');

  console.log('PASS: a largura do chat se muda pela alça (mouse e teclado), é lembrada, volta ao normal e respeita o palco e a janela');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
