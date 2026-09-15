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
  await page.locator('#nameInput').fill(nome);
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
  const contexto = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await contexto.addInitScript(espiaoDeAudio);

  const ana = await entrar(contexto, 'Ana');
  const bia = await entrar(contexto, 'Bia');

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

  // ---------- A mesma pessoa apertando cinco vezes ----------
  await Promise.all([zerar(ana), zerar(bia)]);
  for (let n = 0; n < 5; n++) {
    await ana.locator('.som-btn').click();
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
