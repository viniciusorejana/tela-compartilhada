// O lançamento (deploy/lancamento, docs/lancar-aplicativos.md): quando um produto precisa de versão nova,
// qual número ela leva, quais builds saem, e a anotação de cada build no versao.json. É aqui que um
// erro mandaria todo mundo baixar o mesmo arquivo em laço -- ou esconderia uma mudança de todos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const versoes = require('../deploy/lancamento/versoes.cjs');
const { lerOpcoes, lerConfig } = require('../deploy/lancamento/lancar.cjs');
const anotador = require('../app/escrever-versao.js');

const desktop = (servidas, versaoNoCodigo = '1.3.0') => versoes.decidir({ produto: 'desktop', versaoNoCodigo, servidas });
const igual = versao => ({ versao, mudou: false, existe: true });
const todas = entrada => Object.fromEntries(versoes.PRODUTOS.desktop.chaves.map(chave => [chave, { ...entrada }]));

test('o nível vem dos commits: função nova sobe o do meio, o resto sobe o último', () => {
  assert.equal(versoes.nivelPelosCommits(['fix: x', 'feat: o carregamento']), 'minor');
  assert.equal(versoes.nivelPelosCommits(['feat(app): escopo']), 'minor');
  assert.equal(versoes.nivelPelosCommits(['fix: x', 'docs: y']), 'patch');
  assert.equal(versoes.nivelPelosCommits(['feature: não é o prefixo']), 'patch');
  assert.equal(versoes.nivelPelosCommits([]), 'patch', 'mudança sem commit (o servidor trocou) ainda sobe');
});

test('subir a versão conta como número', () => {
  assert.equal(versoes.subirVersao('1.3.0', 'patch'), '1.3.1');
  assert.equal(versoes.subirVersao('1.3.7', 'minor'), '1.4.0');
  assert.equal(versoes.subirVersao('1.9.9', 'minor'), '1.10.0');
  assert.equal(versoes.subirVersao('1.3.7', 'major'), '2.0.0');
  assert.throws(() => versoes.subirVersao('1.3', 'patch'), /ilegível/);
  assert.throws(() => versoes.subirVersao('1.3.0', 'enorme'), /Nível/);
});

test('número no ar com código diferente fica congelado: precisa subir, e todos os builds saem', () => {
  const servidas = todas({ versao: '1.3.0', mudou: true, existe: true });
  const decisao = desktop(servidas);
  assert.equal(decisao.precisaSubir, true);
  assert.equal(decisao.maiorNoAr, '1.3.0');
  assert.deepEqual(versoes.chavesParaConstruir({ produto: 'desktop', versao: '1.4.0', servidas }), versoes.PRODUTOS.desktop.chaves);
});

test('o mesmo código do build no ar: nada sobe e nada sai', () => {
  const servidas = todas(igual('1.3.0'));
  assert.equal(desktop(servidas).precisaSubir, false);
  assert.deepEqual(versoes.chavesParaConstruir({ produto: 'desktop', versao: '1.3.0', servidas }), []);
});

test('versão já subida no código e ainda não lançada: não sobe de novo, só gera', () => {
  const servidas = todas({ versao: '1.3.0', mudou: true, existe: true });
  const decisao = desktop(servidas, '1.4.0');
  assert.equal(decisao.precisaSubir, false, 'rodar de novo depois de uma falha não pode pular para 1.5.0');
  assert.equal(versoes.chavesParaConstruir({ produto: 'desktop', versao: '1.4.0', servidas }).length, 4);
});

test('código atrás do que está no ar é recusado', () => {
  assert.throws(() => desktop(todas(igual('1.4.0')), '1.3.0'), /atrás do que foi lançado/);
});

test('um build que falta (ou perdeu o arquivo) sai sozinho, sem versão nova', () => {
  const servidas = todas(igual('1.3.0'));
  delete servidas['linux-deb'];
  servidas.linux = { ...servidas.linux, existe: false };
  assert.equal(desktop(servidas).precisaSubir, false);
  const chaves = versoes.chavesParaConstruir({ produto: 'desktop', versao: '1.3.0', servidas });
  assert.deepEqual(chaves, ['linux', 'linux-deb']);
  assert.deepEqual(versoes.buildsParaChaves(chaves), ['linux'], 'o AppImage e o .deb saem do mesmo build');
});

test('o Linux que ficou para trás sai no número do Windows, sem subir', () => {
  const servidas = todas(igual('1.3.0'));
  servidas.linux = igual('1.2.0');
  servidas['linux-deb'] = igual('1.2.0');
  assert.equal(desktop(servidas).precisaSubir, false);
  assert.deepEqual(versoes.buildsParaChaves(versoes.chavesParaConstruir({ produto: 'desktop', versao: '1.3.0', servidas })), ['linux']);
});

test('um servidor novo (nada lançado) gera tudo no número do código', () => {
  const decisao = versoes.decidir({ produto: 'android', versaoNoCodigo: '1.2.0', servidas: {} });
  assert.equal(decisao.precisaSubir, false);
  assert.equal(decisao.maiorNoAr, null);
  assert.deepEqual(versoes.chavesParaConstruir({ produto: 'android', versao: '1.2.0', servidas: {} }), ['android']);
});

test('a troca de versão mexe só no número: CRLF, acentos e o resto saem iguais', () => {
  const pacote = '{\r\n  "name": "x",\r\n  "version": "1.3.0",\r\n  "_comentario": "não muda",\r\n  "dependencies": { "a": { "version": "9.9.9" } }\r\n}\r\n';
  assert.equal(versoes.trocarVersaoDoPackage(pacote, '1.4.0'), pacote.replace('"version": "1.3.0"', '"version": "1.4.0"'));
  const gradle = "    defaultConfig {\r\n        // Sobe a cada APK distribuído.\r\n        versionCode = 4\r\n        versionName = '1.2.0'\r\n    }\r\n";
  assert.deepEqual(versoes.lerVersaoDoGradle(gradle), { nome: '1.2.0', codigo: 4 });
  const novo = versoes.trocarVersaoDoGradle(gradle, '1.3.0', 5);
  assert.equal(novo, gradle.replace('versionCode = 4', 'versionCode = 5').replace("'1.2.0'", "'1.3.0'"));
  assert.throws(() => versoes.trocarVersaoDoPackage('{}', '1.0.0'), /version/);
});

test('o que entra no build do aplicativo de mesa é o que o electron-builder empacota', () => {
  const caminhos = anotador.caminhosDoBuild('desktop');
  assert.ok(caminhos.includes('app/main.js'));
  assert.ok(caminhos.includes('app/package.json'));
  assert.ok(caminhos.includes('app/package-lock.json'));
  assert.ok(caminhos.includes('native/audio-agent'));
  assert.ok(!caminhos.includes('app/escrever-versao.js'), 'mexer no anotador não muda o aplicativo de ninguém');
  assert.deepEqual(anotador.caminhosDoBuild('android'), ['android']);
});

test('a anotação guarda versão, commit e servidor, sem apagar as outras linhas', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-versao-'));
  const arquivo = path.join(pasta, 'versao.json');
  fs.writeFileSync(arquivo, JSON.stringify({ sistemas: { linux: { versao: '0.9.0', em: 'antes' } } }));
  const [anotada] = anotador.anotar(['windows'], { arquivo, servidor: 'https://exemplo.test/sala?x=1' });
  const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8')).sistemas;
  assert.equal(lido.linux.versao, '0.9.0', 'a linha do Linux, feita em outra máquina, continua');
  assert.equal(lido.windows.versao, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'package.json'), 'utf8')).version);
  assert.equal(lido.windows.servidor, 'https://exemplo.test', 'só a origem');
  assert.match(anotada.commit, /^[0-9a-f]{40}$/);
  const [android] = anotador.anotar(['android'], { arquivo });
  assert.match(android.versao, /^\d+\.\d+\.\d+$/);
  assert.throws(() => anotador.anotar(['solaris'], { arquivo }), /Use:/);
  fs.rmSync(pasta, { recursive: true, force: true });
});

test('as opções da linha de comando', () => {
  const opcoes = lerOpcoes(['--plano', '--nivel', 'minor', '--ramo', 'main', '--reiniciar-com-gente']);
  assert.equal(opcoes.plano, true);
  assert.equal(opcoes.nivel, 'minor');
  assert.equal(opcoes.ramo, 'main');
  assert.equal(opcoes.reiniciarComGente, true);
  assert.throws(() => lerOpcoes(['--nivel', 'gigante']), /patch, minor, major/);
  assert.throws(() => lerOpcoes(['--nivel']), /pede um valor/);
  assert.throws(() => lerOpcoes(['--forcar']), /desconhecida/);
});

test('a configuração: o que falta é dito, o resto tem padrão, e o servidor dos aplicativos é o endereço público', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-lancamento-'));
  const arquivo = path.join(pasta, 'config.json');
  assert.throws(() => lerConfig(arquivo, {}), /config\.exemplo\.json/);
  fs.writeFileSync(arquivo, JSON.stringify({ ramo: 'main', urlPublica: 'https://nexo.exemplo/', vps: {} }));
  assert.throws(() => lerConfig(arquivo, {}), /vps\.host/);
  fs.writeFileSync(arquivo, JSON.stringify({ ramo: 'main', urlPublica: 'https://nexo.exemplo/', vps: { host: '203.0.113.10' } }));
  const config = lerConfig(arquivo, { ramo: 'outro' });
  assert.equal(config.ramo, 'outro', 'a opção vence o arquivo');
  assert.equal(config.urlPublica, 'https://nexo.exemplo');
  assert.equal(config.servidorPadrao, 'https://nexo.exemplo');
  assert.equal(config.vps.pasta, '/opt/nexo');
  assert.equal(config.vps.usuarioDoServico, 'nexo');
  assert.deepEqual(config.construir, { windows: true, android: true, linux: true });
  fs.writeFileSync(arquivo, JSON.stringify({ ramo: 'main', urlPublica: 'https://nexo.exemplo', vps: { host: 'h', chave: path.join(pasta, 'nao-existe.key') } }));
  assert.throws(() => lerConfig(arquivo, {}), /chave da SSH/);
  fs.rmSync(pasta, { recursive: true, force: true });
});
