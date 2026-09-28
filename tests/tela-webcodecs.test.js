// A tela por WebCodecs, sem navegador: o envelope de cada quadro, as mensagens de controle,
// as decisões (caminho, adaptação, camada) e a chave do servidor. O caminho de ponta a ponta,
// com codificação e servidor de mídia de verdade, está em tests/webcodecs-browser.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Quadro = require('../public/tela-quadro.js');
const Decisoes = require('../public/tela-decisoes.js');
const RoomQuality = require('../public/quality-utils.js');
const { criarChaveDeWebCodecs } = require('../chave-webcodecs.js');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');

// ---------- O envelope ----------

test('o envelope leva e devolve tudo o que o decodificador precisa', () => {
  const dados = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 9, 8, 7]);
  const bytes = Quadro.montar({
    chave: true, camada: 'baixa', largura: 640, altura: 360, sequencia: 70000, geracao: 3, dados,
    config: { codec: 'avc1.64001F', codedWidth: 640, codedHeight: 368, description: new Uint8Array([1, 2, 3]), colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } }
  });
  const lido = Quadro.ler(bytes);
  assert.equal(lido.chave, true);
  assert.equal(lido.camada, 'baixa');
  assert.deepEqual([lido.largura, lido.altura, lido.sequencia, lido.geracao], [640, 360, 70000, 3]);
  assert.equal(lido.config.codec, 'avc1.64001F');
  assert.deepEqual([lido.config.codedWidth, lido.config.codedHeight], [640, 368]);
  assert.deepEqual([...lido.config.description], [1, 2, 3]);
  assert.equal(lido.config.colorSpace.fullRange, false);
  assert.deepEqual([...lido.dados], [...dados]);
});

test('só o quadro-chave carrega a configuração: nos outros ela seria peso morto em todo quadro', () => {
  const bytes = Quadro.montar({ chave: false, camada: 'alta', largura: 1920, altura: 1080, sequencia: 5, geracao: 1, dados: new Uint8Array(4), config: { codec: 'vp8' } });
  assert.equal(bytes.length, Quadro.TAMANHO_DO_CABECALHO + 4);
  assert.equal(Quadro.ler(bytes).config, null);
});

test('o que não é um envelope nosso, íntegro, vira null e não derruba quem recebe', () => {
  const bom = Quadro.montar({ chave: true, camada: 'alta', largura: 1, altura: 1, sequencia: 0, geracao: 0, dados: new Uint8Array(2), config: { codec: 'vp8' } });
  assert.equal(Quadro.ler(new Uint8Array(3)), null, 'curto demais');
  assert.equal(Quadro.ler(Object.assign(new Uint8Array(bom), { 0: 0 })), null, 'mágico errado');
  assert.equal(Quadro.ler(Object.assign(new Uint8Array(bom), { 1: 9 })), null, 'versão desconhecida');
  assert.equal(Quadro.ler(Object.assign(new Uint8Array(bom), { 3: 7 })), null, 'camada que não existe');
  const configQuebrada = new Uint8Array(bom);
  configQuebrada[Quadro.TAMANHO_DO_CABECALHO] = 0x7b + 1;
  assert.equal(Quadro.ler(configQuebrada), null, 'configuração que não é JSON');
  const mentindoOTamanho = new Uint8Array(bom);
  new DataView(mentindoOTamanho.buffer).setUint16(14, 60000, true);
  assert.equal(Quadro.ler(mentindoOTamanho), null, 'configuração maior que o pacote');
  assert.equal(Quadro.ler(Quadro.montar({ chave: true, camada: 'alta', largura: 1, altura: 1, sequencia: 0, geracao: 0, dados: new Uint8Array(0), config: { codec: 'x'.repeat(80) } })), null, 'codec absurdo');
});

test('o nome da faixa diz a camada, e só as nossas são reconhecidas', () => {
  assert.equal(Quadro.camadaDaFaixa(Quadro.nomeDaFaixa('alta')), 'alta');
  assert.equal(Quadro.camadaDaFaixa('nexo-tela:media'), null);
  assert.equal(Quadro.camadaDaFaixa('outra-coisa'), null);
});

// ---------- Pedaços e ritmador ----------

test('o quadro é fatiado abaixo do piso de 8 KB do servidor e remontado igual, em qualquer ordem', () => {
  const envelope = Uint8Array.from({ length: 50_000 }, (_, i) => i % 251);
  const pedacos = Quadro.fatiar(envelope, { camada: 'alta', sequencia: 9, geracao: 2 });
  assert.equal(pedacos.length, Math.ceil(50_000 / Quadro.TAMANHO_DO_PEDACO));
  assert.ok(pedacos.every(p => p.length < 8192), 'cada pedaço cabe abaixo do piso do portão do servidor');
  const montador = Quadro.criarMontador();
  const embaralhados = [...pedacos].reverse();
  let inteiro = null;
  for (const p of embaralhados) inteiro = montador.receber(Quadro.lerPedaco(p)) || inteiro;
  assert.deepEqual([...inteiro], [...envelope]);
  assert.equal(montador.emMontagem, 0);
  assert.equal(montador.receber(Quadro.lerPedaco(pedacos[0])), null, 'um pedaço repetido depois de montado recomeça, e não remonta sozinho');
});

test('um pedaço faltando nunca monta o quadro, e o que ficou pela metade expira', () => {
  const pedacos = Quadro.fatiar(new Uint8Array(20_000), { camada: 'baixa', sequencia: 1, geracao: 1 });
  const montador = Quadro.criarMontador({ msDeValidade: 1000 });
  for (const p of pedacos.slice(1)) assert.equal(montador.receber(Quadro.lerPedaco(p), 0), null);
  assert.equal(montador.emMontagem, 1);
  montador.limpar(2000);
  assert.equal(montador.emMontagem, 0);
  assert.equal(Quadro.lerPedaco(new Uint8Array(10)), null);
  assert.equal(Quadro.fatiar(new Uint8Array(3), { camada: 'alta', sequencia: 0, geracao: 0 }).length, 1, 'quadro pequeno é um pedaço só');
});

test('o ritmador espaça os pedaços: nunca dois grudados, e o reenvio fura a fila', () => {
  let agora = 0;
  const saidas = [];
  const agendados = [];
  const ritmador = Quadro.criarRitmador({
    agora: () => agora,
    agendar: (fn, ms) => { agendados.push({ quando: agora + ms, fn }); return agendados.length; },
    cancelar: () => {},
    bytesPorSegundo: () => 1_000_000,
    enviar: item => saidas.push({ em: agora, nome: item.nome, bytes: item.bytes.length })
  });
  const pedaco = nome => ({ nome, bytes: new Uint8Array(7000) });
  for (const nome of ['a', 'b', 'c', 'd']) ritmador.enfileirar(pedaco(nome));
  ritmador.enfileirar(pedaco('reenvio'), { primeiro: true });
  // Corre o relógio de mentira até esvaziar.
  while (agendados.length) {
    agendados.sort((x, y) => x.quando - y.quando);
    const proximo = agendados.shift();
    agora = proximo.quando;
    proximo.fn();
  }
  assert.deepEqual(saidas.map(s => s.nome), ['a', 'reenvio', 'b', 'c', 'd'], 'o primeiro já tinha saído; o reenvio passa na frente dos outros');
  for (let i = 1; i < saidas.length; i++) {
    assert.ok(saidas[i].em - saidas[i - 1].em >= 6.9, `intervalo de ${saidas[i].em - saidas[i - 1].em} ms entre dois pedaços de 7 KB a 1 MB/s`);
  }
  assert.equal(ritmador.bytesNaFila, 0);
});

test('o ritmador não perde vazão com o relógio atrasado, e parado não junta rajada', () => {
  // O relógio do Worker acorda ~1 ms depois do pedido. Antes, cada atraso era vazão jogada
  // fora, e a fila crescia com a taxa sobrando.
  let agora = 0;
  const saidas = [];
  const agendados = [];
  const ritmador = Quadro.criarRitmador({
    agora: () => agora,
    agendar: (fn, ms) => { agendados.push({ quando: agora + ms + 1, fn }); return agendados.length; },
    cancelar: () => {},
    bytesPorSegundo: () => 2_000_000,
    enviar: item => saidas.push({ em: agora, bytes: item.bytes.length })
  });
  for (let i = 0; i < 100; i++) ritmador.enfileirar({ bytes: new Uint8Array(7200) });
  while (agendados.length) {
    agendados.sort((x, y) => x.quando - y.quando);
    const proximo = agendados.shift();
    agora = proximo.quando;
    proximo.fn();
  }
  const bytesPorSegundo = (99 * 7200) / (saidas[99].em - saidas[0].em) * 1000;
  assert.ok(bytesPorSegundo > 1_900_000, `vazão de ${Math.round(bytesPorSegundo)} B/s com a taxa em 2 000 000`);
  const porInstante = new Map();
  for (const s of saidas) porInstante.set(s.em, (porInstante.get(s.em) || 0) + 1);
  assert.ok(Math.max(...porInstante.values()) <= 2, 'no máximo dois pedaços no mesmo instante');

  // Depois de um tempo parado, o primeiro pedaço do quadro seguinte sai sozinho.
  agora += 1000;
  saidas.length = 0;
  ritmador.enfileirar({ bytes: new Uint8Array(7200) });
  ritmador.enfileirar({ bytes: new Uint8Array(7200) });
  assert.equal(saidas.length, 1, 'o balde parado guarda um pedaço, e não dois');
});

// ---------- As mensagens ----------

test('as mensagens de controle vão e voltam, e o tipo não pode ser sobrescrito por um campo', () => {
  const ida = Quadro.mensagem('ping', { enviadoEm: 123.5 });
  assert.deepEqual(Quadro.lerMensagem(ida), { enviadoEm: 123.5, tipo: 'ping' });
  assert.deepEqual(Quadro.lerMensagem(Quadro.mensagem('cap', { dec: ['h264', 'h264', 'av1'], recebe: true, pergunta: true })),
    { dec: ['h264'], recebe: true, pergunta: true, tipo: 'cap' }, 'codec desconhecido e repetido saem');
  assert.deepEqual(Quadro.lerMensagem(Quadro.mensagem('reenvio', { camada: 'alta', geracao: 2, de: 10, ate: 12 })),
    { camada: 'alta', geracao: 2, de: 10, ate: 12, tipo: 'reenvio' });
  assert.equal(Quadro.lerMensagem(Quadro.mensagem('fim')).tipo, 'fim');
  const relato = Quadro.lerMensagem(Quadro.mensagem('relato', { camada: 'baixa', recebidos: 30, perdidos: -4, atrasoMs: 'muito' }));
  assert.equal(relato.perdidos, 0, 'número negativo vira zero');
  assert.equal(relato.atrasoMs, null, 'atraso inválido é "não sei", não um número inventado');
});

test('mensagem malformada, de tipo desconhecido ou fora dos limites é ignorada', () => {
  const texto = obj => new TextEncoder().encode(JSON.stringify(obj));
  assert.equal(Quadro.lerMensagem(texto({ v: 1, tipo: 'apagar-tudo' })), null);
  assert.equal(Quadro.lerMensagem(texto({ v: 1, tipo: '__proto__' })), null);
  assert.equal(Quadro.lerMensagem(texto({ v: 2, tipo: 'fim' })), null, 'versão desconhecida');
  assert.equal(Quadro.lerMensagem(texto({ v: 1, tipo: 'quero', camada: 'gigante' })), null);
  assert.equal(Quadro.lerMensagem(texto({ v: 1, tipo: 'reenvio', camada: 'alta', geracao: 1, de: 0, ate: 500 })), null, 'reenvio grande demais');
  assert.equal(Quadro.lerMensagem(texto({ v: 1, tipo: 'reenvio', camada: 'alta', geracao: 1, de: 9, ate: 3 })), null, 'intervalo invertido');
  assert.equal(Quadro.lerMensagem(new TextEncoder().encode('{nao é json')), null);
  assert.equal(Quadro.lerMensagem(new Uint8Array(4096)), null, 'grande demais');
  assert.throws(() => Quadro.mensagem('inventada'));
});

// ---------- Por qual caminho a tela vai ----------

const comPlaca = { captura: true, h264Hardware: true, h264: true, vp8: true };
const semPlaca = { captura: true, h264Hardware: false, h264: true, vp8: true };
const quemRecebe = (nome, dec = ['h264', 'vp8']) => ({ nome, cap: { dec, recebe: true }, chegouEm: 0 });
const base = { telaNoAr: true, desligadoPeloServidor: false, preferencia: 'automatico', envio: comPlaca, participantes: [quemRecebe('Bia')], versaoDoServidor: '1.13.7', agora: 100000 };

test('automático com placa, servidor novo e a sala inteira recebendo: caminho novo em H.264', () => {
  const decisao = Decisoes.decidirModo(base);
  assert.deepEqual([decisao.modo, decisao.codec], ['webcodecs', 'h264']);
  assert.match(decisao.motivo, /placa de vídeo/);
  assert.equal(Decisoes.decidirModo({ ...base, participantes: [] }).modo, 'webcodecs', 'sala vazia não impede (nada é codificado até alguém assistir)');
});

test('cada motivo de ficar no caminho de hoje é dito, na ordem do que a pessoa pode resolver', () => {
  const motivo = mudanca => Decisoes.decidirModo({ ...base, ...mudanca });
  assert.match(motivo({ desligadoPeloServidor: true }).motivo, /servidor para todo mundo/);
  assert.match(motivo({ preferencia: 'desligada' }).motivo, /desligado por você/);
  assert.match(motivo({ falha: 'o codificador falhou' }).motivo, /codificador falhou/);
  assert.match(motivo({ envio: semPlaca }).motivo, /placa de vídeo/);
  assert.match(motivo({ envio: { ...comPlaca, captura: false } }).motivo, /quadros da tela/);
  assert.match(motivo({ versaoDoServidor: '1.13.6' }).motivo, /1\.13\.7/, 'a 1.13.6 trava com faixas de dados');
  assert.match(motivo({ envio: semPlaca, versaoDoServidor: '1.13.6' }).motivo, /placa de vídeo/, 'sem placa, a versão nem entra em questão');
  for (const m of [{ desligadoPeloServidor: true }, { preferencia: 'desligada' }, { envio: semPlaca }, { versaoDoServidor: '1.13.6' }]) {
    assert.equal(motivo(m).modo, 'rtp');
  }
});

test('"sempre ligada" aceita o processador e o servidor antigo, mas não passa por cima do servidor desligado', () => {
  const sempre = { ...base, preferencia: 'sempre', envio: semPlaca, versaoDoServidor: '1.13.6' };
  const decisao = Decisoes.decidirModo(sempre);
  assert.deepEqual([decisao.modo, decisao.codec], ['webcodecs', 'h264']);
  assert.match(decisao.motivo, /processador/);
  assert.equal(Decisoes.decidirModo({ ...sempre, desligadoPeloServidor: true }).modo, 'rtp');
  // Sem H.264 nenhum, o VP8 serve ao diagnóstico -- e só ali.
  assert.equal(Decisoes.decidirModo({ ...sempre, envio: { captura: true, h264: false, vp8: true } }).codec, 'vp8');
  assert.equal(Decisoes.decidirModo({ ...base, envio: { captura: true, h264Hardware: false, h264: false, vp8: true } }).modo, 'rtp', 'o automático nunca usa VP8');
});

test('tudo ou nada: basta uma pessoa que não recebe para a tela inteira ir pelo caminho de hoje', () => {
  const com = pessoa => Decisoes.decidirModo({ ...base, participantes: [quemRecebe('Bia'), pessoa] });
  assert.match(com({ nome: 'Caio', cap: { dec: ['h264'], recebe: false }, chegouEm: 0 }).motivo, /Caio não pode receber/);
  assert.match(com(quemRecebe('Davi', ['vp8'])).motivo, /Davi não decodifica H\.264/);
  assert.match(com({ nome: 'Eva', cap: null, chegouEm: 0 }).motivo, /Eva está numa versão/);
});

test('o codec escolhido é o que TODO mundo decodifica, H.264 primeiro', () => {
  const sempre = { ...base, preferencia: 'sempre', envio: semPlaca };
  assert.equal(Decisoes.decidirModo({ ...sempre, participantes: [quemRecebe('Bia'), quemRecebe('Caio', ['vp8'])] }).codec, 'vp8');
  assert.equal(Decisoes.decidirModo({ ...sempre, participantes: [quemRecebe('Bia', ['h264'])] }).codec, 'h264');
});

test('quem acabou de entrar tem uma folga para se apresentar, e a decisão não pisca por causa dele', () => {
  const recemChegado = { nome: 'Fábio', cap: null, chegouEm: base.agora - 1000 };
  const noCaminhoNovo = Decisoes.decidirModo({ ...base, participantes: [quemRecebe('Bia'), recemChegado], modoAtual: 'webcodecs' });
  assert.equal(noCaminhoNovo.modo, 'webcodecs', 'quem já estava no caminho novo fica');
  assert.equal(noCaminhoNovo.aguardando, true);
  const noDeHoje = Decisoes.decidirModo({ ...base, participantes: [recemChegado], modoAtual: 'rtp' });
  assert.deepEqual([noDeHoje.modo, noDeHoje.aguardando], ['rtp', true], 'quem estava no de hoje não sobe no escuro');
  const passouAFolga = Decisoes.decidirModo({ ...base, participantes: [{ ...recemChegado, chegouEm: base.agora - Decisoes.MS_DE_FOLGA_PARA_SE_APRESENTAR - 1 }], modoAtual: 'webcodecs' });
  assert.equal(passouAFolga.modo, 'rtp', 'calado depois da folga conta como quem não recebe');
});

test('a versão do servidor é comparada por número, não por texto', () => {
  assert.equal(Decisoes.servidorConfiavel('1.13.7'), true);
  assert.equal(Decisoes.servidorConfiavel('1.13.10'), true);
  assert.equal(Decisoes.servidorConfiavel('1.14.0'), true);
  assert.equal(Decisoes.servidorConfiavel('2.0.0'), true);
  assert.equal(Decisoes.servidorConfiavel('1.13.6'), false);
  assert.equal(Decisoes.servidorConfiavel('1.9.99'), false);
  assert.equal(Decisoes.servidorConfiavel(''), false);
  assert.equal(Decisoes.servidorConfiavel(null), false);
});

// ---------- Como uma camada cede ----------

const alvo1080 = { largura: 1920, altura: 1080, quadros: 60, bitrateMax: 6_000_000, bitrateMin: 300_000 };
const fonte1080 = { largura: 1920, altura: 1080 };
const iniciar = (prioridade = 'fluidez') => Decisoes.iniciarCamada({ fonte: fonte1080, alvo: alvo1080, prioridade, tetoPara: RoomQuality.tetoDeEnvio });
const passar = (estado, sinais, vezes = 1) => {
  for (let i = 0; i < vezes; i++) estado = Decisoes.ajustarCamada(estado, sinais, RoomQuality.tetoDeEnvio);
  return estado;
};

test('a camada começa no alvo, sem subir aos poucos', () => {
  const estado = iniciar();
  assert.deepEqual([estado.largura, estado.altura, estado.quadros, estado.escala], [1920, 1080, 60, 1]);
  assert.equal(estado.bitrate, RoomQuality.tetoDeEnvio(1920, 1080, 60));
});

test('movimento: com a saída apertada o orçamento cai, e a resolução cede antes dos quadros', () => {
  const apertado = passar(iniciar(), { saidaApertada: true }, 12);
  assert.equal(apertado.quadros, 60, 'os quadros não cedem');
  assert.ok(apertado.altura < 1080, `a imagem encolheu (${apertado.altura}p)`);
  assert.ok(apertado.altura >= 360, 'e não passa do degrau de 360p');
  assert.ok(apertado.bitrate < alvo1080.bitrateMax);
  assert.ok(apertado.bitrate >= alvo1080.bitrateMin);
  assert.equal(apertado.largura % 2 + apertado.altura % 2, 0, 'dimensões pares, como o H.264 exige');
});

test('nitidez: com a saída apertada são os quadros que cedem, e a resolução fica', () => {
  const apertado = passar(iniciar('nitidez'), { saidaApertada: true }, 12);
  assert.equal(apertado.altura, 1080);
  assert.ok(apertado.quadros < 60, `os quadros cederam (${apertado.quadros})`);
});

test('codificador apertado troca a resolução direto, sem esperar a banda', () => {
  const um = passar(iniciar(), { codificadorApertado: true });
  assert.equal(um.escala, 1, 'uma amostra só não basta: rajada de troca de cena não é saturação');
  const dois = passar(um, { codificadorApertado: true });
  assert.ok(dois.escala > 1);
  assert.equal(dois.ultimaMudanca, 'codificador');
});

test('a perda relatada por quem assiste aperta como a saída apertada', () => {
  const comPerda = passar(iniciar(), { perda: 0.2 }, 3);
  assert.ok(comPerda.bitrate < iniciar().bitrate);
  const perdaPequena = passar(iniciar(), { perda: 0.01 }, 3);
  assert.equal(perdaPequena.bitrate, iniciar().bitrate, 'perda pontual não corta nada');
});

test('descer é rápido, subir espera: a resolução só volta depois de um tempo de folga', () => {
  let estado = passar(iniciar(), { saidaApertada: true }, 12);
  const encolhido = estado.altura;
  estado = passar(estado, {}, Decisoes.SEGUNDOS_PARA_SUBIR_DE_DEGRAU - 1);
  assert.equal(estado.altura, encolhido, 'antes da espera, não sobe');
  estado = passar(estado, {}, 90);
  assert.equal(estado.altura, 1080, 'com folga contínua, volta ao tamanho cheio');
});

test('fonte maior que o alvo começa encaixada no alvo, sem distorcer', () => {
  assert.deepEqual(Decisoes.caberNaCaixa({ largura: 2560, altura: 1440 }, { largura: 1920, altura: 1080 }), { largura: 1920, altura: 1080 });
  assert.deepEqual(Decisoes.caberNaCaixa({ largura: 3440, altura: 1440 }, { largura: 640, altura: 360 }), { largura: 640, altura: 268 });
  assert.deepEqual(Decisoes.caberNaCaixa({ largura: 800, altura: 600 }, { largura: 1920, altura: 1080 }), { largura: 800, altura: 600 }, 'menor não é esticado');
});

// ---------- O que a placa aceita ----------

test('se a placa recusa o pedido, a escada desce ainda na placa, pelo lado que a prioridade manda ceder', () => {
  const texto = degraus => degraus.map(d => `${d.largura}x${d.altura}@${d.quadros}`);
  const pedido = { largura: 2560, altura: 1440, quadros: 60 };
  assert.deepEqual(texto(Decisoes.degrausDaPlaca(pedido, 'fluidez')),
    ['2560x1440@60', '1920x1080@60', '1280x720@60', '2560x1440@30', '1920x1080@30', '1280x720@30'],
    'movimento: a resolução cede antes dos quadros');
  assert.deepEqual(texto(Decisoes.degrausDaPlaca(pedido, 'nitidez')),
    ['2560x1440@60', '2560x1440@30', '1920x1080@30', '1280x720@30'],
    'nitidez: os quadros cedem antes da resolução');
  assert.deepEqual(texto(Decisoes.degrausDaPlaca({ largura: 1280, altura: 720, quadros: 30 }, 'fluidez')), ['1280x720@30'], 'nada abaixo de 720p a 30');
});

// ---------- Que camada o espectador pede ----------

test('o espectador pede a camada do lugar, e cai para a leve por um tempo quando a rede aperta', () => {
  const agora = 1_000_000;
  assert.equal(Decisoes.camadaDoEspectador({}, { pedida: 'alta', agora }).camada, 'alta');
  assert.equal(Decisoes.camadaDoEspectador({}, { pedida: 'baixa', agora }).camada, 'baixa');
  const rebaixada = Decisoes.camadaDoEspectador({}, { pedida: 'alta', perda: 0.2, agora });
  assert.equal(rebaixada.camada, 'baixa');
  assert.equal(Decisoes.camadaDoEspectador(rebaixada, { pedida: 'alta', agora: agora + 5000 }).camada, 'baixa', 'a melhora não é aceita na hora');
  assert.equal(Decisoes.camadaDoEspectador(rebaixada, { pedida: 'alta', agora: agora + Decisoes.MS_REBAIXADO + 1 }).camada, 'alta');
  assert.equal(Decisoes.camadaDoEspectador({}, { pedida: 'alta', pedidosDeChave: 3, agora }).camada, 'baixa', 'buracos em série também rebaixam');
});

// ---------- O nome do codec ----------

test('o nível do H.264 é o menor que cabe no tamanho e na taxa', () => {
  assert.equal(Decisoes.nivelH264(1280, 720, 30), 0x1f);
  assert.equal(Decisoes.nivelH264(1280, 720, 60), 0x20);
  assert.equal(Decisoes.nivelH264(1920, 1080, 30), 0x28);
  assert.equal(Decisoes.nivelH264(1920, 1080, 60), 0x2a);
  assert.equal(Decisoes.nivelH264(2560, 1440, 30), 0x32);
  assert.equal(Decisoes.nivelH264(2560, 1440, 60), 0x33);
  assert.deepEqual(Decisoes.codecsH264(1920, 1080, 60).map(c => c.codec), ['avc1.64002A', 'avc1.4D002A', 'avc1.42E02A']);
});

// ---------- A chave do servidor ----------

function pastaTemporaria(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-chave-webcodecs-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  return pasta;
}

test('a chave começa liberada, é guardada, sobrevive a um reinício e avisa quando muda', t => {
  const pasta = pastaTemporaria(t);
  const avisos = [];
  const chave = criarChaveDeWebCodecs({ pasta, ambiente: '', aoMudar: estado => avisos.push(estado.ligado) });
  assert.deepEqual(chave.estado(), { ligado: true, origem: 'padrao', em: null });
  assert.equal(chave.definir(false).ok, true);
  assert.equal(chave.ligado(), false);
  assert.equal(chave.definir(false).ok, true);
  assert.deepEqual(avisos, [false], 'repetir o mesmo valor não avisa de novo');
  const depoisDoReinicio = criarChaveDeWebCodecs({ pasta, ambiente: '' });
  assert.equal(depoisDoReinicio.estado().ligado, false);
  assert.equal(depoisDoReinicio.estado().origem, 'painel');
  assert.equal(chave.definir('sim').ok, false, 'só booleano');
});

test('a variável de ambiente vence o que o painel guardou, e o painel não consegue mudá-la', t => {
  const pasta = pastaTemporaria(t);
  criarChaveDeWebCodecs({ pasta, ambiente: '' }).definir(true);
  const fixada = criarChaveDeWebCodecs({ pasta, ambiente: '0' });
  assert.deepEqual(fixada.estado(), { ligado: false, origem: 'ambiente', em: null });
  const tentativa = fixada.definir(true);
  assert.equal(tentativa.ok, false);
  assert.equal(tentativa.status, 409);
  assert.equal(criarChaveDeWebCodecs({ pasta, ambiente: '1' }).ligado(), true);
});

// A chave indo no `sala-config` precisa do servidor de mídia no ar, e por isso é conferida no
// teste de navegador (quem entra depois de desligar já recebe `webcodecs: false`).
test('o painel muda a chave só com sessão e CSRF', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const origem = servidor.origem;
  assert.equal((await fetch(origem + '/painel/api/midia')).status, 401, 'sem sessão do painel, nada');
  const login = await fetch(origem + '/painel/entrar', { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await servidor.chave() }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await (await fetch(origem + '/painel/api/sessao', { headers: { Cookie: cookie } })).json();
  assert.deepEqual((await (await fetch(origem + '/painel/api/midia', { headers: { Cookie: cookie } })).json()).webcodecs, { ligado: true, origem: 'padrao', em: null });
  const semCsrf = await fetch(origem + '/painel/api/midia', { method: 'POST', headers: { Cookie: cookie, Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ webcodecs: false }) });
  assert.notEqual(semCsrf.status, 200, 'sem CSRF, nada muda');
  const desligar = await fetch(origem + '/painel/api/midia', { method: 'POST', headers: { Cookie: cookie, Origin: origem, 'X-Nexo-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ webcodecs: false }) });
  assert.equal(desligar.status, 200);
  assert.equal((await desligar.json()).webcodecs.ligado, false);
  const invalido = await fetch(origem + '/painel/api/midia', { method: 'POST', headers: { Cookie: cookie, Origin: origem, 'X-Nexo-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ webcodecs: 'talvez' }) });
  assert.equal(invalido.status, 400);
});
