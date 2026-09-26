// Quem está vendo a tela de quem. A promessa para quem transmite é que o placar diga a verdade:
// quem largou a tela sai dele, quem saiu da sala também, e ninguém conta a si mesmo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarEspectadores, MAXIMO_DE_TELAS_POR_PESSOA } = require('../espectadores');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

test('a lista inteira substitui a anterior, e só os donos que mudaram recebem aviso', () => {
  const e = criarEspectadores();
  assert.deepEqual(e.definir('squad', 'bia', ['ana', 'caio']), ['ana', 'caio']);
  assert.deepEqual(e.de('squad', 'ana'), ['bia']);
  // Mandar a mesma lista de novo não muda nada, e não merece aviso a ninguém.
  assert.deepEqual(e.definir('squad', 'bia', ['caio', 'ana']), []);
  // Largou a Ana e continuou no Caio: só o placar da Ana mudou.
  assert.deepEqual(e.definir('squad', 'bia', ['caio']), ['ana']);
  assert.deepEqual(e.de('squad', 'ana'), []);
  assert.deepEqual(e.de('squad', 'caio'), ['bia']);
});

test('ninguém conta como espectador da própria tela, e a lista tem teto', () => {
  const e = criarEspectadores();
  e.definir('squad', 'ana', ['ana', 'bia']);
  assert.deepEqual(e.de('squad', 'ana'), []);
  assert.deepEqual(e.de('squad', 'bia'), ['ana']);
  e.definir('squad', 'dani', Array.from({ length: 100 }, (_, i) => `p${i}`));
  assert.equal(e.donos('squad').filter(dono => dono.startsWith('p')).length, MAXIMO_DE_TELAS_POR_PESSOA);
});

test('quem sai deixa de ver, e a tela dele sai do placar de todo mundo', () => {
  const e = criarEspectadores();
  e.definir('squad', 'bia', ['ana']);
  e.definir('squad', 'caio', ['ana', 'bia']);
  // A Ana saiu: ninguém mais vê a tela dela, e o placar dela avisa isso.
  assert.deepEqual(e.saiu('squad', 'ana').sort(), ['ana']);
  assert.deepEqual(e.de('squad', 'ana'), []);
  assert.deepEqual(e.de('squad', 'bia'), ['caio'], 'o resto continua como estava');
  // O Caio saiu: a Bia perde o espectador dela.
  assert.deepEqual(e.saiu('squad', 'caio'), ['bia']);
  assert.equal(e.salas(), 0, 'sala sem ninguém vendo nada não ocupa memória');
});

test('cada sala tem o seu placar, e ele morre com ela', () => {
  const e = criarEspectadores();
  e.definir('squad', 'bia', ['ana']);
  e.definir('outra', 'bia', ['ana']);
  e.fechou('squad');
  assert.deepEqual(e.de('squad', 'ana'), []);
  assert.deepEqual(e.de('outra', 'ana'), ['bia']);
});

// Pelo servidor de verdade: o placar chega à sala inteira, quem entra depois o recebe pronto,
// e sair da sala tira a pessoa dele.
test('o placar atravessa a sala: quem assiste aparece para todos, e some ao sair', async t => {
  const SALA = 'squad-telas';
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  async function entrar(nome) {
    const cred = await servidor.credencial(nome, SALA);
    const socket = await conectarSocket(servidor.origem, cred.credencialSessao);
    t.after(socket.fechar);
    const entrada = await socket.pedir('join-room', SALA, 'ignorado', cred.identidade);
    assert.equal(entrada.ok, true, JSON.stringify(entrada));
    return { socket, entrada, identidade: cred.identidade };
  }
  const ana = await entrar('Ana');
  const bia = await entrar('Bia');
  assert.deepEqual(bia.entrada.espectadores, {}, 'ninguém vendo nada ainda');

  // Identidade de fora da sala não entra no placar: ele é chaveado pelo que o cliente manda.
  bia.socket.emitir('assistindo', { telas: [ana.identidade, 'alguem-de-fora'] });
  const aviso = await ana.socket.esperar(m => m.includes('"espectadores"') && m.includes(bia.identidade));
  assert.deepEqual(JSON.parse(aviso.slice(2))[1], { dono: ana.identidade, espectadores: [bia.identidade] });

  const caio = await entrar('Caio');
  assert.deepEqual(caio.entrada.espectadores, { [ana.identidade]: [bia.identidade] }, 'quem chega já vê o placar');

  bia.socket.fechar();
  const saida = await ana.socket.esperar(m => m.includes('"espectadores"') && m.includes('"espectadores":[]'));
  assert.equal(JSON.parse(saida.slice(2))[1].dono, ana.identidade);
});
