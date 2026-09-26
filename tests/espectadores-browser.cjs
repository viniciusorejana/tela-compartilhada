// Quem está vendo a tela, o som de entrar numa transmissão e a sugestão de "@", com duas
// pessoas de verdade numa sala com servidor de mídia. A tela é um canvas desenhado pela página.
//
//   npm run test:espectadores
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3229;
const origem = `http://localhost:${porta}`;
const sala = 'squad-espectadores';
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function telaSintetica(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const ctx = canvas.getContext('2d');
      let quadro = 0;
      setInterval(() => { ctx.fillStyle = '#284e75'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#eee'; ctx.fillRect(40 + (++quadro % 300), 200, 120, 80); }, 66);
      return canvas.captureStream(15);
    } });
  });
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  // Os avisos sonoros passam por um espião: o que importa é QUANDO a sala pede um som.
  await pagina.evaluate(() => {
    window.sonsPedidos = [];
    const tocar = NexoSons.tocar;
    NexoSons.tocar = (tipo, opcoes) => { sonsPedidos.push(tipo); return tocar(tipo, opcoes); };
  });
  return pagina;
}

(async () => {
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const contextoAna = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  await telaSintetica(contextoAna);
  const contextoBia = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const ana = await entrar(contextoAna, 'Ana');
  const bia = await entrar(contextoBia, 'Bia Souza');
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia Souza'), null, { timeout: 20000 });
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana'), null, { timeout: 20000 });

  // ---------- Sugestão de "@" ----------
  const campo = ana.locator('#chatInput');
  await campo.click();
  await campo.pressSequentially('Oi @bi');
  await ana.locator('#mencoesSugeridas').waitFor({ state: 'visible' });
  assert.deepEqual(await ana.locator('.mencao-opcao .mencao-nome').allTextContents(), ['Bia Souza'], 'sem acento nem maiúscula, "@bi" acha a Bia');
  assert.equal(await campo.getAttribute('aria-expanded'), 'true');
  await campo.press('Enter');
  assert.equal(await campo.inputValue(), 'Oi @Bia Souza ', 'Enter escolhe a pessoa e não envia');
  assert.equal(await ana.locator('#mencoesSugeridas').isHidden(), true);
  // Palavra do meio também acha, e Esc fecha só a lista.
  await campo.pressSequentially('e @sou');
  await ana.locator('#mencoesSugeridas').waitFor({ state: 'visible' });
  await campo.press('Escape');
  assert.equal(await ana.locator('#mencoesSugeridas').isHidden(), true);
  assert.equal(await ana.locator('#chatPanel').isVisible(), true, 'o Esc não fecha o chat junto');
  // "email@dominio" não é menção.
  await campo.fill('');
  await campo.pressSequentially('ana@bi');
  assert.equal(await ana.locator('#mencoesSugeridas').isHidden(), true);
  await campo.fill('Oi @Bia Souza, bora?');
  await campo.press('Enter');
  await bia.waitForFunction(() => document.querySelector('.msg .mencao-no-texto.eu')?.textContent === '@Bia Souza');
  assert.ok((await bia.evaluate(() => sonsPedidos)).includes('mencao'));

  // ---------- Entrar numa transmissão ----------
  await ana.locator('#screenBtn').click();
  await ana.locator('#audioPolicy').selectOption('none');
  await ana.locator('#confirmScreenBtn').click();
  await ana.waitForFunction(() => Boolean(screenStream));
  await bia.waitForFunction(() => [...peers.values()].some(p => p.state?.screen), null, { timeout: 20000 });
  await bia.evaluate(() => { sonsPedidos.length = 0; });
  await bia.locator('.participant-tela .assistir-btn').click();
  await bia.waitForFunction(() => sonsPedidos.includes('assistir'));

  // Quem transmite vê quem está vendo, no palco (a própria tela é o preenchimento dele).
  await ana.waitForFunction(() => !document.getElementById('stageEspectadores').hidden, null, { timeout: 15000 });
  const selo = ana.locator('#stageEspectadores');
  assert.match(await selo.getAttribute('aria-label'), /^1 pessoa vendo: Bia Souza$/);
  assert.equal((await selo.locator('.espectadores-conta').textContent()).trim(), '1');
  await selo.hover();
  assert.equal(await selo.locator('.espectadores-lista').isVisible(), true, 'os nomes aparecem ao passar o mouse');
  // E quem assiste vê a si mesmo no placar da tela que está no palco dele.
  await bia.waitForFunction(() => /Você/.test(document.getElementById('stageEspectadores').getAttribute('aria-label') || ''));

  // Na grade, cada tela tem o próprio placar -- e o do palco some, para não aparecer duas vezes.
  await ana.locator('#multiViewBtn').click();
  await ana.waitForFunction(() => document.querySelector('.multi-card .espectadores-card:not([hidden])'));
  assert.equal(await ana.locator('#stageEspectadores').isVisible(), false);
  await ana.locator('#multiViewBtn').click();

  // Parar de assistir tira a pessoa do placar, e o selo some de vez.
  await bia.locator('#stageStopBtn').click();
  await ana.waitForFunction(() => document.getElementById('stageEspectadores').hidden, null, { timeout: 15000 });
  // Voltar a assistir e sair da sala: o placar também esvazia.
  await bia.locator('.participant-tela .assistir-btn').click();
  await ana.waitForFunction(() => !document.getElementById('stageEspectadores').hidden, null, { timeout: 15000 });
  await bia.close();
  await ana.waitForFunction(() => document.getElementById('stageEspectadores').hidden, null, { timeout: 15000 });

  console.log('PASS: quem está vendo a tela, som de entrar na transmissão e sugestão de @');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
