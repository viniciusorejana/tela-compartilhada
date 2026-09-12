// A mesa de sons da sala. Cada sala tem a sua, ela vive na memoria e some quando a sala
// esvazia -- igual ao historico do chat, e pelo mesmo motivo: nada do que acontece numa
// sala precisa sobreviver a ela.
//
// O som NAO passa pelo servidor de midia. Ele e baixado uma vez por cada navegador e tocado
// LA, no instante em que o aviso chega. A diferenca importa:
//
//   - Um efeito sonoro vale pelo tempo. Subir o audio ate aqui, codificar, distribuir e
//     decodificar do outro lado custa uns bons milissegundos; um toque que chega tarde
//     perde a graca. Tocando local, o atraso e o do aviso -- dezenas de milissegundos --
//     e o arquivo ja esta no navegador antes de alguem clicar.
//   - O volume passa a ser de quem ouve, de verdade. Cada um mexe no proprio elemento de
//     audio, sem pedir nada a ninguem.
//   - Nao gasta a banda de subida de quem hospeda nem um lugar na sala de midia.
//
// O preco e que quem entrou com o som bloqueado pelo navegador nao ouve -- o mesmo aviso
// de "Ativar reprodução" que ja existe resolve, porque ele vale para todo <audio> da pagina.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const { caminhoDoFfmpeg } = require('./scripts/baixar-musica.cjs');

// Efeito sonoro é curto por natureza, mas recusar um arquivo por causa disso é grosseiro:
// quem arrastou uma música de três minutos quase sempre quer o comecinho dela. Então a
// mesa CORTA em vez de recusar, e avisa o que fez.
const SEGUNDOS_MAXIMOS_DO_SOM = 30;

// Tudo que entra sai daqui como MP3 de 128 kbps, cortado no limite. Normalizar na entrada
// resolve três coisas de uma vez: o corte fica garantido no servidor (e não na boa vontade
// de quem envia), um WAV de 2 MB vira um MP3 de 300 KB, e todo navegador toca o que sair --
// inclusive o do iPhone, que é o mais exigente da sala.
const CODIGO_DE_SAIDA = ['-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3'];

// Efeito sonoro e curto por definicao. O teto por arquivo existe para ninguem subir um
// album inteiro e prender isso na memoria de quem hospeda; o teto por sala existe porque
// trinta arquivos pequenos somam tanto quanto um grande.
const BYTES_MAXIMOS_DO_SOM = 2 * 1024 * 1024;
const BYTES_MAXIMOS_DA_SALA = 24 * 1024 * 1024;
const SONS_MAXIMOS_POR_SALA = 30;
const TAMANHO_MAXIMO_DO_NOME = 28;

// Teto de TODAS as salas somadas. O limite por sala sozinho nao protege nada: ele se
// multiplica pelo numero de salas, que nao tem limite. Vinte salas cheias sao meio giga
// de Buffer, e cem sao dois giga e meio -- e Buffer nao vive no monte do V8, vive na
// memoria do processo, entao o desfecho nao e uma excecao que da para tratar: e o
// alocador falhando, ou o sistema encerrando o processo. Isso derruba a sala inteira,
// video e voz junto, por causa de uma mesa de sons.
//
// Recusar o proximo envio e dizer por que e muito melhor do que isso.
const BYTES_MAXIMOS_DE_TODAS = Number(process.env.NEXO_SOUNDBOARD_MAXIMO_MB || 256) * 1024 * 1024;

// Só para a mensagem de erro: dizer "cheio" sem dizer de quem é o espaço não ajuda ninguém.
let bytesEmUso = 0;

// Lista fechada: o que chega aqui vai virar <audio> no navegador de todo mundo. Um tipo
// que nao esteja nesta lista simplesmente nao entra.
const TIPOS_ACEITOS = new Map([
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
  ['audio/x-flac', 'flac']
]);

// Assinaturas de arquivo. O tipo declarado pelo navegador e so uma afirmacao; os primeiros
// bytes sao o que o arquivo E. Sem esta conferencia, um "audio/mpeg" poderia ser qualquer
// outra coisa guardada e servida por nos.
const ASSINATURAS = [
  { tipo: 'mp3', casa: b => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { tipo: 'ogg', casa: b => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { tipo: 'wav', casa: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { tipo: 'webm', casa: b => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { tipo: 'm4a', casa: b => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { tipo: 'flac', casa: b => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  { tipo: 'aac', casa: b => b[0] === 0xff && (b[1] & 0xf6) === 0xf0 }
];

// ---------- Corte e normalização ----------
//
// Tudo acontece por cano, na memória: o arquivo entra pelo stdin do ffmpeg e o resultado
// volta pelo stdout. Em nenhum momento existe um arquivo temporário para alguém esquecer
// de apagar.
function ffmpegDisponivel() {
  try { return fs.existsSync(caminhoDoFfmpeg()); } catch (_) { return false; }
}

function normalizar(bytes) {
  return new Promise(resolve => {
    const processo = spawn(caminhoDoFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      // "-t" antes da saída corta o que passar do limite; um som mais curto sai inteiro.
      '-t', String(SEGUNDOS_MAXIMOS_DO_SOM),
      // Capa de álbum embutida no MP3 é um "vídeo" para o ffmpeg, e sem isto ela viaja
      // junto para dentro da mesa.
      '-vn', '-map_metadata', '-1',
      ...CODIGO_DE_SAIDA, 'pipe:1'
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const pedacos = [];
    let total = 0;
    let erro = '';
    let desistiu = false;
    // Um arquivo malformado pode fazer o ffmpeg produzir sem parar. O teto aqui é o mesmo
    // do envio: nada que saia daqui pode ser maior do que o que entrou pela porta.
    const prazo = setTimeout(() => { desistiu = true; try { processo.kill(); } catch (_) {} }, 20000);

    processo.stdout.on('data', p => {
      total += p.length;
      if (total > BYTES_MAXIMOS_DO_SOM) { desistiu = true; try { processo.kill(); } catch (_) {} return; }
      pedacos.push(p);
    });
    processo.stderr.on('data', p => { erro = (erro + p).slice(-800); });
    processo.on('error', () => { clearTimeout(prazo); resolve(null); });
    processo.on('close', codigo => {
      clearTimeout(prazo);
      if (desistiu || codigo !== 0 || !total) return resolve(null);
      resolve(Buffer.concat(pedacos, total));
    });

    processo.stdin.on('error', () => { /* o ffmpeg desistiu antes de ler tudo: normal */ });
    processo.stdin.end(bytes);
  });
}

// roomCode -> Map<id, { id, nome, tipo, bytes, tamanho, porQuem, em }>
const mesasPorSala = new Map();

function mesaDaSala(roomCode) {
  if (!mesasPorSala.has(roomCode)) mesasPorSala.set(roomCode, new Map());
  return mesasPorSala.get(roomCode);
}

function limparNome(bruto) {
  // Quebra de linha e caractere de controle nao tem lugar num rotulo de botao: o nome vai
  // para dentro de um botao na tela de todo mundo, e um deles quebraria o rotulo em duas.
  const semControles = [...String(bruto || '')]
    .map(letra => (letra.charCodeAt(0) < 32 || letra.charCodeAt(0) === 127 ? ' ' : letra)).join('');
  const limpo = semControles.replace(/\s+/g, ' ').trim();
  return limpo.slice(0, TAMANHO_MAXIMO_DO_NOME) || 'Som';
}

function ehAudioDeVerdade(bytes, extensaoDeclarada) {
  if (bytes.length < 12) return false;
  const reconhecido = ASSINATURAS.find(assinatura => assinatura.casa(bytes));
  if (!reconhecido) return false;
  // O webm e o m4a compartilham container com video. Aceitamos assim mesmo: o <audio> do
  // navegador toca a trilha e ignora a imagem -- e o que o arquivo declara ser ja passou
  // pela lista fechada de tipos.
  return reconhecido.tipo === extensaoDeclarada || ['webm', 'm4a', 'ogg'].includes(reconhecido.tipo);
}

function totalDaSala(mesa) {
  let bytes = 0;
  for (const som of mesa.values()) bytes += som.tamanho;
  return bytes;
}

// Devolve `{ erro }` em vez de lancar: todo motivo aqui e algo que a pessoa fez e precisa
// ler na tela, nao uma falha do servidor.
async function adicionar(roomCode, { nome, tipo, bytes, porQuem, segundos }) {
  const extensao = TIPOS_ACEITOS.get(String(tipo || '').toLowerCase().split(';')[0].trim());
  if (!extensao) return { erro: 'Formato não aceito. Use MP3, OGG, WAV, M4A, FLAC ou WebM.' };
  if (!Buffer.isBuffer(bytes) || !bytes.length) return { erro: 'Arquivo vazio.' };
  if (bytes.length > BYTES_MAXIMOS_DO_SOM) {
    return { erro: `O som passa de ${Math.round(BYTES_MAXIMOS_DO_SOM / 1024 / 1024)} MB. Use um trecho mais curto.` };
  }
  // A conferência de assinatura acontece sobre o arquivo COMO ELE CHEGOU, antes de
  // qualquer conversão: é ela que decide se isto é áudio, e ela não pode opinar sobre uma
  // saída que nós mesmos produzimos.
  if (!ehAudioDeVerdade(bytes, extensao)) return { erro: 'Esse arquivo não parece ser áudio.' };

  // Corta e uniformiza. Se o ffmpeg não estiver instalado, o arquivo entra como veio e o
  // limite de duração passa a valer só pela conferência do navegador de quem envia.
  let cortado = false;
  let tipoFinal = String(tipo).split(';')[0].trim();
  if (ffmpegDisponivel()) {
    const normalizado = await normalizar(bytes);
    if (!normalizado) return { erro: 'Não consegui ler esse áudio. Tente outro arquivo.' };
    cortado = Number(segundos) > SEGUNDOS_MAXIMOS_DO_SOM;
    bytes = normalizado;
    tipoFinal = 'audio/mpeg';
  }

  const mesa = mesaDaSala(roomCode);
  if (mesa.size >= SONS_MAXIMOS_POR_SALA) {
    return { erro: `A mesa já tem ${SONS_MAXIMOS_POR_SALA} sons. Apague algum para abrir espaço.` };
  }
  if (totalDaSala(mesa) + bytes.length > BYTES_MAXIMOS_DA_SALA) {
    return { erro: 'A mesa da sala está cheia. Apague algum som para abrir espaço.' };
  }
  // O teto de todas as salas juntas. Só se alcança com muitas salas cheias ao mesmo tempo,
  // e aí a alternativa a recusar é o processo inteiro cair.
  if (bytesEmUso + bytes.length > BYTES_MAXIMOS_DE_TODAS) {
    return { erro: 'O servidor está sem espaço para sons agora. Apague algum som desta sala e tente de novo.' };
  }

  const som = {
    id: crypto.randomBytes(8).toString('hex'),
    nome: limparNome(nome),
    tipo: tipoFinal,
    extensao,
    bytes,
    tamanho: bytes.length,
    porQuem: String(porQuem || '').slice(0, 40),
    em: Date.now()
  };
  mesa.set(som.id, som);
  bytesEmUso += som.tamanho;
  return { som: semOsBytes(som), cortado };
}

// O que a sala precisa saber sobre um som nao inclui o som. Mandar os bytes pela
// sinalizacao encheria o mesmo canal por onde passam o chat e os avisos de entrada e
// saida -- e e por HTTP que o arquivo desce, uma vez, com cache.
function semOsBytes(som) {
  const { bytes, ...resto } = som;
  return resto;
}

function listar(roomCode) {
  const mesa = mesasPorSala.get(roomCode);
  if (!mesa) return [];
  return [...mesa.values()].sort((a, b) => a.em - b.em).map(semOsBytes);
}

function obter(roomCode, id) {
  return mesasPorSala.get(roomCode)?.get(String(id)) || null;
}

function remover(roomCode, id) {
  const mesa = mesasPorSala.get(roomCode);
  if (!mesa) return null;
  const som = mesa.get(String(id));
  if (!som) return null;
  mesa.delete(String(id));
  bytesEmUso -= som.tamanho;
  if (!mesa.size) mesasPorSala.delete(roomCode);
  return semOsBytes(som);
}

function limparSala(roomCode) {
  const mesa = mesasPorSala.get(roomCode);
  if (!mesa) return;
  // O contador global devolve o espaco DESTA sala em vez de ser recalculado do zero: esta
  // funcao roda toda vez que uma sala esvazia, e as outras salas seguem vivas.
  bytesEmUso -= totalDaSala(mesa);
  mesasPorSala.delete(roomCode);
}

function espacoDaSala(roomCode) {
  const mesa = mesasPorSala.get(roomCode);
  return {
    usado: mesa ? totalDaSala(mesa) : 0,
    total: BYTES_MAXIMOS_DA_SALA,
    sons: mesa ? mesa.size : 0,
    maximoDeSons: SONS_MAXIMOS_POR_SALA
  };
}

// Quanto TODAS as salas ocupam agora. Serve para conferir a contabilidade -- o número
// aqui tem de bater com a soma das mesas; se não bater, algum caminho de saída esqueceu
// de devolver o espaço, e o teto global iria fechando sozinho até recusar tudo.
function usoGlobal() {
  let somaReal = 0;
  for (const mesa of mesasPorSala.values()) somaReal += totalDaSala(mesa);
  return { contabilizado: bytesEmUso, real: somaReal, teto: BYTES_MAXIMOS_DE_TODAS, salas: mesasPorSala.size };
}

module.exports = {
  adicionar, listar, obter, remover, limparSala, espacoDaSala, usoGlobal,
  BYTES_MAXIMOS_DO_SOM, BYTES_MAXIMOS_DA_SALA, SONS_MAXIMOS_POR_SALA, TAMANHO_MAXIMO_DO_NOME,
  BYTES_MAXIMOS_DE_TODAS
};
