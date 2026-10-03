// Empacota o APK de distribuição e o põe onde o servidor o entrega: app/dist/Nexo.apk, com a
// versão anotada em app/dist/versao.json (a mesma ficha dos aplicativos de mesa). É dali que a
// página inicial oferece o download, e é com essa versão que o aplicativo aberto descobre que
// existe um mais novo.
//
//   npm run android:empacotar
//
// Precisa do Android SDK (ANDROID_HOME) e de um JDK 17 ou 21, e da chave de assinatura -- sem
// ela o Gradle produz um APK sem assinatura, que o Android não instala, e este script recusa
// copiá-lo em vez de distribuir algo que ninguém consegue abrir. Ver docs/android.md.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const pastaDoAndroid = path.join(raiz, 'android');
const saidas = path.join(pastaDoAndroid, 'app', 'build', 'outputs', 'apk', 'release');
const destino = path.join(raiz, 'app', 'dist', 'Nexo.apk');
const fichaDeVersoes = path.join(raiz, 'app', 'dist', 'versao.json');

// A versão é a do build.gradle, e não a do package.json: o aplicativo Android tem a dele.
const gradle = fs.readFileSync(path.join(pastaDoAndroid, 'app', 'build.gradle'), 'utf8');
const versao = /versionName\s*=?\s*['"](\d{1,4}\.\d{1,4}\.\d{1,4})['"]/.exec(gradle)?.[1];
if (!versao) {
  console.error('Não achei versionName (no formato 1.2.3) em android/app/build.gradle.');
  process.exit(1);
}

// As saídas de um build anterior saem antes: um app-release.apk velho, assinado com outra chave
// (ou de outra versão), seria copiado como se fosse este -- bastava a chave faltar agora.
fs.rmSync(saidas, { recursive: true, force: true });

const windows = process.platform === 'win32';
// Pelo caminho completo: o cmd nem sempre procura na pasta atual (NoDefaultCurrentDirectoryInExePath).
// O .bat só roda pelo interpretador de comandos, e o caminho vai entre aspas por causa dele.
const gradlew = path.join(pastaDoAndroid, windows ? 'gradlew.bat' : 'gradlew');
const resultado = spawnSync(windows ? `"${gradlew}"` : gradlew, ['assembleRelease', '--console=plain'], {
  cwd: pastaDoAndroid,
  stdio: 'inherit',
  shell: windows
});
if (resultado.status !== 0) {
  console.error('\nO Gradle não terminou o build. O motivo está acima.');
  process.exit(resultado.status || 1);
}

const assinado = path.join(saidas, 'app-release.apk');
if (!fs.existsSync(assinado)) {
  const semAssinatura = fs.existsSync(path.join(saidas, 'app-release-unsigned.apk'));
  console.error(semAssinatura
    ? '\nO APK saiu SEM assinatura: falta a chave (android/keystore.properties ou as variáveis NEXO_ANDROID_*). O Android não instala um APK assim. Ver docs/android.md, "A chave".'
    : '\nO Gradle terminou, mas o APK não está em android/app/build/outputs/apk/release.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(assinado, destino);

let atual = {};
try { atual = JSON.parse(fs.readFileSync(fichaDeVersoes, 'utf8')); } catch (_) { /* primeiro build */ }
const sistemas = { ...(atual.sistemas || {}), android: { versao, em: new Date().toISOString() } };
fs.writeFileSync(fichaDeVersoes, JSON.stringify({ sistemas }, null, 2) + '\n');

const megabytes = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
console.log(`\napp/dist/Nexo.apk: versão ${versao}, ${megabytes} MB. O servidor já oferece o download.`);
