// Tema claro e escuro, temas prontos, cores exatas do premium e o que a sala lembra entre uma
// entrada e outra (rascunho, chat fechado, última seção das configurações). Sem servidor de
// mídia: nada aqui passa por ele.
//
//   npm run test:aparencia
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3231;
const origem = `http://localhost:${porta}`;
const sala = 'squad-aparencia';
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

const cor = (pagina, nome) => pagina.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), nome);

(async () => {
  // Com os planos ligados: é assim que a cor exata fica só para o premium (com eles desligados,
  // o padrão dos testes, ela é de todo mundo).
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta), NEXO_PLANOS: '1' } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await entrar(pagina);

  // ---------- Tema ----------
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.modo), 'escuro', 'o padrão é o escuro de sempre');
  assert.equal(await cor(pagina, '--bg'), '#191a24');
  await pagina.evaluate(() => NexoConfig.abrir('aparencia'));
  await pagina.locator('#painelAparencia').waitFor({ state: 'visible' });
  assert.equal(await pagina.locator('.tema-cartao').count(), 8, 'oito temas prontos, cada um com a própria miniatura');
  await pagina.locator('.segmentado label', { hasText: 'Claro' }).click();
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.modo), 'claro');
  assert.ok(await pagina.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return NexoTema.contraste(css.getPropertyValue('--text').trim(), css.getPropertyValue('--bg-1').trim()) >= 7 && css.getPropertyValue('--bg-1').trim() > '#e';
  }), 'o fundo clareia e o texto escurece, com contraste de sobra');
  // O palco é vídeo: continua escuro no tema claro, com o texto claro por cima.
  assert.equal(await pagina.evaluate(() => getComputedStyle(document.getElementById('stage')).getPropertyValue('--tinta').trim()), '255 255 255', 'o palco segue escuro');
  assert.equal(await pagina.evaluate(() => getComputedStyle(document.getElementById('stageEmptyTitle')).color), 'rgb(238, 238, 245)');

  // Um tema pronto traz o modo e a cor dele.
  await pagina.locator('.tema-cartao', { hasText: 'Floresta' }).click();
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), 'floresta');
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.modo), 'escuro', 'o Floresta é escuro');
  assert.equal(await cor(pagina, '--accent'), '#3fc98f');
  // Uma das oito cores troca só o destaque.
  await pagina.locator('.destaque-opcao[title="Coral"]').click();
  assert.equal(await cor(pagina, '--accent'), '#f2735f');
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), 'floresta', 'o fundo continua o do tema');

  // ---------- Cores exatas: do premium ----------
  // O servidor de teste tem os planos ligados, e quem entrou não tem conta.
  assert.equal(await pagina.locator('#corExataDestaque').isDisabled(), true);
  assert.equal(await pagina.locator('#coresExatasSelo').isVisible(), true, 'o selo diz de quem é o recurso');
  await pagina.evaluate(() => aplicarPlano({ nivel: 'premium' }));
  assert.equal(await pagina.locator('#corExataDestaque').isDisabled(), false, 'com o premium, libera na hora');
  assert.equal(await pagina.locator('#coresExatasSelo').isVisible(), false);
  await pagina.locator('#corExataDestaque').evaluate(el => { el.value = '#ff8800'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await cor(pagina, '--accent'), '#ff8800', 'a cor exata é a que aparece');
  assert.equal(await pagina.locator('#corExataDestaqueHex').textContent(), '#FF8800');
  // O plano vence: a cor sai da tela, mas fica guardada.
  await pagina.evaluate(() => aplicarPlano({ nivel: 'gratis' }));
  assert.equal(await cor(pagina, '--accent'), '#f2735f', 'sem o premium, vale a cor de um clique');
  assert.match(await pagina.locator('#coresExatasDica').textContent(), /guardadas/);
  await pagina.evaluate(() => aplicarPlano({ nivel: 'premium' }));
  assert.equal(await cor(pagina, '--accent'), '#ff8800', 'e volta sozinha com o plano');

  // ---------- O que a sala lembra ----------
  await pagina.locator('.aba', { hasText: 'Sons' }).click();
  await pagina.locator('#devicesClose').click();
  await pagina.locator('#chatInput').fill('meia frase que ainda não');
  await pagina.locator('#chatInput').dispatchEvent('input');
  await pagina.evaluate(() => fecharChat());
  await pagina.waitForTimeout(500);

  await pagina.reload();
  // O tema vale antes da primeira pintura: tema.js roda no <head>.
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), 'floresta');
  // O premium acima foi só simulado na página; o servidor diz que esta pessoa não tem conta, e é
  // ele quem manda: a cor exata sai da tela -- e continua guardada para quando o plano vier.
  await pagina.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#f2735f');
  assert.equal(await pagina.evaluate(() => JSON.parse(localStorage.getItem('nexo.pref.aparencia')).cores.destaque), '#ff8800');
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await pagina.evaluate(() => document.querySelector('.app').classList.contains('sem-chat')), true, 'o chat fechado continua fechado');
  await pagina.evaluate(() => abrirChat());
  assert.equal(await pagina.locator('#chatInput').inputValue(), 'meia frase que ainda não', 'o rascunho sobreviveu ao F5');
  await pagina.locator('#chatInput').press('Enter');
  await pagina.waitForTimeout(500);
  assert.equal(await pagina.evaluate(() => Preferencias.daSala(roomCode, 'rascunho', '')), null, 'mensagem enviada não é rascunho');
  await pagina.locator('button.config-engrenagem').click();
  assert.equal(await pagina.locator('#abaSons').getAttribute('aria-selected'), 'true', 'as configurações abrem onde a pessoa estava');

  console.log('PASS: tema claro e escuro, temas prontos, cores exatas do premium e o que a sala lembra');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
