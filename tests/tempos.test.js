// O relógio da sala e o de cada pessoa. A regra de produto é "o tempo é da pessoa, não da
// aba": um F5 ou uma queda curta não pode zerar a hora de conversa de ninguém.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarTempos, chaveDeTempo, TOLERANCIA_DE_VOLTA_MS } = require('../tempos');

// Relógio de mentira: a tolerância é de minutos, e esperar isso num teste não é opção.
function comRelogio(opcoes = {}) {
  let instante = 1_000_000;
  const tempos = criarTempos({ agora: () => instante, ...opcoes });
  return { tempos, andar: ms => { instante += ms; }, agora: () => instante };
}

test('a sala abre na primeira entrada, e o relógio dela não recomeça com quem chega depois', () => {
  const { tempos, andar, agora } = comRelogio();
  const abertura = agora();
  assert.equal(tempos.abertaEm('squad'), null, 'consultar não abre sala nenhuma');
  tempos.entrou('squad', 'conta:1', 's1');
  andar(40 * 60000);
  const desdeDaBia = tempos.entrou('squad', 'anon:bia', 's2');
  assert.equal(tempos.abertaEm('squad'), abertura);
  assert.equal(desdeDaBia, agora(), 'quem chega depois começa o próprio relógio agora');
  assert.equal(tempos.desde('squad', 'conta:1'), abertura, 'e o de quem já estava não muda');
});

test('o F5 não zera o relógio: a pessoa volta com o mesmo "desde"', () => {
  const { tempos, andar } = comRelogio();
  const desde = tempos.entrou('squad', 'conta:1', 's1');
  andar(25 * 60000);
  tempos.saiu('squad', 'conta:1', 's1');
  andar(4000);
  assert.equal(tempos.entrou('squad', 'conta:1', 's2'), desde);
});

// A aba nova costuma entrar ANTES de a velha perceber que caiu. Nesse intervalo a pessoa tem
// duas conexões, e a saída da velha não pode marcar a pessoa como fora.
test('duas conexões da mesma pessoa: ela só sai quando a última sai', () => {
  const { tempos, andar } = comRelogio();
  const desde = tempos.entrou('squad', 'anon:ana', 's1');
  tempos.entrou('squad', 'anon:ana', 's2');
  tempos.saiu('squad', 'anon:ana', 's1');
  andar(TOLERANCIA_DE_VOLTA_MS * 2);
  tempos.entrou('squad', 'anon:outra', 's3');   // a faxina roda aqui
  assert.equal(tempos.desde('squad', 'anon:ana'), desde, 'continua lá: a segunda conexão nunca saiu');
});

test('quem some por mais que a tolerância começa de novo ao voltar', () => {
  const { tempos, andar, agora } = comRelogio();
  const primeira = tempos.entrou('squad', 'anon:ana', 's1');
  tempos.saiu('squad', 'anon:ana', 's1');
  andar(TOLERANCIA_DE_VOLTA_MS - 1000);
  assert.equal(tempos.entrou('squad', 'anon:ana', 's2'), primeira, 'dentro da tolerância, retoma');
  tempos.saiu('squad', 'anon:ana', 's2');
  andar(TOLERANCIA_DE_VOLTA_MS + 1000);
  assert.equal(tempos.entrou('squad', 'anon:ana', 's3'), agora(), 'fora dela, é outra conversa');
});

test('a sala fechada esquece tudo, e reabrir começa do zero', () => {
  const { tempos, andar, agora } = comRelogio();
  tempos.entrou('squad', 'conta:1', 's1');
  andar(60000);
  tempos.fechou('squad');
  assert.equal(tempos.abertaEm('squad'), null);
  assert.equal(tempos.desde('squad', 'conta:1'), null);
  andar(1000);
  tempos.entrou('squad', 'conta:1', 's2');
  assert.equal(tempos.abertaEm('squad'), agora());
  assert.equal(tempos.salas(), 1);
});

test('a chave: a conta vence, o sorteio só no formato exato, e a identidade é o último recurso', () => {
  const sorteio = 'a'.repeat(32);
  assert.equal(chaveDeTempo({ contaId: 7, identidade: 'Ana#1', sorteio }), 'conta:7');
  assert.equal(chaveDeTempo({ identidade: 'Ana#1', sorteio }), `anon:${sorteio}`);
  assert.equal(chaveDeTempo({ identidade: 'Ana#1', sorteio: 'conta:7' }), 'id:Ana#1', 'um sorteio forjado não vira a chave de ninguém');
  assert.equal(chaveDeTempo({ identidade: 'Ana#1', sorteio: 'A'.repeat(32) }), 'id:Ana#1');
});
