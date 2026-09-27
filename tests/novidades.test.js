// A apresentação e as novidades: quando o modal abre sozinho, em que aba, e se a lista de edições
// que alguém vai editar à mão continua válida. O erro aqui não quebra nada na hora -- faz o modal
// voltar para todo mundo, ou nunca mais aparecer, e isso só se descobre depois de publicado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decidir, juntarLidas } = require('../public/novidades.js');
const { EDICOES } = require('../public/novidades-edicoes.js');
const { limparAjustes } = require('../public/perfil.js');

const ed = (id, extra = {}) => ({ id, data: '2026-09-26', titulo: `Edição ${id}`, itens: [], ...extra });

test('primeira vez: abre sozinho na apresentação, não na lista', () => {
  const d = decidir({ edicoes: [ed(2, { aparecer: true }), ed(1)], lida: 0 });
  assert.equal(d.abrir, true);
  assert.equal(d.aba, 'conheca');
  assert.equal(d.primeiraVez, true);
  assert.equal(d.ultima, 2, 'fechar marca a mais nova como lida, não a primeira');
});

test('edição nova com `aparecer` abre na lista; sem `aparecer`, só acende o ponto', () => {
  const chamativa = decidir({ edicoes: [ed(3, { aparecer: true }), ed(2), ed(1)], lida: 2 });
  assert.equal(chamativa.abrir, true);
  assert.equal(chamativa.aba, 'novidades');
  assert.deepEqual(chamativa.naoLidas.map(e => e.id), [3]);

  const discreta = decidir({ edicoes: [ed(3), ed(2)], lida: 2 });
  assert.equal(discreta.abrir, false);
  assert.equal(discreta.ponto, true, 'o botão avisa que tem coisa nova');

  // Uma chamativa mais antiga que a pessoa também não leu ainda conta.
  const antiga = decidir({ edicoes: [ed(3), ed(2, { aparecer: true })], lida: 1 });
  assert.equal(antiga.abrir, true);
});

test('`abrirEm: conheca` reabre a apresentação para quem já a viu', () => {
  const d = decidir({ edicoes: [ed(4, { aparecer: true, abrirEm: 'conheca' }), ed(3)], lida: 3 });
  assert.equal(d.abrir, true);
  assert.equal(d.aba, 'conheca');
});

test('lida em dia: nada abre e o botão fica sem ponto', () => {
  const d = decidir({ edicoes: [ed(2, { aparecer: true }), ed(1)], lida: 2 });
  assert.equal(d.abrir, false);
  assert.equal(d.ponto, false);
  assert.deepEqual(d.naoLidas, []);
});

test('NEXO_NOVIDADES=0: decide igual, mas não abre sozinho', () => {
  assert.equal(decidir({ edicoes: [ed(1, { aparecer: true })], lida: 0, automatico: false }).abrir, false);
  assert.equal(decidir({ edicoes: [ed(2, { aparecer: true }), ed(1)], lida: 1, automatico: false }).abrir, false);
});

test('o "lido" da conta e o do navegador: vale o maior, e lixo vira zero', () => {
  assert.equal(juntarLidas(0, 3), 3);
  assert.equal(juntarLidas(4, 2), 4, 'ler sem estar logado não se perde ao entrar na conta');
  assert.equal(juntarLidas(undefined, null, '5', -1, 2.5), 0);
});

test('o "lido" sobe para a conta como ajuste, e só como inteiro', () => {
  assert.deepEqual(limparAjustes({ novidades: 3 }), { novidades: 3 });
  assert.deepEqual(limparAjustes({ novidades: '3' }), {});
  assert.deepEqual(limparAjustes({ novidades: -1 }), {});
  assert.deepEqual(limparAjustes({ novidades: 1.5 }), {});
});

// ---------- A lista de edições, que é editada à mão ----------

const ICONES = (() => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'novidades.js'), 'utf8');
  const bloco = /const ICONES = \{([\s\S]*?)\n  \};/.exec(fonte)[1];
  return new Set([...bloco.matchAll(/^\s{4}([a-z]+):/gm)].map(m => m[1]));
})();

test('as edições: ids inteiros, únicos e do mais novo para o mais velho', () => {
  assert.ok(EDICOES.length > 0, 'sem edição nenhuma, a apresentação nunca abre sozinha');
  const ids = EDICOES.map(e => e.id);
  ids.forEach(id => assert.ok(Number.isInteger(id) && id > 0, `id ${id} precisa ser inteiro positivo`));
  assert.equal(new Set(ids).size, ids.length, 'id repetido: duas edições contariam como uma');
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'a mais nova vai no topo da lista');
});

test('as edições: cada uma tem data, título e itens que a tela sabe desenhar', () => {
  for (const edicao of EDICOES) {
    assert.match(edicao.data, /^\d{4}-\d{2}-\d{2}$/, `data da edição ${edicao.id}`);
    assert.ok(!Number.isNaN(new Date(`${edicao.data}T12:00:00`).getTime()), `data inválida na edição ${edicao.id}`);
    assert.ok(edicao.titulo?.trim(), `título da edição ${edicao.id}`);
    assert.ok(edicao.abrirEm === undefined || ['conheca', 'novidades'].includes(edicao.abrirEm), `abrirEm da edição ${edicao.id}`);
    assert.ok(Array.isArray(edicao.itens) && edicao.itens.length, `a edição ${edicao.id} precisa de itens`);
    for (const item of edicao.itens) {
      assert.ok(item.titulo?.trim() && item.texto?.trim(), `item sem título ou texto na edição ${edicao.id}`);
      assert.ok(ICONES.has(item.icone), `ícone "${item.icone}" não existe em public/novidades.js (edição ${edicao.id})`);
    }
  }
});
