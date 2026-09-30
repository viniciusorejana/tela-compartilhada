// O Estúdio: levar a câmera, a tela e a voz de quem está na sala para o OBS, por um link.
//
// Este arquivo é a regra, sem servidor nem banco: o formato do link, a chave que reconhece uma
// pessoa entre salas e a configuração dos rostos que reagem à voz. Quem põe isso no ar é
// estudio-ao-vivo.js; o porquê de cada decisão está em docs/estudio.md.
//
// ---------- O link é de quem o criou ----------
//
// Um link não aponta para uma sala: aponta para uma PESSOA (quem aparece) e é ancorado em quem o
// criou (o "diretor", sempre alguém com conta). Ele funciona na sala em que o diretor estiver
// agora. É o que deixa montar a cena do OBS uma vez só -- "a câmera da Ana" -- e reaproveitá-la
// em toda chamada com a Ana, em qualquer sala, sem gerar link de novo.
//
// E é o que dá dono à captura: ela só existe enquanto o diretor está na sala, a sala inteira vê
// quem está levando o quê para o OBS, e um diretor removido da sala leva as capturas dele junto.
//
// O link é assinado (HMAC) e não guarda estado nenhum no servidor. Revogar é trocar a geração
// guardada na conta: todo link da geração anterior deixa de valer de uma vez.
const crypto = require('node:crypto');

// O que um link de fonte mostra. `video` e `audio` são as fontes do servidor de mídia.
const FONTES = Object.freeze({
  camera: { video: 'camera', audio: 'microphone', rotulo: 'Câmera' },
  tela: { video: 'screen_share', audio: 'screen_share_audio', rotulo: 'Tela' },
  voz: { video: null, audio: 'microphone', rotulo: 'Voz' },
  somDaTela: { video: null, audio: 'screen_share_audio', rotulo: 'Som da tela' }
});

const TIPOS = Object.freeze({ fonte: 'f', reativo: 'r' });
const TAMANHO_MAXIMO_DO_LINK = 600;
const BYTES_DA_ASSINATURA = 16;
const CODIGO = /^[A-HJ-KM-NP-Z2-9]{8}$/;
const ID_DE_IMAGEM = /^[a-f0-9]{32}$/;

// ---------- Quem é quem ----------
//
// Quem tem conta é reconhecido pelo código, que não muda com o apelido e vale em qualquer sala.
// Quem não tem conta só tem o nome -- é o "endereçar" de quem usa o Estúdio: a imagem dada à
// "Ana" vale para qualquer convidada que entrar como Ana. As duas chaves nunca se confundem: uma
// convidada chamada Ana não herda nada da Ana que tem conta, como no banimento (moderacao.js).
function normalizarNome(nome) {
  return String(nome || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
}

function normalizarCodigo(codigo) {
  return String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function chaveDaPessoa({ codigo = null, nome = '' } = {}) {
  const limpo = normalizarCodigo(codigo);
  if (CODIGO.test(limpo)) return `c:${limpo}`;
  const nomeLimpo = normalizarNome(nome);
  return nomeLimpo ? `n:${nomeLimpo}` : null;
}

function chaveValida(chave) {
  if (typeof chave !== 'string') return null;
  if (chave.startsWith('c:')) return CODIGO.test(chave.slice(2)) ? chave : null;
  if (chave.startsWith('n:')) { const nome = normalizarNome(chave.slice(2)); return nome && `n:${nome}` === chave ? chave : null; }
  return null;
}

// ---------- O link ----------
//
// `corpo.assinatura`, os dois em base64url. O corpo é JSON curto, com as chaves de uma letra:
//   t tipo (f fonte, r rostos que reagem)   d código da conta de quem criou   g geração
//   a chave de quem aparece (null no link do grupo)   f a fonte   n o nome de quem aparece, para a
//   página dizer "aguardando a Ana" antes de ela chegar
function criarAssinador(segredo) {
  if (!segredo || segredo.length < 16) throw new Error('Segredo do Estúdio curto demais.');
  const assinar = texto => crypto.createHmac('sha256', segredo).update(`nexo-estudio|${texto}`).digest().subarray(0, BYTES_DA_ASSINATURA);

  function criar({ tipo, diretor, geracao = 0, alvo = null, fonte = null, nome = '' }) {
    const t = TIPOS[tipo];
    const d = normalizarCodigo(diretor);
    if (!t || !CODIGO.test(d)) throw new Error('Link sem tipo ou sem diretor.');
    if (!Number.isInteger(geracao) || geracao < 0) throw new Error('Geração inválida.');
    const a = alvo === null ? null : chaveValida(alvo);
    if (alvo !== null && !a) throw new Error('Pessoa inválida.');
    if (t === 'f' && (!a || !Object.prototype.hasOwnProperty.call(FONTES, fonte))) throw new Error('Link de fonte sem pessoa ou sem fonte.');
    const corpo = { v: 1, t, d, g: geracao, a };
    if (t === 'f') corpo.f = fonte;
    const n = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (n) corpo.n = n;
    const texto = Buffer.from(JSON.stringify(corpo)).toString('base64url');
    return `${texto}.${assinar(texto).toString('base64url')}`;
  }

  // Devolve o link lido, ou `null` para qualquer coisa fora do formato. A assinatura vem antes
  // do JSON: nada que alguém escreveu à mão chega a ser interpretado.
  function ler(link) {
    if (typeof link !== 'string' || link.length > TAMANHO_MAXIMO_DO_LINK) return null;
    const [texto, assinatura, sobra] = link.split('.');
    if (!texto || !assinatura || sobra !== undefined || !/^[A-Za-z0-9_-]+$/.test(texto + assinatura)) return null;
    const esperada = assinar(texto);
    const recebida = Buffer.from(assinatura, 'base64url');
    if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;
    let corpo;
    try { corpo = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8')); } catch (_) { return null; }
    if (!corpo || corpo.v !== 1 || !['f', 'r'].includes(corpo.t) || !CODIGO.test(corpo.d) || !Number.isInteger(corpo.g) || corpo.g < 0) return null;
    const alvo = corpo.a === null ? null : chaveValida(corpo.a);
    if (corpo.a !== null && !alvo) return null;
    if (corpo.t === 'f' && (!alvo || !Object.prototype.hasOwnProperty.call(FONTES, corpo.f))) return null;
    return {
      tipo: corpo.t === 'f' ? 'fonte' : 'reativo', diretor: corpo.d, geracao: corpo.g, alvo,
      fonte: corpo.t === 'f' ? corpo.f : null, nome: typeof corpo.n === 'string' ? corpo.n.slice(0, 40) : ''
    };
  }

  return { criar, ler };
}

// ---------- Os rostos que reagem à voz ----------
//
// A configuração é de quem usa o Estúdio, e só dele: a imagem que ele dá à Ana aparece no OBS
// dele, e em mais lugar nenhum. A forma é FECHADA, como os ajustes do perfil (public/perfil.js):
// o que não está aqui some, venha de onde vier.
const PESSOAS_MAXIMAS_NA_CONFIGURACAO = 64;
const BYTES_MAXIMOS_DA_CONFIGURACAO = 16 * 1024;

// `tamanhoDoNome` é uma escala, em %, sobre o nome que acompanha o tamanho do rosto: dobrar o
// rosto já dobra o nome, e a escala é o ajuste fino por cima disso.
const ESTILO_PADRAO = Object.freeze({
  efeito: 'pulo', formato: 'circulo', tamanho: 160, espaco: 24, direcao: 'linha', alinhar: 'centro',
  nomes: true, tamanhoDoNome: 100, apagar: 45, soQuemFala: false, mostrarMudos: true, sensibilidade: 35, anel: true
});

const um = (lista, padrao) => valor => (lista.includes(valor) ? valor : padrao);
const inteiroEntre = (minimo, maximo, padrao) => valor => (Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : padrao);
const booleano = padrao => valor => (typeof valor === 'boolean' ? valor : padrao);

const FORMA_DO_ESTILO = {
  efeito: um(['pulo', 'pulso', 'nenhum'], ESTILO_PADRAO.efeito),
  formato: um(['circulo', 'arredondado', 'livre'], ESTILO_PADRAO.formato),
  tamanho: inteiroEntre(48, 512, ESTILO_PADRAO.tamanho),
  espaco: inteiroEntre(0, 160, ESTILO_PADRAO.espaco),
  direcao: um(['linha', 'coluna'], ESTILO_PADRAO.direcao),
  alinhar: um(['inicio', 'centro', 'fim'], ESTILO_PADRAO.alinhar),
  nomes: booleano(ESTILO_PADRAO.nomes),
  tamanhoDoNome: inteiroEntre(50, 300, ESTILO_PADRAO.tamanhoDoNome),
  apagar: inteiroEntre(0, 100, ESTILO_PADRAO.apagar),
  soQuemFala: booleano(ESTILO_PADRAO.soQuemFala),
  mostrarMudos: booleano(ESTILO_PADRAO.mostrarMudos),
  sensibilidade: inteiroEntre(1, 100, ESTILO_PADRAO.sensibilidade),
  anel: booleano(ESTILO_PADRAO.anel)
};

const imagemValida = valor => (typeof valor === 'string' && ID_DE_IMAGEM.test(valor) ? valor : null);

function limparConfig(bruto) {
  const origem = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const estiloBruto = origem.estilo && typeof origem.estilo === 'object' ? origem.estilo : {};
  const estilo = {};
  for (const [nome, validar] of Object.entries(FORMA_DO_ESTILO)) estilo[nome] = validar(estiloBruto[nome]);
  const pessoas = {};
  const brutas = origem.pessoas && typeof origem.pessoas === 'object' && !Array.isArray(origem.pessoas) ? origem.pessoas : {};
  for (const [chaveBruta, dados] of Object.entries(brutas)) {
    if (Object.keys(pessoas).length >= PESSOAS_MAXIMAS_NA_CONFIGURACAO) break;
    const chave = chaveValida(chaveBruta);
    if (!chave || !dados || typeof dados !== 'object') continue;
    const pessoa = {
      rotulo: String(dados.rotulo || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      parado: imagemValida(dados.parado), falando: imagemValida(dados.falando),
      oculto: dados.oculto === true
    };
    // Uma pessoa sem imagem, sem ocultar e sem rótulo não diz nada: não ocupa lugar.
    if (pessoa.parado || pessoa.falando || pessoa.oculto || pessoa.rotulo) pessoas[chave] = pessoa;
  }
  return { estilo, pessoas };
}

// As imagens que a configuração usa: é por esta lista que as enviadas e abandonadas são apagadas.
function imagensDaConfig(config) {
  const ids = new Set();
  for (const pessoa of Object.values(config?.pessoas || {})) {
    if (pessoa.parado) ids.add(pessoa.parado);
    if (pessoa.falando) ids.add(pessoa.falando);
  }
  return ids;
}

module.exports = {
  FONTES, TIPOS, ESTILO_PADRAO, PESSOAS_MAXIMAS_NA_CONFIGURACAO, BYTES_MAXIMOS_DA_CONFIGURACAO, ID_DE_IMAGEM,
  normalizarNome, normalizarCodigo, chaveDaPessoa, chaveValida, criarAssinador, limparConfig, imagensDaConfig
};
