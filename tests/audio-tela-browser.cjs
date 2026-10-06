// O som da tela não pode morrer calado. Dois sintomas que chegavam de quem compartilha o som do sistema: a
// tela sobe SEM o controle de volume (a faixa de som nem existia) ou COM o controle e sem som nenhum -- e só
// parar e compartilhar de novo consertava.
//
// Um "agente" falso (WebSocket em Node) se comporta como o AgenteAudio.exe: só captura depois de `iniciar`, para
// ao cair e recusa quando mandam. Quem assiste mede o som de verdade (um seno de 1 kHz) numa segunda página.
//
//   agente-cai     a conexão do agente com o servidor cai e volta no meio da transmissão
//   socket-cai     o socket da página cai e volta (o servidor manda o agente parar ao ver a queda)
//   erro-inicio    o agente recusa o primeiro `iniciar` e aceita o seguinte
//   agente-tardio  a tela sobe ANTES de o agente conectar e o som entra na transmissão que já está no ar
//   agente-na-espera  o agente conecta enquanto a captura espera por ele: a tela já sobe com som
//
//   npm run test:audio-tela
const { chromium } = require('playwright');
const { WebSocket } = require('ws');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');

let instancia, navegador, origem;
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

const bloco = (frequencia, primeiro) => {
  const b = Buffer.alloc(441 * 4);
  for (let i = 0; i < 441; i++) {
    const s = Math.round(Math.sin(2 * Math.PI * frequencia * (primeiro + i) / 44100) * 16000);
    b.writeInt16LE(s, i * 4); b.writeInt16LE(s, i * 4 + 2);
  }
  return b;
};

// A tela e o aplicativo falsos: o canvas faz de tela e `appNativo` faz de Electron com o agente à parte.
async function prepararMostra(contexto) {
  await contexto.addInitScript(() => {
    Object.defineProperty(window, 'appNativo', { value: {
      pid: 43210, prepararCaptura: async () => true, capturaSelecionada: async () => null,
      encerreiCaptura: async () => {}, aoEncerrarCaptura: () => {},
      estadoDoAgente: async () => ({ rodando: true, disponivel: true, loopback: false, plataforma: 'win32' })
    } });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => {
      const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const x = c.getContext('2d'); let q = 0;
      setInterval(() => { x.fillStyle = '#284e75'; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#eee'; x.fillRect(40 + (++q % 300), 200, 120, 80); }, 66);
      return c.captureStream(15);
    } });
  });
}

async function entrar(contexto, sala, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => console.error('erro na página', nome, erro.message));
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

// O agente falso. `recusarOsPrimeiros`: quantos `iniciar` respondem com erro antes de aceitar.
function criarAgente(token, { recusarOsPrimeiros = 0 } = {}) {
  const agente = { ws: null, comandos: [], recusar: recusarOsPrimeiros, parar: () => {} };
  agente.conectar = async () => {
    const ws = new WebSocket(`${origem.replace('http:', 'ws:')}/agente?token=${token}`);
    await new Promise((resolve, rejeitar) => { ws.once('open', resolve); ws.once('error', rejeitar); });
    ws.on('message', dados => {
      const m = JSON.parse(dados.toString());
      agente.comandos.push(m.acao);
      if (m.acao === 'escolha') ws.send(JSON.stringify({ evento: 'aplicativos', lista: [], atual: '', modo: m.modo }));
      if (m.acao === 'parar') { agente.parar(); agente.parar = () => {}; }
      if (m.acao === 'iniciar') {
        agente.parar();
        if (agente.recusar > 0) { agente.recusar--; ws.send(JSON.stringify({ evento: 'erro', mensagem: 'falha ao iniciar a captura' })); return; }
        ws.send(JSON.stringify({ evento: 'capturando', modo: 'excluir-pid', alvo: 'pid 1' }));
        const inicio = performance.now(); let enviados = 0;
        const t = setInterval(() => { while (enviados < (performance.now() - inicio) / 10) ws.send(bloco(1000, 441 * enviados++)); }, 5);
        agente.parar = () => clearInterval(t);
      }
    });
    // O agente de verdade para de capturar quando a conexão cai.
    ws.on('close', () => { agente.parar(); agente.parar = () => {}; });
    agente.ws = ws;
  };
  agente.derrubar = () => agente.ws?.terminate();
  agente.encerrar = () => { agente.parar(); try { agente.ws?.terminate(); } catch (_) { /* já caiu */ } };
  return agente;
}

// O que quem assiste ouve: se há faixa, e a energia do som que chega nela.
const medir = assiste => assiste.evaluate(async () => {
  const par = [...peers.values()][0];
  const tem = telaTemSom(par.id);
  if (!par.remoteStreams.screenAudio.getAudioTracks().length) return { tem, rms: 0 };
  const ctx = new AudioContext();
  const analisador = ctx.createAnalyser(); analisador.fftSize = 4096;
  ctx.createMediaStreamSource(par.remoteStreams.screenAudio).connect(analisador);
  await new Promise(r => setTimeout(r, 700));
  const onda = new Float32Array(analisador.fftSize); analisador.getFloatTimeDomainData(onda);
  const rms = Math.sqrt(onda.reduce((s, x) => s + x * x, 0) / onda.length);
  await ctx.close();
  return { tem, rms: Number(rms.toFixed(3)) };
});

async function esperarSom(assiste, segundos, rotulo, agente) {
  let ultimo = null;
  const fim = Date.now() + segundos * 1000;
  while (Date.now() < fim) {
    ultimo = await medir(assiste);
    if (ultimo.tem && ultimo.rms > 0.05) return ultimo;
    await dormir(100);
  }
  assert.fail(`${rotulo}: sem som em ${segundos} s (${JSON.stringify(ultimo)}; o agente recebeu: ${agente.comandos.join(',') || 'nada'})`);
}

async function cenario(nome, sala, corpo, { agenteAntes = true, agente: opcoesDoAgente } = {}) {
  const inicio = Date.now();
  const ctxMostra = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  await prepararMostra(ctxMostra);
  const ctxAssiste = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  let agente;
  try {
    const mostra = await entrar(ctxMostra, sala, 'Mostra');
    const assiste = await entrar(ctxAssiste, sala, 'Assiste');
    await assiste.waitForFunction(() => peers.size === 1, null, { timeout: 30000 });
    await mostra.waitForFunction(() => peers.size === 1, null, { timeout: 30000 });
    agente = criarAgente(await mostra.evaluate(() => tokenDoAgente), opcoesDoAgente);
    if (agenteAntes) {
      await agente.conectar();
      await mostra.waitForFunction(() => audioCapabilities.agenteConectado, null, { timeout: 10000 });
    }
    await corpo({ mostra, assiste, agente });
    console.log(`ok  ${nome} (${((Date.now() - inicio) / 1000).toFixed(1)} s)`);
  } finally {
    agente?.encerrar();
    await ctxMostra.close();
    await ctxAssiste.close();
  }
}

// Compartilha a tela do jeito que a pessoa faz: abre o painel, escolhe a tela inteira e confirma; quem assiste
// clica em "assistir" (a tela só chega a quem pediu).
async function compartilhar(mostra, assiste, { esperarOQuadro = true } = {}) {
  await mostra.locator('#screenBtn').click();
  await mostra.evaluate(() => { audioPolicy.value = 'auto'; captureMode.value = 'monitor'; });
  const id = await assiste.evaluate(() => [...peers.values()][0].id);
  await mostra.locator('#confirmScreenBtn').click();
  if (esperarOQuadro) {
    await assiste.waitForFunction(() => [...peers.values()][0]?.state.screen, null, { timeout: 20000 });
    await assiste.evaluate(idDoPar => assistirTela(idDoPar, true), id);
  }
  return id;
}

(async () => {
  instancia = await iniciarServidor({ midia: true });
  origem = instancia.origem;
  navegador = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    await cenario('o agente cai e volta no meio da transmissão: o som volta sozinho', 'audio-agente-cai', async ({ mostra, assiste, agente }) => {
      await compartilhar(mostra, assiste);
      await esperarSom(assiste, 12, 'antes da queda', agente);
      agente.comandos.length = 0;
      agente.derrubar();
      await dormir(1500);
      await agente.conectar();
      await esperarSom(assiste, 20, 'depois de o agente voltar', agente);
      assert.ok(agente.comandos.includes('iniciar'), 'a página pediu a captura de novo ao agente que voltou');
    });

    await cenario('o socket da página cai e volta: o som volta sozinho', 'audio-socket-cai', async ({ mostra, assiste, agente }) => {
      await compartilhar(mostra, assiste);
      await esperarSom(assiste, 12, 'antes da queda', agente);
      agente.comandos.length = 0;
      await mostra.evaluate(() => { socket.io.engine.close(); });
      await esperarSom(assiste, 25, 'depois de o socket voltar', agente);
    });

    await cenario('o agente recusa o primeiro pedido: a página insiste e o som chega', 'audio-erro-inicio', async ({ mostra, assiste, agente }) => {
      await compartilhar(mostra, assiste);
      await esperarSom(assiste, 25, 'depois da recusa', agente);
      const pedidos = agente.comandos.filter(c => c === 'iniciar').length;
      assert.ok(pedidos >= 2, `a página repetiu o pedido (${pedidos} pedidos)`);
    }, { agente: { recusarOsPrimeiros: 1 } });

    await cenario('a tela sobe antes do agente: o som entra na transmissão que já está no ar', 'audio-agente-tardio', async ({ mostra, assiste, agente }) => {
      await compartilhar(mostra, assiste);
      // A tela já está no ar, sem som e sem o controle de volume.
      const antes = await medir(assiste);
      assert.equal(antes.tem, false, 'sem agente a tela sobe sem faixa de som');
      await agente.conectar();
      await esperarSom(assiste, 20, 'depois de o agente conectar', agente);
      assert.match(await mostra.locator('#status').textContent(), /som do sistema entrou/i);
    }, { agenteAntes: false });

    await cenario('o agente conecta durante a espera da captura: a tela já sobe com som', 'audio-agente-na-espera', async ({ mostra, assiste, agente }) => {
      await mostra.locator('#screenBtn').click();
      await mostra.evaluate(() => { audioPolicy.value = 'auto'; captureMode.value = 'monitor'; });
      const id = await assiste.evaluate(() => [...peers.values()][0].id);
      await mostra.locator('#confirmScreenBtn').click();
      await dormir(400);
      await agente.conectar();
      await assiste.waitForFunction(() => [...peers.values()][0]?.state.screen, null, { timeout: 20000 });
      await assiste.evaluate(idDoPar => assistirTela(idDoPar, true), id);
      await esperarSom(assiste, 15, 'com o agente conectando durante a espera', agente);
      assert.equal(await mostra.evaluate(() => somPendenteDoAgente), null, 'nada ficou pendente: a tela já subiu com o som');
    }, { agenteAntes: false });

    console.log('Som da tela: tudo certo.');
  } finally {
    await navegador.close();
    await instancia.encerrar();
  }
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
