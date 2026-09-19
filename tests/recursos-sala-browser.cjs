// Fluxos de produto que cruzam HTTP, Socket.IO e interface: chat rico, presença e sala
// trancada. Roda sem servidor de mídia; assim o teste observa exatamente a camada que
// implementa estes recursos e termina rápido.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3222;
const origem = `http://localhost:${porta}`;
const sala = 'recursos-sala';
let instancia, servidor, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  return pagina;
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  servidor = instancia.filho;
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contextoA = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const contextoB = await navegador.newContext({ viewport: { width: 390, height: 780 } });
  const dono = await entrar(contextoA, 'Dono');
  const convidado = await entrar(contextoB, 'Convidado');

  await dono.locator('#chatInput').fill('Olá @Convidado');
  await dono.locator('#chatSend').click();
  await convidado.waitForFunction(() => [...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes('Olá @Convidado')));
  assert.equal(await convidado.locator('.msg.mencionou').count(), 1);

  await convidado.locator('#chatToggle').click();
  await convidado.locator('[data-chat-action="reagir"][data-emoji="👍"]').first().click();
  await dono.waitForFunction(() => document.querySelector('.msg-reactions')?.textContent.includes('👍 1'));
  await convidado.locator('[data-chat-action="responder"]').first().click();
  await convidado.locator('#chatInput').fill('Recebido!');
  await convidado.locator('#chatSend').click();
  await dono.waitForFunction(() => document.querySelector('.msg-reply')?.textContent.includes('Dono'));
  convidado.once('dialog', dialogo => dialogo.accept());
  await convidado.locator('.msg').filter({ hasText: 'Recebido!' }).locator('[data-chat-action="excluir"]').click();
  await dono.waitForFunction(() => ![...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes('Recebido!')));
  await dono.locator('.msg').hover();
  await dono.locator('[data-chat-action="editar"]').click();
  await dono.locator('#chatInput').fill('Mensagem editada');
  await dono.locator('#chatSend').click();
  await convidado.waitForFunction(() => document.querySelector('.msg-texto')?.textContent.includes('Mensagem editada'));
  await dono.locator('.msg').hover();
  await dono.locator('[data-chat-action="fixar"]').click();
  await convidado.waitForFunction(() => !document.getElementById('chatPinnedBar').hidden);

  await convidado.locator('#chatClose').click();
  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('#presenceBtn').click();
  await convidado.locator('[data-presence="hand"]').click();
  assert.equal(await convidado.evaluate(() => presencaLocal), 'hand');
  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('#presenceBtn').click();
  await convidado.locator('[data-reaction="👏"]').click();
  await dono.waitForFunction(() => document.getElementById('roomReactions').textContent.includes('👏 Convidado'));

  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('[data-action="devices"]').click();
  await convidado.locator('#abaQualidade').click();
  await convidado.locator('#dataSaver').check();
  assert.equal(await convidado.locator('.app.economia-dados').count(), 1);
  await convidado.locator('#abaAparelhos').click();
  await convidado.locator('#pushToTalk').check();
  assert.equal(await convidado.evaluate(() => pushToTalkAtivo), true);
  await convidado.locator('#devicesClose').click();
  assert.deepEqual(await convidado.evaluate(() => {
    const audio = document.createElement('audio'); document.body.append(audio);
    document.getElementById('deafenBtn').click(); const durante = audio.muted;
    document.getElementById('deafenBtn').click(); const depois = audio.muted; audio.remove();
    return { durante, depois };
  }), { durante: true, depois: false });
  await convidado.evaluate(() => document.getElementById('compactBtn').click());
  assert.equal(await convidado.locator('.app.compacto-local').count(), 1);
  await convidado.evaluate(() => document.getElementById('compactBtn').click());

  await dono.locator('#moderarSalaBtn').click();
  await dono.locator('#roomLocked').check();
  await dono.locator('#allowScreen').uncheck();
  await convidado.waitForFunction(() => document.getElementById('screenBtn').disabled);

  const aguardando = await contextoB.newPage();
  await aguardando.goto(`${origem}/${sala}/sala`);
  await aguardando.locator('#nameInput').fill('Pessoa nova');
  await aguardando.locator('#nameConfirmBtn').click();
  await aguardando.locator('#waitingPanel:not(.hidden)').waitFor({ timeout: 10000 });
  await dono.locator('.join-request').filter({ hasText: 'Pessoa nova' }).locator('button', { hasText: 'Aceitar' }).click();
  await aguardando.waitForFunction(() => tiles.has('self'), null, { timeout: 15000 });

  console.log('PASS: chat rico, presença, economia, compacto, permissões e aprovação de entrada');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
  if (servidor && servidor.exitCode === null) servidor.kill();
});
