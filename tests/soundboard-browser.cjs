// A mesa de sons toca no navegador de cada um, por Web Audio, e é aí que a regra de
// "um som por pessoa de cada vez" tem de valer. Nada disso aparece num teste de unidade:
// o que se mede aqui é quantas fontes de áudio ficam VIVAS ao mesmo tempo no ouvido de
// quem escuta, com dois navegadores de verdade e o servidor no meio.
//
// Sem a regra, cinco cliques num som de dez segundos deixavam cinco cópias sobrepostas --
// medido antes da correção: 5 fontes vivas e 2 540 ms de sons empilhados só na janela do
// teste. Não há botão de "parar", então a sala inteira ficava debaixo daquilo até acabar.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const path = require('node:path');
const assert = require('node:assert/strict');

const port = 3219;
const origin = `http://localhost:${port}`;
const SALA = 'sala-dos-sons';
const SEGUNDOS_DO_TOM = 10;
let server, browser, instancia;

// Um WAV sintetizado aqui mesmo, para o teste não depender de um arquivo no repositório
// nem do ffmpeg estar instalado. Dez segundos é longo o bastante para que cinco disparos
// seguidos se sobreponham se nada os cortar.
function tomDeTeste(segundos = SEGUNDOS_DO_TOM, taxa = 24000) {
  const amostras = segundos * taxa;
  const dados = Buffer.alloc(amostras * 2);
  for (let i = 0; i < amostras; i++) dados.writeInt16LE(Math.round(Math.sin((i / taxa) * 440 * 2 * Math.PI) * 8000), i * 2);
  const cabecalho = Buffer.alloc(44);
  cabecalho.write('RIFF', 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write('WAVEfmt ', 8);
  cabecalho.writeUInt32LE(16, 16);
  cabecalho.writeUInt16LE(1, 20);          // PCM
  cabecalho.writeUInt16LE(1, 22);          // mono
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28);
  cabecalho.writeUInt16LE(2, 32);
  cabecalho.writeUInt16LE(16, 34);
  cabecalho.write('data', 36);
  cabecalho.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cabecalho, dados]);
}

async function esperarServidor() {
  for (let n = 0; n < 120; n++) {
    if (server.exitCode !== null) throw new Error('o servidor de teste saiu antes de ficar pronto');
    try { if ((await fetch(origin)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('o servidor de teste não subiu');
}

// Conta quantas fontes de áudio estão tocando ao mesmo tempo. `stop()` também dispara
// "ended", então um som cortado aparece aqui saindo de cena.
//
// O que denuncia empilhamento é a sobreposição DURAR: um pico de dois por 40 ms é o
// próprio corte -- o som novo começa enquanto o antigo termina de desligar, e esse
// desligamento existe justamente para não estalar. Por isso se mede tempo, não pico.
function espiaoDeAudio() {
  const Contexto = window.AudioContext || window.webkitAudioContext;
  if (!Contexto) return;
  window.__ativos = 0;
  window.__iniciados = 0;
  window.__msComDois = 0;
  const original = Contexto.prototype.createBufferSource;
  Contexto.prototype.createBufferSource = function () {
    const fonte = original.call(this);
    const comecar = fonte.start.bind(fonte);
    fonte.start = (...argumentos) => {
      window.__ativos++;
      window.__iniciados++;
      return comecar(...argumentos);
    };
    fonte.addEventListener('ended', () => { window.__ativos--; });
    return fonte;
  };
  setInterval(() => { if (window.__ativos >= 2) window.__msComDois += 10; }, 10);
}

async function entrar(contexto, nome) {
  const page = await contexto.newPage();
  page.on('pageerror', erro => { throw new Error(`erro na página de ${nome}: ${erro.message}`); });
  await page.goto(`${origin}/${SALA}/sala`);
  // Com conta, o campo de nome é o apelido dela, só para leitura -- e isso só se sabe depois
  // de a conta carregar.
  await page.evaluate(() => window.NexoConta?.pronto);
  if (!(await page.locator('#nameInput').evaluate(el => el.readOnly))) await page.locator('#nameInput').fill(nome);
  await page.locator('#nameConfirmBtn').click();
  await page.waitForFunction(() => tiles.has('self'), null, { timeout: 60000 });
  // Abrir a mesa é o gesto que destrava o áudio -- como para qualquer pessoa.
  await page.locator('#soundboardBtn').click();
  return page;
}

const zerar = page => page.evaluate(() => { window.__iniciados = 0; window.__msComDois = 0; });
const medir = page => page.evaluate(() => ({
  iniciados: window.__iniciados, ativos: window.__ativos, msComDois: window.__msComDois
}));

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(port) } });
  server = instancia.filho;
  await esperarServidor();

  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  // Enviar som pede conta: a Ana tem uma, a Bia não. Contextos separados, porque o cookie da
  // conta é do navegador inteiro.
  const contextoDaAna = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const contextoDaBia = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const { cookie } = await instancia.conta('ana', { apelido: 'Ana' });
  await contextoDaAna.addCookies([{ name: 'nexo_conta', value: cookie.split('=')[1], url: origin }]);
  for (const contexto of [contextoDaAna, contextoDaBia]) await contexto.addInitScript(espiaoDeAudio);

  const ana = await entrar(contextoDaAna, 'Ana');
  const bia = await entrar(contextoDaBia, 'Bia');

  // Sem conta, o botão de enviar fica à vista e desligado, com a porta ao lado -- e o
  // servidor recusa do mesmo jeito se alguém mandar direto.
  assert.equal(await bia.locator('#sonsEnviarBtn').isDisabled(), true);
  assert.equal(await bia.locator('#sonsSemConta').isVisible(), true);
  const semConta = await bia.evaluate(async sala => (await fetch(`/api/soundboard/${sala}?nome=tom`, {
    method: 'POST', headers: { 'content-type': 'audio/wav', ...window.NexoSessao.cabecalhos() }, body: new Uint8Array(64)
  })).status, SALA);
  assert.equal(semConta, 403, 'enviar som sem conta deveria ser recusado no servidor');

  // Sobe um som pela mesma rota que o botão de enviar usa.
  const envio = await ana.evaluate(async ([bytes, sala, segundos]) => {
    const resposta = await fetch(`/api/soundboard/${sala}?nome=tom&segundos=${segundos}`, {
      method: 'POST', headers: { 'content-type': 'audio/wav', ...window.NexoSessao.cabecalhos() }, body: new Uint8Array(bytes)
    });
    return resposta.json();
  }, [[...tomDeTeste()], SALA, SEGUNDOS_DO_TOM]);
  assert.ok(envio?.som?.id, `o som de teste não subiu: ${JSON.stringify(envio)}`);
  for (const page of [ana, bia]) {
    await page.waitForFunction(() => document.querySelectorAll('.som-btn').length === 1, null, { timeout: 30000 });
  }

  // ---------- A mesma pessoa disparando cinco vezes ----------
  // Pelo socket, e não pelo botão: o botão do próprio som vira "Parar" enquanto ele toca (abaixo).
  // A regra de um som por pessoa vale em quem OUVE, venha o disparo de onde vier -- de um atalho,
  // de outro som da mesa, ou de um cliente modificado.
  await Promise.all([zerar(ana), zerar(bia)]);
  for (let n = 0; n < 5; n++) {
    await ana.evaluate(id => socket.emit('soundboard-tocar', { id }), envio.som.id);
    await ana.waitForTimeout(500);   // acima do limite de 400 ms por pessoa do servidor
  }
  await ana.waitForTimeout(400);
  const daAna = await medir(ana);
  const naBia = await medir(bia);
  console.log(`5 cliques da Ana -> Ana ${JSON.stringify(daAna)} | Bia ${JSON.stringify(naBia)}`);
  assert.equal(naBia.iniciados, 5, 'os cinco disparos precisam chegar em quem ouve');
  for (const [quem, medida] of [['Ana', daAna], ['Bia', naBia]]) {
    // Quatro trocas de ~40 ms somam uns 160 ms. Sem a regra eram 2 540 ms, e subindo.
    assert.ok(medida.msComDois <= 400, `${quem} ouviu ${medida.msComDois} ms de sons empilhados; só os cortes eram esperados`);
    assert.equal(medida.ativos, 1, `${quem} deveria estar ouvindo um único som da Ana`);
  }
  console.log('PASS: a mesma pessoa não empilha -- vale sempre o último toque');

  // ---------- Parar o próprio som no meio ----------
  // O som da Ana ainda tem uns oito segundos pela frente. O botão dele, na tela dela, é "Parar";
  // na da Bia continua sendo tocar -- o som é da Ana.
  const botaoDaAna = ana.locator('.som-btn');
  await ana.waitForFunction(() => document.querySelector('.som-btn')?.classList.contains('meu-tocando'), null, { timeout: 5000 });
  assert.equal(await botaoDaAna.getAttribute('aria-label'), 'Parar tom para todo mundo');
  assert.match(await botaoDaAna.locator('small').textContent(), /Parar/);
  assert.equal(await bia.locator('.som-btn.meu-tocando').count(), 0, 'na tela da Bia o som da Ana não vira "Parar"');
  await ana.locator('#soundboardPanel .modal-card').screenshot({ path: path.join(__dirname, '..', 'test-results', 'mesa-parar.png') });
  await botaoDaAna.click();
  await ana.waitForTimeout(400);
  for (const [quem, page] of [['Ana', ana], ['Bia', bia]]) {
    assert.equal((await medir(page)).ativos, 0, `${quem} ainda ouvia o som que a Ana parou`);
  }
  await ana.waitForFunction(() => !document.querySelector('.som-btn.meu-tocando'), null, { timeout: 3000 });
  assert.equal(await botaoDaAna.getAttribute('aria-label'), null, 'parado, o botão volta a ser o de tocar');
  assert.match(await botaoDaAna.locator('small').textContent(), /por Ana/);
  console.log('PASS: o botão do meu som vira "Parar", e parar corta o som para todo mundo');

  // ---------- Duas pessoas ao mesmo tempo ----------
  await Promise.all([zerar(ana), zerar(bia)]);
  await Promise.all([ana.locator('.som-btn').click(), bia.locator('.som-btn').click()]);
  await ana.waitForTimeout(600);
  const juntas = await medir(bia);
  console.log(`Ana e Bia juntas -> ${JSON.stringify(juntas)}`);
  // Aqui a sobreposição TEM de durar: são duas pessoas, e isso é a mesa funcionando.
  assert.equal(juntas.ativos, 2, 'pessoas diferentes continuam podendo tocar ao mesmo tempo');
  assert.ok(juntas.msComDois > 400, `os dois sons deveriam correr juntos, e correram só ${juntas.msComDois} ms`);
  console.log('PASS: duas pessoas, dois sons ao mesmo tempo');

  // ---------- Cortar troca o som, não emudece a mesa ----------
  await ana.waitForTimeout(1200);
  assert.equal((await medir(bia)).ativos, 2, 'depois do corte os dois sons continuam tocando');
  console.log('PASS: cortar troca o som em vez de deixar um buraco');

  // ---------- Parar só para o som de quem pediu ----------
  // As duas tocam o MESMO som. A Bia para o dela, e o da Ana continua: quem para é a conexão, e
  // não o som -- e ninguém para o som dos outros, nem pedindo direto pelo socket.
  await bia.locator('.som-btn').click();
  await bia.waitForTimeout(400);
  assert.equal((await medir(ana)).ativos, 1, 'o som da Ana tinha de continuar quando a Bia parou o dela');
  assert.equal((await medir(bia)).ativos, 1);
  await bia.evaluate(id => socket.emit('soundboard-parar', { id }), envio.som.id);
  await bia.waitForTimeout(400);
  assert.equal((await medir(ana)).ativos, 1, 'um "parar" de quem não está tocando não corta o som de outra pessoa');
  await ana.evaluate(() => NexoSoundboard.pararMeuSom());
  await ana.waitForTimeout(400);
  assert.equal((await medir(bia)).ativos, 0);
  console.log('PASS: parar corta só o som de quem pediu, nunca o dos outros');

  // ---------- Apagar um som pede conta, ou moderar a sala ----------
  // A Ana tem conta e abriu a sala; a Bia não tem conta e só participa. Antes qualquer pessoa
  // apagava qualquer som, e uma só limpava a mesa inteira em um minuto.
  assert.equal(await bia.locator('.som-apagar').count(), 0, 'quem não tem conta nem modera não deveria ver o ✕');
  assert.equal(await ana.locator('.som-apagar').count(), 1, 'quem tem conta deveria ver o ✕');
  // O ✕ escondido é conveniência. Quem decide é o servidor, e um cliente modificado chega lá
  // do mesmo jeito -- então o pedido direto da Bia tem de ser recusado.
  const recusa = await bia.evaluate(id => new Promise(resolve => socket.emit('soundboard-remover', { id }, resolve)), envio.som.id);
  assert.equal(recusa?.ok, false, `o servidor aceitou apagar um som a pedido de quem não modera: ${JSON.stringify(recusa)}`);
  await bia.waitForTimeout(300);
  assert.equal(await bia.locator('.som-btn').count(), 1, 'o som tem de continuar na mesa depois da recusa');
  await ana.locator('.som-apagar').click();
  for (const page of [ana, bia]) {
    await page.waitForFunction(() => document.querySelectorAll('.som-btn').length === 0, null, { timeout: 10000 });
  }
  console.log('PASS: enviar e apagar sons pedem conta, e o pedido direto de quem não tem é recusado');

  await browser.close();
  await instancia.encerrar();
  console.log('Mesa de sons: tudo certo.');
  process.exit(0);
})().catch(async erro => {
  console.error(erro);
  try { await browser?.close(); } catch (_) { /* ja fechou */ }
  await instancia?.encerrar();
  process.exit(1);
});
