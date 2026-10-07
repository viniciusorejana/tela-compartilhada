'use strict';

// As decisões do lançamento, sem rede, sem Git e sem disco: o que precisa de versão nova, qual
// número ela leva e quais builds saem. Mora separado do lancar.cjs para ser testado por inteiro
// (tests/lancamento.test.js) -- é aqui que um erro manda todo mundo baixar o mesmo arquivo em laço.
const { comparar, valida } = require('../../public/versao-app');

// Os produtos e as chaves do versao.json de cada um. O aplicativo de mesa sai em quatro formas,
// todas do mesmo código e com o mesmo número; o Android tem o número dele (build.gradle).
const PRODUTOS = Object.freeze({
  desktop: { nome: 'aplicativo de mesa', chaves: ['windows-instalador', 'windows', 'linux', 'linux-deb'] },
  android: { nome: 'Android', chaves: ['android'] }
});

// Cada build sai de UM comando e produz várias chaves de uma vez: o instalador e o portátil saem
// do mesmo electron-builder no Windows; o AppImage e o .deb, do mesmo no Linux. Por isso a unidade
// de trabalho é o build, e não a chave -- refazer só o .deb refaria o AppImage junto de qualquer jeito.
const BUILDS = Object.freeze({
  windows: { produto: 'desktop', onde: 'local', chaves: ['windows-instalador', 'windows'] },
  android: { produto: 'android', onde: 'local', chaves: ['android'] },
  linux: { produto: 'desktop', onde: 'vps', chaves: ['linux', 'linux-deb'] }
});

// Os arquivos que cada chave põe no app/dist do servidor, na ordem em que devem entrar: o
// executável antes da ficha que o cita (latest.yml), para o aplicativo instalado nunca ler uma
// ficha nova apontando para um arquivo velho.
const ARQUIVOS = Object.freeze({
  'windows-instalador': ['Nexo-Setup.exe', 'Nexo-Setup.exe.blockmap', 'latest.yml'],
  windows: ['SalaCompartilhada.exe'],
  linux: ['Nexo.AppImage', 'latest-linux.yml'],
  'linux-deb': ['Nexo.deb'],
  android: ['Nexo.apk']
});

const NIVEIS = ['patch', 'minor', 'major'];

function maior(lista) {
  return lista.filter(valida).reduce((atual, v) => (!atual || comparar(v, atual) > 0 ? v : atual), null);
}

// O nível pelo assunto dos commits que mudaram o produto (este repositório escreve "feat:",
// "fix:", "docs:"): uma função nova sobe o do meio, o resto sobe o último. O primeiro número só
// sobe pedido (--nivel major) -- é uma decisão de produto, não algo que um commit decida sozinho.
function nivelPelosCommits(assuntos) {
  return assuntos.some(assunto => /^feat(\([^)]*\))?!?:/.test(assunto)) ? 'minor' : 'patch';
}

function subirVersao(versao, nivel) {
  if (!valida(versao)) throw new Error(`Versão ilegível: "${versao}".`);
  if (!NIVEIS.includes(nivel)) throw new Error(`Nível desconhecido: "${nivel}" (use ${NIVEIS.join(', ')}).`);
  const [a, b, c] = versao.split('.').map(Number);
  if (nivel === 'major') return `${a + 1}.0.0`;
  if (nivel === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

// A decisão de um produto. `servidas` é o que o servidor anuncia hoje, por chave, já com duas
// respostas calculadas fora daqui: `mudou` (o código do produto mudou desde o commit de onde aquele
// build saiu) e `existe` (os arquivos da chave estão no app/dist).
//
// A regra que sustenta tudo: um número que já está no ar fica CONGELADO. Se algum build anunciado
// com o número do código saiu de um código diferente do de agora, é preciso um número novo -- o
// aplicativo instalado só troca de arquivo quando o número sobe, e um build novo com o número
// velho nunca chegaria a ninguém (ou, no portátil, faria o aviso de atualização girar em laço).
function decidir({ produto, versaoNoCodigo, servidas }) {
  const { chaves } = PRODUTOS[produto];
  if (!valida(versaoNoCodigo)) throw new Error(`A versão do ${PRODUTOS[produto].nome} no código é ilegível: "${versaoNoCodigo}".`);
  const lancadas = chaves.map(chave => servidas[chave]).filter(entrada => entrada && valida(entrada.versao));
  const maiorNoAr = maior(lancadas.map(entrada => entrada.versao));
  if (maiorNoAr && comparar(versaoNoCodigo, maiorNoAr) < 0) {
    throw new Error(`O servidor já anuncia o ${PRODUTOS[produto].nome} ${maiorNoAr}, e o código está em ${versaoNoCodigo}.`
      + ' O código está atrás do que foi lançado -- outro ramo? Nada foi feito.');
  }
  const congelada = lancadas.some(entrada => entrada.versao === versaoNoCodigo && entrada.mudou);
  return { produto, versaoNoCodigo, maiorNoAr, precisaSubir: congelada };
}

// Depois de escolhido o número, quais chaves precisam de build: as que anunciam outro número,
// as que nunca saíram, as que perderam o arquivo e as que saíram de outro código.
function chavesParaConstruir({ produto, versao, servidas }) {
  return PRODUTOS[produto].chaves.filter(chave => {
    const entrada = servidas[chave];
    return !entrada || entrada.versao !== versao || !entrada.existe || entrada.mudou;
  });
}

function buildsParaChaves(chaves) {
  return Object.keys(BUILDS).filter(build => BUILDS[build].chaves.some(chave => chaves.includes(chave)));
}

// As trocas de versão nos arquivos, mexendo só no número: o resto do arquivo (finais de linha
// CRLF da cópia de trabalho, acentos, comentários) sai byte por byte como entrou.
function trocarVersaoDoPackage(texto, nova) {
  const padrao = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/;
  if (!padrao.test(texto)) throw new Error('Não achei "version" no app/package.json.');
  return texto.replace(padrao, `$1${nova}$3`);
}

function lerVersaoDoGradle(texto) {
  const nome = /versionName\s*=?\s*['"](\d{1,4}\.\d{1,4}\.\d{1,4})['"]/.exec(texto)?.[1];
  const codigo = Number(/versionCode\s*=?\s*(\d+)/.exec(texto)?.[1]);
  if (!nome || !Number.isInteger(codigo)) throw new Error('Não achei versionName (1.2.3) e versionCode em android/app/build.gradle.');
  return { nome, codigo };
}

// O versionCode sobe sempre junto: é por ele, e não pelo nome, que o Android aceita instalar por cima.
function trocarVersaoDoGradle(texto, nome, codigo) {
  lerVersaoDoGradle(texto);
  return texto
    .replace(/(versionCode\s*=?\s*)\d+/, `$1${codigo}`)
    .replace(/(versionName\s*=?\s*['"])\d{1,4}\.\d{1,4}\.\d{1,4}(['"])/, `$1${nome}$2`);
}

module.exports = {
  PRODUTOS, BUILDS, ARQUIVOS, NIVEIS,
  nivelPelosCommits, subirVersao, decidir, chavesParaConstruir, buildsParaChaves,
  trocarVersaoDoPackage, lerVersaoDoGradle, trocarVersaoDoGradle
};
