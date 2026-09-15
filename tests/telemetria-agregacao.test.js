const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { agregar, normalizar, inicioDoDia } = require('../telemetria/agregacao');
const { criarGravador, lerRegistros } = require('../telemetria/armazenamento');
const { criarMedicao } = require('../medicao');
const { criarUso } = require('../telemetria/uso');

const fim = Date.parse('2026-09-14T16:01:00Z');
const registro = (sala, dados = {}) => ({ v: 2, t: new Date(fim).toISOString(), sala, segundos: 60, screen: 75000000, ...dados });
test('salas simultâneas somam a banda sem somar o relógio do servidor', () => {
  const resultado = agregar([registro('sala-a'), registro('sala-b')], [], { periodo: 'tudo', agora: fim });
  assert.equal(resultado.total, 150000000);
  assert.equal(resultado.mediaMbps, 20);
  assert.equal(resultado.picoMbps, 20);
  assert.equal(resultado.segundosComDados, 60);
  assert.equal(resultado.salas[0].mediaMbps, 10);
});
test('voz antiga permanece mista, música nova não é contada duas vezes', () => {
  const a = registro('antiga', { v: undefined, screen: 0, micAudio: 100, total: 999999 });
  const b = registro('nova', { screen: 0, micAudio: 30, musica: 70 });
  const r = agregar([a, b, a], [], { periodo: 'tudo', agora: fim });
  assert.equal(r.total, 200); assert.equal(r.fontes.vozMista, 100);
  assert.equal(r.fontes.micAudio, 30); assert.equal(r.fontes.musica, 70); assert.equal(r.legado, true);
});
test('valores inválidos não contaminam totais e o período indevido é recusado', () => {
  for (const screen of [-1, Infinity, '123', NaN]) assert.equal(normalizar(registro('sala', { screen })), null);
  assert.equal(normalizar(registro('../sala')), null);
  assert.throws(() => agregar([], [], { periodo: '__proto__' }));
  const r = agregar([registro('sala'), { x: 1 }], [], { periodo: '7d', agora: fim + 8 * 86400000 });
  assert.equal(r.total, 0); assert.equal(r.vazio, true);
});
test('hoje começa no fuso escolhido e corta proporcionalmente janelas de borda', () => {
  const agora = Date.parse('2026-09-14T04:01:00Z');
  assert.equal(inicioDoDia(agora, 'America/Cuiaba'), Date.parse('2026-09-14T04:00:00Z'));
  const r = agregar([registro('sala', { t: '2026-09-14T04:00:30Z', screen: 60 })], [], { periodo: 'hoje', agora, fuso: 'America/Cuiaba' });
  assert.equal(r.total, 30);
});
test('projeção usa cobertura e ociosidade, e recusa extrapolar meia hora para um mês', () => {
  const dados = [registro('sala')];
  const pouco = agregar(dados, [{ t: new Date(fim).toISOString(), segundos: 1800 }], { periodo: 'tudo', agora: fim });
  assert.equal(pouco.projecao.bytesMensais, null);
  const coberto = agregar(dados, [{ t: new Date(fim).toISOString(), segundos: 86400 }], { periodo: 'tudo', agora: fim });
  assert.equal(coberto.projecao.bytesMensais, 75000000 * 30);
  assert.equal(coberto.mediaMbps, 75000000 * 8 / 86400 / 1e6);
  const misturado = agregar([registro('antes', { t: new Date(fim - 2 * 86400000).toISOString() }), ...dados], [{ t: new Date(fim).toISOString(), segundos: 86400 }], { periodo: 'tudo', agora: fim });
  assert.equal(misturado.projecao.bytesMensais, null);
});
test('o gravador rotaciona, limita fila e o leitor tolera linha truncada', async t => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-agregacao-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  const arquivo = path.join(pasta, 'dados.jsonl');
  const gravador = criarGravador(arquivo, { teto: 200, filaMaxima: 200 });
  await gravador.gravar([{ id: 1, texto: 'a'.repeat(90) }]);
  await gravador.gravar([{ id: 2, texto: 'b'.repeat(90) }]);
  await fs.appendFile(arquivo, '{"truncado":');
  const lido = await lerRegistros(arquivo, { teto: 200 });
  assert.deepEqual(lido.registros.map(r => r.id), [1, 2]); assert.equal(lido.invalidos, 1);
  await gravador.gravar([{ texto: 'x'.repeat(1000) }]);
  assert.equal(gravador.estado().descartados, 1); assert.equal(gravador.estado().bytesNaFila, 0);
});
test('a medição limita a soma da amostra e nunca grava identidade do cliente', async t => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-medicao-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  let agora = fim - 60000;
  const arquivo = path.join(pasta, 'banda.jsonl'), m = criarMedicao({ arquivo, agora: () => agora, maximoSalas: 2 });
  m.registrar('sala', { v: 2, fontes: { screen: 2 ** 31, camera: 2 ** 31 }, nome: 'SEGREDO-DE-PESSOA' }, 3);
  m.registrar('antiga', { micAudio: 20 }, 2);
  m.registrarServidor('sala', 'soundboard', 500, 'entrada');
  agora += 60000; await m.gravar();
  const lido = await lerRegistros(arquivo);
  assert.equal(lido.registros[0].total, 2 ** 31); assert.equal(lido.registros[0].entrada, 500);
  assert.equal(lido.registros[1].vozMista, 20);
  assert.ok(!(await fs.readFile(arquivo, 'utf8')).includes('SEGREDO-DE-PESSOA'));
});
test('ocupação integra tempo por tamanho e duração sem persistir nomes', () => {
  let agora = 0; const uso = criarUso({ agora: () => agora });
  uso.entrar('pessoa-1', 'sala'); agora = 10000; uso.entrar('pessoa-2', 'sala');
  agora = 30000; uso.sair('pessoa-1'); agora = 60000; uso.sair('pessoa-2');
  const r = uso.fechar(); assert.equal(r.distribuicao['1'], 40); assert.equal(r.distribuicao['2'], 20);
  assert.equal(r.segundosPermanencia, 80); assert.equal(r.segundosSalas, 60); assert.equal(r.salasConcluidas, 1);
  assert.ok(!JSON.stringify(r).includes('pessoa-1'));
});
test('sobreposição de cobertura não dilui as médias horárias', () => {
  const observacoes = [{ t: new Date(fim).toISOString(), segundos: 60 }, { t: new Date(fim - 30000).toISOString(), segundos: 60 }];
  const r = agregar([registro('sala')], observacoes, { periodo: 'tudo', agora: fim });
  assert.equal(r.segundosObservados, 90);
  assert.equal(r.horas.reduce((s, h) => s + h.segundos, 0), 90);
});
test('a leitura isolada compartilha consultas em andamento e invalida o histórico', async t => {
  const { criarLeitorIsolado } = require('../telemetria/leitor-worker');
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-leitor-'));
  const leitor = criarLeitorIsolado({ pasta });
  t.after(async () => { await leitor.encerrar(); await fs.rm(pasta, { recursive: true, force: true }); });
  const arquivo = path.join(pasta, 'banda.jsonl');
  await fs.writeFile(arquivo, JSON.stringify(registro('uma')) + '\n');
  const consulta = leitor.consultar({ periodo: 'tudo' });
  assert.equal(consulta, leitor.consultar({ periodo: 'tudo' }));
  assert.equal((await consulta).total, 75000000);
  await fs.appendFile(arquivo, JSON.stringify(registro('outra')) + '\n'); leitor.invalidar();
  assert.equal((await leitor.consultar({ periodo: 'tudo' })).total, 150000000);
});
