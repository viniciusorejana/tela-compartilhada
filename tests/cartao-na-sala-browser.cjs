// O cartão de perfil de alguém, aberto de dentro da sala: o cartão de cima (a arte, o avatar, o nome, a frase,
// a bio) é sempre inteiro, e o que a sala acrescenta embaixo dele -- o tempo na sala, a explicação do código e o
// "Levar para o OBS" -- nasce minimizado e espera o "Ver mais". A linha de amizade e os botões não se escondem, e
// a escolha é lembrada. Sem servidor de mídia.
//
//   npm run test:cartao-sala
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3243;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'cartao-na-sala');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) }, midia: true });
  const ana = await instancia.conta('anacartao', { apelido: 'Ana' });
  const bia = await instancia.conta('biacartao', { apelido: 'Bia' });
  // O cartão da Bia tem bio, frase e pensamento: tudo isso é o cartão de cima, e nada disso se esconde.
  const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: bia.cookie } })).json();
  const cabecalhos = { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: bia.cookie };
  const salvo = await fetch(`${origem}/api/conta/vitrine`, { method: 'PUT', headers: cabecalhos, body: JSON.stringify({ vitrine: { bio: 'Jogo de tudo um pouco, e sempre de fone.', pensamento: 'pizza hoje?' } }) });
  assert.equal(salvo.status, 200, await salvo.text());
  const frase = await fetch(`${origem}/api/conta/social`, { method: 'PUT', headers: cabecalhos, body: JSON.stringify({ frase: { texto: 'no treino', emoji: '🏐', ate: Date.now() + 3600000 } }) });
  assert.equal(frase.status, 200, await frase.text());

  navegador = await chromium.launch({ headless: true });
  const entrar = async (quem, nome) => {
    const contexto = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
    await contexto.addCookies([{ name: 'nexo_conta', value: quem.cookie.split('=')[1], url: origem }]);
    const pagina = await contexto.newPage();
    pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
    await pagina.goto(`${origem}/sala-do-cartao/sala`);
    await pagina.evaluate(() => window.NexoConta?.pronto);
    await pagina.locator('#nameConfirmBtn').click();
    await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    return pagina;
  };
  const salaDaAna = await entrar(ana, 'Ana');
  const salaDaBia = await entrar(bia, 'Bia');
  await salaDaAna.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });
  // O servidor manda o cartão de cada um junto do perfil; espera ele chegar.
  await salaDaAna.waitForFunction(() => [...perfisPorIdentidade.values()].some(p => p.cartao?.vitrine?.bio), null, { timeout: 20000 });

  const idDaBia = await salaDaAna.evaluate(() => [...peers.values()].find(p => p.name === 'Bia').id);
  const abrir = async () => {
    await salaDaAna.evaluate(id => abrirPerfil(id), idDaBia);
    await salaDaAna.locator('#perfilPanel').waitFor({ state: 'visible' });
    await salaDaAna.waitForTimeout(350); // o painel entra crescendo
  };
  const visivel = seletor => salaDaAna.locator(seletor).first().isVisible();
  const fechar = async () => {
    await salaDaAna.locator('#perfilPanel [data-close="perfilPanel"]').click();
    await salaDaAna.locator('#perfilPanel').waitFor({ state: 'hidden' });
  };

  // ---------- Nasce minimizado ----------
  await abrir();
  const mais = salaDaAna.locator('#perfilMais');
  assert.equal(await mais.getAttribute('aria-expanded'), 'false');
  assert.equal((await mais.textContent()).trim(), 'Ver mais');
  assert.equal(await salaDaAna.locator('#perfilNome').textContent(), 'Bia', 'o nome fica à vista');
  assert.match(await salaDaAna.locator('#perfilCodigo').textContent(), /^Código /, 'e o código');
  assert.equal(await visivel('#perfilPanel .nx-cartao-banner'), true, 'a arte também');
  // O cartão de cima é a vitrine da pessoa e fica inteiro, minimizado ou não.
  for (const daVitrine of ['.nx-cartao-bio', '.nx-cartao-frase']) {
    assert.equal(await visivel(daVitrine), true, `${daVitrine} é do cartão de cima e não se esconde`);
  }
  assert.match(await salaDaAna.locator('.nx-cartao-bio').textContent(), /Jogo de tudo um pouco/);
  // O que a sala acrescenta embaixo espera o "Ver mais".
  for (const escondido of ['#perfilDica', '#perfilTempo', '#perfilDetalhes']) {
    assert.equal(await visivel(escondido), false, `${escondido} espera o "Ver mais"`);
  }
  assert.match(await salaDaAna.locator('#perfilDica').textContent(), /O código é permanente/, 'a explicação está no cartão, só recolhida');
  // O que é ação não se esconde: o botão de fechar e a linha de amizade (entre duas contas).
  assert.equal(await visivel('#perfilPanel [data-close="perfilPanel"]'), true, 'os botões de baixo ficam');
  await salaDaAna.waitForFunction(() => !document.getElementById('perfilSocial').hidden, null, { timeout: 10000 });
  assert.equal(await visivel('#perfilSocial'), true, 'a linha de amizade (Adicionar amigo) fica');
  const alturaMinimizado = await salaDaAna.locator('#perfilPanel .perfil-card').evaluate(el => el.offsetHeight);
  await salaDaAna.screenshot({ path: path.join(saida, 'cartao-minimizado.png') });

  // ---------- Ver mais ----------
  await mais.click();
  assert.equal(await mais.getAttribute('aria-expanded'), 'true');
  assert.equal((await mais.textContent()).trim(), 'Ver menos');
  assert.equal(await salaDaAna.evaluate(() => document.activeElement?.id), 'perfilMais', 'o foco continua no botão');
  assert.equal(await visivel('#perfilDica'), true);
  assert.match(await salaDaAna.locator('#perfilDica').textContent(), /O código é permanente e não muda com o apelido/);
  // O tempo na sala só aparece se a sala já o sabe; quando sabe, ele vem junto da explicação.
  if (!await salaDaAna.locator('#perfilTempo').evaluate(el => el.hidden)) assert.equal(await visivel('#perfilTempo'), true);
  assert.equal(await visivel('.nx-cartao-bio'), true, 'o cartão de cima segue como estava');
  const alturaExpandido = await salaDaAna.locator('#perfilPanel .perfil-card').evaluate(el => el.offsetHeight);
  assert.ok(alturaExpandido > alturaMinimizado + 30, `o cartão cresce ao expandir (${alturaMinimizado} → ${alturaExpandido})`);
  await salaDaAna.screenshot({ path: path.join(saida, 'cartao-expandido.png') });

  // A escolha é lembrada: abrir de novo (e depois de recarregar) continua expandido.
  await fechar();
  await abrir();
  assert.equal(await mais.getAttribute('aria-expanded'), 'true', 'o cartão seguinte abre como a pessoa deixou');
  assert.equal(await salaDaAna.evaluate(() => Preferencias.ler('perfilMinimizado', 'padrao')), false);
  await fechar();
  await salaDaAna.reload();
  await salaDaAna.evaluate(() => window.NexoConta?.pronto);
  await salaDaAna.locator('#nameConfirmBtn').click();
  await salaDaAna.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await salaDaAna.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });
  await salaDaAna.waitForFunction(() => [...perfisPorIdentidade.values()].some(p => p.cartao?.vitrine?.bio), null, { timeout: 20000 });
  const novoId = await salaDaAna.evaluate(() => [...peers.values()].find(p => p.name === 'Bia').id);
  await salaDaAna.evaluate(id => abrirPerfil(id), novoId);
  await salaDaAna.locator('#perfilPanel').waitFor({ state: 'visible' });
  assert.equal(await mais.getAttribute('aria-expanded'), 'true', 'o F5 não desfaz');

  // ---------- Ver menos ----------
  await mais.click();
  assert.equal(await mais.getAttribute('aria-expanded'), 'false');
  assert.equal(await visivel('#perfilDica'), false);
  assert.equal(await visivel('.nx-cartao-bio'), true, 'minimizar não mexe no cartão de cima');
  assert.equal(await salaDaAna.evaluate(() => Preferencias.ler('perfilMinimizado', 'padrao')), 'padrao', 'minimizar apaga a escolha: o padrão é o minimizado');
  await fechar();

  // O meu próprio cartão tem o mesmo comportamento, e os botões de editar ficam à vista.
  await salaDaAna.evaluate(() => abrirPerfil('self'));
  await salaDaAna.locator('#perfilPanel').waitFor({ state: 'visible' });
  assert.equal(await mais.getAttribute('aria-expanded'), 'false');
  assert.equal(await visivel('#perfilPersonalizar'), true, '"Personalizar o cartão" não se esconde');
  assert.equal(await salaDaAna.locator('.nx-cartao-nome').first().textContent(), 'Ana (você)');
  await fechar();

  assert.deepEqual(erros, []);
  console.log('PASS: na sala o cartão de cima fica inteiro e o que vem embaixo abre minimizado, expande com o "Ver mais", lembra a escolha e nunca esconde os botões');
})().catch(erro => { console.error(erro); process.exitCode = 1; }).finally(async () => {
  await navegador?.close();
  await instancia?.encerrar();
});
