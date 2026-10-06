// O aviso visual de que alguém começou algo na sala (atividade.js): quem está com o palco na frente não
// recebe balão nenhum; quem está com o chat em foco, com o início por cima da sala ou com a janela em
// segundo plano recebe um aviso com "Assistir" (o aviso do canto, o ponto no título da aba e, com a
// permissão dada, uma notificação do sistema sem som). "Não incomodar" cala só a notificação do sistema.
// Três pessoas de verdade numa sala com servidor de mídia; a tela é um canvas desenhado pela página.
//
//   npm run test:atividade
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3245;
const origem = `http://localhost:${porta}`;
const sala = 'squad-atividade';
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function telaSintetica(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const ctx = canvas.getContext('2d');
      let quadro = 0;
      setInterval(() => { ctx.fillStyle = '#284e75'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#eee'; ctx.fillRect(40 + (++quadro % 300), 200, 120, 80); }, 66);
      return canvas.captureStream(15);
    } });
  });
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}
const compartilhar = async pagina => {
  await pagina.locator('#screenBtn').click();
  await pagina.locator('#confirmScreenBtn').click();
  await pagina.waitForFunction(() => Boolean(screenStream), null, { timeout: 15000 });
};
const parar = pagina => pagina.evaluate(() => pararTela());
const avisos = pagina => pagina.locator('.nexo-toast strong').allTextContents();
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));
// Um interruptor de Configurações → Sons → Avisos na tela: abre o painel, vira e fecha (ele cobre a sala).
async function configurar(pagina, id, ligado) {
  await pagina.evaluate(() => NexoConfig.abrir('sons'));
  await pagina.locator('#painelSons').waitFor({ state: 'visible' });
  await pagina.locator(`#${id}`).setChecked(ligado, { force: true });
  await pagina.locator('#devicesClose').click();
  await pagina.locator('#devicesPanel').waitFor({ state: 'hidden' });
}

(async () => {
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const contextos = {};
  for (const nome of ['Ana', 'Caio', 'Bia']) {
    contextos[nome] = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
    await telaSintetica(contextos[nome]);
  }
  const ana = await entrar(contextos.Ana, 'Ana');
  const caio = await entrar(contextos.Caio, 'Caio');
  const bia = await entrar(contextos.Bia, 'Bia');
  for (const pagina of [ana, caio, bia]) await pagina.waitForFunction(() => peers.size === 2, null, { timeout: 30000 });
  // Os avisos só valem depois de a sala assentar (3 s): quem acabou de entrar não é avisado do que já existia.
  await dormir(3600);

  // ---------- Com o palco na frente: nenhum balão ----------
  await compartilhar(ana);
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana' && p.state.screen), null, { timeout: 20000 });
  await dormir(700);
  assert.deepEqual(await avisos(bia), [], 'o palco à vista já é o aviso: sem balão por cima dele');
  await parar(ana);
  await bia.waitForFunction(() => ![...peers.values()].some(p => p.name === 'Ana' && p.state.screen), null, { timeout: 20000 });

  // ---------- Com o chat em foco: o palco está escondido ----------
  await bia.locator('#chatFocusBtn').click();
  await bia.locator('.app.foco-chat').waitFor();
  await compartilhar(caio);
  await bia.locator('.nexo-toast strong', { hasText: 'Caio começou a compartilhar a tela' }).waitFor({ timeout: 15000 });
  const botaoAssistir = bia.locator('.nexo-toast-acoes button', { hasText: 'Assistir' });
  assert.equal(await botaoAssistir.count(), 1, 'o aviso traz o "Assistir"');
  await bia.screenshot({ path: 'test-results/atividade-chat-em-foco.png' });
  await botaoAssistir.click();
  await bia.waitForFunction(() => !document.querySelector('.app').classList.contains('foco-chat'), null, { timeout: 5000 });
  await bia.waitForFunction(() => [...peers.values()].find(p => p.name === 'Caio')?.assistindo === true, null, { timeout: 10000 });
  await bia.waitForFunction(() => document.querySelectorAll('.nexo-toast:not(.saindo)').length === 0, null, { timeout: 3000 }); // some ao agir (a saída leva 400 ms)

  // A tela que sai do ar tira o aviso que ainda esperava um clique.
  await bia.locator('#chatFocusBtn').click();
  await bia.locator('.app.foco-chat').waitFor();
  await parar(caio);
  await bia.waitForFunction(() => ![...peers.values()].some(p => p.name === 'Caio' && p.state.screen), null, { timeout: 20000 });
  await bia.locator('#chatFocusBtn').click(); // volta ao palco

  // ---------- Com o início por cima da sala (a camada) ----------
  await bia.evaluate(() => {
    window.camadaFechadaPeloAviso = 0;
    window.NexoInicioNaSala = { ...window.NexoInicioNaSala, aberta: () => !window.camadaFechadaPeloAviso, fechar: () => { window.camadaFechadaPeloAviso++; } };
  });
  await dormir(8500); // o fim de uma tela e o começo seguinte, dentro de 8 s, são a mesma transmissão
  await compartilhar(ana);
  await bia.locator('.nexo-toast strong', { hasText: 'Ana começou a compartilhar a tela' }).waitFor({ timeout: 15000 });
  await bia.locator('.nexo-toast-acoes button', { hasText: 'Assistir' }).click();
  assert.equal(await bia.evaluate(() => window.camadaFechadaPeloAviso), 1, '"Assistir" fecha o início que cobria o palco');
  await bia.waitForFunction(() => [...peers.values()].find(p => p.name === 'Ana')?.assistindo === true, null, { timeout: 10000 });
  await parar(ana);
  await bia.waitForFunction(() => ![...peers.values()].some(p => p.name === 'Ana' && p.state.screen), null, { timeout: 20000 });
  await bia.evaluate(() => { window.camadaFechadaPeloAviso = 1; }); // a camada "fechou"

  // ---------- Com a janela em segundo plano: título e notificação do sistema ----------
  await bia.evaluate(() => {
    window.notificacoes = [];
    window.Notification = class {
      static permission = 'granted';
      static async requestPermission() { return 'granted'; }
      constructor(titulo, opcoes) { notificacoes.push({ titulo, ...opcoes }); }
      close() {}
    };
    // A janela em outro lugar: o navegador diria `hidden` e tiraria o foco.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.hasFocus = () => false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Sem ligar "Avisos do sistema" nas configurações, só o título muda.
  await dormir(8500);
  const tituloAntes = await bia.title();
  await compartilhar(caio);
  await bia.waitForFunction(() => document.title.startsWith('● Caio compartilhou a tela'), null, { timeout: 15000 });
  assert.equal(await bia.evaluate(() => notificacoes.length), 0, 'sem a opção ligada, o sistema não é incomodado');
  assert.equal(await avisos(bia).then(a => a.length), 0, 'e nada se desenha numa janela que ninguém vê');
  await parar(caio);

  // Ligar a opção pelo interruptor das configurações (que pede a permissão ao navegador).
  await configurar(bia, 'avisosSistema', true);
  await bia.waitForFunction(() => Preferencias.ler('avisosVisuais', {}).sistema === true);
  await dormir(8500);
  await compartilhar(ana);
  await bia.waitForFunction(() => notificacoes.length === 1, null, { timeout: 15000 });
  const notificacao = await bia.evaluate(() => notificacoes[0]);
  assert.equal(notificacao.titulo, 'Ana começou a compartilhar a tela');
  assert.equal(notificacao.silent, true, 'sem som: a sala já tocou o dela');
  assert.match(notificacao.body, new RegExp(`Sala ${sala}`));
  await parar(ana);

  // "Não incomodar" cala a notificação do sistema.
  await bia.evaluate(() => { NexoSocial.estado.minha = { escolhido: 'ocupado' }; });
  await dormir(8500);
  await compartilhar(caio);
  await bia.waitForFunction(() => document.title.startsWith('● Caio'), null, { timeout: 15000 });
  assert.equal(await bia.evaluate(() => notificacoes.length), 1, 'em "não incomodar", nenhuma notificação a mais');
  await parar(caio);
  await bia.evaluate(() => { NexoSocial.estado.minha = null; });

  // Voltar à janela tira o ponto do título.
  await bia.evaluate(() => {
    delete document.hidden;
    delete document.hasFocus;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await bia.title(), tituloAntes, 'voltar à janela devolve o título');

  // ---------- Desligado, nada aparece ----------
  await configurar(bia, 'avisosAtividade', false);
  await bia.locator('#chatFocusBtn').click();
  await bia.locator('.app.foco-chat').waitFor();
  assert.equal(await bia.evaluate(() => Preferencias.ler('avisosVisuais', {}).atividade), false);
  await dormir(8500);
  await compartilhar(ana);
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana' && p.state.screen), null, { timeout: 20000 });
  await dormir(800);
  assert.deepEqual(await avisos(bia), [], 'com "Avisar quando alguém começar algo" desligado, nada aparece');
  await parar(ana);

  // ---------- A música ----------
  // O estado chega pelo socket, como quando o bot toca: de um canal parado para uma faixa.
  await bia.locator('#chatFocusBtn').click(); // sai do foco; o aviso da música vale com o palco à vista?
  await bia.locator('.app:not(.foco-chat)').waitFor();
  await configurar(bia, 'avisosAtividade', true);
  await bia.locator('#chatFocusBtn').click(); // de volta ao chat em foco: o palco coberto
  await bia.locator('.app.foco-chat').waitFor();
  const faixa = nome => ({ conectado: true, tocando: { id: `faixa-${nome}`, titulo: 'Faixa de teste', autor: 'Artista', pedidoPor: nome, decorrido: 0, duracao: 200 }, fila: [], volume: 15, pausado: false, repetir: 'nao' });
  const vazio = { conectado: true, tocando: null, fila: [], volume: 15, pausado: false, repetir: 'nao' };
  const doServidor = estado => bia.evaluate(estado => socket.listeners('musica-estado').forEach(ouvir => ouvir(estado)), estado);
  await doServidor(faixa('Caio'));
  await bia.locator('.nexo-toast strong', { hasText: 'Caio pôs uma música' }).waitFor({ timeout: 5000 });
  assert.equal(await bia.locator('.nexo-toast small').first().textContent(), 'Faixa de teste');
  // A faixa seguinte da fila é a mesma atividade, e quem pediu sabe que pediu.
  await doServidor({ ...faixa('Caio'), tocando: { ...faixa('Caio').tocando, id: 'faixa-2', titulo: 'Outra' } });
  assert.equal(await bia.locator('.nexo-toast').count(), 1, 'a faixa seguinte não avisa de novo');
  await doServidor(vazio);
  await bia.locator('.nexo-toast-fechar').click();
  await doServidor(faixa('Bia'));
  await dormir(400);
  assert.equal(await bia.locator('.nexo-toast strong', { hasText: 'Bia pôs' }).count(), 0, 'quem pediu a música não é avisado dela');

  console.log('PASS: o aviso de atividade só aparece para quem não está com o palco à vista (chat em foco, início por cima, janela em segundo plano), traz "Assistir" e respeita "não incomodar" e as configurações');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
