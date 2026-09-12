// Baixa as duas ferramentas de que o bot de musica precisa: o yt-dlp, que sabe conversar
// com cada site, e o ffmpeg, que decodifica o que vier.
//
// Os dois sao tratados de formas DIFERENTES de proposito:
//
//   yt-dlp -- sempre o nosso, nunca o do PATH. Ele e a peca que negocia com o YouTube, e o
//     YouTube muda a negociacao a cada poucas semanas. Uma copia velha nao da erro claro:
//     ela devolve "403 Forbidden" ou "the page needs to be reloaded", e a sala inteira
//     acha que o bot esta quebrado. O do PATH costuma ser o que alguem instalou uma vez e
//     nunca mais atualizou -- exatamente o caso ruim.
//
//   ffmpeg -- o do PATH serve, se houver. Ele so converte audio para PCM, e essa parte nao
//     muda entre versoes. Baixar 106 MB para repetir o que ja esta instalado nao se
//     justifica.
//
// A versao e o hash sao FIXOS aqui, como no servidor de midia: um binario que roda nesta
// maquina nao se atualiza sozinho. Quando o YouTube mudar e o bot parar, "npm run
// musica:atualizar" traz a versao nova do yt-dlp -- um comando que alguem digita de
// propria vontade, olhando, e nao uma surpresa no meio de uma conversa.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSAO_YTDLP = '2026.08.19';
const VERSAO_FFMPEG = '9.0.1';

const PACOTES = {
  win32: {
    ytdlp: {
      arquivo: 'yt-dlp.exe',
      url: `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSAO_YTDLP}/yt-dlp.exe`,
      sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'
    },
    ffmpeg: {
      arquivo: 'ffmpeg.exe',
      pacote: `ffmpeg-${VERSAO_FFMPEG}-essentials_build.zip`,
      url: `https://github.com/GyanD/codexffmpeg/releases/download/${VERSAO_FFMPEG}/ffmpeg-${VERSAO_FFMPEG}-essentials_build.zip`,
      sha256: 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9',
      dentroDoPacote: `ffmpeg-${VERSAO_FFMPEG}-essentials_build/bin/ffmpeg.exe`
    }
  },
  linux: {
    ytdlp: {
      arquivo: 'yt-dlp',
      url: `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSAO_YTDLP}/yt-dlp_linux`,
      // Conferido contra o SHA2-256SUMS do proprio lancamento.
      sha256: null
    },
    // No Linux o ffmpeg vem do gerenciador de pacotes da distribuicao; nao ha build oficial
    // para baixar aqui.
    ffmpeg: { arquivo: 'ffmpeg', url: null }
  }
};

const PASTA = path.join(__dirname, '..', 'native', 'musica');

function pacotesDestaMaquina() {
  const pacote = PACOTES[process.platform];
  if (!pacote) throw new Error(`Sem pacote de música para ${process.platform}.`);
  return pacote;
}

// Procura um executavel nas pastas do PATH. Usado so para o ffmpeg -- ver o cabecalho.
function noCaminhoDoSistema(nome) {
  const extensoes = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE').split(';') : [''];
  for (const pasta of (process.env.PATH || '').split(path.delimiter)) {
    if (!pasta) continue;
    for (const extensao of extensoes) {
      const tentativa = path.join(pasta, nome + (nome.includes('.') ? '' : extensao.toLowerCase()));
      try { if (fs.statSync(tentativa).isFile()) return tentativa; } catch (_) { /* Proxima pasta. */ }
    }
  }
  return null;
}

function caminhoDoYtdlp() {
  return path.join(PASTA, pacotesDestaMaquina().ytdlp.arquivo);
}

function caminhoDoFfmpeg() {
  const nosso = path.join(PASTA, pacotesDestaMaquina().ffmpeg.arquivo);
  if (fs.existsSync(nosso)) return nosso;
  return noCaminhoDoSistema('ffmpeg') || nosso;
}

function marcaDeVersao(qual) {
  return path.join(PASTA, `versao-${qual}.txt`);
}

function versaoInstalada(qual) {
  try { return fs.readFileSync(marcaDeVersao(qual), 'utf8').trim(); } catch (_) { return ''; }
}

async function baixar(url) {
  const resposta = await fetch(url, { redirect: 'follow' });
  if (!resposta.ok) throw new Error(`O download respondeu ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}

function conferir(bytes, esperado, nome) {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (esperado && hash !== esperado) {
    throw new Error(`${nome} não confere com o esperado.\n  esperado: ${esperado}\n  recebido: ${hash}\nNada foi instalado.`);
  }
  return hash;
}

// O pacote do ffmpeg traz documentacao e outros executaveis que nao usamos. So o ffmpeg.exe
// e extraido: guardar 300 MB para usar 80 nao faz sentido.
function extrairFfmpeg(caminhoDoZip, pacote) {
  const temporaria = path.join(PASTA, 'extraindo');
  fs.rmSync(temporaria, { recursive: true, force: true });
  fs.mkdirSync(temporaria, { recursive: true });
  try {
    const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(bsdtar)) {
      execFileSync(bsdtar, ['-xf', caminhoDoZip, pacote.dentroDoPacote], { cwd: temporaria, stdio: 'inherit' });
    } else {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${caminhoDoZip}' -DestinationPath '${temporaria}' -Force`
      ], { stdio: 'inherit' });
    }
    const extraido = path.join(temporaria, pacote.dentroDoPacote);
    if (!fs.existsSync(extraido)) throw new Error(`o pacote foi aberto, mas ${pacote.dentroDoPacote} não apareceu`);
    fs.copyFileSync(extraido, path.join(PASTA, pacote.arquivo));
  } finally {
    fs.rmSync(temporaria, { recursive: true, force: true });
  }
}

async function garantirYtdlp({ versao = VERSAO_YTDLP, url, sha256 } = {}) {
  const pacote = pacotesDestaMaquina().ytdlp;
  const destino = caminhoDoYtdlp();
  if (!url && fs.existsSync(destino) && versaoInstalada('ytdlp') === versao) return destino;

  fs.mkdirSync(PASTA, { recursive: true });
  console.log(`Baixando o yt-dlp ${versao} (17 MB, uma vez só)...`);
  const bytes = await baixar(url || pacote.url);
  conferir(bytes, sha256 !== undefined ? sha256 : pacote.sha256, 'O yt-dlp baixado');

  fs.writeFileSync(destino, bytes, { mode: 0o755 });
  // A marca so e escrita depois do arquivo: um download interrompido nao pode parecer uma
  // instalacao concluida.
  fs.writeFileSync(marcaDeVersao('ytdlp'), versao);
  console.log(`yt-dlp ${versao} pronto.`);
  return destino;
}

async function garantirFfmpeg() {
  const pacote = pacotesDestaMaquina().ffmpeg;
  const nosso = path.join(PASTA, pacote.arquivo);
  if (fs.existsSync(nosso)) return nosso;

  const doSistema = noCaminhoDoSistema('ffmpeg');
  if (doSistema) {
    console.log(`ffmpeg encontrado no sistema (${doSistema}).`);
    return doSistema;
  }
  if (!pacote.url) {
    throw new Error('Instale o ffmpeg pelo gerenciador de pacotes da sua distribuição (ex.: apt install ffmpeg).');
  }

  fs.mkdirSync(PASTA, { recursive: true });
  console.log(`Baixando o ffmpeg ${VERSAO_FFMPEG} (106 MB, uma vez só)...`);
  const bytes = await baixar(pacote.url);
  conferir(bytes, pacote.sha256, 'O ffmpeg baixado');

  const temporario = path.join(PASTA, pacote.pacote);
  fs.writeFileSync(temporario, bytes);
  try {
    extrairFfmpeg(temporario, pacote);
  } finally {
    fs.rmSync(temporario, { force: true });
  }
  console.log(`ffmpeg ${VERSAO_FFMPEG} pronto em ${PASTA}.`);
  return nosso;
}

async function garantirMusica({ silencioso = false } = {}) {
  try {
    await garantirYtdlp();
    await garantirFfmpeg();
    return true;
  } catch (erro) {
    // O bot de musica nao subir nao pode impedir a sala de abrir: video, voz, tela e chat
    // nao dependem dele em nada.
    if (!silencioso) console.error(`O bot de música não pôde ser preparado: ${erro.message}`);
    return false;
  }
}

// ---------- Atualizacao sob demanda ----------
//
// O hash vem do arquivo de somas do PROPRIO lancamento. Isso confere que o download chegou
// inteiro, nao que o lancamento e confiavel -- para isso serve a versao fixa la em cima,
// que foi olhada por alguem. Por isso atualizar e um comando separado, e nao algo que
// aconteca no "npm start".
async function atualizarYtdlp() {
  const resposta = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: { accept: 'application/vnd.github+json' }
  });
  if (!resposta.ok) throw new Error(`O GitHub respondeu ${resposta.status}`);
  const lancamento = await resposta.json();
  const versao = String(lancamento.tag_name || '').trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(versao)) throw new Error(`versão inesperada: ${versao}`);

  const nome = pacotesDestaMaquina().ytdlp.arquivo === 'yt-dlp.exe' ? 'yt-dlp.exe' : 'yt-dlp_linux';
  const somas = await (await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${versao}/SHA2-256SUMS`)).text();
  const linha = somas.split('\n').find(l => l.trim().endsWith(nome));
  if (!linha) throw new Error(`o lançamento ${versao} não publicou a soma de ${nome}`);
  const sha256 = linha.trim().split(/\s+/)[0];

  await garantirYtdlp({ versao, url: `https://github.com/yt-dlp/yt-dlp/releases/download/${versao}/${nome}`, sha256 });
  console.log(`\nPara fixar esta versão no repositório, edite scripts/baixar-musica.cjs:`);
  console.log(`  VERSAO_YTDLP = '${versao}'`);
  console.log(`  sha256: '${sha256}'\n`);
}

module.exports = { garantirMusica, garantirYtdlp, garantirFfmpeg, caminhoDoYtdlp, caminhoDoFfmpeg, VERSAO_YTDLP, VERSAO_FFMPEG };

if (require.main === module) {
  const tarefa = process.argv.includes('--atualizar') ? atualizarYtdlp() : garantirMusica().then(ok => { if (!ok) process.exitCode = 1; });
  tarefa.catch(erro => {
    console.error('Não foi possível preparar o bot de música:', erro.message);
    process.exitCode = 1;
  });
}
