'use strict';

// Reprodutor do som que o agente nativo captura: PCM de 16 bits, estéreo, 44,1 kHz, em blocos
// de ~10 ms. Ele chega pela conexão direta com o agente ou pelo servidor da sala e sai no
// relógio deste AudioContext, rumo à faixa que a sala publica.
//
// São dois relógios -- o da captura do Windows e o da saída do navegador -- e nenhum dos dois
// é exato. O reprodutor anterior guardava 10 a 20 ms e não corrigia nada: com uma diferença de
// poucas dezenas de ppm a folga acabava em minutos e o som passava a picotar sem parar. Era o
// "chiado depois de vários minutos" (medido: 243 buracos em dois minutos). Este aqui:
//
//   - mede a folga pelo PIOR momento de uma janela de três segundos, não pela média: é o pior
//     momento que vira buraco, e todo o resto da fila é atraso do som em relação à imagem --
//     o carimbo de tempo do WebRTC é dado DEPOIS daqui, e quem assiste não tem como descontar;
//   - segura esse pior momento num alvo pequeno ajustando a velocidade de leitura. A parte
//     rápida do ajuste fica em no máximo 0,1%, abaixo do que o ouvido percebe; a lenta
//     (integral) aprende a diferença entre os relógios, seja ela qual for, e uma diferença
//     grosseira é medida direto pela chegada e corrigida de uma vez;
//   - lê em posição fracionária com um interpolador sinc de 16 pontos -- plano até 17 kHz em
//     qualquer posição, e devolve a amostra exata quando não há ajuste. Interpolação linear
//     abafaria os agudos em até 2,4 dB a 10 kHz, oscilando com a posição;
//   - quando seca, desce em rampa e só volta com folga para absorver um atraso como o que
//     acabou de acontecer: um silêncio curto, em vez de dezenas de picotes;
//   - quando uma rajada traz atraso demais, pula de volta ao alvo, também em rampa.
//
// Nada é alocado no laço de áudio: coleta de lixo na thread de áudio também vira buraco.

const TAPS = 16;
const MEIO = TAPS / 2;
const FASES = 256;
// Medido contra o valor exato do tom na posição lida, com deriva: o erro fica 72 dB abaixo do
// sinal de 1 a 15 kHz. β menor piora os graves; maior, os agudos.
const BETA_KAISER = 6;
// Três segundos de 44,1 kHz cabem com folga; potência de dois para indexar com máscara.
const CAPACIDADE = 1 << 17;
const MASCARA = CAPACIDADE - 1;

const ALVO_BASE_S = 0.005;
const ALVO_MAXIMO_S = 0.25;
// Um bloco do agente (10 ms) e um pouco: menos que isso e a volta de um buraco já nasce
// devendo o próximo bloco.
const RETOMADA_S = 0.012;
const EXCESSO_MAXIMO_S = 0.15;
const PAUSA_DA_FONTE_S = 0.3;
const AUMENTO_MAXIMO_POR_BURACO_S = 0.02;
const RAMPA_S = 0.003;

const BALDE_S = 0.5;
const BALDES_NA_JANELA = 6;
const BALDES_PARA_ESTIMAR = 60;
const KP = 0.2;
const KI = 0.01;
const LIMITE_P = 0.001;
const LIMITE_I = 0.1;
const ERRO_INTEGRADO_MAXIMO_S = 0.02;
const DIVERGENCIA_GROSSEIRA = 0.005;
const SEGUNDOS_PARA_ALIVIAR_O_ALVO = 15;
const ALIVIO_DO_ALVO = 0.85;

function besselI0(x) {
  let soma = 1, termo = 1;
  for (let k = 1; k < 40; k++) { termo *= (x / 2 / k) ** 2; soma += termo; }
  return soma;
}

// Uma linha por posição fracionária (FASES + 1, para interpolar até a borda), cada uma
// normalizada para ganho 1 em DC: sem isso o volume oscilaria de leve com a posição.
function tabelaSinc() {
  const tabela = new Float32Array((FASES + 1) * TAPS);
  const pesos = new Float64Array(TAPS);
  for (let f = 0; f <= FASES; f++) {
    let soma = 0;
    for (let j = 0; j < TAPS; j++) {
      const x = (j - MEIO + 1) - f / FASES;
      const u = x / MEIO;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      pesos[j] = Math.abs(u) >= 1 ? 0 : sinc * besselI0(BETA_KAISER * Math.sqrt(1 - u * u)) / besselI0(BETA_KAISER);
      soma += pesos[j];
    }
    for (let j = 0; j < TAPS; j++) tabela[f * TAPS + j] = pesos[j] / soma;
  }
  return tabela;
}

const TABELA = tabelaSinc();
const ehArrayBuffer = valor => Object.prototype.toString.call(valor) === '[object ArrayBuffer]';

class ReprodutorPcm {
  constructor({ taxaEntrada, taxaSaida }) {
    this.taxaEntrada = taxaEntrada;
    this.taxaSaida = taxaSaida;
    this.passoNominal = taxaEntrada / taxaSaida;
    this.esquerda = new Float32Array(CAPACIDADE);
    this.direita = new Float32Array(CAPACIDADE);
    // Em quadros de entrada: `escrito` é inteiro, `posicao` é fracionária.
    this.escrito = 0;
    this.posicao = 0;
    this.resto = new Uint8Array(4);
    this.restoTamanho = 0;
    this.restoVista = new DataView(this.resto.buffer);

    this.tocando = false;
    this.ganho = 0;
    this.passoGanho = 0;
    this.pular = false;
    this.rampa = Math.max(1, Math.round(RAMPA_S * taxaSaida));
    this.caudaE = 0;
    this.caudaD = 0;
    this.saidaE = 0;
    this.saidaD = 0;

    this.alvo = ALVO_BASE_S;
    this.proporcional = 0;
    this.integral = 0;
    this.erroAnterior = 0;
    this.razao = 1;

    this.saidaTotal = 0;
    this.recebidoTotal = 0;
    this.ultimaChegada = 0;
    this.ultimaPausa = 0;
    this.inicioDoBuraco = 0;
    this.ultimoAlivio = 0;

    this.quadrosPorBalde = Math.round(BALDE_S * taxaSaida);
    this.noBalde = 0;
    this.minimoDoBalde = Infinity;
    this.somaDoBalde = 0;
    this.amostrasDoBalde = 0;
    this.baldeInteiro = true;
    this.minimos = new Float64Array(BALDES_NA_JANELA);
    this.minimosValidos = 0;
    this.historicoSaida = new Float64Array(BALDES_PARA_ESTIMAR);
    this.historicoRecebido = new Float64Array(BALDES_PARA_ESTIMAR);
    this.historicoTamanho = 0;
    this.historicoInicio = 0;
    this.estimativaAnterior = 0;

    this.contagem = { buracos: 0, saltos: 0, silencioS: 0, descartadoS: 0, correcoesGrosseiras: 0 };
    this.nivelMedioS = 0;
    this.folgaS = 0;
  }

  // Quadros de entrada ainda por tocar, descontados os que o interpolador espia à frente.
  disponivel() {
    return this.escrito - this.posicao - MEIO;
  }

  receber(buffer) {
    if (!ehArrayBuffer(buffer) || !buffer.byteLength) return;
    const bytes = new Uint8Array(buffer);
    let inicio = 0;
    // Um quadro pode chegar partido entre duas mensagens: guarda o pedaço até completar.
    if (this.restoTamanho) {
      while (this.restoTamanho < 4 && inicio < bytes.length) this.resto[this.restoTamanho++] = bytes[inicio++];
      if (this.restoTamanho < 4) return;
      this.escrever(this.restoVista.getInt16(0, true), this.restoVista.getInt16(2, true));
      this.restoTamanho = 0;
    }
    const quadros = (bytes.length - inicio) >> 2;
    if (quadros) {
      const vista = new DataView(buffer, inicio, quadros * 4);
      for (let i = 0; i < quadros; i++) this.escrever(vista.getInt16(i * 4, true), vista.getInt16(i * 4 + 2, true));
    }
    for (let i = inicio + quadros * 4; i < bytes.length; i++) this.resto[this.restoTamanho++] = bytes[i];

    if (this.saidaTotal - this.ultimaChegada > PAUSA_DA_FONTE_S * this.taxaSaida) this.ultimaPausa = this.saidaTotal;
    this.ultimaChegada = this.saidaTotal;
    this.recebidoTotal += quadros;
    // A fila circular não pode dar a volta sobre o que ainda não foi tocado. Só acontece se
    // a thread de áudio ficar parada enquanto o som continua chegando.
    if (this.escrito - this.posicao > CAPACIDADE - 4 * TAPS) {
      const novaPosicao = this.escrito - MEIO - Math.round((this.alvo + RETOMADA_S) * this.taxaEntrada);
      this.contagem.descartadoS += (novaPosicao - this.posicao) / this.taxaEntrada;
      this.posicao = novaPosicao;
      this.contagem.saltos++;
    }
  }

  escrever(e, d) {
    const k = this.escrito & MASCARA;
    this.esquerda[k] = e / 32768;
    this.direita[k] = d / 32768;
    this.escrito++;
  }

  interpolar() {
    const base = Math.floor(this.posicao);
    const fase = (this.posicao - base) * FASES;
    const linha = fase | 0;
    const peso = fase - linha;
    const a = linha * TAPS, b = a + TAPS;
    let e = 0, d = 0;
    for (let j = 0; j < TAPS; j++) {
      const w = TABELA[a + j] + (TABELA[b + j] - TABELA[a + j]) * peso;
      const k = (base + j - MEIO + 1) & MASCARA;
      e += this.esquerda[k] * w;
      d += this.direita[k] * w;
    }
    this.saidaE = e;
    this.saidaD = d;
  }

  produzir(esquerda, direita) {
    const n = esquerda.length;
    for (let i = 0; i < n; i++) {
      if (this.tocando) {
        if (this.disponivel() < this.passoNominal * this.razao) this.secar();
      } else if (this.disponivel() >= (this.alvo + RETOMADA_S) * this.taxaEntrada) {
        this.retomar();
      }
      if (!this.tocando) {
        // A cauda desce do último valor tocado até zero em ~1 ms: sem degrau, sem estalo.
        this.caudaE *= 0.97;
        this.caudaD *= 0.97;
        esquerda[i] = this.caudaE;
        direita[i] = this.caudaD;
        this.saidaTotal++;
        continue;
      }
      this.interpolar();
      if (this.passoGanho) {
        this.ganho += this.passoGanho;
        if (this.ganho >= 1) { this.ganho = 1; this.passoGanho = 0; }
        else if (this.ganho <= 0) {
          this.ganho = 0;
          if (this.pular) this.saltarParaOAlvo();
        }
      }
      esquerda[i] = this.saidaE * this.ganho;
      direita[i] = this.saidaD * this.ganho;
      this.caudaE = esquerda[i];
      this.caudaD = direita[i];
      this.posicao += this.passoNominal * this.razao;
      this.saidaTotal++;
    }
    this.contabilizar(n);
  }

  secar() {
    this.tocando = false;
    this.pular = false;
    this.passoGanho = 0;
    this.inicioDoBuraco = this.saidaTotal;
    this.minimosValidos = 0;
    this.contagem.buracos++;
  }

  retomar() {
    const buraco = (this.saidaTotal - this.inicioDoBuraco) / this.taxaSaida;
    // Um buraco curto é atraso de entrega, e diz quanto de folga faltou: passa a guardar isso
    // a mais -- até 20 ms por buraco. Um travamento isolado de 200 ms não pode deixar o som
    // 200 ms atrás da imagem por minutos; um atraso que se repete sobe o alvo a cada vez. Um
    // buraco longo é a fonte que parou de mandar (e voltou), e não ensina nada.
    if (this.contagem.buracos && buraco < PAUSA_DA_FONTE_S) {
      this.alvo = Math.min(ALVO_MAXIMO_S, this.alvo + Math.min(buraco, AUMENTO_MAXIMO_POR_BURACO_S) + 0.002);
      this.contagem.silencioS += buraco;
      this.ultimoAlivio = this.saidaTotal;
    }
    this.tocando = true;
    this.ganho = 0;
    this.passoGanho = 1 / this.rampa;
    // O balde recomeça junto: o que foi medido antes do buraco não vale para a fila de agora.
    this.noBalde = 0;
    this.minimoDoBalde = Infinity;
    this.somaDoBalde = 0;
    this.amostrasDoBalde = 0;
    this.baldeInteiro = true;
  }

  saltarParaOAlvo() {
    const novaPosicao = this.escrito - MEIO - Math.round((this.alvo + RETOMADA_S) * this.taxaEntrada);
    if (novaPosicao > this.posicao) {
      this.contagem.descartadoS += (novaPosicao - this.posicao) / this.taxaEntrada;
      this.posicao = novaPosicao;
    }
    this.pular = false;
    this.passoGanho = 1 / this.rampa;
    this.minimosValidos = 0;
  }

  contabilizar(n) {
    const folga = this.disponivel() / this.taxaEntrada;
    if (this.tocando) {
      if (folga < this.minimoDoBalde) this.minimoDoBalde = folga;
      this.somaDoBalde += folga;
      this.amostrasDoBalde++;
      if (!this.pular && folga > this.alvo + RETOMADA_S + EXCESSO_MAXIMO_S) {
        this.pular = true;
        this.passoGanho = -1 / this.rampa;
        this.contagem.saltos++;
      }
    } else {
      this.baldeInteiro = false;
    }
    this.noBalde += n;
    if (this.noBalde < this.quadrosPorBalde) return;
    this.fecharBalde();
  }

  fecharBalde() {
    // Só balde tocado do começo ao fim ensina alguma coisa. Um balde com buraco (ou parado
    // esperando a fonte) repetiria a medida velha a cada meio segundo, e a integral andaria
    // sozinha durante uma pausa longa.
    if (this.baldeInteiro && this.amostrasDoBalde) {
      this.minimos[this.minimosValidos % BALDES_NA_JANELA] = this.minimoDoBalde;
      this.minimosValidos++;
      this.nivelMedioS = this.somaDoBalde / this.amostrasDoBalde;
      if (this.minimosValidos >= 2) this.ajustarVelocidade();
    }
    this.guardarHistorico();
    this.corrigirDivergenciaGrosseira();
    // Sem buraco por um tempo, o alvo volta ao mínimo em alguns minutos: a folga extra que um
    // atraso ensinou não precisa ficar para sempre, e cada milissegundo dela é som atrasado.
    if (this.alvo > ALVO_BASE_S && this.saidaTotal - this.ultimoAlivio > SEGUNDOS_PARA_ALIVIAR_O_ALVO * this.taxaSaida) {
      this.alvo = ALVO_BASE_S + (this.alvo - ALVO_BASE_S) * ALIVIO_DO_ALVO;
      if (this.alvo - ALVO_BASE_S < 0.0005) this.alvo = ALVO_BASE_S;
      this.ultimoAlivio = this.saidaTotal;
    }
    this.noBalde = 0;
    this.minimoDoBalde = Infinity;
    this.somaDoBalde = 0;
    this.amostrasDoBalde = 0;
    this.baldeInteiro = true;
  }

  ajustarVelocidade() {
    let folgaMinima = Infinity;
    const quantos = Math.min(this.minimosValidos, BALDES_NA_JANELA);
    for (let i = 0; i < quantos; i++) folgaMinima = Math.min(folgaMinima, this.minimos[i]);
    this.folgaS = folgaMinima;
    const erro = folgaMinima - this.alvo;
    const p = Math.max(-LIMITE_P, Math.min(LIMITE_P, KP * erro));
    // A integral é a diferença entre os relógios, e só deve aprender diferença de relógio.
    // Com o proporcional no teto há dois casos: o erro diminuindo é um desnível sendo drenado
    // (a entrega irregular acabou, a fila deu um degrau) -- aprender ali passava do ponto e
    // abria buracos logo depois. O erro parado ou crescendo é deriva maior do que o
    // proporcional alcança -- e aí só a integral chega ao ritmo certo (3000 ppm, por exemplo).
    const saturado = Math.abs(KP * erro) > LIMITE_P;
    const diminuindo = Math.abs(erro) < Math.abs(this.erroAnterior);
    if (!saturado || !diminuindo) {
      const erroIntegrado = Math.max(-ERRO_INTEGRADO_MAXIMO_S, Math.min(ERRO_INTEGRADO_MAXIMO_S, erro));
      this.integral = Math.max(-LIMITE_I, Math.min(LIMITE_I, this.integral + KI * erroIntegrado * BALDE_S));
    }
    this.erroAnterior = erro;
    this.proporcional = p;
    this.razao = 1 + p + this.integral;
  }

  // O ponto guardado é o da ÚLTIMA CHEGADA, não o de agora: quadros recebidos até ela, e o
  // instante dela. Medir contra "agora" contava como lentidão da fonte o tempo que a página
  // passou esperando o próximo bloco -- numa rajada atrasada, ou no começo de uma pausa, a
  // conta via uma fonte 1% mais lenta que não existia.
  guardarHistorico() {
    const i = (this.historicoInicio + this.historicoTamanho) % BALDES_PARA_ESTIMAR;
    if (this.historicoTamanho === BALDES_PARA_ESTIMAR) this.historicoInicio = (this.historicoInicio + 1) % BALDES_PARA_ESTIMAR;
    else this.historicoTamanho++;
    this.historicoSaida[i] = this.ultimaChegada;
    this.historicoRecebido[i] = this.recebidoTotal;
  }

  // A integral aprende devagar de propósito, e uma diferença de relógio grosseira (acima de
  // 0,5% -- uma taxa de amostragem errada, não deriva de cristal) levaria minutos de buracos
  // para ser aprendida. Ela é medida direto: quadros que chegaram contra o quanto o relógio
  // daqui andou entre as chegadas, em trinta segundos sem pausa da fonte. Duas medidas
  // seguidas precisam concordar, para um atraso isolado não virar correção.
  corrigirDivergenciaGrosseira() {
    if (this.historicoTamanho < BALDES_PARA_ESTIMAR) return;
    const primeiro = this.historicoInicio;
    const inicio = this.historicoSaida[primeiro];
    if (this.ultimaPausa >= inicio) return;
    const saida = this.ultimaChegada - inicio;
    const recebido = this.recebidoTotal - this.historicoRecebido[primeiro];
    if (saida < 20 * this.taxaSaida || recebido <= 0) return;
    const estimada = recebido / (saida * this.passoNominal);
    if (Math.abs(estimada - this.razao) < DIVERGENCIA_GROSSEIRA) { this.estimativaAnterior = 0; return; }
    const confirmada = this.estimativaAnterior && Math.abs(estimada - this.estimativaAnterior) < DIVERGENCIA_GROSSEIRA / 2;
    this.estimativaAnterior = estimada;
    if (!confirmada) return;
    this.integral = Math.max(-LIMITE_I, Math.min(LIMITE_I, estimada - 1 - this.proporcional));
    this.razao = 1 + this.proporcional + this.integral;
    this.contagem.correcoesGrosseiras++;
    this.historicoTamanho = 0;
    this.estimativaAnterior = 0;
    // Os buracos até aqui vieram da velocidade errada, não de atraso na entrega: a folga que
    // eles ensinaram não serve mais. E a fila que se acumulou levaria minutos para drenar a
    // 0,1% -- volta ao alvo de uma vez, em rampa, como numa rajada.
    this.alvo = ALVO_BASE_S;
    if (this.tocando && !this.pular && this.disponivel() / this.taxaEntrada > this.alvo + RETOMADA_S + 0.03) {
      this.pular = true;
      this.passoGanho = -1 / this.rampa;
      this.contagem.saltos++;
    }
  }

  estatisticas() {
    return {
      // Quadros que já chegaram desde o começo: é com ele que a página sabe se o som do agente ainda
      // anda (sala.js, `vigiarOSomDoAgente`) -- um número que não sobe é uma captura que parou.
      recebidos: this.recebidoTotal,
      buracos: this.contagem.buracos,
      saltos: this.contagem.saltos,
      silencioMs: Math.round(this.contagem.silencioS * 1000),
      descartadoMs: Math.round(this.contagem.descartadoS * 1000),
      correcoesGrosseiras: this.contagem.correcoesGrosseiras,
      nivelMs: Math.round(this.nivelMedioS * 1000),
      folgaMs: Math.round(this.folgaS * 1000),
      alvoMs: Math.round(this.alvo * 1000),
      relogioPpm: Math.round((this.razao - 1) * 1e6),
      tocando: this.tocando
    };
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('pcm-player', class extends AudioWorkletProcessor {
    constructor(opcoes) {
      super();
      this.reprodutor = new ReprodutorPcm({ taxaEntrada: opcoes?.processorOptions?.taxaEntrada || 44100, taxaSaida: sampleRate });
      this.portaDireta = null;
      this.desdeORelato = 0;
      this.port.onmessage = ({ data }) => {
        if (ehArrayBuffer(data)) { this.reprodutor.receber(data); return; }
        // A conexão direta com o agente mora num Worker e entrega por uma porta própria, sem
        // passar pelo fio principal da página -- onde qualquer engasgo virava buraco.
        if (data?.porta) {
          this.portaDireta?.close();
          this.portaDireta = data.porta;
          this.portaDireta.onmessage = ({ data: pcm }) => this.reprodutor.receber(pcm);
        }
      };
    }
    process(_entradas, saidas) {
      const [esquerda, direita] = saidas[0];
      this.reprodutor.produzir(esquerda, direita || esquerda);
      this.desdeORelato += esquerda.length;
      if (this.desdeORelato >= sampleRate * 2) {
        this.desdeORelato = 0;
        this.port.postMessage({ estatisticas: this.reprodutor.estatisticas() });
      }
      return true;
    }
  });
}

if (typeof module !== 'undefined') module.exports = { ReprodutorPcm };
