// O início de quem tem conta, no computador e no toque. A busca é um campo de verdade, com as
// sugestões caindo embaixo dele; e o balão de "Entrar numa sala pelo código" aguenta o teclado do
// celular. O teclado que sobe muda o tamanho da janela, e o `resize` fechava o balão -- com o
// campo e o teclado junto, antes de dar para digitar. Encolher a janela à mão é o mesmo evento.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3223;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'inicio');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

async function novaPagina(contexto) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error('erro na página:', e.message); });
  await pagina.goto(origem);
  await pagina.locator('#inicioApp').waitFor();
  await pagina.waitForFunction(() => NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });
  return pagina;
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anabusca', { apelido: 'Ana' });
  const bia = await instancia.conta('biabusca', { apelido: 'Bia Souza' });
  // Amigas como pela tela: uma pede, e o pedido de volta vira amizade.
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biabusca', 201], [bia, '@anabusca', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }

  navegador = await chromium.launch({ headless: true });
  const comConta = async opcoes => {
    const contexto = await navegador.newContext(opcoes);
    await contexto.addCookies([{ name: 'nexo_conta', value: ana.cookie.split('=')[1], url: origem }]);
    return contexto;
  };

  // ---------- No computador ----------
  const pc = await novaPagina(await comConta({ viewport: { width: 1280, height: 820 } }));
  const busca = pc.locator('#buscaCampo');
  const sugestoes = pc.locator('#buscaLista [role="option"]');
  assert.equal(await pc.locator('.ini-busca kbd').count(), 0, 'o "Ctrl K" saiu do campo');
  await busca.click();
  await pc.locator('#buscaLista:not([hidden])').waitFor();
  assert.deepEqual(await sugestoes.allTextContents(), ['Bia Souza'], 'o campo vazio já sugere os amigos');
  assert.equal(await busca.getAttribute('aria-activedescendant'), null, 'vazio, o Enter não escolhe ninguém');
  await busca.pressSequentially('bia');
  assert.equal(await busca.getAttribute('aria-activedescendant'), await sugestoes.first().getAttribute('id'), 'com algo digitado, o Enter leva à primeira');
  await busca.press('Enter');
  await pc.locator('#vistaConversa:not([hidden])').waitFor();
  assert.equal(await busca.inputValue(), '');
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);

  // Um código que não é amigo nem sala recente também leva à sala, e diz isso na lista.
  await busca.fill('#Sala Nova');
  assert.deepEqual(await sugestoes.allTextContents(), ['Entrar na sala #sala-nova']);
  await busca.press('Escape');
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);
  assert.equal(await busca.inputValue(), '#Sala Nova', 'o primeiro Esc só fecha a lista');
  await busca.press('ArrowDown');
  assert.equal(await pc.locator('#buscaLista').isVisible(), true, 'a seta reabre a lista');
  await busca.press('Escape');
  await busca.press('Escape');
  assert.equal(await busca.inputValue(), '', 'o segundo Esc apaga o que foi digitado');
  // Clicar fora fecha.
  await busca.click();
  await pc.locator('#buscaLista:not([hidden])').waitFor();
  await pc.locator('#iniCentro').click({ position: { x: 400, y: 400 } });
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);
  // O Ctrl K continua levando à busca, só não aparece escrito.
  await pc.evaluate(() => document.activeElement?.blur());
  await pc.keyboard.press('Control+K');
  assert.equal(await pc.evaluate(() => document.activeElement?.id), 'buscaCampo');
  assert.equal(await pc.locator('#buscaLista').isVisible(), true);
  await pc.close();

  // ---------- No celular: a busca e o "Entrar numa sala" moram na gaveta ----------
  const tel = await novaPagina(await comConta({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  }));
  const teclado = altura => tel.setViewportSize({ width: 390, height: altura });
  await tel.locator('#menuBtn').tap();
  await tel.locator('#buscaCampo').tap();
  await tel.locator('#buscaLista:not([hidden])').waitFor();
  assert.equal(await tel.locator('#buscaCampo').evaluate(el => getComputedStyle(el).fontSize), '16px', 'com menos, o iOS aproxima a página ao focar');
  await teclado(430);
  await tel.locator('#buscaCampo').pressSequentially('bia');
  assert.equal(await tel.evaluate(() => document.activeElement?.id), 'buscaCampo', 'o teclado que sobe não tira o foco da busca');
  assert.deepEqual(await tel.locator('#buscaLista [role="option"]').allTextContents(), ['Bia Souza']);
  await tel.waitForTimeout(250); // a lista entra com `nexo-surgir`: no meio dela, sai meio transparente
  await tel.screenshot({ path: path.join(saida, 'busca-celular.png') });
  await teclado(780);

  await tel.locator('#trilhoEntrar').tap();
  assert.equal(await tel.locator('#buscaLista').isHidden(), true, 'tocar fora fecha a lista da busca');
  const campo = tel.locator('#menuFlutuante:not([hidden]) input');
  await campo.waitFor();
  assert.equal(await campo.evaluate(el => document.activeElement === el && getComputedStyle(el).fontSize), '16px');
  await teclado(430);
  await tel.waitForTimeout(100);
  assert.equal(await tel.locator('#menuFlutuante').isVisible(), true, 'o teclado que sobe não fecha o balão');
  await tel.keyboard.type('Squad da Noite');
  assert.equal(await campo.inputValue(), 'Squad da Noite');
  const menu = await tel.locator('#menuFlutuante').boundingBox();
  assert.ok(menu.y >= 0 && menu.y + menu.height <= 430, 'e ele continua dentro da janela que sobrou');
  // O campo de 16 px alargava a coluna do balão, e o "Entrar" ficava cortado para fora dele.
  const cabeInteiro = async largura => {
    const caixa = await tel.locator('#menuFlutuante').boundingBox();
    const entrar = await tel.locator('#menuFlutuante button[type="submit"]').boundingBox();
    const rola = await tel.locator('#menuFlutuante').evaluate(el => el.scrollWidth - el.clientWidth);
    assert.ok(entrar.x >= caixa.x && entrar.x + entrar.width <= caixa.x + caixa.width - 4, `o "Entrar" cabe inteiro no balão em ${largura} px: ${JSON.stringify({ caixa, entrar })}`);
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura, `o balão cabe na tela de ${largura} px: ${JSON.stringify(caixa)}`);
    assert.equal(rola, 0, 'nada no balão passa da largura dele');
  };
  await cabeInteiro(390);
  await tel.screenshot({ path: path.join(saida, 'entrar-pelo-codigo-celular.png') });
  await tel.setViewportSize({ width: 320, height: 430 });
  await tel.waitForTimeout(100);
  await cabeInteiro(320);
  await tel.setViewportSize({ width: 390, height: 430 });
  await tel.locator('#menuFlutuante button[type="submit"]').tap();
  await tel.waitForURL('**/squad-da-noite/sala');

  assert.deepEqual(erros, []);
  console.log('PASS: a busca do início é um campo com sugestões embaixo (setas, Enter, Esc, Ctrl K), e no celular nem ela nem o balão de "Entrar numa sala" fecham com o teclado');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
