// A bandeja do sistema do aplicativo de mesa, no Electron de verdade (app/main.js): fechar a janela esconde o Nexo em
// vez de encerrá-lo; o ícone da bandeja traz a janela de volta ou encerra de verdade; abrir o Nexo de novo também traz
// a janela; e a chave do menu devolve o fechar de antes. Nenhuma janela nem ícone chega a aparecer: o ajudante troca o
// `show()` das janelas e o `Tray` por registros, e é por eles (e pelo processo que sai ou não) que o teste enxerga.
//
//   npm run test:bandeja
const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const raiz = path.join(__dirname, '..');
const saida = path.join(raiz, 'test-results/bandeja');
const executavel = require(path.join(raiz, 'app/node_modules/electron'));

function servidor() {
  return new Promise(resolver => {
    const s = http.createServer((_pedido, resposta) => {
      resposta.setHeader('content-type', 'text/html');
      resposta.end('<!doctype html><title>Sala</title><p id="sala">sala</p>');
    });
    s.listen(0, '127.0.0.1', () => resolver({ s, endereco: `http://127.0.0.1:${s.address().port}/sala` }));
  });
}

// O ajudante: o main.js de verdade, com a janela escondida de toda forma (o `show()` só anota) e o ícone da bandeja
// trocado por um falso que guarda o menu e o clique. `global.registro` é o que o teste lê.
const ajudante = perfil => `
  const electron = require('electron');
  const { app } = electron;
  app.setPath('userData', ${JSON.stringify(perfil)});
  app.disableHardwareAcceleration();
  global.registro = { eventos: [], bandeja: null, balao: [] };
  const marca = (tipo, extra) => global.registro.eventos.push({ tipo, em: Date.now(), ...extra });
  const NativeWindow = electron.BrowserWindow;
  const TestWindow = new Proxy(NativeWindow, { construct(Target, [options]) {
    const janela = new Target({ ...options, show: false });
    janela.show = () => marca('show');
    const esconder = janela.hide.bind(janela);
    janela.hide = () => { marca('hide'); esconder(); };
    janela.webContents.on('did-finish-load', () => marca('carregou'));
    janela.on('closed', () => marca('fechada'));
    return janela;
  }});
  class FalsaBandeja {
    constructor(icone) { global.registro.bandeja = { icone: String(icone), dica: '', menu: null, aoClicar: null }; }
    setToolTip(dica) { global.registro.bandeja.dica = dica; }
    setContextMenu(menu) { global.registro.bandeja.menu = menu; }
    on(nome, funcao) { if (nome === 'click') global.registro.bandeja.aoClicar = funcao; }
    isDestroyed() { return false; }
    displayBalloon(opcoes) { global.registro.balao.push(opcoes); }
  }
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function(name, parent, ...args) {
    if (name === 'electron' && parent?.filename === ${JSON.stringify(path.join(raiz, 'app/main.js'))}) return { ...electron, BrowserWindow: TestWindow, Tray: FalsaBandeja };
    return load.call(this, name, parent, ...args);
  };
  require(${JSON.stringify(path.join(raiz, 'app/main.js'))});
`;

let n = 0;
async function abrir({ endereco, config = {} }) {
  const perfil = path.join(saida, `perfil-${++n}`);
  fs.mkdirSync(perfil, { recursive: true });
  fs.writeFileSync(path.join(perfil, 'config.json'), JSON.stringify({ endereco, ...config }));
  const arquivo = path.join(saida, `ajudante-${n}.cjs`);
  fs.writeFileSync(arquivo, ajudante(perfil));
  const env = { ...process.env, NEXO_SEM_SPLASH: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: executavel, args: [arquivo], env, timeout: 20000 });
  app.process().stderr.on('data', pedaco => { if (!/UnhandledPromise|did-fail|ERR_|Debugger|For help, see/.test(String(pedaco))) process.stderr.write(pedaco); });
  const saiu = new Promise(resolver => app.process().once('exit', resolver));
  const registro = () => app.evaluate(() => ({ eventos: global.registro.eventos, balao: global.registro.balao.length }));
  const contar = async tipo => (await registro()).eventos.filter(e => e.tipo === tipo).length;
  const ate = async (condicao, mensagem, prazo = 10000) => {
    const fim = Date.now() + prazo;
    while (Date.now() < fim) { if (await condicao()) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`${mensagem} -- ${JSON.stringify(await registro().catch(() => 'o aplicativo já saiu'))}`);
  };
  // O aplicativo saiu de verdade (o processo terminou) dentro do prazo.
  const encerrou = async (mensagem, prazo = 8000) => {
    const resultado = await Promise.race([saiu.then(() => 'saiu'), new Promise(r => setTimeout(() => r('seguiu'), prazo))]);
    assert.equal(resultado, 'saiu', mensagem);
  };
  const aindaRoda = () => app.evaluate(() => true).then(() => true, () => false);
  await ate(async () => (await contar('carregou')) >= 1, 'a janela devia carregar a sala');
  return { app, registro, contar, ate, encerrou, aindaRoda, perfil };
}

// "Fechar a janela", do jeito de quem clica no X: o evento `close` da janela principal.
const fecharAJanela = app => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
const itensDaBandeja = app => app.evaluate(() => global.registro.bandeja.menu.items.map(i => i.label || `(${i.type})`));
const clicarNoItem = (app, rotulo) => app.evaluate((_electron, r) => global.registro.bandeja.menu.items.find(i => i.label === r).click(), rotulo);

(async () => {
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });
  const { s, endereco } = await servidor();

  // ---------- 1. O ícone da bandeja existe, com a marca do Nexo e um menu de três linhas ----------
  {
    const { app, encerrou } = await abrir({ endereco });
    const bandeja = await app.evaluate(() => { const b = global.registro.bandeja; return b && { icone: b.icone, dica: b.dica, clique: Boolean(b.aoClicar) }; });
    assert.ok(bandeja, 'o Nexo cria o ícone da bandeja ao abrir');
    assert.match(bandeja.icone, process.platform === 'win32' ? /icon\.ico$/ : /icon\.png$/, 'com o ícone certo para o sistema (.ico no Windows, .png no Linux)');
    assert.ok(fs.existsSync(bandeja.icone), 'e o arquivo do ícone existe');
    assert.equal(bandeja.dica, 'Nexo', 'a dica do ícone é o nome');
    assert.equal(bandeja.clique, true, 'o clique no ícone está ligado');
    assert.deepEqual(await itensDaBandeja(app), ['Abrir o Nexo', '(separator)', 'Sair do Nexo']);
    // O ícone de verdade (o .ico/.png) carrega no Tray do Electron deste sistema: o falso acima não provaria isso.
    await app.evaluate(({ Tray }, icone) => { const t = new Tray(icone); t.destroy(); }, bandeja.icone);
    // O menu da janela traz a chave que devolve o fechar de antes, ligada por padrão.
    const chave = await app.evaluate(({ Menu }) => { const i = Menu.getApplicationMenu().items[0].submenu.items.find(it => it.label === 'Fechar a janela deixa o Nexo na bandeja'); return i && { checked: i.checked, type: i.type }; });
    assert.deepEqual(chave, { checked: true, type: 'checkbox' }, 'a chave "Fechar a janela deixa o Nexo na bandeja" está no menu, ligada');
    await clicarNoItem(app, 'Sair do Nexo');
    await encerrou('"Sair do Nexo" encerra o aplicativo');
    console.log('PASS: a bandeja nasce com o ícone, a dica, o menu e a chave no menu da janela');
  }

  // ---------- 2. Fechar a janela esconde o Nexo (e ele continua rodando), o ícone traz de volta ----------
  {
    const { app, contar, ate, aindaRoda, encerrou, perfil } = await abrir({ endereco });
    const mostradas = await contar('show');
    await fecharAJanela(app);
    await ate(async () => (await contar('hide')) === 1, 'fechar a janela devia escondê-la');
    assert.equal(await contar('fechada'), 0, 'a janela NÃO foi destruída: o Nexo só foi para a bandeja');
    assert.equal(await aindaRoda(), true, 'e o aplicativo segue rodando');
    // O aviso de "continuo na bandeja" é do Windows, e só vem uma vez.
    if (process.platform === 'win32') {
      assert.equal((await app.evaluate(() => global.registro.balao.length)), 1, 'o Windows avisa, na primeira vez, onde o Nexo foi parar');
      assert.equal(JSON.parse(fs.readFileSync(path.join(perfil, 'config.json'), 'utf8')).avisouDaBandeja, true, 'e a configuração lembra que já avisou');
    }
    // O clique no ícone traz a janela de volta.
    await app.evaluate(() => global.registro.bandeja.aoClicar());
    await ate(async () => (await contar('show')) === mostradas + 1, 'clicar no ícone devia mostrar a janela');
    // Esconde de novo: agora sem balão.
    await fecharAJanela(app);
    await ate(async () => (await contar('hide')) === 2, 'fechar de novo devia esconder de novo');
    if (process.platform === 'win32') assert.equal((await app.evaluate(() => global.registro.balao.length)), 1, 'o aviso não se repete');
    // "Abrir o Nexo" no menu também traz a janela.
    await clicarNoItem(app, 'Abrir o Nexo');
    await ate(async () => (await contar('show')) === mostradas + 2, '"Abrir o Nexo" devia mostrar a janela');
    // Abrir o Nexo de novo (a segunda instância) traz a janela escondida para a frente.
    await fecharAJanela(app);
    await ate(async () => (await contar('hide')) === 3, 'terceiro fechar esconde');
    await app.evaluate(({ app: a }) => a.emit('second-instance', {}, [], ''));
    await ate(async () => (await contar('show')) === mostradas + 3, 'abrir o Nexo de novo devia trazer a janela escondida');
    await app.evaluate(({ app: a }) => a.quit());
    await encerrou('e o aplicativo encerra ao fim');
    console.log('PASS: fechar a janela esconde o Nexo sem encerrá-lo; o ícone, o menu e abrir de novo trazem a janela; o aviso vem uma vez');
  }

  // ---------- 3. "Sair do Nexo" encerra de verdade, mesmo com a janela escondida ----------
  {
    const { app, contar, ate, encerrou } = await abrir({ endereco });
    await fecharAJanela(app);
    await ate(async () => (await contar('hide')) === 1, 'a janela devia ir para a bandeja');
    await clicarNoItem(app, 'Sair do Nexo');
    await encerrou('"Sair do Nexo" devia encerrar o aplicativo com a janela escondida');
    console.log('PASS: "Sair do Nexo", na bandeja, encerra o aplicativo de verdade');
  }

  // ---------- 4. Um sair de verdade (o "Sair" do menu, a atualização) nunca fica preso na bandeja ----------
  {
    const { app, encerrou } = await abrir({ endereco });
    await app.evaluate(({ app: a }) => a.quit());
    await encerrou('app.quit() devia encerrar, e não esconder a janela');
    console.log('PASS: app.quit() (o "Sair" do menu e a atualização) encerra, sem ficar na bandeja');
  }

  // ---------- 5. Com a chave desligada, fechar a janela encerra como antes ----------
  {
    const { app, encerrou } = await abrir({ endereco, config: { fecharParaBandeja: false } });
    const chave = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(it => it.label === 'Fechar a janela deixa o Nexo na bandeja').checked);
    assert.equal(chave, false, 'a chave aparece desligada, como foi guardada');
    await fecharAJanela(app);
    await encerrou('com a chave desligada, fechar a janela encerra o Nexo');
    console.log('PASS: com a chave desligada, fechar a janela encerra o Nexo como antes');
  }

  // ---------- 6. A chave do menu guarda a escolha ----------
  {
    const { app, perfil, encerrou } = await abrir({ endereco });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(it => it.label === 'Fechar a janela deixa o Nexo na bandeja').click());
    assert.equal(JSON.parse(fs.readFileSync(path.join(perfil, 'config.json'), 'utf8')).fecharParaBandeja, false, 'desligar a chave grava a escolha');
    assert.equal(JSON.parse(fs.readFileSync(path.join(perfil, 'config.json'), 'utf8')).endereco, endereco, 'sem perder o resto da configuração');
    await fecharAJanela(app);
    await encerrou('e a janela passa a encerrar o Nexo ao fechar');
    console.log('PASS: a chave do menu grava a escolha sem perder o resto da configuração');
  }

  s.close();
})().catch(erro => { console.error(erro); process.exit(1); });
