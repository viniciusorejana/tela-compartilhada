// Cada teste aqui guarda uma decisão de moderacao.js, não um detalhe de implementação. São
// regras que decidem quem controla uma sala, e é o tipo de código em que um engano não dá
// erro nenhum -- só entrega a sala para a pessoa errada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarModeracao, nomeDaIdentidade, MAXIMO_DE_BANIDOS } = require('../moderacao');

// Relógio controlado: banimento tem prazo, e esperar uma hora num teste não é opção.
function comRelogio() {
  let instante = 1_700_000_000_000;
  const moderacao = criarModeracao({ agora: () => instante });
  return { moderacao, avancarMinutos: m => { instante += m * 60000; } };
}

test('quem chega primeiro é o dono, e os outros não são', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  assert.equal(m.dono('sala'), 'ana#1');
  assert.equal(m.papel('sala', 'ana#1'), 'dono');
  assert.equal(m.papel('sala', 'bia#2'), 'participante');
  assert.equal(m.pode('sala', 'ana#1', 'expulsar'), true);
  assert.equal(m.pode('sala', 'bia#2', 'expulsar'), false);
});

// O motivo desta regra é concreto: rede móvel trocando de antena, aba em segundo plano, Wi-Fi
// oscilando. Se a entrada repetida reordenasse a fila, um engasgo de rede tiraria o dono da
// própria sala -- e entregaria a sala a quem calhou de estar em segundo lugar.
test('reconectar não custa a sala a quem a abriu', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  m.entrou('sala', 'ana#1');   // o socket dela oscilou e voltou
  assert.equal(m.dono('sala'), 'ana#1');
});

// Sala cheia sem ninguém para moderar é pior do que qualquer regra de sucessão.
test('quando o dono sai, o mais antigo entre os que ficaram assume', () => {
  const m = criarModeracao();
  ['ana#1', 'bia#2', 'caio#3'].forEach(i => m.entrou('sala', i));
  m.saiu('sala', 'ana#1');
  assert.equal(m.dono('sala'), 'bia#2');
  m.saiu('sala', 'bia#2');
  assert.equal(m.dono('sala'), 'caio#3');
});

test('a sala é esquecida quando a última pessoa sai', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  m.saiu('sala', 'ana#1');
  assert.equal(m.dono('sala'), null);
  assert.equal(m.resumo().length, 0);
});

// Esta é a que impede o banimento de ser inútil: sem ela, bastava quem baniu sair um instante
// -- ou ser a última pessoa a sair de uma sala que continua aberta noutra aba -- para o banido
// voltar no segundo seguinte.
test('um banimento vivo sobrevive à saída de quem baniu', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  assert.equal(m.banir('sala', 'ana#1', 'bia#2').ok, true);
  m.saiu('sala', 'bia#2');
  m.saiu('sala', 'ana#1');
  assert.ok(m.banido('sala', 'bia#2'), 'o banimento deveria continuar valendo');
});

test('o banimento expira, e diz quanto falta enquanto vale', () => {
  const { moderacao: m, avancarMinutos } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  m.banir('sala', 'ana#1', 'bia#2');
  const agora = m.banido('sala', 'bia#2');
  assert.ok(agora.minutos > 0 && agora.minutos <= 60, `minutos fora da faixa: ${agora.minutos}`);
  avancarMinutos(30);
  assert.ok(m.banido('sala', 'bia#2'), 'meia hora não deveria ter expirado');
  avancarMinutos(31);
  assert.equal(m.banido('sala', 'bia#2'), null, 'passada a hora, a pessoa pode voltar');
});

// Quatro recusas, quatro razões diferentes. Elas viram frases distintas na sala, e é por isso
// que o motivo importa e não só o "não": "essa pessoa abriu a sala" e "só quem abriu a sala
// pode fazer isso" mandam quem leu para lugares opostos.
test('cada recusa diz a sua razão', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  assert.equal(m.expulsar('sala', 'bia#2', 'ana#1').motivo, 'sem-permissao');
  assert.equal(m.expulsar('sala', 'ana#1', 'ana#1').motivo, 'nao-em-si-mesmo');
  assert.equal(m.expulsar('sala', 'ana#1', '').motivo, 'alvo-desconhecido');
  assert.equal(m.expulsar('outra-sala', 'ana#1', 'bia#2').motivo, 'sala-desconhecida');
});

// O dono não se expulsa e não é expulso, mesmo quando o pedido vem dele. O mesmo caminho
// serve para a lista inteira, e sem esta guarda um clique na linha errada derrubaria quem
// manda na sala.
test('ninguém remove o dono, nem ele a si mesmo', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  m.transferir('sala', 'ana#1', 'bia#2');
  assert.equal(m.dono('sala'), 'bia#2');
  assert.equal(m.expulsar('sala', 'bia#2', 'bia#2').motivo, 'nao-em-si-mesmo');
  // Ana já não é dona: o pedido dela sobre a nova dona é recusado por falta de permissão,
  // antes mesmo de chegar à regra de "alvo é dono".
  assert.equal(m.expulsar('sala', 'ana#1', 'bia#2').motivo, 'sem-permissao');
});

// Passar a sala e expulsar exigem presença; banir NÃO exige, e essa assimetria é o ponto.
// Banir quem acabou de sair é o caso mais comum de todos: a pessoa incomodou, saiu sozinha, e
// quem ficou quer garantir que ela não volte no minuto seguinte.
test('expulsar e transferir exigem presença; banir alcança quem já saiu', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  assert.equal(m.transferir('sala', 'ana#1', 'fantasma#9').motivo, 'alvo-fora-da-sala');
  m.entrou('sala', 'caio#3');
  m.saiu('sala', 'caio#3');
  assert.equal(m.transferir('sala', 'ana#1', 'caio#3').motivo, 'alvo-fora-da-sala');
  assert.equal(m.expulsar('sala', 'ana#1', 'caio#3').motivo, 'alvo-fora-da-sala');
  assert.equal(m.banir('sala', 'ana#1', 'caio#3').ok, true, 'banir precisa alcançar quem já saiu');
  assert.ok(m.banido('sala', 'caio#3'));
});

// Sem teto, uma sala longa acumularia identidades sem limite -- e cada uma delas é memória
// que ninguém libera enquanto a sala viver.
test('a lista de banidos tem teto', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'dono#0');
  // NOMES distintos, e não sufixos distintos: a chave do banimento é o nome, então
  // "pessoa#1" e "pessoa#2" ocupariam a MESMA entrada -- o que é o comportamento certo, e
  // faria este teste nunca alcançar o teto.
  for (let i = 0; i < MAXIMO_DE_BANIDOS; i++) {
    m.entrou('sala', `pessoa${i}#s`);
    assert.equal(m.banir('sala', 'dono#0', `pessoa${i}#s`).ok, true, `falhou no banimento ${i}`);
  }
  m.entrou('sala', 'ultima#x');
  assert.equal(m.banir('sala', 'dono#0', 'ultima#x').motivo, 'banidos-demais');
  // E o mesmo nome com outro sufixo continua caindo na entrada que já existe, sem consumir
  // uma vaga nova.
  assert.equal(m.banir('sala', 'dono#0', 'pessoa0#outro').ok, true);
});

// Desbanir existe porque errar é o caso comum: o clique foi na linha errada, a discussão
// acabou, a pessoa pediu desculpa. Sem isto, a única saída era esperar uma hora -- e quem
// removeu alguém por engano não tinha como consertar o próprio erro.
test('o dono libera quem bloqueou, e só ele', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'bia#2');
  m.entrou('sala', 'chato#3');
  m.banir('sala', 'ana#1', 'chato#3');
  assert.equal(m.listarBanidos('sala').length, 1);
  assert.equal(m.desbanir('sala', 'bia#2', 'chato').motivo, 'sem-permissao');
  assert.equal(m.desbanir('sala', 'ana#1', 'chato').ok, true);
  assert.equal(m.banido('sala', 'chato#outro'), null, 'liberado deveria poder voltar na hora');
  assert.equal(m.listarBanidos('sala').length, 0);
  // Liberar duas vezes não é erro do sistema, é do dedo -- mas a resposta precisa dizer que
  // não havia nada a fazer, em vez de fingir que fez.
  assert.equal(m.desbanir('sala', 'ana#1', 'chato').motivo, 'nao-estava-banido');
});

// A lista é o que o dono lê para decidir, então ela tem de trazer o prazo -- sem ele não há
// como saber se o bloqueio ainda está valendo.
test('a lista de bloqueados traz o prazo e esquece os vencidos', () => {
  const { moderacao: m, avancarMinutos } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'um#a');
  m.entrou('sala', 'dois#b');
  m.banir('sala', 'ana#1', 'um#a');
  avancarMinutos(59);
  m.banir('sala', 'ana#1', 'dois#b');
  const antes = m.listarBanidos('sala');
  assert.equal(antes.length, 2);
  assert.ok(antes.every(b => b.minutos > 0 && b.minutos <= 60), JSON.stringify(antes));
  avancarMinutos(2);
  const depois = m.listarBanidos('sala');
  assert.deepEqual(depois.map(b => b.nome), ['dois'], 'o vencido deveria ter saído da lista');
});

// ESTE é o teste que justifica a chave do banimento ser o nome. Foi encontrado testando no
// navegador: a credencial vive só na memória da aba, então recarregar a página sorteia um
// sufixo novo -- e um banimento por identidade seria derrotado por um F5. Pior do que não
// existir, porque quem moderou pensaria ter resolvido.
test('banimento sobrevive a recarregar a página, que troca a identidade', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'ana#1');
  m.entrou('sala', 'chato#aaaaaaaa');
  assert.equal(m.banir('sala', 'ana#1', 'chato#aaaaaaaa').ok, true);
  // Mesma pessoa, mesmo nome, sufixo novo: é exatamente o que o servidor emite depois de um F5.
  assert.ok(m.banido('sala', 'chato#bbbbbbbb'), 'um F5 não pode escapar do banimento');
  // Caixa e espaços em volta também não escapam.
  assert.ok(m.banido('sala', ' CHATO #cccccccc') || m.banido('sala', 'CHATO#cccccccc'), 'a comparação deve ignorar caixa');
  // E trocar de nome escapa -- é a limitação que o arquivo declara, e ela fica afirmada para
  // que ninguém a "conserte" por engano achando que é defeito.
  assert.equal(m.banido('sala', 'outronome#dddddddd'), null);
});

// O sufixo é sempre o ÚLTIMO segmento. Partir no primeiro '#' cortaria um nome que contém
// '#' no lugar errado -- e faria "a#b" e "a#c" compartilharem um banimento sem serem a mesma
// pessoa.
test('nome com # é extraído pelo último separador', () => {
  assert.equal(nomeDaIdentidade('dj#nexo#abcd1234'), 'dj#nexo');
  assert.equal(nomeDaIdentidade('Ana#ABCD'), 'ana');
  assert.equal(nomeDaIdentidade('semSufixo'), 'semsufixo');
  assert.equal(nomeDaIdentidade(''), '');
  assert.equal(nomeDaIdentidade(null), '');
});

// ---------- Com conta ----------
//
// Os testes abaixo são as regras que as contas trouxeram (docs/plano-contas.md). Cada um é um
// caso que, errado, entrega a sala à pessoa errada ou barra a pessoa errada -- e nenhum deles
// dá erro quando está errado.

const ANA = { contaId: 'conta-ana', nome: 'Ana' };
const BIA = { contaId: 'conta-bia', nome: 'Bia' };

test('o dono com conta que aperta F5 volta dono, com outra identidade', () => {
  const { moderacao: m } = comRelogio();
  m.entrou('sala', 'Ana#1', ANA);
  m.entrou('sala', 'Caio#2');
  m.saiu('sala', 'Ana#1');
  // Ausente: os poderes ficam com quem está, para a sala nunca ficar sem quem modere.
  assert.equal(m.dono('sala'), 'Caio#2');
  m.entrou('sala', 'Ana#9', ANA);
  assert.equal(m.dono('sala'), 'Ana#9', 'a mesma conta retoma o lugar, e com ele a sala');
  assert.equal(m.pode('sala', 'Caio#2', 'expulsar'), false);
});

test('ausente por mais de 60 segundos saiu de vez, e a sucessão fica', () => {
  const { moderacao: m, avancarMinutos } = comRelogio();
  m.entrou('sala', 'Ana#1', ANA);
  m.entrou('sala', 'Caio#2');
  m.saiu('sala', 'Ana#1');
  avancarMinutos(1.5);
  assert.equal(m.dono('sala'), 'Caio#2');
  m.entrou('sala', 'Ana#9', ANA);
  assert.equal(m.dono('sala'), 'Caio#2', 'fora do prazo, quem volta entra no fim da fila');
});

// Sem conta não há como reconhecer ninguém depois de um F5: ele sorteia outra identidade.
test('o dono sem conta que aperta F5 perde a sala, como antes', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Ana#1');
  m.entrou('sala', 'Caio#2');
  m.saiu('sala', 'Ana#1');
  m.entrou('sala', 'Ana#9');
  assert.equal(m.dono('sala'), 'Caio#2');
});

// "Só conta abre sala" seria meia verdade se a sala passasse a um anônimo com uma conta ali.
test('a sucessão prefere a conta presente mais antiga; sem conta, o anônimo mais antigo', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Ana#1', ANA);
  m.entrou('sala', 'Caio#2');
  m.entrou('sala', 'Bia#3', BIA);
  m.saiu('sala', 'Ana#1');
  assert.equal(m.dono('sala'), 'Bia#3', 'Caio chegou antes, mas Bia tem conta');
  const s = criarModeracao();
  s.entrou('sala', 'Ana#1');
  s.entrou('sala', 'Caio#2');
  s.entrou('sala', 'Duda#3');
  s.saiu('sala', 'Ana#1');
  assert.equal(s.dono('sala'), 'Caio#2');
});

// A transferência foi uma escolha de quem era dono, e vale como foi feita.
test('a transferência vale mesmo para quem não tem conta, e quem transferiu não retoma', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Ana#1', ANA);
  m.entrou('sala', 'Caio#2');
  assert.equal(m.transferir('sala', 'Ana#1', 'Caio#2').ok, true);
  m.saiu('sala', 'Ana#1');
  m.entrou('sala', 'Ana#9', ANA);
  assert.equal(m.dono('sala'), 'Caio#2');
});

test('a mesma conta em duas abas: sair de uma não deixa a pessoa ausente', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Ana#1', ANA);
  m.entrou('sala', 'Ana#2', ANA);
  m.entrou('sala', 'Caio#3');
  // A outra aba é a própria pessoa: removê-la seria um clique errado, não moderação.
  assert.equal(m.expulsar('sala', 'Ana#2', 'Ana#1').motivo, 'nao-em-si-mesmo');
  m.saiu('sala', 'Ana#1');
  assert.equal(m.dono('sala'), 'Ana#2');
  assert.equal(m.pode('sala', 'Ana#2', 'banir'), true);
});

// Regra 1: quem tem conta é banido pela conta -- e nenhuma outra Ana é atingida.
test('banir uma conta pega o F5 e a troca de apelido, e não pega outra conta com o mesmo nome', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Dono#0', BIA);
  m.entrou('sala', 'Ana#1', ANA);
  assert.equal(m.banir('sala', 'Dono#0', 'Ana#1').porConta, true);
  assert.ok(m.banido('sala', { contaId: ANA.contaId, nome: 'Aninha' }), 'trocar o apelido não escapa');
  assert.equal(m.banido('sala', { contaId: 'conta-de-outra-ana', nome: 'Ana' }), null, 'outra Ana com conta não é atingida');
});

// Regras 2 e 3.
test('o banimento por nome só vale para anônimos; banir a conta barra o apelido dela para anônimos', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Dono#0', BIA);
  m.entrou('sala', 'Ana#1');
  m.banir('sala', 'Dono#0', 'Ana#1');
  assert.ok(m.banido('sala', { nome: 'ana' }), 'a Ana anônima que voltar é barrada');
  assert.deepEqual(m.banido('sala', { nome: 'ANA' }).porNome, true, 'e sabe que foi pelo nome');
  assert.equal(m.banido('sala', { contaId: ANA.contaId, nome: 'Ana' }), null, 'uma Ana com conta entra');

  const s = criarModeracao();
  s.entrou('sala', 'Dono#0', BIA);
  s.entrou('sala', 'Caio#1', { contaId: 'conta-caio', nome: 'Caio' });
  s.banir('sala', 'Dono#0', 'Caio#1');
  assert.ok(s.banido('sala', { nome: 'Caio' }), 'sair da conta e voltar anônimo com o mesmo nome não escapa');
});

test('banir quem tinha conta e acabou de sair ainda acerta a conta', () => {
  const { moderacao: m, avancarMinutos } = comRelogio();
  m.entrou('sala', 'Dono#0', BIA);
  m.entrou('sala', 'Ana#1', ANA);
  m.saiu('sala', 'Ana#1');
  avancarMinutos(5);
  assert.equal(m.banir('sala', 'Dono#0', 'Ana#1').porConta, true);
  assert.ok(m.banido('sala', { contaId: ANA.contaId, nome: 'Ana' }));
});

test('a lista de bloqueados diz quem tinha conta, e libera pela chave', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Dono#0', BIA);
  m.entrou('sala', 'Ana#1', ANA);
  m.banir('sala', 'Dono#0', 'Ana#1');
  const [registro] = m.listarBanidos('sala');
  assert.deepEqual({ conta: registro.conta, exibir: registro.exibir }, { conta: true, exibir: 'Ana' });
  assert.equal(m.desbanir('sala', 'Dono#0', registro.chave).ok, true);
  assert.equal(m.banido('sala', { contaId: ANA.contaId, nome: 'Ana' }), null);
});

// Quando a sala fecha, quem guardava lugar some -- e o banimento continua até o prazo.
test('fechar a sala esquece os ausentes e mantém os banimentos vivos', () => {
  const m = criarModeracao();
  m.entrou('sala', 'Dono#0', BIA);
  m.entrou('sala', 'Ana#1');
  m.banir('sala', 'Dono#0', 'Ana#1');
  m.saiu('sala', 'Dono#0');
  m.fechou('sala');
  assert.equal(m.dono('sala'), null);
  assert.ok(m.banido('sala', { nome: 'Ana' }));
  m.entrou('sala', 'Caio#5');
  assert.equal(m.dono('sala'), 'Caio#5', 'quem abre de novo é o dono da sala nova');
});

// Um papel sem permissão nenhuma não pode virar um papel com todas por causa de um nome
// desconhecido chegando no lugar de um conhecido.
test('identidade desconhecida não ganha permissão', () => {
  const m = criarModeracao();
  m.entrou('sala', 'ana#1');
  for (const impostor of [null, undefined, '', 'nao-entrou#9']) {
    assert.equal(m.pode('sala', impostor, 'expulsar'), false, `permitiu para ${impostor}`);
  }
});
