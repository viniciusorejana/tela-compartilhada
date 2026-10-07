// O carregamento do Nexo (docs/interface.md, 4.19): a tela cheia da troca de página e da abertura, as peças pequenas
// (anel, esqueleto, botão ocupado) e o fundo que nunca deixa o canvas branco. A espera de verdade é forçada atrasando
// arquivos e respostas do servidor de teste.
//
//   npm run test:carregando
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3247;
const origem = `http://localhost:${porta}`;
const erros = [];
let instancia, navegador;

const observar = (pagina, nome) => { pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); }); return pagina; };
async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) { if (await condicao()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error(mensagem);
}
const comConta = async (conta, opcoes = {}, aoCriar = null) => {
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, ...opcoes });
  await contexto.addCookies([{ name: 'nexo_conta', value: conta.cookie.split('=')[1], url: origem }]);
  if (aoCriar) await aoCriar(contexto);
  return contexto;
};
const atrasar = (contexto, padrao, ms) => contexto.route(padrao, async rota => { await new Promise(resolve => setTimeout(resolve, ms)); rota.continue(); });
// O que a tela fez desde o primeiro quadro: se ficou visível alguma vez, e como nasceu.
const vigiarATela = contexto => contexto.addInitScript(() => {
  // `niveis`: os graus pelos quais a tela passou, na ordem; `prontaEm` e `fimEm`: quando a página disse "pronto" e quando a
  // tela saiu do DOM (a saída é mais curta quanto menos a tela mostrou).
  window.__tela = { criada: false, viuSeAcender: false, nasceuAcesa: null, titulo: null, niveis: [], prontaEm: null, fimEm: null };
  new MutationObserver(() => {
    const tela = document.getElementById('nexoCarregando');
    if (!tela) { if (window.__tela.criada && window.__tela.fimEm === null) window.__tela.fimEm = performance.now(); return; }
    if (!window.__tela.criada) { window.__tela.criada = true; window.__tela.nasceuAcesa = tela.classList.contains('visivel'); }
    window.__tela.titulo = tela.querySelector('.nx-tela-titulo')?.textContent || window.__tela.titulo;
    if (tela.classList.contains('visivel')) window.__tela.viuSeAcender = true;
    const nivel = tela.dataset.nivel;
    if (nivel && window.__tela.niveis[window.__tela.niveis.length - 1] !== nivel) window.__tela.niveis.push(nivel);
    if (tela.classList.contains('pronta') && window.__tela.prontaEm === null) window.__tela.prontaEm = performance.now();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-nivel'] });
});
// A tela completa desde o primeiro instante: quem confere o que ela mostra não espera os segundos que os graus levam.
const telaCompleta = contexto => contexto.addInitScript(() => { window.NexoCarregandoAjustes = { ...(window.NexoCarregandoAjustes || {}), nivel2: 0, nivel3: 0 }; });
const telaAcesa = pagina => pagina.locator('#nexoCarregando.visivel');
const semTela = pagina => esperarAte(async () => (await pagina.locator('#nexoCarregando').count()) === 0, 'a tela de carregamento devia ter saído');

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anacarrega', { apelido: 'Ana' });
  const bia = await instancia.conta('biacarrega', { apelido: 'Bia Souza' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  assert.equal((await pedir(ana, '@biacarrega')).status, 201);
  assert.equal((await pedir(bia, '@anacarrega')).status, 200);
  navegador = await chromium.launch({ headless: true });

  // ---------- 1. Nada pisca: a página que abre depressa nunca acende a tela ----------
  {
    const contexto = await comConta(ana);
    await vigiarATela(contexto);
    const p = observar(await contexto.newPage(), 'apresentação');
    // A apresentação não espera ninguém: ela se resolve sozinha, no DOMContentLoaded.
    await p.goto(`${origem}/sobre`);
    await p.waitForTimeout(700);
    const estado = await p.evaluate(() => window.__tela);
    assert.equal(estado.criada, true, 'a tela nasce com a página (antes da primeira pintura)');
    assert.equal(estado.viuSeAcender, false, 'e, abrindo depressa, nunca chega a acender');
    assert.equal(await p.locator('#nexoCarregando').count(), 0, 'e já saiu');
    assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('aria-busy')), false);
    await contexto.close();
    console.log('PASS: uma página que abre depressa nunca mostra a tela de carregamento');
  }

  // ---------- 2. A espera de verdade: acende, anda, e some quando a página está pronta ----------
  {
    const contexto = await comConta(ana);
    await vigiarATela(contexto);
    await telaCompleta(contexto);
    await atrasar(contexto, '**/inicio.js', 1800);
    const p = observar(await contexto.newPage(), 'início lento');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    assert.equal(await p.locator('#nexoCarregando').getAttribute('role'), 'status', 'a tela é uma região de status');
    assert.equal(await p.locator('.nx-tela-titulo').textContent(), 'Abrindo o Nexo');
    assert.equal(await p.evaluate(() => document.documentElement.getAttribute('aria-busy')), 'true', 'e a página diz que está ocupada');
    const pct1 = parseInt(await p.locator('.nx-xp-rotulos b').textContent(), 10);
    await p.waitForTimeout(900);
    const pct2 = parseInt(await p.locator('.nx-xp-rotulos b').textContent(), 10);
    assert.ok(pct2 > pct1, `o andamento anda (${pct1}% → ${pct2}%)`);
    assert.ok(pct2 < 100, 'e não mente que acabou');
    assert.equal(await p.locator('.nx-xp-seg i').count(), 12, 'doze pedaços de XP');
    assert.ok(await p.locator('.nx-xp-seg i.on').count() >= 1, 'com pedaços acesos');
    assert.match(await p.locator('.nx-dica p').textContent(), /\S{4,}/, 'e uma dica');
    assert.ok(await p.locator('.nx-faisca').count() >= 1, 'e faíscas passando');
    await p.locator('#inicioApp').waitFor({ state: 'attached', timeout: 15000 });
    await semTela(p);
    const saida = await p.evaluate(() => window.__tela);
    assert.ok(saida.fimEm - saida.prontaEm >= 650, `a tela completa comemora um instante antes de sair (${Math.round(saida.fimEm - saida.prontaEm)} ms)`);
    assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('aria-busy')), false, 'a página sai do estado ocupado');
    await p.locator('#tituloSecao').waitFor();
    // A tela saiu sem prender nada: o início responde.
    await p.locator('#adicionarBtn').click();
    await p.locator('#vistaAdicionar').waitFor({ state: 'visible' });
    await contexto.close();
    console.log('PASS: a tela acende na espera, o andamento anda sem mentir, e some quando o início tem os amigos na mão');
  }

  // ---------- 3. Entrar numa sala: a tela acende aqui e a sala a abre já acesa, com o mesmo título ----------
  {
    const contexto = await comConta(ana);
    await vigiarATela(contexto);
    const p = observar(await contexto.newPage(), 'Ana');
    await p.goto(origem + '/');
    await p.locator('#inicioApp').waitFor();
    await p.evaluate(() => window.NexoConta?.pronto);
    await esperarAte(() => p.evaluate(() => !window.NexoCarregando.ativo()), 'o início devia estar pronto');
    // A sala demora a responder: dá tempo de ver a tela acesa na página que SAI.
    await atrasar(contexto, /\/sala-entrada\/sala$/, 1500);
    await p.locator('#abrirCodigo').fill('sala-entrada');
    // `noWaitAfter`: o clique, por padrão, espera a navegação que ele provoca terminar -- e o que se quer ver é a
    // página que SAI, enquanto a outra ainda demora.
    await p.locator('#abrirForm button[type="submit"]').click({ noWaitAfter: true });
    await telaAcesa(p).waitFor({ timeout: 4000 });
    assert.equal(await p.locator('.nx-tela-titulo').textContent(), 'Entrando em #sala-entrada', 'a página que sai já diz para onde vai');
    // (O recado para a página que chega se prova pela chegada, logo abaixo: um `evaluate` com a navegação pendente só
    // volta depois dela.)
    await p.waitForURL(/\/sala-entrada\/sala$/, { timeout: 15000 });
    const nascimento = await p.evaluate(() => window.__tela);
    assert.equal(nascimento.nasceuAcesa, true, 'a sala abre com a tela JÁ acesa: as duas telas são uma só');
    assert.equal(nascimento.titulo, 'Entrando em #sala-entrada');
    assert.equal(nascimento.niveis[0], '2', 'a espera já passava de um segundo e meio: a sala abre no grau 2, e não recomeça da marca (o relógio atravessa a troca)');
    await p.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    await semTela(p);
    assert.equal(await p.evaluate(() => sessionStorage.getItem('nexo.carregando')), null, 'o recado vale uma vez');
    console.log('PASS: entrar numa sala acende a tela na página que sai e a sala abre com ela acesa, até a chamada estar de pé');

    // ---------- 4. Sair da sala: "Saindo da sala" acende na hora, e o início abre com ela acesa ----------
    await atrasar(contexto, /\/$/, 1500);
    await p.locator('#leaveBtn').click({ noWaitAfter: true });
    await telaAcesa(p).waitFor({ timeout: 4000 });
    assert.equal(await p.locator('.nx-tela-titulo').textContent(), 'Saindo da sala', 'sair acende a tela, em vez de a sala ficar parada');
    await p.waitForURL(origem + '/', { timeout: 15000 });
    await p.locator('#inicioApp').waitFor({ state: 'attached' });
    await semTela(p);
    assert.equal(await p.locator('#tituloSecao').textContent(), 'Amigos');
    await contexto.close();
    console.log('PASS: sair da sala acende "Saindo da sala" na hora, e o início abre com a tela acesa');
  }

  // ---------- 5. As faíscas e o nível ----------
  {
    const contexto = await comConta(ana, {}, async c => { await c.addInitScript(() => { try { localStorage.setItem('nexoFaiscas', '9'); } catch (_) {} }); await telaCompleta(c); });
    await atrasar(contexto, '**/inicio.js', 2500);
    const p = observar(await contexto.newPage(), 'faíscas');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    assert.equal(await p.locator('.nx-nivel').isVisible(), true, 'com faíscas guardadas, o nível aparece');
    assert.equal(await p.locator('.nx-nivel span').textContent(), 'Nv 1 · 9');
    await p.locator('.nx-faisca').first().dispatchEvent('pointerdown');
    await p.locator('.nx-nivel span', { hasText: 'Nv 2 · 10' }).waitFor({ timeout: 3000 });
    assert.equal(await p.evaluate(() => localStorage.getItem('nexoFaiscas')), '10', 'a faísca pega é lembrada neste navegador');
    assert.equal(await p.locator('.nx-nivel.subiu').count(), 1, 'e a décima faz o nível subir');
    await esperarAte(async () => (await p.locator('.nx-faisca:not(.pegou)').count()) >= 3, 'uma nova faísca devia passar no lugar da pega');
    await contexto.close();
    console.log('PASS: pegar faíscas conta, é lembrado, e a décima sobe o nível');
  }

  // ---------- 6. Menos movimento: sem faíscas, sem brincadeira ----------
  {
    const contexto = await comConta(ana, { reducedMotion: 'reduce' }, telaCompleta);
    await atrasar(contexto, '**/inicio.js', 1500);
    const p = observar(await contexto.newPage(), 'calma');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    assert.equal(await p.locator('.nx-faisca').count(), 0, 'com menos movimento não passam faíscas');
    assert.equal(await p.locator('.nx-dica p').textContent() === 'Pegue as faíscas que passam: a cada dez, o seu nível sobe.', false, 'e a dica não fala de faíscas');
    assert.equal(await p.locator('.nx-orbita').evaluate(el => getComputedStyle(el).display), 'none', 'a órbita some');
    assert.ok(await p.locator('.nx-xp-seg').isVisible(), 'mas a barra continua dizendo que está carregando');
    await contexto.close();
    console.log('PASS: com menos movimento a tela fica quieta, e continua dizendo que carrega');
  }

  // ---------- 7. A espera longa: admite, oferece tentar de novo, e por fim sai sozinha ----------
  {
    const contexto = await comConta(ana, {}, c => c.addInitScript(() => { window.NexoCarregandoAjustes = { devagar: 500, desistir: 1800 }; }));
    // O início nunca fica pronto: o script dele é derrubado.
    await contexto.route('**/inicio.js', rota => rota.abort());
    const p = observar(await contexto.newPage(), 'devagar');
    p.on('console', () => {});
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    await p.locator('#nexoCarregando.devagar').waitFor({ timeout: 4000 });
    assert.equal(await p.locator('.nx-devagar button').isVisible(), true, 'depois de um tempo a tela admite que demora e oferece tentar de novo');
    assert.match(await p.locator('.nx-devagar span').textContent(), /demorando/);
    await semTela(p);
    assert.equal(await p.locator('#inicioApp').count(), 1, 'e por fim sai sozinha: a página nunca fica presa embaixo dela');
    await contexto.close();
    console.log('PASS: a espera longa admite que demora, oferece tentar de novo, e nunca prende a página');
  }

  // ---------- 8. Na camada não há tela cheia ----------
  {
    const contexto = await comConta(ana);
    const p = observar(await contexto.newPage(), 'camada');
    await p.goto(`${origem}/sala-da-camada/sala`);
    await p.evaluate(() => window.NexoConta?.pronto);
    await p.locator('#nameConfirmBtn').click();
    await p.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    await p.locator('.trilho-marca').click();
    await p.locator('.camada-quadro.pronto').waitFor({ timeout: 15000 });
    const quadro = p.frameLocator('.camada-quadro');
    assert.equal(await quadro.locator('#nexoCarregando').count(), 0, 'a página dentro da camada não tem tela cheia: a camada tem a espera dela');
    assert.equal(await quadro.locator('body').evaluate(() => typeof window.NexoCarregando.esqueleto), 'function', 'mas as peças pequenas existem');
    await contexto.close();
    console.log('PASS: dentro da camada não há tela cheia');
  }

  // ---------- 9. Tema claro, celular e janela baixa ----------
  for (const [nome, opcoes, tema] of [
    ['claro', { viewport: { width: 1280, height: 720 } }, 'claro'],
    ['celular estreito', { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }, null],
    ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, null],
    ['janela baixa', { viewport: { width: 700, height: 360 } }, null]
  ]) {
    // A tela completa: é a maior, e a que precisa caber.
    const contexto = await comConta(ana, opcoes, async c => { await telaCompleta(c); if (tema) await c.addInitScript(t => { try { localStorage.setItem('nexo.pref.aparencia', JSON.stringify({ tema: t })); } catch (_) {} }, tema); });
    await atrasar(contexto, '**/inicio.js', 1800);
    const p = observar(await contexto.newPage(), nome);
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    await p.waitForTimeout(400);
    const medidas = await p.evaluate(() => {
      const caixa = document.querySelector('.nx-tela-caixa').getBoundingClientRect();
      const fundo = getComputedStyle(document.getElementById('nexoCarregando')).backgroundColor.match(/\d+/g).map(Number);
      return { esq: caixa.left, dir: caixa.right, topo: caixa.top, base: caixa.bottom, L: innerWidth, A: innerHeight, sobra: document.documentElement.scrollWidth - innerWidth, luz: fundo[0] + fundo[1] + fundo[2] };
    });
    assert.ok(medidas.esq >= 0 && medidas.dir <= medidas.L, `${nome}: a caixa cabe na largura (${medidas.esq}–${medidas.dir} de ${medidas.L})`);
    assert.ok(medidas.topo >= 0 && medidas.base <= medidas.A + 1, `${nome}: e na altura (${Math.round(medidas.topo)}–${Math.round(medidas.base)} de ${medidas.A})`);
    assert.ok(medidas.sobra <= 0, `${nome}: nada rola para o lado`);
    assert.equal(tema === 'claro' ? medidas.luz > 600 : medidas.luz < 200, true, `${nome}: o fundo é do tema (${medidas.luz})`);
    await contexto.close();
  }
  console.log('PASS: a tela cabe de 320 a 1280 px e em janela baixa, e acompanha o tema claro');

  // ---------- 10. O canvas nunca é branco antes do CSS ----------
  {
    // Os arquivos demoram -- o CSS e até o tema.js: no primeiro instante da página, o <html> já é do tema.
    const escuro = await comConta(ana);
    await atrasar(escuro, /\.(css|js)$/, 1500);
    const p = observar(await escuro.newPage(), 'fundo escuro');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await esperarAte(() => p.evaluate(() => Boolean(document.documentElement)), 'a página devia ter começado');
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(25, 26, 36)', 'sem nenhum CSS ainda, o <html> já é o fundo escuro do Nexo');
    await escuro.close();
    // Quem usa um tema claro (ou cores exatas) vê o fundo do tema, e não um escuro que piscaria.
    const claro = await comConta(ana, {}, c => c.addInitScript(() => { try { localStorage.setItem('nexoFundo', '#f2f2f6'); localStorage.setItem('nexo.pref.aparencia', JSON.stringify({ tema: 'claro' })); } catch (_) {} }));
    await atrasar(claro, /\.(css|js)$/, 1500);
    const q = observar(await claro.newPage(), 'fundo claro');
    await q.goto(origem + '/', { waitUntil: 'commit' });
    await esperarAte(() => q.evaluate(() => Boolean(document.documentElement)), 'a página devia ter começado');
    assert.equal(await q.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(242, 242, 246)', 'o fundo guardado do tema claro vale antes de qualquer arquivo');
    await claro.close();
    // O tema guarda a cor quando a escolha muda, e a apaga no tema de sempre.
    const tema = await comConta(ana);
    const r = observar(await tema.newPage(), 'tema');
    await r.goto(origem + '/sobre');
    await r.evaluate(() => { localStorage.setItem('nexo.pref.aparencia', JSON.stringify({ tema: 'claro' })); NexoTema.aplicar(); });
    assert.match(await r.evaluate(() => localStorage.getItem('nexoFundo')), /^#[0-9a-f]{6}$/i, 'um tema claro deixa a cor do fundo guardada');
    await r.evaluate(() => { localStorage.removeItem('nexo.pref.aparencia'); NexoTema.aplicar(); });
    assert.equal(await r.evaluate(() => localStorage.getItem('nexoFundo')), null, 'e o tema de sempre a apaga');
    await tema.close();
    console.log('PASS: antes de qualquer arquivo o <html> já é do tema, escuro ou claro: o canvas nunca aparece branco');
  }

  // ---------- 11. As peças pequenas ----------
  {
    const contexto = await comConta(ana);
    const p = observar(await contexto.newPage(), 'peças');
    await p.goto(origem + '/');
    await p.locator('#inicioApp').waitFor();
    await esperarAte(() => p.evaluate(() => !window.NexoCarregando.ativo()), 'o início devia estar pronto');
    // O esqueleto: o lugar do que vai chegar.
    const esq = await p.evaluate(() => {
      const f = NexoCarregando.esqueleto('amigos', 3), c = NexoCarregando.esqueleto('cartoes', 4), l = NexoCarregando.esqueleto('linhas', 2);
      return { amigos: f.querySelectorAll('.nx-esq-item').length, avatares: f.querySelectorAll('.nx-esq.avatar').length, cartoes: c.querySelectorAll('.nx-esq.bloco').length, linhas: l.querySelectorAll('.nx-esq.linha').length, oculto: f.getAttribute('aria-hidden') };
    });
    assert.deepEqual(esq, { amigos: 3, avatares: 3, cartoes: 4, linhas: 2, oculto: 'true' }, 'o esqueleto desenha o que vai ter e fica fora do leitor de tela');
    // A roda: um arco com cauda, girando. (`.nx-anel` é outra coisa: o contador das novidades.)
    const anel = await p.evaluate(() => { const e = document.createElement('span'); e.className = 'nx-roda g'; document.body.append(e); const c = getComputedStyle(e), a = getComputedStyle(e, '::before'); const r = { tam: c.width, giro: c.animationName, mascara: a.maskImage !== 'none' || a.webkitMaskImage !== 'none' }; e.remove(); return r; });
    assert.equal(anel.tam, '44px', 'o anel grande tem 44 px');
    assert.equal(anel.giro, 'nexo-girar', 'e gira');
    assert.equal(anel.mascara, true, 'com o arco recortado como anel');
    // O botão ocupado: o anel no lugar do ícone, e parado até a resposta.
    await contexto.route('**/api/conta/amigos', async rota => { if (rota.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve, 900)); rota.continue(); });
    await p.locator('#adicionarBtn').click();
    await p.locator('#adicionarCampo').fill('@ninguem.por.aqui');
    await p.locator('#adicionarEnviar').click();
    await p.locator('#adicionarEnviar[aria-busy="true"]').waitFor({ timeout: 3000 });
    assert.equal(await p.locator('#adicionarRetorno').getAttribute('data-tom'), 'andamento', 'o retorno diz que está enviando, com o anel');
    assert.equal(await p.locator('#adicionarEnviar').evaluate(el => getComputedStyle(el, '::before').width), '14px', 'o botão ocupado desenha o anel');
    await p.locator('#adicionarEnviar:not([aria-busy])').waitFor({ timeout: 6000 });
    // O anel que já existia na sala de espera é o mesmo do Nexo.
    const espera = await p.evaluate(() => { const e = document.createElement('span'); e.className = 'waiting-spinner'; document.body.append(e); const r = getComputedStyle(e, '::after').clipPath !== 'none'; e.remove(); return r; });
    assert.equal(espera, true, 'o anel da sala de espera tem a faísca na ponta, como o do Nexo');
    await contexto.close();
    console.log('PASS: o esqueleto, o anel e o botão ocupado são as peças do Nexo');
  }

  // ---------- 12. O cartão de um amigo: o esqueleto só se demora, e fechar antes cancela ----------
  {
    const contexto = await comConta(ana);
    const p = observar(await contexto.newPage(), 'cartão');
    await p.goto(origem + '/');
    await p.locator('#inicioApp').waitFor();
    await esperarAte(() => p.evaluate(() => !window.NexoCarregando.ativo()), 'o início devia estar pronto');
    await p.locator('[data-aba="todos"]').click();
    await p.locator('#listaAmigos .nx-amigo-nome').first().waitFor();
    // Rápido (sem atraso): o cartão chega e o esqueleto nunca aparece.
    await p.evaluate(() => { window.__esq = 0; new MutationObserver(() => { if (document.querySelector('#cartaoModalCaixa .nx-esq-cartao')) window.__esq++; }).observe(document.getElementById('cartaoModalCaixa'), { childList: true, subtree: true }); });
    await p.locator('#listaAmigos .nx-amigo-nome').first().click();
    await p.locator('#cartaoModalCaixa .nx-cartao').waitFor({ timeout: 5000 });
    assert.equal(await p.evaluate(() => window.__esq), 0, 'um cartão que chega depressa não pisca esqueleto');
    await p.locator('#cartaoModal').click({ position: { x: 4, y: 4 } });
    await p.locator('#cartaoModal').waitFor({ state: 'hidden' });
    // Lento: o painel abre na hora com o lugar do cartão, e o cartão o substitui.
    await contexto.route(/\/api\/conta\/pessoa\//, async rota => { await new Promise(resolve => setTimeout(resolve, 1500)); rota.continue(); });
    await p.locator('#listaAmigos .nx-amigo-nome').first().click();
    await p.locator('#cartaoModalCaixa .nx-esq-cartao').waitFor({ timeout: 2000 });
    assert.equal(await p.locator('#cartaoModal').isVisible(), true, 'o painel já está aberto, com o esqueleto');
    assert.equal(await p.locator('#cartaoModalCaixa .nx-esq-cartao').getAttribute('aria-hidden'), 'true', 'e o esqueleto fica fora do leitor de tela');
    await p.locator('#cartaoModalCaixa .nx-cartao').waitFor({ timeout: 6000 });
    assert.equal(await p.locator('#cartaoModalCaixa .nx-esq-cartao').count(), 0, 'o cartão substitui o esqueleto');
    await p.locator('#cartaoModal').click({ position: { x: 4, y: 4 } });
    await p.locator('#cartaoModal').waitFor({ state: 'hidden' });
    // Fechar o painel antes de o cartão chegar cancela a abertura: ele não reabre quando a resposta chega.
    await p.locator('#listaAmigos .nx-amigo-nome').first().click();
    await p.locator('#cartaoModalCaixa .nx-esq-cartao').waitFor({ timeout: 2000 });
    await p.locator('#cartaoModal').click({ position: { x: 4, y: 4 } });
    await p.locator('#cartaoModal').waitFor({ state: 'hidden' });
    await p.waitForTimeout(2000);
    assert.equal(await p.locator('#cartaoModal').isVisible(), false, 'fechado antes de chegar, o cartão não reabre o painel sozinho');
    await contexto.close();
    console.log('PASS: o cartão de um amigo abre com esqueleto só se demora, e fechar antes de chegar cancela a abertura');
  }

  // ---------- 13. A tela é progressiva: nasce mínima e se completa em fusão, se a espera se alonga ----------
  {
    const contexto = await comConta(ana, {}, async c => { await vigiarATela(c); await c.addInitScript(() => { window.NexoCarregandoAjustes = { nivel2: 900, nivel3: 1900 }; }); });
    await atrasar(contexto, '**/inicio.js', 4200);
    const p = observar(await contexto.newPage(), 'progressiva');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await telaAcesa(p).waitFor({ timeout: 6000 });
    const ler = () => p.evaluate(() => {
      const op = s => parseFloat(getComputedStyle(document.querySelector(s)).opacity);
      return {
        nivel: document.getElementById('nexoCarregando').dataset.nivel, titulo: op('.nx-tela-titulo'), etapa: op('.nx-tela-etapa'), xp: op('.nx-xp'), dica: op('.nx-dica'), orbita: op('.nx-orbita'),
        emblema: parseFloat(getComputedStyle(document.querySelector('.nx-emblema')).zoom), faiscas: document.querySelectorAll('.nx-faisca').length, textoDaDica: document.querySelector('.nx-dica p').textContent, alturaDoTitulo: document.querySelector('.nx-tela-titulo').getBoundingClientRect().height
      };
    });
    // Grau 1: só a marca. O título está no DOM (para o leitor de tela) mas invisível, e o resto nem ocupa lugar.
    const um = await ler();
    assert.equal(um.nivel, '1', 'a tela acende no grau mínimo');
    assert.deepEqual([um.titulo, um.etapa, um.xp, um.dica, um.orbita], [0, 0, 0, 0, 0], `no grau 1 não há uma palavra, nem barra, nem dica, nem órbita: ${JSON.stringify(um)}`);
    assert.ok(um.emblema < 0.7, `e a marca é pequena (${um.emblema})`);
    assert.equal(um.faiscas, 0, 'sem faíscas passando');
    assert.equal(um.textoDaDica, '', 'e sem girar dicas que ninguém vê');
    assert.equal(await p.locator('.nx-tela-titulo').textContent(), 'Abrindo o Nexo', 'mas o título existe, para o leitor de tela (a tela é uma região de status)');
    // Grau 2: o título e a etapa entram em fusão; a barra e a dica ainda não.
    await p.waitForFunction(() => document.getElementById('nexoCarregando')?.dataset.nivel === '2', null, { timeout: 4000 });
    await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.nx-tela-titulo')).opacity) > 0.95, null, { timeout: 4000 });
    const dois = await ler();
    assert.deepEqual([dois.xp, dois.dica, dois.orbita], [0, 0, 0], `no grau 2 ainda não há barra, dica nem órbita: ${JSON.stringify(dois)}`);
    assert.ok(dois.emblema > um.emblema && dois.emblema < 1, `a marca cresceu (${um.emblema} → ${dois.emblema})`);
    assert.ok(dois.alturaDoTitulo > 10, 'e o título tem lugar');
    assert.equal(dois.faiscas, 0, 'sem faíscas ainda');
    // Grau 3: a tela completa.
    await p.waitForFunction(() => document.getElementById('nexoCarregando')?.dataset.nivel === '3', null, { timeout: 4000 });
    await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.nx-xp')).opacity) > 0.95 && parseFloat(getComputedStyle(document.querySelector('.nx-dica')).opacity) > 0.95, null, { timeout: 4000 });
    const tres = await ler();
    assert.ok(tres.orbita > 0.9 && tres.titulo > 0.95, `no grau 3 a tela é a completa: ${JSON.stringify(tres)}`);
    assert.ok(tres.emblema > 0.99, 'a marca no tamanho inteiro');
    assert.match(tres.textoDaDica, /\S{4,}/, 'com a dica girando');
    assert.ok(tres.faiscas >= 1, 'e as faíscas passando');
    const passou = await p.evaluate(() => window.__tela.niveis);
    assert.deepEqual(passou, ['1', '2', '3'], 'os graus só sobem, um de cada vez');
    await p.locator('#inicioApp').waitFor({ state: 'attached', timeout: 15000 });
    await semTela(p);
    await contexto.close();
    console.log('PASS: a tela nasce mínima (só a marca) e se completa em fusão: título no grau 2, barra, dica, órbita e faíscas no 3');
  }
  {
    // Quem espera pouco só vê a marca -- e a tela sai depressa: sem o "Pronto" da tela completa.
    const contexto = await comConta(ana);
    await vigiarATela(contexto);
    await atrasar(contexto, '**/inicio.js', 600);
    const p = observar(await contexto.newPage(), 'espera curta');
    await p.goto(origem + '/', { waitUntil: 'commit' });
    await p.locator('#inicioApp').waitFor({ state: 'attached', timeout: 15000 });
    await semTela(p);
    const curta = await p.evaluate(() => window.__tela);
    assert.equal(curta.viuSeAcender, true, 'a espera de quase um segundo acendeu a tela');
    assert.deepEqual(curta.niveis, ['1'], 'mas só a marca: nunca chegou ao grau 2');
    assert.ok(curta.fimEm - curta.prontaEm <= 600, `e ela sai depressa depois de pronta (${Math.round(curta.fimEm - curta.prontaEm)} ms)`);
    await contexto.close();
    console.log('PASS: uma espera curta mostra só a marca e a tela sai logo depois de pronta');
  }

  assert.deepEqual(erros, [], 'nenhum erro na página: ' + erros.join(' | '));
})().then(() => console.log('PASS: o carregamento do Nexo')).catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
