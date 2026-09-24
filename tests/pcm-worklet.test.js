const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { ReprodutorPcm } = require('../public/pcm-worklet.js');

const FE = 44100;
const BLOCO = 441;
const AMPLITUDE = 20000;

function aleatorio(semente) {
  let s = semente;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function blocoSenoidal(freq, primeiro, quadros = BLOCO) {
  const buffer = new ArrayBuffer(quadros * 4);
  const vista = new DataView(buffer);
  for (let i = 0; i < quadros; i++) {
    const s = Math.round(Math.sin(2 * Math.PI * freq * (primeiro + i) / FE) * AMPLITUDE);
    vista.setInt16(i * 4, s, true);
    vista.setInt16(i * 4 + 2, -s, true);
  }
  return buffer;
}

// Dois relógios: o produtor faz um bloco de 10 ms a cada 10 ms DO RELÓGIO DELE (que anda
// `deriva` mais rápido), e cada bloco chega depois de `atraso()` segundos, na ordem -- como
// num TCP. A saída pede 128 quadros por vez no relógio dela.
function simular({ segundos, deriva = 0, atraso = () => 0.001, pausa = null, taxaSaida = FE, freq = 1000, antes = null, depois = null, entrega = null }) {
  const reprodutor = new ReprodutorPcm({ taxaEntrada: FE, taxaSaida });
  const esquerda = new Float32Array(128), direita = new Float32Array(128);
  const fila = [];
  let produzidos = 0, chegadaAnterior = 0, proxima = 0, saida = 0;
  const porSegundo = [];
  while (saida < segundos * taxaSaida) {
    const agora = saida / taxaSaida;
    while (proxima <= agora + 0.5) {
      if (!(pausa && proxima >= pausa[0] && proxima < pausa[1])) {
        const chegada = Math.max(chegadaAnterior, proxima + atraso(proxima));
        chegadaAnterior = chegada;
        fila.push([chegada, blocoSenoidal(freq, produzidos)]);
      }
      produzidos += BLOCO;
      proxima = produzidos / FE / (1 + deriva);
    }
    while (fila.length && fila[0][0] <= agora) {
      const buffer = fila.shift()[1];
      if (entrega) entrega(reprodutor, buffer); else reprodutor.receber(buffer);
    }
    const contexto = antes?.(reprodutor, agora);
    reprodutor.produzir(esquerda, direita);
    depois?.(esquerda, direita, agora, contexto);
    saida += 128;
    if (saida % taxaSaida < 128) porSegundo.push(reprodutor.estatisticas());
  }
  return { reprodutor, porSegundo, final: reprodutor.estatisticas() };
}

const depoisDe = (porSegundo, segundo, campo) => porSegundo.at(-1)[campo] - porSegundo[segundo][campo];

test('com os relógios iguais, o som sai sem buraco e com a fila no mínimo', () => {
  const { final, porSegundo } = simular({ segundos: 60 });
  assert.equal(final.buracos, 0);
  assert.equal(final.saltos, 0);
  // A fila é o atraso do som em relação à imagem: tem de ficar no nível do reprodutor
  // anterior (10 a 20 ms), não acima dele.
  assert.ok(porSegundo.slice(20).every(e => e.nivelMs <= 12), `fila: ${porSegundo.slice(20).map(e => e.nivelMs)}`);
  assert.ok(Math.abs(final.relogioPpm) <= 5, `velocidade: ${final.relogioPpm} ppm`);
});

test('qualquer deriva de cristal é absorvida sem buraco, sem pulo e sem fila maior', () => {
  // Cristais ficam em ±100 ppm; ±3000 é o triplo do pior caso razoável, e ainda assim cabe.
  for (const ppm of [100, -100, 1000, -1000, 3000, -3000]) {
    const { final, porSegundo } = simular({ segundos: 200, deriva: ppm * 1e-6 });
    assert.equal(depoisDe(porSegundo, 60, 'buracos'), 0, `${ppm} ppm: buracos depois do primeiro minuto`);
    assert.equal(final.saltos, 0, `${ppm} ppm: saltos`);
    assert.ok(Math.abs(final.relogioPpm - ppm) <= Math.max(30, Math.abs(ppm) * 0.03), `${ppm} ppm: aprendeu ${final.relogioPpm}`);
    assert.ok(final.nivelMs <= 15, `${ppm} ppm: fila de ${final.nivelMs} ms`);
  }
});

test('uma taxa de amostragem errada é medida pela chegada e corrigida em segundos', () => {
  for (const divergencia of [0.088, -0.02]) {
    const { final, porSegundo } = simular({ segundos: 150, deriva: divergencia });
    assert.ok(final.correcoesGrosseiras >= 1);
    assert.ok(Math.abs(final.relogioPpm / 1e6 - divergencia) < 0.001, `${divergencia}: aprendeu ${final.relogioPpm} ppm`);
    assert.equal(depoisDe(porSegundo, 100, 'buracos'), 0);
    assert.ok(final.nivelMs <= 20, `${divergencia}: fila de ${final.nivelMs} ms`);
  }
});

test('entrega irregular aumenta a folga só o necessário, e ela volta a encolher', () => {
  const sorteio = aleatorio(7);
  const { porSegundo } = simular({ segundos: 240, deriva: -300e-6, atraso: t => t < 90 ? sorteio() * 0.04 : 0.001 });
  const buracosEntre = (de, ate) => porSegundo[ate].buracos - porSegundo[de].buracos;
  assert.equal(buracosEntre(45, 89), 0, 'buracos com a entrega irregular, depois de aprender');
  assert.equal(buracosEntre(90, porSegundo.length - 1), 0, 'buracos depois que a entrega normalizou');
  const filaIrregular = porSegundo[85].nivelMs;
  const filaNormal = porSegundo.at(-1).nivelMs;
  assert.ok(filaIrregular >= 25, `a fila precisa crescer com o atraso irregular (${filaIrregular} ms)`);
  assert.ok(filaNormal < filaIrregular / 2, `e encolher depois (${filaIrregular} -> ${filaNormal} ms)`);
});

test('uma pausa da fonte não vira correção de relógio nem ensina folga', () => {
  const { final, porSegundo } = simular({ segundos: 120, deriva: -100e-6, pausa: [40, 45] });
  assert.equal(final.correcoesGrosseiras, 0);
  assert.ok(Math.abs(final.relogioPpm + 100) <= 30, `aprendeu ${final.relogioPpm} ppm`);
  assert.equal(final.alvoMs, 5);
  assert.equal(depoisDe(porSegundo, 50, 'buracos'), 0);
});

test('saída noutra taxa (48 kHz) é convertida sem buraco e na frequência certa', () => {
  let cruzamentos = 0, anterior = 0, contados = 0;
  const { final } = simular({
    segundos: 40, taxaSaida: 48000, deriva: 50e-6,
    depois: (esquerda, _d, agora) => {
      if (agora < 20) return;
      for (let i = 0; i < 128; i++) { if (anterior < 0 && esquerda[i] >= 0) cruzamentos++; anterior = esquerda[i]; contados++; }
    }
  });
  assert.equal(final.buracos, 0);
  // 1 kHz no relógio do produtor, que anda 50 ppm mais rápido.
  const hz = cruzamentos / (contados / 48000);
  assert.ok(Math.abs(hz - 1000.05) < 0.5, `${hz} Hz`);
});

test('o interpolador fica 70 dB abaixo do sinal até 15 kHz, com a posição fracionária variando', () => {
  for (const freq of [1000, 10000, 15000]) {
    let sinal = 0, erro = 0;
    simular({
      segundos: 30, deriva: 300e-6, freq,
      // Compara cada amostra com o valor exato do tom na posição fracionária que foi lida. A
      // velocidade só muda entre quanta, então as posições de um quantum são conhecidas antes.
      antes: (r, agora) => (agora >= 15 && r.tocando && r.ganho === 1 && !r.passoGanho
        ? { inicio: r.posicao, passo: r.passoNominal * r.razao, r } : null),
      depois: (esquerda, direita, _agora, contexto) => {
        if (!contexto || !contexto.r.tocando) return;
        for (let i = 0; i < 128; i++) {
          const ideal = AMPLITUDE / 32768 * Math.sin(2 * Math.PI * freq * (contexto.inicio + i * contexto.passo) / FE);
          sinal += 2 * ideal * ideal;
          erro += (esquerda[i] - ideal) ** 2 + (direita[i] + ideal) ** 2;
        }
      }
    });
    const db = 10 * Math.log10(sinal / erro);
    assert.ok(db > 68, `${freq} Hz: erro ${db.toFixed(1)} dB abaixo do sinal`);
  }
});

test('quadro partido entre mensagens toca igual ao inteiro', () => {
  const capturar = entrega => {
    const saida = [];
    simular({ segundos: 3, entrega, depois: e => { saida.push(...e); } });
    return saida;
  };
  const inteiro = capturar(null);
  const partido = capturar((r, buffer) => {
    const bytes = new Uint8Array(buffer);
    // Cortes em posições que não caem em fronteira de quadro nem de amostra.
    for (const [de, ate] of [[0, 7], [7, 7], [7, 1001], [1001, 1002], [1002, bytes.length]]) r.receber(bytes.slice(de, ate).buffer);
  });
  assert.deepEqual(partido, inteiro);
});

test('secar desce em rampa e voltar sobe em rampa: nenhum degrau no som', () => {
  let maiorSalto = 0, anterior = null;
  const { final } = simular({
    segundos: 20, freq: 50, pausa: [8, 8.2],
    depois: esquerda => {
      for (let i = 0; i < 128; i++) {
        if (anterior !== null) maiorSalto = Math.max(maiorSalto, Math.abs(esquerda[i] - anterior));
        anterior = esquerda[i];
      }
    }
  });
  assert.equal(final.buracos, 1);
  // Um tom de 50 Hz anda no máximo ~0,004 por amostra; um degrau seria da ordem de 0,6.
  assert.ok(maiorSalto < 0.05, `maior variação entre amostras: ${maiorSalto}`);
});

test('uma rajada que traz atraso demais pula de volta ao alvo, em rampa', () => {
  let maiorSalto = 0, anterior = null;
  const { final, porSegundo } = simular({
    segundos: 30, freq: 50,
    // A página ficou parada meio segundo e entregou tudo de uma vez.
    atraso: t => (t > 10 && t < 10.5 ? 10.5 - t : 0.001),
    depois: esquerda => {
      for (let i = 0; i < 128; i++) {
        if (anterior !== null) maiorSalto = Math.max(maiorSalto, Math.abs(esquerda[i] - anterior));
        anterior = esquerda[i];
      }
    }
  });
  assert.ok(final.saltos >= 1);
  assert.ok(porSegundo.at(-1).nivelMs <= 40, `fila depois da rajada: ${porSegundo.at(-1).nivelMs} ms`);
  assert.ok(maiorSalto < 0.05, `maior variação entre amostras: ${maiorSalto}`);
});

test('custa uma fração pequena de um núcleo', () => {
  const inicio = performance.now();
  simular({ segundos: 60, deriva: 200e-6 });
  const decorrido = performance.now() - inicio;
  // Inclui gerar o tom de entrada. Tempo real seria 60 000 ms.
  assert.ok(decorrido < 3000, `60 s de som em ${decorrido.toFixed(0)} ms`);
});

test('o processador registra "pcm-player", troca de porta direta e relata a cada dois segundos', () => {
  let Processador, nome;
  const fonte = fs.readFileSync(path.join(__dirname, '../public/pcm-worklet.js'), 'utf8');
  vm.runInNewContext(fonte, {
    sampleRate: FE, Float32Array, Float64Array, Uint8Array, DataView, ArrayBuffer, Math, Object,
    AudioWorkletProcessor: class { constructor() { this.port = { mensagens: [], postMessage(m) { this.mensagens.push(m); } }; } },
    registerProcessor: (n, classe) => { nome = n; Processador = classe; }
  });
  assert.equal(nome, 'pcm-player');
  const processador = new Processador({ processorOptions: { taxaEntrada: FE } });
  const porta = () => ({ fechada: false, close() { this.fechada = true; } });
  const primeira = porta(), segunda = porta();
  processador.port.onmessage({ data: { porta: primeira } });
  processador.port.onmessage({ data: { porta: segunda } });
  assert.equal(primeira.fechada, true, 'a porta anterior é fechada');
  const saidas = [[new Float32Array(128), new Float32Array(128)]];
  for (let bloco = 0; bloco < 700; bloco++) {
    if (bloco % 3 === 0) segunda.onmessage({ data: blocoSenoidal(1000, bloco / 3 * 384, 384) });
    assert.equal(processador.process([], saidas), true);
  }
  const relatos = processador.port.mensagens.filter(m => m.estatisticas);
  assert.equal(relatos.length, 1);
  assert.equal(relatos[0].estatisticas.tocando, true);
  assert.ok(saidas[0][0].some(x => x !== 0));
});
