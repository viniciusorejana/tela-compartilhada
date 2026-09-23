// O bot de musica. Um participante por sala, que entra na chamada como qualquer outro e
// publica UMA faixa de audio -- a musica.
//
// Por que um participante de verdade, e nao um <audio> tocando em cada navegador:
//
//   1. Sincronizacao. Todo mundo recebe os MESMOS pacotes do servidor de midia, pelo mesmo
//      caminho do audio de tela que ja existe. Nao ha relogio para acertar nem deriva para
//      corrigir: a sala inteira ouve o mesmo instante da musica porque e o mesmo fluxo.
//   2. Volume por pessoa sai de graca. O bot e um participante, entao o controle de volume
//      que a sala ja tem por participante vale para ele sem uma linha de interface nova.
//   3. Quem entra no meio pega a musica onde ela esta, nao do comeco.
//
// O custo e de quem hospeda, e e pequeno: audio a 48 kHz estereo sao 192 KB/s por sala
// atravessando este processo. O trabalho pesado -- baixar e decodificar -- fica em um
// processo a parte por sala (dois, nos casos que precisam do yt-dlp no caminho), entao uma
// sala tocando nunca trava o laco de eventos das outras.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node');

const { caminhoDoFfmpeg, caminhoDoYtdlp } = require('./scripts/baixar-musica.cjs');

// 48 kHz estereo e o que o Opus usa internamente: entregar nesse formato evita uma
// reamostragem no caminho. Quadros de 20 ms sao o tamanho natural de um pacote Opus --
// metade das chamadas de 10 ms para a mesma musica.
const TAXA = 48000;
const CANAIS = 2;
const MS_POR_QUADRO = 20;
const AMOSTRAS_POR_QUADRO = (TAXA * MS_POR_QUADRO) / 1000;   // por canal
const BYTES_POR_QUADRO = AMOSTRAS_POR_QUADRO * CANAIS * 2;   // 16 bits por amostra

// Quantos segundos de audio ficam adiantados dentro do servidor de midia. Uma fila curta
// deixa a musica engasgar quando a rede do host tossir; uma longa atrasa o "pular" e come
// memoria. Meio segundo cobre um soluco sem que ninguem perceba atraso no comando.
const SEGUNDOS_DE_FILA = 0.5;

// O bot nao fica na sala sem ter o que tocar: ele ocupa um lugar na lista de todo mundo e
// segura uma conexao a toa. Some sozinho, e volta no proximo pedido.
const SEGUNDOS_ATE_SAIR_OCIOSO = 90;

// De quanto em quanto tempo a sala recebe o cronometro do que esta tocando. Cada tela
// conta os segundos sozinha entre um aviso e outro -- o que evita uma mensagem por segundo
// por sala --, e este aviso e o que impede essa contagem de se afastar do que realmente
// esta saindo.
const SEGUNDOS_ENTRE_AVISOS = 5;

// Teto de salas tocando ao mesmo tempo. Cada uma custa um processo de decodificacao e uma
// conexao; sem um teto, uma sala a mais sempre parece barata ate a maquina ficar sem folga
// e TODAS engasgarem juntas. Recusar a decima e melhor do que estragar as nove.
const MAXIMO_DE_SALAS_TOCANDO = Number(process.env.NEXO_MAXIMO_DE_BOTS) || 8;

const MAXIMO_NA_FILA = 60;
// Transmissao ao vivo nao tem fim: ela seguraria a fila para sempre. Um limite tambem
// protege de alguem enfileirar um video de dez horas sem querer.
const SEGUNDOS_MAXIMOS_DA_FAIXA = Number(process.env.NEXO_DURACAO_MAXIMA) || 3 * 60 * 60;

// Prefixo reservado da identidade do bot. O servidor recusa esse prefixo para gente (em
// server.js), entao ver esta marca na identidade e prova de que aquele participante e o bot.
const PREFIXO_DA_IDENTIDADE = 'nexo-dj#';
const NOME_DO_BOT = 'Nexo DJ';

const identidadeDoBot = sala => `${PREFIXO_DA_IDENTIDADE}${sala}`;

// Estado por sala. Nenhuma sala aparece aqui antes do primeiro pedido.
const salas = new Map();

// Volume com que o bot toca, guardado POR SALA e fora do estado acima.
//
// Fica separado de propósito: o estado do bot morre toda vez que ele sai da chamada -- e
// ele sai sozinho depois de um minuto e meio sem fila. Guardar o volume junto significava
// que, no pedido seguinte, a sala voltava a ouvir a música a 85% por mais alto ou mais
// baixo que tivessem deixado. Quem ajustou o volume ajustou o volume DA SALA, não o de
// uma passagem do bot por ela, e essa escolha vale enquanto a sala existir.
//
// Some junto com a sala, como todo o resto: quando a última pessoa sai, `esquecerSala`
// apaga isto do mesmo jeito que a mesa de sons e o histórico do chat são apagados.
const volumePorSala = new Map();
const VOLUME_PADRAO = 0.85;

// Como a sala e avisada. Preenchido por server.js na inicializacao para este modulo nao
// precisar conhecer o Socket.IO.
let anunciar = () => {};
let criarTokenDoBot = () => { throw new Error('bot sem emissor de token'); };
let enderecoDoServidorDeMidia = () => 'ws://127.0.0.1:7880';

function configurar({ aoMudar, criarToken, enderecoLocal }) {
  anunciar = aoMudar || anunciar;
  criarTokenDoBot = criarToken || criarTokenDoBot;
  enderecoDoServidorDeMidia = enderecoLocal || enderecoDoServidorDeMidia;
}

// ---------- Resolucao: de "o que a pessoa escreveu" para "uma faixa tocavel" ----------

const EH_ENDERECO = /^https?:\/\//i;

// O bot escreve em negrito e em `código`, e quase tudo que ele diz carrega texto de fora:
// o titulo que o site devolveu, o que a pessoa pediu, o nome de quem pediu. Um asterisco
// perdido em qualquer um deles abre uma marcacao que fecha no lugar errado, e metade da
// frase sai em negrito. Nao e falha de seguranca -- nada disso vira HTML do outro lado --,
// e so a frase saindo torta.
function semMarcacao(texto) {
  return String(texto == null ? '' : texto).replace(/[*`]/g, '');
}

function executar(binario, argumentos, { timeoutMs = 45000, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const processo = spawn(binario, argumentos, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    let excedeu = false;
    const prazo = setTimeout(() => { excedeu = true; processo.kill(); }, timeoutMs);
    processo.stdout.on('data', pedaco => {
      saida += pedaco;
      // Um extrator que resolva devolver megabytes nao pode crescer sem limite na memoria
      // de quem hospeda.
      if (saida.length > maxBytes) { excedeu = true; processo.kill(); }
    });
    processo.stderr.on('data', pedaco => { erro = (erro + pedaco).slice(-4000); });
    processo.on('error', falha => { clearTimeout(prazo); reject(falha); });
    processo.on('close', codigo => {
      clearTimeout(prazo);
      if (excedeu) return reject(new Error('a busca demorou demais'));
      if (codigo !== 0) return reject(new Error(primeiraLinhaDeErro(erro)));
      resolve(saida);
    });
  });
}

// O yt-dlp escreve muita coisa no stderr; o que interessa a quem pediu a musica e a linha
// do erro, sem o prefixo e sem o rastro de pilha.
function primeiraLinhaDeErro(texto) {
  const linha = String(texto).split('\n').map(l => l.trim()).filter(Boolean).reverse()
    .find(l => /^ERROR:/i.test(l));
  if (!linha) return 'não consegui abrir esse link';
  return linha.replace(/^ERROR:\s*/i, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 180);
}

// Audio e so audio: pedir o formato de video junto faria o ffmpeg descartar a imagem
// depois de ela ja ter atravessado a rede.
//
// O MESMO seletor vale na busca e no download, e isso importa: e ele que faz a busca
// escolher uma faixa concreta e, com ela, devolver o endereco direto do audio. Sem o
// seletor a ficha volta sem `url` -- o bot funciona, mas sempre pelo caminho lento.
const FORMATO_DE_AUDIO = 'bestaudio[abr<=192]/bestaudio/best';

// Argumentos comuns a toda chamada do yt-dlp. "--no-update" evita o aviso de versao velha
// no stderr, que so polui o diagnostico -- quem atualiza e o npm run musica:atualizar.
function argumentosBase() {
  const extras = (process.env.NEXO_YTDLP_ARGS || '').split(' ').filter(Boolean);
  return ['--no-playlist', '--no-warnings', '--no-update', '--no-color', '--socket-timeout', '15', '-f', FORMATO_DE_AUDIO, ...extras];
}

// ---------- Plataformas que não entregam o áudio ----------
//
// Spotify, Deezer e Apple Music não deixam ninguém de fora baixar o som: o fluxo é cifrado
// e não há conta paga que resolva. O que dá para fazer é o que todo bot de música faz --
// ler na página pública QUAL é a música e procurar essa música onde dá para baixar.
//
// O detalhe que decide se a música certa toca é ler o ARTISTA junto com o nome. O oEmbed
// do Spotify devolve só o título: para a faixa `RUDE!`, do Hearts2Hearts, ele devolve
// `RUDE!` e mais nada, e a busca no YouTube trazia `Rude`, do Magic! -- uma música
// diferente, de outra década, incomparavelmente mais popular. Tocava a errada sem nenhum
// aviso de que era. Procurando por `Hearts2Hearts RUDE!`, o primeiro resultado é o certo.
//
// Nenhum destes endereços pede chave nem conta: são os mesmos que o navegador de qualquer
// pessoa abre ao ver a página.

// Ids das três plataformas, conferidos antes de entrarem numa URL de consulta. O id sai do
// que alguém colou no chat, e daqui ele vira endereço de rede.
const ID_DO_SPOTIFY = /^[A-Za-z0-9]{22}$/;
const ID_NUMERICO = /^[0-9]{1,15}$/;

// Encurtadores. O botão de compartilhar do celular entrega estes, e sem abri-los não dá
// para saber se o que vem é uma faixa ou um álbum inteiro.
const ENCURTADORES = /^(spotify\.link|link\.tospotify\.com|deezer\.page\.link|dzr\.page\.link)$/i;

async function expandirAtalho(pedido) {
  if (!EH_ENDERECO.test(pedido)) return pedido;
  let endereco;
  try { endereco = new URL(pedido); } catch (_) { return pedido; }
  if (!ENCURTADORES.test(endereco.hostname)) return pedido;
  try {
    // "manual" em vez de seguir: o destino é tudo que interessa, e seguir baixaria a
    // página inteira do Spotify (quase 300 KB) para ler uma linha de cabeçalho.
    const resposta = await fetch(pedido, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const destino = resposta.headers.get('location');
    return destino && EH_ENDERECO.test(destino) ? destino : pedido;
  } catch (_) {
    return pedido;
  }
}

// De um endereço colado para "que plataforma, que tipo de coisa, qual id". Devolve null
// para tudo que o yt-dlp já baixa sozinho -- YouTube, SoundCloud, Bandcamp --, que é o
// caminho bom e não passa por ponte nenhuma.
function ondeMora(pedido) {
  const uri = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/i.exec(String(pedido).trim());
  if (uri) return { plataforma: 'spotify', tipo: uri[1].toLowerCase(), id: uri[2] };
  if (!EH_ENDERECO.test(pedido)) return null;

  let endereco;
  try { endereco = new URL(pedido); } catch (_) { return null; }
  const host = endereco.hostname.replace(/^www\./i, '').toLowerCase();
  // "/intl-pt/track/..." é o que o Spotify monta para quem abre o site em português. O
  // idioma no caminho não muda nada do que vem depois dele.
  const partes = endereco.pathname.split('/').filter(Boolean).filter(p => !/^intl-[a-z-]+$/i.test(p));

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const [tipo, id] = partes;
    if (!ID_DO_SPOTIFY.test(id || '')) return null;
    if (tipo === 'track' || tipo === 'album' || tipo === 'playlist') return { plataforma: 'spotify', tipo, id };
    return null;
  }

  if (host === 'deezer.com' || host === 'deezer.page.link') {
    // O país aparece no caminho ("/br/track/123") e às vezes não aparece.
    const indice = partes.findIndex(p => p === 'track' || p === 'album' || p === 'playlist');
    if (indice < 0) return null;
    const tipo = partes[indice];
    const id = partes[indice + 1];
    return ID_NUMERICO.test(id || '') ? { plataforma: 'deezer', tipo, id } : null;
  }

  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    // A Apple põe a faixa DENTRO do álbum: ".../album/<slug>/<idDoAlbum>?i=<idDaFaixa>".
    // Sem o "?i=", o mesmo endereço é o álbum inteiro.
    const faixaNoAlbum = endereco.searchParams.get('i');
    const indice = partes.findIndex(p => p === 'album' || p === 'song' || p === 'playlist');
    if (indice < 0) return null;
    const alvo = partes[indice];
    const id = partes[partes.length - 1];
    if (alvo === 'playlist') return { plataforma: 'apple', tipo: 'playlist', id };
    if (faixaNoAlbum && ID_NUMERICO.test(faixaNoAlbum)) return { plataforma: 'apple', tipo: 'track', id: faixaNoAlbum };
    if (!ID_NUMERICO.test(id || '')) return null;
    return { plataforma: 'apple', tipo: alvo === 'song' ? 'track' : 'album', id };
  }

  return null;
}

const NOME_DA_PLATAFORMA = { spotify: 'Spotify', deezer: 'Deezer', apple: 'Apple Music' };

// O que o bot procura no YouTube. Artista primeiro porque é assim que as pessoas nomeiam
// os vídeos, e porque é o que separa duas músicas de mesmo nome.
function termoDeBusca(titulo, autor) {
  return `${autor || ''} ${titulo || ''}`.trim().replace(/\s+/g, ' ').slice(0, 160);
}

async function lerJson(endereco, plataforma) {
  const resposta = await fetch(endereco, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!resposta.ok) throw new Error(`o ${plataforma} não respondeu`);
  return resposta.json();
}

// ---------- Spotify ----------

// A página de incorporação traz a mesma ficha que o tocador usa, num JSON já pronto: nome,
// artistas e, em álbum e lista, a lista de faixas inteira. São 10 KB contra os quase 300 KB
// da página normal, e não é raspagem de HTML -- é o mesmo JSON que o tocador lê.
async function fichaDoSpotify(tipo, id) {
  const resposta = await fetch(`https://open.spotify.com/embed/${tipo}/${id}`, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; NexoDJ/1.0)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!resposta.ok) throw new Error('esse link do Spotify não abriu');
  const pagina = await resposta.text();
  const bloco = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(pagina);
  if (!bloco) return null;
  try {
    return JSON.parse(bloco[1])?.props?.pageProps?.state?.data?.entity || null;
  } catch (_) {
    return null;
  }
}

// O caminho de antes, guardado como rede de proteção: se o Spotify mudar o formato da
// página de incorporação, o bot volta a tocar a música mais ou menos certa em vez de
// simplesmente parar de aceitar links do Spotify.
async function tituloNoSpotify(tipo, id) {
  const dados = await lerJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${tipo}/${id}`)}`, 'Spotify');
  const titulo = String(dados?.title || '').trim();
  if (!titulo) throw new Error('não achei o nome dessa faixa no Spotify');
  return titulo;
}

async function doSpotify(tipo, id) {
  const ficha = await fichaDoSpotify(tipo, id);
  if (!ficha) {
    // Os dois caminhos falharam. Dizer que o link não abriu é o que a pessoa precisa
    // saber; "o Spotify não respondeu" mandaria procurar defeito na internet dela.
    try { return { tipo: 'faixa', busca: await tituloNoSpotify(tipo, id) }; }
    catch (_) { throw new Error('esse link do Spotify não abriu'); }
  }

  if (tipo === 'track') {
    const autor = (ficha.artists || []).map(a => a.name).filter(Boolean).join(', ');
    return { tipo: 'faixa', titulo: ficha.name || ficha.title, autor, busca: termoDeBusca(ficha.name || ficha.title, autor) };
  }

  // Em álbum e lista cada linha já vem com o artista dela em "subtitle" -- o que importa,
  // porque uma coletânea tem um artista diferente por faixa.
  const faixas = (ficha.trackList || []).map(f => ({
    titulo: f.title,
    autor: f.subtitle || ficha.subtitle || '',
    pagina: /^spotify:track:([A-Za-z0-9]{22})$/.test(f.uri || '')
      ? `https://open.spotify.com/track/${f.uri.split(':')[2]}`
      : null
  }));
  return { tipo: 'lista', nome: ficha.name || ficha.title || 'Lista do Spotify', faixas };
}

// ---------- Deezer ----------

async function doDeezer(tipo, id) {
  const dados = await lerJson(`https://api.deezer.com/${tipo}/${id}`, 'Deezer');
  if (dados?.error) throw new Error('esse link do Deezer não abriu');
  if (tipo === 'track') {
    const autor = dados?.artist?.name || '';
    return { tipo: 'faixa', titulo: dados?.title, autor, busca: termoDeBusca(dados?.title, autor) };
  }
  const faixas = (dados?.tracks?.data || []).map(f => ({
    titulo: f.title,
    autor: f.artist?.name || dados?.artist?.name || '',
    pagina: /^https:\/\//.test(f.link || '') ? f.link : null
  }));
  return { tipo: 'lista', nome: dados?.title || 'Lista do Deezer', faixas };
}

// ---------- Apple Music ----------

async function daApple(tipo, id) {
  if (tipo === 'playlist') throw new Error('lista da Apple Music não abre para quem está de fora; mande o link de um álbum ou o nome das músicas');
  // A mesma consulta que o site da Apple usa para montar a página. "entity=song" é o que
  // faz o álbum vir com as faixas em vez de só com o nome.
  const dados = await lerJson(`https://itunes.apple.com/lookup?id=${id}${tipo === 'album' ? '&entity=song&limit=200' : ''}`, 'Apple Music');
  const achados = Array.isArray(dados?.results) ? dados.results : [];
  if (!achados.length) throw new Error('esse link da Apple Music não abriu');

  if (tipo === 'track') {
    const f = achados.find(r => r.wrapperType === 'track') || achados[0];
    return { tipo: 'faixa', titulo: f.trackName, autor: f.artistName, busca: termoDeBusca(f.trackName, f.artistName) };
  }
  const disco = achados.find(r => r.wrapperType === 'collection');
  const faixas = achados.filter(r => r.wrapperType === 'track' && r.trackName).map(f => ({
    titulo: f.trackName,
    autor: f.artistName || disco?.artistName || '',
    pagina: /^https:\/\//.test(f.trackViewUrl || '') ? f.trackViewUrl : null
  }));
  return { tipo: 'lista', nome: disco?.collectionName || 'Álbum da Apple Music', faixas };
}

// A ponte de uma plataforma, já normalizada. Devolve null quando o endereço não precisa de
// ponte -- e é esse null que mantém YouTube, SoundCloud e Bandcamp no caminho direto.
async function atravessarPonte(pedido) {
  const lugar = ondeMora(pedido);
  if (!lugar) return null;
  const leitor = { spotify: doSpotify, deezer: doDeezer, apple: daApple }[lugar.plataforma];
  const lido = await leitor(lugar.tipo, lugar.id);
  const plataforma = NOME_DA_PLATAFORMA[lugar.plataforma];

  if (lido.tipo === 'faixa') {
    if (!lido.busca) throw new Error(`não achei o nome dessa faixa no ${plataforma}`);
    return { tipo: 'faixa', plataforma, busca: semMarcacao(lido.busca) };
  }
  const faixas = lido.faixas.filter(f => f.titulo).map(f => ({
    titulo: semMarcacao(f.titulo).slice(0, 160),
    autor: semMarcacao(f.autor).slice(0, 80),
    busca: semMarcacao(termoDeBusca(f.titulo, f.autor)),
    pagina: f.pagina
  }));
  if (!faixas.length) throw new Error(`essa lista do ${plataforma} está vazia ou é privada`);
  return { tipo: 'lista', plataforma, nome: semMarcacao(lido.nome).slice(0, 80), faixas };
}

// Quantos resultados de uma busca sao tentados antes de desistir. O primeiro nem sempre
// serve: um clipe com restricao de idade recusa o download inteiro ("Sign in to confirm
// your age"), e ele costuma ser justamente o video oficial -- o primeiro resultado. Sem
// isto, pedir uma musica explicita simplesmente nao funcionava, embora a segunda copia da
// MESMA musica, logo abaixo, tocasse sem problema.
const RESULTADOS_A_TENTAR = 3;

// ---------- Listas (playlists, álbuns, sets) ----------
//
// Uma lista nao e resolvida faixa por faixa na hora de enfileirar: cada resolucao custa
// uns tres segundos, e uma lista de cinquenta levaria dois minutos e meio de espera antes
// de a primeira nota sair. `--flat-playlist` devolve a lista inteira numa chamada so (dois
// segundos para qualquer tamanho) com o que basta para MOSTRAR a fila -- titulo, duracao e
// endereco da pagina.
//
// O endereco do audio de cada uma e descoberto depois, quando chega a vez dela. Ver
// `garantirResolvida`.
const MAXIMO_DA_LISTA = 100;

// Um "list=" no endereco pode significar duas coisas bem diferentes, e tratar as duas
// igual erra metade das vezes:
//
//   /playlist?list=...      a pessoa mandou uma LISTA. Enfileira tudo.
//   /watch?v=X&list=...     a pessoa mandou UMA MÚSICA que por acaso estava numa lista --
//                           e e assim que o YouTube monta o link de qualquer video aberto
//                           a partir de uma lista. Enfileirar cinquenta faixas aqui seria
//                           sequestrar a sala por causa de um copiar e colar.
function ehListaInteira(pedido) {
  // Spotify, Deezer e Apple Music dizem no proprio caminho o que sao. Sem esta pergunta,
  // um album inteiro do Spotify era tratado como uma faixa so -- e o bot ia procurar no
  // YouTube uma musica chamada com o nome do album.
  const lugar = ondeMora(pedido);
  if (lugar) return lugar.tipo === 'album' || lugar.tipo === 'playlist';
  if (!EH_ENDERECO.test(pedido)) return false;
  try {
    const endereco = new URL(pedido);
    if (/\/playlist\b/i.test(endereco.pathname) && endereco.searchParams.get('list')) return true;
    // SoundCloud e Bandcamp nao usam "list=": a lista esta no proprio caminho.
    if (/soundcloud\.com/i.test(endereco.hostname) && /\/sets\//i.test(endereco.pathname)) return true;
    if (/bandcamp\.com/i.test(endereco.hostname) && /\/album\//i.test(endereco.pathname)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// Um video aberto de dentro de uma lista. Toca so ele, mas vale avisar que ha mais.
function listaEmbutida(pedido) {
  try {
    const endereco = new URL(pedido);
    const lista = endereco.searchParams.get('list');
    // "RD..." e o mix infinito que o YouTube gera sozinho; nao e uma lista que alguem fez.
    return lista && !/^RD/i.test(lista) && !/\/playlist\b/i.test(endereco.pathname) ? lista : null;
  } catch (_) {
    return null;
  }
}

// ---------- Achar uma lista sem sair da sala ----------
//
// Colar um link funciona, mas o caminho ate ele e chato: abrir outra aba ou outro
// aplicativo, procurar, copiar, voltar. Aqui a busca acontece no proprio canal -- a pessoa
// escreve o que quer ouvir e recebe listas para escolher.
//
// "sp=EgIQAw" e o filtro de PLAYLISTS da busca do YouTube. Sem ele a busca devolve videos
// avulsos, que e o que `!bot` ja faz.
const FILTRO_DE_PLAYLISTS = 'EgIQAw%3D%3D';
const LISTAS_SUGERIDAS = 5;

async function buscarListas(termo) {
  const endereco = `https://www.youtube.com/results?search_query=${encodeURIComponent(termo)}&sp=${FILTRO_DE_PLAYLISTS}`;
  const bruto = await executar(caminhoDoYtdlp(), [
    '--no-warnings', '--no-update', '--no-color', '--socket-timeout', '15',
    '--flat-playlist', '--playlist-items', `1-${LISTAS_SUGERIDAS}`,
    '--print', '%(.{title,url})j',
    ...(process.env.NEXO_YTDLP_ARGS || '').split(' ').filter(Boolean),
    endereco
  ], { timeoutMs: 45000 });

  const achadas = [];
  for (const linha of bruto.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'))) {
    let ficha;
    try { ficha = JSON.parse(linha); } catch (_) { continue; }
    // So entra o que É uma lista. A busca filtrada raramente devolve outra coisa, mas o
    // endereco vira botao na tela de todo mundo: conferir aqui é mais barato que confiar.
    if (!ehListaInteira(String(ficha.url || ''))) continue;
    achadas.push({ titulo: semMarcacao(ficha.title || 'Lista').slice(0, 90), endereco: String(ficha.url) });
  }
  if (!achadas.length) throw new Error('não achei nenhuma lista com isso');
  return achadas;
}

const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function listarFaixasDaLista(endereco, quantas) {
  // Álbum ou lista de uma plataforma que não entrega áudio. A lista de faixas vem da
  // própria plataforma -- com nome E artista de cada uma --, e cada faixa vira uma busca
  // quando chegar a vez dela. É o mesmo adiamento das listas do YouTube: enfileirar uma
  // lista de cinquenta não pode custar cinquenta buscas antes da primeira nota sair.
  const ponte = await atravessarPonte(endereco);
  if (ponte) {
    // `!lista` apontando para uma faixa avulsa: uma faixa é o que ela é. A busca sai
    // daqui em vez de voltar por `resolver`, que leria a mesma página de novo.
    if (ponte.tipo === 'faixa') return [await tentarAlvo(`ytsearch${RESULTADOS_A_TENTAR}:${ponte.busca}`, ponte.plataforma)];
    return ponte.faixas.slice(0, quantas).map(f => ({
      id: novoId(),
      titulo: f.titulo,
      autor: f.autor,
      duracao: 0,
      // O endereço da página na plataforma de origem, que é o que a sala mostra como
      // "abrir". O endereço do áudio é outro, e nasce da busca lá na frente.
      endereco: f.pagina || '',
      capa: null,
      origem: `${ponte.nome} (${ponte.plataforma})`.slice(0, 80),
      midia: null,
      porResolver: true,
      busca: f.busca,
      plataformaDaPonte: ponte.plataforma
    }));
  }

  const modelo = '%(.{id,title,url,duration,uploader,channel,playlist_title})j';
  const bruto = await executar(caminhoDoYtdlp(), [
    // "--flat-playlist" e o que torna isto barato: ele NAO abre cada video, so le o indice.
    // Sem ele, o yt-dlp resolveria as cinquenta, uma a uma, antes de devolver qualquer coisa.
    '--no-warnings', '--no-update', '--no-color', '--socket-timeout', '15',
    '--flat-playlist', '--playlist-items', `1-${quantas}`, '--print', modelo,
    ...(process.env.NEXO_YTDLP_ARGS || '').split(' ').filter(Boolean),
    endereco
  ], { timeoutMs: 60000 });

  const faixas = [];
  for (const linha of bruto.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'))) {
    let ficha;
    try { ficha = JSON.parse(linha); } catch (_) { continue; }
    const pagina = String(ficha.url || '');
    if (!/^https?:\/\//i.test(pagina)) continue;
    faixas.push({
      id: novoId(),
      titulo: semMarcacao(ficha.title || 'Sem título').slice(0, 160),
      autor: semMarcacao(ficha.channel || ficha.uploader || '').slice(0, 80),
      duracao: Number(ficha.duration) || 0,
      endereco: pagina,
      capa: null,
      origem: semMarcacao(ficha.playlist_title || 'Lista').slice(0, 80),
      // Sem endereco de audio ainda: ele e descoberto quando chegar a vez dela.
      midia: null,
      porResolver: true
    });
  }
  if (!faixas.length) throw new Error('essa lista está vazia ou é privada');
  return faixas;
}

// Descobre o endereco do audio de uma faixa que veio de uma lista. Chamado na hora de
// tocar e, uma faixa antes disso, para a troca nao esperar por ele.
//
// As duas chamadas se encontram na MESMA faixa o tempo todo: o adiantamento comeca a
// resolver a proxima, e segundos depois ela vira a atual. Guardar a promessa em curso faz
// a segunda chamada aguardar a primeira em vez de abrir outra consulta para o mesmo video.
function garantirResolvida(faixa) {
  if (!faixa.porResolver) return Promise.resolve(faixa);
  if (faixa.resolvendo) return faixa.resolvendo;
  // Faixa vinda de uma lista do Spotify (ou do Deezer, ou da Apple) nao tem endereco para
  // baixar: o que ela tem e nome e artista. Ai a resolucao e a mesma busca que uma faixa
  // avulsa daquela plataforma faria -- inclusive tentando o segundo e o terceiro
  // resultado, que e o que salva quando o primeiro e um clipe com restricao de idade.
  const alvo = faixa.busca ? `ytsearch${RESULTADOS_A_TENTAR}:${faixa.busca}` : faixa.endereco;
  faixa.resolvendo = tentarAlvo(alvo, faixa.plataformaDaPonte || null).then(cheia => {
    faixa.midia = cheia.midia;
    faixa.duracao = faixa.duracao || cheia.duracao;
    faixa.capa = faixa.capa || cheia.capa;
    // Só quando não havia nenhum: o endereço da plataforma de origem é mais útil para
    // quem pediu do que o do vídeo que acabou tocando.
    faixa.endereco = faixa.endereco || cheia.endereco;
    faixa.porResolver = false;
    return faixa;
  }).finally(() => { faixa.resolvendo = null; });
  return faixa.resolvendo;
}

// Uma busca tem varios resultados e vale tentar o proximo; um endereco direto e um so.
async function tentarAlvo(alvo, plataformaDaPonte) {
  const posicoes = alvo.startsWith('ytsearch') ? [...Array(RESULTADOS_A_TENTAR).keys()].map(i => i + 1) : [null];
  let ultimoErro = new Error('não achei nada com isso');
  for (const posicao of posicoes) {
    try {
      return await resolverUm(alvo, posicao, plataformaDaPonte);
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

async function resolver(pedido) {
  // Uma faixa de plataforma que nao entrega audio vira uma busca pelo nome COM o artista.
  const ponte = await atravessarPonte(pedido);
  if (ponte) {
    // `!bot <link de album>` sem o `!lista`: toca a primeira e nao sequestra a fila.
    const busca = ponte.tipo === 'faixa' ? ponte.busca : ponte.faixas[0].busca;
    return tentarAlvo(`ytsearch${RESULTADOS_A_TENTAR}:${busca}`, ponte.plataforma);
  }
  const alvo = EH_ENDERECO.test(pedido) ? pedido : `ytsearch${RESULTADOS_A_TENTAR}:${pedido}`;
  return tentarAlvo(alvo, null);
}

async function resolverUm(alvo, posicao, plataformaDaPonte) {
  // Um JSON com os campos que interessam, em vez do despejo inteiro: a ficha completa de
  // um video do YouTube passa de 400 KB porque traz todos os formatos, e nada disso e
  // usado aqui.
  //
  // "url" e "http_headers" sao o que permite tocar sem abrir o yt-dlp de novo -- ver
  // `abrirPipeline`. Os cabecalhos vem junto porque a URL nao vale sem eles: o YouTube
  // amarra o endereco ao cliente que o pediu e devolve 403 para qualquer outro.
  const modelo = '%(.{id,title,duration,webpage_url,uploader,channel,thumbnail,is_live,extractor_key,url,http_headers})j';
  const argumentos = [...argumentosBase(), '--print', modelo];
  if (posicao) argumentos.push('--playlist-items', String(posicao));
  const bruto = await executar(caminhoDoYtdlp(), [...argumentos, alvo]);
  const linha = bruto.split('\n').map(l => l.trim()).find(l => l.startsWith('{'));
  if (!linha) throw new Error('não achei nada com isso');

  const ficha = JSON.parse(linha);
  if (ficha.is_live) throw new Error('transmissão ao vivo não entra na fila');
  const duracao = Number(ficha.duration) || 0;
  if (duracao > SEGUNDOS_MAXIMOS_DA_FAIXA) throw new Error('essa faixa é longa demais para a fila');

  return {
    id: novoId(),
    // Limpo aqui, na entrada, e nao em cada frase que usa o titulo: sao nove lugares que
    // o citam hoje, e o decimo esqueceria.
    titulo: semMarcacao(ficha.title || 'Sem título').slice(0, 160),
    autor: semMarcacao(ficha.channel || ficha.uploader || '').slice(0, 80),
    duracao,
    endereco: String(ficha.webpage_url || alvo),
    capa: /^https:\/\//.test(ficha.thumbnail || '') ? String(ficha.thumbnail).slice(0, 400) : null,
    origem: plataformaDaPonte ? `${plataformaDaPonte} → YouTube` : String(ficha.extractor_key || 'Web'),
    // Fica de fora do que a sala ve: nao interessa a ninguem, e a URL assinada e longa.
    midia: enderecoDeMidia(ficha)
  };
}

// O endereco direto do audio, com os cabecalhos que o fazem valer. Aceito so em HTTP(S):
// o valor vai para a linha de comando do ffmpeg, e um esquema como "file:" ou "concat:"
// ali seria um caminho de leitura de arquivo desta maquina.
function enderecoDeMidia(ficha) {
  const url = String(ficha.url || '');
  if (!/^https?:\/\//i.test(url)) return null;
  const cabecalhos = Object.entries(ficha.http_headers || {})
    // Um valor com quebra de linha injetaria um cabecalho inteiro no pedido.
    .filter(([nome, valor]) => /^[A-Za-z0-9-]+$/.test(nome) && !/[\r\n]/.test(String(valor)))
    .map(([nome, valor]) => `${nome}: ${valor}`);
  return { url, cabecalhos: cabecalhos.join('\r\n') };
}

// ---------- A sala do bot ----------

function estadoDaSala(sala) {
  return salas.get(sala) || null;
}

function criarEstado(sala) {
  const estado = {
    sala,
    room: null,
    fonte: null,
    publicacao: null,
    conectando: null,
    fila: [],
    tocando: null,
    pausado: false,
    // O que esta sala escolheu da última vez, e não o padrão de fábrica.
    volume: volumePorSala.get(sala) ?? VOLUME_PADRAO,
    processos: null,
    // Cada reproducao ganha um numero. Um processo que morre depois de o comando "pular"
    // ja ter comecado a proxima faixa nao pode derrubar a faixa nova -- e sem esta marca
    // ele derrubaria, porque o evento de saida chega depois.
    geracao: 0,
    timerDeOciosidade: null,
    tocandoDesde: 0,
    // Quanto ja saiu de verdade para a sala. E o que permite mostrar o tempo decorrido
    // sem inventar: contar pelo relogio erraria em toda pausa e em todo engasgo de rede.
    msEnviados: 0
  };
  salas.set(sala, estado);
  return estado;
}

// O que a sala mostra de uma faixa -- e só isso. Espalhar a faixa inteira com `...` levava
// junto o endereço assinado do áudio: mais de um quilobyte por faixa, numa mensagem que
// sai a cada cinco segundos para todo mundo. Com uma fila de dez, era o chat da sala
// dividindo espaço com quinze quilobytes de URL que nenhuma tela usa.
function comoASalaVe(faixa) {
  return {
    id: faixa.id, titulo: faixa.titulo, autor: faixa.autor, duracao: faixa.duracao,
    capa: faixa.capa, origem: faixa.origem, endereco: faixa.endereco, pedidoPor: faixa.pedidoPor
  };
}

// Quanto a reprodução desta sala chegou perto de falhar. Lido pelo diagnóstico da sala.
function saudeDaSala(sala) {
  const estado = salas.get(sala);
  if (!estado) return null;
  return {
    segundosTocados: Math.round(estado.msEnviados / 1000),
    quaseSecou: estado.quaseSecou || 0,
    menorFilaMs: Math.round(estado.menorFila ?? 0),
    filaDoServidorMs: Math.round(estado.fonte?.queuedDuration ?? 0)
  };
}

function instantaneo(sala) {
  const estado = salas.get(sala);
  // Sem bot na sala, o que a tela mostra é o volume que a sala escolheu -- e não 85%.
  // Mostrar o padrão aqui fazia o controle mentir: dizia 85 enquanto o próximo pedido ia
  // tocar nos 40 que alguém tinha deixado.
  const volumeGuardado = Math.round((volumePorSala.get(sala) ?? VOLUME_PADRAO) * 100);
  if (!estado) return { conectado: false, tocando: null, fila: [], volume: volumeGuardado, pausado: false };
  return {
    conectado: Boolean(estado.room),
    pausado: estado.pausado,
    volume: Math.round(estado.volume * 100),
    tocando: estado.tocando && {
      ...comoASalaVe(estado.tocando),
      decorrido: Math.floor(estado.msEnviados / 1000)
    },
    fila: estado.fila.map(comoASalaVe)
  };
}

function avisarSala(sala) {
  try { anunciar(sala, instantaneo(sala)); } catch (_) { /* A sala reage como quiser. */ }
}

async function garantirNaSala(estado) {
  if (estado.room) return estado.room;
  if (estado.conectando) return estado.conectando;

  const tocandoAgora = [...salas.values()].filter(outra => outra.room).length;
  if (tocandoAgora >= MAXIMO_DE_SALAS_TOCANDO) {
    throw new Error(`já são ${MAXIMO_DE_SALAS_TOCANDO} salas com música ao mesmo tempo. Tente daqui a pouco.`);
  }

  estado.conectando = (async () => {
    const room = new Room();
    const token = criarTokenDoBot(estado.sala, identidadeDoBot(estado.sala), NOME_DO_BOT);
    // O bot NAO assina ninguem. Sem isto ele baixaria a camera e a voz da sala inteira
    // para jogar no lixo -- banda e processador gastos para nada, multiplicados por sala.
    await room.connect(enderecoDoServidorDeMidia(), token, { autoSubscribe: false, dynacast: true });

    const fonte = new AudioSource(TAXA, CANAIS, Math.round(SEGUNDOS_DE_FILA * 1000));
    const faixa = LocalAudioTrack.createAudioTrack('musica', fonte);
    const opcoes = new TrackPublishOptions({
      source: TrackSource.SOURCE_MICROPHONE,
      // DTX corta a transmissao no silencio e RED duplica pacotes: os dois existem para
      // voz e estragam musica -- o primeiro engole finais suaves, o segundo gasta banda
      // repetindo o que nao se perdeu. O audio de tela ja e publicado assim, pelo mesmo
      // motivo.
      dtx: false,
      red: false,
      audioEncoding: { maxBitrate: BigInt(128_000) }
    });
    estado.publicacao = await room.localParticipant.publishTrack(faixa, opcoes);
    estado.room = room;
    estado.fonte = fonte;
    estado.faixaLocal = faixa;
    return room;
  })();

  try {
    return await estado.conectando;
  } catch (erro) {
    estado.room = null;
    estado.fonte = null;
    throw erro;
  } finally {
    estado.conectando = null;
  }
}

// ---------- O caminho do som ----------
//
// yt-dlp baixa (e so ele sabe negociar com cada site) e escreve no cano; o ffmpeg
// decodifica o que vier e devolve PCM cru no formato que o servidor de midia quer. O Node
// so recorta esse PCM em quadros e entrega -- nao decodifica nada, e por isso uma sala a
// mais custa dois processos, nao mais laco de eventos.
// Duas formas de chegar ao audio, e a diferenca entre elas e o silencio entre uma faixa e
// a seguinte:
//
//   1. Pelo ENDERECO que a busca ja devolveu. O ffmpeg abre a conexao sozinho e o som
//      comeca em cerca de 0,3 s. E o caminho normal, porque a busca -- que e a parte cara,
//      uns tres segundos conversando com o site -- ja foi paga quando a faixa entrou na
//      fila. Nada fica aberto esperando: guarda-se o endereco, nao a conexao.
//   2. Pelo yt-dlp, em dois processos. Vale para o que a primeira forma nao alcanca: um
//      endereco que expirou, ou um site que entrega o audio em pedaços em vez de um
//      arquivo so.
//
// A primeira versao disto mantinha o cano da proxima faixa ABERTO durante a musica atual,
// para ganhar esses segundos. Funcionava, e custava caro: parado, o download nao anda, e
// depois de algumas dezenas de segundos o YouTube fechava a conexao do outro lado. A faixa
// seguinte entrava com o que tinha no cano e emudecia no meio, sem erro nenhum no log.
// Guardar o endereco em vez da conexao da o mesmo ganho sem nada para apodrecer.
function abrirPipeline(faixa, { forcarYtdlp = false } = {}) {
  const direto = !forcarYtdlp && faixa.midia?.url;
  const argumentosDoFfmpeg = ['-hide_banner', '-loglevel', 'error'];
  if (direto) {
    // A URL do YouTube e amarrada ao cliente que a pediu: sem estes cabecalhos ela
    // responde 403. Eles vem da mesma busca que devolveu o endereco.
    if (faixa.midia.cabecalhos) argumentosDoFfmpeg.push('-headers', faixa.midia.cabecalhos);
    // Uma queda curta de rede nao pode encerrar a musica.
    argumentosDoFfmpeg.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }
  argumentosDoFfmpeg.push(
    '-i', direto ? faixa.midia.url : 'pipe:0',
    // Sem isto, uma faixa masterizada alta entra gritando depois de uma gravacao caseira
    // baixa, e alguem sempre corre para o volume. A normalizacao custa um atraso curto no
    // comeco (o filtro olha adiante), que nao atrapalha porque ninguem esta conversando
    // com a musica.
    '-af', process.env.NEXO_FILTRO_DE_AUDIO || 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-f', 's16le', '-ar', String(TAXA), '-ac', String(CANAIS), '-'
  );

  const ffmpeg = spawn(caminhoDoFfmpeg(), argumentosDoFfmpeg,
    { windowsHide: true, stdio: [direto ? 'ignore' : 'pipe', 'pipe', 'pipe'] });

  const calar = () => {};
  ffmpeg.on('error', calar);
  let erroDoFfmpeg = '';
  ffmpeg.stderr.on('data', pedaco => { erroDoFfmpeg = (erroDoFfmpeg + pedaco).slice(-1500); });

  let ytdlp = null;
  let erroDoYtdlp = '';
  if (!direto) {
    ytdlp = spawn(caminhoDoYtdlp(), [...argumentosBase(), '-o', '-', faixa.endereco],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // O cano entre os dois processos nao passa pelo Node: os bytes vao de um para o outro
    // pelo sistema operacional.
    ytdlp.stdout.pipe(ffmpeg.stdin);
    // Um lado morrendo nao pode deixar o outro baixando para um cano fechado. EPIPE aqui e
    // o desfecho normal de um "pular", nao uma falha para registrar.
    ytdlp.stdout.on('error', calar);
    ffmpeg.stdin.on('error', calar);
    ytdlp.on('error', calar);
    ytdlp.stderr.on('data', pedaco => { erroDoYtdlp = (erroDoYtdlp + pedaco).slice(-3000); });
  }

  return { ffmpeg, ytdlp, direto: Boolean(direto), motivo: () => erroDoYtdlp || erroDoFfmpeg };
}

// Matar o processo NAO basta no Windows. O yt-dlp.exe e um empacotado que se desdobra em
// outro processo ao iniciar: encerrar o pai deixa o filho baixando sozinho, sem ninguem
// para consumir o que ele baixa. Depois de algumas trocas de faixa a maquina fica com uma
// coleccao de downloads fantasmas comendo banda -- que foi exatamente o que apareceu no
// teste, cinco processos vivos para uma sala tocando.
//
// "/T" encerra a arvore inteira a partir daquele identificador, e "/F" nao pede licenca.
function matarArvore(processo) {
  if (!processo || processo.exitCode !== null || processo.signalCode !== null) return;
  if (process.platform !== 'win32') {
    try { processo.kill('SIGKILL'); } catch (_) { /* Ja morreu. */ }
    return;
  }
  try {
    execFile('taskkill', ['/PID', String(processo.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } catch (_) {
    try { processo.kill(); } catch (__) { /* Ja morreu: e o que queriamos. */ }
  }
}

function encerrarPipeline(pipeline) {
  if (!pipeline) return;
  // O cano entre os dois e desfeito primeiro: sem isso, matar o yt-dlp faz o ffmpeg
  // receber um fim de arquivo e passar a reclamar de fluxo truncado no log.
  if (pipeline.ytdlp) {
    try { pipeline.ytdlp.stdout.unpipe(pipeline.ffmpeg.stdin); } catch (_) { /* Ja separados. */ }
    matarArvore(pipeline.ytdlp);
  }
  matarArvore(pipeline.ffmpeg);
}

// Aplica o volume enquanto copia os bytes para o quadro. Fazer isso aqui, e nao com um
// filtro do ffmpeg, e o que permite mudar o volume no meio da musica sem reabrir nada.
//
// Cada quadro sai num vetor NOVO, e isso e proposital. A entrega para o servidor de midia
// passa o ponteiro do vetor para o lado nativo e so confirma depois, por retorno
// assincrono: reaproveitar um vetor so significaria reescrever, no proximo quadro, bytes
// que o outro lado ainda pode nao ter lido -- um chiado intermitente, impossivel de
// reproduzir sob demanda. Sao 3,8 KB de vida curta a cada 20 ms, que o coletor descarta
// sem esforco; e assim que o proprio SDK faz nos exemplos dele.
function quadroComVolume(origem, ganho) {
  const destino = new Int16Array(AMOSTRAS_POR_QUADRO * CANAIS);
  for (let i = 0; i < destino.length; i++) {
    const amostra = origem.readInt16LE(i * 2) * ganho;
    // Sem o corte, um ganho acima de 1 estoura o inteiro de 16 bits e o que era musica
    // alta vira estalo.
    destino[i] = amostra > 32767 ? 32767 : amostra < -32768 ? -32768 : amostra;
  }
  return destino;
}

// ---------- Onde um engasgo nasce ----------
//
// A fila do servidor de midia e o colchao entre nos e quem ouve: enquanto houver audio
// nela, um tropeco deste processo -- uma coleta de lixo, outra sala pedindo musica ao
// mesmo tempo, o sistema tirando a vez do Node -- nao chega ao ouvido de ninguem. Quando
// ela seca, chega: e exatamente ali que aparece o "engasginho".
//
// Contar as vezes em que ela quase secou separa duas causas que soam iguais para quem
// ouve. Se este numero for zero e ainda assim houver engasgo, o problema esta na rede de
// quem escuta, e nao aqui -- e nao adianta mexer no servidor.
const MS_DE_FILA_QUE_PREOCUPAM = 120;

function vigiarAFila(estado) {
  const restando = estado.fonte?.queuedDuration;
  if (typeof restando !== 'number') return;
  const seca = restando < MS_DE_FILA_QUE_PREOCUPAM;
  // Conta a ENTRADA no estado ruim, não cada quadro dentro dele: um engasgo de meio
  // segundo são 25 quadros, e contá-los todos transformaria um tropeço em vinte e cinco.
  if (seca && !estado.filaSecando) estado.quaseSecou = (estado.quaseSecou || 0) + 1;
  estado.filaSecando = seca;
  if (restando < (estado.menorFila ?? Infinity)) estado.menorFila = restando;
}

async function reproduzir(estado, faixa, { forcarYtdlp = false } = {}) {
  const geracao = ++estado.geracao;
  const pipeline = abrirPipeline(faixa, { forcarYtdlp });
  estado.processos = pipeline;
  estado.msEnviados = 0;

  let sobra = Buffer.alloc(0);
  let recebeuAudio = false;
  let proximoAviso = 0;

  try {
    for await (const pedaco of pipeline.ffmpeg.stdout) {
      if (estado.geracao !== geracao) return;   // pularam esta faixa
      sobra = sobra.length ? Buffer.concat([sobra, pedaco]) : pedaco;

      let posicao = 0;
      while (sobra.length - posicao >= BYTES_POR_QUADRO) {
        // Uma pausa e simplesmente parar de consumir: o cano enche, o ffmpeg bloqueia, e o
        // yt-dlp para de baixar atras dele. Nada e jogado fora, e retomar continua de onde
        // parou -- sem precisar refazer a conexao com o site.
        while (estado.pausado && estado.geracao === geracao) {
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (estado.geracao !== geracao) return;

        const quadro = quadroComVolume(sobra.subarray(posicao, posicao + BYTES_POR_QUADRO), estado.volume);
        posicao += BYTES_POR_QUADRO;
        // Este "await" e o relogio da reproducao: ele so volta quando ha espaco na fila do
        // servidor de midia, ou seja, no ritmo em que a musica realmente toca. E o que
        // impede uma faixa inteira de ser despejada na memoria em dez segundos.
        await estado.fonte.captureFrame(new AudioFrame(quadro, TAXA, CANAIS, AMOSTRAS_POR_QUADRO));
        estado.msEnviados += MS_POR_QUADRO;
        vigiarAFila(estado);

        if (!recebeuAudio) {
          recebeuAudio = true;
          // O primeiro quadro e o instante em que a musica COMECA para quem ouve -- nao o
          // instante do pedido, que vem segundos antes. Avisar aqui e o que acerta o
          // cronometro na tela de todo mundo; sem isso ele nasce adiantado e assim fica.
          avisarSala(estado.sala);
        } else if (estado.msEnviados >= proximoAviso) {
          // Um aviso a cada poucos segundos para o cronometro nao derivar. E uma mensagem
          // minuscula, e sem ela o relogio de cada tela conta sozinho e se afasta do que
          // esta realmente saindo -- por um engasgo de rede, por uma pausa, ou so pelo
          // acumulo de erro.
          avisarSala(estado.sala);
        }
        if (estado.msEnviados >= proximoAviso) proximoAviso = estado.msEnviados + SEGUNDOS_ENTRE_AVISOS * 1000;
      }
      sobra = posicao ? sobra.subarray(posicao) : sobra;
    }
  } catch (erro) {
    if (estado.geracao === geracao) console.warn(`[música] ${estado.sala}: ${erro.message}`);
  }

  if (estado.geracao !== geracao) return;
  encerrarPipeline(pipeline);
  estado.processos = null;

  const tocouAte = Math.round(estado.msEnviados / 1000);
  // Uma faixa que acaba MUITO antes da duracao anunciada nao acabou: ela foi cortada. Com
  // o endereco direto isso e esperado de vez em quando -- ele tem prazo, e um endereco
  // guardado ha horas pode ter vencido enquanto a fila andava. O yt-dlp negocia tudo de
  // novo, e por isso a segunda tentativa costuma resolver.
  const ficouPelaMetade = recebeuAudio && faixa.duracao && tocouAte < faixa.duracao - 15;
  if (pipeline.direto && (!recebeuAudio || ficouPelaMetade)) {
    console.warn(`[música] ${estado.sala}: "${faixa.titulo}" parou em ${tocouAte}s de ${faixa.duracao}s; refazendo pelo yt-dlp`);
    // Sem apagar o endereco, uma falha em cadeia voltaria a tentar o mesmo caminho torto.
    faixa.midia = null;
    return reproduzir(estado, faixa, { forcarYtdlp: true });
  }
  if (!recebeuAudio) {
    const motivo = primeiraLinhaDeErro(pipeline.motivo());
    mensagemDoBot(estado.sala, `Não consegui tocar **${faixa.titulo}**: ${motivo}`);
  } else if (ficouPelaMetade) {
    console.warn(`[música] ${estado.sala}: "${faixa.titulo}" parou em ${tocouAte}s de ${faixa.duracao}s (${primeiraLinhaDeErro(pipeline.motivo())})`);
  }
  seguirParaProxima(estado);
}

function seguirParaProxima(estado) {
  estado.tocando = null;
  estado.pausado = false;
  const proxima = estado.fila.shift();
  if (!proxima) {
    avisarSala(estado.sala);
    agendarSaidaPorOciosidade(estado);
    return;
  }
  estado.tocando = proxima;
  // Zerado ANTES do aviso. O cronometro que a sala mostra vem daqui, e `reproduzir` so
  // zera depois: sem esta linha, a faixa nova nasce na tela com o tempo decorrido da
  // anterior e fica assim ate o primeiro quadro sair -- um salto para tras, visível.
  estado.msEnviados = 0;
  avisarSala(estado.sala);
  mensagemDoBot(estado.sala, `▶ Tocando **${proxima.titulo}**${proxima.autor ? ` · ${proxima.autor}` : ''}`);

  const geracao = estado.geracao;
  // Faixa vinda de uma lista chega sem o endereco do audio -- so com o da pagina. Resolver
  // agora custa uns tres segundos; e a espera acontece UMA vez por faixa, porque a
  // seguinte ja e resolvida em paralelo logo abaixo.
  garantirResolvida(proxima)
    .then(() => { if (estado.geracao === geracao) reproduzir(estado, proxima); })
    .catch(erro => {
      if (estado.geracao !== geracao) return;
      mensagemDoBot(estado.sala, `Não consegui tocar **${proxima.titulo}**: ${erro.message}`);
      seguirParaProxima(estado);
    });
  adiantarProxima(estado);
}

// Resolve o endereco da PROXIMA da fila enquanto a atual toca. Diferente do que a primeira
// versao fazia, isto nao abre conexao nenhuma: e uma consulta que termina e devolve um
// endereco. Nada fica aberto apodrecendo, e a troca de faixa nao paga os tres segundos.
function adiantarProxima(estado) {
  const proxima = estado.fila[0];
  if (!proxima?.porResolver) return;
  // Se falhar, a vez dela tenta de novo -- e ai o erro e anunciado para a sala.
  garantirResolvida(proxima).catch(() => {});
}

function agendarSaidaPorOciosidade(estado) {
  clearTimeout(estado.timerDeOciosidade);
  estado.timerDeOciosidade = setTimeout(() => {
    if (estado.tocando || estado.fila.length) return;
    desconectar(estado.sala, 'ocioso');
  }, SEGUNDOS_ATE_SAIR_OCIOSO * 1000);
  estado.timerDeOciosidade.unref?.();
}

// ---------- Comandos ----------

let mensagemDoBot = () => {};
function definirCanalDeMensagens(fn) { mensagemDoBot = fn; }

// `posicao` põe o pedido num lugar da fila: 1 é "tocar a seguir". Sem ela, vai para o fim.
async function pedir(sala, pedidoOriginal, quemPediu, { listaInteira = false, posicao = null } = {}) {
  const estado = salas.get(sala) || criarEstado(sala);
  const espacoNaFila = MAXIMO_NA_FILA - estado.fila.length;
  if (espacoNaFila <= 0) throw new Error(`a fila já tem ${MAXIMO_NA_FILA} faixas`);
  clearTimeout(estado.timerDeOciosidade);

  // O botão de compartilhar do celular entrega um link encurtado, e dele não dá para saber
  // nem a plataforma nem se o que vem é uma faixa ou um álbum inteiro. Abrir o atalho aqui,
  // uma vez, faz todo o resto do caminho enxergar o endereço de verdade.
  const pedido = await expandirAtalho(pedidoOriginal);

  const pediuLista = listaInteira || ehListaInteira(pedido);
  const autor = semMarcacao(quemPediu);
  const novas = pediuLista
    ? (await listarFaixasDaLista(pedido, Math.min(MAXIMO_DA_LISTA, espacoNaFila))).map(f => ({ ...f, pedidoPor: autor }))
    : [{ ...(await resolver(pedido)), pedidoPor: autor }];

  // Entrar na sala so depois de a busca dar certo: um nome digitado errado nao deve fazer
  // o bot aparecer na lista de todo mundo para sair em seguida.
  await garantirNaSala(estado);

  const tocavaAntes = Boolean(estado.tocando);
  // A busca cedeu a execução. Outra pessoa pode ter ocupado a fila enquanto isto
  // resolvia o link; a cota precisa continuar valendo depois do await.
  if (estado.fila.length + novas.length > MAXIMO_NA_FILA) throw new Error('A fila foi preenchida durante a busca. Tente novamente depois.');
  const entrouEm = inserirNaLista(estado.fila, novas, posicao);
  if (!tocavaAntes) seguirParaProxima(estado);
  else { avisarSala(sala); adiantarProxima(estado); }

  const aSeguir = posicao !== null && entrouEm === 1;
  if (pediuLista) {
    mensagemDoBot(sala, `＋ **${novas.length} ${novas.length === 1 ? 'faixa' : 'faixas'}** de _${novas[0].origem}_ na fila${tocavaAntes && aSeguir ? ', para tocar a seguir' : ''}.`);
  } else if (tocavaAntes) {
    mensagemDoBot(sala, aSeguir ? `＋ **${novas[0].titulo}** vai tocar a seguir` : `＋ **${novas[0].titulo}** entrou na fila (posição ${entrouEm})`);
    // O link trazia uma lista junto e a pessoa pode nao ter percebido. Dizer isso UMA vez,
    // com o comando pronto, e melhor do que enfileirar cinquenta faixas por conta propria.
    if (listaEmbutida(pedido)) mensagemDoBot(sala, 'Esse link faz parte de uma lista. Para enfileirar ela inteira: `!lista <link>`');
  } else if (listaEmbutida(pedido)) {
    mensagemDoBot(sala, 'Esse link faz parte de uma lista. Para enfileirar ela inteira: `!lista <link>`');
  }
  return novas[0];
}

function pular(sala) {
  const estado = salas.get(sala);
  if (!estado?.tocando) return null;
  const saindo = estado.tocando;
  estado.geracao++;          // invalida o laco da faixa atual
  estado.pausado = false;
  encerrarPipeline(estado.processos);
  estado.processos = null;
  // A fila do servidor de midia guarda meio segundo de audio ja entregue. Sem limpa-la, a
  // faixa pulada continuaria tocando por um instante em cima da proxima.
  estado.fonte?.clearQueue();
  seguirParaProxima(estado);
  return saindo;
}

// "Parar" e "sair" eram duas coisas: a primeira limpava a fila e deixava o bot plantado na
// sala por mais um minuto e meio, esperando um pedido que raramente vinha. Quem escreve
// `!parar` quer a música fora da sala -- e um participante mudo ocupando lugar na lista de
// todo mundo não é "parado", é um resto. Hoje os dois comandos fazem a mesma coisa, e é
// `desconectar` quem faz: limpa a fila, encerra o download, despublica a faixa e sai.

function pausar(sala, pausado) {
  const estado = salas.get(sala);
  if (!estado?.tocando) return false;
  estado.pausado = Boolean(pausado);
  if (estado.pausado) estado.fonte?.clearQueue();
  avisarSala(sala);
  return true;
}

function definirVolume(sala, porcento) {
  // O teto de 150% existe para salvar gravacao muito baixa; acima disso so se ganha
  // distorcao, porque o corte em preencherQuadro passa a agir o tempo todo.
  const limitado = Math.max(0, Math.min(150, Math.round(Number(porcento) || 0)));
  // Vale mesmo com o bot fora da sala: quem chega antes de pedir musica pode deixar o
  // volume pronto, e o proximo pedido ja entra nele. Recusar aqui obrigava a chamar o bot
  // alto para so entao abaixa-lo -- que e exatamente o susto que se queria evitar.
  volumePorSala.set(sala, limitado / 100);
  const estado = salas.get(sala);
  if (estado) {
    estado.volume = limitado / 100;
    avisarSala(sala);
  }
  return { porcento: limitado, naSala: Boolean(estado) };
}

function removerDaFila(sala, posicao) {
  const estado = salas.get(sala);
  const indice = Number(posicao) - 1;
  if (!estado || !Number.isInteger(indice) || indice < 0 || indice >= estado.fila.length) return null;
  const [removida] = estado.fila.splice(indice, 1);
  avisarSala(sala);
  adiantarProxima(estado);
  return removida;
}

// ---------- Reordenar ----------
//
// A tela aponta a faixa pelo `id`, e não pela posição: entre a pessoa ver a fila e o pedido
// chegar, outra pessoa pode ter tirado a de cima -- e "mover a 3" moveria outra música. Os
// comandos de texto (`!mover 5 1`) continuam por posição, porque é o que se lê no `!fila`.
//
// As duas funções puras abaixo são a regra inteira; as da sala só as aplicam e avisam.
const posicaoNaFila = (posicao, tamanho) => {
  const numero = Math.trunc(Number(posicao));
  return Number.isFinite(numero) ? Math.max(1, Math.min(tamanho, numero)) : tamanho;
};

function moverNaLista(lista, id, para) {
  const de = lista.findIndex(faixa => faixa.id === id);
  if (de < 0) return null;
  const destino = posicaoNaFila(para, lista.length) - 1;
  const [faixa] = lista.splice(de, 1);
  lista.splice(destino, 0, faixa);
  return { faixa, de: de + 1, para: destino + 1 };
}

// Sem posição, vai para o fim, como sempre foi. Com posição além do fim, também.
function inserirNaLista(lista, novas, posicao) {
  const indice = posicao === undefined || posicao === null ? lista.length : posicaoNaFila(posicao, lista.length + 1) - 1;
  lista.splice(indice, 0, ...novas);
  return indice + 1;
}

function moverNaFila(sala, id, para) {
  const estado = salas.get(sala);
  if (!estado) return null;
  const movida = moverNaLista(estado.fila, id, para);
  if (!movida) return null;
  avisarSala(sala);
  // A primeira da fila pode ter mudado: é ela que precisa estar resolvida quando a atual acabar.
  adiantarProxima(estado);
  return movida;
}

function removerDaFilaPorId(sala, id) {
  const estado = salas.get(sala);
  const indice = estado ? estado.fila.findIndex(faixa => faixa.id === id) : -1;
  return indice < 0 ? null : removerDaFila(sala, indice + 1);
}

// "Tocar agora" é "passar para o topo" e "pular" -- a mesma coisa que alguém faria com dois
// cliques, sem a janela em que a faixa já subiu e a atual ainda não saiu.
function tocarAgora(sala, id) {
  const estado = salas.get(sala);
  if (!estado?.tocando) return null;
  const movida = moverNaLista(estado.fila, id, 1);
  if (!movida) return null;
  pular(sala);
  return movida.faixa;
}

// Só para os testes de navegador: uma fila montada à mão, sem baixar nada nem entrar no
// servidor de mídia. É o que deixa testar a tela da fila numa máquina sem yt-dlp.
function filaDeTeste(sala, { tocando = null, fila = [] } = {}) {
  const estado = salas.get(sala) || criarEstado(sala);
  estado.tocando = tocando;
  estado.fila = fila;
  avisarSala(sala);
}

// Esvazia só a fila: a que está tocando continua. `!parar` é o que tira tudo e sai.
function esvaziarFila(sala) {
  const estado = salas.get(sala);
  if (!estado?.fila.length) return 0;
  const quantas = estado.fila.length;
  estado.fila = [];
  avisarSala(sala);
  if (!estado.tocando) agendarSaidaPorOciosidade(estado);
  return quantas;
}

function embaralhar(sala) {
  const estado = salas.get(sala);
  if (!estado || estado.fila.length < 2) return false;
  for (let i = estado.fila.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [estado.fila[i], estado.fila[j]] = [estado.fila[j], estado.fila[i]];
  }
  avisarSala(sala);
  adiantarProxima(estado);
  return true;
}

async function desconectar(sala, motivo) {
  const estado = salas.get(sala);
  if (!estado) return;
  clearTimeout(estado.timerDeOciosidade);
  estado.geracao++;
  estado.fila = [];
  estado.tocando = null;
  encerrarPipeline(estado.processos);
  estado.processos = null;
  salas.delete(sala);

  const { room, fonte, faixaLocal } = estado;
  estado.room = null;
  estado.fonte = null;
  // A ordem importa: a faixa sai de cena, depois a fonte, depois a conexao. Fechar a
  // conexao primeiro deixaria as duas primeiras apontando para uma sessao que nao existe.
  try { if (room && faixaLocal) await room.localParticipant.unpublishTrack(faixaLocal.sid, true); } catch (_) { /* A sessao ja pode ter caido. */ }
  try { await fonte?.close(); } catch (_) { /* idem */ }
  try { await room?.disconnect(); } catch (_) { /* idem */ }
  if (motivo !== 'silencioso') avisarSala(sala);
}

// Todos os bots de uma vez, para o Ctrl+C nao deixar processos orfaos segurando download.
async function encerrarTudo() {
  await Promise.all([...salas.keys()].map(sala => desconectar(sala, 'silencioso')));
}

// A sala acabou (saiu a última pessoa). Aqui o bot esquece até o que sobrevive a ele sair
// da chamada. Chamado por server.js no mesmo lugar em que a mesa de sons é esvaziada e o
// histórico do chat é apagado -- nada de uma sala fechada sobrevive.
async function esquecerSala(sala) {
  volumePorSala.delete(sala);
  await desconectar(sala, 'sala-vazia');
}

function disponivel() {
  return fs.existsSync(caminhoDoYtdlp()) && fs.existsSync(caminhoDoFfmpeg());
}

// Se o Node for encerrado a forca (o Gerenciador de Tarefas, a maquina desligando no
// tranco), os downloads em curso costumam morrer junto -- o cano se fecha e eles desistem.
// "Costumam" nao e "sempre", e um yt-dlp esquecido continua baixando sozinho, de graca,
// ate alguem reparar. Uma varredura na subida resolve, como a que o servidor de midia ja
// faz com o proprio binario.
//
// So o NOSSO yt-dlp e encerrado, conferido pelo caminho completo: o ffmpeg fica de fora de
// proposito, porque ele pode ser o do sistema e estar servindo a outra coisa da pessoa --
// e, sem quem o alimente, ele sai sozinho no fim do arquivo.
function encerrarOrfaos() {
  const binario = caminhoDoYtdlp();
  if (!fs.existsSync(binario)) return;
  try {
    if (process.platform === 'win32') {
      const escapado = binario.replace(/'/g, "''");
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Process yt-dlp -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${escapado}' } | Stop-Process -Force`
      ], { windowsHide: true, timeout: 8000 }, () => {});
    } else {
      execFile('pkill', ['-f', binario], { timeout: 8000 }, () => {});
    }
  } catch (_) { /* Nenhum orfao, ou nada que possamos encerrar: seguir. */ }
}

module.exports = {
  configurar, definirCanalDeMensagens, disponivel, semMarcacao, encerrarOrfaos,
  ehListaInteira, listaEmbutida, buscarListas, listarFaixasDaLista,
  ondeMora, atravessarPonte, expandirAtalho,
  pedir, pular, pausar, definirVolume, removerDaFila, embaralhar,
  moverNaFila, removerDaFilaPorId, tocarAgora, esvaziarFila, moverNaLista, inserirNaLista, filaDeTeste,
  desconectar, esquecerSala, encerrarTudo, instantaneo, estadoDaSala, saudeDaSala,
  PREFIXO_DA_IDENTIDADE, NOME_DO_BOT, MAXIMO_NA_FILA
};
