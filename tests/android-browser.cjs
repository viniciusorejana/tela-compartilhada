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

  // ---------- As notificações de amigos ----------
  // A Ana no início, dentro do aplicativo e com ele fora da tela; a Bia num navegador comum,
  // mandando mensagem e convite; o Caio pedindo amizade.
  const ana = await instancia.conta('anaandroid', { apelido: 'Ana' });
  const bia = await instancia.conta('biaandroid', { apelido: 'Bia' });
  const caio = await instancia.conta('caioandroid', { apelido: 'Caio' });
  const pedirAmizade = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origin}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    const r = await fetch(`${origin}/api/conta/amigos`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
    assert.ok(r.ok, await r.text());
  };
  await pedirAmizade(ana, '@biaandroid');
  await pedirAmizade(bia, '@anaandroid');
  const comCookie = async (opcoes, quem) => {
    const c = await browser.newContext(opcoes);
    await c.addCookies([{ name: 'nexo_conta', value: quem.cookie.split('=')[1], url: origin }]);
    return c;
  };
  const doApp = [];
  const contextoAna = await comCookie({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA }, ana);
  await contextoAna.exposeFunction('mensagemParaOAplicativo', texto => { doApp.push(JSON.parse(texto)); });
  await contextoAna.addInitScript(() => {
    const ponte = new EventTarget();
    ponte.postMessage = texto => window.mensagemParaOAplicativo(String(texto));
    window.nexoAndroid = ponte;
    window.doAplicativo = dados => ponte.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(dados) }));
    // O aplicativo fora da tela, até o teste dizer o contrário.
    window.visivel = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.visivel ? 'visible' : 'hidden') });
  });
  const inicio = await contextoAna.newPage();
  inicio.on('pageerror', erro => { throw new Error(`erro no início: ${erro.message}`); });
  await inicio.goto(origin);
  await inicio.locator('#inicioApp').waitFor();
  const achar = predicado => doApp.find(predicado);
  await esperarAte(() => achar(m => m.tipo === 'avisos' && m.ligado === true), `a conta conectada não ligou os avisos no aplicativo: ${JSON.stringify(doApp)}`);
  await inicio.waitForFunction(() => NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });

  const paginaBia = await (await comCookie({}, bia)).newPage();
  await paginaBia.goto(origin);
  await paginaBia.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });
  const enviada = await paginaBia.evaluate(codigo => NexoSocial.enviar(codigo, 'oi, chegou?'), ana.conta.codigo);
  assert.equal(enviada.ok, true, JSON.stringify(enviada));
  await esperarAte(() => achar(m => m.tipo === 'aviso' && m.categoria === 'mensagem'), `a mensagem não virou notificação: ${JSON.stringify(doApp)}`);
  const mensagem = achar(m => m.tipo === 'aviso' && m.categoria === 'mensagem');
  assert.deepEqual({ com: mensagem.com, nome: mensagem.nome, texto: mensagem.texto, imagem: mensagem.imagem }, { com: bia.conta.codigo, nome: 'Bia', texto: 'oi, chegou?', imagem: false });

  await paginaBia.evaluate(codigo => NexoSocial.convidar(codigo, 'squad-do-android'), ana.conta.codigo);
  await esperarAte(() => achar(m => m.tipo === 'aviso' && m.categoria === 'convite'), 'o convite não virou notificação');
  assert.equal(achar(m => m.categoria === 'convite').sala, 'squad-do-android');

  await pedirAmizade(caio, '@anaandroid');
  await esperarAte(() => achar(m => m.tipo === 'aviso' && m.categoria === 'pedido'), 'o pedido de amizade não virou notificação');
  assert.deepEqual(achar(m => m.categoria === 'pedido'), { tipo: 'aviso', categoria: 'pedido', codigo: caio.conta.codigo, nome: 'Caio' });
  await esperarAte(() => doApp.some(m => m.tipo === 'pedidos' && m.codigos.includes(caio.conta.codigo)), 'os pedidos pendentes não foram ao aplicativo');
  console.log('PASS: com o aplicativo fora da tela, mensagem, convite e pedido de amizade viram notificação');

  // Tocar na notificação: o Nexo volta à frente e a conversa abre, sem recarregar a página. Aberta,
  // ela é lida -- e a notificação dela sai da gaveta.
  await inicio.evaluate(() => { window.visivel = true; });
  await inicio.evaluate(codigo => doAplicativo({ tipo: 'aviso-tocado', acao: 'abrir', com: codigo }), bia.conta.codigo);
  await inicio.locator('#vistaConversa:not([hidden])').waitFor({ timeout: 5000 });
  await esperarAte(() => achar(m => m.tipo === 'aviso-lido' && m.chave === `conversa:${bia.conta.codigo}`), `ler a conversa não tirou a notificação: ${JSON.stringify(doApp.slice(-5))}`);
  // À vista, o aviso é o do canto da página: nada vai para a gaveta.
  const antesDaVisivel = doApp.filter(m => m.tipo === 'aviso').length;
  await paginaBia.evaluate(codigo => NexoSocial.convidar(codigo, 'outra-sala'), ana.conta.codigo);
  await inicio.locator('.nexo-toast').filter({ hasText: 'outra-sala' }).first().waitFor({ timeout: 5000 });
  assert.equal(doApp.filter(m => m.tipo === 'aviso').length, antesDaVisivel, 'com o Nexo à vista, nada de notificação');
  // Aceitar pela notificação, com a página aberta.
  await inicio.evaluate(codigo => doAplicativo({ tipo: 'aviso-tocado', acao: 'aceitar', codigo }), caio.conta.codigo);
  await inicio.waitForFunction(codigo => NexoSocial.relacao(codigo) === 'amigos', caio.conta.codigo, { timeout: 5000 });
  await esperarAte(() => doApp.some(m => m.tipo === 'pedidos' && !m.codigos.includes(caio.conta.codigo)), 'o pedido aceito não saiu da gaveta');
  await inicio.screenshot({ path: path.join(saida, 'conversa-pela-notificacao.png') });
  console.log('PASS: tocar na notificação abre a conversa (ou aceita o pedido) sem recarregar, e o que foi lido sai da gaveta');

  // A notificação tocada com o aplicativo fechado abre o endereço da conversa.
  await inicio.goto(`${origin}/?conversa=${encodeURIComponent(bia.conta.codigo)}`);
  await inicio.locator('#vistaConversa:not([hidden])').waitFor({ timeout: 10000 });
  assert.equal(new URL(inicio.url()).search, '', 'o endereço volta a ser o do início');
  console.log('PASS: aberta pelo endereço da notificação, a página vai direto para a conversa');

  // ---------- O início por cima da sala (a camada) ----------
  // A WebView injeta `nexoAndroid` em todo quadro da origem, e o init script acima faz o mesmo aqui:
  // o quadro da camada TEM a ponte, e não pode falar por ela. O aplicativo só precisa saber de uma
  // coisa -- que a camada está aberta --, para o gesto de voltar fechá-la em vez de guardar o Nexo.
  const naSala = await contextoAna.newPage();
  naSala.on('pageerror', erro => { throw new Error(`erro na sala da camada: ${erro.message}`); });
  await naSala.addInitScript(() => { window.visivel = true; });
  await naSala.goto(`${origin}/sala-da-camada-android/sala`);
  await naSala.evaluate(() => window.NexoConta?.pronto);
  await naSala.locator('#nameConfirmBtn').click();
  await naSala.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await esperarAte(() => doApp.some(m => m.tipo === 'chamada' && m.ativa === true && m.sala === 'sala-da-camada-android'), 'a sala não contou a chamada');
  const antesDaCamada = doApp.length;
  await naSala.evaluate(() => NexoInicioNaSala.abrir());
  await esperarAte(() => doApp.some((m, i) => i >= antesDaCamada && m.tipo === 'camada' && m.aberta === true), `a camada aberta não foi contada ao aplicativo: ${JSON.stringify(doApp.slice(antesDaCamada))}`);
  await naSala.locator('.camada-quadro.pronto').waitFor({ timeout: 15000 });
  const quadroDoAndroid = naSala.frames().find(f => f !== naSala.mainFrame());
  assert.equal(await quadroDoAndroid.evaluate(() => typeof window.NexoAndroid), 'undefined', 'a ponte do aplicativo não é ligada dentro do quadro');
  await naSala.waitForTimeout(1500);
  assert.deepEqual(doApp.slice(antesDaCamada).filter(m => m.tipo !== 'camada').map(m => m.tipo), [], 'o quadro da camada não fala com o aplicativo por conta própria');
  // Tocar na notificação de uma conversa, com a camada aberta: a conversa abre nela, e não no painel
  // de mensagens da sala, que ficaria por baixo.
  await naSala.evaluate(codigo => doAplicativo({ tipo: 'aviso-tocado', acao: 'abrir', com: codigo }), bia.conta.codigo);
  await quadroDoAndroid.locator('#vistaConversa:not([hidden])').waitFor({ timeout: 5000 });
  assert.equal(await naSala.locator('#mensagensPanel').evaluate(el => el.classList.contains('hidden')), true, 'o painel de mensagens da sala continua fechado');
  // O gesto de voltar do aparelho (MainActivity.voltar) chega como 'voltar-camada'.
  await naSala.evaluate(() => doAplicativo({ tipo: 'voltar-camada' }));
  await naSala.locator('#camadaPanel.hidden').waitFor({ state: 'attached', timeout: 5000 });
  await esperarAte(() => doApp.filter((m, i) => i >= antesDaCamada && m.tipo === 'camada').at(-1)?.aberta === false, 'fechar a camada não foi contado ao aplicativo');
  assert.equal(await naSala.evaluate(() => Boolean(tiles.has('self') && socket?.connected)), true, 'voltar fechou a camada, e não a chamada');
  await naSala.close();
  console.log('PASS: no Android, a camada do início avisa o aplicativo, o quadro dela não fala pela ponte, a notificação abre a conversa nela e o voltar do aparelho a fecha');

  // ---------- O atualizador do APK 1.1.0 ----------
  // Fora da sala (no início), o mesmo botão "Atualizar"; quem baixa e instala é o aplicativo
  // (Atualizador.java), e a página só pede e mostra o estado que volta pela ponte.
  const UA_NOVO = UA.replace('NexoAndroid/1.0.0', 'NexoAndroid/1.1.0');
  const doAppNovo = [];
  const contextoNovo = await comCookie({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA_NOVO }, ana);
  await contextoNovo.exposeFunction('mensagemParaOAplicativo', texto => { doAppNovo.push(JSON.parse(texto)); });
  await contextoNovo.addInitScript(() => {
    const ponte = new EventTarget();
    ponte.postMessage = texto => window.mensagemParaOAplicativo(String(texto));
    window.nexoAndroid = ponte;
    window.doAplicativo = dados => ponte.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(dados) }));
  });
  await contextoNovo.route('**/api/desktop-app', rota => rota.fulfill({ json: { available: false, sistemas: [
    { chave: 'android', nome: 'Android', tipo: '.apk', familia: 'android', url: '/downloads/Nexo.apk', size: 1, builtAt: new Date().toISOString(), versao: '1.2.0' }
  ] } }));
  const novo = await contextoNovo.newPage();
  novo.on('pageerror', erro => { throw new Error(`erro no início (1.1.0): ${erro.message}`); });
  await novo.goto(origin);
  await novo.locator('#atualizarAppBtn').waitFor({ timeout: 8000 });
  assert.ok(doAppNovo.some(m => m.tipo === 'atualizacao-estado'), 'a página pergunta ao aplicativo se já há uma atualização descendo');
  await novo.locator('#atualizarAppBtn').tap();
  assert.match(await novo.locator('#atualizarAppTexto').textContent(), /O Nexo baixa a versão nova e pede para instalar por cima/);
  assert.equal(await novo.locator('#atualizarAppBaixar').textContent(), 'Atualizar agora');
  await novo.locator('#atualizarAppBaixar').tap();
  await esperarAte(() => doAppNovo.some(m => m.tipo === 'atualizar'), 'o pedido de atualizar não chegou ao aplicativo');
  assert.deepEqual(doAppNovo.find(m => m.tipo === 'atualizar'), { tipo: 'atualizar', versao: '1.2.0', url: '/downloads/Nexo.apk' });

  const doAtualizador = dados => novo.evaluate(d => doAplicativo({ tipo: 'atualizacao', ...d }), dados);
  await doAtualizador({ estado: 'baixando', versao: '1.2.0', recebidos: 5 * 1048576, total: 10 * 1048576 });
  await novo.locator('.nexo-toast', { hasText: 'Baixando o Nexo 1.2.0 · 50%' }).waitFor({ timeout: 5000 });
  await doAtualizador({ estado: 'pronto', versao: '1.2.0', recebidos: 10 * 1048576, total: 10 * 1048576 });
  const pronto = novo.locator('.nexo-toast', { hasText: 'Nexo 1.2.0 pronto' });
  await pronto.waitFor({ timeout: 5000 });
  assert.match(await pronto.textContent(), /Instalar fecha o Nexo por um instante/);
  assert.equal(await novo.locator('#atualizarAppBtn span').textContent(), 'Instalar');
  await novo.waitForTimeout(250);
  await novo.screenshot({ path: path.join(saida, 'atualizacao-pronta.png') });
  await pronto.getByRole('button', { name: 'Instalar agora' }).tap();
  await esperarAte(() => doAppNovo.some(m => m.tipo === 'atualizacao-instalar'), '"Instalar agora" não chegou ao aplicativo');
  // A primeira vez, o Android pede a permissão de instalar; o aviso diz o que fazer.
  await doAtualizador({ estado: 'permissao', versao: '1.2.0' });
  await novo.locator('.nexo-toast', { hasText: 'Falta uma permissão' }).waitFor({ timeout: 5000 });
  assert.match(await novo.locator('.nexo-toast', { hasText: 'Falta uma permissão' }).textContent(), /Permitir desta fonte/);
  // Uma chave diferente: o motivo do aplicativo aparece como está.
  await doAtualizador({ estado: 'falhou', versao: '1.2.0', motivo: 'A versão nova foi assinada com outra chave e não instala por cima desta.' });
  await novo.locator('.nexo-toast', { hasText: 'A atualização não instalou' }).waitFor({ timeout: 5000 });
  assert.match(await novo.locator('.nexo-toast', { hasText: 'A atualização não instalou' }).textContent(), /outra chave/);
  console.log('PASS: no APK 1.1.0, "Atualizar agora" pede ao aplicativo, o progresso, o "Instalar", a permissão e a falha aparecem no início');

  // A notificação "Nexo 1.2.0 disponível" tocada com a página aberta: vai direto ao download.
  const pedidosAntes = doAppNovo.filter(m => m.tipo === 'atualizar').length;
  await novo.reload();
  await novo.locator('#atualizarAppBtn').waitFor({ timeout: 8000 });
  await novo.evaluate(() => doAplicativo({ tipo: 'aviso-tocado', acao: 'atualizar' }));
  await esperarAte(() => doAppNovo.filter(m => m.tipo === 'atualizar').length > pedidosAntes, 'tocar na notificação de versão nova não pediu o download');
  console.log('PASS: tocar em "Nexo 1.2.0 disponível" com a página aberta começa o download');

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
