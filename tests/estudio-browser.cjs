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
  await bia.locator('#estudioAdicionarCampo').fill('Carla');
  await bia.locator('#estudioAdicionar button[type="submit"]').click();
  await bia.locator('.estudio-pessoa[data-chave="n:carla"]').waitFor({ state: 'visible' });
  // O tamanho dos nomes chega à prévia.
  const deslizar = valor => bia.evaluate(v => { const faixa = document.getElementById('estudioTamanhoDoNome'); faixa.value = String(v); faixa.dispatchEvent(new Event('input', { bubbles: true })); }, valor);
  await deslizar(200);
  await bia.waitForFunction(() => document.getElementById('estudioPrevia').style.getPropertyValue('--nome-escala') === '2');
  assert.equal(await bia.locator('#estudioTamanhoDoNome ~ output').textContent(), '200%');
  await deslizar(100);
  await bia.waitForFunction(() => document.getElementById('estudioSalvo').classList.contains('certo'), null, { timeout: 5000 });
  await bia.screenshot({ path: path.join(saida, 'estudio.png') });

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
  console.log('PASS: Estúdio -- foto, link da câmera, página do OBS, aviso na sala, rostos, painel, permissão e o controle da sala');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros?.().slice(-2000));
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
