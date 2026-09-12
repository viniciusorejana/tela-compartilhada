// O bot de musica entra na sala como um participante de verdade. Isso e o que da a ele
// sincronizacao de graca -- todo mundo recebe os mesmos pacotes -- e o que torna estas
// invariantes importantes: um participante que so PUBLICA, com identidade que ninguem
// consegue imitar, e que nao deixa processo vivo atras de si.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const musica = require('../musica');
const sfu = require('../sfu');

const decodificar = parte => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));

test('o token do bot não autoriza receber nada: ele só publica', () => {
  const corpo = decodificar(sfu.criarToken('sala-x', 'nexo-dj#sala-x', 'Nexo DJ', { podeReceber: false }).split('.')[1]);
  assert.equal(corpo.video.canPublish, true);
  // Sem isto o bot baixaria a câmera e a voz da sala inteira para jogar no lixo -- banda e
  // processador de quem hospeda, multiplicados por sala. Negar no TOKEN, e não só no
  // cliente, é o que mantém a garantia mesmo se o código do bot mudar.
  assert.equal(corpo.video.canSubscribe, false);
  assert.equal(corpo.video.canPublishData, false);
  assert.equal(corpo.video.room, 'sala-x');

  // Gente continua entrando com permissão cheia.
  const pessoa = decodificar(sfu.criarToken('sala-x', 'Ana#abc12345', 'Ana').split('.')[1]);
  assert.equal(pessoa.video.canSubscribe, true);
});

test('a marcação do bot não se abre com texto de fora', () => {
  // O título vem do site e o pedido vem da pessoa; um asterisco solto em qualquer um deles
  // abriria um negrito que fecha na frase seguinte.
  assert.equal(musica.semMarcacao('Mötley Crüe - *Kickstart* My `Heart`'), 'Mötley Crüe - Kickstart My Heart');
  assert.equal(musica.semMarcacao(null), '');
  assert.equal(musica.semMarcacao(undefined), '');
  assert.equal(musica.semMarcacao(42), '42');
  // Acentos e símbolos comuns em nome de faixa continuam intactos.
  assert.equal(musica.semMarcacao('Água — Pt. II (feat. João) [Remix]'), 'Água — Pt. II (feat. João) [Remix]');
});

test('uma sala sem bot devolve um estado vazio, não um buraco', () => {
  // A sala pede este estado ao entrar, antes de qualquer música existir. Devolver nulo
  // aqui faria a interface quebrar justamente na primeira coisa que ela faz.
  const vazio = musica.instantaneo('sala-que-nunca-teve-musica');
  assert.equal(vazio.conectado, false);
  assert.equal(vazio.tocando, null);
  assert.deepEqual(vazio.fila, []);
  assert.equal(typeof vazio.volume, 'number');
  assert.equal(musica.estadoDaSala('sala-que-nunca-teve-musica'), null);
});

test('comandos numa sala sem bot não derrubam o servidor', () => {
  // Alguém escreve "!pular" numa sala onde nada toca. Cada um destes precisa responder
  // "não tem nada tocando" em vez de estourar.
  assert.equal(musica.pular('sala-vazia'), null);
  assert.equal(musica.pausar('sala-vazia', true), false);
  assert.equal(musica.definirVolume('sala-vazia', 50), null);
  assert.equal(musica.removerDaFila('sala-vazia', 1), null);
  assert.equal(musica.embaralhar('sala-vazia'), false);
  // `!parar` virou desconexão: esvazia a fila e tira o bot da chamada. Numa sala onde ele
  // nunca entrou, isso tem de ser uma operação silenciosa em vez de um erro.
  assert.doesNotReject(musica.desconectar('sala-vazia', 'pedido'));
});

test('a identidade do bot é reservada e reconhecível', () => {
  assert.equal(musica.PREFIXO_DA_IDENTIDADE.endsWith('#'), true);
  // A identidade de gente é `nome#sufixo`. O prefixo do bot precisa terminar no mesmo '#'
  // para que "começa com o prefixo" seja prova de que aquele participante é o bot -- e o
  // servidor recusa esse nome para pessoas (ver nomeQueNaoSeFingeDeBot em server.js).
  assert.equal(`${musica.PREFIXO_DA_IDENTIDADE}minha-sala`.startsWith(musica.PREFIXO_DA_IDENTIDADE), true);
  assert.equal('nexo-dj (pessoa)#a1b2c3d4'.startsWith(musica.PREFIXO_DA_IDENTIDADE), false);
});

// Um "list=" no endereço quer dizer coisas diferentes conforme o resto do endereço, e
// confundir os dois casos custa caro nos dois sentidos: ou a sala recebe uma faixa quando
// pediu um álbum, ou recebe cinquenta quando pediu uma música.
test('lista inteira e música-dentro-de-lista são casos diferentes', () => {
  // Lista de verdade: a pessoa mandou uma lista.
  assert.equal(musica.ehListaInteira('https://www.youtube.com/playlist?list=PLabc123'), true);
  assert.equal(musica.ehListaInteira('https://music.youtube.com/playlist?list=OLAK5uy_abc'), true);
  assert.equal(musica.ehListaInteira('https://soundcloud.com/artista/sets/meu-album'), true);
  assert.equal(musica.ehListaInteira('https://artista.bandcamp.com/album/nome-do-disco'), true);

  // Uma música que por acaso estava numa lista -- é assim que o YouTube monta o link de
  // qualquer vídeo aberto a partir de uma playlist. Enfileirar tudo aqui sequestraria a
  // sala por causa de um copiar e colar.
  assert.equal(musica.ehListaInteira('https://www.youtube.com/watch?v=abc123&list=PLabc'), false);
  assert.equal(musica.ehListaInteira('https://soundcloud.com/artista/uma-faixa'), false);
  assert.equal(musica.ehListaInteira('daft punk around the world'), false);
  assert.equal(musica.ehListaInteira('nao é nem url'), false);

  // Mas dá para avisar que existe uma lista ali -- menos o mix infinito "RD...", que o
  // YouTube inventa sozinho e não é uma lista que alguém montou.
  assert.equal(musica.listaEmbutida('https://www.youtube.com/watch?v=abc&list=PLabc'), 'PLabc');
  assert.equal(musica.listaEmbutida('https://www.youtube.com/watch?v=abc&list=RDabc'), null);
  assert.equal(musica.listaEmbutida('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(musica.listaEmbutida('texto solto'), null);
});

test('desconectar uma sala que não tem bot é uma operação silenciosa', async () => {
  // O servidor chama isto toda vez que uma sala esvazia, tenha havido música ou não.
  await assert.doesNotReject(musica.desconectar('sala-sem-bot', 'sala-vazia'));
  await assert.doesNotReject(musica.encerrarTudo());
});
