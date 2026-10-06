// A conversa direta, vista pelas duas pontas: reagir a uma mensagem (as cinco rápidas, o "+" com todos os
// emojis, ligar e desligar, o outro vendo na hora) e o tamanho do painel de mensagens da sala, que a pessoa
// muda pelo canto. Sem servidor de mídia: nada aqui passa por ele.
//
//   npm run test:conversa
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3242;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'conversa');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

const observar = (pagina, nome) => {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
};

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anaconversa', { apelido: 'Ana' });
  const bia = await instancia.conta('biaconversa', { apelido: 'Bia' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biaconversa', 201], [bia, '@anaconversa', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }

  navegador = await chromium.launch({ headless: true });
  const comConta = async (quem, viewport = { width: 1360, height: 900 }) => {
    const contexto = await navegador.newContext({ viewport });
    await contexto.addCookies([{ name: 'nexo_conta', value: quem.cookie.split('=')[1], url: origem }]);
    return contexto;
  };
  const contextoDaAna = await comConta(ana);
  const contextoDaBia = await comConta(bia);

  // ---------- No início: a conversa no centro da tela ----------
  const inicioDaAna = observar(await contextoDaAna.newPage(), 'Ana');
  const inicioDaBia = observar(await contextoDaBia.newPage(), 'Bia');
  for (const pagina of [inicioDaAna, inicioDaBia]) {
    await pagina.goto(origem);
    await pagina.locator('#inicioApp').waitFor();
    await pagina.waitForFunction(() => NexoSocial.estado.pronto && NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });
  }
  // A conversa abre pelo botão de mensagem na linha do amigo, na lista "Todos".
  const abrirConversa = async pagina => {
    await pagina.locator('#abasAmigos [data-aba="todos"]').click();
    await pagina.locator('.nx-amigo').first().getByRole('button', { name: 'Mandar mensagem' }).click();
    await pagina.locator('.nx-dm').waitFor({ timeout: 10000 });
  };
  await abrirConversa(inicioDaAna);
  await abrirConversa(inicioDaBia);

  // A Ana escreve; a Bia vê a mensagem chegar na conversa que já está aberta.
  await inicioDaAna.locator('.nx-dm-compor textarea').fill('olha esse clipe');
  await inicioDaAna.locator('.nx-dm-compor textarea').press('Enter');
  await inicioDaAna.locator('.nx-dm-msg-texto', { hasText: 'olha esse clipe' }).waitFor();
  await inicioDaBia.locator('.nx-dm-msg-texto', { hasText: 'olha esse clipe' }).waitFor({ timeout: 10000 });

  // A barrinha de ações aparece com o mouse em cima da mensagem, e tem o "Reagir".
  const mensagemNaBia = inicioDaBia.locator('.nx-dm-msg', { hasText: 'olha esse clipe' });
  assert.equal(await mensagemNaBia.locator('.nx-dm-msg-acoes').evaluate(el => getComputedStyle(el).opacity), '0', 'em repouso a barrinha não aparece');
  await mensagemNaBia.hover();
  await inicioDaBia.waitForTimeout(220);
  assert.equal(await mensagemNaBia.locator('.nx-dm-msg-acoes').evaluate(el => getComputedStyle(el).opacity), '1', 'com o mouse em cima, aparece');
  assert.equal(await mensagemNaBia.locator('.nx-dm-msg-acao.perigo').count(), 0, 'e a Bia não apaga a mensagem da Ana');

  // Reagir com uma das cinco rápidas.
  await mensagemNaBia.getByRole('button', { name: 'Reagir a esta mensagem' }).click();
  const rapidas = inicioDaBia.locator('.nx-dm-rapidas');
  await rapidas.waitFor();
  assert.deepEqual(await rapidas.locator('.nx-dm-rapida:not(.mais)').allTextContents(), ['👍', '❤️', '😂', '👏', '🎉']);
  await rapidas.getByRole('button', { name: 'Reagir com 👍' }).click();
  const pilulaDaBia = mensagemNaBia.locator('.nx-dm-reacao[data-emoji="👍"]');
  await pilulaDaBia.waitFor();
  assert.equal(await pilulaDaBia.locator('.nx-dm-reacao-n').textContent(), '1');
  assert.equal(await pilulaDaBia.getAttribute('aria-pressed'), 'true', 'a minha reação fica destacada');
  assert.equal(await pilulaDaBia.getAttribute('title'), 'Você reagiu com 👍');
  // A Ana vê, sem fazer nada, e a dela NÃO é a "minha".
  const mensagemNaAna = inicioDaAna.locator('.nx-dm-msg', { hasText: 'olha esse clipe' });
  const pilulaDaAna = mensagemNaAna.locator('.nx-dm-reacao[data-emoji="👍"]');
  await pilulaDaAna.waitFor({ timeout: 10000 });
  assert.equal(await pilulaDaAna.getAttribute('aria-pressed'), 'false');
  assert.equal(await pilulaDaAna.getAttribute('title'), 'Bia reagiu com 👍');

  // Reagir também: o número sobe para 2 e o título diz as duas.
  await pilulaDaAna.click();
  await inicioDaAna.waitForFunction(() => document.querySelector('.nx-dm-reacao[data-emoji="👍"] .nx-dm-reacao-n')?.textContent === '2');
  assert.equal(await pilulaDaAna.getAttribute('title'), 'Você e Bia reagiram com 👍');
  assert.equal(await inicioDaAna.evaluate(() => document.activeElement?.dataset?.emoji), '👍', 'o foco continua no botão apertado, e não some com o redesenho');
  assert.equal(await pilulaDaBia.getAttribute('title'), 'Você e Ana reagiram com 👍', 'a Bia vê as duas, com ela mesma primeiro');
  await inicioDaBia.screenshot({ path: path.join(saida, 'reacoes-inicio.png') });

  // Qualquer emoji: o "+" da fileira abre o seletor completo.
  await mensagemNaBia.locator('.nx-dm-reacao.adicionar').click();
  const seletor = inicioDaBia.locator('.nx-emo-pop');
  await seletor.waitFor();
  await seletor.locator('.nx-emo-campo').fill('foguete');
  await inicioDaBia.waitForTimeout(200); // a busca espera o fim da digitação
  await seletor.locator('.nx-emo-resultados .nx-emo-item').first().click();
  await inicioDaBia.waitForFunction(() => document.querySelectorAll('.nx-dm-msg .nx-dm-reacao[data-emoji]').length === 2);
  assert.equal(await mensagemNaBia.locator('.nx-dm-reacao[data-emoji]').nth(1).getAttribute('data-emoji'), '🚀');
  await inicioDaAna.waitForFunction(() => document.querySelectorAll('.nx-dm-msg .nx-dm-reacao[data-emoji]').length === 2);

  // Tirar: clicar na própria reação desliga, e a pílula some quando ninguém mais usa o emoji.
  await mensagemNaBia.locator('.nx-dm-reacao[data-emoji="🚀"]').click();
  await inicioDaBia.waitForFunction(() => document.querySelectorAll('.nx-dm-msg .nx-dm-reacao[data-emoji]').length === 1);
  await pilulaDaBia.click();
  await inicioDaBia.waitForFunction(() => document.querySelector('.nx-dm-reacao[data-emoji="👍"] .nx-dm-reacao-n')?.textContent === '1');
  assert.equal(await pilulaDaBia.getAttribute('aria-pressed'), 'false');
  await pilulaDaAna.click();
  await inicioDaBia.waitForFunction(() => document.querySelectorAll('.nx-dm-msg .nx-dm-reacao').length === 0, null, { timeout: 10000 });
  assert.equal(await mensagemNaBia.locator('.nx-dm-reacoes').count(), 0, 'sem reações, sem a fileira');

  // O convite não tem "Reagir".
  await inicioDaAna.evaluate(() => NexoSocial.convidar(NexoSocial.estado.amigos.amigos[0].codigo, 'squad-da-noite'));
  await inicioDaAna.locator('.nx-dm-convite').waitFor();
  await inicioDaAna.locator('.nx-dm-msg', { has: inicioDaAna.locator('.nx-dm-convite') }).hover();
  assert.equal(await inicioDaAna.locator('.nx-dm-msg', { has: inicioDaAna.locator('.nx-dm-convite') }).getByRole('button', { name: 'Reagir a esta mensagem' }).count(), 0, 'convite não recebe reação');
  await inicioDaAna.close();
  await inicioDaBia.close();

  // ---------- Na sala: o painel de mensagens com o tamanho de quem usa ----------
  const SALA = 'sala-da-conversa';
  const entrar = async (contexto, nome) => {
    const pagina = observar(await contexto.newPage(), nome);
    await pagina.goto(`${origem}/${SALA}/sala`);
    await pagina.evaluate(() => window.NexoConta?.pronto);
    await pagina.locator('#nameConfirmBtn').click();
    await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    await pagina.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });
    return pagina;
  };
  const salaDaAna = await entrar(contextoDaAna, 'Ana');
  await salaDaAna.locator('#mensagensBtn').click();
  const cartao = salaDaAna.locator('#mensagensPanel .mensagens-card');
  await cartao.waitFor();
  await salaDaAna.locator('#mensagensConversas button').first().click();
  await salaDaAna.locator('.nx-dm').waitFor();
  // O painel entra com `nexo-surgir` (cresce de 98,5%): espera o fim, e mede o tamanho de layout.
  await salaDaAna.waitForTimeout(450);
  const medidas = () => cartao.evaluate(el => { const r = el.getBoundingClientRect(); return { l: el.offsetWidth, a: el.offsetHeight, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) }; });
  const alca = salaDaAna.locator('#mensagensAlca');
  const inicial = await medidas();
  assert.equal(inicial.l, 880, 'de fábrica, 880 px de largura');
  assert.equal(inicial.a, 640, 'e 640 de altura');
  assert.equal(await alca.getAttribute('role'), 'button');
  assert.match(await alca.getAttribute('aria-label'), /tamanho do painel de mensagens/);

  const arrastarCanto = async (dx, dy) => {
    const caixa = await alca.boundingBox();
    const x = caixa.x + caixa.width / 2, y = caixa.y + caixa.height / 2;
    await salaDaAna.mouse.move(x, y);
    await salaDaAna.mouse.down();
    await salaDaAna.mouse.move(x + dx, y + dy, { steps: 8 });
    await salaDaAna.mouse.up();
  };
  await arrastarCanto(-100, -60);
  let depois = await medidas();
  assert.equal(depois.l, 880 - 200, 'o painel é centrado: o canto andou 100 px, e a largura mudou 200');
  assert.equal(depois.a, 640 - 120);
  assert.equal(depois.cx, inicial.cx, 'continua centrado');
  assert.equal(depois.cy, inicial.cy);
  await arrastarCanto(+400, +100);
  depois = await medidas();
  assert.ok(depois.l > 880, `cresce além de 880 px (${depois.l})`);
  assert.ok(depois.a <= Math.floor(900 * 0.86), `mas a altura nunca passa dos 86% da janela (${depois.a})`);
  const lembrado = await salaDaAna.evaluate(() => Preferencias.ler('mensagensTamanho', null));
  assert.ok(lembrado.largura >= depois.l && lembrado.altura === depois.a, `o tamanho escolhido fica guardado: ${JSON.stringify({ lembrado, depois })}`);

  // O teclado: as setas mudam o tamanho, o Enter volta ao normal.
  await alca.focus();
  const antes = await medidas();
  await salaDaAna.keyboard.press('ArrowLeft');
  assert.equal((await medidas()).l, antes.l - 24, 'a seta para a esquerda estreita o painel de 24 em 24 px');
  await salaDaAna.keyboard.press('Enter');
  assert.deepEqual(await medidas(), inicial, 'o Enter volta ao tamanho de fábrica');
  assert.equal(await salaDaAna.evaluate(() => Preferencias.ler('mensagensTamanho', 'nada')), 'nada', 'e apaga a escolha');

  // Lembrado: o tamanho escolhido volta depois do F5.
  await arrastarCanto(-120, 0);
  const escolhida = await medidas();
  await salaDaAna.reload();
  await salaDaAna.evaluate(() => window.NexoConta?.pronto);
  await salaDaAna.locator('#nameConfirmBtn').click();
  await salaDaAna.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await salaDaAna.locator('#mensagensBtn').click();
  await cartao.waitFor();
  assert.equal((await medidas()).l, escolhida.l, 'o F5 não desfaz o tamanho do painel');
  await salaDaAna.screenshot({ path: path.join(saida, 'painel-de-mensagens-na-sala.png') });

  // No celular o painel é a tela inteira, e a alça não existe.
  await salaDaAna.setViewportSize({ width: 390, height: 780 });
  assert.equal(await alca.isVisible(), false);

  assert.deepEqual(erros, []);
  console.log('PASS: a conversa direta tem reações (as cinco rápidas, qualquer emoji, ligam e desligam, os dois veem) e o painel de mensagens da sala muda de tamanho pelo canto');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
