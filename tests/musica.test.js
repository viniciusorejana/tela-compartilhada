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
  assert.equal(musica.removerDaFila('sala-vazia', 1), null);
  assert.equal(musica.embaralhar('sala-vazia'), false);
  // `!parar` virou desconexão: esvazia a fila e tira o bot da chamada. Numa sala onde ele
  // nunca entrou, isso tem de ser uma operação silenciosa em vez de um erro.
  assert.doesNotReject(musica.desconectar('sala-vazia', 'pedido'));
  // O volume é a exceção da lista, e de propósito: ele é da SALA, não da passagem do bot
  // por ela. Anotar antes de o bot chegar é o que evita chamá-lo alto para só então
  // abaixá-lo -- ver o teste do volume mais abaixo.
  assert.equal(musica.definirVolume('sala-vazia', 50).naSala, false);
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

// A fila é apontada pelo `id`. Entre a pessoa ver e o pedido chegar, outra pode ter tirado
// a faixa de cima -- e "mover a 3" moveria outra música.
test('mover uma faixa pelo id, para qualquer posição, sem sair dos limites da fila', () => {
  const fila = () => ['a', 'b', 'c', 'd'].map(id => ({ id, titulo: id.toUpperCase() }));
  const ids = lista => lista.map(f => f.id).join('');

  let lista = fila();
  assert.deepEqual(musica.moverNaLista(lista, 'd', 1), { faixa: { id: 'd', titulo: 'D' }, de: 4, para: 1 });
  assert.equal(ids(lista), 'dabc', 'para o topo: tocar a seguir');
  lista = fila();
  musica.moverNaLista(lista, 'a', 3);
  assert.equal(ids(lista), 'bcad', 'para baixo, a posição é a de chegada');
  lista = fila();
  musica.moverNaLista(lista, 'b', 99);
  assert.equal(ids(lista), 'acdb', 'além do fim, vai para o fim');
  lista = fila();
  musica.moverNaLista(lista, 'c', 0);
  assert.equal(ids(lista), 'cabd', 'antes do começo, vai para o começo');
  lista = fila();
  assert.equal(musica.moverNaLista(lista, 'sumiu', 1), null, 'faixa que saiu da fila não move outra no lugar');
  assert.equal(ids(lista), 'abcd');
  assert.equal(musica.moverNaLista(lista, 'b', 'não é número').para, 4, 'posição ilegível vai para o fim, e não some');
});

test('pedir numa posição: 1 é tocar a seguir, sem posição é o fim, e uma lista entra em ordem', () => {
  const nova = id => ({ id });
  const ids = lista => lista.map(f => f.id).join('');
  let lista = ['a', 'b'].map(nova);
  assert.equal(musica.inserirNaLista(lista, [nova('x')], 1), 1);
  assert.equal(ids(lista), 'xab');
  lista = ['a', 'b'].map(nova);
  assert.equal(musica.inserirNaLista(lista, [nova('x')]), 3);
  assert.equal(ids(lista), 'abx');
  lista = ['a', 'b'].map(nova);
  assert.equal(musica.inserirNaLista(lista, [nova('x'), nova('y')], 2), 2);
  assert.equal(ids(lista), 'axyb', 'o álbum pedido para a posição 2 entra inteiro ali, na ordem dele');
  lista = ['a'].map(nova);
  assert.equal(musica.inserirNaLista(lista, [nova('x')], 50), 2, 'além do fim, entra no fim');
});

test('reordenar numa sala sem bot não quebra nada', () => {
  assert.equal(musica.moverNaFila('sala-vazia', 'x', 1), null);
  assert.equal(musica.removerDaFilaPorId('sala-vazia', 'x'), null);
  assert.equal(musica.tocarAgora('sala-vazia', 'x'), null);
  assert.equal(musica.esvaziarFila('sala-vazia'), 0);
});

test('desconectar uma sala que não tem bot é uma operação silenciosa', async () => {
  // O servidor chama isto toda vez que uma sala esvazia, tenha havido música ou não.
  await assert.doesNotReject(musica.desconectar('sala-sem-bot', 'sala-vazia'));
  await assert.doesNotReject(musica.encerrarTudo());
});

// Spotify, Deezer e Apple Music não entregam o áudio para ninguém de fora: o bot lê o
// nome da música na página pública e procura essa música onde dá para baixar. Ler o
// endereço errado aqui erra a música inteira -- foi assim que um link da faixa `RUDE!`,
// do Hearts2Hearts, virou `Rude`, do Magic!, que é outra música de outra década.
test('o endereço diz a plataforma, o tipo e o id -- inclusive com idioma no caminho', () => {
  const comoLido = pedido => {
    const lugar = musica.ondeMora(pedido);
    return lugar && `${lugar.plataforma}/${lugar.tipo}/${lugar.id}`;
  };

  // O `/intl-pt/` é o que o Spotify monta para quem abre o site em português. Ignorá-lo é
  // o que faz o link copiado do celular brasileiro valer igual ao copiado do desktop.
  assert.equal(comoLido('https://open.spotify.com/intl-pt/track/2bAQsNqdo62T8akkIvWzGl'), 'spotify/track/2bAQsNqdo62T8akkIvWzGl');
  assert.equal(comoLido('https://open.spotify.com/track/2bAQsNqdo62T8akkIvWzGl?si=abc'), 'spotify/track/2bAQsNqdo62T8akkIvWzGl');
  assert.equal(comoLido('spotify:track:2bAQsNqdo62T8akkIvWzGl'), 'spotify/track/2bAQsNqdo62T8akkIvWzGl');
  assert.equal(comoLido('https://open.spotify.com/album/3053E9tumiU5rqbAPWF06s'), 'spotify/album/3053E9tumiU5rqbAPWF06s');

  // O Deezer põe o país no caminho às vezes, e às vezes não.
  assert.equal(comoLido('https://www.deezer.com/br/track/3135556'), 'deezer/track/3135556');
  assert.equal(comoLido('https://deezer.com/album/302127'), 'deezer/album/302127');

  // A Apple põe a FAIXA dentro do álbum: o mesmo endereço, com e sem `?i=`, é a faixa e
  // o álbum inteiro. Tratar os dois igual enfileirava um disco por causa de uma música.
  assert.equal(comoLido('https://music.apple.com/br/album/better-together/1440857781?i=1440857786'), 'apple/track/1440857786');
  assert.equal(comoLido('https://music.apple.com/br/album/in-between-dreams/1440857781'), 'apple/album/1440857781');

  // O que o yt-dlp já baixa sozinho não passa por ponte nenhuma.
  assert.equal(comoLido('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(comoLido('https://soundcloud.com/artista/faixa'), null);
  assert.equal(comoLido('nome de música solto'), null);

  // Id fora do formato não vira endereço de consulta.
  assert.equal(comoLido('https://open.spotify.com/track/../../etc'), null);
  assert.equal(comoLido('https://www.deezer.com/br/track/abc'), null);
});

test('álbum e lista dessas plataformas contam como lista; faixa avulsa não', () => {
  assert.equal(musica.ehListaInteira('https://open.spotify.com/album/3053E9tumiU5rqbAPWF06s'), true);
  assert.equal(musica.ehListaInteira('https://open.spotify.com/intl-pt/playlist/37i9dQZF1DXcBWIGoYBM5M'), true);
  assert.equal(musica.ehListaInteira('https://www.deezer.com/br/playlist/908622995'), true);
  assert.equal(musica.ehListaInteira('https://music.apple.com/br/album/in-between-dreams/1440857781'), true);

  assert.equal(musica.ehListaInteira('https://open.spotify.com/intl-pt/track/2bAQsNqdo62T8akkIvWzGl'), false);
  assert.equal(musica.ehListaInteira('https://www.deezer.com/br/track/3135556'), false);
  // Faixa dentro de um álbum da Apple: é uma música, não o disco.
  assert.equal(musica.ehListaInteira('https://music.apple.com/br/album/better-together/1440857781?i=1440857786'), false);
});

// O bot sai da chamada sozinho depois de um minuto e meio sem fila, e o estado dele morre
// junto. O volume não pode morrer junto: quem pôs em 40 mudou o volume DA SALA, e voltar ao
// padrão no próximo pedido é um susto no meio da conversa de todo mundo.
test('o volume é da sala e sobrevive ao bot sair e voltar', async () => {
  // Sala nova começa baixo: música de fundo não pode chegar por cima da conversa.
  assert.equal(musica.instantaneo('sala-do-volume').volume, 15, 'sala nova começa no padrão');

  const ajuste = musica.definirVolume('sala-do-volume', 40);
  assert.equal(ajuste.porcento, 40);
  assert.equal(ajuste.naSala, false, 'dá para deixar o volume pronto antes de chamar o bot');
  assert.equal(musica.instantaneo('sala-do-volume').volume, 40, 'o painel mostra o que a sala escolheu');

  // O bot indo embora não apaga a escolha.
  await musica.desconectar('sala-do-volume', 'silencioso');
  assert.equal(musica.instantaneo('sala-do-volume').volume, 40);

  // Cada sala com o seu: mexer numa não mexe na outra.
  musica.definirVolume('outra-sala', 120);
  assert.equal(musica.instantaneo('sala-do-volume').volume, 40);
  assert.equal(musica.instantaneo('outra-sala').volume, 120);

  // Fora da faixa aceita, corta nas pontas em vez de distorcer ou emudecer por engano.
  assert.equal(musica.definirVolume('outra-sala', 900).porcento, 150);
  assert.equal(musica.definirVolume('outra-sala', -30).porcento, 0);

  // A sala esvaziou: aí sim, nada dela sobrevive -- como o histórico e a mesa de sons.
  await musica.esquecerSala('sala-do-volume');
  assert.equal(musica.instantaneo('sala-do-volume').volume, 15);
});
