const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { criarAntiabuso } = require('../telemetria/abuso');
const { criarSessoes } = require('../telemetria/sessoes');
const { criarAlertas } = require('../telemetria/alertas');

test('spam é observado no servidor, recusado e perde identidade ao sair da janela', () => {
  let agora = 100000; const alertas = [];
  const a = criarAntiabuso({ agora: () => agora, aoAlertar: r => alertas.push(r) });
  const contexto = { sala: 'squad', nome: 'Ana' };
  for (let i = 0; i < 3; i++) assert.equal(a.verificar('sessao', 'medicao-de-banda', contexto).ok, true);
  assert.equal(alertas.length, 0);
  assert.equal(JSON.stringify(a.resumo()).includes('Ana'), false);
  assert.equal(a.verificar('sessao', 'medicao-de-banda', contexto).ok, false);
  assert.equal(alertas[0].nome, 'Ana'); assert.equal(alertas[0].acao, 'recusado');
  for (let i = 0; i < 1000; i++) a.verificar('sessao', 'medicao-de-banda', contexto);
  assert.equal(alertas.length, 1);
  agora += 66000; assert.equal(a.verificar('sessao', 'medicao-de-banda', contexto).ok, true);
  agora += 600001; a.limpar(); assert.equal(a.resumo().sessoes, 0);
});
test('nomes de eventos inventados e muitas sessões não crescem sem teto', () => {
  let agora = 100000; const a = criarAntiabuso({ agora: () => agora, maximo: 8, maximoSalas: 3 });
  for (let i = 0; i < 10000; i++) a.verificar(`sessao-${i}`, `inventado-${i}`, { sala: `sala-${i}` });
  const r = a.resumo(); assert.equal(r.sessoes, 8); assert.equal(r.taxas.length, 1); assert.ok(r.saturacoes > 0);
  assert.equal(a.verificar('mais-uma', 'join-room').ok, false);
  assert.equal(a.verificar('mais-uma', 'leave-room').ok, true);
  agora += 600001; a.limpar(); assert.equal(a.resumo().sessoes, 0);
});
test('eventos não são inflados por verificações internas e o incidente conserva seu ID', () => {
  let agora = 100000; const alertas = [];
  const a = criarAntiabuso({ agora: () => agora, aoAlertar: a => alertas.push(a) });
  a.contarEvento('sessao', 'chat-message');
  a.verificar('sessao', 'total'); a.verificar('sessao', 'chat-message'); a.verificar('sessao', 'chat-imagem');
  assert.equal(a.resumo().emissores[0].eventos, 1);
  assert.equal(a.resumo().taxasSocket[0].tentativas, 1);
  a.verificar('sessao', 'chat-bytes', {}, 5 * 1024 ** 2);
  agora += 61000; a.verificar('sessao', 'chat-bytes', {}, 5 * 1024 ** 2);
  assert.equal(alertas.length, 2); assert.equal(alertas[0].id, alertas[1].id);
});
test('uploads são cobrados por bytes lidos e sala cheia não acusa a última pessoa', () => {
  const alertas = []; const a = criarAntiabuso({ aoAlertar: r => alertas.push(r), regras: { 'soundboard-bytes': { sessao: 10, sala: 15 } } });
  assert.equal(a.verificar('s1', 'soundboard-bytes', { sala: 'sala', nome: 'Ana' }, 8).ok, true);
  assert.equal(a.verificar('s2', 'soundboard-bytes', { sala: 'sala', nome: 'Bia' }, 8).ok, false);
  assert.equal(alertas[0].nome, 'Limite coletivo da sala');
  assert.equal(alertas[0].quantidade, 16);
});
test('rajadas, cooldown e republicações têm tratamentos diferentes', () => {
  let agora = 100000; const alertas = []; const a = criarAntiabuso({ agora: () => agora, aoAlertar: r => alertas.push(r) });
  assert.equal(a.verificar('s', 'soundboard-tocar').ok, true);
  agora += 399; assert.equal(a.verificar('s', 'soundboard-tocar').ok, false);
  agora += 1; assert.equal(a.verificar('s', 'soundboard-tocar').ok, true);
  for (let i = 0; i < 6; i++) assert.equal(a.verificar('s', 'chat-message').ok, true);
  assert.equal(a.verificar('s', 'chat-message').ok, false);
  for (let i = 0; i < 5; i++) assert.equal(a.verificar('s', 'republicacao', { fonte: 'screen' }).ok, true);
  assert.ok(alertas.some(a => a.acao === 'observado'));
});
test('credencial privada mantém identidade ao reconectar e não aceita socket.id como prova', () => {
  let agora = 1000; const s = criarSessoes({ agora: () => agora, maximo: 2 });
  const a = s.emitir({ sala: 'sala', nome: 'Ana' });
  assert.equal(s.obter('socket-id-divulgado'), null);
  const retomada = s.emitir({ sala: 'sala', nome: 'Ana', credencial: a.credencial });
  assert.equal(retomada.sessao, a.sessao);
  assert.equal(s.emitir({ sala: 'sala', nome: 'Ana' }).sessao.identidade === a.sessao.identidade, false);
  assert.equal(s.emitir({ sala: 'outra', nome: 'Outra' }), null);
  const socket = { connected: true, disconnect() { this.connected = false; } }; assert.equal(s.associar(a.sessao, socket), true);
  const retomado = { connected: true };
  assert.equal(s.associar(a.sessao, retomado), true); assert.equal(socket.connected, false);
  s.soltar(a.sessao, socket); assert.equal(a.sessao.socket, retomado, 'saída atrasada não solta a sessão nova');
  s.soltar(a.sessao, retomado); agora += 600001; s.limpar(); assert.equal(s.tamanho(), 0);
});
test('alertas têm teto e nomes expirados são retirados também do disco', async t => {
  let agora = Date.now(); const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-alertas-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  const a = criarAlertas({ pasta, agora: () => agora, maximo: 2 }); await a.pronto;
  for (let i = 0; i < 10; i++) a.adicionar({ id: i, t: new Date(agora).toISOString(), nome: 'Ana', conteudo: 'CONTEUDO-PRIVADO', acao: 'recusado' });
  await a.gravar(); assert.equal(a.listar().length, 2);
  assert.ok(!(await fs.readFile(path.join(pasta, 'alertas.jsonl'), 'utf8')).includes('CONTEUDO-PRIVADO'));
  agora += 8 * 86400000; await a.gravar(); assert.equal(a.listar().length, 0);
  assert.ok(!(await fs.readFile(path.join(pasta, 'alertas.jsonl'), 'utf8')).includes('Ana'));
});
