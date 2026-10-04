// Os emojis: a regra "isto é um emoji" que o servidor aplica às reações, a lista do seletor (public/emojis.json,
// gerada por scripts/gerar-emojis.cjs), e as reações com QUALQUER emoji no chat da sala e na plateia.
//
// Antes só cinco emojis valiam como reação (👍 ❤️ 😂 👏 🎉), conferidos por uma lista no servidor. Agora vale
// qualquer um do seletor -- e nada que não seja um emoji inteiro, porque a reação é a chave de um mapa guardado
// com a mensagem e vai para a tela de todo mundo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');
const vitrine = require('../public/vitrine');
const dados = require('../public/emojis.json');

const SALA = 'sala-dos-emojis';
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- A regra ----------
test('ehUmEmoji: o emoji inteiro, de qualquer forma; nada que não seja um emoji', () => {
  const bons = ['👍', '❤️', '😂', '👏', '🎉', '🧑🏽‍💻', '👨‍👩‍👧‍👦', '🇧🇷', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '1️⃣', '#️⃣', '🏳️‍🌈', '🏳️‍⚧️', '🫠', '🙂‍↔️', '🐦‍🔥', '©️', '👩🏻‍❤️‍💋‍👨🏻'];
  for (const emoji of bons) assert.equal(vitrine.ehUmEmoji(emoji), true, `devia aceitar ${emoji}`);
  const ruins = ['', 'a', 'oi', '1', '12', '👍👍', '👍a', ' 👍', '👍 ', '<img>', '‍', '👍‍', '‍👍', '*', '🇧', '🇧🇷🇧🇷', '👍'.repeat(20), '\n', '👍\n', '😀😀', 'x😀', '👍<', null, undefined, 5, {}, ['👍']];
  for (const texto of ruins) assert.equal(vitrine.ehUmEmoji(texto), false, `devia recusar ${JSON.stringify(texto)}`);
});

// ---------- A lista do seletor ----------
test('emojis.json: a lista inteira passa na regra, sem repetição, com nomes e tons coerentes', () => {
  assert.deepEqual(dados.grupos.map(g => g.id), ['rostos', 'pessoas', 'animais', 'comida', 'viagens', 'atividades', 'objetos', 'simbolos', 'bandeiras']);
  const todos = dados.grupos.flatMap(g => g.itens);
  assert.ok(todos.length > 1800, `a lista é a do Unicode inteiro (${todos.length})`);
  const vistos = new Set();
  for (const [emoji, nome, busca, versao] of todos) {
    assert.equal(vitrine.ehUmEmoji(emoji), true, `o seletor oferece algo que o servidor recusaria: ${emoji} (${nome})`);
    assert.ok(!vistos.has(emoji), `repetido: ${emoji}`);
    vistos.add(emoji);
    assert.ok(typeof nome === 'string' && nome.length > 1, `sem nome: ${emoji}`);
    assert.ok(typeof busca === 'string', `sem palavras: ${emoji}`);
    assert.ok(typeof versao === 'number' && versao >= 0.6, `sem versão: ${emoji}`);
    // A frase do status guarda o primeiro grafema com até 16 unidades; o maior emoji da lista cabe.
    assert.ok(emoji.length <= 16, `grande demais para a frase do status: ${emoji}`);
  }
  // Os nomes são em português: o mais comum do mundo diz "polegar para cima", e a busca acha sem acento.
  const polegar = todos.find(([emoji]) => emoji === '👍');
  assert.equal(polegar[1], 'polegar para cima');
  assert.match(polegar[2], /beleza/);
  assert.equal(/[A-ZÀ-Ú]/.test(polegar[2]) || /[áéíóúãõâêôç]/.test(polegar[2]), false, 'as palavras da busca vêm sem acento e em minúsculas');
  // Os tons de pele: cinco por emoji, todos emojis válidos, todos de um emoji que existe na lista.
  assert.ok(Object.keys(dados.tons).length > 250);
  for (const [base, variantes] of Object.entries(dados.tons)) {
    assert.ok(vistos.has(base), `tom de um emoji que não está na lista: ${base}`);
    assert.equal(variantes.length, 5);
    assert.equal(new Set(variantes).size, 5);
    for (const v of variantes) assert.equal(vitrine.ehUmEmoji(v), true, `tom recusado: ${v}`);
  }
  // Um emoji de teste por versão, em ordem: é com eles que a página descobre o que o aparelho desenha.
  const versoes = dados.testes.map(([versao]) => versao);
  assert.deepEqual(versoes, [...versoes].sort((a, b) => a - b));
  assert.ok(dados.testes.every(([, emoji]) => vitrine.ehUmEmoji(emoji)));
  assert.ok(versoes.includes(11) && versoes.includes(15.1), 'as versões que o Windows 10 ainda não desenha estão lá');
});

// ---------- As reações, pelo servidor de verdade ----------
async function entrar(servidor, t, credencial) {
  const socket = await conectarSocket(servidor.origem, credencial.credencialSessao);
  t.after(socket.fechar);
  const entrada = await socket.pedir('join-room', SALA, 'ignorado', credencial.identidade);
  assert.equal(entrada.ok, true, JSON.stringify(entrada));
  return { socket, entrada, identidade: credencial.identidade };
}
async function duasPessoas(t) {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await entrar(servidor, t, await servidor.credencial('Ana', SALA));
  const bia = await entrar(servidor, t, await servidor.credencial('Bia', SALA));
  return { servidor, ana, bia };
}
// Devagar: o freio da sala (telemetria/abuso.js) aceita 10 ações de chat a cada 2 s, e o que ele descarta
// não responde -- este teste é da regra do emoji, e não do freio.
const reagir = async (pessoa, id, emoji) => { await dormir(230); return pessoa.socket.pedir('chat-acao', { acao: 'reagir', id, emoji }); };
async function mensagemDaAna(ana, texto = 'uma mensagem para reagir') {
  ana.socket.emitir('chat-message', { texto });
  const bruta = await ana.socket.esperar(m => m.startsWith('42["chat-mensagem"') && m.includes(texto));
  return JSON.parse(bruta.slice(2))[1];
}

test('reagir a uma mensagem aceita qualquer emoji, e só emoji', async t => {
  const { ana, bia } = await duasPessoas(t);
  const mensagem = await mensagemDaAna(ana);
  // Os cinco de sempre, e os que a lista de cinco nunca deixou passar: um rosto novo, um composto, uma bandeira.
  for (const emoji of ['👍', '🚀', '🧑🏽‍💻', '🇧🇷', '🫠']) {
    const r = await reagir(bia, mensagem.id, emoji);
    assert.equal(r.ok, true, `devia aceitar ${emoji}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.mensagem.reacoes[emoji], [bia.identidade], `a reação é da Bia: ${emoji}`);
  }
  // Nada que não seja um emoji inteiro vira reação -- a chave do mapa e o que aparece na tela de todos.
  for (const lixo of ['', 'a', 'oi', '<img src=x onerror=alert(1)>', '👍👍', '👍x', '__proto__', '😀‍', ' ', '1', '👍'.repeat(40)]) {
    const r = await reagir(bia, mensagem.id, lixo);
    assert.equal(r.ok, false, `devia recusar ${JSON.stringify(lixo)}`);
  }
  const resposta = await reagir(bia, mensagem.id, '🚀');
  assert.equal(resposta.ok, true, 'reagir de novo com o mesmo emoji tira a reação');
  assert.equal('🚀' in resposta.mensagem.reacoes, false, 'e a chave some, em vez de ficar vazia guardada');
  assert.deepEqual(Object.keys(resposta.mensagem.reacoes).sort(), ['🇧🇷', '🧑🏽‍💻', '👍', '🫠'].sort());
});

test('uma mensagem aceita até 20 emojis diferentes; reagir de novo a um deles continua valendo', async t => {
  const { ana, bia } = await duasPessoas(t);
  const mensagem = await mensagemDaAna(ana);
  // Vinte emojis diferentes do seletor.
  const lista = dados.grupos.flatMap(g => g.itens).map(([emoji]) => emoji).filter(emoji => !emoji.includes('‍') && emoji.length <= 2).slice(0, 21);
  for (let i = 0; i < 20; i++) {
    const r = await reagir(bia, mensagem.id, lista[i]);
    assert.equal(r.ok, true, `reação ${i + 1}: ${JSON.stringify(r)}`);
  }
  const vigesimaPrimeira = await reagir(bia, mensagem.id, lista[20]);
  assert.equal(vigesimaPrimeira.ok, false);
  assert.match(vigesimaPrimeira.error, /20 reações diferentes/);
  // Quem já está entre as vinte pode tirar a sua e pôr de novo: o teto é de emojis, e não de pessoas.
  const tirou = await reagir(bia, mensagem.id, lista[0]);
  assert.equal(tirou.ok, true);
  const poisDeNovo = await reagir(ana, mensagem.id, lista[0]);
  assert.equal(poisDeNovo.ok, true, 'o lugar do emoji que ficou vazio volta a existir');
  assert.equal(Object.keys(poisDeNovo.mensagem.reacoes).length, 20);
});

test('a reação da plateia (sinal-presenca) aceita qualquer emoji, e nada além', async t => {
  const { ana, bia } = await duasPessoas(t);
  ana.socket.emitir('sinal-presenca', { reacao: '🫶' });
  const recebida = await bia.socket.esperar(m => m.startsWith('42["reacao-sala"'));
  assert.equal(JSON.parse(recebida.slice(2))[1].reacao, '🫶', 'um emoji que a lista de cinco nunca deixou voar');
  assert.equal(JSON.parse(recebida.slice(2))[1].nome, 'Ana');
  // O freio da reação (5 a cada 3 s) cabe o emoji e quatro tentativas: o que sobra da conta é só o que a regra recusa.
  for (const lixo of ['<b>oi</b>', 'oi', '👍👍', 5]) {
    ana.socket.emitir('sinal-presenca', { reacao: lixo });
    await dormir(120);
  }
  // Nada disso saiu: chega UMA reação a Bia, a do emoji de verdade.
  await dormir(500);
  assert.equal(bia.socket.recebidos.filter(m => m.startsWith('42["reacao-sala"')).length, 1, 'só o emoji voa; o resto é descartado em silêncio');
});
