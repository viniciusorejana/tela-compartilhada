// O Estúdio de ponta a ponta, com servidor de mídia: a foto de perfil, o link da câmera copiado
// do cartão de perfil, a página do OBS recebendo a imagem, o aviso na sala, os rostos que
// reagem à voz e a permissão desligada no meio. A câmera e o microfone são os falsos do Chromium
// (o microfone apita, e é o apito que faz o rosto "falar").
//
//   npm run test:estudio
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');

const SALA = 'squad-estudio';
const saida = path.join(__dirname, '..', 'test-results', 'estudio');
fs.mkdirSync(saida, { recursive: true });
let instancia, navegador;
const erros = [];

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  await pagina.goto(`${instancia.origem}/${SALA}/sala`);
  await pagina.evaluate(() => window.NexoConta?.pronto);
  if (!(await pagina.locator('#nameInput').evaluate(el => el.readOnly))) await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

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
    return { ok: r.ok, tipo: blob.type, avatar: r.dados.perfil?.avatar };
  });
}

(async () => {
  instancia = await iniciarServidor({ midia: true });
  navegador = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const origem = instancia.origem;
  const { cookie: cookieAna } = await instancia.conta('ana', { apelido: 'Ana' });
  const { cookie: cookieBia } = await instancia.conta('bia', { apelido: 'Bia' });
  const contextoAna = await navegador.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await contextoAna.addCookies([{ name: 'nexo_conta', value: cookieAna.split('=')[1], url: origem }]);
  const contextoBia = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
  await contextoBia.addCookies([{ name: 'nexo_conta', value: cookieBia.split('=')[1], url: origem }]);
  // O OBS é um navegador sem cookie nenhum: só o link.
  const contextoObs = await navegador.newContext({ viewport: { width: 1280, height: 720 } });

  const ana = await entrar(contextoAna, 'Ana');
  const bia = await entrar(contextoBia, 'Bia');
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });

  // ---------- A foto de perfil ----------
  const foto = await enviarFoto(bia);
  assert.ok(foto.ok, 'a foto sobe');
  assert.match(foto.tipo, /^image\/(webp|png)$/, 'recortada e reduzida pela página');
  await ana.waitForFunction(id => [...document.querySelectorAll('.member-avatar')].some(el => el.style.backgroundImage.includes(id)), foto.avatar, { timeout: 10000 });

  // ---------- O perfil pela plateia e pelo chat ----------
  // O nome embaixo do quadradinho abre o perfil; o quadradinho de quem não tem câmera nem tela
  // também (não há o que pôr no palco). No chat, o autor da mensagem.
  const idDaBiaNaSala = await ana.evaluate(() => [...peers.values()].find(p => p.name === 'Bia').id);
  const perfilAbertoDe = async nome => {
    await ana.locator('#perfilPanel').waitFor({ state: 'visible' });
    assert.equal(await ana.locator('#perfilNome').textContent(), nome);
    await ana.locator('#perfilPanel [data-close="perfilPanel"]').click();
    await ana.locator('#perfilPanel').waitFor({ state: 'hidden' });
  };
  await ana.locator(`.participant[data-id="${idDaBiaNaSala}"] .participant-name`).click();
  await perfilAbertoDe('Bia');
  await ana.locator(`.participant[data-id="${idDaBiaNaSala}"] .avatar-wrap`).click();
  await perfilAbertoDe('Bia');
  await bia.locator('#chatInput').fill('oi, Ana');
  await bia.locator('#chatSend').click();
  const autorNoChat = ana.locator('#chatMsgs .msg', { hasText: 'oi, Ana' }).locator('.msg-autor');
  await autorNoChat.waitFor({ state: 'visible', timeout: 10000 });
  await autorNoChat.click();
  await perfilAbertoDe('Bia');
  // Quem já saiu abre o cartão com o que a mensagem sabe, sem o que só vale na sala.
  await ana.evaluate(() => abrirPerfilDoAutor({ id: 'antiga', autorId: 'ze#0000', autor: 'Zé' }));
  assert.match(await ana.locator('#perfilDica').textContent(), /^Não está mais na sala\./);
  assert.equal(await ana.locator('#perfilObs').isVisible(), false, 'sem levar para o OBS quem não está aqui');
  assert.equal(await ana.locator('#perfilModerar').isVisible(), false);
  await perfilAbertoDe('Zé');

  // ---------- A câmera da Bia, pelo cartão de perfil ----------
  await bia.locator('#cameraBtn').click();
  await bia.locator('#micBtn').click();
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia' && p.state.camera && !p.state.micMuted), null, { timeout: 20000 });
  const idDaBia = await ana.evaluate(() => [...peers.values()].find(p => p.name === 'Bia').id);
  await ana.locator(`.member[data-member-id="${idDaBia}"]`).click();
  await ana.locator('#perfilObs').waitFor({ state: 'visible' });
  const botaoCamera = ana.locator('[data-fonte-obs="camera"]');
  await ana.waitForFunction(() => !document.querySelector('[data-fonte-obs="camera"]').disabled, null, { timeout: 10000 });
  await botaoCamera.click();
  const linkDaCamera = await ana.evaluate(() => navigator.clipboard.readText());
  assert.match(linkDaCamera, /\/obs\/[\w-]+\.[\w-]+$/, 'o clique copia o link da câmera');
  await ana.screenshot({ path: path.join(saida, 'cartao-com-links.png') });

  // ---------- A foto grande ----------
  // O avatar do cartão abre o visor; fechar volta ao cartão. A foto de teste tem 400 px de lado
  // útil, e sobe assim: até 512, sem ampliar o que é menor.
  assert.equal(await ana.locator('#perfilAvatar').getAttribute('role'), 'button', 'com foto, o avatar do cartão se abre');
  await ana.locator('#perfilAvatar').click();
  await ana.locator('#fotoPanel').waitFor({ state: 'visible' });
  assert.match(await ana.locator('#fotoGrande').getAttribute('src'), new RegExp(foto.avatar));
  await ana.waitForFunction(() => document.getElementById('fotoGrande').naturalWidth > 0, null, { timeout: 10000 });
  assert.equal(await ana.locator('#fotoGrande').evaluate(el => el.naturalWidth), 400, 'a foto sobe no tamanho dela até 512 px');
  assert.equal(await ana.locator('#fotoNome').textContent(), 'Bia');
  const larguraDaFoto = await ana.locator('#fotoGrande').evaluate(el => el.getBoundingClientRect().width);
  assert.ok(larguraDaFoto >= 400, `a foto aparece grande (${larguraDaFoto}px)`);
  await ana.screenshot({ path: path.join(saida, 'foto-grande.png') });
  await ana.keyboard.press('Escape');
  await ana.locator('#fotoPanel').waitFor({ state: 'hidden' });
  assert.equal(await ana.locator('#perfilPanel').isVisible(), true, 'o Esc fecha a foto e volta ao cartão');
  await ana.locator('#perfilPanel [data-close="perfilPanel"]').click();
  // Sem foto não há o que ampliar.
  await ana.evaluate(() => abrirPerfil('self'));
  assert.equal(await ana.locator('#perfilAvatar').getAttribute('role'), null, 'sem foto, o avatar é só um desenho');
  await ana.locator('#perfilAvatar').click();
  assert.equal(await ana.locator('#fotoPanel').isVisible(), false);
  await ana.locator('#perfilPanel [data-close="perfilPanel"]').click();

  // ---------- A página do OBS recebe a imagem ----------
  const obsCamera = await contextoObs.newPage();
  obsCamera.on('pageerror', e => erros.push(`obs: ${e.message}`));
  await obsCamera.goto(linkDaCamera);
  await obsCamera.waitForFunction(() => { const v = document.getElementById('video'); return !v.hidden && v.videoWidth > 0; }, null, { timeout: 30000 });
  const estado = await obsCamera.evaluate(() => ({ tipo: NexoObs.estado.tipo, fonte: NexoObs.estado.fonte, nome: NexoObs.estado.alvo.nome, avisos: !document.getElementById('aviso').hidden }));
  assert.deepEqual(estado, { tipo: 'ok', fonte: 'camera', nome: 'Bia', avisos: false });
  // A voz vem junto com a câmera, e ninguém na sala vê a página do OBS como gente.
  await obsCamera.waitForFunction(() => document.getElementById('audio').srcObject?.getAudioTracks().length === 1, null, { timeout: 15000 });
  assert.equal(await bia.evaluate(() => peers.size), 1, 'a página do OBS entra oculta');

  // ---------- A sala fica sabendo ----------
  await bia.waitForFunction(() => document.querySelector('.participant[data-id="self"] .obs-selo'), null, { timeout: 10000 });
  assert.match(await bia.locator('.participant[data-id="self"] .obs-selo').getAttribute('title'), /^Ana leva a sua câmera para o OBS$/);
  assert.equal(await bia.locator('#obsNaSala').isVisible(), true);
  await ana.waitForFunction(() => !document.getElementById('obsNaSala').hidden);
  await bia.screenshot({ path: path.join(saida, 'sala-com-selo.png') });

  // ---------- Os rostos que reagem ----------
  const retrato = await ana.evaluate(() => fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json()));
  const obsRostos = await contextoObs.newPage();
  obsRostos.on('pageerror', e => erros.push(`rostos: ${e.message}`));
  await obsRostos.goto(new URL(retrato.links.grupo, origem).href);
  await obsRostos.waitForFunction(() => document.querySelectorAll('#rostos .rosto').length === 2, null, { timeout: 20000 });
  // A foto da Bia é o rosto dela; a Ana, sem foto, aparece com a cor e as iniciais.
  const rostoDaBia = obsRostos.locator('#rostos .rosto', { hasText: 'Bia' });
  assert.match(await rostoDaBia.locator('.rosto-gerado').evaluate(el => el.style.backgroundImage), new RegExp(foto.avatar));
  // O microfone falso apita: o rosto da Bia fala.
  await obsRostos.waitForFunction(() => [...document.querySelectorAll('#rostos .rosto')].some(r => r.textContent.includes('Bia') && r.classList.contains('falando')), null, { timeout: 20000 });
  await obsRostos.screenshot({ path: path.join(saida, 'rostos-no-obs.png') });

  // A configuração muda no Estúdio e chega à fonte sem recarregar.
  await ana.evaluate(async () => {
    const atual = await fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json());
    await fetch('/api/conta/estudio', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': NexoConta.atual().csrf }, body: JSON.stringify({ config: { ...atual.config, estilo: { ...atual.config.estilo, efeito: 'pulso', tamanho: 220 } } }) });
  });
  await obsRostos.waitForFunction(() => document.getElementById('rostos').dataset.efeito === 'pulso' && document.getElementById('rostos').style.getPropertyValue('--tamanho') === '220px', null, { timeout: 10000 });

  // ---------- Ensurdecida: na sala e no OBS ----------
  // A Ana dá à Bia uma imagem de ensurdecida, e a Bia ensurdece. A sala vê o fone cortado no lugar
  // do microfone (quadradinho e lista), e o rosto da Bia no OBS troca pela imagem escolhida.
  const chaveDaBia = retrato.sala.pessoas.find(p => p.nome === 'Bia').chave;
  const imagemDeSurda = await ana.evaluate(async chave => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3a6df0'; ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const enviada = await NexoImagem.enviar('/api/conta/estudio/imagens', blob, { metodo: 'POST', csrf: NexoConta.atual().csrf });
    const atual = await fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json());
    const pessoas = { ...atual.config.pessoas, [chave]: { rotulo: 'Bia', parado: null, falando: null, mudo: null, ensurdecido: enviada.dados.imagem.id, oculto: false } };
    await fetch('/api/conta/estudio', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': NexoConta.atual().csrf }, body: JSON.stringify({ config: { ...atual.config, pessoas } }) });
    return enviada.dados.imagem.id;
  }, chaveDaBia);
  await obsRostos.waitForFunction(id => document.querySelector(`#rostos .rosto-ensurdecido[src*="${id}"]`), imagemDeSurda, { timeout: 10000 });
  assert.equal(await rostoDaBia.getAttribute('data-imagem'), null, 'a imagem de ensurdecida só aparece quando ela ensurdece');
  // Com a câmera no palco, o quadradinho dela sai da plateia: sem câmera, ele volta, e é nele que
  // o fone cortado aparece.
  await bia.locator('#cameraBtn').click();
  await ana.waitForFunction(id => { const el = document.querySelector(`.participant[data-id="${id}"]`); return el && !el.hidden && !peers.get(id).state.camera; }, idDaBia, { timeout: 15000 });
  await bia.locator('#deafenBtn').click();
  const iconeDaBia = ana.locator(`.participant[data-id="${idDaBia}"] .mic-icon`);
  await ana.waitForFunction(id => document.querySelector(`.participant[data-id="${id}"] .mic-icon`)?.classList.contains('ensurdecido'), idDaBia, { timeout: 10000 });
  assert.equal(await iconeDaBia.getAttribute('title'), 'Ensurdecido: não está ouvindo a sala');
  await ana.waitForFunction(id => document.querySelector(`.member[data-member-id="${id}"] .member-mudo.ensurdecido`), idDaBia, { timeout: 5000 });
  assert.equal(await bia.locator('.participant[data-id="self"] .mic-icon').evaluate(el => el.classList.contains('ensurdecido')), true, 'o próprio quadradinho também mostra');
  await obsRostos.waitForFunction(() => [...document.querySelectorAll('#rostos .rosto')].some(r => r.textContent.includes('Bia') && r.dataset.imagem === 'ensurdecido' && r.classList.contains('ensurdecido')), null, { timeout: 10000 });
  await obsRostos.waitForTimeout(250);   // a troca de imagem é uma transição curta de opacidade
  const opacidade = await rostoDaBia.evaluate(el => ({ surda: getComputedStyle(el.querySelector('.rosto-ensurdecido')).opacity, foto: getComputedStyle(el.querySelector('.rosto-gerado')).opacity }));
  assert.deepEqual(opacidade, { surda: '1', foto: '0' }, 'a imagem de ensurdecida cobre a foto');
  await ana.locator('.participants').screenshot({ path: path.join(saida, 'plateia-ensurdecida.png') });
  await obsRostos.screenshot({ path: path.join(saida, 'rostos-ensurdecida.png') });
  // Quem chega depois já vê: o estado vem na entrada, e não só no próximo aviso.
  const carla = await entrar(await navegador.newContext({ viewport: { width: 1280, height: 800 } }), 'Carla');
  await carla.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia' && p.state.ensurdecido), null, { timeout: 20000 });
  await carla.waitForFunction(() => [...document.querySelectorAll('.participant')].some(el => el.textContent.includes('Bia') && el.querySelector('.mic-icon.ensurdecido')), null, { timeout: 10000 });
  // Sai pelo botão, e não fechando a aba: quem só some fica esperando a volta por um tempo, e o
  // Estúdio, adiante, conta as pessoas da sala.
  // Sem esperar a promessa: ela termina levando a página para a inicial. A aba fica lá (fechá-la
  // no meio dessa navegação deixava o `close` do Playwright esperando para sempre).
  await carla.evaluate(() => { sairDaSala(); });
  await ana.waitForFunction(() => ![...peers.values()].some(p => p.name === 'Carla'), null, { timeout: 15000 });
  await carla.waitForURL(url => url.pathname === '/', { timeout: 15000 });
  // Ela volta a ouvir: tudo volta, e o microfone reabre como estava.
  await bia.locator('#deafenBtn').click();
  await ana.waitForFunction(id => !document.querySelector(`.participant[data-id="${id}"] .mic-icon`).classList.contains('ensurdecido'), idDaBia, { timeout: 10000 });
  await obsRostos.waitForFunction(() => [...document.querySelectorAll('#rostos .rosto')].some(r => r.textContent.includes('Bia') && !r.dataset.imagem && !r.classList.contains('ensurdecido')), null, { timeout: 10000 });
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia' && !p.state.micMuted), null, { timeout: 10000 });
  await bia.locator('#cameraBtn').click();
  await obsCamera.waitForFunction(() => { const v = document.getElementById('video'); return !v.hidden && v.videoWidth > 0; }, null, { timeout: 30000 });

  // ---------- A Bia desliga ----------
  await bia.locator('.config-engrenagem').click();
  await bia.locator('#abaEstudio').click();
  await bia.locator('#estudioCapturasLista li').first().waitFor({ state: 'visible' });
  assert.ok((await bia.locator('#estudioCapturasLista li').allTextContents()).includes('Ana leva a sua câmera para o OBS'));
  assert.equal(await bia.locator('#abaEstudio').getAttribute('aria-selected'), 'true');
  assert.equal(await bia.locator('#abaAparelhos').getAttribute('aria-selected'), 'false');
  assert.equal(await bia.locator('#painelEstudio').isVisible(), true);
  await bia.locator('label[for="estudioPermitir"]').click();
  await obsCamera.waitForFunction(() => NexoObs.estado?.tipo === 'recusado' && document.getElementById('video').hidden, null, { timeout: 10000 });
  await obsRostos.waitForFunction(() => document.querySelectorAll('#rostos .rosto').length === 1, null, { timeout: 10000 });
  await bia.waitForFunction(() => !document.querySelector('.participant[data-id="self"] .obs-selo'), null, { timeout: 10000 });
  // A escolha segue a conta dela.
  const ajustes = await bia.evaluate(() => Preferencias.ajustesSincronizaveis());
  assert.deepEqual(ajustes.estudio, { permitir: false });

  // Ela volta a deixar: a câmera volta sozinha, sem ninguém mexer no OBS.
  await bia.locator('label[for="estudioPermitir"]').click();
  await obsCamera.waitForFunction(() => { const v = document.getElementById('video'); return NexoObs.estado?.tipo === 'ok' && !v.hidden && v.videoWidth > 0; }, null, { timeout: 30000 });
  await bia.locator('#devicesPanel .modal-actions [data-close], #devicesPanel .modal-fechar').first().click();

  // ---------- O painel do Estúdio, pela barra de baixo ----------
  assert.equal(await bia.locator('#estudioBtn').isVisible(), true, 'com conta, no computador, o botão está na barra');
  await bia.locator('#estudioBtn').click();
  await bia.locator('#estudioPanel').waitFor({ state: 'visible' });
  await bia.waitForFunction(() => document.querySelectorAll('#estudioPrevia .rosto').length === 2 && document.querySelectorAll('#estudioLista .estudio-pessoa').length === 2, null, { timeout: 10000 });
  // O ponto "no ar" de cada link vem da sala, ao vivo: a câmera e a voz da Bia estão saindo, e a
  // Ana não ligou nada. Fechar o microfone apaga o ponto da voz em um segundo, sem recarregar.
  const noAr = () => bia.evaluate(() => {
    const itens = [...document.querySelectorAll('#estudioLista .estudio-pessoa[data-identidade]')];
    const fontes = el => [...el.querySelectorAll('.estudio-link.no-ar')].map(c => c.dataset.fonte).sort().join(',');
    return { minha: fontes(itens.find(el => el.dataset.identidade === myId)), daAna: fontes(itens.find(el => el.dataset.identidade !== myId)) };
  });
  await bia.waitForFunction(() => document.querySelectorAll('#estudioLista .estudio-link.no-ar').length > 0, null, { timeout: 5000 });
  assert.deepEqual(await noAr(), { minha: 'camera,voz', daAna: '' });
  assert.match(await bia.locator(`.estudio-pessoa[data-identidade] .estudio-link.no-ar[data-fonte="camera"]`).getAttribute('title'), /no ar agora$/);
  // Pelo atalho: com o painel aberto, a sala por trás fica inerte ao mouse.
  await bia.keyboard.press('Control+Shift+M');
  await bia.waitForFunction(() => !document.querySelector('#estudioLista .estudio-link.no-ar[data-fonte="voz"]'), null, { timeout: 5000 });
  assert.deepEqual(await noAr(), { minha: 'camera', daAna: '' }, 'microfone fechado, a voz sai do ar');
  await bia.keyboard.press('Control+Shift+M');
  await bia.waitForFunction(() => document.querySelector('#estudioLista .estudio-link.no-ar[data-fonte="voz"]'), null, { timeout: 5000 });
  await bia.locator('#estudioAdicionarCampo').fill('Carla');
  await bia.locator('#estudioAdicionar button[type="submit"]').click();
  await bia.locator('.estudio-pessoa[data-chave="n:carla"]').waitFor({ state: 'visible' });
  // O tamanho dos nomes chega à prévia.
  const deslizar = valor => bia.evaluate(v => { const faixa = document.getElementById('estudioTamanhoDoNome'); faixa.value = String(v); faixa.dispatchEvent(new Event('input', { bubbles: true })); }, valor);
  await deslizar(200);
  await bia.waitForFunction(() => document.getElementById('estudioPrevia').style.getPropertyValue('--nome-escala') === '2');
  assert.equal(await bia.locator('#estudioTamanhoDoNome ~ output').textContent(), '200%');
  await deslizar(100);
  // O número de cada régua se digita (valor-digitado.js), e o valor exato vale -- as réguas têm
  // passo 1 por isso. O Enter é só "aplicar": enviado, o formulário recarregaria a sala.
  await bia.evaluate(() => { window.semRecarregar = true; });
  const saidaDoTamanho = bia.locator('#estudioTamanho ~ output');
  await saidaDoTamanho.click();
  const campoDoEstudio = bia.locator('#estudioEstilo input.valor-digitado');
  await campoDoEstudio.fill('137');
  await bia.locator('.estudio-faixas').screenshot({ path: path.join(saida, 'estudio-digitando.png') });
  await campoDoEstudio.press('Enter');
  assert.equal(await bia.locator('#estudioTamanho').inputValue(), '137');
  assert.equal(await saidaDoTamanho.textContent(), '137 px');
  assert.equal(await bia.evaluate(() => document.getElementById('estudioPrevia').style.getPropertyValue('--tamanho')), '137px', 'a prévia muda na hora');
  assert.equal(await bia.evaluate(() => window.semRecarregar), true, 'o Enter não enviou o formulário');
  await bia.waitForFunction(() => document.getElementById('estudioSalvo').classList.contains('certo'), null, { timeout: 5000 });
  const salvo = await bia.evaluate(() => fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json()).then(r => r.config.estilo.tamanho));
  assert.equal(salvo, 137, 'e o valor digitado é o que fica salvo');
  // Esc desiste do número e deixa o painel aberto.
  await saidaDoTamanho.click();
  await campoDoEstudio.fill('300');
  await campoDoEstudio.press('Escape');
  assert.equal(await bia.locator('#estudioPanel').isVisible(), true, 'o Esc do campo não fecha o Estúdio');
  assert.equal(await bia.locator('#estudioTamanho').inputValue(), '137');
  await bia.screenshot({ path: path.join(saida, 'estudio.png') });

  // ---------- O rosto que a Bia escolhe para si ----------
  // Na linha dela, os lugares são o rosto do perfil dela, que todo Estúdio vê.
  const PNG_PEQUENO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const minhaLinha = bia.locator('.estudio-pessoa', { has: bia.locator('.estudio-selo', { hasText: 'você' }) });
  const [seletor] = await Promise.all([bia.waitForEvent('filechooser'), minhaLinha.locator('[data-estado="parado"] .estudio-imagem').click()]);
  await seletor.setFiles({ name: 'rosto.png', mimeType: 'image/png', buffer: PNG_PEQUENO });
  await bia.waitForFunction(() => NexoConta.atual().perfil?.rosto?.parado, null, { timeout: 10000 });
  const paradoDaBia = await bia.evaluate(() => NexoConta.atual().perfil.rosto.parado);
  assert.match(await bia.locator('#estudioAviso').textContent(), /do seu rosto guardada/);
  await bia.waitForFunction(id => [...document.querySelectorAll('#estudioLista .estudio-pessoa')]
    .find(el => [...el.querySelectorAll('.estudio-selo')].some(selo => selo.textContent === 'você'))
    ?.querySelector(`[data-estado="parado"] .estudio-imagem[style*="${id}"]`), paradoDaBia, { timeout: 10000 });
  assert.equal(await bia.locator(`#estudioMeuRostoImagens [data-estado="parado"] .estudio-imagem[style*="${paradoDaBia}"]`).count(), 1, 'as configurações mostram o mesmo rosto');

  // A Ana, no Estúdio dela, vê o rosto da Bia e escolhe: o OBS acompanha. Ela já tinha anexado
  // uma imagem de ensurdecida para a Bia, então até escolher valem as dela ("Minhas").
  await ana.evaluate(() => NexoEstudio.abrir());
  const linhaDaBia = ana.locator(`.estudio-pessoa[data-chave="${chaveDaBia}"]`);
  await linhaDaBia.locator('.estudio-origem').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await linhaDaBia.locator('.estudio-origem input:checked').getAttribute('value'), 'minhas');
  await linhaDaBia.locator('.estudio-origem label', { hasText: 'Da pessoa' }).click();
  await obsRostos.waitForFunction(id => [...document.querySelectorAll('#rostos .rosto')].some(r => r.textContent.includes('Bia') && r.querySelector(`.rosto-parado[src*="${id}"]`)), paradoDaBia, { timeout: 10000 });
  assert.equal(await linhaDaBia.locator('[data-estado="parado"] .estudio-imagem').isDisabled(), true, 'o rosto da Bia se vê e se usa, não se muda');
  await ana.locator('.estudio-pessoas').screenshot({ path: path.join(saida, 'estudio-rosto-da-pessoa.png') });
  await linhaDaBia.locator('.estudio-origem label', { hasText: 'Nenhuma' }).click();
  await obsRostos.waitForFunction(() => [...document.querySelectorAll('#rostos .rosto')].some(r => r.textContent.includes('Bia') && !r.querySelector('.rosto-img') && r.querySelector('.rosto-gerado')), null, { timeout: 10000 });
  await ana.waitForFunction(() => document.getElementById('estudioSalvo').classList.contains('certo'), null, { timeout: 5000 });
  assert.equal(await ana.evaluate(chave => fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json()).then(r => r.config.pessoas[chave].usar), chaveDaBia), 'nenhuma', 'a escolha fica guardada na conta da Ana');
  await ana.keyboard.press('Escape');
  await ana.locator('#estudioPanel').waitFor({ state: 'hidden' });

  // ---------- Quem abriu a sala desliga o OBS nela ----------
  // A Bia cria os rostos da sala; a Ana, que abriu a sala, desliga o OBS para os participantes.
  const doGrupo = await bia.evaluate(() => fetch('/api/conta/estudio', { credentials: 'same-origin' }).then(r => r.json()).then(r => r.links.grupo));
  const obsDaBia = await contextoObs.newPage();
  obsDaBia.on('pageerror', e => erros.push(`obs da bia: ${e.message}`));
  await obsDaBia.goto(new URL(doGrupo, origem).href);
  await obsDaBia.waitForFunction(() => NexoObs.estado?.tipo === 'ok', null, { timeout: 20000 });
  await ana.locator('#moderarSalaBtn').click();
  await ana.locator('label[for="allowObs"]').click();
  await obsDaBia.waitForFunction(() => NexoObs.estado?.tipo === 'recusado' && NexoObs.estado.motivo === 'sala', null, { timeout: 10000 });
  await bia.waitForFunction(() => !document.getElementById('estudioBloqueio').hidden, null, { timeout: 15000 });
  assert.equal(await obsCamera.evaluate(() => NexoObs.estado?.tipo), 'ok', 'o dono continua podendo');
  await ana.locator('label[for="allowObs"]').click();
  await obsDaBia.waitForFunction(() => NexoObs.estado?.tipo === 'ok', null, { timeout: 10000 });
  await ana.locator('#moderarPanel [data-close]').click();

  // ---------- O diretor sai ----------
  await ana.close();
  await obsCamera.waitForFunction(() => NexoObs.estado?.tipo === 'aguardando' && NexoObs.estado.motivo === 'diretor', null, { timeout: 20000 });

  assert.deepEqual(erros, [], 'nenhum erro de página');
  console.log('PASS: Estúdio -- perfil pela plateia e pelo chat, rosto próprio e a escolha de origem, foto e foto grande, link da câmera, página do OBS, aviso na sala, rostos, ensurdecida na sala e no OBS, painel (com o "no ar" ao vivo), permissão e o controle da sala');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros?.().slice(-2000));
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
