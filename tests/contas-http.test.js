// As contas pelo lado de fora: o servidor de verdade, com cookie, origem e CSRF. O que se
// afirma aqui é o que o navegador faz sozinho com um cookie -- e por isso não se testa sem HTTP.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

const SENHA = 'cafe com pao no sabado';

function cliente(origem) {
  let cookie = '';
  let csrf = '';
  async function pedir(caminho, { metodo = 'GET', corpo, origemDoPedido = origem, semCsrf = false } = {}) {
    const cabecalhos = { 'Content-Type': 'application/json' };
    if (cookie) cabecalhos.Cookie = cookie;
    if (origemDoPedido) cabecalhos.Origin = origemDoPedido;
    if (csrf && !semCsrf) cabecalhos['X-Nexo-CSRF'] = csrf;
    const r = await fetch(origem + caminho, { method: metodo, headers: cabecalhos, body: corpo ? JSON.stringify(corpo) : undefined });
    const definido = r.headers.get('set-cookie');
    if (definido) cookie = /Max-Age=0/.test(definido) ? '' : definido.split(';')[0];
    const dados = await r.json().catch(() => ({}));
    if (dados.csrf) csrf = dados.csrf;
    return { status: r.status, dados, definido };
  }
  return { pedir, cookie: () => cookie };
}

test('cadastrar e entrar põem a sessão num cookie HttpOnly, SameSite=Strict, e "eu" a reconhece', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  assert.equal((await ana.pedir('/api/conta/eu')).dados.conta, null, 'sem conta é o estado normal, e responde 200');
  const cadastro = await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'Ana', apelido: 'Ana', senha: SENHA } });
  assert.equal(cadastro.status, 201, JSON.stringify(cadastro.dados));
  assert.match(cadastro.definido, /^nexo_conta=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
  assert.ok(cadastro.dados.recuperacao);
  const eu = await ana.pedir('/api/conta/eu');
  assert.equal(eu.dados.conta.usuario, 'ana');
  assert.match(eu.dados.conta.codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(JSON.stringify(eu.dados).includes('scrypt'), false, 'nenhum hash sai do servidor');
  assert.equal((await ana.pedir('/api/conta/sair', { metodo: 'POST' })).status, 200);
  assert.equal((await ana.pedir('/api/conta/eu')).dados.conta, null);
  const entrada = await ana.pedir('/api/conta/entrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } });
  assert.equal(entrada.status, 200);
  assert.equal((await ana.pedir('/api/conta/eu')).dados.conta.usuario, 'ana');
});

// SameSite=Strict é a primeira tranca; esta é a segunda, e a que vale num navegador antigo.
test('escrever na conta exige a origem de uma página deste servidor, e o CSRF da sessão', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  const corpo = { usuario: 'ana', senha: SENHA };
  assert.equal((await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo, origemDoPedido: '' })).status, 403, 'sem Origin');
  assert.equal((await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo, origemDoPedido: 'https://mal.example' })).status, 403, 'Origin de fora');
  assert.equal((await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo })).status, 201);
  const semCsrf = await ana.pedir('/api/conta/senha', { metodo: 'POST', corpo: { atual: SENHA, nova: 'outra frase para a conta' }, semCsrf: true });
  assert.equal(semCsrf.status, 403, 'a sessão sozinha não basta para trocar a senha');
  const comCsrf = await ana.pedir('/api/conta/senha', { metodo: 'POST', corpo: { atual: SENHA, nova: 'outra frase para a conta' } });
  assert.equal(comCsrf.status, 200, JSON.stringify(comCsrf.dados));
});

test('a mesma resposta para usuário inexistente e senha errada, também pelo HTTP', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } });
  const outro = cliente(servidor.origem);
  const errada = await outro.pedir('/api/conta/entrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: 'nao e esta a senha' } });
  const inexistente = await outro.pedir('/api/conta/entrar', { metodo: 'POST', corpo: { usuario: 'fantasma', senha: 'nao e esta a senha' } });
  assert.deepEqual([errada.status, errada.dados], [inexistente.status, inexistente.dados]);
});

// O teto conta contas criadas. Antes contava pedidos, e três erros de digitação -- senha
// curta, senha comum, usuário inválido -- trancavam a rede até o dia seguinte.
test('criar conta tem teto diário por origem de rede, e erro de digitação não conta', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const cadastrar = corpo => cliente(servidor.origem).pedir('/api/conta/cadastrar', { metodo: 'POST', corpo }).then(r => r.status);
  assert.deepEqual([
    await cadastrar({ usuario: 'pessoa0', senha: 'curta' }),
    await cadastrar({ usuario: 'pessoa0', senha: '1234567890' }),
    await cadastrar({ usuario: 'p', senha: SENHA })
  ], [400, 400, 400]);
  const situacoes = [];
  for (let i = 0; i < 4; i++) situacoes.push(await cadastrar({ usuario: `pessoa${i}`, senha: SENHA }));
  assert.deepEqual(situacoes, [201, 201, 201, 429]);
});

test('recuperar pelo HTTP: código colado com rótulo entra, e malformado não gasta a cota da rede', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  const { dados } = await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } });
  await ana.pedir('/api/conta/sair', { metodo: 'POST' });
  const outro = cliente(servidor.origem);
  for (let i = 0; i < 8; i++) {
    const malformado = await outro.pedir('/api/conta/recuperar', { metodo: 'POST', corpo: { usuario: 'ana', codigo: dados.recuperacao.slice(0, -2), nova: 'recuperei a minha conta' } });
    assert.equal(malformado.status, 400);
    assert.equal(malformado.dados.campo, 'codigo');
    assert.match(malformado.dados.error, /tem 18/);
  }
  const certo = await outro.pedir('/api/conta/recuperar', { metodo: 'POST', corpo: { usuario: 'ana', codigo: `Nexo: ${dados.recuperacao}`, nova: 'recuperei a minha conta' } });
  assert.equal(certo.status, 200, JSON.stringify(certo.dados));
  assert.match(certo.dados.recuperacao, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  assert.equal((await outro.pedir('/api/conta/eu')).dados.conta.usuario, 'ana', 'a recuperação abre a sessão');
});

// A identidade de mídia vai para o token do LiveKit, para as webhooks e para os relatos. Se
// ela carregasse a conta, tudo isso viraria um histórico de quem esteve onde.
test('com conta, a sala usa o apelido da conta; a identidade de mídia continua sorteada', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'ana.silva', apelido: 'Ana', senha: SENHA } });
  const perfil = await ana.pedir('/api/conta/perfil', { metodo: 'PUT', corpo: { cor: 'menta', marca: 'lua' } });
  assert.equal(perfil.status, 200, JSON.stringify(perfil.dados));
  const codigo = perfil.dados.conta.codigo;

  const config = await ana.pedir('/api/sala-config?sala=squad-teste&nome=Nome%20digitado');
  assert.equal(config.dados.nome, 'Ana', 'o apelido da conta vence o campo de nome');
  assert.match(config.dados.identidade, /^Ana#[a-f0-9]{16}$/);
  const a = await conectarSocket(servidor.origem, config.dados.credencialSessao); t.after(a.fechar);
  const entradaDela = await a.pedir('join-room', 'squad-teste', 'forjado', 'forjado');
  // O cartão vai junto (docs/amigos-e-perfil.md): a vitrine que vale, a frase e as conquistas.
  const { cartao: cartaoDela, ...perfilDela } = entradaDela.perfil;
  assert.deepEqual(perfilDela, { conta: true, codigo, cor: 'menta', marca: 'lua', avatar: null, rosto: null });
  assert.equal(cartaoDela.vitrine.tema, 'nexo');
  assert.ok(cartaoDela.conquistas.includes('boas-vindas'));

  const bia = await servidor.credencial('Bia');
  const b = await conectarSocket(servidor.origem, bia.credencialSessao); t.after(b.fechar);
  const entrada = await b.pedir('join-room', 'squad-teste', 'Bia', bia.identidade);
  const anaNaLista = entrada.peers.find(p => p.name === 'Ana');
  const { cartao: _cartao, ...perfilNaLista } = anaNaLista.perfil;
  assert.deepEqual(perfilNaLista, { conta: true, codigo, cor: 'menta', marca: 'lua', avatar: null, rosto: null });
  const texto = JSON.stringify(entrada);
  assert.equal(texto.includes('ana.silva'), false, 'o nome de usuário não é mostrado à sala');
  assert.equal(texto.includes('contaId'), false, 'a conta fica no servidor');
  assert.equal(entrada.perfil, null, 'quem não tem conta não tem perfil');
});

test('baixar meus dados é um anexo JSON, e pede a sessão', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  assert.equal((await fetch(servidor.origem + '/api/conta/dados')).status, 401);
  const ana = cliente(servidor.origem);
  await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } });
  const r = await fetch(servidor.origem + '/api/conta/dados', { headers: { Cookie: ana.cookie() } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="nexo-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/);
  const dados = await r.json();
  assert.equal(dados.conta.usuario, 'ana');
  assert.equal(JSON.stringify(dados).includes('scrypt$'), false);
});

test('apagar a conta pelo HTTP pede a senha, apaga e desfaz o cookie', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = cliente(servidor.origem);
  await ana.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } });
  assert.equal((await ana.pedir('/api/conta/apagar', { metodo: 'POST', corpo: { senha: 'nao e a senha dela' } })).status, 401);
  const apagada = await ana.pedir('/api/conta/apagar', { metodo: 'POST', corpo: { senha: SENHA } });
  assert.equal(apagada.status, 200);
  assert.match(apagada.definido, /Max-Age=0/);
  assert.equal((await ana.pedir('/api/conta/eu')).dados.conta, null);
  const outra = cliente(servidor.origem);
  assert.equal((await outra.pedir('/api/conta/entrar', { metodo: 'POST', corpo: { usuario: 'ana', senha: SENHA } })).status, 401);
});

function abrirSocket(origem, cabecalhoOrigin) {
  return new Promise(resolve => {
    const ws = new WebSocket(origem.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', cabecalhoOrigin ? { origin: cabecalhoOrigin } : {});
    const fim = aberto => { ws.terminate(); resolve(aberto); };
    ws.once('message', dados => fim(String(dados).startsWith('0')));
    ws.once('unexpected-response', () => fim(false));
    ws.once('error', () => fim(false));
  });
}

// O ataque que isto fecha: um site qualquer, aberto por quem tem conta, abrindo o chat em
// nome dela. O WebSocket não passa por CORS, então a conferência é no aperto de mão.
test('o Socket.IO recusa página de outra origem e aceita a deste servidor', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  assert.equal(await abrirSocket(servidor.origem, 'https://mal.example'), false);
  assert.equal(await abrirSocket(servidor.origem, servidor.origem), true);
  assert.equal(await abrirSocket(servidor.origem, null), true, 'sem Origin não é navegador, e não carrega cookie sozinho');
});
