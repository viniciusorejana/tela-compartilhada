// O aplicativo Android visto pela sala: a ponte (nexoAndroid) é simulada aqui como o aplicativo a
// põe na página -- um objeto com postMessage e o evento "message", antes de qualquer script --, e o
// user agent traz "NexoAndroid/1.0.0", como o da WebView do aplicativo.
//
// O que se prova: a sala conta ao aplicativo que está numa chamada (é isso que liga o serviço que
// segura a voz com a tela apagada), com o microfone e o ensurdecer; os botões da notificação
// mexem no microfone e tiram a pessoa da sala; e o APK novo aparece como aviso de atualização.
// O lado nativo (android/) não roda aqui -- ele se prova num aparelho, como em docs/android.md.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const port = 3227;
const origin = `http://localhost:${port}`;
const SALA = 'sala-do-android';
const saida = path.join(__dirname, '..', 'test-results', 'android');
fs.mkdirSync(saida, { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 NexoAndroid/1.0.0';
let instancia, browser;

async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(mensagem);
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(port) } });
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, permissions: ['microphone'] });
  // O que a página manda ao aplicativo, guardado do lado do Node: sobrevive à navegação de "sair".
  const mensagens = [];
  await contexto.exposeFunction('mensagemParaOAplicativo', texto => { mensagens.push(JSON.parse(texto)); });
  await contexto.addInitScript(() => {
    const ponte = new EventTarget();
    ponte.postMessage = texto => window.mensagemParaOAplicativo(String(texto));
    window.nexoAndroid = ponte;
    // O aplicativo respondendo, como faria um botão da notificação.
    window.doAplicativo = dados => ponte.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(dados) }));
  });
  await contexto.route('**/api/desktop-app', rota => rota.fulfill({ json: { available: false, sistemas: [
    { chave: 'android', nome: 'Android', tipo: '.apk', familia: 'android', url: '/downloads/Nexo.apk', size: 1, builtAt: new Date().toISOString(), versao: '1.1.0' }
  ] } }));

  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw new Error(`erro na página: ${erro.message}`); });
  await pagina.goto(`${origin}/${SALA}/sala`);
  await pagina.evaluate(() => window.NexoConta?.pronto);
  if (!(await pagina.locator('#nameInput').evaluate(el => el.readOnly))) await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });

  // ---------- A chamada liga o serviço ----------
  const ultima = () => mensagens.filter(m => m.tipo === 'chamada').at(-1);
  await esperarAte(() => ultima()?.ativa === true, `a sala não contou que está numa chamada: ${JSON.stringify(mensagens)}`);
  assert.deepEqual(ultima(), { tipo: 'chamada', ativa: true, sala: SALA, microfone: false, ensurdecido: false });
  assert.equal(await pagina.evaluate(() => window.NexoAndroid.versao), '1.0.0');
  console.log('PASS: entrar na sala conta ao aplicativo que há uma chamada, em qual sala e com o microfone fechado');

  // ---------- O botão de microfone da notificação ----------
  await pagina.evaluate(() => doAplicativo({ tipo: 'alternar-microfone' }));
  await esperarAte(() => ultima()?.microfone === true, `o microfone ligado pela notificação não voltou para o aplicativo: ${JSON.stringify(ultima())}`);
  assert.equal(await pagina.evaluate(() => Boolean(micStream && !micMuted)), true, 'o microfone da sala abriu');
  await pagina.evaluate(() => doAplicativo({ tipo: 'alternar-microfone' }));
  await esperarAte(() => ultima()?.microfone === false, 'desligar pela notificação não chegou à sala');
  // Ensurdecer também aparece na notificação.
  await pagina.locator('#deafenBtn').click();
  await esperarAte(() => ultima()?.ensurdecido === true, 'ensurdecer não chegou ao aplicativo');
  await pagina.locator('#deafenBtn').click();
  await esperarAte(() => ultima()?.ensurdecido === false, 'voltar a ouvir não chegou ao aplicativo');
  // Mudança que não muda a notificação não vai de novo: o estado só sai quando muda.
  const antes = mensagens.length;
  await pagina.evaluate(() => atualizarModoSegundoPlano());
  assert.equal(mensagens.length, antes, 'o mesmo estado não deveria ser mandado duas vezes');
  console.log('PASS: o microfone vai e volta pela notificação, e o ensurdecer aparece nela');

  // ---------- O APK novo ----------
  await pagina.evaluate(() => NexoAtualizacao.conferir());
  await pagina.locator('#atualizarAppBtn').waitFor({ timeout: 5000 });
  await pagina.locator('#atualizarAppBtn').click();
  assert.equal(await pagina.locator('#atualizarAppTitulo').textContent(), 'Nexo 1.1.0 disponível');
  assert.match(await pagina.locator('#atualizarAppTexto').textContent(), /instale por cima/);
  assert.equal(await pagina.locator('#atualizarAppBaixar').getAttribute('href'), '/downloads/Nexo.apk');
  await pagina.screenshot({ path: path.join(saida, 'atualizacao.png') });
  await pagina.locator('#atualizarAppDepois').click();
  // A seção do aplicativo de mesa não é deste aplicativo.
  assert.equal(await pagina.locator('#abaAplicativo').isHidden(), true);
  console.log('PASS: o APK mais novo do servidor vira o aviso de atualização, com o link do .apk');

  // ---------- Sair pela notificação ----------
  await Promise.all([
    pagina.waitForURL(url => new URL(url).pathname === '/', { timeout: 10000 }),
    pagina.evaluate(() => doAplicativo({ tipo: 'sair' }))
  ]);
  await esperarAte(() => ultima()?.ativa === false, 'sair não desligou a chamada no aplicativo');
  // A vitrine, aberta dentro do aplicativo, não oferece o aplicativo.
  await pagina.waitForLoadState('domcontentloaded');
  if (await pagina.locator('.desktop-download').count()) {
    await esperarAte(async () => pagina.locator('.desktop-download').isHidden(), 'a seção de downloads apareceu dentro do aplicativo');
  }
  console.log('PASS: "Sair da sala" na notificação tira a pessoa da sala e desliga o serviço');

  await browser.close();
  await instancia.encerrar();
  console.log('Aplicativo Android, do lado da sala: tudo certo.');
  process.exit(0);
})().catch(async erro => {
  console.error(erro);
  try { await browser?.close(); } catch (_) { /* já fechou */ }
  await instancia?.encerrar();
  process.exit(1);
});
