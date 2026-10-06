const express = require('express');
const path = require('node:path');
const { origemDoPainel } = require('./origem');

function instalarRotas(app, { auth, consultar, instante, relatos, contas = null, midia = null, pasta = path.join(__dirname, '..', 'painel') }) {
  const clientes = new Set();
  const periodos = ['hoje', '7d', '30d', 'tudo'];
  // A porta fecha antes de tudo: antes da chave, antes do cookie, antes de servir a própria
  // tela de login. Quem chega de fora não descobre sequer que existe um painel aqui -- daí
  // 404, e não 403. Um túnel ou proxy ligado publica esta porta na internet inteira, e
  // "protegido por uma chave" não é o mesmo que "não acessível".
  app.use('/painel', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    if (!origemDoPainel(req)) return res.status(404).type('text').send('Não encontrado.');
    next();
  });
  app.get('/painel/entrar', (_req, res) => res.sendFile(path.join(pasta, 'entrada.html')));
  app.get('/painel/entrada.js', (_req, res) => res.sendFile(path.join(pasta, 'entrada.js')));
  app.get('/painel/entrada.css', (_req, res) => res.sendFile(path.join(pasta, 'entrada.css')));
  app.post('/painel/entrar', (req, res, next) => {
    const origem = origemDoPainel(req);
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
  // Os relatos ficam FORA do resumo periódico, e isso é de propósito: o resumo viaja a cada
  // dez segundos para cada painel aberto, e carregar até cem relatórios técnicos nele
  // multiplicaria por dez o custo de manter o painel na tela. Aqui é uma busca própria, de
  // quem abriu a aba.
  app.get('/painel/api/relatos', async (_req, res, next) => {
    if (!relatos) return res.json({ relatos: [], ausente: true, total: 0 });
    try { res.json(await relatos.listar()); } catch (erro) { next(erro); }
  });
  // As contas, como os relatos, ficam fora do resumo periódico: é uma busca de quem abriu a
  // seção, paginada, e não algo que viaja a cada dez segundos para cada painel aberto.
  app.get('/painel/api/contas', (req, res, next) => {
    if (!contas) return res.json({ ausente: true, contas: [], contagens: null, cadastrosPorDia: [] });
    try { res.json(contas.listar({ busca: String(req.query.busca || '').slice(0, 64), antes: String(req.query.antes || '').slice(0, 16) })); }
    catch (erro) { next(erro); }
  });
  // Marcar o nível completo à mão (com ou sem prazo), voltar ao básico, suspender e reativar. A CSRF e a origem já
  // foram conferidas por `auth.exigir`, como em toda escrita do painel.
  app.post('/painel/api/contas/:codigo', express.json({ limit: 1024, strict: true }), (req, res) => {
    if (!contas) return res.status(404).json({ erro: 'Contas indisponíveis.' });
    const r = contas.agir(String(req.params.codigo || '').slice(0, 16), req.body || {});
    if (!r.ok) return res.status(r.status || 400).json({ erro: r.error });
    res.json({ conta: r.conta });
  });
  // A chave da tela por WebCodecs: o botão de pânico que tira o caminho novo de todo mundo.
  // Escrita como as das contas, com CSRF e origem já conferidas por `auth.exigir`.
  app.get('/painel/api/midia', (_req, res) => {
    if (!midia) return res.json({ ausente: true });
    res.json({ webcodecs: midia.estado() });
  });
  app.post('/painel/api/midia', express.json({ limit: 256, strict: true }), (req, res) => {
    if (!midia) return res.status(404).json({ erro: 'Chave de mídia indisponível.' });
    const r = midia.definir(req.body?.webcodecs);
    if (!r.ok) return res.status(r.status || 400).json({ erro: r.error });
    res.json({ webcodecs: r.estado });
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
