const express = require('express');
const path = require('node:path');
const { origemSegura } = require('./origem');

function instalarRotas(app, { auth, consultar, instante, pasta = path.join(__dirname, '..', 'painel') }) {
  const clientes = new Set();
  const periodos = ['hoje', '7d', '30d', 'tudo'];
  app.use('/painel', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    next();
  });
  app.get('/painel/entrar', (_req, res) => res.sendFile(path.join(pasta, 'entrada.html')));
  app.get('/painel/entrada.js', (_req, res) => res.sendFile(path.join(pasta, 'entrada.js')));
  app.get('/painel/entrada.css', (_req, res) => res.sendFile(path.join(pasta, 'entrada.css')));
  app.post('/painel/entrar', (req, res, next) => {
    const origem = origemSegura(req);
    if (!origem || req.headers.origin !== origem.origem) return res.status(403).json({ erro: 'Acesso recusado.' });
    next();
  }, express.json({ limit: 1024, strict: true }), (req, res, next) => auth.entrar(req, res).catch(next));
  app.get(['/painel', '/painel/'], async (req, res, next) => {
    await auth.atualizarChave();
    if (!auth.obter(req)) return res.redirect(303, '/painel/entrar');
    auth.exigir(req, res, () => res.sendFile(path.join(pasta, 'index.html')));
  });
  app.use('/painel', (req, res, next) => auth.exigir(req, res, next).catch(next));
  app.get('/painel/api/sessao', (req, res) => res.json({ csrf: req.sessaoPainel.csrf }));
  app.post('/painel/sair', auth.sair);
  app.post('/painel/atividade', (_req, res) => res.json({ ok: true }));
  app.get('/painel/api/resumo', async (req, res, next) => {
    const periodo = req.query.periodo || '7d';
    if (!periodos.includes(periodo)) return res.status(400).json({ erro: 'Período inválido.' });
    try { res.json(await consultar(periodo)); } catch (erro) { next(erro); }
  });
  app.get('/painel/api/eventos', (req, res) => {
    if (clientes.size >= 10 || [...clientes].filter(c => c.id === req.sessaoPainel.id).length >= 3) return res.status(429).json({ erro: 'Há painéis demais abertos.' });
    res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    const cliente = { req, res, id: req.sessaoPainel.id }; clientes.add(cliente);
    res.write(`event: atualizacao\ndata: ${JSON.stringify(instante())}\n\n`);
    req.on('close', () => clientes.delete(cliente));
  });
  for (const arquivo of ['painel.js', 'componentes.js', 'estado.js', 'painel.css']) app.get(`/painel/${arquivo}`, (_req, res) => res.sendFile(path.join(pasta, arquivo)));
  app.use('/painel', (_req, res) => res.status(404).json({ erro: 'Não encontrado.' }));
  app.use('/painel', (_erro, _req, res, _next) => { if (!res.headersSent) res.status(400).json({ erro: 'Não foi possível atender ao pedido.' }); });
  const timer = setInterval(async () => {
    if (!clientes.size) return;
    await auth.atualizarChave();
    const texto = `event: atualizacao\ndata: ${JSON.stringify(instante())}\n\n`;
    for (const cliente of clientes) {
      if (!auth.obter(cliente.req, false)) { cliente.res.write('event: encerrada\ndata: {}\n\n'); cliente.res.end(); clientes.delete(cliente); continue; }
      if (cliente.res.writableLength > 128 * 1024) { cliente.res.destroy(); clientes.delete(cliente); continue; }
      cliente.res.write(texto);
    }
  }, 10000); timer.unref?.();
  return { encerrar: () => { clearInterval(timer); for (const c of clientes) c.res.end(); clientes.clear(); }, conexoes: () => clientes.size };
}
module.exports = { instalarRotas };
