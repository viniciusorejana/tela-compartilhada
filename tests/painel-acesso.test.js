const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { criarAutenticacao } = require('../telemetria/autenticacao');
const { instalarRotas } = require('../telemetria/rotas');
const { origemSegura, ipDoPedido } = require('../telemetria/origem');

async function preparar(t, opcoes = {}) {
  const app = express(), segredo = 'a'.repeat(43);
  const auth = criarAutenticacao({ segredo, ...opcoes });
  const rotas = instalarRotas(app, { auth, consultar: async () => ({ sala: 'SALA-SECRETA' }), instante: () => ({ sala: 'SALA-SECRETA' }) });
  const servidor = app.listen(0, '127.0.0.1'); await new Promise(r => servidor.once('listening', r));
  t.after(() => { rotas.encerrar(); servidor.closeAllConnections(); return new Promise(r => servidor.close(r)); });
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  async function entrar(chave = segredo) {
    return fetch(origem + '/painel/entrar', { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: chave }) });
  }
  return { origem, auth, entrar, segredo };
}
test('HTML, API, assets privados e SSE não vazam salas sem autenticação', async t => {
  const { origem } = await preparar(t);
  for (const caminho of ['/painel', '/painel/', '/painel/api/resumo', '/painel/api/eventos', '/painel/componentes.js', '/painel/index.html', '/painel/api/resumo?periodo=tudo']) {
    const r = await fetch(origem + caminho, { redirect: 'manual' });
    assert.ok([303, 401].includes(r.status), `${caminho}: ${r.status}`);
    assert.ok(!(await r.text()).includes('SALA-SECRETA'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const head = await fetch(origem + '/painel/api/resumo', { method: 'HEAD' }); assert.equal(head.status, 401);
});
test('cookie, CSRF, logout e expiração são aplicados a toda a superfície', async t => {
  let agora = Date.now(); const { origem, entrar } = await preparar(t, { agora: () => agora });
  assert.equal((await entrar('errada')).status, 401);
  const login = await entrar(); assert.equal(login.status, 200);
  const cabecalho = login.headers.get('set-cookie'); assert.match(cabecalho, /HttpOnly/); assert.match(cabecalho, /SameSite=Strict/);
  const Cookie = cabecalho.split(';')[0];
  const estado = await fetch(origem + '/painel/api/resumo', { headers: { Cookie } }); assert.equal((await estado.json()).sala, 'SALA-SECRETA');
  assert.equal((await fetch(origem + '/painel/sair', { method: 'POST', headers: { Cookie, Origin: origem } })).status, 403);
  const sessao = await (await fetch(origem + '/painel/api/sessao', { headers: { Cookie } })).json();
  assert.equal((await fetch(origem + '/painel/sair', { method: 'POST', headers: { Cookie, Origin: 'https://malicioso.invalid', 'X-Nexo-CSRF': sessao.csrf } })).status, 403);
  const saida = await fetch(origem + '/painel/sair', { method: 'POST', headers: { Cookie, Origin: origem, 'X-Nexo-CSRF': sessao.csrf } }); assert.equal(saida.status, 200);
  assert.equal((await fetch(origem + '/painel/api/resumo', { headers: { Cookie } })).status, 401);
  const novo = (await entrar()).headers.get('set-cookie').split(';')[0];
  agora += 31 * 60000;
  assert.equal((await fetch(origem + '/painel/api/eventos', { headers: { Cookie: novo } })).status, 401);
});
test('login limita tentativas e sessões sem criar mapas infinitos', async t => {
  const { entrar, auth } = await preparar(t, { maximo: 2 });
  assert.equal((await entrar()).status, 200); assert.equal((await entrar()).status, 200);
  assert.equal((await entrar()).status, 429); assert.equal(auth.tamanho(), 2);
  for (let i = 0; i < 9; i++) await entrar('errada');
  assert.equal((await entrar()).status, 429);
});
test('encaminhamento não confiável não transforma HTTP remoto em acesso seguro', () => {
  const publica = process.env.PUBLIC_URL, proxies = process.env.NEXO_PROXIES_CONFIAVEIS;
  try {
    process.env.PUBLIC_URL = 'https://nexo.example'; process.env.NEXO_PROXIES_CONFIAVEIS = '';
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: { host: 'nexo.example', 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4' } };
    assert.equal(origemSegura(req), null); assert.equal(ipDoPedido(req), '10.0.0.5');
    process.env.NEXO_PROXIES_CONFIAVEIS = '10.0.0.5'; assert.equal(origemSegura(req).segura, true); assert.equal(ipDoPedido(req), '1.2.3.4');
    req.headers['x-forwarded-for'] = 'inventado, 2.3.4.5'; assert.equal(ipDoPedido(req), '2.3.4.5');
  } finally { if (publica === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = publica; if (proxies === undefined) delete process.env.NEXO_PROXIES_CONFIAVEIS; else process.env.NEXO_PROXIES_CONFIAVEIS = proxies; }
});
