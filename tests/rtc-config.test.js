// O /api/rtc-config e publico: a sala nao tem login, entao qualquer pessoa com o link le a
// resposta. Estes testes fixam as duas coisas que isso exige -- credencial de TURN com prazo
// e mais de um STUN, porque um so e ponto unico de falha.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SEGREDO = 'segredo-de-teste';

async function comServidor(env, executar) {
  const port = 3219;
  const servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
  });
  try {
    for (let tentativa = 0; tentativa < 60; tentativa++) {
      if (servidor.exitCode !== null) throw new Error('O servidor de teste encerrou antes de responder');
      try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch (_) { /* ainda subindo */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const resposta = await fetch(`http://127.0.0.1:${port}/api/rtc-config`);
    await executar(await resposta.json(), resposta);
  } finally {
    servidor.kill();
    await new Promise(resolve => servidor.once('exit', resolve));
  }
}

test('sem TURN configurado, sobram vários STUN independentes', async () => {
  await comServidor({ TURN_URLS: '', TURN_STATIC_AUTH_SECRET: '' }, config => {
    const urls = config.iceServers.flatMap(servidor => [servidor.urls].flat());
    assert.ok(urls.length > 1, 'um único STUN é ponto único de falha');
    assert.ok(urls.every(url => url.startsWith('stun:')));
    assert.equal(config.iceServers.some(servidor => servidor.username), false);
  });
});

test('a lista de STUN pode ser trocada por ambiente', async () => {
  await comServidor({ STUN_URLS: 'stun:um.exemplo:3478, stun:dois.exemplo:3478' }, config => {
    assert.deepEqual(config.iceServers.map(servidor => servidor.urls), ['stun:um.exemplo:3478', 'stun:dois.exemplo:3478']);
  });
});

test('o TURN sai com credencial temporária, assinada e nunca guardada em cache', async () => {
  await comServidor({
    TURN_URLS: 'turn:turn.exemplo:3478,turns:turn.exemplo:5349',
    TURN_STATIC_AUTH_SECRET: SEGREDO,
    TURN_TTL: '600'
  }, (config, resposta) => {
    const turn = config.iceServers.find(servidor => [servidor.urls].flat().some(url => /^turns?:/.test(url)));
    assert.deepEqual(turn.urls, ['turn:turn.exemplo:3478', 'turns:turn.exemplo:5349']);
    // O segredo fica no servidor: o que viaja é o HMAC dele, no formato que o coturn espera.
    assert.ok(!JSON.stringify(config).includes(SEGREDO));
    const [expiraEm] = turn.username.split(':');
    const agora = Math.floor(Date.now() / 1000);
    assert.ok(Number(expiraEm) > agora && Number(expiraEm) <= agora + 600);
    assert.equal(turn.credential, crypto.createHmac('sha1', SEGREDO).update(turn.username).digest('base64'));
    assert.equal(resposta.headers.get('cache-control'), 'no-store');
  });
});

test('credenciais fixas continuam funcionando para quem já as configurou', async () => {
  await comServidor({
    TURN_URLS: 'turn:turn.exemplo:3478',
    TURN_USERNAME: 'pessoa',
    TURN_CREDENTIAL: 'senha'
  }, config => {
    const turn = config.iceServers.find(servidor => servidor.username);
    assert.equal(turn.username, 'pessoa');
    assert.equal(turn.credential, 'senha');
  });
});

test('URLs de TURN sem credencial nenhuma não viram um servidor inútil na lista', async () => {
  await comServidor({ TURN_URLS: 'turn:turn.exemplo:3478', TURN_USERNAME: '', TURN_CREDENTIAL: '', TURN_STATIC_AUTH_SECRET: '' }, config => {
    assert.equal(config.iceServers.some(servidor => [servidor.urls].flat().some(url => /^turns?:/.test(url))), false);
  });
});
