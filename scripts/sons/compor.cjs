// Monta os avisos sonoros da sala (public/sons/) a partir dos timbres gerados no ElevenLabs.
//
//   node scripts/sons/compor.cjs
//
// ---------- Discretos por regra, e não por gosto ----------
//
// A primeira versão tinha glockenspiel e sino de vidro, e incomodava: medido, o som de menção
// tinha o centro do espectro em 5,6 kHz e 84% da energia acima de 4 kHz -- justamente a faixa em
// que o ouvido é mais sensível --, e os cliques atacavam em 2 ms, o que se ouve como estalo.
// Daqui em diante cada som obedece a quatro regras, conferidas no fim de cada montagem:
//
//   1. registro médio-grave: nenhuma nota com fundamental acima de ~500 Hz;
//   2. brilho contido: passa-baixa em todos, e quase nada de energia acima de 2 kHz;
//   3. ataque macio: cada nota entra numa rampa de 5 a 12 ms, sem estalo;
//   4. volume pelo ouvido: nivelado pela loudness ponderada A, que pesa as frequências como o
//      ouvido pesa -- o mesmo número de energia soa muito mais alto em 3 kHz do que em 300 Hz.
//
// ---------- Por que montar, e não usar o que o gerador entrega ----------
//
// O modelo de efeitos (eleven_text_to_sound_v2) faz golpes isolados muito bons e frases ruins:
// "duas notas subindo" sai como uma nota parada. Então o timbre vem do gerador, e a frase -- que
// nota, em que ordem -- é escolhida aqui para dizer a função. Sobe = chegou, desce = foi embora.
//
// ---------- Os timbres (scripts/sons/origem) e os prompts que os geraram ----------
//
//   piano          Single soft felt piano note, low-mid register, warm and muted, gentle
//                  attack, intimate, close-mic, dry
//   vibrafone      Single soft vibraphone note played with felt mallets, warm and mellow,
//                  low-mid register, gentle attack, no tremolo, close-mic, dry
//   marimba        Single soft low marimba note, felt mallet, very warm and round, gentle
//                  attack, close-mic, dry
//   kalimba        Single kalimba pluck, one soft note, round and gentle metal tine, clean
//                  attack, natural decay, close-mic, dry
//   porta          Two gentle muffled knocks on a wooden door, soft and polite, close-mic, dry
//   mensagem       Very short soft chat message notification: single gentle bubbly pop with a
//                  tiny high tone, minimal, dry
//   surdo          Single soft marimba note sliding down in pitch, felt-muted and dull, like
//                  hearing through a wall, close-mic, dry
//   ouvir          Single soft marimba note sliding up in pitch, opening up clear and bright,
//                  close-mic, dry
//
// Todos com prompt_influence entre 0,6 e 0,85 e duração entre 0,5 e 0,8 s. Trocar um timbre é
// gerar outro com o prompt ao lado, pôr no lugar do arquivo e rodar isto de novo.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TAXA = 44100;
const ORIGEM = path.join(__dirname, 'origem');
const DESTINO = path.join(__dirname, '..', '..', 'public', 'sons');
fs.mkdirSync(DESTINO, { recursive: true });

// ---------- Leitura e análise ----------

function decodificar(nome) {
  const bruto = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ORIGEM, `${nome}.mp3`), '-ac', '1', '-ar', String(TAXA), '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const a = new Float32Array(bruto.buffer.slice(bruto.byteOffset, bruto.byteOffset + bruto.byteLength));
  // Começa no ataque: o silêncio do começo do arquivo viraria atraso entre o clique e o som.
  let pico = 0; for (const v of a) pico = Math.max(pico, Math.abs(v));
  let inicio = a.findIndex(v => Math.abs(v) > pico * 0.02);
  inicio = Math.max(0, inicio - Math.round(TAXA * 0.003));
  return a.subarray(inicio);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const m = i + k + len / 2;
        const br = re[m] * cr - im[m] * ci, bi = re[m] * ci + im[m] * cr;
        re[m] = re[i + k] - br; im[m] = im[i + k] - bi;
        re[i + k] += br; im[i + k] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

function espectro(a, maximo = a.length) {
  let n = 1; while (n < maximo) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(a.length, maximo); i++) re[i] = a[i] * (maximo < a.length ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (maximo - 1)) : 1);
  fft(re, im);
  const potencia = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) potencia[k] = re[k] * re[k] + im[k] * im[k];
  return { potencia, hz: k => k * TAXA / n };
}

// A altura de um timbre: o pico do espectro nos primeiros 150 ms, com a guarda de oitava de
// sempre -- se a metade da frequência também é forte, a fundamental é ela.
function alturaDe(timbre) {
  const { potencia, hz } = espectro(timbre, Math.round(TAXA * 0.15));
  let melhor = 0, indice = 0;
  for (let k = 1; k < potencia.length; k++) if (hz(k) > 70 && hz(k) < 1500 && potencia[k] > melhor) { melhor = potencia[k]; indice = k; }
  const metade = Math.round(indice / 2);
  const naMetade = Math.max(potencia[metade - 1] || 0, potencia[metade] || 0, potencia[metade + 1] || 0);
  return hz(naMetade > melhor * 0.3 && hz(metade) > 70 ? metade : indice);
}

function pesoA(f) {
  const f2 = f * f;
  return (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)) * Math.pow(10, 2 / 20);
}

// Loudness ponderada A do som inteiro, em dB relativos à escala cheia, e a fração da energia
// acima de 2 kHz: as duas medidas que dizem se um aviso é discreto.
function medir(a) {
  const { potencia, hz } = espectro(a);
  let total = 0, ponderada = 0, agudo = 0;
  for (let k = 1; k < potencia.length; k++) {
    total += potencia[k]; ponderada += potencia[k] * pesoA(hz(k)) ** 2;
    if (hz(k) > 2000) agudo += potencia[k];
  }
  let soma = 0; for (const v of a) soma += v * v;
  return { loudA: 20 * Math.log10(Math.sqrt(soma / a.length) * Math.sqrt(ponderada / total)), agudo: agudo / total };
}

// ---------- Transformações ----------

// Afinação como numa fita: acelerar sobe o tom e encurta a nota, que é o que acontece com um
// instrumento de percussão de verdade quando a lâmina é menor.
function afinar(fonte, semitons) {
  const razao = Math.pow(2, semitons / 12);
  const saida = new Float32Array(Math.floor(fonte.length / razao));
  for (let i = 0; i < saida.length; i++) {
    const p = i * razao, j = Math.floor(p), f = p - j;
    saida[i] = (fonte[j] || 0) * (1 - f) + (fonte[j + 1] || 0) * f;
  }
  return saida;
}

// Biquads de segunda ordem (RBJ), Q de Butterworth.
function filtro(a, corte, tipo) {
  const w = 2 * Math.PI * corte / TAXA, alfa = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w);
  const [b0, b1, b2] = tipo === 'baixa' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + alfa, a1 = -2 * c, a2 = 1 - alfa;
  const s = new Float32Array(a.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < a.length; i++) {
    const y = (b0 * a[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = a[i]; y2 = y1; y1 = y; s[i] = y;
  }
  return s;
}
// Dois estágios: 24 dB por oitava acima do corte, para o brilho não voltar pelas harmônicas.
const passaBaixa = (a, corte) => filtro(filtro(a, corte, 'baixa'), corte, 'baixa');
const passaAlta = (a, corte) => filtro(a, corte, 'alta');

const NOTAS = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
// "C4", "G#3", "Bb3" -> Hz, com o Lá 4 em 440.
function hzDa(nota) {
  const [, letra, acidente, oitava] = /^([A-G])([#b]?)(\d)$/.exec(nota);
  const semitons = NOTAS[letra] + (acidente === '#' ? 1 : acidente === 'b' ? -1 : 0) + (Number(oitava) - 4) * 12;
  return 440 * Math.pow(2, semitons / 12);
}

function timbre(nome, { corteGrave = 80 } = {}) {
  const amostras = passaAlta(decodificar(nome), corteGrave);
  return { nome, amostras, altura: alturaDe(amostras) };
}

// Cada nota: [timbre, nota ("C4") ou semitons relativos, início em s, nível, e opcionalmente
// quanto tempo ela soa]. Cada uma entra numa rampa (sem estalo) e termina com a cauda cortada
// suave: uma nota inteira de piano dura mais de um segundo, e um aviso não pode durar isso.
//
// O tempo da nota existe por causa da afinação de fita: a nota grave é a mesma amostra mais
// lenta, então dura mais que a aguda. Num "sobe" sem abafar, a primeira nota continua soando
// depois da segunda e o fim do som volta para baixo -- o contrário do que ele quer dizer.
function frase(notas, { duracao, ataque = 0.01 }) {
  const mix = new Float32Array(Math.round(TAXA * duracao));
  for (const [t, nota, inicio, nivel, soa = Infinity] of notas) {
    const semitons = typeof nota === 'number' ? nota : 12 * Math.log2(hzDa(nota) / t.altura);
    const som = afinar(t.amostras, semitons);
    const deslocamento = Math.round(inicio * TAXA);
    const tamanho = Math.min(som.length, mix.length - deslocamento, Math.round(soa * TAXA));
    const rampa = Math.round(TAXA * ataque), fade = Math.round(TAXA * 0.08);
    for (let i = 0; i < tamanho; i++) {
      const env = Math.min(1, i / rampa) * (i > tamanho - fade ? (tamanho - i) / fade : 1);
      mix[deslocamento + i] += som[i] * nivel * env;
    }
  }
  return mix;
}

// Um som inteiro do gerador, só com a rampa de ataque.
function inteiro(t, { duracao, ataque = 0.01 }) {
  return frase([[t, 0, 0, 1]], { duracao, ataque });
}

function finalizar(nome, a, { loudA, corte = 2500, fadeFinal = 0.08 }) {
  let s = passaBaixa(a, corte);
  // O que fica abaixo de -50 dB do pico é cauda que só atrasa o fim do som.
  let pico = 0; for (const v of s) pico = Math.max(pico, Math.abs(v));
  let fim = s.length - 1; while (fim > 0 && Math.abs(s[fim]) < pico * 0.003) fim--;
  s = s.slice(0, Math.min(s.length, fim + Math.round(TAXA * 0.02)));
  const fade = Math.round(TAXA * fadeFinal);
  for (let i = 0; i < fade && i < s.length; i++) s[s.length - 1 - i] *= i / fade;
  // Volume pelo ouvido; o pico fica abaixo de -3 dBFS de todo jeito.
  const antes = medir(s);
  let ganho = Math.pow(10, (loudA - antes.loudA) / 20);
  pico = 0; for (const v of s) pico = Math.max(pico, Math.abs(v));
  if (pico * ganho > Math.pow(10, -3 / 20)) ganho = Math.pow(10, -3 / 20) / pico;
  for (let i = 0; i < s.length; i++) s[i] *= ganho;
  return gravar(nome, s);
}

// MP3 mono a 96 kbps: toca em todo navegador (Safari incluído) e os catorze somam uns 100 KB.
function gravar(nome, amostras) {
  const arquivo = path.join(DESTINO, `${nome}.mp3`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(TAXA), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', arquivo],
    { input: Buffer.from(amostras.buffer, amostras.byteOffset, amostras.byteLength) });
  const { loudA, agudo } = medir(amostras);
  let pico = 0; for (const v of amostras) pico = Math.max(pico, Math.abs(v));
  console.log(`${nome.padEnd(14)} ${(amostras.length / TAXA).toFixed(2)} s  loudA ${loudA.toFixed(1)} dB  pico ${(20 * Math.log10(pico)).toFixed(1)} dB  >2 kHz ${(agudo * 100).toFixed(1)}%  ${fs.statSync(arquivo).size} bytes`);
}

// ---------- As frases ----------

const piano = timbre('piano');
const vibrafone = timbre('vibrafone');
const kalimba = timbre('kalimba');
console.log(`alturas medidas: piano ${piano.altura.toFixed(0)} Hz, vibrafone ${vibrafone.altura.toFixed(0)} Hz, kalimba ${kalimba.altura.toFixed(0)} Hz`);

// Gente chegando e saindo: piano de feltro, uma quinta de Dó4 (262 Hz) a Sol4 (392 Hz) -- o
// intervalo mais estável que existe, no registro da voz falada, sem furar a conversa.
finalizar('entrada', frase([[piano, 'C4', 0, 0.85, 0.22], [piano, 'G4', 0.09, 1]], { duracao: 0.6 }), { loudA: -30 });
finalizar('saida', frase([[piano, 'G4', 0, 0.85, 0.22], [piano, 'C4', 0.1, 1]], { duracao: 0.6 }), { loudA: -31, corte: 2000 });
// A tela: vibrafone, outro timbre para não se confundir com gente. Três notas subindo quando
// entra no ar, as mesmas descendo quando sai.
finalizar('tela', frase([[vibrafone, 'C4', 0, 0.85, 0.2], [vibrafone, 'E4', 0.08, 0.9, 0.2], [vibrafone, 'G4', 0.16, 1]], { duracao: 0.7 }), { loudA: -30 });
finalizar('tela-fim', frase([[vibrafone, 'G4', 0, 0.85, 0.2], [vibrafone, 'E4', 0.08, 0.9, 0.2], [vibrafone, 'C4', 0.16, 1]], { duracao: 0.65 }), { loudA: -31, corte: 2000 });
// Entrar numa transmissão: é você chegando a uma tela, então o mesmo vibrafone, mas numa forma
// que nenhum outro aviso tem -- uma quinta aberta, Ré4 e Lá4 quase juntos, que soa como uma
// janela abrindo e não como uma frase. Mais baixo que a tela entrando no ar: só confirma o
// clique de quem pediu para ver.
finalizar('assistir', frase([[vibrafone, 'D4', 0, 0.9], [vibrafone, 'A4', 0.035, 0.8]], { duracao: 0.5 }), { loudA: -32, corte: 2000 });
// Menção: dois toques de vibrafone no mesmo tom. O único aviso que é para você, e por isso o
// único que repete a nota -- chama sem precisar ser agudo.
finalizar('mencao', frase([[vibrafone, 'A4', 0, 1, 0.2], [vibrafone, 'A4', 0.14, 0.75]], { duracao: 0.55 }), { loudA: -29 });
// A conexão: kalimba, descendo uma quarta quando cai e subindo quando volta.
finalizar('caiu', frase([[kalimba, 'E4', 0, 0.9, 0.22], [kalimba, 'B3', 0.12, 1]], { duracao: 0.6 }), { loudA: -30, corte: 1800 });
finalizar('voltou', frase([[kalimba, 'B3', 0, 0.85, 0.2], [kalimba, 'E4', 0.1, 1]], { duracao: 0.55 }), { loudA: -30 });
// O teste do fone: a tríade no piano, um pouco mais presente que os avisos, porque é para ouvir.
finalizar('teste', frase([[piano, 'C4', 0, 0.9, 0.26], [piano, 'E4', 0.11, 0.9, 0.26], [piano, 'G4', 0.22, 1]], { duracao: 0.8 }), { loudA: -27 });

// Os que o gerador acertou inteiros: só amaciados, escurecidos e nivelados.
finalizar('pedido', inteiro(timbre('porta'), { duracao: 0.6, ataque: 0.005 }), { loudA: -29, corte: 2200 });
finalizar('surdo', inteiro(timbre('surdo'), { duracao: 0.45, ataque: 0.012 }), { loudA: -32, corte: 1200 });
finalizar('ouvir', inteiro(timbre('ouvir', { corteGrave: 120 }), { duracao: 0.45, ataque: 0.012 }), { loudA: -32, corte: 2000 });
// A mensagem é o aviso que mais se repete, então é o mais baixo de todos. O estalo que o gerador
// fez é bom, mas nasceu em 790 Hz; oito semitons abaixo ele cai para perto de 500 Hz e fica
// redondo, sem perder a cara de bolha.
finalizar('mensagem', frase([[timbre('mensagem', { corteGrave: 150 }), -8, 0, 1]], { duracao: 0.34, ataque: 0.008 }), { loudA: -34, corte: 1800, fadeFinal: 0.06 });
// O microfone: uma nota curta de marimba de feltro, abafada na mão logo depois do golpe. Ligar é
// Mi4 e desligar é Lá3, uma quinta abaixo e mais fechado: o par se reconhece pela altura, como
// no Discord, e nenhum dos dois estala. Não desce mais que isso porque abaixo de ~200 Hz o
// alto-falante de notebook quase não reproduz, e o "desliguei" sumiria justo ali. É você quem
// aperta o botão, então o som só confirma.
const marimba = timbre('marimba');
finalizar('mic-ligado', frase([[marimba, 'E4', 0, 1]], { duracao: 0.16, ataque: 0.006 }), { loudA: -33, corte: 1800, fadeFinal: 0.06 });
finalizar('mic-desligado', frase([[marimba, 'A3', 0, 1]], { duracao: 0.16, ataque: 0.006 }), { loudA: -34, corte: 1100, fadeFinal: 0.06 });
