// Os níveis pelo servidor de verdade: o plano que a entrada devolve, o teto de pessoas que
// sobe com um assinante, e o atalho do painel que marca premium à mão.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

const SALA = 'squad-teste';
// Teto pequeno (2, e 3 com assinante) para caber num teste; a regra é a mesma de 25 e 50.
const comPlanos = (extra = {}) => iniciarServidor({ ambiente: { NEXO_PLANOS: '1', NEXO_PESSOAS_POR_SALA: '2,3', ...extra } });

async function entrar(servidor, t, cred) {
  assert.ok(cred.credencialSessao, `sem credencial: ${JSON.stringify(cred)}`);
  const socket = await conectarSocket(servidor.origem, cred.credencialSessao);
  t.after(socket.fechar);
  const entrada = await socket.pedir('join-room', SALA, 'ignorado', cred.identidade);
  assert.equal(entrada.ok, true, JSON.stringify(entrada));
  return { socket, entrada };
}

async function painel(servidor) {
  const login = await fetch(servidor.origem + '/painel/entrar', { method: 'POST', headers: { Origin: servidor.origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await servidor.chave() }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await (await fetch(servidor.origem + '/painel/api/sessao', { headers: { Cookie: cookie } })).json();
  return {
    listar: async (busca = '') => (await fetch(`${servidor.origem}/painel/api/contas?busca=${encodeURIComponent(busca)}`, { headers: { Cookie: cookie } })).json(),
    agir: async (codigo, corpo) => {
      const r = await fetch(`${servidor.origem}/painel/api/contas/${encodeURIComponent(codigo)}`, { method: 'POST', headers: { Cookie: cookie, Origin: servidor.origem, 'X-Nexo-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      return { status: r.status, dados: await r.json() };
    }
  };
}

test('a entrada devolve o plano de quem entra: sem conta, conta grátis', async t => {
  const servidor = await comPlanos(); t.after(servidor.encerrar);
  const anonimo = await servidor.credencial('Bia', SALA);
  assert.deepEqual({ nivel: anonimo.plano.nivel, ...anonimo.plano.limites }, { nivel: 'anonimo', altura: 720, quadros: 30 });
  const ana = await servidor.conta('ana', { sala: SALA });
  assert.deepEqual({ nivel: ana.plano.nivel, ...ana.plano.limites }, { nivel: 'gratis', altura: 720, quadros: 60 });
});

test('com os planos desligados (a janela de transição), todo mundo transmite como premium', async t => {
  const servidor = await iniciarServidor({ ambiente: { NEXO_PLANOS: '0' } }); t.after(servidor.encerrar);
  const anonimo = await servidor.credencial('Bia', SALA);
  assert.equal(anonimo.plano.nivel, 'premium');
  assert.equal(anonimo.plano.livre, true);
});

// O atalho da fase 3: premium à mão, com prazo, para quem pagar por PIX direto.
test('o painel marca premium com prazo, e quem está na sala recebe o plano novo na hora', async t => {
  const servidor = await comPlanos(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const { socket } = await entrar(servidor, t, ana);
  const p = await painel(servidor);
  const lista = await p.listar();
  assert.equal(lista.contagens.total, 1);
  assert.equal(lista.contas[0].usuario, 'ana');
  assert.equal(JSON.stringify(lista).includes('scrypt'), false, 'nada de hash no painel');
  assert.equal((await p.listar('não existe')).contas.length, 0);

  const r = await p.agir(ana.conta.codigo, { acao: 'premium', dias: 30 });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.conta.nivel, 'premium');
  assert.ok(r.dados.conta.planoAte > Date.now() + 29 * 86400000);
  await socket.esperar(m => m.includes('plano-atualizado') && m.includes('"nivel":"premium"'));
  const deNovo = await servidor.credencial('Ana', SALA, '', ana.cookie);
  assert.equal(deNovo.plano.nivel, 'premium');
  assert.equal((await p.listar()).contagens.premium, 1);

  const volta = await p.agir(ana.conta.codigo, { acao: 'gratis' });
  assert.equal(volta.dados.conta.nivel, 'gratis');
});

test('suspender pelo painel tira a conta da sala e de todos os aparelhos', async t => {
  const servidor = await comPlanos(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const { socket } = await entrar(servidor, t, ana);
  const p = await painel(servidor);
  assert.equal((await p.agir(ana.conta.codigo, { acao: 'suspender' })).status, 400, 'suspender pede um prazo');
  assert.equal((await p.agir(ana.conta.codigo, { acao: 'suspender', dias: 7 })).status, 200);
  await socket.esperar(m => m.includes('removido-da-sala') && m.includes('suspensa'));
  const eu = await (await fetch(servidor.origem + '/api/conta/eu', { headers: { Cookie: ana.cookie } })).json();
  assert.equal(eu.conta, null, 'a sessão da conta suspensa não vale mais');
  assert.equal((await p.agir(ana.conta.codigo, { acao: 'reativar' })).status, 200);
});

// "Quem entra conta a si mesmo", e a saída do assinante não remove ninguém.
test('o teto de pessoas sobe com um assinante; quando ele sai, ninguém é removido', async t => {
  const servidor = await comPlanos(); t.after(servidor.encerrar);
  const dona = await servidor.conta('dona', { sala: SALA });
  await entrar(servidor, t, dona);
  await entrar(servidor, t, await servidor.credencial('Bia', SALA));
  const cheia = await servidor.credencial('Caio', SALA);
  assert.equal(cheia.motivo, 'sala-cheia');
  assert.match(cheia.error, /2 pessoas.*sobe para 3/);

  const assinante = await servidor.conta('duda', { apelido: 'Duda' });
  const p = await painel(servidor);
  await p.agir(assinante.conta.codigo, { acao: 'premium' });
  const daDuda = await servidor.credencial('Duda', SALA, '', assinante.cookie);
  assert.ok(daDuda.credencialSessao, 'o assinante entra numa sala no teto base: é a presença dele que o aumenta');
  const duda = await entrar(servidor, t, daDuda);
  assert.equal(duda.entrada.plano.nivel, 'premium');

  duda.socket.fechar();
  await new Promise(resolve => setTimeout(resolve, 250));
  const depois = await servidor.credencial('Caio', SALA);
  assert.equal(depois.motivo, 'sala-cheia', 'sem assinante, a sala volta ao teto base -- e quem já estava continua');
});
