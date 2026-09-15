const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validarWebhook, interpretarPrometheus, criarObservador } = require('../telemetria/livekit');
const chaves = { apiKey: 'teste', apiSecret: 'segredo-apenas-de-teste' };
function assinar(corpo, alteracoes = {}, alg = 'HS256') {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = Buffer.from(JSON.stringify({ alg })).toString('base64url');
  const dados = Buffer.from(JSON.stringify({ iss: chaves.apiKey, nbf: agora - 1, exp: agora + 60, sha256: crypto.createHash('sha256').update(corpo).digest('base64'), ...alteracoes })).toString('base64url');
  return `${cabecalho}.${dados}.${crypto.createHmac('sha256', chaves.apiSecret).update(`${cabecalho}.${dados}`).digest('base64url')}`;
}
test('notificações exigem assinatura, corpo íntegro, emissor e prazo corretos', () => {
  const corpo = Buffer.from(JSON.stringify({ id: '123', createdAt: 123, event: 'track_published' }));
  assert.equal(validarWebhook(corpo, assinar(corpo), chaves).id, '123');
  assert.throws(() => validarWebhook(Buffer.from(corpo.toString().replace('123', '456')), assinar(corpo), chaves));
  assert.throws(() => validarWebhook(corpo, assinar(corpo, { exp: 1 }), chaves));
  assert.throws(() => validarWebhook(corpo, assinar(corpo, { iss: 'outra' }), chaves));
  assert.throws(() => validarWebhook(corpo, assinar(corpo, {}, 'none'), chaves));
});
test('Prometheus filtra dimensões pessoais e não transforma pacotes em bytes', () => {
  const dados = interpretarPrometheus('# TYPE livekit_node_packet_total counter\nlivekit_node_packet_total{type="out",participant="Ana"} 42\nlivekit_node_packet_total{type="out",participant="Bia"} 3\nlivekit_node_packet_total{type="in"} 9\nlivekit_forward_latency 500\nlivekit_forward_jitter NaN\ninventada_bytes 999\n');
  assert.equal(dados['livekit_node_packet_total:out'], 45);
  assert.equal(dados.livekit_forward_latency, 500);
  assert.ok(!JSON.stringify(dados).includes('Ana')); assert.equal(dados.inventada_bytes, undefined);
});
test('eventos repetidos não inflam contadores e deduplicação tem teto', () => {
  let agora = Date.now(); const eventos = [];
  const observador = criarObservador({ sfu: {}, agora: () => agora, aoEvento: e => eventos.push(e) });
  const evento = { id: 'um', createdAt: agora / 1000, event: 'track_published', room: { name: 'squad' }, participant: { identity: 'Ana#1', name: 'Ana' }, track: { sid: 'faixa', source: 'SCREEN_SHARE', width: 2560, height: 1440 } };
  assert.equal(observador.receber(evento), true); assert.equal(observador.receber(evento), false); assert.equal(eventos.length, 1);
  assert.equal(observador.resumo().participantesAtuais[0].faixas[0].altura, 1440);
  for (let i = 0; i < 10000; i++) observador.receber({ ...evento, id: `e${i}` });
  assert.equal(observador.tamanho(), 8192);
  agora += 600001; observador.receber({ ...evento, id: 'novo' }); assert.equal(observador.tamanho(), 1);
});
test('reiniciar o contador do SFU não produz taxa negativa', async () => {
  let agora = 0, valor = 10;
  const o = criarObservador({ agora: () => agora, sfu: { metricas: async () => `livekit_node_packet_total{type="out"} ${valor}` } });
  await o.coletar(); agora += 15000; valor = 40; await o.coletar(); assert.equal(o.resumo().pacotesSaidaSegundo, 2);
  agora += 15000; valor = 2; await o.coletar(); assert.equal(o.resumo().pacotesSaidaSegundo, null);
});
test('latência e jitter da versão instalada são convertidos de ns para ms', async () => {
  const o = criarObservador({ sfu: { metricas: async () => 'livekit_forward_latency 1500000\nlivekit_forward_jitter 250000\n' } });
  await o.coletar(); assert.equal(o.resumo().latencia, 1.5); assert.equal(o.resumo().jitter, .25);
});
