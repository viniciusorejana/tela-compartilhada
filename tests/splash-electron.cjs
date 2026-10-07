// A splash do aplicativo de mesa, no Electron de verdade (app/main.js, app/splash.html): quando aparece, o que mostra,
// quando a janela principal toma o lugar dela, e o que acontece quando o servidor demora, está fora do ar ou não
// responde. Nenhuma janela chega a aparecer na tela: o ajudante troca o `show()` de todas por uma anotação, e é pelas
// anotações (e pela página da splash, que existe mesmo escondida) que o teste enxerga.
//
//   npm run test:splash
const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const raiz = path.join(__dirname, '..');
const saida = path.join(raiz, 'test-results/splash');
const executavel = require(path.join(raiz, 'app/node_modules/electron'));
const MINIMO = 1100;   // MS_MINIMO_DA_SPLASH, de app/main.js

// O servidor de mentira: responde depois de `atraso` ms, ou nunca.
function servidor({ atraso = 0, mudo = false } = {}) {
  return new Promise(resolver => {
    const s = http.createServer((pedido, resposta) => {
      if (mudo) return;
      setTimeout(() => { resposta.setHeader('content-type', 'text/html'); resposta.end('<!doctype html><title>Sala</title><p id="sala">sala</p>'); }, atraso);
    });
    s.listen(0, '127.0.0.1', () => resolver({ s, endereco: `http://127.0.0.1:${s.address().port}/sala` }));
  });
}

// O ajudante: o Electron de verdade com o main.js de verdade, só que toda janela é criada escondida e o `show()` dela só
// anota. As anotações ficam em `global.janelas`, na ordem em que as janelas nasceram.
const ajudante = perfil => `
  const electron = require('electron');
  const { app } = electron;
  app.setPath('userData', ${JSON.stringify(perfil)});
  app.disableHardwareAcceleration();
  const NativeWindow = electron.BrowserWindow;
  const TestWindow = new Proxy(NativeWindow, { construct(Target, [options]) {
    const janela = new Target({ ...options, show: false });
    const registro = {
      nome: options.frame === false ? 'splash' : 'principal', criada: Date.now(),
      pedido: { show: options.show, frame: options.frame, width: options.width, height: options.height, skipTaskbar: options.skipTaskbar, alwaysOnTop: options.alwaysOnTop, type: options.type, backgroundColor: options.backgroundColor, sandbox: options.webPreferences?.sandbox, contextIsolation: options.webPreferences?.contextIsolation, nodeIntegration: options.webPreferences?.nodeIntegration },
      eventos: []
    };
    (global.janelas ||= []).push(registro);
    const marca = (tipo, extra) => registro.eventos.push({ tipo, em: Date.now(), ...extra });
    janela.show = () => marca('show');
    const fechar = janela.close.bind(janela);
    janela.close = () => { marca('close'); fechar(); };
    const opacidade = janela.setOpacity.bind(janela);
    janela.setOpacity = n => { marca('opacidade', { valor: n }); opacidade(n); };
    janela.webContents.on('did-finish-load', () => marca('carregou', { url: janela.webContents.getURL() }));
    return janela;
  }});
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function(name, parent, ...args) {
    if (name === 'electron' && parent?.filename === ${JSON.stringify(path.join(raiz, 'app/main.js'))}) return { ...electron, BrowserWindow: TestWindow };
    return load.call(this, name, parent, ...args);
  };
  require(${JSON.stringify(path.join(raiz, 'app/main.js'))});
`;

let n = 0;
async function abrir({ endereco, args = [], ambiente = {} }) {
  const perfil = path.join(saida, `perfil-${++n}`);
  fs.mkdirSync(perfil, { recursive: true });
  if (endereco) fs.writeFileSync(path.join(perfil, 'config.json'), JSON.stringify({ endereco }));
  const arquivo = path.join(saida, `ajudante-${n}.cjs`);
  fs.writeFileSync(arquivo, ajudante(perfil));
  const env = { ...process.env, ...ambiente };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NEXO_SEM_SPLASH;
  Object.assign(env, ambiente);
  const aberto = Date.now();
  const app = await _electron.launch({ executablePath: executavel, args: [arquivo, ...args], env, timeout: 20000 });
  // O que sobra no stderr é do depurador que o Playwright liga e de falhas de carga que o teste provoca de propósito.
  app.process().stderr.on('data', pedaco => { if (!/UnhandledPromise|did-fail|ERR_|Debugger|For help, see/.test(String(pedaco))) process.stderr.write(pedaco); });
  const janelas = () => app.evaluate(() => global.janelas || []);
  // Espera a condição sobre as anotações (a cada 50 ms), com um prazo.
  const ate = async (condicao, mensagem, prazo = 15000) => {
    const fim = Date.now() + prazo;
    while (Date.now() < fim) { const j = await janelas(); if (condicao(j)) return j; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(mensagem + ' -- ' + JSON.stringify(await janelas()));
  };
  return { app, janelas, ate, aberto };
}
const evento = (janela, tipo) => janela?.eventos.find(e => e.tipo === tipo);
const foiFechada = j => j.some(x => x.nome === 'splash' && evento(x, 'close')) && j.some(x => x.nome === 'principal' && evento(x, 'show'));

(async () => {
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });

  // ---------- 1. Servidor rápido: a splash vem primeiro, dura o mínimo e a sala toma o lugar dela ----------
  {
    const { s, endereco } = await servidor({ atraso: 50 });
    const { app, janelas, ate } = await abrir({ endereco });
    const j = await ate(foiFechada, 'a splash devia ter dado lugar à janela principal');
    const [splash, principal] = j;
    assert.deepEqual(j.map(x => x.nome), ['splash', 'principal'], 'a splash nasce ANTES da janela principal');
    assert.deepEqual([splash.pedido.frame, splash.pedido.width, splash.pedido.height, splash.pedido.skipTaskbar, splash.pedido.alwaysOnTop], [false, 460, 320, true, true], 'sem moldura, 460x320, fora da barra de tarefas e por cima');
    assert.deepEqual([splash.pedido.sandbox, splash.pedido.contextIsolation, splash.pedido.nodeIntegration], [true, true, false], 'a splash roda isolada e sem Node');
    assert.equal(principal.pedido.show, false, 'a janela principal nasce escondida');
    assert.equal(principal.pedido.backgroundColor, '#12131c', 'e no fundo do Nexo escuro, para nunca piscar outra cor');
    assert.ok(evento(splash, 'show'), 'a splash aparece (depois de pintar)');
    const aparece = evento(principal, 'show').em - splash.criada;
    assert.ok(aparece >= MINIMO - 60, `a janela principal só aparece depois do mínimo da splash (${aparece} ms)`);
    assert.ok(aparece < MINIMO + 2500, `e não demora além do necessário (${aparece} ms)`);
    assert.ok(evento(splash, 'close').em >= evento(principal, 'show').em, 'a splash sai POR CIMA da janela principal, depois que ela aparece');
    const passos = splash.eventos.filter(e => e.tipo === 'opacidade').map(e => e.valor);
    assert.ok(passos.length >= 3 && passos.every((v, i) => i === 0 || v <= passos[i - 1]) && passos.at(-1) === 0, `sai em fusão (${passos.join(', ')})`);
    assert.ok(evento(principal, 'carregou').url.startsWith(endereco), 'a janela principal abriu o servidor escolhido');
    await app.close();
    s.close();
    console.log('PASS: a splash nasce antes da janela, aparece, dura o mínimo e a sala toma o lugar dela com a splash saindo em fusão');
  }

  // ---------- 2. A página da splash: a marca, o nome, e nada de rede ----------
  {
    const { s, endereco } = await servidor({ atraso: 2500 });
    const { app, ate } = await abrir({ endereco });
    await ate(j => j[0]?.eventos.some(e => e.tipo === 'show'), 'a splash devia aparecer');
    const pagina = (await (async () => { for (let i = 0; i < 100; i++) { const p = app.windows().find(w => w.url().endsWith('splash.html')); if (p) return p; await new Promise(r => setTimeout(r, 50)); } })());
    assert.ok(pagina, 'a janela da splash tem a página splash.html');
    assert.equal(await pagina.locator('.nome').textContent(), 'NEXO');
    assert.equal(await pagina.locator('.emblema .marca svg').count(), 1, 'a marca do Nexo');
    assert.equal(await pagina.locator('.emblema .roda').count(), 1, 'dentro da roda');
    assert.equal(await pagina.locator('script').count(), 0, 'sem nenhum script: é só CSS');
    assert.equal(await pagina.locator('main').getAttribute('role'), 'status', 'uma região de status, para o leitor de tela');
    assert.match(await pagina.locator('.e1').textContent(), /Abrindo o Nexo/);
    const bloqueado = await pagina.evaluate(async endereco => { try { await fetch(endereco); return false; } catch (_) { return true; } }, endereco);
    assert.equal(bloqueado, true, 'a CSP da splash não deixa ela falar com a rede');
    assert.equal(await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 19, 28)', 'no fundo do Nexo escuro');
    // O servidor demora 2,5 s: a splash FICA até a sala chegar, e a frase muda com a espera.
    await pagina.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.e1')).opacity) > 0.9, null, { timeout: 4000 });
    await app.close();
    s.close();
    console.log('PASS: a splash é a marca na roda do Nexo e o nome, sem script, isolada, e sem acesso à rede');
  }

  // ---------- 3. Servidor lento: a splash fica até a sala chegar ----------
  {
    const { s, endereco } = await servidor({ atraso: 2600 });
    const { app, ate } = await abrir({ endereco });
    const j = await ate(foiFechada, 'a splash devia dar lugar à sala quando ela chegasse');
    const [splash, principal] = j;
    assert.ok(evento(principal, 'show').em - splash.criada >= 2500, 'a janela principal esperou a sala chegar, e não o mínimo da splash');
    assert.ok(!splash.eventos.some(e => e.tipo === 'close' && e.em < evento(principal, 'show').em), 'a splash não fechou antes da sala');
    await app.close();
    s.close();
    console.log('PASS: com o servidor lento a splash fica na tela até a sala pintar');
  }

  // ---------- 4. Servidor fora do ar: a tela de endereço, e a splash sai ----------
  {
    const { s, endereco } = await servidor();
    s.close();
    await new Promise(r => setTimeout(r, 100));
    const { app, ate } = await abrir({ endereco });
    const j = await ate(foiFechada, 'a splash devia sair para a tela de endereço');
    const principal = j.find(x => x.nome === 'principal');
    const ultima = principal.eventos.filter(e => e.tipo === 'carregou').at(-1).url;
    assert.match(ultima, /endereco\.html/, 'sem servidor, a janela mostra a tela de endereço');
    assert.match(decodeURIComponent(ultima), /erro=/, 'com o motivo');
    await app.close();
    console.log('PASS: com o servidor fora do ar a splash dá lugar à tela de endereço, com o motivo');
  }

  // ---------- 5. Servidor que não responde: o limite, e a tela de endereço ----------
  {
    const { s, endereco } = await servidor({ mudo: true });
    const { app, ate } = await abrir({ endereco, ambiente: { NEXO_SPLASH_MAXIMO_MS: '1500' } });
    const j = await ate(foiFechada, 'passado o limite, a splash devia sair para a tela de endereço', 20000);
    const [splash, principal] = j;
    const url = principal.eventos.filter(e => e.tipo === 'carregou').at(-1).url;
    assert.match(url, /endereco\.html/);
    assert.match(decodeURIComponent(url), /o servidor não respondeu a tempo/);
    assert.ok(evento(principal, 'show').em - splash.criada >= 1500, 'só depois do limite');
    await app.close();
    s.close();
    console.log('PASS: um servidor que não responde nunca deixa a pessoa olhando a splash: no limite, a tela de endereço');
  }

  // ---------- 6. Primeira abertura (sem servidor escolhido) ----------
  {
    const { app, ate } = await abrir({});
    const j = await ate(foiFechada, 'a primeira abertura devia mostrar a tela de endereço depois da splash');
    const principal = j.find(x => x.nome === 'principal');
    assert.match(principal.eventos.find(e => e.tipo === 'carregou').url, /endereco\.html/);
    assert.ok(evento(principal, 'show').em - j[0].criada >= MINIMO - 60, 'mesmo com a tela local pronta na hora, a splash dura o mínimo');
    await app.close();
    console.log('PASS: na primeira abertura a splash dura o mínimo e dá lugar à tela de endereço');
  }

  // ---------- 7. Quando não há splash ----------
  for (const [nome, opcoes] of [['aberto pelo sistema ao entrar no computador', { args: ['--em-segundo-plano'] }], ['NEXO_SEM_SPLASH', { ambiente: { NEXO_SEM_SPLASH: '1' } }]]) {
    const { s, endereco } = await servidor();
    const { app, janelas } = await abrir({ endereco, ...opcoes });
    await new Promise(r => setTimeout(r, 1800));
    const j = await janelas();
    assert.deepEqual(j.map(x => x.nome), ['principal'], `${nome}: sem splash`);
    assert.equal(j[0].pedido.show, true, `${nome}: e a janela principal nasce como sempre`);
    await app.close();
    s.close();
  }
  console.log('PASS: aberto pelo sistema (minimizado) ou com NEXO_SEM_SPLASH não há splash, e a janela nasce como sempre');
})().then(() => console.log('PASS: a splash do aplicativo de mesa')).catch(erro => { console.error(erro); process.exitCode = 1; });
