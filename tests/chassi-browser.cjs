// A moldura única do início e da sala (docs/plano-continuidade.md, docs/interface.md 2.10): quem tem conta
// troca de página e nenhuma borda que o olho segue se mexe; entrar por um clique em "Entrar" não passa
// pelo portão; o trilho das salas está dentro da chamada; e a largura do chat, que é de quem conversa,
// continua sendo lembrada e respeitando o palco com o trilho na lateral.
//
// Sem servidor de mídia: o que se testa é a sala e a página, não o LiveKit.
//
//   npm run test:chassi
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3246;
const origem = `http://localhost:${porta}`;
const SALA = 'squad-da-moldura';
const OUTRA = 'estudo-de-bio';
const erros = [];
let instancia, navegador;

function observar(pagina, nome) {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
}
async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(mensagem);
}
const comConta = async (conta, opcoes) => {
  const contexto = await navegador.newContext(opcoes);
  await contexto.addCookies([{ name: 'nexo_conta', value: conta.cookie.split('=')[1], url: origem }]);
  return contexto;
};
const emPe = pagina => pagina.evaluate(() => typeof tiles !== 'undefined' && tiles.has('self') && Boolean(socket?.connected));
// As caixas que o olho segue na troca de página.
const CAIXAS_DO_INICIO = { trilho: '.ini > .trilho', lateral: '.ini-lateral', topo: '.ini-topo', eu: '.ini-eu', direita: '.ini-agora' };
// A coluna da lateral da sala é o `.room-sidebar` (trilho + conteúdo, a borda direita dentro dele); no início o trilho e a
// lateral são colunas vizinhas, cada uma com a sua. O que o olho segue é onde a coluna termina.
const CAIXAS_DA_SALA = { trilho: '.room-sidebar > .trilho', sidebar: '.room-sidebar', lateral: '.lateral-conteudo', topo: '.topbar', eu: '.self-profile', direita: '#chatPanel' };
const medir = (pagina, caixas) => pagina.evaluate(mapa => Object.fromEntries(Object.entries(mapa).map(([nome, seletor]) => {
  const e = document.querySelector(seletor);
  if (!e) return [nome, null];
  const r = e.getBoundingClientRect();
  return [nome, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})), caixas);
// O menu do início só cabe onde a coluna da direita cabe (≤ 1100 o "Agora" desce para o centro): a moldura que
// se compara é a de cima e as três colunas da esquerda, e a da direita só onde as duas páginas a têm.
async function conferirMoldura(pagina, aberta, L, A) {
  await pagina.setViewportSize({ width: L, height: A });
  await pagina.waitForTimeout(400);
  const ini = await medir(pagina.__inicio, CAIXAS_DO_INICIO);
  const sala = await medir(pagina, CAIXAS_DA_SALA);
  for (const parte of ['trilho', 'eu']) {
    assert.deepEqual([ini[parte].x, ini[parte].w, ini[parte].h], [sala[parte].x, sala[parte].w, sala[parte].h], `${parte} tem o mesmo x, largura e altura nas duas páginas a ${L}×${A}: ${JSON.stringify([ini[parte], sala[parte]])}`);
  }
  // A lateral: o conteúdo começa no mesmo x e a coluna (com a borda direita) termina no mesmo x -- onde o miolo começa.
  assert.equal(ini.lateral.x, sala.lateral.x, `a lateral começa no mesmo x a ${L} px`);
  assert.equal(ini.lateral.x + ini.lateral.w, sala.sidebar.x + sala.sidebar.w, `a coluna da lateral termina no mesmo x a ${L} px: ${JSON.stringify([ini.lateral, sala.sidebar])}`);
  assert.equal(ini.lateral.x + ini.lateral.w, ini.topo.x, 'e o miolo do início começa ali');
  assert.equal(sala.sidebar.x + sala.sidebar.w, sala.topo.x, 'e o da sala também');
  assert.equal(ini.eu.y + ini.eu.h, A, 'o "eu" encosta embaixo no início');
  assert.equal(sala.eu.y + sala.eu.h, A, 'e na sala');
  assert.equal(ini.eu.h, 64, 'o "eu" tem 64 px nas duas');
  assert.equal(ini.topo.h, 56, 'a linha de cima do início tem 56 px');
  assert.equal(sala.topo.h, 56, 'e a da sala também');
  assert.equal(ini.topo.x, sala.topo.x, 'a faixa de cima começa no mesmo x');
  if (L > 1100) {
    assert.equal(ini.direita.x, sala.direita.x, `a coluna da direita começa no mesmo x a ${L} px`);
    assert.equal(ini.direita.w, sala.direita.w, 'e tem a mesma largura');
  }
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anamoldura', { apelido: 'Ana' });
  const bia = await instancia.conta('biamoldura', { apelido: 'Bia' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  assert.equal((await pedir(ana, '@biamoldura')).status, 201);
  assert.equal((await pedir(bia, '@anamoldura')).status, 200);

  navegador = await chromium.launch({ headless: true });
  const contexto = await comConta(ana, { viewport: { width: 1440, height: 900 } });
  // Recentes de verdade, para o trilho ter o que mostrar nas duas páginas.
  await contexto.addInitScript(() => { try { if (!localStorage.getItem('nexoRecentRooms')) localStorage.setItem('nexoRecentRooms', JSON.stringify(['noite-de-jogos', 'mesa-dos-amigos'])); } catch (_) {} });

  // ---------- 1. Entrar por um clique não passa pelo portão ----------
  const pagina = observar(await contexto.newPage(), 'Ana');
  await pagina.goto(`${origem}/`);
  await pagina.locator('#inicioApp').waitFor();
  await pagina.evaluate(() => window.NexoConta?.pronto);
  // Criar uma sala nova é um clique em "Entrar": o início manda para ela.
  await pagina.locator('#abrirCodigo').fill(SALA);
  await pagina.locator('#abrirForm button[type="submit"]').click();
  await pagina.waitForURL(`${origem}/${SALA}/sala`, { timeout: 15000 });
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await pagina.locator('#nameGate').evaluate(el => getComputedStyle(el).display), 'none', 'o portão não aparece para quem clicou em "Entrar"');
  assert.equal(await pagina.evaluate(() => myName), 'Ana', 'e a pessoa entrou com o apelido da conta');
  assert.equal(await pagina.evaluate(() => sessionStorage.getItem('nexo.entradaDireta')), null, 'o recado vale uma vez só');
  console.log('PASS: clicar em "Entrar" no início abre a sala direto, sem o portão');

  // F5 na sala: o recado já foi gasto, então o portão volta -- quem recarrega confirma de novo.
  await pagina.reload();
  await pagina.evaluate(() => window.NexoConta?.pronto);
  await pagina.locator('#nameGate').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await pagina.locator('#nameConfirmBtn').isVisible(), true, 'por link ou F5, o portão pergunta como sempre');
  // Um recado velho (de uma sala que não é esta, ou de há muito) não vale.
  await pagina.evaluate(() => sessionStorage.setItem('nexo.entradaDireta', JSON.stringify({ sala: 'outra-sala', em: Date.now() })));
  await pagina.reload();
  await pagina.locator('#nameGate').waitFor({ state: 'visible', timeout: 10000 });
  await pagina.evaluate(sala => sessionStorage.setItem('nexo.entradaDireta', JSON.stringify({ sala, em: Date.now() - 60000 })), SALA);
  await pagina.reload();
  await pagina.locator('#nameGate').waitFor({ state: 'visible', timeout: 10000 });
  console.log('PASS: o portão volta por link, por F5, e com recado de outra sala ou vencido');

  // Sem conta, nem com o recado: o portão fica, e o nome é pedido.
  const anonimo = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const visitante = observar(await anonimo.newPage(), 'Visitante');
  await visitante.addInitScript(sala => { try { sessionStorage.setItem('nexo.entradaDireta', JSON.stringify({ sala, em: Date.now() })); } catch (_) {} }, SALA);
  await visitante.goto(`${origem}/${SALA}/sala`);
  await visitante.evaluate(() => window.NexoConta?.pronto);
  await visitante.locator('#nameGate').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await visitante.evaluate(() => typeof tiles === 'undefined' || !tiles.has('self')), true, 'sem conta o recado não entra por ninguém');
  assert.equal(await visitante.locator('.room-sidebar > .trilho').isVisible(), false, 'sem conta não há trilho na sala');
  assert.equal(await visitante.locator('.workspace-name').isVisible(), true, 'a lateral dele tem a marca de sempre');
  console.log('PASS: sem conta o portão fica, mesmo com o recado, e a sala não tem trilho');
  await anonimo.close();

  // ---------- 2. O trilho dentro da chamada ----------
  await pagina.evaluate(() => sessionStorage.removeItem('nexo.entradaDireta'));
  await pagina.reload();
  await pagina.evaluate(() => window.NexoConta?.pronto);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await pagina.locator('html').evaluate(el => el.classList.contains('com-conta')), true, 'quem tem conta traz a classe do trilho');
  assert.equal(await pagina.locator('.room-sidebar > .trilho').isVisible(), true, 'o trilho está na lateral da sala');
  const salas = await pagina.locator('.trilho-sala').evaluateAll(els => els.map(el => ({ texto: el.textContent.replace(/\d+$/, ''), aqui: el.classList.contains('aqui'), href: el.getAttribute('href') })));
  assert.equal(salas[0].href, `/${SALA}/sala`, 'a sala de agora vem primeiro');
  assert.equal(salas[0].aqui, true, 'com o anel verde');
  assert.equal(salas.filter(s => s.aqui).length, 1);
  assert.ok(salas.length >= 3, 'e as recentes vêm depois');
  assert.equal(await pagina.locator('#trilhoCriar, #trilhoEntrar').count(), 0, 'na sala não há "criar" nem "entrar por código"');
  assert.equal(await pagina.locator('.trilho-marca').isVisible(), true);
  assert.equal(await pagina.locator('.workspace-name').isVisible(), false, 'e a marca antiga some');
  assert.match(await pagina.locator('#salaIdNome').textContent(), new RegExp(`^#${SALA}$`), 'o alto da lateral diz onde a pessoa está');
  await esperarAte(async () => /^\d+ pessoas? · há /.test(await pagina.locator('#salaIdMeta').textContent()), 'o alto da lateral diz quantas pessoas e há quanto tempo');
  assert.equal(await pagina.locator('.novidades-da-sala').isVisible(), false, 'as novidades foram para o pé do trilho');
  assert.equal(await pagina.locator('.trilho-botao[data-novidades]').isVisible(), true);

  // Clicar noutra sala pergunta antes, e recusar mantém a chamada.
  await pagina.locator('.trilho-sala', { hasText: /^[A-Z]{2}$/ }).nth(1).click();
  await pagina.locator('#camadaSairPanel:not(.hidden)').waitFor({ timeout: 5000 });
  assert.match(await pagina.locator('#camadaSairTitulo').textContent(), /Sair desta sala para entrar em #/);
  await pagina.keyboard.press('Escape');
  await pagina.locator('#camadaSairPanel').waitFor({ state: 'hidden' });
  assert.equal(await emPe(pagina), true, 'recusar mantém a chamada de pé');
  // Clicar na própria sala não pergunta nada.
  await pagina.locator('.trilho-sala.aqui').click();
  assert.equal(await pagina.locator('#camadaSairPanel').isVisible(), false, 'a própria sala não pergunta');
  // O "N" abre o início por cima.
  await pagina.locator('.trilho-marca').click();
  await pagina.locator('.camada-quadro.pronto').waitFor({ timeout: 15000 });
  assert.equal(await emPe(pagina), true, 'a chamada segue por baixo');
  await pagina.keyboard.press('Escape');
  await pagina.locator('#camadaPanel').waitFor({ state: 'hidden' });
  console.log('PASS: o trilho da sala marca a sala de agora, pergunta antes de trocar e abre o início pelo "N"');

  // ---------- 3. A moldura é a mesma nas duas páginas ----------
  const inicio = observar(await contexto.newPage(), 'Ana (início)');
  await inicio.goto(`${origem}/`);
  await inicio.locator('#inicioApp').waitFor();
  await inicio.evaluate(() => window.NexoConta?.pronto);
  pagina.__inicio = inicio;
  for (const [L, A] of [[1440, 900], [1280, 720], [1920, 1080], [1100, 760], [1250, 800], [1600, 900]]) {
    await inicio.setViewportSize({ width: L, height: A });
    await conferirMoldura(pagina, true, L, A);
  }
  // O "eu" é o mesmo desenho: o avatar do início é o quadrado arredondado, e o da sala também.
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await inicio.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(300);
  const avatarSala = await pagina.locator('.self-avatar').evaluate(el => ({ w: el.getBoundingClientRect().width, r: getComputedStyle(el).borderTopLeftRadius }));
  const avatarInicio = await inicio.locator('#euAvatar .nx-av-img').evaluate(el => ({ w: el.getBoundingClientRect().width, r: getComputedStyle(el).borderTopLeftRadius }));
  assert.equal(avatarInicio.w, avatarSala.w, 'o avatar do "eu" tem o mesmo tamanho');
  assert.equal(avatarInicio.r, '11px', 'e o início o desenha com os cantos arredondados, como a sala');
  console.log('PASS: o trilho, a lateral, a linha de cima e o "eu" têm a mesma posição e tamanho no início e na sala, de 1100 a 1920 px');

  // O celular: o trilho e a lateral são uma gaveta só, como a do início. Com outra conta: uma conta só fica numa sala
  // por vez, e entrar com a Ana de novo mandaria a sala da Ana embora.
  const celular = await comConta(bia, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' });
  const tel = observar(await celular.newPage(), 'Bia (celular)');
  await tel.goto(`${origem}/${OUTRA}/sala`);
  await tel.evaluate(() => window.NexoConta?.pronto);
  await tel.locator('#nameConfirmBtn').tap();
  await tel.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await tel.locator('.room-sidebar').isVisible(), false, 'no celular a lateral é gaveta, fechada');
  await tel.locator('#sidebarToggle').tap();
  await tel.locator('.room-sidebar').waitFor({ state: 'visible' });
  const gaveta = await tel.locator('.room-sidebar').boundingBox();
  const trilhoDoTel = await tel.locator('.room-sidebar > .trilho').boundingBox();
  assert.equal(Math.round(trilhoDoTel.width), 64, 'a gaveta traz o trilho');
  assert.ok(gaveta.x >= 0 && gaveta.x + gaveta.width <= 390, `a gaveta cabe na tela (${JSON.stringify(gaveta)})`);
  assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'e nada rola para o lado');
  console.log('PASS: no celular a gaveta traz o trilho junto com a lateral');
  await celular.close();

  // ---------- 4. A largura do chat, com o trilho ----------
  await pagina.bringToFront();
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(400);
  const larguraDe = async seletor => {
    let anterior = -1;
    for (let i = 0; i < 30; i++) {
      const atual = await pagina.locator(seletor).evaluate(el => Math.round(el.getBoundingClientRect().width));
      if (atual === anterior) return atual;
      anterior = atual;
      await pagina.waitForTimeout(90);
    }
    return anterior;
  };
  const guardada = () => pagina.evaluate(() => localStorage.getItem('nexo.pref.chatLargura'));
  const arrastar = async (de, ate) => {
    const caixa = await pagina.locator('#chatAlca').boundingBox();
    const y = caixa.y + caixa.height / 2;
    await pagina.mouse.move(caixa.x + 4, y);
    await pagina.mouse.down();
    await pagina.mouse.move(caixa.x + 4 + (ate - de), y, { steps: 8 });
    await pagina.mouse.up();
  };
  assert.equal(await larguraDe('#chatPanel'), 292, 'de fábrica o chat tem a largura da moldura');
  assert.equal(await larguraDe('.room-sidebar'), 296, 'e a lateral, com o trilho, 64 + 232');
  await arrastar(0, -100);
  assert.equal(await larguraDe('#chatPanel'), 392, 'a alça alarga o chat em 100 px, com o trilho na lateral');
  assert.equal(await guardada(), '392', 'a escolha é lembrada');
  assert.equal(await larguraDe('.room-sidebar'), 296, 'a lateral não se mexe');
  const palco = await pagina.locator('.palco-area').evaluate(el => Math.round(el.getBoundingClientRect().width));
  assert.ok(palco >= 420, `o palco continua com chão (${palco} px)`);
  await arrastar(0, -3000);
  const maximo = await larguraDe('#chatPanel');
  assert.equal(maximo, 720, 'o teto continua 720');
  // O palco nunca fica menor que 420 com o trilho: numa janela de 1200 o chat cede.
  await pagina.setViewportSize({ width: 1200, height: 800 });
  await pagina.waitForTimeout(500);
  const cede = await larguraDe('#chatPanel');
  const lateral = await larguraDe('.room-sidebar');
  assert.equal(lateral, 272, 'a 1200 px a lateral é 64 + 208');
  assert.ok(cede <= 1200 - lateral - 420 + 1 && cede >= 240, `o chat cede para o palco ter chão (${cede} px)`);
  const palcoApertado = await pagina.locator('.palco-area').evaluate(el => Math.round(el.getBoundingClientRect().width));
  assert.ok(palcoApertado >= 419, `o palco mede ${palcoApertado} px, nunca menos que 420`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(500);
  assert.equal(await larguraDe('#chatPanel'), 720, 'e volta ao que se escolheu quando a janela alarga');
  // Persistência: F5 com o trilho (a dica da conta já pôs a classe antes da primeira pintura).
  await pagina.reload();
  await pagina.evaluate(() => window.NexoConta?.pronto);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await larguraDe('#chatPanel'), 720, 'o F5 não desfaz a escolha');
  // Teclado: as setas, Home e Enter na alça.
  await pagina.locator('#chatAlca').focus();
  await pagina.keyboard.press('Home');
  assert.equal(await larguraDe('#chatPanel'), 240);
  await pagina.keyboard.press('Shift+ArrowLeft');
  assert.equal(await larguraDe('#chatPanel'), 304);
  await pagina.keyboard.press('Enter');
  assert.equal(await larguraDe('#chatPanel'), 292, 'Enter volta ao normal');
  assert.equal(await guardada(), null, 'e apaga a escolha');
  // Recolher a barra leva o trilho junto, devolve a coluna ao palco e é lembrado.
  await pagina.locator('#sidebarToggle').click();
  // A coluna vai a zero (o 1 px que sobra é a borda do `.room-sidebar`, como sem conta), e o trilho some junto.
  await esperarAte(async () => (await larguraDe('.room-sidebar')) <= 1, 'a barra recolhida devia fechar a coluna inteira, trilho junto');
  assert.equal(await pagina.evaluate(() => localStorage.getItem('nexoBarraRecolhida')), '1', 'a barra recolhida é lembrada');
  assert.equal(await pagina.locator('.room-sidebar > .trilho').isVisible(), false, 'o trilho recolhe com a lateral');
  await pagina.reload();
  await pagina.evaluate(() => window.NexoConta?.pronto);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.ok((await larguraDe('.room-sidebar')) <= 1, 'o F5 mantém a barra recolhida');
  await pagina.locator('#sidebarToggle').click();
  await esperarAte(async () => (await larguraDe('.room-sidebar')) === 296, 'e abrir devolve o trilho e a lateral');
  console.log('PASS: a largura do chat se muda, é lembrada e respeita o palco com o trilho; recolher a barra leva o trilho junto');

  // ---------- 5. A troca de página é animada pelo navegador ----------
  const animado = await comConta(ana, { viewport: { width: 1440, height: 900 } });
  await animado.addInitScript(() => {
    window.addEventListener('pagereveal', e => { try { sessionStorage.setItem('__vt_revelou', e.viewTransition ? 'sim' : 'nao'); } catch (_) {} });
  });
  const viaje = observar(await animado.newPage(), 'Ana (viagem)');
  await viaje.goto(`${origem}/`);
  await viaje.locator('#inicioApp').waitFor();
  assert.equal(await viaje.evaluate(() => sessionStorage.getItem('__vt_revelou')), 'nao', 'a primeira página da aba não vem de outra: sem transição');
  await viaje.locator('#abrirCodigo').fill(SALA);
  await viaje.locator('#abrirForm button[type="submit"]').click();
  await viaje.waitForURL(`${origem}/${SALA}/sala`);
  await viaje.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await viaje.evaluate(() => sessionStorage.getItem('__vt_revelou')), 'sim', 'do início para a sala, o navegador anima a troca');
  const nomes = await viaje.evaluate(() => getComputedStyle(document.querySelector('.room-sidebar > .trilho')).viewTransitionName + '|' + getComputedStyle(document.querySelector('.lateral-conteudo')).viewTransitionName + '|' + getComputedStyle(document.querySelector('.self-profile')).viewTransitionName);
  assert.equal(nomes, 'nx-trilho|nx-lateral|nx-eu', 'trilho, lateral e "eu" têm o nome que fica no lugar');
  // Sair para o início: a transição também acontece, e navegar para uma página que não adere (a conta) não dá erro.
  await viaje.locator('#leaveBtn').click();
  await viaje.waitForURL(`${origem}/`);
  assert.equal(await viaje.evaluate(() => sessionStorage.getItem('__vt_revelou')), 'sim', 'da sala para o início também');
  await viaje.goto(`${origem}/conta`);
  await viaje.waitForTimeout(500);
  console.log('PASS: do início para a sala e de volta o navegador anima a troca, e pular a transição não é erro');
  await animado.close();

  // Menos movimento: as regras citam os pseudo-elementos de transição, e a animação cai para 1 ms.
  const calmo = await comConta(ana, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pCalma = observar(await calmo.newPage(), 'Ana (calma)');
  await pCalma.goto(`${origem}/`);
  await pCalma.locator('#inicioApp').waitFor();
  // A regra mora num @media dentro de um @import (tema.css): a busca desce por @import e @media.
  const regras = await pCalma.evaluate(() => {
    const achadas = [];
    const descer = lista => { for (const r of lista) {
      if (r.styleSheet) { try { descer(r.styleSheet.cssRules); } catch (_) { /* outra origem */ } }
      // Uma regra de estilo também tem `cssRules` (o aninhamento do CSS): ela se confere antes de se descer.
      else if (r.selectorText !== undefined) { if (r.selectorText.includes('::view-transition-group') && r.cssText.includes('1ms')) achadas.push(r.selectorText.slice(0, 80)); }
      else if (r.cssRules) descer(r.cssRules);
    } };
    for (const f of document.styleSheets) { try { descer(f.cssRules); } catch (_) { /* outra origem */ } }
    return achadas;
  });
  assert.ok(regras.length >= 1, 'menos movimento encurta a troca de página para 1 ms (a regra dos pseudo-elementos existe)');
  assert.equal(await pCalma.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true, 'e este contexto pede menos movimento');
  await calmo.close();
  console.log('PASS: com menos movimento a troca de página é de 1 ms');

  assert.deepEqual(erros, [], 'nenhum erro na página: ' + erros.join(' | '));
})().then(() => console.log('PASS: a moldura única')).catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
