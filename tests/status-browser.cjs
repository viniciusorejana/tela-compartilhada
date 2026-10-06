// O status da conta (disponível, ausente, não incomodar, invisível) DENTRO da sala, e o que ele promete.
//
// O ponto ao lado do nome, na lista da sala, era sempre verde: o status escolhido no perfil não chegava
// lá. Agora ele viaja no perfil de cada pessoa (server.js `perfilNaSala`), muda na hora para a sala
// inteira, vale para quem entra depois e fica na conta. E "não incomodar" cumpre o que diz: nada de som
// de mensagem no chat da sala (nem a menção), nem aviso do sistema da menção, nem aviso de mensagem
// direta no canto -- convites passam, porque pedem uma decisão.
//
// Com servidor de mídia: a lista da sala é feita a partir dela, e o que se prova aqui é o que OS
// OUTROS veem. O lado do Android (a notificação) tem o teste dele, em android-browser.cjs.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3238;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'status');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

async function esperarAte(condicao, mensagem, prazo = 12000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(typeof mensagem === 'function' ? mensagem() : mensagem);
}
const observar = (pagina, nome) => {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
};
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) }, midia: true });
  const ana = await instancia.conta('anastatus', { apelido: 'Ana' });
  const bia = await instancia.conta('biastatus', { apelido: 'Bia' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biastatus', 201], [bia, '@anastatus', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }
  const statusGuardado = async quem => (await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: quem.cookie } })).json()).perfil.social.status;

  navegador = await chromium.launch({ headless: true });
  const comConta = async quem => {
    const contexto = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
    if (quem) await contexto.addCookies([{ name: 'nexo_conta', value: quem.cookie.split('=')[1], url: origem }]);
    return contexto;
  };
  const contextoDaAna = await comConta(ana);
  const contextoDaBia = await comConta(bia);
  const contextoDoCaio = await comConta(null);

  const SALA = 'sala-dos-status';
  const entrar = async (contexto, nome, sala = SALA, convidado = null) => {
    const pagina = observar(await contexto.newPage(), nome);
    await pagina.goto(`${origem}/${sala}/sala`);
    if (convidado) await pagina.locator('#nameInput').fill(convidado);
    else await pagina.evaluate(() => window.NexoConta?.pronto);
    await pagina.locator('#nameConfirmBtn').click();
    await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    return pagina;
  };
  const salaDaAna = await entrar(contextoDaAna, 'Ana');
  const salaDaBia = await entrar(contextoDaBia, 'Bia');
  const salaDoCaio = await entrar(contextoDoCaio, 'Caio', SALA, 'Caio');
  for (const pagina of [salaDaAna, salaDaBia, salaDoCaio]) {
    await pagina.waitForFunction(() => document.querySelectorAll('#memberList .member').length === 3, null, { timeout: 20000 });
  }
  await salaDaAna.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });
  await salaDaBia.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });

  // O ponto de uma pessoa na lista de quem olha (`data-status` é o que o CSS desenha).
  const pontoDe = (pagina, nome) => pagina.evaluate(nome => {
    const linha = [...document.querySelectorAll('#memberList .member')].find(l => l.querySelector('.member-name').textContent.startsWith(nome));
    return linha ? { status: linha.querySelector('.member-avatar').dataset.status || null, titulo: linha.querySelector('.member-avatar').title, rotulo: linha.getAttribute('aria-label') } : null;
  }, nome);
  const esperarPonto = async (pagina, nome, status) => {
    let visto = null;
    await esperarAte(async () => { visto = await pontoDe(pagina, nome); return visto?.status === status; }, () => `o ponto de ${nome} não virou "${status}": ${JSON.stringify(visto)}`);
  };
  const escolherNoMenu = async (pagina, status) => {
    await pagina.locator('#presenceBtn').click();
    await pagina.locator(`#presenceMenu button[data-status="${status}"]`).click();
    await pagina.locator('#presenceMenu').waitFor({ state: 'hidden' });
  };

  // ---------- O padrão, e o menu ----------
  assert.deepEqual(await pontoDe(salaDaBia, 'Ana'), { status: 'online', titulo: 'Disponível', rotulo: 'Ver o perfil de Ana' }, 'quem não mexeu no status está disponível');
  assert.equal((await pontoDe(salaDaBia, 'Caio')).status, 'online', 'quem entrou sem conta aparece disponível: está aqui');
  await salaDaAna.locator('#presenceBtn').click();
  assert.equal(await salaDaAna.locator('#presenceConta').isVisible(), true, 'com conta, o menu tem o status da conta');
  assert.deepEqual(await salaDaAna.locator('#presenceConta button[data-status]').evaluateAll(bs => bs.map(b => [b.dataset.status, b.textContent.trim()])),
    [['online', 'Disponível'], ['ausente', 'Ausente'], ['ocupado', 'Não incomodar'], ['invisivel', 'Invisível']]);
  assert.equal(await salaDaAna.locator('#presenceConta button[data-status].ativo').getAttribute('data-status'), 'online', 'o atual vem marcado');
  assert.match(await salaDaAna.locator('#presenceStatusDica').textContent(), /conectado/i);
  await salaDaAna.keyboard.press('Escape');
  await salaDoCaio.locator('#presenceBtn').click();
  assert.equal(await salaDoCaio.locator('#presenceConta').isVisible(), false, 'sem conta não há onde guardar um status: o menu tem só o "agora na sala"');
  assert.equal(await salaDoCaio.locator('#presenceMenu [data-presence="hand"]').isVisible(), true);
  await salaDoCaio.keyboard.press('Escape');
  console.log('PASS: o padrão é disponível, o menu da sala tem o status da conta (e só com conta) e marca o atual');

  // ---------- Cada status chega a toda a sala, na hora, e fica na conta ----------
  const desenho = async (pagina, nome) => pagina.evaluate(nome => {
    const linha = [...document.querySelectorAll('#memberList .member')].find(l => l.querySelector('.member-name').textContent.startsWith(nome));
    const css = getComputedStyle(linha.querySelector('.member-avatar'), '::after');
    return { fundo: css.backgroundColor, camadas: css.backgroundImage, sombra: css.boxShadow, largura: css.width };
  }, nome);
  const desenhos = {};
  for (const [status, visto, nomeDoStatus] of [['ausente', 'ausente', 'Ausente'], ['ocupado', 'ocupado', 'Não incomodar'], ['invisivel', 'offline', 'Invisível'], ['online', 'online', 'Disponível']]) {
    await escolherNoMenu(salaDaAna, status);
    await esperarPonto(salaDaBia, 'Ana', visto);
    await esperarPonto(salaDoCaio, 'Ana', visto);
    await esperarAte(async () => (await salaDaAna.evaluate(() => document.getElementById('selfAvatar').dataset.status)) === visto, `o ponto do próprio "eu" não virou ${visto}`);
    assert.equal((await pontoDe(salaDaBia, 'Ana')).titulo, nomeDoStatus, 'o ponto diz o status também por escrito');
    assert.equal(await statusGuardado(ana), status, 'o status fica guardado na conta');
    assert.equal(await salaDaAna.locator('#meuPerfilBtn').getAttribute('title'), `Personalizar perfil · ${nomeDoStatus}`, 'o "eu" diz o status no texto do botão');
    desenhos[visto] = await desenho(salaDaBia, 'Ana');
    await salaDaBia.locator('#memberList').screenshot({ path: path.join(saida, `lista-${status}.png`) });
  }
  // Os quatro desenhos são diferentes: verde, âmbar com a lua, vermelho com o traço, anel vazio.
  assert.equal(desenhos.online.largura, '13px');
  assert.equal(desenhos.online.camadas, 'none', 'disponível é o ponto cheio');
  assert.match(desenhos.ausente.camadas, /radial-gradient/, 'ausente é a lua: o ponto com um pedaço comido');
  assert.match(desenhos.ocupado.camadas, /linear-gradient/, 'não incomodar é o traço: uma barra no ponto');
  assert.equal(new Set([desenhos.online.fundo, desenhos.ausente.fundo, desenhos.ocupado.fundo]).size, 3, 'verde, âmbar e vermelho');
  assert.notEqual(desenhos.offline.sombra, 'none', 'invisível é o anel vazio');
  assert.equal(desenhos.offline.camadas, 'none');
  console.log('PASS: cada status chega à lista de toda a sala na hora (com conta ou sem), no desenho do cartão, e fica guardado na conta');

  // O status mudado FORA da sala (outra aba, o início, o editor) também chega: é a mesma conta.
  const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: ana.cookie } })).json();
  const emOutraAba = status => fetch(`${origem}/api/conta/social`, { method: 'PUT', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: ana.cookie }, body: JSON.stringify({ status }) });
  assert.equal((await emOutraAba('ocupado')).status, 200);
  await esperarPonto(salaDaBia, 'Ana', 'ocupado');
  await esperarAte(() => salaDaAna.evaluate(() => NexoSocial.estado.minha?.escolhido === 'ocupado'), 'a página não soube do status mudado em outra aba');
  assert.equal(await salaDaAna.evaluate(() => document.getElementById('selfAvatar').dataset.status), 'ocupado');
  // E os amigos fora da sala veem o mesmo status pela presença: invisível é "desconectado".
  assert.equal((await emOutraAba('invisivel')).status, 200);
  await esperarAte(() => salaDaBia.evaluate(codigo => NexoSocial.presencaDe(codigo).status === 'offline', ana.conta.codigo), 'os amigos não veem a pessoa invisível como desconectada');
  assert.equal((await emOutraAba('online')).status, 200);
  await esperarAte(() => salaDaBia.evaluate(codigo => NexoSocial.presencaDe(codigo).status === 'online', ana.conta.codigo), 'os amigos não veem a pessoa disponível de novo');
  await esperarPonto(salaDaBia, 'Ana', 'online');
  console.log('PASS: o status mudado em outra aba chega à sala e aos amigos');

  // ---------- "Volto já" é estar ausente, na sala ----------
  const presencaDaSala = async (pagina, presenca) => {
    await pagina.locator('#presenceBtn').click();
    await pagina.locator(`#presenceMenu [data-presence="${presenca}"]`).click();
  };
  await presencaDaSala(salaDaAna, 'brb');
  await esperarPonto(salaDaBia, 'Ana', 'ausente');
  assert.equal(await statusGuardado(ana), 'online', 'o "volto já" vale só na sala: o status da conta não muda');
  assert.equal(await salaDaAna.evaluate(() => document.getElementById('selfAvatar').dataset.status), 'ausente');
  // Quem escolheu "não incomodar" continua com a escolha dele.
  await escolherNoMenu(salaDaAna, 'ocupado');
  await esperarPonto(salaDaBia, 'Ana', 'ocupado');
  await escolherNoMenu(salaDaAna, 'online');
  await esperarPonto(salaDaBia, 'Ana', 'ausente');
  await presencaDaSala(salaDaAna, '');
  await esperarPonto(salaDaBia, 'Ana', 'online');
  console.log('PASS: "volto já" desenha o ponto de ausente sem mexer no status da conta, e não desfaz o "não incomodar"');

  // ---------- O cartão de quem está na sala mostra o ponto ----------
  await escolherNoMenu(salaDaAna, 'ocupado');
  await esperarPonto(salaDaBia, 'Ana', 'ocupado');
  await salaDaBia.locator('#memberList .member', { hasText: 'Ana' }).click();
  await salaDaBia.locator('#perfilPanel:not(.hidden) .nx-av-status').waitFor();
  assert.equal(await salaDaBia.locator('#perfilVitrine .nx-av-status').getAttribute('data-status'), 'ocupado', 'o avatar do cartão tem o ponto');
  // Aberto, o cartão acompanha: o status muda e o ponto também, sem fechar e abrir de novo.
  await escolherNoMenu(salaDaAna, 'ausente');
  await esperarAte(async () => (await salaDaBia.locator('#perfilVitrine .nx-av-status').getAttribute('data-status')) === 'ausente', 'o cartão aberto não acompanhou o status');
  await salaDaBia.keyboard.press('Escape');
  console.log('PASS: o cartão de perfil na sala mostra o ponto de status e o acompanha enquanto está aberto');

  // ---------- Quem entra depois já o recebe, e ele continua depois do F5 ----------
  await escolherNoMenu(salaDaAna, 'ocupado');
  await salaDoCaio.close();
  const OUTRA = 'outra-sala-dos-status';
  await salaDaAna.goto(`${origem}/${OUTRA}/sala`);
  await salaDaAna.evaluate(() => window.NexoConta?.pronto);
  await salaDaAna.locator('#nameConfirmBtn').click();
  await salaDaAna.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await salaDaAna.evaluate(() => document.getElementById('selfAvatar').dataset.status), 'ocupado', 'depois do F5, a própria sala já mostra o status guardado');
  const caioDeNovo = await entrar(contextoDoCaio, 'Caio', OUTRA, 'Caio');
  await caioDeNovo.waitForFunction(() => document.querySelectorAll('#memberList .member').length === 2, null, { timeout: 20000 });
  assert.equal((await pontoDe(caioDeNovo, 'Ana')).status, 'ocupado', 'quem entra depois recebe o status de quem já estava');
  // E o contrário: quem chega com o status guardado aparece assim para quem já estava (o convidado olhando).
  await salaDaAna.goto(`${origem}/${SALA}/sala`);
  await salaDaAna.evaluate(() => window.NexoConta?.pronto);
  await salaDaAna.locator('#nameConfirmBtn').click();
  await salaDaAna.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await esperarAte(async () => (await pontoDe(salaDaBia, 'Ana'))?.status === 'ocupado', 'quem entrou com o status guardado não apareceu com ele');
  await caioDeNovo.close();
  console.log('PASS: o status vale para quem entra depois, e fica depois de recarregar a página');

  // ---------- "Não incomodar" faz o que promete ----------
  // O som: o que se confere é o RESULTADO do pedido (`tocar` devolve false quando calado), e não o som, que o
  // navegador sem tela nem toca. O aviso do sistema da menção entra por um espião da Notificação.
  await salaDaBia.evaluate(() => {
    window.sons = [];
    const tocar = NexoSons.tocar;
    NexoSons.tocar = (som, opcoes) => { const resultado = tocar(som, opcoes); sons.push([som, resultado]); return resultado; };
    window.avisosDoSistema = [];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.Notification = class { static permission = 'granted'; constructor(titulo) { avisosDoSistema.push(titulo); } };
  });
  const falar = async texto => {
    await salaDaAna.evaluate(texto => socket.emit('chat-message', { texto }), texto);
    await salaDaBia.waitForFunction(texto => [...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes(texto)), texto, { timeout: 8000 });
  };
  // O último pedido DESTE som: a chamada também toca (alguém entrando, a mídia chegando) e não pode confundir.
  const ultimoSom = som => salaDaBia.evaluate(som => sons.filter(([tipo]) => tipo === som).at(-1), som);
  await escolherNoMenu(salaDaBia, 'online');
  await salaDaBia.evaluate(() => { sons.length = 0; });
  await falar('mensagem comum, com a Bia disponível');
  assert.deepEqual(await ultimoSom('mensagem'), ['mensagem', true], 'disponível, a mensagem do chat toca');
  await dormir(1800);
  await falar('@Bia olha isto, com a Bia disponível');
  assert.deepEqual(await ultimoSom('mencao'), ['mencao', true], 'disponível, a menção toca o sino');
  await esperarAte(async () => (await salaDaBia.evaluate(() => avisosDoSistema.length)) === 1, 'a menção, com a aba escondida, não virou aviso do sistema');
  assert.equal(await salaDaBia.evaluate(() => avisosDoSistema[0]), 'Ana mencionou você no Nexo');

  await escolherNoMenu(salaDaBia, 'ocupado');
  await esperarPonto(salaDaAna, 'Bia', 'ocupado');
  await salaDaBia.evaluate(() => { sons.length = 0; avisosDoSistema.length = 0; });
  await dormir(1800);
  await falar('mensagem comum, com a Bia em não incomodar');
  assert.deepEqual(await ultimoSom('mensagem'), ['mensagem', false], 'em "não incomodar", a mensagem do chat não toca');
  await dormir(1400);
  await falar('@Bia olha isto, com a Bia em não incomodar');
  assert.deepEqual(await ultimoSom('mencao'), ['mencao', false], 'nem a menção toca o sino');
  await dormir(300);
  assert.equal(await salaDaBia.evaluate(() => avisosDoSistema.length), 0, 'nem vira aviso do sistema');
  assert.equal(await salaDaBia.locator('.msg.mencionou').count() >= 2, true, 'a menção continua marcada no chat, para quem olhar');
  // Os sons da chamada continuam: ouvir quem entra e sai é estar na sala. O próprio gesto também.
  assert.equal(await salaDaBia.evaluate(() => [NexoSons.tocar('entrada'), NexoSons.tocar('tela')]).then(r => r.every(Boolean)), true, 'entrada e tela seguem tocando');
  // E a prévia do painel de sons toca mesmo assim: é como se decide se um aviso fica.
  assert.equal(await salaDaBia.evaluate(() => NexoSons.previa('mensagem')), true);

  // Voltando a "disponível", tudo volta.
  await escolherNoMenu(salaDaBia, 'online');
  await salaDaBia.evaluate(() => { sons.length = 0; avisosDoSistema.length = 0; });
  await dormir(1800);
  await falar('mensagem comum, com a Bia disponível de novo');
  assert.deepEqual(await ultimoSom('mensagem'), ['mensagem', true]);
  console.log('PASS: em "não incomodar" o chat da sala não toca (nem a menção) nem avisa o sistema; a chamada segue com som, e disponível tudo volta');

  // O aviso de mensagem direta, no canto da sala: calado em "não incomodar", e o convite passa.
  const toastDe = (pagina, texto) => pagina.locator('.nexo-toast', { hasText: texto });
  await salaDaAna.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });
  await salaDaBia.waitForFunction(() => NexoSocial.estado.pronto, null, { timeout: 10000 });
  await escolherNoMenu(salaDaBia, 'ocupado');
  const antes = await salaDaBia.locator('.nexo-toast').count();
  const enviada = await salaDaAna.evaluate(codigo => NexoSocial.enviar(codigo, 'oi, mensagem direta em não incomodar'), bia.conta.codigo);
  assert.equal(enviada.ok, true, JSON.stringify(enviada));
  await salaDaBia.waitForFunction(() => NexoSocial.totalNaoLidas() >= 1, null, { timeout: 5000 });
  await dormir(1200);
  assert.equal(await salaDaBia.locator('.nexo-toast').count(), antes, 'em "não incomodar", a mensagem direta não vira aviso no canto');
  assert.equal(await salaDaBia.locator('#mensagensContagem').textContent(), '1', 'a contagem de não lidas continua: nada se perde');
  await salaDaAna.evaluate(codigo => NexoSocial.convidar(codigo, 'sala-do-convite-em-nao-incomodar'), bia.conta.codigo);
  await toastDe(salaDaBia, 'sala-do-convite-em-nao-incomodar').waitFor({ timeout: 5000 });
  await escolherNoMenu(salaDaBia, 'online');
  await salaDaAna.evaluate(codigo => NexoSocial.enviar(codigo, 'agora com a Bia disponível'), bia.conta.codigo);
  await toastDe(salaDaBia, 'agora com a Bia disponível').waitFor({ timeout: 5000 });
  console.log('PASS: em "não incomodar" a mensagem direta não vira aviso no canto (a contagem continua) e o convite passa; disponível, avisa');

  await salaDaAna.locator('#presenceBtn').click();
  await salaDaAna.waitForTimeout(450);
  await salaDaAna.screenshot({ path: path.join(saida, 'menu-do-status.png') });

  // Numa janela baixa (o celular deitado) o menu, que ficou alto com o status da conta, é maior que a tela:
  // tem de caber nela e rolar por dentro, com o último botão ao alcance -- e não ficar com o começo cortado.
  await salaDaAna.setViewportSize({ width: 740, height: 340 });
  await esperarAte(async () => {
    const c = await salaDaAna.locator('#presenceMenu').boundingBox();
    return c && c.y >= 0 && c.y + c.height <= 340.5;
  }, () => 'o menu de status não coube numa janela de 340 px de altura');
  assert.equal(await salaDaAna.locator('#presenceMenu').evaluate(el => el.scrollHeight > el.clientHeight), true, 'o menu rola por dentro quando a janela é baixa');
  // O último botão da fileira de reações (o "+" dos emojis, quando o seletor existe): o que está mais embaixo.
  const ultimoDoMenu = salaDaAna.locator('#presenceMenu .presence-reactions button:last-child');
  await ultimoDoMenu.scrollIntoViewIfNeeded();
  const menuBaixo = await salaDaAna.locator('#presenceMenu').boundingBox();
  const ultimo = await ultimoDoMenu.boundingBox();
  assert.ok(ultimo.y >= menuBaixo.y && ultimo.y + ultimo.height <= menuBaixo.y + menuBaixo.height + 0.5, 'o último botão do menu fica ao alcance, rolando');
  await salaDaAna.keyboard.press('Escape');
  await salaDaAna.setViewportSize({ width: 1360, height: 900 });
  console.log('PASS: numa janela baixa o menu de status cabe na tela e rola por dentro');

  // ---------- O "eu" do início: o mesmo ponto e o mesmo destaque do menu da sala ----------
  // O menu que sobe do canto de baixo do início tinha quatro carinhas iguais e um visto no escolhido: não dizia
  // o que cada status era. Agora cada um leva o seu ponto (o do cartão) e o escolhido, o destaque do menu da sala.
  const inicioDaAna = observar(await contextoDaAna.newPage(), 'Ana no início');
  await inicioDaAna.goto(`${origem}/`);
  await inicioDaAna.waitForFunction(() => document.getElementById('euNome')?.textContent, null, { timeout: 15000 });
  const abrirOMenuDoEu = async () => {
    await inicioDaAna.locator('#euBtn').click();
    await inicioDaAna.locator('#menuFlutuante:not([hidden])').waitFor();
  };
  const itensDoEu = () => inicioDaAna.locator('#menuFlutuante [role="menuitemradio"]');
  const IDS = ['online', 'ausente', 'ocupado', 'invisivel'];
  const atualDaAna = await statusGuardado(ana);
  await abrirOMenuDoEu();
  assert.deepEqual(await itensDoEu().evaluateAll(bs => bs.map(b => [b.textContent.trim(), b.querySelector('.nx-ponto')?.dataset.status, b.getAttribute('aria-checked'), Boolean(b.querySelector('svg'))])),
    IDS.map((id, i) => [['Disponível', 'Ausente', 'Não incomodar', 'Invisível'][i], id, String(id === atualDaAna), false]),
    'os quatro status levam o seu ponto, sem ícone, e só o escolhido está marcado');
  // Os quatro pontos são desenhos diferentes (verde, lua, traço, anel), e não quatro carinhas iguais.
  const pontosDoMenu = await itensDoEu().evaluateAll(bs => bs.map(b => {
    const e = getComputedStyle(b.querySelector('.nx-ponto'));
    return [e.backgroundColor, e.maskImage !== 'none' ? e.maskImage : e.webkitMaskImage, e.boxShadow].join('|');
  }));
  assert.equal(new Set(pontosDoMenu).size, 4, `os pontos do menu são quatro desenhos diferentes: ${JSON.stringify(pontosDoMenu)}`);
  // O escolhido leva o destaque (o fundo do destaque), e os outros ficam sem fundo.
  const fundos = await itensDoEu().evaluateAll(bs => bs.map(b => [b.getAttribute('aria-checked'), getComputedStyle(b).backgroundColor]));
  for (const [marcado, fundo] of fundos) assert.equal(fundo === 'rgba(0, 0, 0, 0)', marcado === 'false', `o destaque é só do escolhido: ${JSON.stringify(fundos)}`);
  // O ponto ocupa o lugar de um ícone: o rótulo começa no mesmo lugar dos outros itens do menu.
  const comecos = await inicioDaAna.locator('#menuFlutuante .nx-menu-item').evaluateAll(bs => bs.map(b => Math.round(b.querySelector('span:not(.ico)').getBoundingClientRect().left)));
  assert.equal(new Set(comecos).size, 1, `os rótulos do menu começam no mesmo lugar: ${JSON.stringify(comecos)}`);
  await inicioDaAna.screenshot({ path: path.join(saida, 'menu-do-eu.png'), clip: { x: 0, y: 420, width: 420, height: 460 } });
  // Escolher um status por ali chega à sala de quem olha, e o destaque acompanha na próxima abertura.
  await inicioDaAna.locator('#menuFlutuante [role="menuitemradio"]', { hasText: 'Não incomodar' }).click();
  await inicioDaAna.locator('#menuFlutuante').waitFor({ state: 'hidden' });
  await esperarPonto(salaDaBia, 'Ana', 'ocupado');
  await abrirOMenuDoEu();
  assert.equal(await inicioDaAna.locator('#menuFlutuante [role="menuitemradio"][aria-checked="true"]').textContent().then(t => t.trim()), 'Não incomodar', 'o destaque foi para o status escolhido');
  await inicioDaAna.locator('#menuFlutuante [role="menuitemradio"]', { hasText: 'Disponível' }).click();
  await esperarPonto(salaDaBia, 'Ana', 'online');
  console.log('PASS: o menu do "eu" no início mostra cada status com o seu ponto e marca o escolhido como o menu da sala; escolher ali muda a sala de quem olha');

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
