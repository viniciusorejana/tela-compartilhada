// Baixa o servidor de midia (SFU) que o Nexo usa para distribuir video, audio e tela.
// Sem ele o Node sobe, mas a sala fica so com chat: nao ha por onde a midia passar.
//
// A versao e o hash sao FIXOS aqui. Buscar "a ultima versao" trocaria o binario que roda
// no seu computador sem aviso e sem revisao -- e um binario e a coisa menos indicada para
// se atualizar sozinha.
//
// Ha DUAS versoes declaradas, e continua nao havendo nenhuma buscada. A 1.13.7 e a primeira
// que sabe receber VP9 e AV1 como simulcast de verdade -- varias resolucoes independentes em
// vez de uma faixa com as camadas dentro. Sem ela, esses dois codecs sobem sem o degrau
// barato de 360p que a grade e a rede ruim usam (o porque esta em public/sala.js, em
// ESCADA_SVC), e e por isso que a troca interessa.
//
// O padrao continua sendo a 1.13.6 porque a validacao que falta nao e de codigo: e ligar uma
// sala com gente de verdade, em rede de verdade, e conferir que o degrau de 360p aparece e
// nao congela. Trocar o padrao antes disso seria trocar um problema conhecido por um
// desconhecido. Quem for validar escolhe assim:
//
//   $env:NEXO_LIVEKIT = '1.13.7'; npm run build:sfu; npm start
//
// Voltar e apagar a variavel e rodar `build:sfu` de novo. A pasta e UMA, e a troca re-baixa
// por cima: nao ha pasta por versao de proposito. O encerrador de orfaos em sfu.js casa pelo
// caminho exato do executavel, entao duas pastas deixariam o processo da outra versao vivo
// segurando a porta -- e o proximo `npm start` cairia no ciclo de "nao consigo abrir a
// porta" que aquele encerrador existe para evitar. Um download a mais e mais barato do que
// isso.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSAO_PADRAO = '1.13.6';

// Hash de cada arquivo que pode entrar nesta maquina. O do Linux da 1.13.7 esta ausente de
// proposito: nao foi conferido aqui, e um `null` faz o download recusar -- que e o que deve
// acontecer. Inventar um hash, ou aceitar sem conferir, e pior do que nao ter a versao.
const VERSOES = {
  '1.13.6': {
    win32: '9df299b6c6c32f1be88d3d106a9a63f8f921b424b353cc59f57d6b84532a4475',
    linux: '2b61abef2b9ba14b4b8ca38b37de9a37ffc682b9931d5fc03ceca2f0b77d3e33'
  },
  '1.13.7': {
    win32: 'e539e7d2f75807b9c9202cd2a0bf2cb3d52fc4c52978a6953e0f47bc339fe77f',
    linux: null
  }
};

const VERSAO = (() => {
  const pedida = (process.env.NEXO_LIVEKIT || '').trim();
  if (!pedida) return VERSAO_PADRAO;
  if (!VERSOES[pedida]) {
    throw new Error(`NEXO_LIVEKIT=${pedida} não é uma versão declarada. Declaradas: ${Object.keys(VERSOES).join(', ')}.`);
  }
  return pedida;
})();

const ARQUIVOS = {
  win32: { arquivo: `livekit_${VERSAO}_windows_amd64.zip`, binario: 'livekit-server.exe' },
  linux: { arquivo: `livekit_${VERSAO}_linux_amd64.tar.gz`, binario: 'livekit-server' }
};
const PACOTES = Object.fromEntries(Object.entries(ARQUIVOS)
  .map(([plataforma, dados]) => [plataforma, { ...dados, sha256: VERSOES[VERSAO][plataforma] }]));

const PASTA = path.join(__dirname, '..', 'native', 'livekit');

function pacoteDestaMaquina() {
  const pacote = PACOTES[process.platform];
  if (!pacote) throw new Error(`Sem pacote do LiveKit para ${process.platform}. Baixe manualmente em https://github.com/livekit/livekit/releases/tag/v${VERSAO}`);
  if (process.arch !== 'x64') throw new Error(`Sem pacote do LiveKit para ${process.arch}. Baixe manualmente em https://github.com/livekit/livekit/releases/tag/v${VERSAO}`);
  // Sem hash declarado, o download para aqui. A alternativa seria instalar um executável sem
  // conferir o que chegou, e é justamente isso que a conferência existe para impedir -- a
  // regra não pode ter exceção só porque a versão é experimental.
  if (!pacote.sha256) {
    throw new Error(`O LiveKit ${VERSAO} para ${process.platform} não tem hash conferido neste repositório.`
      + ` Confira o SHA-256 do release, declare-o em VERSOES e rode de novo.`);
  }
  return pacote;
}

function caminhoDoBinario() {
  return path.join(PASTA, pacoteDestaMaquina().binario);
}

function versaoInstalada() {
  const marca = path.join(PASTA, 'versao.txt');
  try { return fs.readFileSync(marca, 'utf8').trim(); } catch (_) { return ''; }
}

async function baixar(url) {
  const resposta = await fetch(url, { redirect: 'follow' });
  if (!resposta.ok) throw new Error(`O download respondeu ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}

// No Windows o pacote e .zip e quem sabe abrir e o bsdtar do sistema -- chamado pelo
// caminho completo porque o "tar" do PATH costuma ser o GNU tar do Git para Windows, que
// nao le zip (e ainda interpreta "C:\..." como host remoto). Se ele nao existir, sobra o
// Expand-Archive do PowerShell. No Linux o pacote e .tar.gz e o tar comum resolve.
function extrair(nomeDoArquivo, destino) {
  if (process.platform !== 'win32') {
    execFileSync('tar', ['-xf', nomeDoArquivo], { cwd: destino, stdio: 'inherit' });
    return;
  }
  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(bsdtar)) {
    execFileSync(bsdtar, ['-xf', nomeDoArquivo], { cwd: destino, stdio: 'inherit' });
    return;
  }
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${path.join(destino, nomeDoArquivo)}' -DestinationPath '${destino}' -Force`
  ], { stdio: 'inherit' });
}

async function garantirLivekit({ silencioso = false } = {}) {
  const pacote = pacoteDestaMaquina();
  const binario = caminhoDoBinario();
  if (fs.existsSync(binario) && versaoInstalada() === VERSAO) {
    if (!silencioso) console.log(`Servidor de mídia ${VERSAO} já está instalado.`);
    return binario;
  }

  fs.mkdirSync(PASTA, { recursive: true });
  const url = `https://github.com/livekit/livekit/releases/download/v${VERSAO}/${pacote.arquivo}`;
  console.log(`Baixando o servidor de mídia ${VERSAO} (uma vez só)...`);
  const bytes = await baixar(url);

  // Um binario que vai rodar nesta maquina nao entra sem conferencia: se o hash nao bate,
  // o que chegou nao e o que foi revisado -- pode ser corrupcao ou outra coisa.
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== pacote.sha256) {
    throw new Error(`O arquivo baixado não confere com o esperado.\n  esperado: ${pacote.sha256}\n  recebido: ${hash}\nNada foi instalado.`);
  }

  const temporario = path.join(PASTA, pacote.arquivo);
  fs.writeFileSync(temporario, bytes);
  try {
    extrair(pacote.arquivo, PASTA);
  } finally {
    fs.rmSync(temporario, { force: true });
  }

  if (!fs.existsSync(binario)) throw new Error(`O pacote foi extraído, mas ${pacote.binario} não apareceu em ${PASTA}.`);
  // A marca de versao so e escrita depois que o binario existe: uma extracao interrompida
  // nao pode parecer uma instalacao concluida.
  fs.writeFileSync(path.join(PASTA, 'versao.txt'), VERSAO);
  console.log(`Servidor de mídia ${VERSAO} pronto em ${PASTA}.`);
  return binario;
}

module.exports = { garantirLivekit, caminhoDoBinario, VERSAO };

if (require.main === module) {
  garantirLivekit().catch(erro => {
    console.error('Não foi possível preparar o servidor de mídia:', erro.message);
    console.error(`Baixe manualmente em https://github.com/livekit/livekit/releases/tag/v${VERSAO} e extraia em ${PASTA}.`);
    process.exitCode = 1;
  });
}
