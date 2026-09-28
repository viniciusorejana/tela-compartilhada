// A tela por WebCodecs sobre faixas de dados, com servidor de mídia de verdade.
//
// O Chromium do Playwright não tem placa de vídeo: `prefer-hardware` é recusado ali, e é isso
// que prova o "Automático" ficando no caminho de hoje. Para exercitar o caminho novo, os testes
// ligam "Sempre ligada" -- que aceita o codificador de software -- e é o CAMINHO que se prova
// aqui. A placa de vídeo de verdade fica para a validação manual, no Chrome e no aplicativo
// (docs/plano-webcodecs.md).
//
//   npm run test:webcodecs
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3231;
const sala = 'squad-webcodecs';
const erros = [];
let instancia, navegador;

// A tela é um canvas em movimento: a captura de verdade só entrega quadro quando a imagem muda.
async function telaSintetica(contexto) {
  await contexto.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const ctx = canvas.getContext('2d');
      let quadro = 0;
      setInterval(() => {
        quadro++;
        ctx.fillStyle = `hsl(${quadro * 3 % 360} 45% 30%)`; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#eee'; ctx.fillRect(40 + (quadro * 7) % 1100, 200, 160, 120);
        ctx.font = '48px sans-serif'; ctx.fillText(String(quadro), 60, 100);
      }, 33);
      return canvas.captureStream(30);
    } });
  });
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { erros.push(`${nome}: ${erro.message}`); console.error(`erro na página de ${nome}:`, erro.message); });
  await pagina.goto(`${instancia.origem.replace('127.0.0.1', 'localhost')}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self') && transporte?.sala.state === 'connected', null, { timeout: 40000 });
  return pagina;
}

async function compartilhar(pagina) {
  await pagina.locator('#screenBtn').click();
  await pagina.locator('#audioPolicy').selectOption('none');
  await pagina.locator('#confirmScreenBtn').click();
  await pagina.waitForFunction(() => Boolean(screenStream));
}

const idDe = (pagina, nome) => pagina.evaluate(n => [...peers.values()].find(p => p.name === n)?.id, nome);
const envio = pagina => pagina.evaluate(() => transporte.telaWebCodecs.estadoDoEnvio());
const recepcao = (pagina, id) => pagina.evaluate(id => ({
  modo: transporte.telaWebCodecs.modoDaTela(id),
  assistindo: peers.get(id)?.assistindo,
  anunciada: peers.get(id)?.state.screen,
  publicacoes: [...(peers.get(id)?.publicacoes.values() || [])].map(p => `${RoomTransport.fonteDaPublicacao(p)}:${p.isSubscribed ? 'assinada' : 'livre'}${p.isMuted ? ':muda' : ''}`),
  faixasDeDados: [...(transporte.sala.remoteParticipants.get(id)?.dataTracks?.keys?.() || [])],
  rtpAssinado: [...peers.get(id).publicacoes.values()].some(p => RoomTransport.fonteDaPublicacao(p) === 'screen' && p.isSubscribed),
  faixa: peers.get(id).remoteStreams.screen.getVideoTracks()[0]?.readyState || null,
  pelaFaixaDeDados: Boolean(transporte.telaWebCodecs.streamDe(id)) && peers.get(id).remoteStreams.screen === transporte.telaWebCodecs.streamDe(id),
  estado: transporte.telaWebCodecs.estadoDoRecebimento().find(r => r.id === id) || null
}), id);

async function esperarCaminho(pagina, modo, rotulo) {
  await pagina.waitForFunction(m => transporte.telaWebCodecs.estadoDoEnvio()?.modo === m, modo, { timeout: 20000 })
    .catch(async erro => { console.error(`${rotulo}: envio =`, JSON.stringify(await envio(pagina))); throw erro; });
  return envio(pagina);
}

// A tela desta pessoa chegando pelo caminho novo (`true`) ou pelo de sempre (`false`).
async function esperarOrigem(pagina, id, pelaFaixaDeDados, rotulo) {
  await pagina.waitForFunction(({ id, pelaFaixaDeDados }) => {
    const par = peers.get(id);
    const faixa = par?.remoteStreams.screen.getVideoTracks()[0];
    if (!faixa || faixa.readyState !== 'live') return false;
    const wc = transporte.telaWebCodecs.streamDe(id);
    return pelaFaixaDeDados ? par.remoteStreams.screen === wc : !wc && par.remoteStreams.screen === par.telaPeloRtp;
  }, { id, pelaFaixaDeDados }, { timeout: 25000 })
    .catch(async erro => { console.error(`${rotulo}: recepção =`, JSON.stringify(await recepcao(pagina, id))); throw erro; });
}

// O palco mostra quadros de verdade, e não só uma faixa "viva": o `<video>` precisa ter
// medidas e os quadros apresentados precisam andar.
async function palcoAndando(pagina) {
  await pagina.waitForFunction(() => stageVideo.videoWidth > 0 && stageVideo.readyState >= 2, null, { timeout: 20000 });
  const quadros = () => pagina.evaluate(() => stageVideo.getVideoPlaybackQuality().totalVideoFrames);
  const antes = await quadros();
  await pagina.waitForTimeout(1500);
  return (await quadros()) > antes;
}

const assistir = async pagina => {
  await pagina.locator('.participant-tela .assistir-btn').first().click();
};

async function painel() {
  const origem = instancia.origem;
  const login = await fetch(origem + '/painel/entrar', { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await instancia.chave() }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await (await fetch(origem + '/painel/api/sessao', { headers: { Cookie: cookie } })).json();
  return {
    ler: async () => (await fetch(origem + '/painel/api/midia', { headers: { Cookie: cookie } })).json(),
    definir: async ligado => {
      const r = await fetch(origem + '/painel/api/midia', { method: 'POST', headers: { Cookie: cookie, Origin: origem, 'X-Nexo-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ webcodecs: ligado }) });
      return { status: r.status, dados: await r.json() };
    }
  };
}

(async () => {
  instancia = await iniciarServidor({ midia: true, ambiente: { PORT: String(porta) } });
  navegador = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // ---------- Automático, sem placa: fica no caminho de hoje, e diz por quê ----------
  const contextoAna = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  await telaSintetica(contextoAna);
  const ana = await entrar(contextoAna, 'Ana');
  const bia = await entrar(await navegador.newContext({ viewport: { width: 1440, height: 900 } }), 'Bia');
  await ana.waitForFunction(() => [...peers.values()].some(p => p.name === 'Bia'), null, { timeout: 20000 });
  await bia.waitForFunction(() => [...peers.values()].some(p => p.name === 'Ana'), null, { timeout: 20000 });
  const capacidade = await ana.evaluate(async () => { await transporte.telaWebCodecs.sondagens; return transporte.telaWebCodecs.capacidade(); });
  console.log('capacidade do Chromium de teste:', JSON.stringify(capacidade));

  await compartilhar(ana);
  await ana.waitForFunction(() => transporte.telaWebCodecs.estadoDoEnvio()?.motivo !== 'avaliando', null, { timeout: 15000 });
  const automatico = await envio(ana);
  assert.equal(automatico.modo, 'rtp', 'sem placa de vídeo, o automático fica no caminho de hoje');
  assert.match(automatico.motivo, /placa de vídeo/, `o motivo diz por quê: ${automatico.motivo}`);
  // Assistir pelo caminho de hoje antes de o novo ligar: é a transição que precisa ser sem piscar.
  const idDaAna = await idDe(bia, 'Ana');
  await assistir(bia);
  await esperarOrigem(bia, idDaAna, false, 'antes de ligar');
  assert.equal(await palcoAndando(bia), true, 'pelo RTP, o palco anda');
  console.log(`PASS: automático sem placa fica no RTP (${automatico.motivo})`);

  // ---------- Sempre ligada: o caminho novo de ponta a ponta, sem a imagem sumir na troca ----------
  const elementoDoPalco = await bia.evaluateHandle(() => stageVideo);
  // Pelo seletor de verdade (fica em Dispositivos → Qualidade, num modal fechado agora).
  await ana.locator('#telaWebCodecs').selectOption('sempre', { force: true });
  assert.equal(await ana.evaluate(() => localStorage.getItem('sala.webcodecs')), 'sempre', 'a escolha fica guardada neste navegador');
  await esperarCaminho(ana, 'webcodecs', 'sempre ligada');
  // Monta antes de desmontar: o RTP que já estava no ar continua até a faixa de dados ter imagem.
  const naTransicao = await recepcao(bia, idDaAna);
  assert.ok(naTransicao.faixa === 'live', 'durante a troca, o palco continua com uma faixa viva');
  await esperarOrigem(bia, idDaAna, true, 'depois de ligar');
  assert.equal(await palcoAndando(bia), true, 'o palco anda pela faixa de dados');
  assert.equal(await bia.evaluate(el => el === stageVideo, elementoDoPalco), true, 'é o MESMO <video> do palco: a interface não mudou');
  await bia.waitForFunction(id => ![...peers.get(id).publicacoes.values()].some(p => RoomTransport.fonteDaPublicacao(p) === 'screen' && p.isSubscribed), idDaAna, { timeout: 10000 });
  // A Bia pediu a camada cheia assim que o palco assentou.
  await ana.waitForFunction(() => transporte.telaWebCodecs.estadoDoEnvio()?.camadas.some(c => c.camada === 'alta' && c.espectadores === 1), null, { timeout: 10000 });
  console.log('PASS: a tela passa a ir por WebCodecs sem sumir do palco, e o RTP da tela deixa de descer');

  // ---------- A tela pela faixa de dados continua no relatório de banda ----------
  await bia.evaluate(() => transporte.medirRecebimento());
  await bia.waitForTimeout(2000);
  const banda = await bia.evaluate(() => transporte.medirRecebimento());
  assert.ok(banda.screen > 20_000, `a tela recebida pela faixa de dados entra na conta (${banda.screen} bytes em 2 s)`);
  console.log(`PASS: relatório de banda conta a tela da faixa de dados (${Math.round(banda.screen / 1024)} kB em 2 s)`);

  // ---------- Atraso medido entre as duas máquinas, com o relógio acertado ----------
  await bia.waitForFunction(id => Number.isFinite(transporte.telaWebCodecs.estadoDoRecebimento().find(r => r.id === id)?.atrasoMs), idDaAna, { timeout: 15000 });
  const comAtraso = (await recepcao(bia, idDaAna)).estado;
  assert.ok(comAtraso.atrasoMs >= 0 && comAtraso.atrasoMs < 2000, `atraso plausível: ${comAtraso.atrasoMs} ms`);
  assert.equal(comAtraso.codec.startsWith('avc1.'), true, 'H.264 quando todo mundo decodifica');
  console.log(`PASS: atraso de ponta a ponta medido (${Math.round(comAtraso.atrasoMs)} ms, ida e volta ${Math.round(comAtraso.rtt)} ms)`);

  // ---------- Quem entra no meio decodifica no quadro-chave seguinte ----------
  const caio = await entrar(await navegador.newContext({ viewport: { width: 1440, height: 900 } }), 'Caio');
  await caio.waitForFunction(id => peers.get(id)?.state.screen, idDaAna, { timeout: 20000 });
  await assistir(caio);
  await esperarOrigem(caio, idDaAna, true, 'quem entrou no meio');
  assert.equal(await palcoAndando(caio), true);
  assert.equal((await envio(ana)).modo, 'webcodecs', 'a entrada de quem suporta não derruba o caminho');
  console.log('PASS: quem entra no meio recebe a configuração no quadro-chave e decodifica');

  // ---------- Perda de pacotes: reenvio primeiro, quadro-chave se não bastar ----------
  //
  // Mede quanto do tempo o palco fica parado, a 1%, 5% e 10% de perda de PACOTES (o quadro-
  // chave tem vários, e é o que mais sofre). É a medição 0.3 do plano em versão sintética: a
  // de verdade é numa rede ruim de verdade, mas esta já diz se a recuperação funciona.
  async function congelamento(pagina, ms) {
    return pagina.evaluate(async ms => {
      let parados = 0, total = 0, anterior = stageVideo.getVideoPlaybackQuality().totalVideoFrames;
      const fim = performance.now() + ms;
      while (performance.now() < fim) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const agora = stageVideo.getVideoPlaybackQuality().totalVideoFrames;
        total += 1;
        if (agora === anterior) parados += 1;
        anterior = agora;
      }
      return parados / total;
    }, ms);
  }
  const medicoesDePerda = [];
  for (const perda of [0.01, 0.05, 0.1]) {
    const antes = (await recepcao(caio, idDaAna)).estado.totais;
    await caio.evaluate(p => transporte.telaWebCodecs.simularPerda(p), perda);
    const parado = await congelamento(caio, 6000);
    const depois = (await recepcao(caio, idDaAna)).estado;
    medicoesDePerda.push({ perda, parado, camada: depois.camada, reenvios: depois.totais.reenviosPedidos - antes.reenviosPedidos,
      recuperados: depois.totais.recuperados - antes.recuperados, perdidos: depois.totais.perdidos - antes.perdidos,
      chaves: depois.totais.pedidosDeChave - antes.pedidosDeChave });
    await caio.evaluate(() => transporte.telaWebCodecs.simularPerda(0));
    await caio.waitForTimeout(1500);
  }
  for (const m of medicoesDePerda) {
    console.log(`  perda de ${Math.round(m.perda * 100)}% dos pacotes: palco parado ${Math.round(m.parado * 100)}% do tempo; camada ${m.camada};`
      + ` ${m.reenvios} reenvios pedidos, ${m.recuperados} quadros recuperados, ${m.perdidos} perdidos de vez, ${m.chaves} pedidos de quadro-chave`);
  }
  const aCinco = medicoesDePerda.find(m => m.perda === 0.05);
  assert.ok(aCinco.recuperados > 0, 'o reenvio recupera quadros');
  assert.ok(aCinco.parado < 0.35, `a 5% de perda o palco fica parado menos de um terço do tempo (${Math.round(aCinco.parado * 100)}%)`);
  assert.equal(await palcoAndando(caio), true, 'sem a perda, a imagem segue normalmente');
  console.log('PASS: sob perda de pacotes, o reenvio recupera e a imagem segue');

  // ---------- A camada acompanha o lugar e a conexão de quem assiste ----------
  await bia.evaluate(() => transporte.definirEconomia(true));
  await ana.waitForFunction(() => transporte.telaWebCodecs.estadoDoEnvio()?.camadas.some(c => c.camada === 'baixa' && c.espectadores >= 1), null, { timeout: 15000 });
  await bia.waitForFunction(id => transporte.telaWebCodecs.estadoDoRecebimento().find(r => r.id === id)?.camada === 'baixa', idDaAna, { timeout: 15000 });
  assert.equal(await palcoAndando(bia), true, 'na camada leve, a imagem continua');
  await bia.evaluate(() => transporte.definirEconomia(false));
  await bia.waitForFunction(id => transporte.telaWebCodecs.estadoDoRecebimento().find(r => r.id === id)?.camada === 'alta', idDaAna, { timeout: 15000 });
  console.log('PASS: economia de dados leva à camada de 360p, e desligá-la traz a cheia de volta');

  // ---------- Banda curta: a resolução cede antes dos quadros ----------
  await ana.evaluate(() => transporte.telaWebCodecs.simularAperto(0.5));
  await ana.waitForFunction(() => (transporte.telaWebCodecs.estadoDoEnvio()?.camadas.find(c => c.camada === 'alta')?.escala || 1) > 1, null, { timeout: 20000 });
  const apertada = (await envio(ana)).camadas.find(c => c.camada === 'alta');
  assert.equal(apertada.quadrosAlvo, 30, 'em prioridade de movimento, os quadros pedidos continuam os mesmos');
  assert.ok(apertada.altura < 720, `a imagem encolheu (${apertada.largura}×${apertada.altura})`);
  await ana.evaluate(() => transporte.telaWebCodecs.simularAperto(0));
  assert.equal(await palcoAndando(bia), true);
  console.log(`PASS: com a saída apertada a imagem encolhe para ${apertada.largura}×${apertada.altura} e os quadros pedidos ficam em ${apertada.quadrosAlvo}`
    + ` (reconfigurações só de bitrate: ${apertada.reconfiguracoes.soDeBitrate}, com quadro-chave espontâneo: ${apertada.reconfiguracoes.comChaveEspontanea})`);

  // ---------- Sala mista: quem não decodifica leva todo mundo para o caminho de hoje ----------
  const contextoDavi = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  await contextoDavi.addInitScript(() => { delete window.VideoDecoder; delete window.EncodedVideoChunk; });
  const davi = await entrar(contextoDavi, 'Davi');
  const mista = await esperarCaminho(ana, 'rtp', 'sala mista');
  assert.match(mista.motivo, /Davi/, `o motivo aponta quem: ${mista.motivo}`);
  await esperarOrigem(bia, idDaAna, false, 'Bia na sala mista');
  await esperarOrigem(caio, idDaAna, false, 'Caio na sala mista');
  assert.equal(await palcoAndando(bia), true, 'a Bia continua vendo, agora pelo RTP');
  await davi.waitForFunction(id => peers.get(id)?.state.screen, idDaAna, { timeout: 20000 });
  await assistir(davi);
  await esperarOrigem(davi, idDaAna, false, 'Davi');
  assert.equal(await palcoAndando(davi), true, 'e o Davi, que não decodifica, vê pelo RTP');
  await davi.close();
  await esperarCaminho(ana, 'webcodecs', 'Davi saiu');
  await esperarOrigem(bia, idDaAna, true, 'Bia depois que o Davi saiu');
  console.log(`PASS: sala mista vai toda para o RTP (${mista.motivo}), e volta quando quem não decodifica sai`);

  // ---------- "Desligada" em quem assiste vale para a sala ----------
  await bia.locator('#telaWebCodecs').selectOption('desligada', { force: true });
  const desligadaPelaBia = await esperarCaminho(ana, 'rtp', 'Bia desligou');
  assert.match(desligadaPelaBia.motivo, /Bia/);
  await esperarOrigem(bia, idDaAna, false, 'Bia desligada');
  await bia.evaluate(() => definirPreferenciaDeWebCodecs('automatico'));
  await esperarCaminho(ana, 'webcodecs', 'Bia religou');
  // E "Desligada" em quem transmite também.
  await ana.evaluate(() => definirPreferenciaDeWebCodecs('desligada'));
  const desligadaPelaAna = await esperarCaminho(ana, 'rtp', 'Ana desligou');
  assert.match(desligadaPelaAna.motivo, /desligado por você/);
  await esperarOrigem(bia, idDaAna, false, 'Ana desligada');
  await ana.evaluate(() => definirPreferenciaDeWebCodecs('sempre'));
  await esperarCaminho(ana, 'webcodecs', 'Ana religou');
  console.log('PASS: o interruptor "Desligada" impede o caminho novo, dos dois lados');

  // ---------- A chave do servidor: desliga para todo mundo, sem ninguém recarregar ----------
  const doPainel = await painel();
  assert.deepEqual((await doPainel.ler()).webcodecs, { ligado: true, origem: 'padrao', em: null });
  const desligou = await doPainel.definir(false);
  assert.equal(desligou.status, 200);
  const pelaChave = await esperarCaminho(ana, 'rtp', 'chave do servidor');
  assert.match(pelaChave.motivo, /servidor/);
  await esperarOrigem(bia, idDaAna, false, 'chave do servidor');
  assert.equal(await palcoAndando(bia), true);
  assert.equal((await instancia.credencial('Eva', sala)).webcodecs, false, 'quem entra agora já recebe a chave desligada');
  await doPainel.definir(true);
  await esperarCaminho(ana, 'webcodecs', 'chave religada');
  await esperarOrigem(bia, idDaAna, true, 'chave religada');
  console.log('PASS: a chave do painel tira o caminho novo de todo mundo na hora, e devolve');

  // ---------- Falha do codificador no meio: volta ao RTP sem a tela sair da sala ----------
  await ana.evaluate(() => {
    window.codificarDeVerdade = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function () { throw new Error('falha simulada do codificador'); };
  });
  const aposFalha = await esperarCaminho(ana, 'rtp', 'falha do codificador');
  assert.match(aposFalha.motivo, /falhou/, `o motivo é a falha: ${aposFalha.motivo}`);
  await esperarOrigem(bia, idDaAna, false, 'depois da falha');
  assert.equal(await palcoAndando(bia), true, 'a imagem volta pelo RTP');
  assert.equal(await bia.evaluate(id => peers.get(id).state.screen && peers.get(id).assistindo, idDaAna), true, 'a tela continua anunciada e assistida');
  console.log(`PASS: falha do codificador cai para o RTP sem a tela sumir (${aposFalha.motivo})`);

  // ---------- Parar de assistir para a codificação; parar de compartilhar tira as faixas ----------
  // Trocar o interruptor é tentar de novo: a falha anterior não vale para a escolha nova.
  await ana.evaluate(() => { VideoEncoder.prototype.encode = window.codificarDeVerdade; });
  await ana.evaluate(() => definirPreferenciaDeWebCodecs('automatico'));
  await ana.evaluate(() => definirPreferenciaDeWebCodecs('sempre'));
  await esperarCaminho(ana, 'webcodecs', 'depois da falha, de novo');
  await esperarOrigem(bia, idDaAna, true, 'de novo');
  await bia.locator('#stageStopBtn').click();
  await caio.locator('#stageStopBtn').click();
  await ana.waitForFunction(() => { const e = transporte.telaWebCodecs.estadoDoEnvio(); return e && !e.camadas.length && !e.captura; }, null, { timeout: 15000 });
  console.log('PASS: sem ninguém assistindo, nada é codificado e a captura para');
  await ana.locator('#screenBtn').click();
  await bia.waitForFunction(id => !transporte.sala.remoteParticipants.get(id)?.dataTracks?.size, idDaAna, { timeout: 15000 });
  assert.equal(await ana.evaluate(() => transporte.telaWebCodecs.estadoDoEnvio()), null);
  console.log('PASS: parar de compartilhar tira as faixas de dados da sala');

  assert.deepEqual(erros, []);
  console.log('Tela por WebCodecs: tudo certo.');
})().catch(async erro => {
  console.error(erro);
  console.error(instancia?.erros?.());
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
