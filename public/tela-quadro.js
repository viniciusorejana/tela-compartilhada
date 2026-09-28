/* O envelope de cada quadro da tela por WebCodecs, e as mensagens de controle que andam ao
 * lado dele.
 *
 * A faixa de dados do LiveKit resolve fragmentar, remontar, carimbar a hora e descartar o que
 * chegou incompleto. O que ela não tem como saber é o que o DECODIFICADOR precisa, e é só
 * isso que mora aqui:
 *
 *  - se o quadro é chave, porque só dali o receptor consegue começar;
 *  - a configuração do decodificador, em TODO quadro-chave e não só no primeiro. Quem entra
 *    no meio da transmissão é o caso normal de uma sala, e sem ela nunca decodificaria;
 *  - a resolução, que muda quando a adaptação encolhe a imagem;
 *  - a camada, porque há duas faixas (a cheia e a de 360p) e o receptor troca entre elas;
 *  - a sequência e a geração, que é como o receptor percebe um buraco sem esperar o
 *    decodificador reclamar -- e percebe que o codificador recomeçou, que não é buraco.
 *
 * A hora da captura NÃO entra: ela vai no `userTimestamp` da faixa de dados, que existe
 * exatamente para isso.
 *
 * Tudo aqui é puro, e funciona no Node, para os testes não dependerem de navegador.
 */
(function (root) {
  const MAGICO = 0x4e;         // 'N'
  const VERSAO = 1;
  const TAMANHO_DO_CABECALHO = 16;
  const FLAG_CHAVE = 1;

  // A ordem importa: é o número que viaja no byte da camada.
  const CAMADAS = ['alta', 'baixa'];

  // Tópico das mensagens de controle no canal confiável do LiveKit.
  const TOPICO = 'nexo-tela';
  // Nome das faixas de dados. O prefixo separa as nossas de qualquer outra que um dia exista
  // na sala; o sufixo é a camada.
  const PREFIXO_DA_FAIXA = 'nexo-tela:';
  const nomeDaFaixa = camada => PREFIXO_DA_FAIXA + camada;
  function camadaDaFaixa(nome) {
    if (typeof nome !== 'string' || !nome.startsWith(PREFIXO_DA_FAIXA)) return null;
    const camada = nome.slice(PREFIXO_DA_FAIXA.length);
    return CAMADAS.includes(camada) ? camada : null;
  }

  const codificadorDeTexto = new TextEncoder();
  const decodificadorDeTexto = new TextDecoder();

  function paraBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let texto = '';
    for (let i = 0; i < bytes.length; i++) texto += String.fromCharCode(bytes[i]);
    return btoa(texto);
  }

  function deBase64(texto) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(texto, 'base64'));
    const bruto = atob(texto);
    const bytes = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
    return bytes;
  }

  // Só o que o `VideoDecoder.configure` aceita e o receptor precisa. O `description` vem como
  // buffer do codificador e viaja em base64 dentro do JSON: é raro (H.264 em Annex B não o
  // tem, VP8 também não) e pequeno quando existe, então a economia de um formato binário não
  // pagaria o código a mais.
  function configParaEnvio(config) {
    if (!config?.codec) return null;
    const limpa = { codec: String(config.codec) };
    if (config.codedWidth) limpa.codedWidth = config.codedWidth;
    if (config.codedHeight) limpa.codedHeight = config.codedHeight;
    if (config.description) {
      const bytes = config.description instanceof Uint8Array ? config.description
        : ArrayBuffer.isView(config.description)
          ? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength)
          : new Uint8Array(config.description);
      limpa.description = paraBase64(bytes);
    }
    if (config.colorSpace) {
      const { primaries, transfer, matrix, fullRange } = config.colorSpace;
      limpa.colorSpace = { primaries, transfer, matrix, fullRange };
    }
    return limpa;
  }

  function configRecebida(config) {
    if (!config || typeof config.codec !== 'string' || config.codec.length > 64) return null;
    const limpa = { codec: config.codec };
    if (Number.isInteger(config.codedWidth) && config.codedWidth > 0 && config.codedWidth <= 8192) limpa.codedWidth = config.codedWidth;
    if (Number.isInteger(config.codedHeight) && config.codedHeight > 0 && config.codedHeight <= 8192) limpa.codedHeight = config.codedHeight;
    if (typeof config.description === 'string' && config.description.length <= 4096) {
      try { limpa.description = deBase64(config.description); } catch (_) { return null; }
    }
    if (config.colorSpace && typeof config.colorSpace === 'object') {
      const cs = {};
      for (const chave of ['primaries', 'transfer', 'matrix']) {
        if (typeof config.colorSpace[chave] === 'string' && config.colorSpace[chave].length < 32) cs[chave] = config.colorSpace[chave];
      }
      if (typeof config.colorSpace.fullRange === 'boolean') cs.fullRange = config.colorSpace.fullRange;
      limpa.colorSpace = cs;
    }
    return limpa;
  }

  // Cabeçalho fixo de 16 bytes, little-endian:
  //   0 mágico · 1 versão · 2 flags · 3 camada
  //   4-5 largura · 6-7 altura
  //   8-11 sequência (por camada, recomeça em cada geração)
  //   12-13 geração (sobe quando o codificador daquela camada recomeça)
  //   14-15 tamanho da configuração em JSON (0 = sem)
  // Depois vêm a configuração e os bytes codificados.
  function montar({ chave, camada, largura, altura, sequencia, geracao, config, dados }) {
    const indiceDaCamada = CAMADAS.indexOf(camada);
    if (indiceDaCamada < 0) throw new Error(`camada desconhecida: ${camada}`);
    const configEmTexto = chave && config ? JSON.stringify(configParaEnvio(config)) : '';
    const configEmBytes = configEmTexto ? codificadorDeTexto.encode(configEmTexto) : new Uint8Array(0);
    if (configEmBytes.length > 0xffff) throw new Error('configuração grande demais');
    const corpo = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    const saida = new Uint8Array(TAMANHO_DO_CABECALHO + configEmBytes.length + corpo.length);
    const visao = new DataView(saida.buffer);
    visao.setUint8(0, MAGICO);
    visao.setUint8(1, VERSAO);
    visao.setUint8(2, chave ? FLAG_CHAVE : 0);
    visao.setUint8(3, indiceDaCamada);
    visao.setUint16(4, Math.min(0xffff, largura >>> 0), true);
    visao.setUint16(6, Math.min(0xffff, altura >>> 0), true);
    visao.setUint32(8, sequencia >>> 0, true);
    visao.setUint16(12, geracao & 0xffff, true);
    visao.setUint16(14, configEmBytes.length, true);
    saida.set(configEmBytes, TAMANHO_DO_CABECALHO);
    saida.set(corpo, TAMANHO_DO_CABECALHO + configEmBytes.length);
    return saida;
  }

  // Devolve `null` para qualquer coisa que não seja um envelope nosso, íntegro: isto é dado
  // vindo da rede, de outra pessoa, e um quadro malformado não pode derrubar o receptor.
  function ler(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < TAMANHO_DO_CABECALHO) return null;
    const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (visao.getUint8(0) !== MAGICO || visao.getUint8(1) !== VERSAO) return null;
    const camada = CAMADAS[visao.getUint8(3)];
    if (!camada) return null;
    const tamanhoDaConfig = visao.getUint16(14, true);
    if (TAMANHO_DO_CABECALHO + tamanhoDaConfig > bytes.length) return null;
    const chave = Boolean(visao.getUint8(2) & FLAG_CHAVE);
    let config = null;
    if (tamanhoDaConfig) {
      try {
        config = configRecebida(JSON.parse(decodificadorDeTexto.decode(bytes.subarray(TAMANHO_DO_CABECALHO, TAMANHO_DO_CABECALHO + tamanhoDaConfig))));
      } catch (_) { return null; }
      if (!config) return null;
    }
    return {
      chave, camada, config,
      largura: visao.getUint16(4, true),
      altura: visao.getUint16(6, true),
      sequencia: visao.getUint32(8, true),
      geracao: visao.getUint16(12, true),
      dados: bytes.subarray(TAMANHO_DO_CABECALHO + tamanhoDaConfig)
    };
  }

  // ---------- Pedaços: o quadro fatiado para o ritmador ----------
  //
  // O servidor de mídia tem um portão POR ESPECTADOR no canal das faixas de dados: descarta o
  // pacote quando o buffer daquela pessoa passa de 100 ms do bitrate medido E de 8 KB
  // (`DataChannelWriterUnreliable`, na 1.13.7). Um quadro-chave de 100 KB mandado de uma vez
  // passa dos dois -- e no começo de cada assinatura o bitrate medido é quase zero, então quase
  // qualquer quadro-chave passa. Foi o que o registro do servidor mostrou no primeiro teste em
  // rede de verdade: "data dropped due to high buffered amount", a cada começo de assinatura.
  //
  // A biblioteca fatia o quadro em pacotes de 16 KB e manda todos no mesmo instante, sem jeito
  // de espaçá-los. Então o fatiamento é nosso: pedaços que cabem abaixo do piso de 8 KB, cada um
  // enviado como um quadro de um pacote só, no ritmo que quem envia escolher.
  const TAMANHO_DO_PEDACO = 7200;
  const CABECALHO_DO_PEDACO = 16;
  const MAGICO_DO_PEDACO = 0x50;   // 'P'

  // Cabeçalho de 16 bytes: 0 mágico · 1 versão · 2 camada · 3 reservado · 4-7 sequência ·
  // 8-9 geração · 10-11 índice · 12-13 total · 14-15 reservado. Depois, a fatia do envelope.
  function fatiar(envelope, { camada, sequencia, geracao }, tamanho = TAMANHO_DO_PEDACO) {
    const indiceDaCamada = CAMADAS.indexOf(camada);
    const total = Math.max(1, Math.ceil(envelope.length / tamanho));
    if (total > 0xffff) throw new Error('quadro grande demais');
    const pedacos = [];
    for (let indice = 0; indice < total; indice++) {
      const fatia = envelope.subarray(indice * tamanho, Math.min(envelope.length, (indice + 1) * tamanho));
      const pedaco = new Uint8Array(CABECALHO_DO_PEDACO + fatia.length);
      const visao = new DataView(pedaco.buffer);
      visao.setUint8(0, MAGICO_DO_PEDACO);
      visao.setUint8(1, VERSAO);
      visao.setUint8(2, indiceDaCamada);
      visao.setUint32(4, sequencia >>> 0, true);
      visao.setUint16(8, geracao & 0xffff, true);
      visao.setUint16(10, indice, true);
      visao.setUint16(12, total, true);
      pedaco.set(fatia, CABECALHO_DO_PEDACO);
      pedacos.push(pedaco);
    }
    return pedacos;
  }

  function lerPedaco(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < CABECALHO_DO_PEDACO) return null;
    const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (visao.getUint8(0) !== MAGICO_DO_PEDACO || visao.getUint8(1) !== VERSAO) return null;
    const camada = CAMADAS[visao.getUint8(2)];
    const indice = visao.getUint16(10, true);
    const total = visao.getUint16(12, true);
    if (!camada || !total || indice >= total) return null;
    return {
      camada, indice, total,
      sequencia: visao.getUint32(4, true),
      geracao: visao.getUint16(8, true),
      dados: bytes.subarray(CABECALHO_DO_PEDACO)
    };
  }

  // Junta os pedaços de volta no envelope. Um quadro com pedaço faltando não é montado nunca: ele
  // vira buraco na sequência, e o buraco é o que o decodificador sabe tratar (reenvio, e depois
  // quadro-chave). Pedaços velhos saem depois de `msDeValidade`, para um quadro perdido não
  // ocupar memória para sempre.
  function criarMontador({ msDeValidade = 1500, maximoDeQuadros = 64 } = {}) {
    const emMontagem = new Map();   // chave → { total, recebidos, fatias, desde }
    return {
      receber(pedaco, agora = Date.now()) {
        if (pedaco.total === 1) return pedaco.dados;
        const chave = `${pedaco.camada}:${pedaco.geracao}:${pedaco.sequencia}`;
        let quadro = emMontagem.get(chave);
        if (!quadro) {
          quadro = { total: pedaco.total, recebidos: 0, fatias: new Array(pedaco.total), desde: agora };
          emMontagem.set(chave, quadro);
          if (emMontagem.size > maximoDeQuadros) emMontagem.delete(emMontagem.keys().next().value);
        }
        if (quadro.total !== pedaco.total || quadro.fatias[pedaco.indice]) return null;
        quadro.fatias[pedaco.indice] = pedaco.dados;
        quadro.recebidos += 1;
        if (quadro.recebidos < quadro.total) return null;
        emMontagem.delete(chave);
        let tamanho = 0;
        for (const fatia of quadro.fatias) tamanho += fatia.length;
        const envelope = new Uint8Array(tamanho);
        let posicao = 0;
        for (const fatia of quadro.fatias) { envelope.set(fatia, posicao); posicao += fatia.length; }
        return envelope;
      },
      limpar(agora = Date.now()) {
        for (const [chave, quadro] of emMontagem) if (agora - quadro.desde > msDeValidade) emMontagem.delete(chave);
      },
      get emMontagem() { return emMontagem.size; }
    };
  }

  // ---------- O ritmador ----------
  //
  // Um balde de fichas que guarda no máximo UM pedaço. Dois pedaços grudados chegam grudados ao
  // servidor, e o segundo encontra o buffer do espectador acima do piso de 8 KB -- é exatamente
  // o que o portão dele descarta no começo de uma assinatura. Com o balde de um pedaço, cada
  // pedaço sai sozinho, e o intervalo entre eles é o tempo que o buffer tem para escoar.
  //
  // O reenvio fura a fila (`primeiro`): quem pediu está esperando, com a imagem parada.
  function criarRitmador({ enviar, agendar, cancelar, bytesPorSegundo, agora = () => performance.now() }) {
    const capacidade = TAMANHO_DO_PEDACO + CABECALHO_DO_PEDACO;
    const fila = [];
    let bytesNaFila = 0;
    let fichas = capacidade;
    let ultimo = agora();
    let timer = null;
    let taxa = Math.max(1, bytesPorSegundo());

    function bombear() {
      timer = null;
      const instante = agora();
      taxa = Math.max(1, bytesPorSegundo());
      fichas = Math.min(capacidade, fichas + (instante - ultimo) / 1000 * taxa);
      ultimo = instante;
      while (fila.length && fichas >= fila[0].bytes.length) {
        const item = fila.shift();
        bytesNaFila -= item.bytes.length;
        fichas -= item.bytes.length;
        try { enviar(item); } catch (_) { /* quem envia conta a própria falha */ }
      }
      if (fila.length) timer = agendar(bombear, Math.max(1, Math.ceil((fila[0].bytes.length - fichas) / taxa * 1000)));
    }

    return {
      enfileirar(item, { primeiro = false } = {}) {
        if (primeiro) fila.unshift(item); else fila.push(item);
        bytesNaFila += item.bytes.length;
        if (!timer) bombear();
      },
      get bytesNaFila() { return bytesNaFila; },
      get pedacosNaFila() { return fila.length; },
      // Quanto o último pedaço da fila ainda vai esperar para sair.
      get atrasoMs() { return bytesNaFila / taxa * 1000; },
      esvaziar() {
        fila.length = 0;
        bytesNaFila = 0;
        if (timer !== null) cancelar(timer);
        timer = null;
      }
    };
  }

  // ---------- Mensagens de controle ----------
  //
  // Viajam pelo canal CONFIÁVEL. São dezenas de bytes, e perder uma delas custa caro: um
  // pedido de quadro-chave perdido deixa a imagem parada esperando um quadro que ninguém mais
  // vai pedir; um anúncio de capacidade perdido deixa a sala inteira no caminho errado.
  //
  //   cap    quem sou eu: o que decodifico e se aceito receber por aqui. Com `pergunta`, pede
  //          o anúncio de volta -- é como quem já está na sala conhece quem acabou de chegar
  //          (o anúncio espontâneo do recém-chegado chega antes de a sala conhecê-lo, e o
  //          LiveKit o entrega sem remetente)
  //   quero  comecei (ou continuo) a assistir esta camada
  //   solto  parei de assistir esta camada
  //   reenvio  faltaram estes quadros, mande de novo -- o NACK que se perdeu ao sair do RTP.
  //          Um quadro comum é um pacote só, e reenviá-lo custa muito menos do que o
  //          quadro-chave que a perda dele exigiria
  //   chave  perdi a sequência (e o reenvio não bastou), mande um quadro-chave
  //   relato como a imagem está chegando, uma vez por segundo
  //   fim    vou tirar as faixas desta tela: solte as suas AGORA, antes de elas sumirem. O
  //          servidor 1.13.6 trava a sinalização de quem assina uma faixa de dados no instante
  //          em que ela é removida; com o aviso, ninguém está assinando nada nessa hora
  //   ping / pong  acerto de relógio, para o atraso ser medido entre duas máquinas
  const CODECS_CONHECIDOS = ['h264', 'vp8'];
  // Quantos quadros um pedido de reenvio pode cobrir. Um buraco maior que isto não é perda
  // pontual, é a conexão caindo -- e aí um quadro-chave é mais barato que reenviar tudo.
  const MAXIMO_DO_REENVIO = 16;
  const numero = (valor, max) => Number.isFinite(valor) && valor >= 0 ? Math.min(valor, max) : 0;
  const camadaValida = valor => CAMADAS.includes(valor) ? valor : null;

  const FORMATOS = {
    cap: m => ({
      dec: Array.isArray(m.dec) ? [...new Set(m.dec.filter(c => CODECS_CONHECIDOS.includes(c)))] : [],
      recebe: m.recebe === true,
      pergunta: m.pergunta === true
    }),
    quero: m => camadaValida(m.camada) && { camada: m.camada },
    solto: m => camadaValida(m.camada) && { camada: m.camada },
    chave: m => camadaValida(m.camada) && { camada: m.camada },
    reenvio: m => camadaValida(m.camada) && Number.isInteger(m.geracao) && Number.isInteger(m.de) && Number.isInteger(m.ate)
      && m.de >= 0 && m.ate >= m.de && m.ate - m.de < MAXIMO_DO_REENVIO
      && { camada: m.camada, geracao: m.geracao & 0xffff, de: m.de, ate: m.ate },
    relato: m => camadaValida(m.camada) && {
      camada: m.camada,
      recebidos: numero(m.recebidos, 1e6),
      perdidos: numero(m.perdidos, 1e6),
      decodificados: numero(m.decodificados, 1e6),
      pedidosDeChave: numero(m.pedidosDeChave, 1e4),
      bytes: numero(m.bytes, 1e10),
      // `null` quando o relógio ainda não foi acertado: um atraso inventado é pior do que
      // nenhum, porque a adaptação reagiria a ele.
      atrasoMs: Number.isFinite(m.atrasoMs) ? Math.max(-60000, Math.min(60000, m.atrasoMs)) : null
    },
    fim: () => ({}),
    ping: m => Number.isFinite(m.enviadoEm) && { enviadoEm: m.enviadoEm },
    pong: m => Number.isFinite(m.enviadoEm) && Number.isFinite(m.respondidoEm) && { enviadoEm: m.enviadoEm, respondidoEm: m.respondidoEm }
  };

  // O tipo viaja em `tipo`, e é escrito DEPOIS dos dados: nenhum campo de mensagem consegue
  // sobrescrevê-lo, nem por engano de quem escreve uma mensagem nova.
  function mensagem(tipo, dados = {}) {
    if (!FORMATOS[tipo]) throw new Error(`mensagem desconhecida: ${tipo}`);
    return codificadorDeTexto.encode(JSON.stringify({ ...dados, v: VERSAO, tipo }));
  }

  function lerMensagem(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 2048) return null;
    let bruta;
    try { bruta = JSON.parse(decodificadorDeTexto.decode(bytes)); } catch (_) { return null; }
    if (!bruta || bruta.v !== VERSAO || typeof bruta.tipo !== 'string' || !Object.hasOwn(FORMATOS, bruta.tipo)) return null;
    const dados = FORMATOS[bruta.tipo](bruta);
    return dados ? { ...dados, tipo: bruta.tipo } : null;
  }

  const api = {
    CAMADAS, TOPICO, CODECS_CONHECIDOS, TAMANHO_DO_CABECALHO, MAXIMO_DO_REENVIO, TAMANHO_DO_PEDACO,
    nomeDaFaixa, camadaDaFaixa, montar, ler, mensagem, lerMensagem, configParaEnvio, configRecebida,
    fatiar, lerPedaco, criarMontador, criarRitmador
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaQuadro = api;
})(typeof window === 'undefined' ? globalThis : window);
