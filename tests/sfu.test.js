const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');

let servidor, chaves;
const decodificar = parte => JSON.parse(Buffer.from(parte, 'base64url'));
before(async () => {
  // Binário, segredos e portas separados: testar não encerra o SFU da sala em uso.
  servidor = await iniciarServidor({ midia: true });
  let credencial = '';
  for (let n = 0; n < 80; n++) {
    const dados = await servidor.credencial('Teste', 'sala-de-teste', credencial);
    credencial = dados.credencialSessao || credencial;
    if (dados.token) { chaves = JSON.parse(await fs.readFile(path.join(servidor.pastaSfu, 'chaves.json'), 'utf8')); return; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('O SFU isolado não iniciou: ' + servidor.erros());
});
after(async () => { await servidor?.encerrar(); });

test('o token autoriza uma sala só, com prazo, e nunca carrega o segredo', async () => {
  const resposta = await fetch(servidor.origem + '/api/sala-config?sala=sala-de-teste&nome=Molejo');
  assert.equal(resposta.status, 200); assert.equal(resposta.headers.get('cache-control'), 'no-store');
  const dados = await resposta.json();
  const [cabecalho, corpo, assinatura] = dados.token.split('.'), claims = decodificar(corpo);
  assert.equal(decodificar(cabecalho).alg, 'HS256'); assert.equal(claims.video.room, 'sala-de-teste');
  assert.equal(claims.video.roomJoin, true); assert.equal(claims.video.canPublishData, true);
  assert.ok(claims.exp > Date.now() / 1000); assert.equal(claims.iss, chaves.apiKey);
  assert.equal(assinatura, crypto.createHmac('sha256', chaves.apiSecret).update(`${cabecalho}.${corpo}`).digest('base64url'));
  assert.equal(JSON.stringify(dados).includes(chaves.apiSecret), false);
});
test('duas abas recebem identidades próprias e a credencial privada retoma a mesma', async () => {
  const [uma, outra] = await Promise.all([servidor.credencial('Molejo'), servidor.credencial('Molejo')]);
  assert.notEqual(uma.identidade, outra.identidade); assert.ok(uma.identidade.startsWith('Molejo#'));
  assert.equal(decodificar(uma.token.split('.')[1]).sub, uma.identidade);
  const volta = await servidor.credencial('Molejo', 'squad-teste', uma.credencialSessao);
  assert.equal(volta.identidade, uma.identidade);
});
test('um código de sala inválido não gera token nenhum', async () => {
  for (const sala of ['', 'ab', '../outra', 'sala com espaço', 'x'.repeat(40)]) {
    const resposta = await fetch(`${servidor.origem}/api/sala-config?sala=${encodeURIComponent(sala)}&nome=Molejo`);
    assert.equal(resposta.status, 400); assert.equal((await resposta.json()).token, undefined);
  }
});
test('o endereço do servidor de mídia continua na origem que serviu a página', async () => {
  const direto = await servidor.credencial('Molejo'); assert.equal(direto.url, servidor.origem.replace('http:', 'ws:'));
  const tunel = await (await fetch(servidor.origem + '/api/sala-config?sala=sala-de-teste&nome=Molejo', { headers: { 'x-forwarded-host': 'exemplo.ts.net', 'x-forwarded-proto': 'https' } })).json();
  assert.equal(tunel.url, 'wss://exemplo.ts.net');
});
test('a porta Prometheus exige autenticação e o YAML aponta o webhook para a porta real', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${servidor.portaMetricas}/metrics`)).status, 401);
  const senha = crypto.createHmac('sha256', chaves.apiSecret).update('metricas').digest('hex');
  const resposta = await fetch(`http://127.0.0.1:${servidor.portaMetricas}/metrics`, { headers: { Authorization: 'Basic ' + Buffer.from('nexo-metricas:' + senha).toString('base64') } });
  assert.equal(resposta.status, 200); assert.match(await resposta.text(), /livekit_forward_latency/);
  const yaml = await fs.readFile(path.join(servidor.pastaSfu, 'livekit.yaml'), 'utf8');
  assert.ok(yaml.includes(servidor.origem + '/api/telemetria/livekit'));
  assert.equal((await fetch(servidor.origem + '/rtc/validate')).status, 403);
});
