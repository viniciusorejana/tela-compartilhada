// Os níveis são regra de cobrança: um engano aqui cobra de quem não devia, ou entrega de
// graça o que custa. Nenhum deles dá erro quando está errado -- daí cada um virar teste.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const planos = require('../public/planos');

const ALTURAS = [720, 1080, 1440];
const DIA = 86400000;

test('os três níveis: 720p30 sem conta, 720p60 com conta grátis, 1080p e 1440p no premium', () => {
  assert.deepEqual({ ...planos.limites('anonimo') }, { altura: 720, quadros: 30 });
  assert.deepEqual({ ...planos.limites('gratis') }, { altura: 720, quadros: 60 });
  assert.deepEqual({ ...planos.limites('premium') }, { altura: 1440, quadros: 60 });
  assert.equal(planos.quadrosPermitidos('anonimo', 60), false);
  assert.equal(planos.quadrosPermitidos('gratis', 60), true);
  assert.equal(planos.alturaPermitida('gratis', 1080), false);
  assert.equal(planos.alturaPermitida('premium', 1440), true);
  assert.deepEqual({ ...planos.limites('inventado') }, { ...planos.limites('anonimo') }, 'nível desconhecido é o mais restrito');
});

test('o plano vem da conta, e premium vencido é conta grátis', () => {
  const agora = 1_790_000_000_000;
  assert.equal(planos.nivelDaConta(null, agora), 'anonimo');
  assert.equal(planos.nivelDaConta({ plano: 'gratis', planoAte: null }, agora), 'gratis');
  assert.equal(planos.nivelDaConta({ plano: 'premium', planoAte: null }, agora), 'premium', 'sem prazo, vale');
  assert.equal(planos.nivelDaConta({ plano: 'premium', planoAte: agora + DIA }, agora), 'premium');
  assert.equal(planos.nivelDaConta({ plano: 'premium', planoAte: agora - 1 }, agora), 'gratis');
});

// Quem assinou, escolheu 1440p e deixou vencer continua com 1440p guardado e recebe 720p; ao
// renovar, volta sozinho ao que tinha.
test('a escolha fica guardada acima do plano, e o que vale é o maior degrau que ele libera', () => {
  assert.equal(planos.alturaEfetiva('gratis', 1440, ALTURAS), 720);
  assert.equal(planos.alturaEfetiva('premium', 1440, ALTURAS), 1440);
  assert.equal(planos.alturaEfetiva('premium', 720, ALTURAS), 720, 'o plano é teto, não escolha forçada');
  assert.equal(planos.quadrosEfetivos('anonimo', 60), 30);
  assert.equal(planos.quadrosEfetivos('gratis', 60), 60);
});

// A captura raramente entrega exatamente 720, e o escalonador mexe na resolução o tempo todo.
test('o teto tem folga de 10%, e é medido pelo lado menor', () => {
  assert.equal(planos.excedeTeto('gratis', 1280, 720), false);
  assert.equal(planos.excedeTeto('gratis', 1366, 768), false, 'um notebook comum dentro da folga');
  assert.equal(planos.excedeTeto('gratis', 1400, 792), false, 'exatamente na folga');
  assert.equal(planos.excedeTeto('gratis', 1920, 1080), true);
  assert.equal(planos.excedeTeto('gratis', 720, 1280), false, 'um celular em pé tem 720 de lado menor');
  assert.equal(planos.excedeTeto('gratis', 2560, 720), true, 'uma faixa larga demais também passa');
  assert.equal(planos.excedeTeto('premium', 2560, 1440), false);
  assert.equal(planos.excedeTeto('premium', 3840, 2160), true);
});

test('toda sala tem teto de pessoas, e ele sobe com um assinante presente', () => {
  assert.equal(planos.tetoDePessoas({ comAssinante: false }), 25);
  assert.equal(planos.tetoDePessoas({ comAssinante: true }), 50);
  assert.equal(planos.cabeNaSala({ presentes: 24 }), true);
  assert.equal(planos.cabeNaSala({ presentes: 25 }), false);
  assert.equal(planos.cabeNaSala({ presentes: 25, algumAssinante: true }), true);
  assert.equal(planos.cabeNaSala({ presentes: 50, algumAssinante: true }), false);
});

// "Quem entra conta a si mesmo": é a presença do assinante que aumenta o teto.
test('um assinante entra numa sala que está no teto base; quando ele sai, ninguém sai junto', () => {
  assert.equal(planos.cabeNaSala({ presentes: 25, entraAssinante: true }), true);
  // Ele saiu: a sala tem 26 e nenhum assinante. Ninguém é removido -- quem decide isso é a
  // entrada, e não a saída --, e a próxima pessoa sem assinante na sala espera.
  assert.equal(planos.cabeNaSala({ presentes: 26 }), false);
  assert.equal(planos.cabeNaSala({ presentes: 24 }), true, 'abaixo do teto base, volta a caber');
});
