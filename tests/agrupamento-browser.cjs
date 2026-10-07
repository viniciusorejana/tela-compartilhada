// O chat da sala junta as mensagens seguidas da mesma pessoa, como o Discord: só a primeira traz avatar, nome e hora, as
// outras são o texto embaixo; passados 5 minutos de pausa a pessoa volta inteira, e o ESPAÇO entre os dois grupos é bem
// maior que o de dentro de um. O agrupamento é função da posição na tela, então vale também depois de editar, apagar e
// com o divisor de "Novas mensagens". Sem servidor de mídia.
//
//   npm run test:agrupamento
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3248;
const origem = `http://localhost:${porta}`;
const sala = 'squad-grupos';
const MIN = 60000;
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function entrar(pagina) {
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
}

// A situação de cada mensagem na tela, em ordem: 'cabeça' (avatar e nome à vista) ou 'continua' (só o texto), com o
// divisor e o vazio marcados à parte.
const formas = pagina => pagina.locator('#chatMsgs').evaluate(lista => [...lista.children].map(el => {
  if (el.classList.contains('unread-divider')) return 'divisor';
  if (!el.classList.contains('msg')) return 'outro';
  const visivel = alvo => getComputedStyle(el.querySelector(alvo)).display !== 'none';
  const cabeca = visivel('.msg-avatar') && visivel('.msg-topo');
  // A classe e o que se vê têm de andar juntas; se não, a forma sai marcada e a comparação do teste acusa.
  const coerente = cabeca === !el.classList.contains('continua');
  return `${coerente ? '' : 'INCOERENTE '}${cabeca ? 'cabeça' : 'continua'}:${el.querySelector('.msg-texto').textContent}`;
}));

// Entrega uma mensagem ao chat como o servidor entregaria, mas com a hora que o teste quer.
const entregar = (pagina, msg) => pagina.evaluate(m => mostrarMensagem(m), msg);

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await entrar(pagina);

  // ---------- 1. Pelo servidor, de verdade: três mensagens minhas, uma atrás da outra ----------
  for (const texto of ['buenasss', 'como ta tu?', 'alguém aí?']) {
    await pagina.locator('#chatInput').fill(texto);
    await pagina.locator('#chatSend').click();
    await pagina.locator('#chatMsgs .msg', { hasText: texto }).waitFor();
  }
  assert.deepEqual(await formas(pagina), ['cabeça:buenasss', 'continua:como ta tu?', 'continua:alguém aí?'], 'a primeira traz o cabeçalho; as seguintes, só o texto');
  assert.equal(await pagina.locator('#chatMsgs .msg-avatar:visible').count(), 1, 'um avatar só para as três');
  assert.equal(await pagina.locator('#chatMsgs .msg-autor:visible').count(), 1, 'e um nome só');

  // ---------- 2. A pausa, e quem fala no meio ----------
  const base = Date.now();
  const bia = (id, texto, minutos, extra = {}) => ({ id, autor: 'Bia', autorId: 'bia-id', texto, em: base + minutos * MIN, ...extra });
  const caio = (id, texto, minutos) => ({ id, autor: 'Caio', autorId: 'caio-id', texto, em: base + minutos * MIN });
  await entregar(pagina, bia('b1', 'oloco', 10));
  await entregar(pagina, bia('b2', 'full ignorado 2', 12));                       // 2 min depois: junta
  await entregar(pagina, bia('b3', 'boa tarde guys', 16.9));                      // 4,9 min depois da anterior: ainda junta
  await entregar(pagina, bia('b4', 'cadê todo mundo', 22));                       // 5,1 min depois: grande pausa, volta inteira
  await entregar(pagina, caio('c1', 'opa', 22.5));                                 // outra pessoa: cabeçalho
  await entregar(pagina, bia('b5', 'voltei', 23));                                 // a Bia depois do Caio: cabeçalho de novo
  await entregar(pagina, bia('b6', 'respondendo', 23.5, { resposta: { id: 'c1', autor: 'Caio', texto: 'opa' } })); // uma resposta abre grupo
  await entregar(pagina, bia('b7', 'sem hora certa', 24, { em: undefined }));     // sem hora: nada se junta
  assert.deepEqual((await formas(pagina)).slice(3), [
    'cabeça:oloco', 'continua:full ignorado 2', 'continua:boa tarde guys',
    'cabeça:cadê todo mundo',
    'cabeça:opa', 'cabeça:voltei', 'cabeça:respondendo', 'cabeça:sem hora certa'
  ], 'junta até 5 minutos; a pausa maior, outra pessoa, uma resposta e uma mensagem sem hora abrem grupo novo');
  // Exatamente 5 minutos já é pausa.
  await entregar(pagina, bia('b8', 'cinco em ponto', 24 + 5)); // a anterior é "sem hora certa" (sem em): abre grupo
  await entregar(pagina, bia('b9', 'cinco certinhos', 29 + 5));
  assert.deepEqual((await formas(pagina)).slice(-2), ['cabeça:cinco em ponto', 'cabeça:cinco certinhos'], '5 minutos cravados já contam como pausa');

  // ---------- 3. O espaço marca a pausa ----------
  await pagina.evaluate(() => { document.querySelector('#chatMsgs').scrollTop = 0; });
  const medidas = await pagina.locator('#chatMsgs').evaluate(() => {
    const linha = id => document.querySelector(`#chatMsgs [data-message-id="${id}"]`).getBoundingClientRect();
    // Do fim de uma mensagem ao começo da seguinte: o vão que o olho vê entre elas.
    return { dentro: linha('b2').top - linha('b1').bottom, entre: linha('b4').top - linha('b3').bottom };
  });
  assert.ok(medidas.dentro <= 2, `dentro do grupo as caixas se encostam (${medidas.dentro} px)`);
  assert.ok(medidas.entre >= 12, `entre dois grupos há um vão de verdade (${medidas.entre} px)`);

  // ---------- 4. A hora, no lugar do avatar, só com o ponteiro em cima ----------
  const continua = pagina.locator('#chatMsgs [data-message-id="b2"]');
  await continua.scrollIntoViewIfNeeded();
  await pagina.mouse.move(0, 0);
  const horaSemPonteiro = await continua.evaluate(el => ({ opacidade: getComputedStyle(el, '::before').opacity, texto: getComputedStyle(el, '::before').content }));
  assert.equal(horaSemPonteiro.opacidade, '0', 'a hora da mensagem que continua não aparece à toa');
  await continua.hover();
  await pagina.waitForTimeout(250);
  const horaComPonteiro = await continua.evaluate(el => ({ opacidade: getComputedStyle(el, '::before').opacity, texto: getComputedStyle(el, '::before').content, esperado: el.dataset.hora }));
  assert.equal(horaComPonteiro.opacidade, '1', 'com o ponteiro em cima, a hora aparece');
  assert.ok(horaComPonteiro.texto.includes(horaComPonteiro.esperado), `e é a hora da mensagem (${horaComPonteiro.texto})`);
  assert.match(horaComPonteiro.esperado, /\d{2}:\d{2}/);
  await pagina.screenshot({ path: 'test-results/agrupamento.png', clip: await pagina.locator('#chatPanel').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }).catch(() => {});

  // ---------- 5. Editar, reagir e apagar mexem na posição, e o agrupamento acompanha ----------
  // Editar a do meio do grupo: ela volta ao lugar e continua sendo "só texto".
  await pagina.evaluate(m => atualizarMensagemDoChat(m), bia('b2', 'full ignorado 2 (editado)', 12, { editada: true }));
  let f = await formas(pagina);
  assert.deepEqual(f.slice(3, 6), ['cabeça:oloco', 'continua:full ignorado 2 (editado)', 'continua:boa tarde guys'], 'editar a do meio não quebra o grupo');
  // Editar a que abre o grupo: a seguinte segue continuando.
  await pagina.evaluate(m => atualizarMensagemDoChat(m), bia('b1', 'oloco (editado)', 10, { editada: true }));
  f = await formas(pagina);
  assert.deepEqual(f.slice(3, 6), ['cabeça:oloco (editado)', 'continua:full ignorado 2 (editado)', 'continua:boa tarde guys'], 'editar a primeira também não');
  // Reagir é uma atualização do mesmo tipo.
  await pagina.evaluate(m => atualizarMensagemDoChat(m), bia('b3', 'boa tarde guys', 16.9, { reacoes: { '👍': ['x'] } }));
  assert.deepEqual((await formas(pagina)).slice(3, 6), ['cabeça:oloco (editado)', 'continua:full ignorado 2 (editado)', 'continua:boa tarde guys'], 'reagir não muda o grupo');
  // Apagar a que abre o grupo: quem vinha depois passa a abri-lo.
  await pagina.evaluate(() => removerMensagemDoChat('b1'));
  assert.deepEqual((await formas(pagina)).slice(3, 5), ['cabeça:full ignorado 2 (editado)', 'continua:boa tarde guys'], 'sem a primeira, a segunda abre o grupo, com avatar e nome');
  // Apagar a do meio de dois grupos separados por pausa: a de baixo continua sendo cabeça (a pausa é entre as duas).
  await pagina.evaluate(() => removerMensagemDoChat('b3'));
  assert.deepEqual((await formas(pagina)).slice(3, 5), ['cabeça:full ignorado 2 (editado)', 'cabeça:cadê todo mundo'], 'a pausa de 10 minutos entre as duas continua marcada');
  // Apagar a que separava duas mensagens da mesma pessoa que se juntam: elas passam a se juntar.
  await entregar(pagina, bia('b10', 'vou sair', 40));
  await entregar(pagina, caio('c2', 'fui', 40.5));
  await entregar(pagina, bia('b11', 'e voltei', 41));
  f = await formas(pagina);
  assert.deepEqual(f.slice(-3), ['cabeça:vou sair', 'cabeça:fui', 'cabeça:e voltei']);
  await pagina.evaluate(() => removerMensagemDoChat('c2'));
  assert.deepEqual((await formas(pagina)).slice(-2), ['cabeça:vou sair', 'continua:e voltei'], 'apagar quem estava no meio junta as duas da mesma pessoa');

  // ---------- 6. O divisor de "Novas mensagens" corta o grupo ----------
  await pagina.evaluate(() => fecharChat());
  await entregar(pagina, bia('b12', 'chegou com o chat fechado', 42));
  f = await formas(pagina);
  assert.deepEqual(f.slice(-2), ['divisor', 'cabeça:chegou com o chat fechado'], 'o divisor vem antes dela, e ela abre grupo mesmo sendo da mesma pessoa de 1 minuto antes');
  await entregar(pagina, bia('b13', 'e mais uma', 42.5));
  assert.deepEqual((await formas(pagina)).slice(-2), ['cabeça:chegou com o chat fechado', 'continua:e mais uma'], 'e a seguinte volta a juntar');
  await pagina.evaluate(() => fecharChat());   // fechar de novo tira o divisor
  assert.ok(!(await formas(pagina)).includes('divisor'), 'o divisor saiu');
  assert.deepEqual((await formas(pagina)).slice(-3), ['continua:e voltei', 'continua:chegou com o chat fechado', 'continua:e mais uma'], 'tirado o divisor, a mensagem que vinha depois volta a se juntar ao grupo');

  // ---------- 7. Quem entra depois: o histórico chega agrupado ----------
  await pagina.reload();
  await pagina.locator('#nameInput').fill('Ana');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.deepEqual(await formas(pagina), ['cabeça:buenasss', 'continua:como ta tu?', 'continua:alguém aí?'], 'depois do F5, o histórico que o servidor devolve vem agrupado como estava');

  // ---------- 8. Densidade compacta e texto grande: a hora continua alinhada e o espaço continua marcando o grupo ----------
  for (const classe of ['densidade-compacta', 'texto-grande', 'texto-maior']) {
    await pagina.evaluate(c => document.body.classList.add(c) || document.documentElement.classList.add(c), classe);
    const d = await pagina.locator('#chatMsgs').evaluate(() => {
      const linhas = [...document.querySelectorAll('#chatMsgs > .msg')];
      return { juntas: linhas.filter(l => l.classList.contains('continua')).length, margem: getComputedStyle(linhas[0].nextElementSibling).marginTop };
    });
    assert.equal(d.juntas, 2, `com ${classe} o agrupamento é o mesmo`);
    assert.equal(d.margem, '0px', `e dentro do grupo não sobra vão (${classe})`);
    await pagina.evaluate(c => { document.body.classList.remove(c); document.documentElement.classList.remove(c); }, classe);
  }

  console.log('PASS: o chat junta as mensagens seguidas da mesma pessoa, marca a pausa de 5 minutos com o espaço, e acompanha editar, apagar e o divisor de novas mensagens');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
