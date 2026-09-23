// As rotas da conta. A regra está em index.js; aqui fica só o que é HTTP: cookie, CSRF,
// origem, código de resposta.
//
// O cookie segue o formato do painel -- HttpOnly, SameSite=Strict, Secure atrás de HTTPS --,
// com duas diferenças: vale para o site inteiro (a sala precisa dele) e dura 30 dias desde o
// último uso, e não oito horas.
const express = require('express');
const crypto = require('node:crypto');
const { FilaCheia, VALIDADE_DA_SESSAO } = require('./index');
const { origemDaPaginaPermitida, pedidoSeguro } = require('../telemetria/origem');

const COOKIE = 'nexo_conta';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function tokenDoPedido(req) {
  const partes = String(req.headers?.cookie || '').split(';').map(p => p.trim());
  const valor = partes.find(p => p.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return TOKEN.test(valor || '') ? valor : null;
}

function cookie(req, valor, maxAge) {
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${pedidoSeguro(req) ? '; Secure' : ''}`;
}
const gravarCookie = (req, res, token) => res.append('Set-Cookie', cookie(req, token, Math.floor(VALIDADE_DA_SESSAO / 1000)));
const apagarCookie = (req, res) => res.append('Set-Cookie', cookie(req, '', 0));

const iguais = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

function instalarRotasDeContas(app, { contas, limitarOrigem = () => true }) {
  const json = express.json({ limit: 8 * 1024, strict: true });

  app.use('/api/conta', (req, res, next) => {
    // Resposta de conta nunca fica em cache de ninguém: ela diz quem está logado.
    res.set('Cache-Control', 'no-store');
    // Toda escrita exige a origem de uma página deste servidor. Com o cookie SameSite=Strict
    // isto é a segunda tranca, e não a primeira -- mas é a que continua valendo num navegador
    // antigo que ignore o SameSite.
    if (!['GET', 'HEAD'].includes(req.method) && !origemDaPaginaPermitida(req, { exigir: true })) {
      return res.status(403).json({ error: 'Pedido recusado.' });
    }
    next();
  });

  // Uma rota assíncrona que falha por fila cheia responde 429 na hora, em vez de esperar.
  const tratar = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(erro => {
    if (erro instanceof FilaCheia) return res.status(429).set('Retry-After', '2').json({ error: erro.message });
    next(erro);
  });
  const recusar = (res, r) => {
    if (r.segundos) res.set('Retry-After', String(r.segundos));
    return res.status(r.status || 400).json({ error: r.error, campo: r.campo || undefined });
  };
  const limitada = tipo => (req, res, next) => {
    if (!limitarOrigem(req, tipo)) return res.status(429).set('Retry-After', '60').json({ error: tipo === 'cadastrar' ? 'Muitas contas criadas a partir desta rede. Tente amanhã.' : 'Muitas tentativas desta rede. Aguarde alguns minutos.' });
    next();
  };

  // Lê a sessão e, quando ela foi tocada, renova o prazo do cookie junto com o do banco.
  function sessaoDoPedido(req, res) {
    const token = tokenDoPedido(req);
    const achada = contas.sessao(token);
    if (achada?.tocada) gravarCookie(req, res, token);
    return achada ? { ...achada, token } : null;
  }
  const autenticada = (req, res, next) => {
    const achada = sessaoDoPedido(req, res);
    if (!achada) return res.status(401).json({ error: 'Sua sessão terminou. Entre na conta de novo.' });
    if (!iguais(req.headers['x-nexo-csrf'], achada.csrf)) return res.status(403).json({ error: 'Pedido recusado. Recarregue a página.' });
    req.contaNexo = achada;
    next();
  };

  // "Quem sou eu" responde 200 mesmo sem conta. Sem conta é o estado normal da maioria das
  // visitas, e um 401 aqui encheria o console de toda página de um erro que não é erro.
  app.get('/api/conta/eu', (req, res) => {
    const achada = sessaoDoPedido(req, res);
    if (!achada) return res.json({ conta: null });
    res.json({ conta: contas.publica(achada.conta), csrf: achada.csrf });
  });

  app.post('/api/conta/cadastrar', limitada('cadastrar'), json, tratar(async (req, res) => {
    const { usuario, apelido, senha } = req.body || {};
    const r = await contas.cadastrar({ usuario, apelido, senha, agente: req.headers['user-agent'] });
    if (!r.ok) return recusar(res, r);
    gravarCookie(req, res, r.token);
    res.status(201).json({ conta: contas.publica(r.conta), csrf: contas.csrfDe(r.token), recuperacao: r.recuperacao });
  }));

  app.post('/api/conta/entrar', limitada('entrar'), json, tratar(async (req, res) => {
    const { usuario, senha } = req.body || {};
    const r = await contas.entrar({ usuario, senha, agente: req.headers['user-agent'] });
    if (!r.ok) return recusar(res, r);
    // Entrar de novo no mesmo navegador troca a sessão, em vez de acumular duas.
    contas.sair(tokenDoPedido(req));
    gravarCookie(req, res, r.token);
    res.json({ conta: contas.publica(r.conta), csrf: contas.csrfDe(r.token) });
  }));

  app.post('/api/conta/recuperar', limitada('recuperar'), json, tratar(async (req, res) => {
    const { usuario, codigo, nova } = req.body || {};
    const r = await contas.recuperar({ usuario, codigo, nova, agente: req.headers['user-agent'] });
    if (!r.ok) return recusar(res, r);
    if (r.suspensa) return res.json({ conta: null, recuperacao: r.recuperacao, suspensa: true });
    gravarCookie(req, res, r.token);
    res.json({ conta: contas.publica(r.conta), csrf: contas.csrfDe(r.token), recuperacao: r.recuperacao });
  }));

  // Sair não exige CSRF: o pior que um site de fora conseguiria é deslogar alguém, e exigir o
  // token aqui deixaria preso quem está com a sessão já vencida.
  app.post('/api/conta/sair', (req, res) => {
    contas.sair(tokenDoPedido(req));
    apagarCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/conta/senha', json, autenticada, tratar(async (req, res) => {
    const r = await contas.trocarSenha(req.contaNexo.conta, req.contaNexo.sessaoId, req.body || {});
    if (!r.ok) return recusar(res, r);
    res.json({ ok: true });
  }));

  app.post('/api/conta/recuperacao', json, autenticada, tratar(async (req, res) => {
    const r = await contas.novaRecuperacao(req.contaNexo.conta, req.body || {});
    if (!r.ok) return recusar(res, r);
    res.json({ recuperacao: r.recuperacao });
  }));

  app.post('/api/conta/apagar', json, autenticada, tratar(async (req, res) => {
    const r = await contas.apagar(req.contaNexo.conta, req.body || {});
    if (!r.ok) return recusar(res, r);
    apagarCookie(req, res);
    res.json({ ok: true });
  }));

  app.use('/api/conta', (erro, _req, res, _next) => {
    if (res.headersSent) return;
    if (erro?.type === 'entity.too.large') return res.status(413).json({ error: 'Pedido grande demais.' });
    if (erro?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Pedido inválido.' });
    console.error('Contas:', erro?.message || erro);
    res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' });
  });

  return { tokenDoPedido, sessaoDoPedido };
}

module.exports = { instalarRotasDeContas, tokenDoPedido, COOKIE };
