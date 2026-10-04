// A foto de perfil ampliada, em toda tela onde a pessoa aparece com foto: o cartão de um amigo no
// início, a prévia do editor do cartão (a minha), a página da conta, o "Meu perfil" e as
// configurações da sala, e o cartão aberto na camada do início de dentro de uma chamada.
//
// Antes só o avatar do cartão de perfil da sala abria a foto grande (o visor era dela). O visor
// agora é um só (public/foto-grande.js), o `montar` do cartão liga o avatar de todo cartão, e as
// telas com a minha foto ligam a delas. O contrato do visor: com foto o avatar é botão; sem foto,
// só um desenho; Esc fecha a foto e só ela; o foco volta ao avatar.
//
// Sem servidor de mídia: o que se prova aqui é a tela, não o LiveKit.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3237;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'foto');
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
const observar = (pagina, nome) => {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
};

// Uma foto de verdade, desenhada num canvas e enviada pelo mesmo caminho da página da conta.
async function enviarFoto(pagina) {
  return pagina.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 600, height: 400 });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff7a00'; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#1b1c27'; ctx.beginPath(); ctx.arc(300, 200, 120, 0, Math.PI * 2); ctx.fill();
    const arquivo = new File([await new Promise(r => canvas.toBlob(r, 'image/png'))], 'foto.png', { type: 'image/png' });
    const blob = await NexoImagem.prepararAvatar(arquivo);
    const r = await NexoImagem.enviar('/api/conta/avatar', blob, { csrf: NexoConta.atual().csrf });
    return { ok: r.ok, avatar: r.dados.perfil?.avatar };
  });
}

// O visor aberto: a foto certa, de quem é, e do tamanho de uma foto (não um ícone).
async function conferirVisor(pagina, { foto, nome, onde }) {
  await pagina.locator('#fotoPanel:not([hidden])').waitFor({ timeout: 5000 });
  assert.match(await pagina.locator('#fotoGrande').getAttribute('src'), new RegExp(foto), `${onde}: a foto é a da pessoa`);
  assert.equal(await pagina.locator('#fotoNome').textContent(), nome, `${onde}: a legenda diz quem é`);
  await pagina.waitForFunction(() => document.getElementById('fotoGrande').naturalWidth > 0, null, { timeout: 10000 });
  const caixa = await pagina.locator('#fotoGrande').boundingBox();
  assert.ok(caixa.width >= 200 && Math.abs(caixa.width - caixa.height) < 2, `${onde}: a foto aparece grande e quadrada (${Math.round(caixa.width)}×${Math.round(caixa.height)})`);
  assert.equal(await pagina.evaluate(() => document.activeElement?.classList.contains('nx-foto-fechar')), true, `${onde}: o foco vai para o X do visor`);
  await conferirOX(pagina, onde);
}
// O X é um círculo escuro de 30 px com o desenho dentro, em qualquer página -- e não só onde social.css
// está carregada. Na conta, o `button` global de home.css o pintava de roxo, com 100% de largura e 44 px
// de altura mínima: um oval sem X. As medidas são as do layout (`offset*`), que a animação de entrada do
// visor não escala.
async function conferirOX(pagina, onde) {
  const x = await pagina.locator('.nx-foto-fechar').evaluate(el => {
    const css = getComputedStyle(el);
    return {
      largura: el.offsetWidth, altura: el.offsetHeight, raio: css.borderTopLeftRadius, fundo: css.backgroundColor, cor: css.color,
      desenho: getComputedStyle(el.querySelector('svg')).width, traco: getComputedStyle(el.querySelector('svg')).stroke,
      topo: el.offsetTop, direita: el.offsetParent.clientWidth - el.offsetLeft - el.offsetWidth
    };
  });
  assert.deepEqual([x.largura, x.altura], [30, 30], `${onde}: o X é um círculo de 30 px, e não um oval (${x.largura}×${x.altura})`);
  assert.equal(x.raio, '50%', `${onde}: o X é redondo`);
  assert.equal(x.fundo, 'rgba(13, 13, 22, 0.7)', `${onde}: o fundo do X é o escuro fixo, e não o roxo do destaque (${x.fundo})`);
  assert.equal(x.cor, 'rgb(255, 255, 255)', `${onde}: o X é branco`);
  assert.equal(x.desenho, '18px', `${onde}: o desenho do X aparece`);
  assert.notEqual(x.traco, 'none', `${onde}: o desenho do X tem traço`);
  assert.deepEqual([x.topo, x.direita], [18, 18], `${onde}: o X fica no canto de cima, à direita, sobre a foto`);
}
const fecharComEsc = async pagina => {
  await pagina.keyboard.press('Escape');
  await pagina.locator('#fotoPanel').waitFor({ state: 'hidden' });
};

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anafoto', { apelido: 'Ana' });
  const bia = await instancia.conta('biafoto', { apelido: 'Bia Souza' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biafoto', 201], [bia, '@anafoto', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }

  navegador = await chromium.launch({ headless: true });
  const comConta = async (conta, opcoes = { viewport: { width: 1360, height: 900 } }) => {
    const contexto = await navegador.newContext(opcoes);
    await contexto.addCookies([{ name: 'nexo_conta', value: conta.cookie.split('=')[1], url: origem }]);
    return contexto;
  };
  const contextoDaAna = await comConta(ana);
  const contextoDaBia = await comConta(bia);

  // ---------- O cartão de um amigo, no início ----------
  const inicioDaAna = observar(await contextoDaAna.newPage(), 'Ana');
  await inicioDaAna.goto(origem);
  await inicioDaAna.waitForFunction(() => NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });
  await inicioDaAna.locator('#abasAmigos [data-aba="todos"]').click();
  const abrirCartaoDaBia = async () => {
    await inicioDaAna.locator('#listaAmigos .nx-amigo', { hasText: 'Bia Souza' }).click();
    await inicioDaAna.locator('#cartaoModal:not([hidden]) .nx-cartao').waitFor();
  };
  await abrirCartaoDaBia();
  assert.equal(await inicioDaAna.locator('#cartaoModal .nx-av-img').getAttribute('role'), null, 'sem foto, o avatar do cartão é só um desenho');
  await inicioDaAna.keyboard.press('Escape');
  await inicioDaAna.locator('#cartaoModal').waitFor({ state: 'hidden' });

  const inicioDaBia = observar(await contextoDaBia.newPage(), 'Bia');
  await inicioDaBia.goto(origem);
  await inicioDaBia.locator('#inicioApp').waitFor();
  const foto = await enviarFoto(inicioDaBia);
  assert.ok(foto.ok && foto.avatar, 'a foto da Bia sobe');

  await abrirCartaoDaBia();
  const avatarDoCartao = inicioDaAna.locator('#cartaoModal .nx-av-img');
  assert.equal(await avatarDoCartao.getAttribute('role'), 'button', 'com foto, o avatar do cartão se abre');
  assert.equal(await avatarDoCartao.getAttribute('aria-label'), 'Ver a foto de Bia Souza maior');
  await avatarDoCartao.click();
  await conferirVisor(inicioDaAna, { foto: foto.avatar, nome: 'Bia Souza', onde: 'cartão do início' });
  await inicioDaAna.waitForTimeout(450); // o visor entra com movimento: o print é o do fim
  await inicioDaAna.screenshot({ path: path.join(saida, 'cartao-do-inicio.png') });
  // Esc fecha a foto e só ela: o cartão de onde ela veio continua, com o foco no avatar.
  await fecharComEsc(inicioDaAna);
  assert.equal(await inicioDaAna.locator('#cartaoModal').isVisible(), true, 'o Esc fecha a foto e volta ao cartão');
  assert.equal(await avatarDoCartao.evaluate(el => el === document.activeElement), true, 'e o foco volta ao avatar');
  // Pelo teclado: Enter abre, clicar fora fecha.
  await inicioDaAna.keyboard.press('Enter');
  await inicioDaAna.locator('#fotoPanel:not([hidden])').waitFor();
  await inicioDaAna.mouse.click(8, 8);
  await inicioDaAna.locator('#fotoPanel').waitFor({ state: 'hidden' });
  // Só então o segundo Esc fecha o cartão.
  await inicioDaAna.keyboard.press('Escape');
  await inicioDaAna.locator('#cartaoModal').waitFor({ state: 'hidden' });
  console.log('PASS: o avatar do cartão de um amigo, no início, abre a foto grande (mouse e teclado); Esc fecha a foto e depois o cartão');

  // ---------- A prévia do editor do cartão: a minha ----------
  // A foto subiu depois de a página carregar o perfil: como na vida real (sobe na conta, abre o
  // editor numa página nova), o editor parte do perfil que a conta tem agora.
  await inicioDaBia.reload();
  await inicioDaBia.locator('#inicioApp').waitFor();
  await inicioDaBia.locator('.ini-secao[data-secao="perfil"]').click();
  const previa = inicioDaBia.locator('.ed-previa-cartao .nx-av-img');
  await previa.waitFor();
  assert.equal(await previa.getAttribute('role'), 'button', 'a prévia do editor mostra a minha foto, e ela se abre');
  await previa.click();
  await conferirVisor(inicioDaBia, { foto: foto.avatar, nome: 'Bia Souza', onde: 'prévia do editor' });
  await fecharComEsc(inicioDaBia);
  // A prévia é refeita a cada mudança: a foto continua abrindo depois de mexer num campo.
  await inicioDaBia.locator('.ed-abas [data-parte="sobre"]').click();
  await inicioDaBia.locator('[data-ed="pronomes"]').fill('ela/dela');
  await inicioDaBia.locator('.ed-previa-cartao .nx-cartao-linha', { hasText: 'ela/dela' }).waitFor();
  await inicioDaBia.locator('.ed-previa-cartao .nx-av-img[role="button"]').click();
  await inicioDaBia.locator('#fotoPanel:not([hidden])').waitFor();
  await fecharComEsc(inicioDaBia);
  console.log('PASS: a prévia do editor do cartão abre a minha foto, e continua abrindo quando a prévia é refeita');

  // ---------- A página da conta ----------
  const conta = observar(await contextoDaBia.newPage(), 'Bia na conta');
  await conta.goto(`${origem}/conta`);
  await conta.locator('#comConta').waitFor();
  assert.equal(await conta.locator('#contaAvatar').getAttribute('role'), 'button', 'o avatar do topo da conta se abre');
  await conta.locator('#contaAvatar').click();
  await conferirVisor(conta, { foto: foto.avatar, nome: 'Bia Souza', onde: 'página da conta' });
  await fecharComEsc(conta);
  await conta.close();
  const contaDaAna = observar(await contextoDaAna.newPage(), 'Ana na conta');
  await contaDaAna.goto(`${origem}/conta`);
  await contaDaAna.locator('#comConta').waitFor();
  assert.equal(await contaDaAna.locator('#contaAvatar').getAttribute('role'), null, 'quem não tem foto não tem o que ampliar');
  await contaDaAna.close();
  console.log('PASS: o avatar do topo da conta abre a minha foto; sem foto, é só um desenho');

  // ---------- Dentro da sala: Meu perfil e configurações ----------
  const SALA = 'sala-das-fotos';
  const salaDaBia = observar(await contextoDaBia.newPage(), 'Bia na sala');
  await salaDaBia.goto(`${origem}/${SALA}/sala`);
  await salaDaBia.evaluate(() => window.NexoConta?.pronto);
  await salaDaBia.locator('#nameConfirmBtn').click();
  await salaDaBia.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await salaDaBia.locator('#meuPerfilBtn').click();
  assert.equal(await salaDaBia.locator('#meuPerfilAvatar').getAttribute('role'), 'button', 'a prévia do "Meu perfil" se abre');
  await salaDaBia.locator('#meuPerfilAvatar').click();
  await conferirVisor(salaDaBia, { foto: foto.avatar, nome: 'Bia Souza', onde: 'Meu perfil' });
  assert.equal(await salaDaBia.evaluate(() => document.querySelector('.app').inert), true, 'a sala está inerte sob o painel, mas o visor responde');
  await salaDaBia.waitForTimeout(450);
  await salaDaBia.screenshot({ path: path.join(saida, 'meu-perfil.png') });
  await fecharComEsc(salaDaBia);
  assert.equal(await salaDaBia.locator('#meuPerfilPanel').evaluate(el => !el.classList.contains('hidden')), true, 'o Esc fecha a foto, e o painel fica');
  await salaDaBia.locator('#meuPerfilPanel [data-close]').click();
  await salaDaBia.locator('#meuPerfilPanel').waitFor({ state: 'hidden' });
  await salaDaBia.evaluate(() => NexoConfig.abrir('perfil'));
  assert.equal(await salaDaBia.locator('#configAvatar').getAttribute('role'), 'button', 'o resumo das configurações se abre');
  await salaDaBia.locator('#configAvatar').click();
  await conferirVisor(salaDaBia, { foto: foto.avatar, nome: 'Bia Souza', onde: 'configurações' });
  await fecharComEsc(salaDaBia);
  await salaDaBia.keyboard.press('Escape');
  console.log('PASS: o "Meu perfil" e o resumo das configurações da sala abrem a minha foto, por cima do painel');

  // ---------- O cartão de alguém na sala, e no início aberto por cima dela ----------
  const salaDaAna = observar(await contextoDaAna.newPage(), 'Ana na sala');
  await salaDaAna.goto(`${origem}/${SALA}/sala`);
  await salaDaAna.evaluate(() => window.NexoConta?.pronto);
  await salaDaAna.locator('#nameConfirmBtn').click();
  await salaDaAna.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await salaDaAna.locator('.workspace-name').click();
  await salaDaAna.locator('.camada-quadro.pronto').waitFor({ timeout: 15000 });
  const quadro = salaDaAna.frameLocator('.camada-quadro');
  await quadro.locator('#listaAmigos .nx-amigo', { hasText: 'Bia Souza' }).click();
  await quadro.locator('#cartaoModal:not([hidden]) .nx-av-img[role="button"]').click();
  await quadro.locator('#fotoPanel:not([hidden])').waitFor();
  assert.match(await quadro.locator('#fotoGrande').getAttribute('src'), new RegExp(foto.avatar), 'dentro da camada, a foto é a da Bia');
  await salaDaAna.waitForTimeout(450);
  await salaDaAna.screenshot({ path: path.join(saida, 'na-camada.png') });
  await salaDaAna.keyboard.press('Escape');
  await quadro.locator('#fotoPanel').waitFor({ state: 'hidden' });
  assert.equal(await salaDaAna.locator('#camadaPanel').evaluate(el => !el.classList.contains('hidden')), true, 'o Esc fecha só a foto: a camada continua aberta');
  await salaDaAna.locator('#camadaVoltar').click();
  await salaDaAna.locator('#camadaPanel').waitFor({ state: 'hidden' });
  console.log('PASS: dentro do início aberto por cima da sala, o cartão de um amigo abre a foto, e o Esc fecha só a foto');

  // ---------- O editor do cartão: trocar a foto ----------
  // "Personalizar perfil" não tinha como trocar a foto (só a página da conta e o "Meu perfil" da sala tinham).
  // Agora o grupo "Foto de perfil" abre o editor, no início e no painel da sala; ela vale ao ser escolhida,
  // sem o "Salvar o cartão", e o "eu" do início e a sala a recebem na hora.
  const fotoDaConta = async quem => (await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: quem.cookie } })).json()).perfil.avatar;
  const desenharPng = pagina => pagina.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 400, height: 300 });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a9d8f'; ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#f4a261'; ctx.beginPath(); ctx.arc(200, 150, 90, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await inicioDaAna.bringToFront();
  await inicioDaAna.locator('.ini-secao[data-secao="perfil"]').click();
  const grupoDaFoto = inicioDaAna.locator('#editorCartao .ed-foto');
  await grupoDaFoto.waitFor();
  // O título não se repete: a barra de cima já diz onde a pessoa está.
  assert.equal(await inicioDaAna.locator('#tituloSecao').textContent(), 'Personalizar perfil');
  // (O nome da pessoa no cartão da prévia também é um h2: o que se procura é o título do cabeçalho do editor.)
  assert.equal(await inicioDaAna.locator('#vistaPerfil .ed-cabeca h2').count(), 0, 'o título não se repete dentro de "Personalizar perfil"');
  assert.equal(await grupoDaFoto.locator('.nx-av-img').getAttribute('role'), null, 'sem foto, o avatar do grupo é só um desenho');
  assert.equal(await grupoDaFoto.locator('[data-ed="fotoRotulo"]').textContent(), 'Enviar uma foto');
  assert.equal(await grupoDaFoto.locator('[data-ed="fotoTirar"]').isHidden(), true, 'sem foto, não há o que tirar');
  assert.equal(await fotoDaConta(ana), null);
  await grupoDaFoto.locator('[data-ed="fotoArquivo"]').setInputFiles({ name: 'minha-foto.png', mimeType: 'image/png', buffer: Buffer.from(await desenharPng(inicioDaAna), 'base64') });
  await esperarAte(async () => (await grupoDaFoto.locator('.nx-av-img.com-foto').count()) === 1, 'a foto não apareceu no editor');
  const novaFoto = await fotoDaConta(ana);
  assert.ok(novaFoto, 'a foto chegou à conta, sem salvar o cartão');
  assert.match(await grupoDaFoto.locator('[data-ed="fotoRetorno"]').textContent(), /Foto trocada/);
  assert.equal(await grupoDaFoto.locator('[data-ed="fotoRotulo"]').textContent(), 'Trocar a foto');
  assert.equal(await grupoDaFoto.locator('[data-ed="fotoTirar"]').isVisible(), true);
  assert.equal(await inicioDaAna.locator('#editorCartao .ed-previa-cartao .nx-av-img.com-foto').count(), 1, 'a prévia do cartão já mostra a foto');
  assert.equal(await inicioDaAna.locator('#euAvatar .nx-av-img.com-foto').count(), 1, 'e o "eu" da lateral também');
  assert.equal(await inicioDaAna.locator('[data-ed="salvar"]').isDisabled(), true, 'a foto não é do cartão: não deixou nada para salvar');
  // O avatar do grupo abre a foto grande, como o da prévia.
  await grupoDaFoto.locator('.nx-av-img').click();
  await conferirVisor(inicioDaAna, { foto: novaFoto, nome: 'Ana', onde: 'foto do editor' });
  await fecharComEsc(inicioDaAna);
  // Tirar volta ao desenho (a cor e as iniciais).
  await grupoDaFoto.locator('[data-ed="fotoTirar"]').click();
  await esperarAte(async () => (await fotoDaConta(ana)) === null, 'tirar a foto não chegou à conta');
  await esperarAte(async () => (await grupoDaFoto.locator('.nx-av-img.com-foto').count()) === 0, 'a foto continuou no editor depois de tirada');
  assert.equal(await grupoDaFoto.locator('[data-ed="fotoRotulo"]').textContent(), 'Enviar uma foto');
  assert.equal(await inicioDaAna.locator('#euAvatar .nx-av-img.com-foto').count(), 0);
  // Um arquivo que não é imagem é dito, e nada muda.
  await grupoDaFoto.locator('[data-ed="fotoArquivo"]').setInputFiles({ name: 'texto.txt', mimeType: 'text/plain', buffer: Buffer.from('não sou uma imagem') });
  await esperarAte(async () => /PNG, JPEG, GIF ou WebP/.test(await grupoDaFoto.locator('[data-ed="fotoRetorno"]').textContent()), 'um arquivo que não é imagem não foi recusado');
  assert.equal(await fotoDaConta(ana), null);
  await inicioDaAna.screenshot({ path: path.join(saida, 'editor-foto.png') });
  // "Conquistas" também não repete o título.
  await inicioDaAna.locator('.ini-secao[data-secao="conquistas"]').click();
  await inicioDaAna.locator('#vistaConquistas:not([hidden]) #gradeConquistas .ini-conquista').first().waitFor();
  assert.equal(await inicioDaAna.locator('#tituloSecao').textContent(), 'Conquistas');
  assert.equal(await inicioDaAna.locator('#vistaConquistas h2').count(), 0, 'o título não se repete dentro de "Conquistas"');
  assert.match(await inicioDaAna.locator('#conquistasResumo').textContent(), /conquistas\. Algumas liberam/, 'o resumo e a barra de progresso continuam');
  // No painel da sala o título fica: ali não há barra de cima que o diga.
  await salaDaAna.bringToFront();
  await salaDaAna.evaluate(() => NexoSalaSocial.abrirEditor());
  await salaDaAna.locator('#editorCartaoSala .ed-foto').waitFor();
  assert.equal(await salaDaAna.locator('#editorCartaoSala .ed-cabeca h2').textContent(), 'Personalizar perfil', 'no painel da sala o título fica');
  await salaDaAna.locator('#editorCartaoSala [data-ed="fotoArquivo"]').setInputFiles({ name: 'da-sala.png', mimeType: 'image/png', buffer: Buffer.from(await desenharPng(salaDaAna), 'base64') });
  await esperarAte(async () => Boolean(await salaDaAna.evaluate(() => meuPerfil?.avatar)), 'a sala não recebeu a foto trocada pelo editor');
  await esperarAte(async () => (await salaDaAna.locator('#selfAvatar.com-foto').count()) === 1, 'o "eu" da sala não mostrou a foto nova');
  assert.ok(await fotoDaConta(ana));
  await salaDaAna.locator('#editorCartaoSala [data-ed="fotoTirar"]').click();
  await esperarAte(async () => (await fotoDaConta(ana)) === null, 'tirar a foto, na sala, não chegou à conta');
  await salaDaAna.locator('#editorCartaoPanel .modal-fechar').click();
  console.log('PASS: "Personalizar perfil" troca e tira a foto (no início e no painel da sala), sem salvar o cartão; a prévia, o "eu" e a sala acompanham; e o título não se repete');

  // ---------- No celular ----------
  const contextoDoTel = await comConta(bia, {
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const tel = observar(await contextoDoTel.newPage(), 'Bia no celular');
  await tel.goto(`${origem}/conta`);
  await tel.locator('#comConta').waitFor();
  await tel.locator('#contaAvatar').tap();
  await tel.locator('#fotoPanel:not([hidden])').waitFor();
  await tel.waitForTimeout(300);
  for (const largura of [390, 320]) {
    await tel.setViewportSize({ width: largura, height: 640 });
    await tel.waitForTimeout(150);
    const caixa = await tel.locator('.nx-foto-caixa').boundingBox();
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura && caixa.y >= 0 && caixa.y + caixa.height <= 640, `o visor cabe na tela de ${largura} px: ${JSON.stringify(caixa)}`);
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolar de lado em ${largura} px`);
  }
  await tel.screenshot({ path: path.join(saida, 'celular.png') });
  await tel.locator('.nx-foto-fechar').tap();
  await tel.locator('#fotoPanel').waitFor({ state: 'hidden' });
  console.log('PASS: no celular, o visor da foto cabe de 320 a 390 px e fecha pelo toque no X');

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
