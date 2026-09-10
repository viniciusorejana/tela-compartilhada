// O token de acesso e a unica coisa que separa "entrar na sala" de "entrar em qualquer
// sala". Ele e emitido pelo servidor, assinado com um segredo que nunca sai da maquina, e
// carrega sala, identidade, permissoes e prazo. Estes testes fixam esse contrato.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PORTA = 3219;

function decodificar(parte) {
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

async function comServidor(executar) {
  const servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1' },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
  });
  try {
    for (let tentativa = 0; tentativa < 200; tentativa++) {
      if (servidor.exitCode !== null) throw new Error('O servidor de teste encerrou antes de responder');
      try {
        const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=sala-de-teste&nome=Teste`);
        // 503 enquanto o servidor de midia ainda descobre o proprio endereco.
        if (resposta.ok) break;
      } catch (_) { /* ainda subindo */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await executar();
  } finally {
    servidor.kill();
    await new Promise(resolve => servidor.once('exit', resolve));
  }
}

test('o token autoriza uma sala só, com prazo, e nunca carrega o segredo', async () => {
  await comServidor(async () => {
    const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=sala-de-teste&nome=Molejo`);
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get('cache-control'), 'no-store');
    const dados = await resposta.json();

    const [cabecalho, corpo, assinatura] = dados.token.split('.');
    assert.equal(decodificar(cabecalho).alg, 'HS256');
    const claims = decodificar(corpo);
    assert.equal(claims.video.room, 'sala-de-teste');
    assert.equal(claims.video.roomJoin, true);
    assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'o token já nasceu expirado');

    // A assinatura tem de fechar com o segredo que o servidor guardou -- e o segredo, com
    // o qual qualquer pessoa entraria em qualquer sala, nao pode aparecer na resposta.
    const chaves = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'native', 'livekit', 'chaves.json'), 'utf8'));
    assert.equal(claims.iss, chaves.apiKey);
    assert.equal(assinatura, crypto.createHmac('sha256', chaves.apiSecret).update(`${cabecalho}.${corpo}`).digest('base64url'));
    assert.equal(JSON.stringify(dados).includes(chaves.apiSecret), false);
  });
});

test('duas entradas com o mesmo nome recebem identidades diferentes', async () => {
  await comServidor(async () => {
    const pedir = async () => (await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=sala-de-teste&nome=Molejo`)).json();
    const [uma, outra] = await Promise.all([pedir(), pedir()]);
    // Mesma identidade faria o servidor de midia derrubar a primeira aba.
    assert.notEqual(uma.identidade, outra.identidade);
    assert.ok(uma.identidade.startsWith('Molejo#'));
    assert.equal(decodificar(uma.token.split('.')[1]).sub, uma.identidade);
  });
});

test('um código de sala inválido não gera token nenhum', async () => {
  await comServidor(async () => {
    for (const sala of ['', 'ab', '../outra', 'sala com espaço', 'x'.repeat(40)]) {
      const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=${encodeURIComponent(sala)}&nome=Molejo`);
      assert.equal(resposta.status, 400, `"${sala}" deveria ser recusada`);
      assert.equal((await resposta.json()).token, undefined);
    }
  });
});

test('o endereço do servidor de mídia é a mesma origem que serviu a página', async () => {
  await comServidor(async () => {
    // Assim a sinalizacao herda o HTTPS do tunel: nao ha porta nem certificado extra.
    const direto = await (await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=sala-de-teste&nome=Molejo`)).json();
    assert.equal(direto.url, `ws://127.0.0.1:${PORTA}`);

    const atrasDeTunel = await (await fetch(`http://127.0.0.1:${PORTA}/api/sala-config?sala=sala-de-teste&nome=Molejo`, {
      headers: { 'x-forwarded-host': 'exemplo.ts.net', 'x-forwarded-proto': 'https' }
    })).json();
    assert.equal(atrasDeTunel.url, 'wss://exemplo.ts.net');
  });
});
