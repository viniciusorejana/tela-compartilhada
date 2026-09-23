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

  const AJUSTES_SINCRONIZADOS = Object.freeze({
    qualidade: um(['economical', 'high', 'ultra']),
    codec: um(['auto', 'h264', 'vp8', 'vp9', 'av1']),
    prioridade: um(['fluidez', 'nitidez']),
    quadros: um([30, 60]),
    ladoCamera: um(['user', 'environment']),
    pushToTalk: booleano,
    reducaoDeRuido: booleano
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

  const api = { AJUSTES_SINCRONIZADOS, BYTES_MAXIMOS_DOS_AJUSTES, limparAjustes, CORES, MARCAS, corValida, marcaValida, corDoNome, iniciais, aparencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoPerfil = api;
})(typeof window === 'undefined' ? globalThis : window);
