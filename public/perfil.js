// O perfil que segue a pessoa: aparência e ajustes. Um arquivo só para o servidor e para a
// página, como quality-utils.js -- a lista do que sincroniza é uma decisão, e duas cópias dela
// acabariam discordando.
//
// ---------- O que sincroniza, e o que NÃO sincroniza ----------
//
// Sincroniza o que é da PESSOA e dá trabalho refazer: qualidade, codec, prioridade, quadros,
// lado da câmera, push-to-talk, redução de ruído.
//
// Fica de fora, de propósito (docs/plano-contas.md, seção 5):
//   - id de microfone, câmera e saída: é identificador de HARDWARE. O da webcam do desktop não
//     existe no celular, e a sala tentaria abrir um aparelho inexistente;
//   - volume por pessoa: preferencias.js promete que essa escolha nunca sai do navegador.
//     Subi-la seria guardar em disco, ligada à conta, a lista de quem você silenciou;
//   - salas recentes: de onde você entrou e quando, o dado mais sensível da lista;
//   - pareamento com o agente, economia de dados, diagnóstico: são da máquina.
//
// A lista é FECHADA: o servidor descarta qualquer chave que não esteja aqui, então nem um
// cliente modificado consegue guardar o que ficou de fora.
(function (root) {
  const um = lista => valor => (lista.includes(valor) ? valor : undefined);
  const booleano = valor => (typeof valor === 'boolean' ? valor : undefined);
  const inteiroEntre = (minimo, maximo) => valor => (Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : undefined);
  // Um grupo de ajustes que viaja junto. Cada campo tem o seu validador, e o que não passa some
  // -- inclusive campos que ninguém declarou: a forma é tão fechada quanto a lista de cima.
  const grupo = forma => valor => {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined;
    const limpo = {};
    for (const [nome, validar] of Object.entries(forma)) {
      if (!Object.prototype.hasOwnProperty.call(valor, nome)) continue;
      const campo = validar(valor[nome]);
      if (campo !== undefined) limpo[nome] = campo;
    }
    return Object.keys(limpo).length ? limpo : undefined;
  };

  // Os temas prontos e as cores de destaque moram em tema.js; a lista daqui é a mesma, para o
  // servidor recusar um tema que a página não conhece.
  const NexoTema = typeof module !== 'undefined' && module.exports ? require('./tema.js') : root.NexoTema;
  const corHex = valor => (typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : undefined);

  const AJUSTES_SINCRONIZADOS = Object.freeze({
    qualidade: um(['economical', 'high', 'ultra']),
    codec: um(['auto', 'h264', 'vp8', 'vp9', 'av1']),
    prioridade: um(['fluidez', 'nitidez']),
    quadros: um([30, 60]),
    ladoCamera: um(['user', 'environment']),
    pushToTalk: booleano,
    reducaoDeRuido: booleano,
    // Os avisos sonoros e o jeito de ler a sala são da pessoa, como a qualidade: quem baixou
    // o volume dos avisos no computador não quer ouvi-los no máximo no celular.
    sons: grupo({ ligados: booleano, volume: inteiroEntre(0, 100), entrada: booleano, saida: booleano, tela: booleano, assistir: booleano, mensagem: booleano, mensagemSoFora: booleano, mencao: booleano, voce: booleano, pedido: booleano, conexao: booleano }),
    // Tema e cores também: quem escolheu o claro no computador quer o claro no celular. As
    // cores exatas sobem mesmo sem premium -- é o plano que decide se elas VALEM (tema.js), e
    // guardá-las é o que as faz voltar quando ele volta.
    aparencia: grupo({
      densidade: um(['confortavel', 'compacta']), texto: um(['normal', 'grande', 'maior']), tempos: booleano, reacoes: booleano, menosMovimento: booleano,
      tema: um((NexoTema?.TEMAS || []).map(t => t.id)), modo: um(['escuro', 'claro', 'sistema']),
      destaque: um(Object.keys(NexoTema?.DESTAQUES || {})), cores: grupo({ destaque: corHex, fundo: corHex })
    }),
    // A edição mais nova das novidades que a pessoa já fechou (public/novidades.js). Segue a
    // conta para a apresentação não voltar em cada aparelho novo: quem leu no computador não
    // precisa ler de novo no celular.
    novidades: inteiroEntre(0, 1000000)
  });

  // Teto do JSON guardado. Com a lista fechada ele nunca chega perto disto; o teto existe para
  // o dia em que alguém acrescentar um ajuste de texto livre sem pensar no tamanho.
  const BYTES_MAXIMOS_DOS_AJUSTES = 2048;

  // Só o que está na lista, e só com valor válido. O resto some calado: um ajuste inválido
  // é um ajuste que ninguém escolheu.
  function limparAjustes(bruto) {
    const limpos = {};
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return limpos;
    for (const [nome, validar] of Object.entries(AJUSTES_SINCRONIZADOS)) {
      if (!Object.prototype.hasOwnProperty.call(bruto, nome)) continue;
      const valor = validar(bruto[nome]);
      if (valor !== undefined) limpos[nome] = valor;
    }
    return limpos;
  }

  // ---------- Aparência ----------
  //
  // Cor e uma marca de um conjunto pronto. Avatar enviado por arquivo fica para depois: aceitar
  // imagem é armazenamento, rota de entrega e -- o item caro -- moderação de imagem.
  const CORES = Object.freeze({
    lilas: '#a996f2', menta: '#7fd1ae', ambar: '#e6b86a', coral: '#ee8f7e', ceu: '#7fb5ee',
    rosa: '#e994c4', limao: '#bcd66a', areia: '#cdb79a', turquesa: '#63c7c9', ameixa: '#b07ad6'
  });
  const MARCAS = Object.freeze({
    brilho: '✦', losango: '◆', estrela: '★', lua: '☾', raio: 'ϟ', flor: '✿',
    cavalo: '♞', nota: '♪', coracao: '♥', sol: '☀', trevo: '♣', circulo: '●'
  });
  // Os nomes que o leitor de tela diz e o `title` mostra. Aqui, e não em cada tela que desenha
  // as opções: a página da conta e o editor dentro da sala mostram a mesma lista.
  const NOMES_DAS_CORES = Object.freeze({ lilas: 'Lilás', menta: 'Menta', ambar: 'Âmbar', coral: 'Coral', ceu: 'Céu', rosa: 'Rosa', limao: 'Limão', areia: 'Areia', turquesa: 'Turquesa', ameixa: 'Ameixa' });
  const NOMES_DAS_MARCAS = Object.freeze({ brilho: 'Brilho', losango: 'Losango', estrela: 'Estrela', lua: 'Lua', raio: 'Raio', flor: 'Flor', cavalo: 'Cavalo', nota: 'Nota', coracao: 'Coração', sol: 'Sol', trevo: 'Trevo', circulo: 'Círculo' });
  const corValida = nome => (Object.prototype.hasOwnProperty.call(CORES, nome) ? nome : null);
  const marcaValida = nome => (Object.prototype.hasOwnProperty.call(MARCAS, nome) ? nome : null);

  // Como a pessoa aparece: a cor escolhida ou a sorteada pelo nome, e a marca ou as iniciais.
  // A cor sorteada é a mesma de sempre (sala.js a usava sozinha), para ninguém mudar de cor só
  // porque este arquivo existe.
  function corDoNome(nome) {
    const texto = String(nome || '');
    let hash = 0;
    for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 55%, 62%)`;
  }
  // Por ponto de código: `palavra[0]` de um emoji é meia letra, e aparece como "�".
  function iniciais(nome) {
    return String(nome || '').trim().split(/\s+/).slice(0, 2).map(p => [...p][0]?.toUpperCase() || '').join('') || '?';
  }
  function aparencia(nome, perfil) {
    return {
      cor: (perfil && CORES[perfil.cor]) || corDoNome(nome),
      texto: (perfil && MARCAS[perfil.marca]) || iniciais(nome),
      marca: Boolean(perfil && MARCAS[perfil.marca])
    };
  }

  // As opções de cor e marca como rádios de verdade: dá para escolher pelo teclado, e o leitor
  // de tela diz o nome. Só no navegador; a primeira de cada grupo é "o padrão" (valor vazio).
  function montarEscolhas(cores, marcas, grupo = '') {
    const opcao = (nomeDoGrupo, valor, rotulo, desenhar) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = `${grupo}${nomeDoGrupo}`; radio.value = valor;
      radio.setAttribute('aria-label', rotulo);
      const amostra = document.createElement('span');
      amostra.className = 'escolha';
      amostra.title = rotulo;
      desenhar(amostra);
      label.append(radio, amostra);
      return label;
    };
    cores.append(opcao('cor', '', 'A cor do meu nome', el => { el.classList.add('texto'); el.textContent = 'Do nome'; }));
    for (const [nome, cor] of Object.entries(CORES)) cores.append(opcao('cor', nome, NOMES_DAS_CORES[nome] || nome, el => { el.style.background = cor; }));
    marcas.append(opcao('marca', '', 'As iniciais do apelido', el => { el.classList.add('texto'); el.textContent = 'Iniciais'; }));
    for (const [nome, simbolo] of Object.entries(MARCAS)) marcas.append(opcao('marca', nome, NOMES_DAS_MARCAS[nome] || nome, el => { el.classList.add('simbolo'); el.textContent = simbolo; }));
  }

  const api = { AJUSTES_SINCRONIZADOS, BYTES_MAXIMOS_DOS_AJUSTES, limparAjustes, CORES, MARCAS, NOMES_DAS_CORES, NOMES_DAS_MARCAS, corValida, marcaValida, corDoNome, iniciais, aparencia, montarEscolhas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoPerfil = api;
})(typeof window === 'undefined' ? globalThis : window);
