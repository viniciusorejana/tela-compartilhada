// O teto de envio virou conta em vez de número escrito à mão, e estes testes existem para
// que ela não volte a ser escrita à mão sem ninguém perceber. Cada um guarda uma decisão de
// banda, não um detalhe de implementação: o motivo de cada valor está em quality-utils.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tetoDeEnvio, TETO_ABSOLUTO, PISO } = require('../public/quality-utils');

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
