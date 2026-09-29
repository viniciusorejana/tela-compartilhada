/* O Worker da tela pela placa de vídeo transportada pelo RTP (tela-placa-rtp.js).
 *
 * Ele é três coisas ao mesmo tempo, e as três precisavam estar FORA da thread da página:
 *  - lê os quadros da captura (a página transfere o fluxo do MediaStreamTrackProcessor);
 *  - codifica pela placa (um VideoEncoder por camada);
 *  - é a RTCRtpScriptTransform do remetente da tela: recebe cada quadro que o codificador do
 *    WebRTC produziu na miniatura, codifica na placa o quadro de captura correspondente e troca
 *    o conteúdo antes de o RTP empacotar.
 *
 * Fora da página porque, medido, com a thread principal ocupada 40% do tempo a imagem da faixa
 * de dados passava a ter buracos de mais de 50 ms várias vezes por segundo; o RTP, cujo caminho
 * inteiro é nativo, não mudava nada. Aqui o caminho inteiro volta a não depender da página.
 *
 * Só se codifica o que o WebRTC vai enviar: a camada que o servidor pausou (ninguém assiste)
 * não custa nada à placa, e a cadeia de referências do nosso codificador nunca tem um buraco --
 * quadro já codificado nunca é descartado.
 */
importScripts('/tela-decisoes.js');
const Decisoes = self.NexoTelaDecisoes;

// Só o quadro de captura mais novo fica guardado. A captura de tela e a câmera entregam à página
// quadros de um conjunto pequeno de buffers do Chrome, e cada quadro guardado aqui é um buffer a
// menos: sem buffer livre, a captura para de chegar a quem lê quadros na página -- o Worker e
// qualquer cópia nova da faixa --, enquanto o WebRTC segue recebendo a dele. Medido com a câmera
// falsa do Chrome: guardando 3, chegavam 3 quadros e mais nenhum, e liberar os 3 fazia chegar
// exatamente mais 3; a captura de uma aba parava do mesmo jeito. O canvas dos testes não tem
// esse limite, e por isso guardar 20 passou por todos eles.
const QUADROS_DE_CAPTURA_GUARDADOS = 1;
// O quadro do WebRTC pode chegar antes do quadro da captura que o originou, que vem ao Worker por
// outro caminho: antes de concluir que a imagem não mudou, espera-se um pouco menos que um
// intervalo entre quadros a 60.
const MS_DE_ESPERA_PELA_CAPTURA_NOVA = 12;
// A captura que para de chegar ao Worker enquanto o WebRTC segue recebendo a dele viraria imagem
// congelada sem ninguém saber: cada quadro do WebRTC levaria a última imagem de novo, e quem
// assiste veria 60 quadros por segundo da mesma imagem (foi o que o teste da câmera mostrou,
// guardando quadros demais). Numa tela parada de verdade a captura e o WebRTC param juntos
// (medido com uma aba capturada: nenhuma repetição). Então: tantas janelas seguidas sem captura
// e com repetições em ritmo de vídeo, e a tela volta ao codificador do WebRTC.
const JANELAS_DE_CAPTURA_PARADA = 3;
const REPETICOES_POR_SEGUNDO_DE_CAPTURA_PARADA = 10;
let janelasDeCapturaParada = 0;
// A placa que não devolve um quadro neste prazo está engasgada: o quadro não sai, e o próximo
// precisa ser chave -- o que ela devolver depois referenciaria algo que ninguém recebeu.
const MS_DE_PRAZO_DA_PLACA = 150;

const fonte = [];                 // { us, quadro }
let leitorDaFonte = null;
let geracaoDaFonte = 0;
// Quantos quadros a captura entregou desde a última leitura: o "capturados" do painel de
// medição, entre o que foi pedido e o que saiu codificado.
let capturadosNaJanela = 0;
let inicioDaJanelaDaCaptura = performance.now();
let passarAdiante = false;        // falha: os quadros do próprio WebRTC seguem sem troca
let ridPorSsrc = {};
// A largura abaixo da qual a miniatura é a da camada leve (entre 1/32 e 1/8 da captura).
let limiteDaMiniaturaLeve = 0;
let primeiroQuadroAvisado = false;
const destinados = {};            // rid -> bits/s que o WebRTC destina à camada
const camadas = {};               // 'alta' | 'baixa' -> estado da camada
const porSsrc = new Map();        // ssrc -> { casamento, cena, voltas, ultimoRtp }

function novaJanela() {
  return { trocados: 0, bytes: 0, chaves: 0, semCaptura: 0, repetidos: 0, atrasados: 0, msNaPlaca: 0, amostras: 0, cenas: 0, pedidos: 0 };
}

// Quem espera um quadro de captura novo (a transform, por no máximo MS_DE_ESPERA_PELA_CAPTURA_NOVA).
let esperandoCaptura = [];
function capturaNova(ms) {
  return new Promise(resolve => {
    const aviso = () => { clearTimeout(prazo); resolve(); };
    const prazo = setTimeout(() => { esperandoCaptura = esperandoCaptura.filter(a => a !== aviso); resolve(); }, ms);
    esperandoCaptura.push(aviso);
  });
}

function avisarFalha(motivo) {
  if (passarAdiante) return;
  passarAdiante = true;
  postMessage({ tipo: 'falha', motivo });
}

// ---------- A captura ----------
async function lerFonte(leitor, geracao) {
  for (;;) {
    let lido;
    try { lido = await leitor.read(); } catch (_) { break; }
    if (lido.done || geracao !== geracaoDaFonte) { lido.value?.close(); break; }
    capturadosNaJanela += 1;
    fonte.push({ us: lido.value.timestamp, quadro: lido.value });
    while (fonte.length > QUADROS_DE_CAPTURA_GUARDADOS) fonte.shift().quadro.close();
    const avisos = esperandoCaptura;
    esperandoCaptura = [];
    for (const aviso of avisos) aviso();
  }
}

function trocarFonte(leitor) {
  geracaoDaFonte += 1;
  try { leitorDaFonte?.cancel(); } catch (_) { /* já encerrado */ }
  while (fonte.length) fonte.shift().quadro.close();
  janelasDeCapturaParada = 0;
  // Captura nova é imagem nova: sem isto, o primeiro quadro dela sairia como diferença de uma
  // imagem que não existe mais, e seria o maior quadro da transmissão.
  for (const c of Object.values(camadas)) c.precisaDeChave = true;
  porSsrc.forEach(s => { s.casamento = { deslocamentoMs: null, ultimoUs: -Infinity }; });
  leitorDaFonte = leitor.getReader();
  lerFonte(leitorDaFonte, geracaoDaFonte);
}

// ---------- As camadas ----------
function criarCamada(nome, config, info) {
  const esperando = new Map();    // carimbo (µs) -> resolve
  const c = {
    nome, config: { ...config }, info, esperando, precisaDeChave: true, ultimoCarimboUs: -Infinity,
    bitrate: config.bitrate, ultimaMudanca: 0, reconfiguracoes: 0,
    janela: novaJanela(), ultimaJanela: { ...novaJanela(), segundos: 0 }, inicioDaJanela: performance.now(),
    latencias: []
  };
  c.encoder = new VideoEncoder({
    output(pedaco) {
      const dados = new ArrayBuffer(pedaco.byteLength);
      pedaco.copyTo(dados);
      const resolver = esperando.get(pedaco.timestamp);
      esperando.delete(pedaco.timestamp);
      if (resolver) resolver({ dados, chave: pedaco.type === 'key' });
    },
    error(erro) { avisarFalha(`a placa de vídeo parou de codificar a camada ${nome} (${erro?.message || erro})`); }
  });
  try { c.encoder.configure(c.config); }
  catch (erro) { avisarFalha(`a placa de vídeo recusou a camada ${nome} (${erro?.message || erro})`); }
  camadas[nome] = c;
}

function configurarCamadas(configs, infos) {
  for (const nome of ['alta', 'baixa']) {
    const antiga = camadas[nome];
    if (antiga) { try { antiga.encoder.close(); } catch (_) { /* já fechado */ } delete camadas[nome]; }
    if (configs[nome]) criarCamada(nome, configs[nome], infos?.[nome] || {});
  }
}

// O orçamento segue o que o WebRTC destina à camada; ver `orcamentoDaCamada`.
function seguirOrcamento(c, destinado) {
  const agora = performance.now();
  const novo = Decisoes.orcamentoDaCamada({ atual: c.bitrate, destinado, maximo: c.info.bitrateMax || c.config.bitrate, minimo: c.info.bitrateMin || 100_000, agora, ultimaMudanca: c.ultimaMudanca });
  if (novo === null || c.encoder.state !== 'configured') return;
  c.bitrate = novo;
  c.ultimaMudanca = agora;
  c.reconfiguracoes += 1;
  try { c.encoder.configure({ ...c.config, bitrate: novo }); }
  catch (erro) { avisarFalha(`a placa de vídeo recusou o orçamento novo da camada ${c.nome} (${erro?.message || erro})`); }
}

function estadoDoSsrc(ssrc) {
  if (!porSsrc.has(ssrc)) porSsrc.set(ssrc, { casamento: { deslocamentoMs: null, ultimoUs: -Infinity }, cena: {}, voltas: 0, ultimoRtp: null });
  return porSsrc.get(ssrc);
}

// O carimbo do RTP tem 32 bits e dá a volta a cada ~13 horas a 90 kHz.
function msDoRtp(s, carimbo) {
  if (s.ultimoRtp !== null && carimbo < s.ultimoRtp && s.ultimoRtp - carimbo > 2 ** 31) s.voltas += 1;
  s.ultimoRtp = carimbo;
  return (carimbo + s.voltas * 2 ** 32) / 90;
}

// ---------- A transform ----------
self.onrtctransform = evento => {
  const leitor = evento.transformer.readable.getReader();
  const escritor = evento.transformer.writable.getWriter();
  // Os quadros saem na ordem em que entraram, mesmo com a placa trabalhando em linha de
  // montagem: cada um espera o anterior ser escrito.
  let cadeia = Promise.resolve();
  (async () => {
    for (;;) {
      let lido;
      try { lido = await leitor.read(); } catch (_) { break; }
      if (lido.done) break;
      const quadro = lido.value;
      if (passarAdiante) { cadeia = cadeia.then(() => escritor.write(quadro)).catch(() => {}); continue; }
      const meta = quadro.getMetadata();
      // Antes de o mapa SSRC→rid chegar (as estatísticas levam um quarto de segundo), a camada
      // sai pela largura da miniatura, que a página conhece exatamente: a leve nasce com 1/32 da
      // captura, a cheia com 1/8. Descartar esses primeiros quadros NÃO serve: o servidor só dá a
      // publicação como publicada quando a mídia chega, e uma republicação nesse intervalo deixava
      // uma publicação pendente que nunca recebia nada -- e a seguinte, com o mesmo id de faixa,
      // ficava na fila atrás dela para sempre (medido: a tela sumia com duas trocas seguidas).
      const rid = ridPorSsrc[meta.synchronizationSource]
        || (limiteDaMiniaturaLeve && meta.width ? (meta.width < limiteDaMiniaturaLeve ? 'q' : 'f') : null);
      if (!rid) continue;
      const s = estadoDoSsrc(meta.synchronizationSource);
      const rtpMs = msDoRtp(s, quadro.timestamp);
      let casado = Decisoes.casarComACaptura(s.casamento, rtpMs, fonte.map(f => f.us));
      if (casado.indice < 0) {
        await capturaNova(MS_DE_ESPERA_PELA_CAPTURA_NOVA);
        if (passarAdiante) { cadeia = cadeia.then(() => escritor.write(quadro)).catch(() => {}); continue; }
        casado = Decisoes.casarComACaptura(s.casamento, rtpMs, fonte.map(f => f.us));
      }
      const c = camadas[Decisoes.camadaDoRid(rid)];
      if (!c || c.encoder.state !== 'configured') continue;
      // Sem quadro de captura novo, a imagem é a do último quadro: o WebRTC pode produzir quadros
      // sem captura nova (repetindo o último), e descartar um deles pode ser descartar justamente
      // o quadro-chave que alguém pediu -- com a tela parada, não vem outro tão cedo. Então a
      // repetição leva a última imagem, de novo. A captura que para DE VEZ é outra coisa, vigiada
      // em `estatisticas`.
      let captura, repetida = false;
      if (casado.indice >= 0) { s.casamento = casado.estado; captura = fonte[casado.indice]; }
      else if (fonte.length) { captura = fonte[fonte.length - 1]; repetida = true; c.janela.repetidos += 1; }
      else { c.janela.semCaptura += 1; continue; }
      const cena = Decisoes.trocaDeCena(s.cena, { bytesDaMiniatura: quadro.data.byteLength, chaveDoWebrtc: quadro.type === 'key' });
      s.cena = cena.estado;
      if (cena.cena) c.janela.cenas += 1;
      const chave = c.precisaDeChave || cena.cena;
      c.precisaDeChave = false;
      // O carimbo do nosso codificador só anda para a frente e nunca se repete (é a chave de
      // `esperando`): a repetição leva a hora estimada pelo relógio do RTP, porque o controle de
      // taxa da placa usa os carimbos.
      const estimado = repetida && s.casamento.deslocamentoMs != null ? Math.round((rtpMs - s.casamento.deslocamentoMs) * 1000) : captura.us;
      const us = Math.max(estimado, c.ultimoCarimboUs + 1);
      c.ultimoCarimboUs = us;
      const entrada = us === captura.us ? captura.quadro : new VideoFrame(captura.quadro, { timestamp: us });
      const pronto = new Promise(resolve => c.esperando.set(us, resolve));
      const inicio = performance.now();
      try { c.encoder.encode(entrada, { keyFrame: chave }); }
      catch (erro) { avisarFalha(`a placa de vídeo recusou um quadro (${erro?.message || erro})`); continue; }
      finally { if (entrada !== captura.quadro) entrada.close(); }
      const prazo = new Promise(resolve => setTimeout(() => resolve(null), MS_DE_PRAZO_DA_PLACA));
      cadeia = cadeia.then(() => Promise.race([pronto, prazo])).then(saida => {
        if (!saida) {
          c.esperando.delete(us);
          c.janela.atrasados += 1;
          c.precisaDeChave = true;
          return;
        }
        quadro.data = saida.dados;
        c.janela.trocados += 1;
        c.janela.bytes += saida.dados.byteLength;
        if (saida.chave) c.janela.chaves += 1;
        const ms = performance.now() - inicio;
        c.janela.msNaPlaca += ms;
        c.janela.amostras += 1;
        // A página só dá a publicação por concluída depois disto: o servidor só a cria quando a
        // mídia chega, e despublicar antes deixava uma publicação pendente que prendia a seguinte.
        if (!primeiroQuadroAvisado) { primeiroQuadroAvisado = true; postMessage({ tipo: 'primeiroQuadro' }); }
        return escritor.write(quadro);
      }).catch(() => { /* o remetente foi encerrado */ });
    }
  })();
};

// O primeiro quadro de um codificador recém-configurado demora muito mais que os seguintes (a
// placa abre a sessão dela). Se isso acontecesse depois de publicar, a mídia chegaria ao servidor
// atrasada -- e o servidor só dá a publicação como publicada quando a mídia chega; uma
// republicação nesse intervalo deixava a tela presa (ver o comentário da transform). Então cada
// camada codifica um quadro de captura ANTES de a página publicar, e o resultado vai fora.
const MS_DE_ESPERA_PELA_CAPTURA = 1000;
async function aquecer() {
  const limite = performance.now() + MS_DE_ESPERA_PELA_CAPTURA;
  while (!fonte.length && performance.now() < limite) await new Promise(resolve => setTimeout(resolve, 10));
  const captura = fonte[fonte.length - 1];
  if (!captura) return false;
  await Promise.all(Object.values(camadas).map(c => new Promise(resolve => {
    if (c.encoder.state !== 'configured') { resolve(); return; }
    c.esperando.set(captura.us, () => resolve());
    try { c.encoder.encode(captura.quadro, { keyFrame: true }); } catch (_) { c.esperando.delete(captura.us); resolve(); }
    setTimeout(resolve, MS_DE_PRAZO_DA_PLACA * 4);
  })));
  // O quadro de aquecimento não sai: o primeiro de verdade precisa ser chave de novo, e com
  // carimbo depois do dele (a captura pode não ter mudado desde então).
  for (const c of Object.values(camadas)) {
    c.precisaDeChave = true;
    c.esperando.delete(captura.us);
    c.ultimoCarimboUs = Math.max(c.ultimoCarimboUs, captura.us);
  }
  return true;
}

// ---------- As mensagens da página ----------
function estatisticas() {
  const agora = performance.now();
  const saida = {};
  let repetidosPorSegundo = 0;
  for (const c of Object.values(camadas)) {
    const segundos = Math.max(0.001, (agora - c.inicioDaJanela) / 1000);
    const j = c.janela;
    c.ultimaJanela = { ...j, segundos };
    c.janela = novaJanela();
    c.inicioDaJanela = agora;
    saida[c.nome] = {
      largura: c.config.width, altura: c.config.height, codec: c.config.codec, hardware: c.info.hardware === true,
      perfil: c.info.perfil || null, modoDeBitrate: c.config.bitrateMode || 'variable', taxaDeclarada: 'framerate' in c.config,
      quadrosAlvo: c.info.quadros || null, bitrateAlvo: c.bitrate,
      fps: j.trocados / segundos, bps: j.bytes * 8 / segundos, chaves: j.chaves, cenas: j.cenas,
      semCaptura: j.semCaptura, repetidos: j.repetidos, atrasados: j.atrasados,
      msDeCodificacao: j.amostras ? j.msNaPlaca / j.amostras : null,
      reconfiguracoes: c.reconfiguracoes
    };
    repetidosPorSegundo = Math.max(repetidosPorSegundo, j.repetidos / segundos);
  }
  const capturaFps = capturadosNaJanela / Math.max(0.001, (agora - inicioDaJanelaDaCaptura) / 1000);
  capturadosNaJanela = 0;
  inicioDaJanelaDaCaptura = agora;
  janelasDeCapturaParada = capturaFps < 1 && repetidosPorSegundo >= REPETICOES_POR_SEGUNDO_DE_CAPTURA_PARADA ? janelasDeCapturaParada + 1 : 0;
  if (janelasDeCapturaParada >= JANELAS_DE_CAPTURA_PARADA) {
    avisarFalha(`a captura parou de chegar à placa (${Math.round(repetidosPorSegundo)} quadros por segundo do WebRTC sem imagem nova)`);
  }
  return { camadas: saida, passarAdiante, capturaFps };
}

self.onmessage = evento => {
  const m = evento.data || {};
  if (m.tipo === 'fonte') {
    trocarFonte(m.leitor);
    // A média geométrica das duas escalas (1/16 da captura): o meio do caminho entre as duas
    // miniaturas, com folga igual para cada lado.
    if (m.larguraDaCaptura) limiteDaMiniaturaLeve = m.larguraDaCaptura / Math.sqrt(Decisoes.ESCALA_DA_MINIATURA * Decisoes.ESCALA_DA_MINIATURA_LEVE);
  }
  else if (m.tipo === 'camadas') configurarCamadas(m.configs, m.infos);
  else if (m.tipo === 'aquecer') aquecer().then(ok => postMessage({ tipo: 'aquecido', ok }));
  else if (m.tipo === 'rids') ridPorSsrc = m.mapa || {};
  else if (m.tipo === 'destinados') {
    Object.assign(destinados, m.destinados);
    for (const [rid, bps] of Object.entries(m.destinados || {})) {
      const c = camadas[Decisoes.camadaDoRid(rid)];
      if (c) seguirOrcamento(c, bps);
    }
  } else if (m.tipo === 'pedidos') {
    // PLI ou FIR que chegaram ao remetente: alguém (quem acabou de entrar, quem trocou de
    // camada, quem perdeu um quadro-chave) está esperando imagem.
    for (const rid of m.rids || []) {
      const c = camadas[Decisoes.camadaDoRid(rid)];
      if (c) { c.precisaDeChave = true; c.janela.pedidos += 1; }
    }
  } else if (m.tipo === 'passar') passarAdiante = true;
  else if (m.tipo === 'estatisticas') postMessage({ tipo: 'estatisticas', id: m.id, dados: estatisticas() });
  else if (m.tipo === 'encerrar') {
    geracaoDaFonte += 1;
    try { leitorDaFonte?.cancel(); } catch (_) { /* já encerrado */ }
    while (fonte.length) fonte.shift().quadro.close();
    for (const c of Object.values(camadas)) { try { c.encoder.close(); } catch (_) { /* já fechado */ } }
    close();
  }
};
