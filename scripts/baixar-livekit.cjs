// Baixa o servidor de midia (SFU) que o Nexo usa para distribuir video, audio e tela.
// Sem ele o Node sobe, mas a sala fica so com chat: nao ha por onde a midia passar.
//
// A versao e o hash sao FIXOS aqui. Buscar "a ultima versao" trocaria o binario que roda
// no seu computador sem aviso e sem revisao -- e um binario e a coisa menos indicada para
// se atualizar sozinha.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSAO = '1.13.6';
const PACOTES = {
  win32: {
    arquivo: `livekit_${VERSAO}_windows_amd64.zip`,
    sha256: '9df299b6c6c32f1be88d3d106a9a63f8f921b424b353cc59f57d6b84532a4475',
    binario: 'livekit-server.exe'
  },
  linux: {
    arquivo: `livekit_${VERSAO}_linux_amd64.tar.gz`,
    sha256: '2b61abef2b9ba14b4b8ca38b37de9a37ffc682b9931d5fc03ceca2f0b77d3e33',
    binario: 'livekit-server'
  }
};

const PASTA = path.join(__dirname, '..', 'native', 'livekit');

function pacoteDestaMaquina() {
  const pacote = PACOTES[process.platform];
  if (!pacote) throw new Error(`Sem pacote do LiveKit para ${process.platform}. Baixe manualmente em https://github.com/livekit/livekit/releases/tag/v${VERSAO}`);
  if (process.arch !== 'x64') throw new Error(`Sem pacote do LiveKit para ${process.arch}. Baixe manualmente em https://github.com/livekit/livekit/releases/tag/v${VERSAO}`);
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
