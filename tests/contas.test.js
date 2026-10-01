// As contas são o primeiro dado insubstituível do Nexo, e o primeiro dado pessoal em disco.
// Cada teste aqui guarda uma decisão de docs/plano-contas.md ou de
// docs/seguranca-e-privacidade.md -- e a última guarda a mais cara delas: senha e banco sem
// atraso para nenhuma sala.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { criarContas, VALIDADE_DA_SESSAO, TOQUE_MINIMO, FilaCheia } = require('../contas');
const { abrirBanco, abrirConexao, migrar, lerMigracoes } = require('../contas/banco');
const { criarSenhas, lerGuardada } = require('../contas/senha');
const regras = require('../contas/regras');
const { ALFABETO } = require('../telemetria/relatos');

// A pasta só sai depois de o banco fechar: no Windows, apagar um arquivo aberto é EPERM.
// Quem abre algo nela registra o fechamento em `fechar`, e a limpeza roda por último.
function pastaTemporaria(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-contas-teste-'));
  const fechar = [];
  t.after(async () => {
    for (const fn of fechar.reverse()) await fn();
    fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { pasta, aoFechar: fn => fechar.push(fn) };
}

// Relógio controlado: sessão tem prazo de 30 dias e toque a cada 5 minutos, e esperar isso
// num teste não é opção.
function comContas(t, opcoes = {}) {
  let instante = 1_780_000_000_000;
  const { pasta, aoFechar } = pastaTemporaria(t);
  const contas = criarContas({ arquivo: path.join(pasta, 'nexo.db'), agora: () => instante, manutencao: false, proteger: false, ...opcoes });
  aoFechar(() => contas.encerrar());
  return { contas, avancar: ms => { instante += ms; }, agora: () => instante };
}

const SENHA = 'cafe com pao no sabado';

test('o nome de usuário é único, sem maiúsculas, e só com o que qualquer teclado digita', () => {
  assert.equal(regras.normalizarUsuario('  @Ana.Silva '), 'ana.silva');
  assert.equal(regras.problemaDoUsuario('ana.silva'), null);
  assert.equal(regras.problemaDoUsuario('an'), 'tamanho');
  assert.equal(regras.problemaDoUsuario('ana silva'), 'caracteres');
  assert.equal(regras.problemaDoUsuario('ána'), 'caracteres');
  assert.equal(regras.problemaDoUsuario('.ana'), 'pontos');
  assert.equal(regras.problemaDoUsuario('ana..silva'), 'pontos');
  assert.equal(regras.problemaDoUsuario('nexo'), 'reservado');
});

// "Senha@123" é o que regras de maiúscula e símbolo produzem. O que se recusa aqui é o que
// qualquer pessoa tentaria primeiro -- e o tamanho, que é o que de fato pesa.
test('a senha tem 10 ou mais caracteres e não pode ser o primeiro palpite de ninguém', () => {
  assert.equal(regras.problemaDaSenha(SENHA), null);
  assert.equal(regras.problemaDaSenha('curta123'), 'curta');
  assert.equal(regras.problemaDaSenha('1234567890'), 'comum');
  assert.equal(regras.problemaDaSenha('Flamengo2026'), 'comum');
  assert.equal(regras.problemaDaSenha('@Senha12345!'), 'comum');
  assert.equal(regras.problemaDaSenha('aaaaaaaaaaaa'), 'repetitiva');
  assert.equal(regras.problemaDaSenha('abcdefghijkl'), 'repetitiva');
  // O próprio usuário com o ano em volta é o segundo palpite de quem conhece a pessoa; uma
  // frase que só o contém, não.
  assert.equal(regras.problemaDaSenha('ana.silva2026', { usuario: 'ana.silva' }), 'pessoal');
  assert.equal(regras.problemaDaSenha('Ana Paula 1990', { apelido: 'Ana Paula' }), 'pessoal');
  assert.equal(regras.problemaDaSenha('ana.silva gosta de cafe', { usuario: 'ana.silva' }), null);
  assert.equal(regras.problemaDaSenha('x'.repeat(129)), 'longa');
});

test('o apelido perde controles e marcas de direção, e não passa de 40 caracteres', () => {
  assert.equal(regras.limparApelido('  Ana   ‮Silva\u0007 '), 'Ana Silva');
  assert.equal([...regras.limparApelido('🎮'.repeat(60))].length, 40);
  assert.equal(regras.limparApelido('​ ‎'), '');
});

// Sem STRICT o SQLite guarda texto numa coluna INTEGER sem reclamar -- medido --, e é
// exatamente a linha que o Postgres recusaria na importação, anos depois de gravada.
test('as tabelas são STRICT: o tipo errado é recusado na hora', () => {
  const db = abrirConexao(':memory:', { principal: true });
  migrar(db);
  assert.throws(() => db.prepare(`INSERT INTO conta (id, codigo, usuario, apelido, criada_em, vista_em)
    VALUES ('x', 'AAAAAAAA', 'ana', 'Ana', 'ontem', 0)`).run(), /cannot store TEXT value in INTEGER column/);
  assert.throws(() => db.prepare(`INSERT INTO conta (id, codigo, usuario, apelido, plano, criada_em, vista_em)
    VALUES ('x', 'AAAAAAAA', 'ana', 'Ana', 'vitalicio', 0, 0)`).run(), /CHECK constraint failed/);
  db.close();
});

test('as PRAGMAs que o plano exige estão ligadas na conexão principal', t => {
  const { pasta, aoFechar } = pastaTemporaria(t);
  const banco = abrirBanco({ arquivo: path.join(pasta, 'nexo.db') });
  aoFechar(() => banco.fechar());
  const db = abrirConexao(banco.arquivo, { principal: true });
  aoFechar(() => db.close());
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'sem isto o apagar da conta deixaria perfil e sessões para trás');
  assert.equal(db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint, 0);
  assert.equal(banco.versao, 3, 'a migração 3 traz o rosto de cada pessoa no Estúdio');
});

// A migração 3 refaz a tabela das imagens (o CHECK do uso não muda no lugar): um banco que já
// tinha foto e imagens do Estúdio chega à versão 3 com tudo, e aceita o uso novo.
test('a migração 3 refaz a tabela das imagens sem perder nenhuma', t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-migracao-3-'));
  const db = abrirConexao(path.join(pasta, 'nexo.db'), { principal: true });
  // O banco fecha antes de a pasta sair: aberto, o Windows recusa apagar o arquivo.
  t.after(() => { if (db.isOpen) db.close(); fs.rmSync(pasta, { recursive: true, force: true }); });
  const todas = lerMigracoes();
  assert.equal(migrar(db, todas.filter(m => m.versao <= 2)), 2);
  db.prepare("INSERT INTO conta (id, codigo, usuario, apelido, senha, recuperacao, criada_em, vista_em) VALUES ('c1', 'K7M2PQ4X', 'ana', 'Ana', 's', 'r', 1, 1)").run();
  db.prepare("INSERT INTO perfil (conta_id, avatar) VALUES ('c1', 'a1')").run();
  const inserir = db.prepare('INSERT INTO imagem (id, conta_id, uso, tipo, tamanho, bytes, criada_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
  inserir.run('a1', 'c1', 'avatar', 'image/png', 3, Buffer.from([1, 2, 3]), 1);
  inserir.run('e1', 'c1', 'estudio', 'image/gif', 2, Buffer.from([4, 5]), 2);
  assert.throws(() => inserir.run('r0', 'c1', 'rosto', 'image/png', 1, Buffer.from([6]), 3), /CHECK/, 'na versão 2 o rosto ainda não existe');

  assert.equal(migrar(db, todas), 3);
  assert.deepEqual(db.prepare('SELECT id, uso, tamanho FROM imagem ORDER BY id').all().map(l => ({ ...l })), [
    { id: 'a1', uso: 'avatar', tamanho: 3 }, { id: 'e1', uso: 'estudio', tamanho: 2 }
  ]);
  inserir.run('r1', 'c1', 'rosto', 'image/png', 1, Buffer.from([6]), 3);
  assert.equal(db.prepare("SELECT rosto FROM perfil WHERE conta_id = 'c1'").get().rosto, '{}', 'o perfil começa sem rosto próprio');
  db.prepare("DELETE FROM conta WHERE id = 'c1'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM imagem').get().n, 0, 'o CASCADE continua levando as imagens com a conta');
});

test('cadastrar devolve a conta, uma sessão e o código de recuperação, que é guardado só como scrypt', async t => {
  const { contas } = comContas(t);
  const r = await contas.cadastrar({ usuario: 'Ana', apelido: 'Ana 🎮', senha: SENHA, agente: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.conta.usuario, 'ana');
  assert.equal(r.conta.apelido, 'Ana 🎮');
  assert.match(r.recuperacao, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  const guardada = contas.banco.contaPorId(r.conta.id);
  assert.ok(lerGuardada(guardada.senha), 'a senha é guardada no formato scrypt$N$r$p$sal$derivada');
  assert.ok(!guardada.senha.includes(SENHA) && !guardada.recuperacao.includes(r.recuperacao.replace(/-/g, '')));
  assert.equal(contas.banco.sessoesDaConta(r.conta.id)[0].aparelho, 'Chrome · Windows', 'o aparelho é um resumo, não o agente inteiro');
  const repetido = await contas.cadastrar({ usuario: 'ANA', senha: SENHA });
  assert.equal(repetido.status, 409);
});

test('o código da conta é permanente, único e feito para ser ditado', async t => {
  const { contas } = comContas(t);
  const a = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const b = await contas.cadastrar({ usuario: 'bia', senha: SENHA });
  for (const r of [a, b]) {
    assert.equal(r.conta.codigo.length, 8);
    assert.ok([...r.conta.codigo].every(c => ALFABETO.includes(c)), 'sem 0/O/1/I/L');
  }
  assert.notEqual(a.conta.codigo, b.conta.codigo);
  assert.equal(contas.publica(a.conta).codigo, `${a.conta.codigo.slice(0, 4)}-${a.conta.codigo.slice(4)}`);
  // Trocar o que é da pessoa não troca quem ela é.
  await contas.trocarSenha(a.conta, '', { atual: SENHA, nova: 'outra frase qualquer aqui' });
  contas.banco.trocarApelido(a.conta.id, 'Aninha');
  assert.equal(contas.banco.contaPorId(a.conta.id).codigo, a.conta.codigo);
  assert.equal(typeof contas.banco.trocarCodigo, 'undefined', 'não existe caminho para mudar o código');
});

test('uma colisão de código sorteia outro, em vez de falhar o cadastro', async t => {
  const { contas } = comContas(t);
  const original = regras.gerarCodigo;
  const sorteios = ['AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB'];
  regras.gerarCodigo = () => sorteios.shift();
  t.after(() => { regras.gerarCodigo = original; });
  const a = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const b = await contas.cadastrar({ usuario: 'bia', senha: SENHA });
  assert.equal(a.conta.codigo, 'AAAAAAAA');
  assert.equal(b.conta.codigo, 'BBBBBBBB');
});

// Três Anas com senha, e o login não pode dizer quais delas existem.
test('usuário inexistente e senha errada recebem a mesma resposta', async t => {
  const { contas } = comContas(t);
  await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const errada = await contas.entrar({ usuario: 'ana', senha: 'senha errada de novo' });
  const inexistente = await contas.entrar({ usuario: 'ninguem', senha: 'senha errada de novo' });
  assert.deepEqual({ ...errada }, { ...inexistente });
  assert.equal(errada.status, 401);
  const certa = await contas.entrar({ usuario: '  ANA ', senha: SENHA });
  assert.equal(certa.ok, true);
});

test('a sessão vale 30 dias desde o último uso, e é tocada no máximo a cada 5 minutos', async t => {
  const { contas, avancar } = comContas(t);
  const { token, conta } = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const primeira = contas.banco.sessoesDaConta(conta.id)[0];
  avancar(TOQUE_MINIMO - 1000);
  assert.equal(contas.sessao(token).tocada, false);
  assert.equal(contas.banco.sessoesDaConta(conta.id)[0].ultimaEm, primeira.ultimaEm, 'nenhuma escrita antes de 5 minutos');
  avancar(2000);
  assert.equal(contas.sessao(token).tocada, true);
  const tocada = contas.banco.sessoesDaConta(conta.id)[0];
  assert.ok(tocada.expiraEm > primeira.expiraEm, 'usar a conta empurra o prazo');
  avancar(VALIDADE_DA_SESSAO - 1000);
  assert.ok(contas.sessao(token), 'um dia antes do prazo ainda vale');
  avancar(VALIDADE_DA_SESSAO + 1);
  assert.equal(contas.sessao(token), null, 'passado o prazo, não vale');
});

test('sair revoga a sessão, e trocar a senha revoga as outras', async t => {
  const { contas } = comContas(t);
  const cadastro = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const outra = await contas.entrar({ usuario: 'ana', senha: SENHA });
  const atual = contas.sessao(cadastro.token);
  assert.equal((await contas.trocarSenha(atual.conta, atual.sessaoId, { atual: SENHA, nova: 'nova frase para a conta' })).ok, true);
  assert.ok(contas.sessao(cadastro.token), 'quem trocou continua dentro');
  assert.equal(contas.sessao(outra.token), null, 'as outras sessões caem');
  contas.sair(cadastro.token);
  assert.equal(contas.sessao(cadastro.token), null);
  assert.equal((await contas.entrar({ usuario: 'ana', senha: SENHA })).ok, false, 'a senha antiga não vale mais');
});

test('o código de recuperação vale uma vez, é trocado ao ser usado e derruba as sessões abertas', async t => {
  const { contas } = comContas(t);
  const cadastro = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const usado = await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao.toLowerCase().replace(/-/g, ' '), nova: 'recuperei a minha conta' });
  assert.equal(usado.ok, true, usado.error);
  assert.notEqual(usado.recuperacao, cadastro.recuperacao);
  assert.equal(contas.sessao(cadastro.token), null, 'quem tinha a sessão antiga pode ser quem tomou a senha');
  assert.ok(contas.sessao(usado.token));
  const deNovo = await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao, nova: 'tentando de novo agora' });
  assert.equal(deNovo.status, 401, 'o código antigo não vale uma segunda vez');
  assert.equal((await contas.entrar({ usuario: 'ana', senha: 'recuperei a minha conta' })).ok, true);
});

// O código volta de onde a pessoa o guardou. Antes, "Nexo: 3XB2-..." perdia o O e virava
// "NEX3XB2...": 23 caracteres, e a pessoa com o código certo na mão ouvia "não conferem".
test('o código de recuperação é achado no meio do que a pessoa anotou, e o erro diz o que falta', () => {
  const recuperacao = require('../public/recuperacao');
  assert.equal(recuperacao.ALFABETO, ALFABETO, 'o mesmo alfabeto dos códigos gerados');
  const codigo = '3XB2Y9CTWHT4EXJ2G6EY';
  const formatado = '3XB2-Y9CT-WHT4-EXJ2-G6EY';
  for (const anotado of [
    formatado, formatado.toLowerCase(), codigo, '3xb2 y9ct wht4 exj2 g6ey', `Nexo: ${formatado}`,
    `código de recuperação do Nexo -> ${formatado} (guardar!)`, '3XB2–Y9CT—WHT4‐EXJ2−G6EY', 'nexo: 3xb2 y9ct wht4 exj2 g6ey',
    '３XB2-Y9CT-WHT4-EXJ2-G6EY',
    `Nexo · código de recuperação\r\n\r\nConta: @ana\r\nCódigo: ${formatado}  (vale uma vez)\r\nGerado em: 23/09/2026 12:30:00\r\n`,
    // O mesmo arquivo depois de um campo de uma linha apagar as quebras.
    `Nexo · código de recuperaçãoConta: @anaCódigo: ${formatado}  (vale uma vez)Gerado em: 23/09/2026 12:30:00`
  ]) assert.equal(regras.lerRecuperacao(anotado).codigo, codigo, anotado);
  assert.equal(regras.lerRecuperacao('').problema, 'vazio');
  assert.equal(regras.lerRecuperacao('3XB2-Y9CT-WHT4-EXJ2-G6E').problema, 'tamanho');
  assert.match(regras.mensagemDaRecuperacao(regras.lerRecuperacao('3XB2-Y9CT-WHT4-EXJ2-G6E')), /tem 19/);
  assert.equal(regras.lerRecuperacao('3XB2-Y9CT-WHT4-EXJ2-G6EO').problema, 'caracteres', 'O, I, L, 0 e 1 não existem no código');
  assert.equal(regras.lerRecuperacao(`para ${codigo.match(/.{4}/g).join(' ')}`).problema, 'misturado', 'seis grupos: adivinhar qual sobra não é ler');
  assert.equal(regras.lerRecuperacao(`${formatado} ${formatado.replace('3', '4')}`).problema, 'misturado', 'dois códigos colados juntos');
});

test('código malformado e senha nova fraca não gastam as tentativas da conta', async t => {
  const { contas } = comContas(t);
  const cadastro = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  for (let i = 0; i < 12; i++) {
    assert.equal((await contas.recuperar({ usuario: 'ana', codigo: 'ABCD', nova: 'recuperei a minha conta' })).campo, 'codigo');
    assert.equal((await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao, nova: 'curta' })).campo, 'nova');
  }
  const certo = await contas.recuperar({ usuario: 'ana', codigo: `Nexo: ${cadastro.recuperacao}`, nova: 'recuperei a minha conta' });
  assert.equal(certo.ok, true, certo.error);
});

// Quem esqueceu a senha tenta entrar algumas vezes antes de lembrar do código. Com um balde
// só para login e recuperação, essas tentativas trancavam justamente a saída.
test('errar o login até o freio não tranca a recuperação', async t => {
  const { contas } = comContas(t);
  const cadastro = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  for (let i = 0; i < 12; i++) await contas.entrar({ usuario: 'ana', senha: `nao lembro mais ${i}` });
  assert.equal((await contas.entrar({ usuario: 'ana', senha: SENHA })).status, 429, 'o login está no freio');
  const r = await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao, nova: 'recuperei a minha conta' });
  assert.equal(r.ok, true, r.error);
});

test('a senha nova não pode ser o apelido, e isso só é dito a quem acertou o código', async t => {
  const { contas } = comContas(t);
  const cadastro = await contas.cadastrar({ usuario: 'ana', apelido: 'Ana Paula Souza', senha: SENHA });
  const semCodigo = await contas.recuperar({ usuario: 'ana', codigo: 'ABCD-EFGH-JKMN-PQRS-TUVW', nova: 'Ana Paula Souza' });
  assert.equal(semCodigo.status, 401, 'sem o código certo, a regra do apelido não fala');
  const comCodigo = await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao, nova: 'Ana Paula Souza' });
  assert.equal(comCodigo.campo, 'nova');
  assert.equal((await contas.recuperar({ usuario: 'ana', codigo: cadastro.recuperacao, nova: 'uma frase bem diferente' })).ok, true, 'o código não foi gasto pela recusa');
});

// O teto diário da rede é de contas criadas. Pedido recusado pela validação não é conta.
test('o teto de criação só é perguntado quando o pedido criaria uma conta', async t => {
  const { contas } = comContas(t);
  let perguntas = 0;
  const permitirCriacao = () => { perguntas++; return perguntas <= 1; };
  assert.equal((await contas.cadastrar({ usuario: 'a', senha: SENHA, permitirCriacao })).campo, 'usuario');
  assert.equal((await contas.cadastrar({ usuario: 'ana', senha: 'curta', permitirCriacao })).campo, 'senha');
  assert.equal(perguntas, 0);
  assert.equal((await contas.cadastrar({ usuario: 'ana', senha: SENHA, permitirCriacao })).ok, true);
  assert.equal((await contas.cadastrar({ usuario: 'ana', senha: SENHA, permitirCriacao })).status, 409, 'usuário ocupado também não pergunta');
  assert.equal(perguntas, 1);
  assert.equal((await contas.cadastrar({ usuario: 'bia', senha: SENHA, permitirCriacao })).status, 429);
});

test('apagar a conta pede a senha e leva perfil e sessões junto', async t => {
  const { contas } = comContas(t);
  const { conta, token } = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  assert.equal((await contas.apagar(conta, { senha: 'não é a senha dela' })).status, 401);
  assert.equal((await contas.apagar(conta, { senha: SENHA })).ok, true);
  assert.equal(contas.banco.contaPorId(conta.id), null);
  assert.equal(contas.banco.perfil(conta.id), null, 'ON DELETE CASCADE precisa de foreign_keys ligado');
  assert.deepEqual(contas.banco.sessoesDaConta(conta.id), []);
  assert.equal(contas.sessao(token), null);
});

// O servidor é a segunda tranca da lista fechada: mesmo um cliente modificado não consegue
// guardar, ligado à conta, o aparelho de alguém ou a lista de quem ele silenciou.
test('os ajustes guardados são só os da lista fechada, e a qualidade escolhida fica mesmo acima do plano', async t => {
  const { contas } = comContas(t);
  const { conta } = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const r = contas.salvarAjustes(conta, {
    qualidade: 'ultra', quadros: 60, pushToTalk: true, codec: 'av1',
    microfone: 'mic-123', camera: 'cam-456', audioPorPessoa: { bia: { voz: 0 } }, tokenAgenteAudio: 'a'.repeat(32), quadrosQualquer: 999
  });
  assert.equal(r.ok, true);
  assert.deepEqual(contas.perfil(conta).ajustes, { qualidade: 'ultra', codec: 'av1', quadros: 60, pushToTalk: true });
  assert.deepEqual(contas.salvarAjustes(conta, 'não é objeto').ajustes, {});
});

test('cor e marca só do conjunto pronto; o apelido muda, o código não', async t => {
  const { contas } = comContas(t);
  const { conta } = await contas.cadastrar({ usuario: 'ana', apelido: 'Ana', senha: SENHA });
  assert.equal(contas.salvarPerfil(conta, { cor: 'javascript:alert(1)' }).status, 400);
  assert.equal(contas.salvarPerfil(conta, { marca: '<img>' }).status, 400);
  assert.equal(contas.salvarPerfil(conta, { apelido: '   ' }).status, 400);
  const salvo = contas.salvarPerfil(conta, { apelido: 'Aninha', cor: 'menta', marca: 'lua' });
  assert.equal(salvo.ok, true);
  assert.equal(salvo.conta.apelido, 'Aninha');
  assert.equal(salvo.conta.codigo, conta.codigo);
  assert.deepEqual({ cor: salvo.perfil.cor, marca: salvo.perfil.marca }, { cor: 'menta', marca: 'lua' });
  // `null` volta ao padrão; ausente, mantém.
  const voltou = contas.salvarPerfil(conta, { cor: null });
  assert.deepEqual({ cor: voltou.perfil.cor, marca: voltou.perfil.marca }, { cor: null, marca: 'lua' });
});

// O direito de acesso e de portabilidade (LGPD, art. 18): tudo o que se guarda ligado à
// pessoa -- menos o que só serviria para atacar a conta.
test('baixar meus dados traz conta, perfil, ajustes e sessões, e nenhum hash', async t => {
  const { contas } = comContas(t);
  const { conta } = await contas.cadastrar({ usuario: 'ana', apelido: 'Ana', senha: SENHA, agente: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile' });
  contas.salvarPerfil(conta, { cor: 'coral' });
  contas.salvarAjustes(conta, { qualidade: 'economical' });
  const dados = contas.dados(conta);
  assert.equal(dados.conta.usuario, 'ana');
  assert.match(dados.conta.codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(dados.perfil.cor, 'coral');
  assert.deepEqual(dados.perfil.ajustes, { qualidade: 'economical' });
  assert.equal(dados.sessoes[0].aparelho, 'Chrome · Android');
  const texto = JSON.stringify(dados);
  assert.equal(texto.includes('scrypt$'), false);
  assert.equal(texto.includes(conta.id), false, 'o id interno não sai do servidor, nem para a própria pessoa');
});

// Por CONTA, além da origem: uma tentativa por IP a partir de mil IPs passaria por baixo de
// qualquer limite só por origem.
test('tentativas demais numa conta são recusadas, e as de outra conta continuam', async t => {
  const { contas } = comContas(t);
  await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  await contas.cadastrar({ usuario: 'bia', senha: SENHA });
  const respostas = [];
  for (let i = 0; i < 7; i++) respostas.push((await contas.entrar({ usuario: 'ana', senha: `errada numero ${i}` })).status);
  assert.deepEqual(respostas.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.ok(respostas.slice(5).every(s => s === 429), `depois do teto, 429: ${respostas}`);
  const certa = await contas.entrar({ usuario: 'ana', senha: SENHA });
  assert.equal(certa.status, 429, 'nem a senha certa passa enquanto o freio vale');
  assert.equal((await contas.entrar({ usuario: 'bia', senha: SENHA })).ok, true);
});

test('com a fila de derivação cheia, a recusa é imediata', async () => {
  const senhas = criarSenhas({ filaMaxima: 2 });
  const pedidos = Array.from({ length: 5 }, () => senhas.derivar('qualquer frase longa aqui').then(() => 'ok', e => e));
  const resultados = await Promise.all(pedidos);
  assert.equal(resultados.filter(r => r === 'ok').length, 3, 'uma rodando e duas na fila');
  assert.ok(resultados.filter(r => r instanceof FilaCheia).length === 2);
});

test('uma senha guardada com parâmetros antigos é derivada de novo no login', async t => {
  const antigos = criarSenhas({ parametros: { N: 2 ** 14, r: 8, p: 1, tamanho: 32 } });
  const { contas } = comContas(t);
  const { conta } = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  contas.banco.trocarSenha(conta.id, await antigos.derivar(SENHA));
  assert.equal(lerGuardada(contas.banco.contaPorId(conta.id).senha).N, 2 ** 14);
  assert.equal((await contas.entrar({ usuario: 'ana', senha: SENHA })).ok, true);
  assert.equal(lerGuardada(contas.banco.contaPorId(conta.id).senha).N, contas.senhas.parametros.N);
});

test('a cópia da manutenção é um banco que abre e tem as contas', async t => {
  const { pasta, aoFechar } = pastaTemporaria(t);
  const contas = criarContas({ arquivo: path.join(pasta, 'nexo.db'), proteger: false });
  const { conta } = await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const copia = await contas.copiarAgora();
  await contas.encerrar();
  assert.ok(fs.existsSync(copia));
  // Backup que nunca foi restaurado é esperança, não backup.
  const restaurado = abrirBanco({ arquivo: copia });
  aoFechar(() => restaurado.fechar());
  assert.equal(restaurado.contaPorUsuario('ana').codigo, conta.codigo);
});

// A decisão mais cara deste plano: senha e banco sem atraso entre salas. Com `scryptSync`,
// vinte logins pararam o laço por 571 ms, medido. Este teste confere a PROPRIEDADE -- o laço
// não para --, e não o texto do código: pega também qualquer outro travamento síncrono que
// alguém introduza no caminho do login depois.
test('uma rajada de 20 logins não segura o laço de eventos por 100 ms', async t => {
  const { contas } = comContas(t, { regrasDeLimite: { 'entrar-conta': { sessao: 1000, longa: [1000, 900000] }, 'entrar-global': { sessao: 1000 } } });
  await contas.cadastrar({ usuario: 'ana', senha: SENHA });
  const laco = monitorEventLoopDelay({ resolution: 10 });
  laco.enable();
  const respostas = await Promise.all(Array.from({ length: 20 }, () => contas.entrar({ usuario: 'ana', senha: SENHA }).catch(e => e)));
  laco.disable();
  const piorMs = laco.max / 1e6;
  assert.ok(piorMs < 100, `o laço parou ${piorMs.toFixed(1)} ms durante a rajada`);
  // Uma rodando e dezesseis na fila; as três que sobram são recusadas na hora, sem esperar.
  assert.equal(respostas.filter(r => r.ok).length, 17);
  assert.equal(respostas.filter(r => r instanceof FilaCheia).length, 3);
});
