// A camada do início dentro da sala: o início de quem tem conta (e a página da conta) por cima da
// chamada, sem sair dela. A prova é a chamada seguir de pé por baixo -- a mesma conexão, o mesmo
// lugar na sala para quem fica -- enquanto a pessoa vê amigos, mensagens e conta.
//
// Sem servidor de mídia: o que se testa aqui é a sala e a página, não o LiveKit. A sala "de pé" é a
// sinalização conectada, o `tiles.has('self')` e os outros na sala ainda vendo a pessoa.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3235;
const origem = `http://localhost:${porta}`;
const SALA = 'sala-da-camada';
const OUTRA = 'sala-da-bia';
const saida = path.join(__dirname, '..', 'test-results', 'camada');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(mensagem);
}

function observar(pagina, nome) {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
}

async function entrar(contexto, nome, sala = SALA) {
  const pagina = observar(await contexto.newPage(), nome);
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.evaluate(() => window.NexoConta?.pronto);
  if (!(await pagina.locator('#nameInput').evaluate(el => el.readOnly))) await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  return pagina;
}

const emPe = pagina => pagina.evaluate(() => tiles.has('self') && Boolean(socket?.connected));
const camadaAberta = pagina => pagina.locator('#camadaPanel').evaluate(el => !el.classList.contains('hidden'));
async function esperarCamada(pagina, aberta) {
  await esperarAte(async () => (await camadaAberta(pagina)) === aberta, `a camada devia estar ${aberta ? 'aberta' : 'fechada'}`);
}
// O quadro some depois da saída do painel: esperar o fim, e não o clique (docs/interface.md, 2.8).
const semQuadro = pagina => esperarAte(async () => (await pagina.locator('.camada-quadro').count()) === 0, 'o quadro devia ter sido tirado');
const quadroPronto = async pagina => {
  await pagina.locator('.camada-quadro.pronto').waitFor({ timeout: 15000 });
  return pagina.frameLocator('.camada-quadro');
};

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anacamada', { apelido: 'Ana' });
  const bia = await instancia.conta('biacamada', { apelido: 'Bia Souza' });
  const duda = await instancia.conta('dudacamada', { apelido: 'Duda' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biacamada', 201], [bia, '@anacamada', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }

  navegador = await chromium.launch({ headless: true });
  const comConta = async (conta, opcoes) => {
    const contexto = await navegador.newContext(opcoes);
    await contexto.addCookies([{ name: 'nexo_conta', value: conta.cookie.split('=')[1], url: origem }]);
    return contexto;
  };
  const contextoDaAna = await comConta(ana, { viewport: { width: 1360, height: 900 } });
  const contextoDaBia = await comConta(bia, { viewport: { width: 1360, height: 900 } });

  // A Bia está no início, e a Ana, a um visitante e a ela mesma na sala. O visitante é quem vê a Ana
  // sair (ou não) -- a prova de que a chamada seguiu de pé por baixo da camada.
  const noInicioDaBia = observar(await contextoDaBia.newPage(), 'Bia');
  await noInicioDaBia.goto(origem);
  await noInicioDaBia.locator('#inicioApp').waitFor();
  const contextoDoCaio = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
  const caio = await entrar(contextoDoCaio, 'Caio');
  // Sem servidor de mídia não há `peers`: o Caio anota o que a sinalização da sala lhe diz.
  await caio.evaluate(() => {
    window.__eventos = [];
    for (const nome of ['peer-joined', 'peer-left', 'presenca-atualizada']) socket.on(nome, dados => window.__eventos.push({ nome, dados }));
  });
  const eventosDoCaio = nome => caio.evaluate(n => window.__eventos.filter(e => e.nome === n), nome);
  const naSala = await entrar(contextoDaAna, 'Ana');
  await esperarAte(async () => (await eventosDoCaio('peer-joined')).length === 1, 'o Caio devia ver a Ana entrar na sala');
  await esperarAte(() => noInicioDaBia.evaluate(([codigo, sala]) => NexoSocial.presencaDe(codigo).sala?.codigo === sala, [ana.conta.codigo, SALA]), 'a Bia devia ver a Ana na sala');

  // ---------- A marca abre a camada, e a chamada continua ----------
  const urlDaSala = naSala.url();
  assert.equal(await naSala.locator('.workspace-name').getAttribute('title'), 'Abrir o início: amigos, conversas e conquistas. A chamada continua.');
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  const quadro = await quadroPronto(naSala);
  await quadro.locator('#inicioApp').waitFor();
  assert.equal(naSala.url(), urlDaSala, 'a sala não navegou para lugar nenhum');
  assert.equal(await emPe(naSala), true, 'a sinalização da sala segue conectada');
  assert.equal(await naSala.evaluate(() => document.querySelector('.app').inert), true, 'a sala por baixo fica inerte, como sob qualquer painel');
  assert.equal(await naSala.locator('#camadaSalaNome').textContent(), `#${SALA}`);
  assert.match(await naSala.locator('#camadaSalaMeta').textContent(), /^\d+ pessoas? · há /, 'a barra diz quantos estão na sala e há quanto tempo');
  assert.equal(await quadro.locator('.ini-sala.aqui').count(), 1, 'a sala da chamada vem marcada na trilha');
  assert.equal(await quadro.locator('.ini-sala').first().getAttribute('aria-current'), 'true');
  assert.deepEqual(await quadro.locator('#listaAmigos .nx-amigo-nome').allTextContents(), ['Bia Souza'], 'os amigos estão ali');
  await naSala.waitForTimeout(500);
  await naSala.screenshot({ path: path.join(saida, 'camada-aberta.png') });
  // Os outros seguem vendo a Ana na sala, e o Caio nunca a viu sair.
  assert.equal((await eventosDoCaio('peer-left')).length, 0, 'o Caio nunca viu a Ana sair');
  assert.equal(await noInicioDaBia.evaluate(([codigo]) => NexoSocial.presencaDe(codigo).sala?.codigo, [ana.conta.codigo]), SALA, 'e a Bia ainda vê em que sala ela está');
  console.log('PASS: a marca do Nexo abre o início por cima da sala, e a chamada segue conectada por baixo');

  // ---------- A barra: ouvir e microfone espelham a barra de controles ----------
  assert.equal(await naSala.locator('#camadaMic').getAttribute('aria-pressed'), 'false', 'sem microfone aberto, o botão da camada diz o mesmo da sala');
  await naSala.locator('#camadaOuvir').click();
  assert.equal(await naSala.evaluate(() => ensurdecido), true, 'o botão da camada ensurdece a sala de verdade');
  assert.equal(await naSala.locator('#deafenBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(await naSala.locator('#camadaOuvir').getAttribute('aria-pressed'), 'true');
  await esperarAte(async () => (await eventosDoCaio('presenca-atualizada')).some(e => e.dados.ensurdecido === true), 'a sala vê o fone cortado da Ana');
  await naSala.locator('#camadaOuvir').click();
  assert.equal(await naSala.evaluate(() => ensurdecido), false);
  assert.equal(await naSala.locator('#camadaOuvir').getAttribute('aria-pressed'), 'false');
  // O atalho com o foco DENTRO do quadro: a sala só ouve o teclado da janela dela.
  await quadro.locator('body').click({ position: { x: 5, y: 5 } });
  await naSala.keyboard.press('Control+Shift+D');
  await esperarAte(() => naSala.evaluate(() => ensurdecido), 'Ctrl+Shift+D com o foco no quadro devia ensurdecer');
  await naSala.keyboard.press('Control+Shift+D');
  await esperarAte(() => naSala.evaluate(() => !ensurdecido), 'e de novo, voltar a ouvir');
  console.log('PASS: ouvir e microfone da barra são os da sala, e Ctrl+Shift+D/M valem com o foco dentro da página');

  // ---------- Esc fecha, e a chamada segue ----------
  await quadro.locator('body').click({ position: { x: 5, y: 5 } });
  await naSala.keyboard.press('Escape');
  await esperarCamada(naSala, false);
  await semQuadro(naSala);
  assert.equal(await naSala.evaluate(() => document.querySelector('.app').inert), false, 'a sala volta a aceitar o teclado');
  assert.equal(await emPe(naSala), true);
  console.log('PASS: Esc dentro da página volta para a sala, e a página sai de cena');

  // ---------- Ctrl K abre com o foco na busca ----------
  await naSala.keyboard.press('Control+K');
  await esperarCamada(naSala, true);
  const quadro2 = await quadroPronto(naSala);
  await esperarAte(() => quadro2.locator('#buscaCampo').evaluate(el => document.activeElement === el), 'o foco devia estar na busca');
  assert.equal(await quadro2.locator('#buscaLista').isVisible(), true, 'e a lista de sugestões aberta');
  await naSala.keyboard.press('Escape');
  assert.equal(await camadaAberta(naSala), true, 'o primeiro Esc só fecha a lista da busca');
  await naSala.keyboard.press('Escape');
  await esperarCamada(naSala, false);
  console.log('PASS: Ctrl K abre a camada com o foco na busca; o Esc fecha primeiro a lista, depois a camada');

  // ---------- Um rascunho não some com um Esc ----------
  await naSala.keyboard.press('Control+K');
  await esperarCamada(naSala, true);
  const quadroDoRascunho = await quadroPronto(naSala);
  await quadroDoRascunho.locator('#listaAmigos .nx-amigo', { hasText: 'Bia Souza' }).getByRole('button', { name: 'Mandar mensagem' }).click();
  const caixaDeEscrever = quadroDoRascunho.locator('#vistaConversa textarea');
  await caixaDeEscrever.fill('uma mensagem que ainda não saiu');
  await caixaDeEscrever.press('Escape');
  await naSala.waitForTimeout(300);
  assert.equal(await camadaAberta(naSala), true, 'o Esc com texto escrito não fecha a camada');
  assert.equal(await caixaDeEscrever.inputValue(), 'uma mensagem que ainda não saiu', 'e o rascunho continua lá');
  await caixaDeEscrever.fill('');
  await caixaDeEscrever.press('Escape');
  await esperarCamada(naSala, false);
  console.log('PASS: um rascunho de mensagem não se perde com o Esc; sem texto, o Esc volta para a sala');

  // ---------- Onde a camada não abre, e onde abre desfazendo o que a esconderia ----------
  // No modo compacto a janela é só o palco; ali não há camada.
  await naSala.evaluate(() => document.querySelector('.app').classList.add('compacto-local'));
  await naSala.keyboard.press('Control+K');
  await naSala.waitForTimeout(250);
  assert.equal(await camadaAberta(naSala), false, 'no modo compacto, Ctrl K não abre a camada');
  await naSala.evaluate(() => document.querySelector('.app').classList.remove('compacto-local'));
  // Um elemento em tela cheia cobre a página inteira, camada incluída: abrir sai da tela cheia antes.
  // (O Chromium sem janela nem sempre entra em tela cheia: sem ela, não há o que provar.)
  await naSala.locator('#fullscreenBtn').click({ force: true }).catch(() => {});
  if (await naSala.evaluate(() => Boolean(document.fullscreenElement))) {
    await naSala.keyboard.press('Control+K');
    await esperarCamada(naSala, true);
    await esperarAte(() => naSala.evaluate(() => !document.fullscreenElement), 'abrir a camada devia sair da tela cheia');
    await naSala.locator('#camadaVoltar').click();
    await esperarCamada(naSala, false);
    console.log('PASS: no modo compacto não há camada, e abrir a camada sai da tela cheia');
  } else {
    console.log('PASS: no modo compacto não há camada (a tela cheia não entrou neste Chromium, e a saída dela não foi provada)');
  }

  // ---------- O "voltar" do navegador fecha a camada, e não a sala ----------
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  await quadroPronto(naSala);
  await naSala.goBack();
  await esperarCamada(naSala, false);
  assert.equal(naSala.url(), urlDaSala);
  assert.equal(await emPe(naSala), true, 'voltar fechou a camada, e não a chamada');
  // Abrir e fechar pelo botão não deixa entradas a mais no histórico.
  const tamanhoDoHistorico = await naSala.evaluate(() => history.length);
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  await quadroPronto(naSala);
  await naSala.locator('#camadaVoltar').click();
  await esperarCamada(naSala, false);
  await esperarAte(() => naSala.evaluate(n => history.state?.nexoCamada !== true && history.length <= n + 1, tamanhoDoHistorico), 'a entrada do histórico devia ter sido desfeita');
  console.log('PASS: o "voltar" do navegador fecha a camada, e fechar pelo botão desfaz a entrada do histórico');

  // ---------- Um aviso só ----------
  const avisosNaSala = () => naSala.locator('.nexo-toasts .nexo-toast').count();
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  const quadro3 = await quadroPronto(naSala);
  await noInicioDaBia.evaluate(codigo => NexoSocial.enviar(codigo, 'oi, com a camada aberta'), ana.conta.codigo);
  await quadro3.locator('.nexo-toast').first().waitFor();
  await naSala.waitForTimeout(400);
  assert.equal(await quadro3.locator('.nexo-toast').count(), 1, 'a página de dentro avisa da mensagem');
  assert.equal(await avisosNaSala(), 0, 'e a sala não avisa em dobro');
  await naSala.locator('#camadaVoltar').click();
  await esperarCamada(naSala, false);
  await noInicioDaBia.evaluate(codigo => NexoSocial.enviar(codigo, 'e agora, com ela fechada'), ana.conta.codigo);
  await naSala.locator('.nexo-toasts .nexo-toast').first().waitFor();
  assert.equal(await avisosNaSala(), 1, 'fechada a camada, o aviso volta a ser o da sala');
  console.log('PASS: mensagem nova avisa uma vez só: pela página de dentro com a camada aberta, pela sala com ela fechada');

  // ---------- A conta, sem sair da chamada ----------
  await naSala.evaluate(() => NexoConfig.abrir('perfil'));
  await naSala.locator('#configConta').click();
  await esperarCamada(naSala, true);
  const quadroDaConta = await quadroPronto(naSala);
  await quadroDaConta.locator('#comConta').waitFor();
  assert.equal(await naSala.locator('#irParaContaPanel').evaluate(el => el.classList.contains('hidden')), true, 'não pergunta mais se quer sair da sala');
  assert.equal(naSala.url(), urlDaSala);
  assert.equal(await emPe(naSala), true);
  assert.equal(await naSala.locator('#camadaTitulo').textContent(), 'Sua conta');
  assert.equal(await quadroDaConta.locator('#sair').textContent(), 'Sair da conta e da sala', 'sair da conta tira da sala, e o botão diz isso');
  assert.equal(await quadroDaConta.locator('#apagarNaSala').evaluate(el => el.hidden), false, 'e apagar a conta avisa que tira da sala (a seção abre dobrada)');
  await naSala.screenshot({ path: path.join(saida, 'conta-na-camada.png') });
  // Uma caixa marcada tem `value` sem ninguém ter escrito nada: o Esc ainda volta para a sala.
  await quadroDaConta.locator('details.perigo summary').click();
  await quadroDaConta.locator('#apagarCerteza').check();
  await naSala.keyboard.press('Escape');
  await esperarCamada(naSala, false);
  await naSala.evaluate(() => NexoInicioNaSala.abrir({ pagina: 'conta' }));
  await esperarCamada(naSala, true);
  await quadroPronto(naSala);
  // "Voltar ao início", no cabeçalho da conta, leva ao início DENTRO do quadro.
  await quadroDaConta.locator('.home-nav .nav-link').click();
  await quadro3.locator('#inicioApp').waitFor();
  await esperarAte(async () => (await naSala.locator('#camadaTitulo').textContent()) === 'Início do Nexo', 'a camada devia acompanhar a troca de página');
  await quadro3.locator('.ini-eu-conta').click();
  await quadroDaConta.locator('#comConta').waitFor();
  await quadroDaConta.locator('#voltarParaSala').click();
  await esperarCamada(naSala, false);
  assert.equal(await naSala.locator('#devicesPanel').evaluate(el => el.classList.contains('hidden')), false, 'quem abriu a conta pelas configurações volta a elas');
  assert.equal(await emPe(naSala), true);
  await naSala.locator('#devicesClose').click();
  await naSala.locator('#devicesPanel').waitFor({ state: 'hidden' });
  console.log('PASS: a página da conta abre na camada (sem pergunta, sem sair), troca com o início por dentro, e volta para a sala');

  // ---------- Entrar noutra sala pergunta, e sai da chamada de verdade ----------
  await noInicioDaBia.close();
  const bia2 = await entrar(contextoDaBia, 'Bia', OUTRA);
  await esperarAte(() => naSala.evaluate(([codigo, sala]) => NexoSocial.presencaDe(codigo).sala?.codigo === sala, [bia.conta.codigo, OUTRA]), 'a Ana devia ver a Bia na outra sala');
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  const quadro4 = await quadroPronto(naSala);
  const entrarNaDaBia = quadro4.locator('#listaAmigos .nx-amigo', { hasText: 'Bia Souza' }).getByRole('button', { name: 'Entrar' });
  await entrarNaDaBia.click();
  await naSala.locator('#camadaSairPanel:not(.hidden)').waitFor();
  assert.match(await naSala.locator('#camadaSairTitulo').textContent(), new RegExp(`entrar em #${OUTRA}`));
  assert.equal(naSala.url(), urlDaSala, 'perguntou antes de sair');
  await naSala.screenshot({ path: path.join(saida, 'pergunta-de-sair.png') });
  await naSala.locator('#camadaSairPanel [data-close]').click();
  await naSala.locator('#camadaSairPanel').waitFor({ state: 'hidden' });
  assert.equal(await camadaAberta(naSala), true, 'recusar volta para a camada');
  assert.equal(await emPe(naSala), true);
  assert.equal((await eventosDoCaio('peer-left')).length, 0, 'e o Caio continua vendo a Ana');
  // A sala da própria chamada, na trilha, é só voltar -- sem pergunta.
  await quadro4.locator('.ini-sala.aqui').click();
  await esperarCamada(naSala, false);
  await naSala.locator('.workspace-name').click();
  await esperarCamada(naSala, true);
  await (await quadroPronto(naSala)).locator('#listaAmigos .nx-amigo', { hasText: 'Bia Souza' }).getByRole('button', { name: 'Entrar' }).click();
  await naSala.locator('#camadaSairPanel:not(.hidden)').waitFor();
  await naSala.locator('#camadaSairConfirmar').click();
  await naSala.waitForURL(`**/${OUTRA}/sala`, { timeout: 15000 });
  await esperarAte(async () => (await eventosDoCaio('peer-left')).length === 1, 'confirmado, o Caio devia ver a Ana sair da sala (a saída foi de verdade)');
  await bia2.close();
  console.log('PASS: entrar noutra sala pergunta antes; recusar mantém a chamada, confirmar sai dela de verdade');

  // ---------- Quem entrou sem conta não tem camada: a marca sai da sala, como sempre ----------
  await caio.locator('.workspace-name').click();
  await caio.waitForURL(`${origem}/`, { timeout: 15000 });
  assert.equal(await caio.locator('#camadaPanel').count(), 0, 'a apresentação não tem a camada');
  console.log('PASS: sem conta, a marca do Nexo continua levando para fora da sala');

  // ---------- No celular ----------
  const contextoDaDuda = await comConta(duda, {
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const tel = await entrar(contextoDaDuda, 'Duda');
  await tel.locator('#sidebarToggle').tap();
  await tel.locator('.workspace-name').tap();
  await esperarCamada(tel, true);
  const quadroDoTel = await quadroPronto(tel);
  await quadroDoTel.locator('#inicioApp').waitFor();
  assert.equal(await tel.evaluate(() => document.querySelector('.app').classList.contains('sidebar-open')), false, 'a gaveta não fica aberta por baixo');
  const caixas = async larg => {
    const rola = await tel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(rola <= 0, `a página não rola de lado em ${larg} px (${rola})`);
    for (const id of ['camadaMic', 'camadaOuvir', 'camadaSair', 'camadaVoltar']) {
      const caixa = await tel.locator(`#${id}`).boundingBox();
      assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= larg, `${id} cabe na barra de ${larg} px: ${JSON.stringify(caixa)}`);
      assert.ok(caixa.height >= 32, `${id} tem alvo de toque de 32 px ou mais`);
    }
    const sala = await tel.locator('.camada-sala').boundingBox();
    const acoes = await tel.locator('.camada-acoes').boundingBox();
    assert.ok(sala.x + sala.width <= acoes.x + 1, `o nome da sala não passa por cima dos botões em ${larg} px`);
  };
  await caixas(390);
  await tel.screenshot({ path: path.join(saida, 'camada-celular.png') });
  await tel.setViewportSize({ width: 320, height: 640 });
  await tel.waitForTimeout(200);
  await caixas(320);
  await tel.locator('#camadaVoltar').tap();
  await esperarCamada(tel, false);
  console.log('PASS: no celular, a barra cabe de 320 a 390 px e a camada abre e fecha pelo toque');

  assert.deepEqual(erros, []);
  console.log('PASS: nenhum erro nas páginas');
})().then(async () => {
  await navegador?.close();
  await instancia?.encerrar();
}).catch(async erro => {
  console.error(erro);
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
  process.exit(1);
});
