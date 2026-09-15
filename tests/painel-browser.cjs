const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');

const saida = path.join(__dirname, '..', 'test-results', 'painel');
const erros = [];
let navegador;
function acompanhar(pagina) { pagina.on('pageerror', e => erros.push(e.message)); }
async function entrar(pagina, servidor) {
  acompanhar(pagina); await pagina.goto(servidor.origem + '/painel');
  await pagina.locator('#segredo').fill(await servidor.chave());
  await pagina.getByRole('button', { name: 'Entrar no painel' }).click();
  await pagina.waitForURL('**/painel');
  await pagina.locator('nexo-fontes h3').waitFor();
  await pagina.waitForFunction(() => document.querySelector('#conexao').textContent.startsWith('Ao vivo'));
}
async function semTransbordamento(pagina) {
  assert.ok(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'a página não deve transbordar horizontalmente');
}
async function painelComDados() {
  const agora = Date.now(), registros = [], observacoes = [];
  for (let i = 143; i >= 0; i--) {
    const t = new Date(agora - i * 3600000).toISOString(), pico = i % 24 >= 6 && i % 24 < 12;
    registros.push({ v: 2, t, segundos: 3600, sala: i % 3 ? 'squad' : 'resenha', pessoas: pico ? 8 : 2, amostras: 120, screen: pico ? 6e9 : 3e8, camera: 6e7, micAudio: 2e7, musica: 3e7, soundboard: 1e6, chat: 100000 });
    observacoes.push({ v: 1, t, segundos: 3600, simultaneas: pico ? 3 : 1, picoSimultaneas: pico ? 4 : 2, distribuicao: { '2': 1800, '3–6': 1200, '7–15': 600 }, salasConcluidas: 1, segundosSalas: 7200, sessoesConcluidas: 3, segundosPermanencia: 14400, picoRedeMbps: pico ? 320 : 18, telas1440: pico ? 2 : 0, eventosSfu: { publicacoes: 6, republicacoes: 1, entradas: 3, saidas: 3 } });
  }
  const servidor = await iniciarServidor({ registros, observacoes });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const pagina = await contexto.newPage(); await entrar(pagina, servidor);
    await semTransbordamento(pagina);
    assert.ok(!await pagina.locator('body').innerText().then(t => /\b(undefined|NaN|null)\b/.test(t)));
    await pagina.screenshot({ path: path.join(saida, 'desktop.png') });
    assert.ok(await pagina.locator('svg[role="img"]').count() >= 5);
    const graficosAcessiveis = await pagina.locator('svg[role="img"]').evaluateAll(graficos => graficos.every(g => g.getAttribute('aria-label') && [...g.closest('.cartao').querySelectorAll('caption')].some(c => c.textContent === g.getAttribute('aria-label'))));
    assert.ok(graficosAcessiveis, 'cada gráfico precisa da tabela equivalente');
    await pagina.locator('#cenario-gb').fill('0.12');
    await pagina.locator('#cenario-base').fill('25'); await pagina.locator('#cenario-franquia').fill('1000'); await pagina.locator('#cenario-excedente').fill('0.03');
    assert.ok((await pagina.locator('nexo-projecao .resultados').innerText()).includes('US$'));
    await pagina.locator('#cenario-gb').focus();
    await pagina.waitForTimeout(10500);
    assert.equal(await pagina.locator('#cenario-gb').inputValue(), '0.12');
    assert.equal(await pagina.evaluate(() => document.activeElement.id), 'cenario-gb');
    await pagina.keyboard.press('Tab');
    assert.ok(await pagina.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
    const resposta = pagina.waitForResponse(r => r.url().includes('/api/resumo?periodo=hoje'));
    await pagina.locator('#periodo').selectOption('hoje'); assert.equal((await resposta).status(), 200);
    await pagina.setViewportSize({ width: 2560, height: 1440 }); await pagina.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); }); await semTransbordamento(pagina);
    await pagina.screenshot({ path: path.join(saida, '1440p.png') });
    await pagina.setViewportSize({ width: 390, height: 844 }); await pagina.evaluate(() => scrollTo(0, 0)); await semTransbordamento(pagina);
    await pagina.screenshot({ path: path.join(saida, 'celular.png') });
    await pagina.screenshot({ path: path.join(saida, 'celular-completo.png'), fullPage: true });
    await pagina.locator('#sair').click(); await pagina.waitForURL('**/painel/entrar');
    assert.equal((await contexto.request.get(servidor.origem + '/painel/api/resumo')).status(), 401);
    await pagina.screenshot({ path: path.join(saida, 'entrada.png') });
  } finally { await contexto.close(); await servidor.encerrar(); }
}
async function primeiroDia() {
  const servidor = await iniciarServidor(), contexto = await navegador.newContext();
  try {
    const pagina = await contexto.newPage(); await entrar(pagina, servidor);
    assert.ok((await pagina.locator('nexo-projecao').innerText()).includes('Amostra insuficiente'));
    assert.ok((await pagina.locator('nexo-alertas').innerText()).includes('Nenhum limite atingido'));
    await pagina.screenshot({ path: path.join(saida, 'primeiro-dia.png'), fullPage: true });
    const sala = await contexto.newPage(); acompanhar(sala);
    sala.on('response', r => { if (new URL(r.url()).pathname.startsWith('/rtc') && r.status() >= 400) console.error('Resposta de sinalização:', r.status(), new URL(r.url()).pathname); });
    await sala.goto(servidor.origem + '/squad-teste/sala'); await sala.locator('#nameInput').fill('Teste sem mídia'); await sala.locator('#nameConfirmBtn').click();
    await sala.waitForFunction(() => socket?.connected && tiles.has('self'));
    assert.ok(await sala.evaluate(() => Boolean(credencialSessao && myId === identidadeSessao)));
  } finally { await contexto.close(); await servidor.encerrar(); }
}
async function midiaReal() {
  const servidor = await iniciarServidor({ midia: true }), contexto = await navegador.newContext();
  try {
    const pagina = await contexto.newPage(); await entrar(pagina, servidor);
    const sala = await contexto.newPage(); acompanhar(sala);
    await sala.goto(servidor.origem + '/squad-teste/sala'); await sala.locator('#nameInput').fill('Tela de teste'); await sala.locator('#nameConfirmBtn').click();
    try { await sala.waitForFunction(() => transporte?.conectada && socket?.connected, null, { timeout: 30000 }); }
    catch (erro) { console.error('Estado da fixture de mídia:', await sala.evaluate(() => ({ status: document.getElementById('status').textContent, transporte: transporte?.sala.state, socket: socket?.connected, temCredencial: Boolean(credencialSessao) })), servidor.erros()); throw erro; }
    await sala.evaluate(async () => {
      const tela = document.createElement('canvas'); tela.width = 2560; tela.height = 1440;
      const pintar = () => { const c = tela.getContext('2d'); c.fillStyle = '#8879f6'; c.fillRect(0, 0, 2560, 1440); };
      pintar(); const fonte = tela.captureStream(5); window.faixaDeTeste = fonte.getVideoTracks()[0];
      window.timerDeTeste = setInterval(pintar, 200);
      await transporte.sala.localParticipant.publishTrack(window.faixaDeTeste, { source: 'screen_share', simulcast: false });
    });
    let atual;
    for (let n = 0; n < 40; n++) {
      atual = (await (await contexto.request.get(servidor.origem + '/painel/api/resumo')).json()).atual;
      if (atual.eventosSfu.publicacoes && atual.sfu.participantesAtuais.some(p => p.faixas.some(f => f.altura === 1440))) break;
      await pagina.waitForTimeout(250);
    }
    assert.ok(atual.eventosSfu.publicacoes > 0, 'o webhook assinado da publicação real deve chegar');
    assert.ok(atual.sfu.participantesAtuais.some(p => p.faixas.some(f => f.altura === 1440 && f.fonte === 'screen_share')));
    await pagina.waitForFunction(() => document.querySelector('nexo-salas').textContent.includes('1440p+'), null, { timeout: 15000 });
    await pagina.locator('nexo-salas').screenshot({ path: path.join(saida, 'publicacao-real.png') });
    await sala.evaluate(async () => { clearInterval(window.timerDeTeste); await transporte.sala.localParticipant.unpublishTrack(window.faixaDeTeste); window.faixaDeTeste.stop(); });
  } finally { await contexto.close(); await servidor.encerrar(); }
}
(async () => {
  await fs.mkdir(saida, { recursive: true });
  navegador = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try { if (process.env.TEST_PAINEL_MIDIA !== '1') { await painelComDados(); await primeiroDia(); } await midiaReal(); assert.deepEqual(erros, []); console.log('Painel aprovado: desktop, 1440p, celular, teclado, tabelas, SSE, logout, estado vazio e publicação real no SFU.'); }
  finally { await navegador.close(); }
})().catch(erro => { console.error(erro); process.exitCode = 1; });
