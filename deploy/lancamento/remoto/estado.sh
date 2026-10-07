# O estado da máquina que serve o Nexo, para o lançamento decidir o que fazer (deploy/lancamento/lancar.cjs).
# Só lê, não muda nada. Responde numa linha que começa com @@ESTADO@@, em JSON.
#
# Chega pela SSH (sudo bash -s), com NEXO_PASTA, NEXO_USUARIO, NEXO_SERVICO e NEXO_ARQUIVOS exportadas antes.
set -euo pipefail

if [ ! -d "$NEXO_PASTA/.git" ]; then
  echo '@@ESTADO@@{"instalado":false}'
  exit 0
fi

ativo=false
systemctl is-active --quiet "$NEXO_SERVICO" && ativo=true
ar=false
command -v ar >/dev/null 2>&1 && ar=true

sudo -u "$NEXO_USUARIO" -H env NEXO_PASTA="$NEXO_PASTA" NEXO_ARQUIVOS="$NEXO_ARQUIVOS" NEXO_ATIVO="$ativo" NEXO_AR="$ar" node - <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const pasta = process.env.NEXO_PASTA;
const dist = path.join(pasta, 'app', 'dist');
const git = (...args) => {
  try { return execFileSync('git', ['-C', pasta, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; }
};
const lerJson = arquivo => { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { return null; } };
const lerTexto = arquivo => { try { return fs.readFileSync(arquivo, 'utf8').trim(); } catch (_) { return null; } };
const sha256 = arquivo => { try { return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex'); } catch (_) { return null; } };

// O .env.prod de lá: o servidor de mídia pode ter pasta e porta próprias.
const ambiente = {};
for (const linha of (lerTexto(path.join(pasta, '.env.prod')) || '').split('\n')) {
  const par = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
  if (par) ambiente[par[1]] = par[2].replace(/^(['"])(.*)\1$/, '$2');
}

const arquivos = {};
for (const nome of (process.env.NEXO_ARQUIVOS || '').split(' ').filter(Boolean)) {
  try { arquivos[nome] = fs.statSync(path.join(dist, nome)).size; } catch (_) { /* não existe */ }
}

// Quantas pessoas estão em chamada agora, pelas métricas do servidor de mídia. A senha é derivada
// das chaves dele, como em sfu.js. null quer dizer "não deu para saber" -- e o lançamento não
// reinicia o serviço sem saber.
async function participantes() {
  if (process.env.NEXO_ATIVO !== 'true') return 0;
  try {
    const pastaSfu = path.resolve(pasta, ambiente.NEXO_PASTA_SFU || 'native/livekit');
    const { apiSecret } = JSON.parse(fs.readFileSync(path.join(pastaSfu, 'chaves.json'), 'utf8'));
    const senha = crypto.createHmac('sha256', apiSecret).update('metricas').digest('hex');
    const porta = Number(ambiente.SFU_METRICAS_PORT) || 7883;
    const resposta = await fetch(`http://127.0.0.1:${porta}/metrics`, {
      headers: { authorization: 'Basic ' + Buffer.from(`nexo-metricas:${senha}`).toString('base64') },
      signal: AbortSignal.timeout(4000)
    });
    const linhas = (await resposta.text()).split('\n').filter(linha => linha.startsWith('livekit_participant_total'));
    if (!linhas.length) return null;
    return linhas.reduce((soma, linha) => soma + Number(linha.trim().split(/\s+/).pop()), 0);
  } catch (_) { return null; }
}

participantes().then(gente => {
  console.log('@@ESTADO@@' + JSON.stringify({
    instalado: true,
    head: git('rev-parse', 'HEAD'),
    ramo: git('rev-parse', '--abbrev-ref', 'HEAD'),
    sujo: Boolean(git('status', '--porcelain', '--untracked-files=no')),
    versoes: lerJson(path.join(dist, 'versao.json'))?.sistemas || {},
    arquivos,
    participantes: gente,
    servicoAtivo: process.env.NEXO_ATIVO === 'true',
    ar: process.env.NEXO_AR === 'true',
    servidorPadrao: ambiente.NEXO_SERVIDOR_PADRAO || null,
    urlPublica: ambiente.PUBLIC_URL || null,
    lockDoApp: sha256(path.join(pasta, 'app', 'package-lock.json')),
    marcaDoApp: lerTexto(path.join(pasta, 'app', 'node_modules', '.nexo-lock')),
    node: process.version
  }));
});
JS
