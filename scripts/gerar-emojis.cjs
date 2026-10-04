// Gera public/emojis.json: a lista de emojis do seletor (public/emojis.js), com os grupos, os nomes em
// português, as palavras da busca, os tons de pele e um emoji de teste por versão do Unicode.
//
//   node scripts/gerar-emojis.cjs --baixar            baixa as fontes (uma vez) e gera
//   node scripts/gerar-emojis.cjs --fontes <pasta>    usa o que já está na pasta
//   npm run emojis:gerar                              o mesmo que --baixar
//
// As fontes são públicas e vêm do Unicode:
//   emoji-test.txt                          https://unicode.org/Public/emoji/latest/emoji-test.txt
//                                           a lista oficial: cada emoji, o grupo e a versão em que nasceu
//   anotacoes-pt.json, anotacoes-derivadas-pt.json
//                                           os nomes e as palavras-chave em português do CLDR
//                                           (unicode-org/cldr-json: cldr-annotations-full e
//                                           cldr-annotations-derived-full, `pt`)
// O que o Unicode distribui sob a licença dele (https://www.unicode.org/terms_of_use.html) pode ser usado
// e copiado; o arquivo gerado diz de onde veio. Só o emoji gerado entra no projeto -- as fontes ficam fora
// (numa pasta temporária, com --baixar), porque somam quase 2 MB que ninguém precisa clonar.
//
// Refazer quando sair uma versão nova do Unicode: rodar de novo. O seletor só mostra o que o aparelho sabe
// desenhar (public/emojis.js, o teste por versão), então uma lista mais nova que a fonte do sistema não
// enche a tela de quadrados.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FONTES = {
  'emoji-test.txt': 'https://unicode.org/Public/emoji/latest/emoji-test.txt',
  'anotacoes-pt.json': 'https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-full/annotations/pt/annotations.json',
  'anotacoes-derivadas-pt.json': 'https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-derived-full/annotationsDerived/pt/annotations.json'
};
const SAIDA = path.join(__dirname, '..', 'public', 'emojis.json');

// Os grupos do Unicode, na ordem dele, com o nome que a pessoa lê e o emoji da aba.
const GRUPOS = [
  { unicode: 'Smileys & Emotion', id: 'rostos', nome: 'Carinhas e emoções', icone: '😀' },
  { unicode: 'People & Body', id: 'pessoas', nome: 'Pessoas e corpo', icone: '👋' },
  { unicode: 'Animals & Nature', id: 'animais', nome: 'Animais e natureza', icone: '🐶' },
  { unicode: 'Food & Drink', id: 'comida', nome: 'Comida e bebida', icone: '🍔' },
  { unicode: 'Travel & Places', id: 'viagens', nome: 'Viagens e lugares', icone: '🚗' },
  { unicode: 'Activities', id: 'atividades', nome: 'Atividades', icone: '⚽' },
  { unicode: 'Objects', id: 'objetos', nome: 'Objetos', icone: '💡' },
  { unicode: 'Symbols', id: 'simbolos', nome: 'Símbolos', icone: '❤️' },
  { unicode: 'Flags', id: 'bandeiras', nome: 'Bandeiras', icone: '🏁' }
];

const argumento = nome => { const i = process.argv.indexOf(nome); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

async function baixar() {
  const pasta = path.join(os.tmpdir(), 'nexo-emoji-fontes');
  fs.mkdirSync(pasta, { recursive: true });
  for (const [arquivo, endereco] of Object.entries(FONTES)) {
    const resposta = await fetch(endereco);
    if (!resposta.ok) throw new Error(`${endereco}: ${resposta.status}`);
    fs.writeFileSync(path.join(pasta, arquivo), Buffer.from(await resposta.arrayBuffer()));
    console.log(`baixado: ${arquivo}`);
  }
  return pasta;
}

// Sem o seletor de variação (U+FE0F): o CLDR escreve "❤" onde o Unicode escreve "❤️".
const semVariacao = texto => texto.replace(/️/g, '');
const semAcento = texto => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const ehTom = codigo => codigo >= 0x1f3fb && codigo <= 0x1f3ff;

function lerEmojis(arquivo) {
  const emojis = [];
  let grupo = null;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const g = /^# group: (.+)$/.exec(linha);
    if (g) { grupo = g[1].trim(); continue; }
    if (!linha || linha.startsWith('#')) continue;
    const d = /^([0-9A-F ]+?)\s*;\s*([a-z-]+)\s*#\s*(\S+)\s+E(\d+(?:\.\d+)?)\s+(.*)$/.exec(linha);
    if (!d) continue;
    emojis.push({ grupo, estado: d[2], emoji: d[3], versao: Number(d[4]), ingles: d[5].trim(), codigos: d[1].trim().split(/\s+/).map(h => parseInt(h, 16)) });
  }
  return emojis;
}

function lerNomes(pasta) {
  const mapa = new Map();
  for (const [arquivo, caminho] of [['anotacoes-pt.json', ['annotations', 'annotations']], ['anotacoes-derivadas-pt.json', ['annotationsDerived', 'annotations']]]) {
    const dados = JSON.parse(fs.readFileSync(path.join(pasta, arquivo), 'utf8'));
    const lista = caminho.reduce((no, chave) => no?.[chave], dados) || {};
    for (const [emoji, nomes] of Object.entries(lista)) if (!mapa.has(semVariacao(emoji))) mapa.set(semVariacao(emoji), nomes);
  }
  return mapa;
}

async function gerar() {
  let pasta = argumento('--fontes');
  if (argumento('--baixar')) pasta = await baixar();
  if (!pasta || pasta === true) { console.error('Use --baixar, ou --fontes <pasta> com os três arquivos de FONTES.'); process.exit(1); }
  const todos = lerEmojis(path.join(pasta, 'emoji-test.txt'));
  const nomes = lerNomes(pasta);
  const versaoDoUnicode = /# Version: ([\d.]+)/.exec(fs.readFileSync(path.join(pasta, 'emoji-test.txt'), 'utf8'))?.[1] || '?';

  // Só o que o teclado oferece (`fully-qualified`), fora os componentes (os tons e os cabelos soltos).
  const completos = todos.filter(e => e.estado === 'fully-qualified' && e.grupo !== 'Component');
  const chave = e => semVariacao(e.codigos.filter(c => !ehTom(c)).map(c => String.fromCodePoint(c)).join(''));
  const bases = completos.filter(e => !e.codigos.some(ehTom));
  const porChave = new Map(bases.map(e => [chave(e), e]));

  // Os tons de pele: só os de UM tom em todas as pessoas do emoji (cinco por emoji). As combinações com tons
  // diferentes (um casal de tons distintos) são 25 por emoji, e ficam de fora.
  const tons = {};
  const variantes = new Map();
  for (const e of completos.filter(x => x.codigos.some(ehTom))) {
    const usados = new Set(e.codigos.filter(ehTom));
    if (usados.size !== 1) continue;
    const base = porChave.get(chave(e));
    if (!base) continue;
    if (!variantes.has(base.emoji)) variantes.set(base.emoji, []);
    variantes.get(base.emoji)[[...usados][0] - 0x1f3fb] = e.emoji;
  }
  for (const [base, lista] of variantes) if (lista.length === 5 && lista.every(Boolean)) tons[base] = lista;

  let semNome = 0;
  const grupos = GRUPOS.map(g => ({ id: g.id, nome: g.nome, icone: g.icone, itens: [] }));
  for (const e of bases) {
    const indice = GRUPOS.findIndex(g => g.unicode === e.grupo);
    if (indice < 0) continue;
    const anotado = nomes.get(semVariacao(e.emoji));
    const nome = anotado?.tts?.[0] || e.ingles;
    if (!anotado?.tts?.[0]) semNome++;
    // As palavras da busca: as do CLDR e as do nome em inglês, sem acento e sem repetir o que o nome já diz.
    const nomeNormalizado = semAcento(nome);
    const palavras = new Set();
    for (const frase of [...(anotado?.default || []), e.ingles]) for (const palavra of semAcento(frase).split(/[^a-z0-9]+/)) if (palavra.length > 1 && !nomeNormalizado.includes(palavra)) palavras.add(palavra);
    const item = [e.emoji, nome, [...palavras].join(' '), e.versao];
    grupos[indice].itens.push(item);
  }

  // Um emoji de teste por versão do Unicode: o seletor desenha cada um numa tela escondida e só mostra as
  // versões que o aparelho sabe desenhar (um quadrado no lugar do emoji não adianta nada a ninguém). Um
  // emoji de um ponto só, quando a versão tem; senão o primeiro, composto (o teste mede a largura também).
  const testes = [];
  for (const versao of [...new Set(bases.map(e => e.versao))].sort((a, b) => a - b)) {
    const daVersao = bases.filter(e => e.versao === versao);
    const simples = daVersao.find(e => e.codigos.filter(c => c !== 0xfe0f).length === 1 && !e.codigos.some(c => c >= 0x1f1e6 && c <= 0x1f1ff));
    const escolhido = simples || daVersao[0];
    testes.push([versao, escolhido.emoji, simples ? 0 : 1]);
  }

  const total = grupos.reduce((soma, g) => soma + g.itens.length, 0);
  const saida = { versao: versaoDoUnicode, fonte: 'Unicode emoji-test.txt e CLDR annotations (pt)', grupos, tons, testes };
  fs.writeFileSync(SAIDA, `${JSON.stringify(saida)}\n`, 'utf8');
  console.log(`emojis.json: ${total} emojis em ${grupos.length} grupos, ${Object.keys(tons).length} com tons de pele, Unicode ${versaoDoUnicode}; ${semNome} sem nome em português (ficaram com o inglês); ${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB`);
}

gerar().catch(erro => { console.error(erro); process.exit(1); });
