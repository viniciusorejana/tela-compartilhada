// A apresentação e as novidades pela tela, com navegadores de verdade: abre sozinha uma vez, só
// fecha depois do tempo ou do fim, não volta depois de fechada -- nem em outro aparelho com a
// mesma conta --, e volta quando sai uma edição marcada para aparecer.
//
//   npm run test:novidades
//
// Cada contexto do Playwright é um navegador limpo: é assim que se simula "primeira vez" e
// "outro aparelho". As capturas ficam em test-results/novidades.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// O "lido" é o id da edição mais nova. Tirado da lista de verdade, e não escrito aqui: com um
// número fixo, publicar uma edição quebrava este teste -- a injetada colidia com a real.
const { EDICOES } = require('../public/novidades-edicoes.js');
const MAIS_NOVA = EDICOES[0].id;

const porta = 3233;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'novidades');
fs.mkdirSync(saida, { recursive: true });
const SENHA = 'pipoca no domingo a noite';
const erros = [];
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

// Para o que é assíncrono na página: um laço do lado do Node (waitForFunction não espera
// promessa -- ver a memória do projeto).
async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(mensagem);
}

async function novaPagina(contexto) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error('erro na página:', e.message); });
  return pagina;
}

// A entrada do modal dura ~0,5 s; antes disso a captura mostra a página através dele.
async function capturar(pagina, nome) {
  await pagina.waitForTimeout(700);
  await pagina.screenshot({ path: path.join(saida, `${nome}.png`) });
}

const aberto = pagina => pagina.evaluate(() => Boolean(document.querySelector('.nx-novidades') && !document.querySelector('.nx-novidades').hidden));
const estado = pagina => pagina.evaluate(() => window.NexoNovidades.estado());
const ajustesDaConta = pagina => pagina.evaluate(() => fetch('/api/conta/eu').then(r => r.json()).then(d => d.perfil?.ajustes || {}));

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta), NEXO_NOVIDADES: '1' } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });

  // ---------- Página inicial, primeira vez ----------
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const inicio = await novaPagina(contexto);
  await inicio.goto(origem);
  await inicio.locator('.nx-novidades:not([hidden])').waitFor({ timeout: 6000 });
  let e = await estado(inicio);
  assert.equal(e.aba, 'conheca', 'a primeira vez abre na apresentação');
  assert.equal(e.trancado, true, 'aberto sozinho, começa travado');
  assert.equal(await inicio.locator('.nx-nov-principal').isDisabled(), true);
  assert.match(await inicio.locator('.nx-nov-principal').textContent(), /Bora começar/);
  await inicio.keyboard.press('Escape');
  assert.equal(await aberto(inicio), true, 'Esc não fecha enquanto está travado');
  await capturar(inicio, 'inicio-desktop');

  // Os atalhos da sala não passam do modal; os da demonstração acendem.
  await inicio.keyboard.press('Control+Shift+KeyM');
  assert.equal(await inicio.locator('.nx-ctl[data-ctl="mic"]').getAttribute('aria-pressed'), 'true', 'Ctrl+Shift+M liga o microfone da demonstração');

  // Chegar ao fim destrava antes do tempo acabar.
  const antes = Date.now();
  await inicio.locator('#nx-fim .nx-fim-marca').scrollIntoViewIfNeeded();
  await esperarAte(async () => !(await inicio.locator('.nx-nov-principal').isDisabled()), 'chegar ao fim devia destravar');
  assert.ok(Date.now() - antes < 6000, 'destravou pelo fim, e não pelo tempo');
  await inicio.locator('.nx-nov-principal').click();
  assert.equal(await aberto(inicio), false);
  assert.equal(await inicio.evaluate(() => localStorage.getItem('nexo.pref.novidades')), String(MAIS_NOVA), 'fechar grava a edição mais nova como lida');

  await inicio.reload();
  await inicio.waitForTimeout(1500);
  assert.equal(await aberto(inicio), false, 'lida, não volta no F5');

  // O botão reabre, na lista de novidades e sem trava.
  await inicio.locator('.nav-novidades').click();
  await inicio.locator('.nx-novidades:not([hidden])').waitFor();
  e = await estado(inicio);
  assert.equal(e.aba, 'novidades');
  assert.equal(e.trancado, false, 'aberto pela pessoa, fecha quando ela quiser');
  assert.ok(await inicio.locator('.nx-edicao').count() >= 1);
  await capturar(inicio, 'novidades-desktop');
  // As demonstrações, uma captura por seção (para revisar o visual, não para afirmar).
  await inicio.locator('#nxAbaConheca').click();
  for (const secao of ['controles', 'palco', 'chat', 'jeito', 'mais']) {
    await inicio.evaluate(id => { const rolagem = document.querySelector('.nx-nov-rolagem'); rolagem.style.scrollBehavior = 'auto'; document.getElementById(`nx-${id}`).scrollIntoView({ block: 'start' }); }, secao);
    await capturar(inicio, `secao-${secao}`);
  }
  await inicio.keyboard.press('Escape');
  assert.equal(await aberto(inicio), false, 'destravado, o Esc fecha');
  await contexto.close();

  // ---------- A sala, primeira vez: sobre a tela de entrada ----------
  const contextoSala = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const sala = await novaPagina(contextoSala);
  await sala.goto(`${origem}/squad-novidades/sala`);
  await sala.locator('.nx-novidades:not([hidden])').waitFor({ timeout: 6000 });
  assert.equal(await sala.evaluate(() => !document.getElementById('nameGate').classList.contains('hidden')), true, 'abre com a tela de entrada atrás');
  assert.match(await sala.locator('.nx-nov-principal').textContent(), /Bora para a sala/);
  await capturar(sala, 'sala-entrada');
  // Sem rolar: destrava pelo tempo (8 s na primeira vez).
  await esperarAte(async () => !(await sala.locator('.nx-nov-principal').isDisabled()), 'o tempo devia destravar', 12000);
  await sala.locator('.nx-nov-principal').click();
  assert.equal(await sala.evaluate(() => document.activeElement?.id), 'nameInput', 'fechado, o foco vai para o nome');
  await sala.locator('#nameInput').fill('Bia');
  await sala.locator('#nameConfirmBtn').click();
  await sala.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await sala.evaluate(() => document.querySelector('.app').inert), false, 'a sala não fica congelada depois do modal');
  // O botão da barra lateral reabre dentro da sala.
  await sala.locator('.novidades-da-sala').click();
  await sala.locator('.nx-novidades:not([hidden])').waitFor();
  await sala.keyboard.press('Escape');
  assert.equal(await aberto(sala), false);
  await contextoSala.close();

  // ---------- Com conta: lido num aparelho, lido em todos ----------
  const aparelhoA = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await novaPagina(aparelhoA);
  await a.goto(`${origem}/conta`);
  const cadastro = await a.evaluate(senha => fetch('/api/conta/cadastrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'leitora', apelido: 'Leitora', senha }) }).then(r => r.status), SENHA);
  assert.equal(cadastro, 201);
  await a.goto(origem);
  await a.locator('.nx-novidades:not([hidden])').waitFor({ timeout: 6000 });
  await a.evaluate(() => window.NexoNovidades.destravar());
  await a.locator('.nx-nov-principal').click();
  await esperarAte(async () => (await ajustesDaConta(a)).novidades === MAIS_NOVA, 'o "lido" devia subir para a conta');

  const aparelhoB = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await novaPagina(aparelhoB);
  await b.goto(`${origem}/conta`);
  const entrada = await b.evaluate(senha => fetch('/api/conta/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'leitora', senha }) }).then(r => r.status), SENHA);
  assert.equal(entrada, 200);
  await b.goto(origem);
  await b.waitForTimeout(2000);
  assert.equal(await aberto(b), false, 'o outro aparelho sabe que já foi lido');
  assert.equal(await b.evaluate(() => localStorage.getItem('nexo.pref.novidades')), String(MAIS_NOVA), 'e guarda também no navegador');

  // ---------- Uma edição nova, marcada para aparecer ----------
  const real = fs.readFileSync(path.join(__dirname, '..', 'public', 'novidades-edicoes.js'), 'utf8');
  const comNova = real.replace('const EDICOES = Object.freeze([', `const EDICOES = Object.freeze([ { id: ${MAIS_NOVA + 1}, data: '2099-01-01', titulo: 'Edição de teste', resumo: 'Algo novo.', aparecer: true, itens: [{ icone: 'brilho', titulo: 'Novo', texto: 'Uma coisa nova.' }] },`);
  assert.notEqual(comNova, real, 'o teste precisa conseguir injetar a edição');
  await b.route('**/novidades-edicoes.js', rota => rota.fulfill({ status: 200, contentType: 'application/javascript', body: comNova }));
  await b.reload();
  await b.locator('.nx-novidades:not([hidden])').waitFor({ timeout: 6000 });
  e = await estado(b);
  assert.equal(e.aba, 'novidades', 'quem já conhece o Nexo recebe a lista, não a apresentação');
  assert.equal(await b.locator('.nx-edicao.nao-lida').count(), 1, 'só a edição nova leva o selo');
  assert.equal(await b.locator('.nx-nov-contagem').textContent(), '1');
  await b.evaluate(() => window.NexoNovidades.destravar());
  await b.locator('.nx-nov-principal').click();
  await esperarAte(async () => (await ajustesDaConta(b)).novidades === MAIS_NOVA + 1, 'a edição nova devia ficar lida na conta');
  await aparelhoA.close();
  await aparelhoB.close();

  // ---------- Tema claro e celular ----------
  const celular = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const c = await novaPagina(celular);
  await c.addInitScript(() => localStorage.setItem('nexo.pref.aparencia', JSON.stringify({ modo: 'claro' })));
  await c.goto(origem);
  await c.locator('.nx-novidades:not([hidden])').waitFor({ timeout: 6000 });
  const medidas = await c.evaluate(() => {
    const janela = document.querySelector('.nx-nov-janela');
    const rolagem = document.querySelector('.nx-nov-rolagem');
    const [r, g, b] = getComputedStyle(janela).backgroundColor.match(/\d+/g).map(Number);
    // offsetWidth, e não o retângulo: a entrada tem uma mola que passa do ponto por um instante.
    return { largura: janela.offsetWidth, sobra: rolagem.scrollWidth - rolagem.clientWidth, claro: (r + g + b) / 3 > 200 };
  });
  assert.equal(medidas.largura, 390, 'no celular, a tela inteira');
  assert.ok(medidas.sobra <= 0, `nada rola para o lado (sobra ${medidas.sobra}px)`);
  assert.equal(medidas.claro, true, 'no tema claro, o modal é claro');
  await c.screenshot({ path: path.join(saida, 'inicio-celular-claro.png') });
  await c.locator('#nx-palco').scrollIntoViewIfNeeded();
  await c.screenshot({ path: path.join(saida, 'palco-celular-claro.png') });
  await celular.close();

  assert.deepEqual(erros, [], 'nenhum erro de página');
  console.log('PASS: apresentação e novidades abrem uma vez, travam, persistem por conta e voltam com edição nova');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
