// O ciclo de vida da sala: quem abre, quanto ela espera vazia, e o que some quando fecha.
// São regras de produto -- "só conta abre sala", "o link morre com a sala" -- escritas como
// código, e é aqui que elas ficam afirmadas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarSalas } = require('../salas');

// Relógio de mentira: a carência é de 60 segundos, e esperar isso num teste não é opção.
function comRelogio(opcoes = {}) {
  const agendados = new Map();
  let numero = 0;
  const salas = criarSalas({
    ...opcoes,
    agendar: (fn, ms) => { const id = ++numero; agendados.set(id, { fn, ms }); return id; },
    cancelar: id => agendados.delete(id)
  });
  const passarCarencia = () => { const lista = [...agendados.values()]; agendados.clear(); lista.forEach(a => a.fn()); };
  return { salas, agendados, passarCarencia };
}

test('só uma conta abre uma sala; quem tem o link entra enquanto ela estiver aberta', () => {
  const { salas } = comRelogio();
  assert.equal(salas.acesso('squad', { temConta: false }), 'espera');
  assert.equal(salas.acesso('squad', { temConta: true }), 'abre');
  assert.equal(salas.entrou('squad', 's1', { identidade: 'Ana#1' }).abriu, true);
  assert.equal(salas.acesso('squad', { temConta: false }), 'entra');
});

test('a janela de transição deixa qualquer um abrir, quando ligada', () => {
  const { salas } = comRelogio({ anonimoAbre: true });
  assert.equal(salas.acesso('squad', { temConta: false }), 'abre');
});

// É a carência que devolve a sala a quem estava sozinho e apertou F5 -- e, com "só conta abre
// sala", ao anônimo que caiu por dois segundos.
test('a sala vazia espera 60 segundos, e quem volta nesse intervalo a encontra aberta', () => {
  const { salas, agendados, passarCarencia } = comRelogio();
  const fechadas = [];
  salas.aoFechar(sala => fechadas.push(sala));
  salas.entrou('squad', 's1', { identidade: 'Ana#1' });
  salas.saiu('squad', 's1');
  assert.equal([...agendados.values()][0].ms, 60000);
  assert.equal(salas.acesso('squad', { temConta: false }), 'entra', 'na carência, a sala continua aberta');
  assert.equal(salas.entrou('squad', 's2', { identidade: 'Bia#2' }).abriu, false, 'voltar na carência não é abrir');
  assert.equal(agendados.size, 0, 'a entrada cancela o fechamento');
  salas.saiu('squad', 's2');
  passarCarencia();
  assert.deepEqual(fechadas, ['squad']);
  assert.equal(salas.acesso('squad', { temConta: false }), 'espera', 'o link morre com a sala');
});

// Um mapa novo por sala precisa só registrar a própria limpeza, uma vez. Antes, era uma
// linha a mais numa lista de dez dentro de `sairDaSalaAtual` -- e esquecer uma era um
// vazamento que só aparecia semanas depois.
test('toda limpeza registrada roda no fechamento, e uma que falha não impede as outras', () => {
  const { salas, passarCarencia } = comRelogio();
  const feitas = [];
  salas.aoFechar(() => { throw new Error('falhou de propósito'); });
  salas.aoFechar(sala => feitas.push(`chat:${sala}`));
  salas.aoFechar(sala => feitas.push(`sons:${sala}`));
  const erro = console.error; console.error = () => {};
  try {
    salas.entrou('squad', 's1', { identidade: 'Ana#1' });
    salas.saiu('squad', 's1');
    passarCarencia();
  } finally { console.error = erro; }
  assert.deepEqual(feitas, ['chat:squad', 'sons:squad']);
});

test('conta cada pessoa uma vez, mesmo com dois sockets durante uma reconexão', () => {
  const { salas } = comRelogio();
  salas.entrou('squad', 's1', { identidade: 'Ana#1' });
  salas.entrou('squad', 's2', { identidade: 'Ana#1' });
  salas.entrou('squad', 's3', { identidade: 'Bia#2' });
  assert.equal(salas.pessoas('squad'), 2);
  salas.saiu('squad', 's1');
  assert.equal(salas.aberta('squad'), true);
});

test('o teto de salas vale para abrir, e não para entrar numa aberta', () => {
  const { salas } = comRelogio({ maximoDeSalas: 1 });
  salas.entrou('uma', 's1', { identidade: 'Ana#1' });
  assert.equal(salas.acesso('outra', { temConta: true }), 'lotado');
  assert.equal(salas.acesso('uma', { temConta: false }), 'entra');
});
