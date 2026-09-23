// A sala com contas, pelo servidor de verdade: quem abre, quem volta dono do F5, quem é
// barrado e quem não é. Sem janela de transição -- "só conta abre sala" valendo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

const SALA = 'squad-teste';
const semJanela = () => iniciarServidor({ ambiente: { NEXO_ANONIMO_ABRE_SALA: '0' } });

// Entra na sala pela sinalização e devolve o socket e a resposta do `join-room`.
async function entrar(servidor, t, cred) {
  assert.ok(cred.credencialSessao, `sem credencial: ${JSON.stringify(cred)}`);
  const socket = await conectarSocket(servidor.origem, cred.credencialSessao);
  t.after(socket.fechar);
  const entrada = await socket.pedir('join-room', SALA, 'ignorado', cred.identidade);
  assert.equal(entrada.ok, true, JSON.stringify(entrada));
  return { socket, entrada };
}
const esperarSaida = () => new Promise(resolve => setTimeout(resolve, 250));

test('só uma conta abre a sala; sem conta, espera -- sem sessão e sem estado', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const antes = await servidor.credencial('Bia', SALA);
  assert.equal(antes.motivo, 'sala-fechada');
  assert.equal(antes.credencialSessao, undefined, 'esperar não cria sessão');
  const ana = await servidor.conta('ana', { sala: SALA });
  // A configuração não abre a sala: quem abre é a entrada de verdade.
  assert.equal((await servidor.credencial('Bia', SALA)).motivo, 'sala-fechada');
  await entrar(servidor, t, ana);
  const depois = await servidor.credencial('Bia', SALA);
  assert.ok(depois.credencialSessao, 'com a sala aberta, quem tem o link entra sem conta');
});

// A carência: quem fica sozinho e cai por dois segundos encontra a sala aberta na volta.
test('a sala vazia continua aberta durante a carência', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { sala: SALA });
  const { socket } = await entrar(servidor, t, ana);
  socket.fechar();
  await esperarSaida();
  assert.ok((await servidor.credencial('Bia', SALA)).credencialSessao, 'nos 60 segundos, a sala ainda existe');
});

test('o dono com conta que aperta F5 volta dono; quem estava assume só enquanto ele não volta', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const primeira = await entrar(servidor, t, ana);
  assert.equal(primeira.entrada.dono, ana.identidade);
  const bia = await entrar(servidor, t, await servidor.credencial('Bia', SALA));
  primeira.socket.fechar();
  // Enquanto Ana está ausente, os poderes ficam com quem está: a sala nunca fica sem quem modere.
  await bia.socket.esperar(m => m.includes('sala-dono') && m.includes('Bia#'));
  // O F5: outra credencial, outra identidade, a mesma conta.
  const deNovo = await servidor.credencial('Ana', SALA, '', ana.cookie);
  assert.notEqual(deNovo.identidade, ana.identidade);
  const volta = await entrar(servidor, t, deNovo);
  assert.equal(volta.entrada.dono, deNovo.identidade, 'a mesma conta retoma a sala');
  assert.equal(volta.entrada.podeModerar, true);
});

test('a sala só passa para quem tem conta, e quem transferiu não a retoma ao voltar', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const primeira = await entrar(servidor, t, ana);
  const caio = await servidor.credencial('Caio', SALA);
  await entrar(servidor, t, caio);
  const recusa = await primeira.socket.pedir('moderar', { acao: 'transferir', identidade: caio.identidade });
  assert.equal(recusa.ok, false);
  assert.match(recusa.error, /quem entrou com uma conta/, 'a recusa diz por quê');
  const bia = await servidor.conta('bia', { apelido: 'Bia', sala: SALA });
  await entrar(servidor, t, bia);
  assert.equal((await primeira.socket.pedir('moderar', { acao: 'transferir', identidade: bia.identidade })).ok, true);
  primeira.socket.fechar();
  await esperarSaida();
  const volta = await entrar(servidor, t, await servidor.credencial('Ana', SALA, '', ana.cookie));
  assert.equal(volta.entrada.dono, bia.identidade, 'a transferência vale como foi feita');
});

// As regras 1, 2 e 3 do banimento, com homônimos de verdade.
test('banir a Ana anônima não barra a Ana com conta; banir a conta barra o apelido dela para anônimos', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const dona = await servidor.conta('dona', { apelido: 'Dona', sala: SALA });
  const { socket: moderadora } = await entrar(servidor, t, dona);
  const anaAnonima = await servidor.credencial('Ana', SALA);
  await entrar(servidor, t, anaAnonima);
  const anaComConta = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  await entrar(servidor, t, anaComConta);

  assert.equal((await moderadora.pedir('moderar', { acao: 'banir', identidade: anaAnonima.identidade })).ok, true);
  const outraAnonima = await servidor.credencial('Ana', SALA);
  assert.equal(outraAnonima.motivo, 'nome-barrado');
  assert.match(outraAnonima.error, /entre com a sua conta/, 'a regra 4: a saída, e não só a parede');
  assert.ok((await servidor.credencial('Ana', SALA, '', anaComConta.cookie)).credencialSessao, 'a Ana com conta não foi atingida');

  const caio = await servidor.conta('caio', { apelido: 'Caio', sala: SALA });
  await entrar(servidor, t, caio);
  assert.equal((await moderadora.pedir('moderar', { acao: 'banir', identidade: caio.identidade })).ok, true);
  assert.equal((await servidor.credencial('Caio', SALA, '', caio.cookie)).motivo, 'removido', 'a conta banida não volta, nem com F5');
  assert.equal((await servidor.credencial('Caio', SALA)).motivo, 'nome-barrado', 'sair da conta e voltar anônimo com o mesmo nome não escapa');
});

test('banir e trancar, no mesmo gesto', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const dona = await servidor.conta('dona', { sala: SALA });
  const { socket: moderadora } = await entrar(servidor, t, dona);
  const chato = await servidor.credencial('Chato', SALA);
  await entrar(servidor, t, chato);
  assert.equal((await moderadora.pedir('moderar', { acao: 'banir', identidade: chato.identidade, trancar: true })).ok, true);
  await moderadora.esperar(m => m.includes('sala-configuracao') && m.includes('"trancada":true'));
  // Com outro nome, o banimento não pega -- a tranca pega.
  assert.equal((await servidor.credencial('Outro Nome', SALA)).motivo, 'aguardando');
});

test('enviar som exige conta; tocar e apagar seguem as regras da sala', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const dona = await servidor.conta('dona', { sala: SALA });
  await entrar(servidor, t, dona);
  const bia = await servidor.credencial('Bia', SALA);
  await entrar(servidor, t, bia);
  const envio = await fetch(`${servidor.origem}/api/soundboard/${SALA}?nome=teste`, { method: 'POST', headers: { 'X-Nexo-Sessao': bia.credencialSessao, 'Content-Type': 'audio/wav' }, body: Buffer.alloc(64) });
  assert.equal(envio.status, 403);
  assert.equal((await envio.json()).motivo, 'sem-conta');
  const daDona = await fetch(`${servidor.origem}/api/soundboard/${SALA}?nome=teste`, { method: 'POST', headers: { 'X-Nexo-Sessao': dona.credencialSessao, 'Content-Type': 'audio/wav' }, body: Buffer.alloc(64) });
  assert.notEqual(daDona.status, 403, 'com conta, o envio chega à conversão (e este arquivo, inválido, é recusado lá)');
});

// Com conta, a mensagem é da pessoa sempre; sem conta, até recarregar a página.
test('quem tem conta edita a própria mensagem depois do F5; quem não tem, não', async t => {
  const servidor = await semJanela(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const antes = await entrar(servidor, t, ana);
  const bia = await servidor.credencial('Bia', SALA);
  const biaAntes = await entrar(servidor, t, bia);
  antes.socket.emitir('chat-message', { texto: 'mensagem da Ana' });
  biaAntes.socket.emitir('chat-message', { texto: 'mensagem da Bia' });
  // As duas chegam por conexões diferentes, e a ordem entre elas não é garantida.
  await antes.socket.esperar(m => m.includes('mensagem da Bia'));
  const lida = await antes.socket.esperar(m => m.includes('chat-mensagem') && m.includes('mensagem da Ana'));
  assert.equal(lida.includes('autorConta'), false, 'a conta de quem escreveu não viaja');

  antes.socket.fechar();
  biaAntes.socket.fechar();
  await esperarSaida();
  const anaDepois = await entrar(servidor, t, await servidor.credencial('Ana', SALA, '', ana.cookie));
  const minha = anaDepois.entrada.historico.find(m => m.texto === 'mensagem da Ana');
  assert.equal(minha.propria, true);
  assert.equal(anaDepois.entrada.historico.find(m => m.texto === 'mensagem da Bia').propria, false);
  const editada = await anaDepois.socket.pedir('chat-acao', { acao: 'editar', id: minha.id, texto: 'editada depois do F5' });
  assert.equal(editada.ok, true, JSON.stringify(editada));

  const biaDepois = await entrar(servidor, t, await servidor.credencial('Bia', SALA));
  const daBia = biaDepois.entrada.historico.find(m => m.texto === 'mensagem da Bia');
  assert.equal((await biaDepois.socket.pedir('chat-acao', { acao: 'editar', id: daBia.id, texto: 'tentei' })).ok, false);
});
