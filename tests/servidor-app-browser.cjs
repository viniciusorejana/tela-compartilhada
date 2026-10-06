// "Trocar de servidor" nas configurações da sala, dentro dos dois aplicativos. A ponte do aplicativo de mesa
// (appNativo) e a do Android (nexoAndroid, e o "NexoAndroid/x.y.z" no user agent) são simuladas como cada
// aplicativo as põe na página. No navegador comum o bloco não existe: o servidor é o próprio site.
// O lado nativo (a tela de endereço já preenchida) tem o teste dele em electron.cjs e se prova no
// aparelho, no caso do Android. Sem servidor de mídia.
//
//   npm run test:servidor
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3244;
const origem = `http://localhost:${porta}`;
const sala = 'sala-do-servidor';
const PADRAO = origem;
let instancia, navegador;

const UA_ANDROID = versao => `Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 NexoAndroid/${versao}`;

async function entrar(contexto) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw new Error(`erro na página: ${erro.message}`); });
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  return pagina;
}
async function abrirAplicativo(pagina) {
  await pagina.evaluate(() => NexoConfig.abrir('aplicativo'));
  await pagina.locator('#painelAplicativo').waitFor({ state: 'visible' });
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  navegador = await chromium.launch({ headless: true });

  // ---------- No navegador: nada ----------
  const comum = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
  const noNavegador = await entrar(comum);
  assert.equal(await noNavegador.locator('#abaAplicativo').isVisible(), false, 'no navegador não há seção do aplicativo');
  assert.equal(await noNavegador.locator('#appServidor').isVisible(), false);
  await comum.close();

  // ---------- No aplicativo de mesa ----------
  const mesa = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
  await mesa.exposeFunction('pedirTrocaDeServidor', () => 1);
  await mesa.addInitScript(padrao => {
    window.appNativo = {
      pid: 0, versao: '1.2.0', plataforma: 'win32', instalacao: 'instalador', servidorPadrao: padrao,
      opcoesDoAplicativo: async () => ({ tipo: 'instalador', atualizaSozinho: true, atualizarSozinho: true, podeAbrirAoEntrar: true, abrirAoEntrar: false }),
      definirOpcaoDoAplicativo: async () => null,
      procurarAtualizacao: async () => ({ ok: true, nova: false, versao: '' }),
      trocarServidor: async () => { window.trocasPedidas = (window.trocasPedidas || 0) + 1; return { ok: true }; },
      prepararCaptura: async () => false, capturaSelecionada: async () => null, encerreiCaptura: () => {}, aoEncerrarCaptura: () => {},
      definirEndereco: () => {}, estadoDoAgente: async () => ({ rodando: false, disponivel: false, loopback: false, plataforma: 'win32' }),
      aoProgressoDaAtualizacao: () => {}, estadoDaAtualizacao: async () => null
    };
  }, PADRAO);
  const noApp = await entrar(mesa);
  await abrirAplicativo(noApp);
  assert.equal(await noApp.locator('#abaAplicativo').isVisible(), true);
  assert.equal(await noApp.locator('#appServidor').isVisible(), true, 'o bloco do servidor aparece');
  assert.match(await noApp.locator('#appServidorEndereco').textContent(), /localhost:3244 · o servidor padrão do Nexo/, 'diz onde está, e que é o padrão');
  assert.equal(await noApp.locator('#appVersao').isVisible(), true, 'e as opções do aplicativo de mesa continuam ali');
  const botao = noApp.locator('#appServidorTrocar');
  assert.equal((await botao.textContent()).trim(), 'Trocar de servidor');
  const trocas = () => noApp.evaluate(() => window.trocasPedidas || 0);

  // O primeiro clique só pede a confirmação: trocar tira a pessoa da chamada.
  await botao.click();
  assert.equal(await trocas(), 0, 'o primeiro clique não troca nada');
  assert.equal((await botao.textContent()).trim(), 'Sair da sala e trocar');
  assert.match(await noApp.locator('#appServidorDica').textContent(), /encerra a chamada/);
  // Desistir: trocar de seção desfaz o pedido.
  await noApp.locator('#abaAparencia').click();
  await abrirAplicativo(noApp);
  await noApp.evaluate(() => NexoConfig.abrir('aplicativo'));
  assert.equal((await botao.textContent()).trim(), 'Trocar de servidor', 'mudar de seção desiste');
  // Confirmar: o segundo clique pede ao aplicativo.
  await botao.click();
  await botao.click();
  await noApp.waitForFunction(() => window.trocasPedidas === 1, null, { timeout: 5000 });
  assert.equal(await trocas(), 1, 'o segundo clique pede a troca, uma vez só');
  await noApp.close();
  await mesa.close();

  // ---------- No Android 1.2.0: o botão pede ao aplicativo pela ponte ----------
  const novo = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA_ANDROID('1.2.0') });
  const mensagens = [];
  await novo.exposeFunction('mensagemParaOAplicativo', texto => { mensagens.push(JSON.parse(texto)); });
  await novo.addInitScript(() => {
    const ponte = new EventTarget();
    ponte.postMessage = texto => window.mensagemParaOAplicativo(String(texto));
    window.nexoAndroid = ponte;
  });
  const noAndroid = await entrar(novo);
  await abrirAplicativo(noAndroid);
  assert.equal(await noAndroid.locator('#abaAplicativo').isVisible(), true, 'o Android ganha a seção, com só o servidor');
  assert.equal((await noAndroid.locator('#appTitulo').textContent()).trim(), 'Aplicativo');
  assert.equal(await noAndroid.locator('#appVersao').isVisible(), false, 'sem as opções do aplicativo de mesa');
  assert.equal(await noAndroid.locator('#appOpcoes').isVisible(), false);
  assert.equal(await noAndroid.locator('#appServidor').isVisible(), true);
  await noAndroid.locator('#appServidorTrocar').click();
  await noAndroid.locator('#appServidorTrocar').click();
  await noAndroid.waitForFunction(() => true);
  const pedido = await new Promise(resolve => { const t0 = Date.now(); const olhar = () => { const m = mensagens.find(x => x.tipo === 'trocar-servidor'); if (m || Date.now() - t0 > 5000) resolve(m); else setTimeout(olhar, 50); }; olhar(); });
  assert.deepEqual(pedido, { tipo: 'trocar-servidor' }, 'o pedido chega ao aplicativo pela ponte');
  await novo.close();

  // ---------- No Android 1.1.1 (sem o pedido): a dica manda segurar o ícone ----------
  const velho = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA_ANDROID('1.1.1') });
  await velho.addInitScript(() => { const ponte = new EventTarget(); ponte.postMessage = () => {}; window.nexoAndroid = ponte; });
  const noVelho = await entrar(velho);
  await abrirAplicativo(noVelho);
  assert.equal(await noVelho.locator('#appServidorTrocar').isVisible(), false, 'um APK que não entende o pedido não ganha um botão que não faz nada');
  assert.match(await noVelho.locator('#appServidorDica').textContent(), /segure o ícone do Nexo/);

  console.log('PASS: "Trocar de servidor" está nas configurações dos dois aplicativos (com confirmação), e não aparece no navegador');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
