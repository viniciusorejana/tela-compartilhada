// O teto de envio virou conta em vez de número escrito à mão, e estes testes existem para
// que ela não volte a ser escrita à mão sem ninguém perceber. Cada um guarda uma decisão de
// banda, não um detalhe de implementação: o motivo de cada valor está em quality-utils.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  tetoDeEnvio, TETO_ABSOLUTO, PISO,
  proximaEscala, CUSTO_QUE_APERTA, ESCADA_DE_ESCALA, AMOSTRAS_PARA_ENCOLHER, AMOSTRAS_PARA_CRESCER
} = require('../public/quality-utils');

// O caso central do Nexo é tela 1080p a 30 quadros, e ele já foi visto funcionando em sala a
// 4 Mbps. A conta foi calibrada para NÃO mexer nele: se este teste quebrar, a mudança
// atingiu o caso que ninguém pediu para mudar.
test('1080p a 30 quadros continua no orçamento que já rodava em sala', () => {
  const teto = tetoDeEnvio(1920, 1080, 30);
  assert.ok(teto > 3_900_000 && teto < 4_100_000, `esperava perto de 4 Mbps, veio ${teto}`);
});

// O erro que esta conta corrige: 30 e 60 quadros dividiam o mesmo teto, então escolher
// "Fluidez máxima" cortava pela metade os bits de cada pixel -- em jogo, que é justamente
// onde faltar bit aparece. Dobrar os quadros também não pode dobrar a conta: quadros
// vizinhos se parecem, e a compressão vive dessa semelhança.
test('60 quadros custam mais que 30, e bem menos que o dobro', () => {
  const trinta = tetoDeEnvio(1920, 1080, 30);
  const sessenta = tetoDeEnvio(1920, 1080, 60);
  assert.ok(sessenta > trinta * 1.2, `60 fps deveria custar mais: ${trinta} -> ${sessenta}`);
  assert.ok(sessenta < trinta * 1.6, `60 fps não deveria custar o dobro: ${trinta} -> ${sessenta}`);
});

// Uma captura ultrawide ou uma janela não tem os pixels que o perfil pediu, e pagar por
// pixel inexistente é caro: o servidor manda uma cópia por espectador.
test('captura com menos pixels custa proporcionalmente menos', () => {
  const cheia = tetoDeEnvio(1920, 1080, 30);
  const ultrawide = tetoDeEnvio(1920, 810, 30);
  assert.ok(ultrawide < cheia, 'menos pixels deveria custar menos');
  // 810 contra 1080 são três quartos dos pixels, e o teto acompanha na mesma proporção.
  const proporcao = ultrawide / cheia;
  assert.ok(proporcao > 0.7 && proporcao < 0.8, `esperava ~0,75 do teto, veio ${proporcao.toFixed(2)}`);
});

// O teto absoluto não é sobre qualidade, é sobre a conta de quem hospeda: cada Mbps aqui
// multiplica pelo tamanho da sala. Sem ele, 1440p a 60 pediria mais de 10 Mbps -- e dez
// pessoas assistindo seriam 100 Mbps de saída.
test('nenhuma combinação passa do teto absoluto', () => {
  for (const [largura, altura, fps] of [[2560, 1440, 30], [2560, 1440, 60], [3840, 2160, 60]]) {
    const teto = tetoDeEnvio(largura, altura, fps);
    assert.ok(teto <= TETO_ABSOLUTO, `${largura}x${altura}@${fps} passou do teto: ${teto}`);
  }
  assert.equal(tetoDeEnvio(2560, 1440, 60), TETO_ABSOLUTO);
});

// Abaixo do piso a imagem deixa de servir para o que as pessoas usam a tela: ler texto e
// código. Uma captura minúscula não deve arrastar o teto para um valor que inviabiliza a
// própria tarefa.
test('captura minúscula não derruba o teto abaixo do piso', () => {
  assert.equal(tetoDeEnvio(320, 240, 30), PISO);
  assert.equal(tetoDeEnvio(640, 360, 15), PISO);
});

// Medidas ausentes acontecem de verdade: `getSettings` volta vazio antes do primeiro quadro.
// Um teto de reserva serve; um teto zerado, ou um NaN, derruba a publicação.
test('medidas ausentes devolvem um teto utilizável, nunca zero nem NaN', () => {
  for (const argumentos of [[0, 0, 0], [undefined, undefined, undefined], [1920, 1080, 0]]) {
    const teto = tetoDeEnvio(...argumentos);
    assert.ok(Number.isFinite(teto) && teto >= PISO, `veio ${teto} para ${JSON.stringify(argumentos)}`);
  }
});

// ---------- A escala que protege os quadros ----------
//
// Esta é a decisão que substitui um adaptador do navegador que não está agindo, e o valor
// dela está todo na histerese: sem ela a resolução oscila à vista, o que é pior do que ficar
// um degrau abaixo. Histerese quebra em silêncio, e é por isso que cada regra tem um teste.

// Roda uma sequência de medições pela decisão, como a página faz a cada dois segundos.
function rodar(custos, inicial = {}) {
  let estado = { escala: 1, apertos: 0, folgas: 0, ...inicial };
  for (const custoProjetado of custos) estado = proximaEscala({ ...estado, custoProjetado });
  return estado;
}

const APERTADO = CUSTO_QUE_APERTA + 200;
const FOLGADO = 100;

test('um aperto isolado não encolhe a imagem', () => {
  assert.equal(rodar([APERTADO]).escala, 1);
});

test('apertos seguidos encolhem, um degrau por vez', () => {
  const primeiro = rodar(Array(AMOSTRAS_PARA_ENCOLHER).fill(APERTADO));
  assert.equal(primeiro.escala, ESCADA_DE_ESCALA[1]);
  const segundo = rodar(Array(AMOSTRAS_PARA_ENCOLHER * 2).fill(APERTADO));
  assert.equal(segundo.escala, ESCADA_DE_ESCALA[2]);
});

// Além do último degrau a camada de cima chegaria ao tamanho da de baixo, e duas camadas
// iguais não servem para nada -- além de não pouparem codificação nenhuma.
test('a escada para no último degrau, por mais que aperte', () => {
  const fim = rodar(Array(50).fill(APERTADO));
  assert.equal(fim.escala, ESCADA_DE_ESCALA[ESCADA_DE_ESCALA.length - 1]);
});

test('uma folga isolada não devolve a imagem cheia', () => {
  const estado = rodar([FOLGADO], { escala: ESCADA_DE_ESCALA[1] });
  assert.equal(estado.escala, ESCADA_DE_ESCALA[1]);
});

test('folga sustentada devolve um degrau', () => {
  const estado = rodar(Array(AMOSTRAS_PARA_CRESCER).fill(FOLGADO), { escala: ESCADA_DE_ESCALA[1] });
  assert.equal(estado.escala, ESCADA_DE_ESCALA[0]);
});

// O caso que produziria o pior comportamento possível: um custo que cabe no degrau atual e
// NÃO caberia no de cima. Crescer aqui significa encolher de novo dois segundos depois, para
// sempre -- resolução pulsando, que é exatamente o que ninguém quer ver numa transmissão.
test('não cresce quando o degrau de cima não caberia', () => {
  // Em 1,5, voltar para 1,25 multiplica a área por (1,5/1,25)² = 1,44. Um custo de 600 cabe
  // nos 700 de agora e viraria 864 no degrau de cima.
  const estado = rodar(Array(AMOSTRAS_PARA_CRESCER * 3).fill(600), { escala: 1.5 });
  assert.equal(estado.escala, 1.5, 'deveria ficar onde está em vez de pulsar entre dois degraus');
});

// Uma rajada -- a troca de cena de um jogo custa mais que o resto -- não pode zerar a
// paciência acumulada de forma a impedir o crescimento para sempre; e também não pode ser
// ignorada. O que se afirma aqui é só que a sequência converge, em vez de travar.
test('uma rajada no meio da folga adia o crescimento, não o impede', () => {
  const comRajada = [...Array(AMOSTRAS_PARA_CRESCER - 1).fill(FOLGADO), APERTADO,
    ...Array(AMOSTRAS_PARA_CRESCER).fill(FOLGADO)];
  assert.equal(rodar(comRajada, { escala: ESCADA_DE_ESCALA[1] }).escala, ESCADA_DE_ESCALA[0]);
});

// A escala vem de uma sessão anterior, de um `localStorage` de outra versão, ou de um degrau
// que saiu da escada. Nenhum desses casos pode travar a decisão num valor de que não há volta.
test('escala fora da escada volta para o tamanho cheio', () => {
  for (const escala of [1.0625, 3, 0, null, undefined, NaN]) {
    const estado = proximaEscala({ escala, custoProjetado: FOLGADO, apertos: 0, folgas: 0 });
    assert.ok(ESCADA_DE_ESCALA.includes(estado.escala), `veio ${estado.escala} para escala ${escala}`);
  }
});

// Sem medição não há decisão: um custo ausente não pode ser lido como folga e devolver a
// imagem cheia justamente quando a medição falhou.
test('custo ausente não é tratado como aperto', () => {
  for (const custoProjetado of [undefined, null, NaN]) {
    const estado = rodar(Array(AMOSTRAS_PARA_ENCOLHER * 2).fill(custoProjetado));
    assert.equal(estado.escala, 1, `veio ${estado.escala} para custo ${custoProjetado}`);
  }
});
