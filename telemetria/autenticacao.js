const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hash } = require('./sessoes');
const { origemDoPainel, ipDoPedido } = require('./origem');

const PASTA_PRIVADA = path.resolve(process.env.NEXO_PASTA_PAINEL || path.join(__dirname, '..', 'native', 'painel'));
const ARQUIVO_CHAVE = path.join(PASTA_PRIVADA, 'segredo.json');
const COOKIE = 'nexo_painel';
const iguais = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(String(a))), Buffer.from(hash(String(b))));

// Pelo nome, quem resolve é o PATH -- e no Git Bash, no MSYS e no Cygwin existe um
// "whoami.exe" de coreutils que vem ANTES do binário do Windows e recusa estes argumentos.
// A ACL falhava, a chave nunca era criada, e o painel respondia 401 para sempre sem dizer
// por quê. O caminho absoluto tira o PATH da decisão.
const SISTEMA32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const WHOAMI = path.join(SISTEMA32, 'whoami.exe');
const ICACLS = path.join(SISTEMA32, 'icacls.exe');

function protegerPasta(pasta) {
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') { fs.chmodSync(pasta, 0o700); return; }
  // mode: 0600 não separa usuários no Windows. A ACL é aplicada só à pasta criada
  // para este painel, nunca à árvore de mídia nem à pasta inteira do projeto.
  const resposta = execFileSync(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const sid = resposta.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
  if (!sid) throw new Error('Não foi possível identificar o proprietário do painel.');
  execFileSync(ICACLS, [pasta, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true, timeout: 5000 });
}
function prepararChave(arquivo = ARQUIVO_CHAVE, { rotacionar = false } = {}) {
  protegerPasta(path.dirname(arquivo));
  if (rotacionar || !fs.existsSync(arquivo)) {
    const segredo = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(arquivo, JSON.stringify({ segredo }, null, 2) + '\r\n', { flag: rotacionar ? 'w' : 'wx', mode: 0o600 });
  }
  if (process.platform !== 'win32') fs.chmodSync(arquivo, 0o600);
  const { segredo } = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (typeof segredo !== 'string' || !/^[\w-]{43}$/.test(segredo)) throw new Error('A chave do painel está inválida; use o comando local de rotação.');
  return segredo;
}
function criarAutenticacao({ segredo, arquivo = ARQUIVO_CHAVE, agora = Date.now, maximo = 5 } = {}) {
  let chave = segredo || null, falha = null, ultimaLeitura = -Infinity, leitura = null, protecaoFalhou = false;
  const sessoes = new Map(), tentativas = new Map();
  let global = { inicio: agora(), total: 0 };
  try { if (!chave) chave = prepararChave(arquivo); }
  catch (_) { protecaoFalhou = true; falha = 'O painel não conseguiu proteger ou ler sua chave local. Corrija a pasta e reinicie o servidor.'; }
  async function atualizarChave() {
    if (protecaoFalhou || segredo || agora() - ultimaLeitura < 10000) return;
    if (leitura) return leitura;
    ultimaLeitura = agora();
    leitura = fsp.readFile(arquivo, 'utf8').then(texto => {
      const proxima = JSON.parse(texto).segredo;
      if (typeof proxima !== 'string' || !/^[\w-]{43}$/.test(proxima)) throw new Error();
      if (chave && !iguais(chave, proxima)) sessoes.clear();
      chave = proxima; falha = null;
    }).catch(() => { falha = 'Chave indisponível.'; sessoes.clear(); }).finally(() => { leitura = null; });
    return leitura;
  }
  function limpar() {
    for (const [id, s] of sessoes) if (agora() > s.ate || agora() - s.ultimo > 30 * 60000) sessoes.delete(id);
    for (const [id, s] of tentativas) if (agora() - s.inicio > 10 * 60000) tentativas.delete(id);
  }
  function permitiuTentativa(req) {
    limpar();
    if (agora() - global.inicio > 60000) global = { inicio: agora(), total: 0 };
    if (++global.total > 60) return false;
    const id = hash(ipDoPedido(req));
    let item = tentativas.get(id);
    if (!item) { if (tentativas.size >= 2048) return false; item = { inicio: agora(), total: 0 }; tentativas.set(id, item); }
    return ++item.total <= 10;
  }
  function cookie(req) {
    const partes = String(req.headers.cookie || '').split(';').map(p => p.trim());
    const valor = partes.find(p => p.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return /^[\w-]{43}$/.test(valor || '') ? hash(valor) : null;
  }
  function obter(req, tocar = true) {
    limpar();
    const id = cookie(req), sessao = id && sessoes.get(id);
    if (!sessao || falha) return null;
    if (tocar) sessao.ultimo = agora();
    return { ...sessao, id };
  }
  function cabecalhoCookie(valor, segura, apagar = false) {
    return `${COOKIE}=${valor}; Path=/painel; HttpOnly; SameSite=Strict; ${apagar ? 'Max-Age=0' : 'Max-Age=28800'}${segura ? '; Secure' : ''}`;
  }
  async function entrar(req, res) {
    const origem = origemDoPainel(req);
    if (!origem || req.headers.origin !== origem.origem) return res.status(403).json({ erro: 'Acesso recusado.' });
    if (!permitiuTentativa(req)) return res.status(429).set('Retry-After', '600').json({ erro: 'Aguarde antes de tentar novamente.' });
    await atualizarChave();
    if (falha || !chave || typeof req.body?.segredo !== 'string' || !iguais(chave, req.body.segredo)) return res.status(401).json({ erro: 'Acesso recusado.' });
    limpar();
    const existente = cookie(req); if (existente) sessoes.delete(existente);
    if (sessoes.size >= maximo) return res.status(429).json({ erro: 'Há sessões demais. Encerre uma sessão ou aguarde sua expiração.' });
    const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(24).toString('base64url');
    sessoes.set(hash(token), { csrf, ultimo: agora(), ate: agora() + 8 * 3600000 });
    res.set('Set-Cookie', cabecalhoCookie(token, origem.segura)).json({ ok: true });
  }
  async function exigir(req, res, next) {
    await atualizarChave();
    const origem = origemDoPainel(req);
    if (!origem) return res.status(403).json({ erro: 'Acesso recusado.' });
    const sessao = obter(req, !req.path.endsWith('/eventos'));
    if (!sessao) return res.status(401).json({ erro: 'Autenticação necessária.' });
    if (!['GET', 'HEAD'].includes(req.method) && (req.headers.origin !== origem.origem || !iguais(req.headers['x-nexo-csrf'] || '', sessao.csrf))) return res.status(403).json({ erro: 'Acesso recusado.' });
    req.sessaoPainel = sessao; next();
  }
  function sair(req, res) {
    sessoes.delete(cookie(req));
    res.set('Set-Cookie', cabecalhoCookie('', Boolean(origemDoPainel(req)?.segura), true)).json({ ok: true });
  }
  return { entrar, exigir, sair, obter, atualizarChave, falha: () => falha, tamanho: () => sessoes.size };
}
module.exports = { criarAutenticacao, prepararChave, protegerPasta, ARQUIVO_CHAVE, PASTA_PRIVADA };
