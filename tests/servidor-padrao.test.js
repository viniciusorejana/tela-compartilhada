// O servidor que os aplicativos trazem preenchido vem do NEXO_SERVIDOR_PADRAO do .env.prod, e o aplicativo
// instalado não lê .env: o script grava o valor num arquivo que entra no pacote. O que importa é só entrar uma
// origem http(s) válida, e o arquivo de um build anterior não sobrar quando a variável some.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { escrever, origemDoServidor } = require('../scripts/servidor-padrao.cjs');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-servidor-'));

test('só vale uma origem http(s): o caminho e o resto do endereço saem', () => {
  assert.equal(origemDoServidor('https://147-15-57-25.sslip.io'), 'https://147-15-57-25.sslip.io');
  assert.equal(origemDoServidor('  https://nexo.exemplo/sala/abc?x=1  '), 'https://nexo.exemplo');
  assert.equal(origemDoServidor('http://192.168.0.5:3000/'), 'http://192.168.0.5:3000');
  for (const ruim of ['', 'nexo.exemplo', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.exemplo', undefined, null]) {
    assert.equal(origemDoServidor(ruim), '', `${ruim} não é um servidor`);
  }
});

test('escreve o arquivo que o aplicativo e o Gradle leem, só com o endereço', () => {
  const arquivo = path.join(pasta(), 'servidor-padrao.json');
  assert.equal(escrever({ NEXO_SERVIDOR_PADRAO: 'https://nexo.exemplo/' }, arquivo), 'https://nexo.exemplo');
  assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), { endereco: 'https://nexo.exemplo' });
});

test('sem a variável o arquivo de um build anterior some, e a tela abre vazia', () => {
  const arquivo = path.join(pasta(), 'servidor-padrao.json');
  escrever({ NEXO_SERVIDOR_PADRAO: 'https://nexo.exemplo' }, arquivo);
  assert.equal(escrever({}, arquivo), '');
  assert.equal(fs.existsSync(arquivo), false);
  assert.equal(escrever({ NEXO_SERVIDOR_PADRAO: '   ' }, arquivo), '');
});

test('um valor que não é endereço derruba o empacotamento em vez de gravar lixo', () => {
  const arquivo = path.join(pasta(), 'servidor-padrao.json');
  assert.throws(() => escrever({ NEXO_SERVIDOR_PADRAO: 'nexo.exemplo' }, arquivo), /http\(s\)/);
  assert.equal(fs.existsSync(arquivo), false);
});
