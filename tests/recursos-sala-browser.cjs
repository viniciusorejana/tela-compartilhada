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
  const contextoB = await navegador.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const dono = await entrar(contextoA, 'Dono');
  const convidado = await entrar(contextoB, 'Convidado');
  assert.equal(await dono.locator('#dataSaverField').isHidden(), true);

  await dono.locator('#chatInput').fill('Olá @Convidado');
  await dono.locator('#chatSend').click();
  await convidado.waitForFunction(() => [...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes('Olá @Convidado')));
  assert.equal(await convidado.locator('.msg.mencionou').count(), 1);

  await convidado.locator('#chatToggle').click();
  assert.ok(await convidado.locator('#chatInput').evaluate(el => el.getBoundingClientRect().height < 80));
  await convidado.locator('#chatInput').click();
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');
  await convidado.evaluate(() => window.NexoMusica.abrir());
  assert.ok(await convidado.locator('#musicaInput').evaluate(el => el.getBoundingClientRect().height < 80));
  await convidado.locator('#musicaInput').click();
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'musicaInput');
  await convidado.evaluate(() => window.abrirChat());
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
  await dono.waitForFunction(() => document.querySelector('.room-reaction')?.getAttribute('aria-label') === 'Convidado reagiu com 👏');

  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('[data-action="devices"]').click();
  await convidado.locator('#abaQualidade').click();
  await convidado.locator('#dataSaver').check();
  assert.equal(await convidado.locator('.app.economia-dados').count(), 1);
  assert.equal(await convidado.locator('#videoQuality').isEnabled(), true);
  await convidado.locator('#videoQuality').selectOption('high');
  await convidado.locator('#abaAparelhos').click();
  await convidado.locator('#pushToTalk').check();
  assert.equal(await convidado.evaluate(() => pushToTalkAtivo), true);
  assert.ok(await convidado.evaluate(() => pushToTalk.getBoundingClientRect().top < outDevice.getBoundingClientRect().top));
  await convidado.locator('#devicesClose').click();
  await convidado.evaluate(() => window.fecharChat());
  await convidado.locator('#deafenBtn').click();
  await convidado.evaluate(() => window.abrirChat());
  await convidado.locator('#chatInput').click();
  await convidado.locator('#chatInput').pressSequentially('chat continua com foco');
  await convidado.waitForTimeout(1100);
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');
  assert.equal(await convidado.locator('#chatInput').inputValue(), 'chat continua com foco');
  await convidado.locator('#chatInput').fill('');
  await convidado.evaluate(() => deafenBtn.click());

  // Reproduz a corrida entre o MutationObserver que fecha um modal e a pessoa
  // tocando no compositor logo em seguida. O retorno tardio não pode roubar o foco.
  await convidado.evaluate(() => {
    devicesPanel.classList.remove('hidden');
  });
  await convidado.locator('#devicesPanel:not(.hidden)').waitFor();
  await convidado.evaluate(() => {
    devicesPanel.classList.add('hidden');
    chatInput.focus();
  });
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');

  await convidado.evaluate(() => window.NexoMusica.fechar());
  await convidado.locator('#soundboardBtn').click();
  await convidado.locator('[data-close="soundboardPanel"]').click();
  await convidado.evaluate(() => window.NexoMusica.abrir());
  await convidado.locator('#musicaInput').click();
  await convidado.locator('#musicaInput').pressSequentially('pedido continua com foco');
  await convidado.waitForTimeout(1100);
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'musicaInput');
  assert.equal(await convidado.locator('#musicaInput').inputValue(), 'pedido continua com foco');
  await convidado.locator('#musicaInput').fill('');
  assert.deepEqual(await convidado.evaluate(() => {
    const audio = document.createElement('audio'); document.body.append(audio);
    document.getElementById('deafenBtn').click(); const durante = audio.muted;
    document.getElementById('deafenBtn').click(); const depois = audio.muted; audio.remove();
    return { durante, depois };
  }), { durante: true, depois: false });
  assert.notEqual(await convidado.locator('#deafenBtn').evaluate(el => getComputedStyle(el, '::before').webkitMaskImage), 'none');
  assert.equal(await convidado.locator('#compactBtn svg').count(), 1);
  await convidado.evaluate(() => document.getElementById('compactBtn').click());
  assert.equal(await convidado.locator('.app.compacto-local').count(), 1);
  await convidado.evaluate(() => document.getElementById('compactBtn').click());

  await dono.locator('#moderarSalaBtn').click();
  await dono.locator('#roomLocked').check();
  await dono.locator('#allowScreen').uncheck();
  await convidado.waitForFunction(() => document.getElementById('screenBtn').disabled);

  await dono.evaluate(() => { peers.set('pessoa-falsa', { id: 'pessoa-falsa', name: 'Pessoa', state: {}, pc: { connectionState: 'connected' } }); abrirModeracao('pessoa-falsa'); });
  assert.equal(await dono.locator('#roomSecurity').isHidden(), true);
  await dono.locator('#moderarPanel [data-close]').click();
  await dono.locator('#moderarSalaBtn').click();
  assert.equal(await dono.locator('#roomSecurity').isVisible(), true);
  await dono.locator('#moderarPanel [data-close]').click();

  const desistente = await contextoB.newPage();
  await desistente.goto(`${origem}/${sala}/sala`);
  await desistente.locator('#nameInput').fill('Desistente');
  await desistente.locator('#nameConfirmBtn').click();
  await desistente.locator('#waitingPanel:not(.hidden)').waitFor({ timeout: 10000 });
  await dono.waitForFunction(() => !document.getElementById('joinRequestNotice').hidden && [...document.querySelectorAll('.join-request')].some(el => el.textContent.includes('Desistente')));
  assert.ok(await dono.evaluate(() => {
    const aviso = joinRequestNotice.getBoundingClientRect();
    const botao = joinRequestNoticeOpen.getBoundingClientRect();
    return aviso.right - botao.right < 16;
  }));
  await dono.waitForFunction(() => document.getElementById('joinRequestNotice').hidden, null, { timeout: 9000 });
  assert.equal(await dono.locator('#joinRequestCount').isVisible(), true);
  await desistente.locator('#waitingCancel').click();
  await dono.waitForFunction(() => ![...document.querySelectorAll('.join-request')].some(el => el.textContent.includes('Desistente')) && document.getElementById('joinRequestNotice').hidden);

  const aguardando = await contextoB.newPage();
  await aguardando.goto(`${origem}/${sala}/sala`);
  await aguardando.locator('#nameInput').fill('Pessoa nova');
  await aguardando.locator('#nameConfirmBtn').click();
  await aguardando.locator('#waitingPanel:not(.hidden)').waitFor({ timeout: 10000 });
  await dono.waitForFunction(() => !document.getElementById('joinRequestNotice').hidden);
  await dono.locator('#joinRequestNoticeOpen').click();
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
