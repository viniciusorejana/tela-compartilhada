/* Quadros → VideoDecoder → MediaStream, para a tela por WebCodecs.
 *
 * A saída é uma faixa de vídeo comum, e isso é o que mantém a interface intocada: o palco, o
 * card da grade e o quadradinho continuam recebendo um `MediaStream` em
 * `par.remoteStreams.screen`, como sempre receberam. Nenhum `<video>` vira `<canvas>`, nenhum
 * zoom, tela cheia ou tema precisa saber de onde a imagem veio.
 */
(function (root) {
  // Quanto um quadro adiantado espera pelo que falta antes dele. O canal não garante ordem, e
  // sem esta espera um quadro que só chegou fora de ordem seria contado como perdido -- e cada
  // perda custa um quadro-chave. Curta de propósito: acima de uns 60 ms, a espera vira atraso
  // que se vê.
  const MS_DE_ESPERA_PELA_ORDEM = 60;
  // Com reenvio pedido, a espera cobre a ida e volta até quem transmite. O teto existe porque,
  // passado ele, a imagem parada já incomoda mais do que um quadro-chave custaria.
  const MS_MAXIMOS_DE_ESPERA_PELO_REENVIO = 400;
  // Cabe um reenvio inteiro a 60 quadros por segundo: é o que a espera acima pode acumular.
  const QUADROS_ADIANTADOS_GUARDADOS = 30;
  // Entre dois pedidos de quadro-chave. Quem envia também limita; aqui é para não inundar o
  // canal de controle quando a perda é contínua.
  const MS_ENTRE_PEDIDOS_DE_CHAVE = 300;
  // Sem quadro-chave por este tempo depois de pedir, pede de novo. O caso comum é o próprio
  // quadro-chave ter se perdido: ele tem vários pacotes, e com perda é o quadro que mais cai.
  // Um segundo aqui era um segundo de tela parada a cada quadro-chave perdido.
  const MS_ATE_REPETIR_O_PEDIDO = 400;
  // Quadros esperando o decodificador. Acima disto ele não está acompanhando, e a imagem só
  // se atrasaria mais; melhor descartar até um quadro-chave e começar do agora.
  const FILA_MAXIMA_NO_DECODIFICADOR = 8;
  const MOTIVOS_DE_PERDA = new Set(['buraco na sequência', 'decodificador atrasado', 'quadro recusado', 'quadro-chave sem configuração']);
  // O mesmo teto do protocolo (tela-quadro.js): acima disto, quadro-chave em vez de reenvio.
  const MAXIMO_DO_REENVIO = 16;

  // ---------- A faixa de saída ----------
  function criarSaida() {
    // O gerador padronizado, onde existir fora de Worker; depois o do Chrome, que é o mesmo
    // mecanismo com o nome antigo. Os dois viram faixa sem cópia.
    if (typeof VideoTrackGenerator === 'function') {
      try {
        const gerador = new VideoTrackGenerator();
        const escritor = gerador.writable.getWriter();
        return criarSaidaPorGerador('gerador', gerador.track, escritor);
      } catch (_) { /* só existe em Worker neste navegador */ }
    }
    if (typeof MediaStreamTrackGenerator === 'function') {
      const gerador = new MediaStreamTrackGenerator({ kind: 'video' });
      return criarSaidaPorGerador('gerador', gerador, gerador.writable.getWriter());
    }
    // Safari e Firefox: o quadro é desenhado num canvas, e o canvas vira faixa. Uma cópia por
    // quadro, no aparelho que costuma ser o mais fraco da sala. Se a medição mostrar que isto
    // pesa no iPhone, o passo seguinte é desenhar no palco direto -- mas isso é otimização com
    // evidência, e não ponto de partida.
    if (typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype) {
      const canvas = root.NexoTelaCodificador.noBastidor(document.createElement('canvas'));
      canvas.width = 2; canvas.height = 2;
      const contexto = canvas.getContext('2d', { alpha: false, desynchronized: true });
      const faixa = canvas.captureStream().getVideoTracks()[0];
      return {
        tipo: 'canvas', faixa,
        escrever(quadro) {
          try {
            if (canvas.width !== quadro.displayWidth || canvas.height !== quadro.displayHeight) {
              canvas.width = quadro.displayWidth; canvas.height = quadro.displayHeight;
            }
            contexto.drawImage(quadro, 0, 0);
          } finally { quadro.close(); }
          return true;
        },
        fechar() { faixa.stop(); canvas.remove(); }
      };
    }
    return null;
  }

  function criarSaidaPorGerador(tipo, faixa, escritor) {
    return {
      tipo, faixa,
      escrever(quadro) {
        // Quem consome a faixa ficou para trás: descarta aqui em vez de enfileirar, ou o
        // atraso cresceria sem limite enquanto o palco estivesse ocupado.
        if (escritor.desiredSize !== null && escritor.desiredSize <= 0) { quadro.close(); return false; }
        escritor.write(quadro).catch(() => {});
        return true;
      },
      fechar() {
        escritor.close().catch(() => {});
        try { faixa.stop(); } catch (_) { /* já parada */ }
      }
    };
  }

  const podeExibir = () => typeof VideoTrackGenerator === 'function' || typeof MediaStreamTrackGenerator === 'function'
    || (typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype);

  const cacheDeSuporte = new Map();
  async function suportada(config) {
    const chave = `${config.codec}|${config.hardwareAcceleration}|${config.codedWidth}x${config.codedHeight}`;
    if (!cacheDeSuporte.has(chave)) {
      cacheDeSuporte.set(chave, VideoDecoder.isConfigSupported(config).then(r => r.supported === true, () => false));
    }
    return cacheDeSuporte.get(chave);
  }

  // O que esta máquina consegue RECEBER. H.264 é perguntado no perfil alto, nível 4.2 (1080p a
  // 60): é o que a placa de quem transmite costuma produzir, e anunciar H.264 sem aguentá-lo
  // levaria a sala inteira para um caminho em que este aparelho não decodifica.
  let sondagem = null;
  function sondarRecebimento() {
    if (sondagem) return sondagem;
    sondagem = (async () => {
      const resultado = { exibe: podeExibir(), h264: false, vp8: false };
      if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return resultado;
      const perguntar = async codec => (await suportada({ codec, hardwareAcceleration: 'no-preference', optimizeForLatency: true }))
        || suportada({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
      resultado.h264 = await perguntar('avc1.64002A');
      resultado.vp8 = await perguntar('vp8');
      return resultado;
    })();
    return sondagem;
  }

  // ---------- Um decodificador por tela assistida ----------
  function criarDecodificador({ aoPedirChave, aoPedirReenvio, aoFalhar, aoPrimeiraImagem, desvioDoRelogioMs, esperaPorReenvioMs }) {
    const saida = criarSaida();
    if (!saida) throw new Error('este navegador não transforma quadros decodificados em faixa de vídeo');
    const stream = new MediaStream([saida.faixa]);
    let fechado = false;
    let alvo = 'alta';
    let ativa = null;                 // { camada, geracao, esperado }
    let aguardandoChave = true;
    let desdeQueComecouAEsperar = performance.now();
    let ultimoPedido = 0;
    const geracoesVelhas = new Set();
    const adiantados = new Map();     // sequência → { envelope, capturaUs, chegada }
    let esperaPelaOrdem = null;
    // O buraco que está sendo esperado agora: onde ele começa. Cada buraco pede reenvio uma
    // vez só; um buraco NOVO (o anterior foi preenchido e apareceu outro adiante) pede de novo.
    let buraco = null;
    let configAtual = '';
    let hardware = null;
    let primeira = true;
    let cadeia = Promise.resolve();
    const naFila = new Map();         // timestamp → { chegada, capturaUs }

    const janela = () => ({ recebidos: 0, bytes: 0, perdidos: 0, atrasados: 0, decodificados: 0, exibidos: 0, descartadosNaSaida: 0, pedidosDeChave: 0, pedidosPorBuraco: 0, reenviosPedidos: 0, recuperados: 0, atrasos: [], msDeDecodificacao: 0, amostras: 0 });
    // Como no codificador: quem fecha a janela é o relato de cada segundo, e o painel só lê.
    let medindo = janela();
    let ultimaJanela = { ...janela(), segundos: 0 };
    let inicioDaJanela = performance.now();
    const totais = { recebidos: 0, perdidos: 0, decodificados: 0, pedidosDeChave: 0, reenviosPedidos: 0, recuperados: 0, bytes: 0 };
    let medidas = { largura: 0, altura: 0 };

    const decodificador = new VideoDecoder({
      output(quadro) {
        if (fechado) { quadro.close(); return; }
        const origem = naFila.get(quadro.timestamp);
        naFila.delete(quadro.timestamp);
        medindo.decodificados += 1;
        totais.decodificados += 1;
        if (origem) {
          medindo.msDeDecodificacao += performance.now() - origem.chegada;
          medindo.amostras += 1;
          const desvio = desvioDoRelogioMs?.();
          if (desvio !== null && desvio !== undefined && origem.capturaUs) {
            // O relógio de quem transmite, trazido para o daqui. Sem o acerto (ping/pong), a
            // diferença entre os dois relógios apareceria como atraso -- podendo ser de
            // segundos, e até negativa.
            const agoraMs = performance.timeOrigin + performance.now();
            medindo.atrasos.push(agoraMs - (origem.capturaUs / 1000 - desvio));
          }
        }
        medidas = { largura: quadro.displayWidth, altura: quadro.displayHeight };
        if (saida.escrever(quadro)) medindo.exibidos += 1; else medindo.descartadosNaSaida += 1;
        if (primeira) {
          primeira = false;
          try { aoPrimeiraImagem?.(); } catch (_) { /* quem ouve decide */ }
        }
      },
      error(erro) {
        if (fechado) return;
        fechado = true;
        aoFalhar?.(erro);
      }
    });

    function pedirChave(motivo) {
      // Um quadro que ainda estava na fila quando a recepção fechou não pede nada a ninguém.
      if (fechado) return;
      const agora = performance.now();
      if (agora - ultimoPedido < MS_ENTRE_PEDIDOS_DE_CHAVE) return;
      ultimoPedido = agora;
      medindo.pedidosDeChave += 1;
      totais.pedidosDeChave += 1;
      // Só o pedido por BURACO fala da conexão. O da troca de camada e o de quem acabou de
      // começar a assistir são o funcionamento normal -- contá-los como sintoma rebaixaria para
      // a camada leve justamente quem acabou de pedir a cheia.
      if (MOTIVOS_DE_PERDA.has(motivo)) medindo.pedidosPorBuraco += 1;
      // Na troca, o quadro-chave que falta é o da camada NOVA. Pedir o da camada que está na tela
      // deixava a troca esperando o quadro-chave periódico da outra: medido contra a VPS, quinze
      // segundos em 360p depois de o rebaixamento já ter acabado.
      const camada = motivo === 'troca de camada' || !ativa || aguardandoChave ? alvo : ativa.camada;
      aoPedirChave?.(camada, motivo);
    }

    function esperarChave(motivo) {
      if (!aguardandoChave) desdeQueComecouAEsperar = performance.now();
      aguardandoChave = true;
      adiantados.clear();
      clearTimeout(esperaPelaOrdem);
      esperaPelaOrdem = null;
      buraco = null;
      pedirChave(motivo);
    }

    async function configurar(config) {
      const identidade = JSON.stringify([config.codec, config.codedWidth, config.codedHeight, config.description ? Array.from(config.description) : null]);
      if (identidade === configAtual && decodificador.state === 'configured') return true;
      const base = { codec: config.codec, optimizeForLatency: true };
      if (config.codedWidth) base.codedWidth = config.codedWidth;
      if (config.codedHeight) base.codedHeight = config.codedHeight;
      if (config.description) base.description = config.description;
      if (config.colorSpace) base.colorSpace = config.colorSpace;
      for (const aceleracao of ['prefer-hardware', 'no-preference']) {
        const tentativa = { ...base, hardwareAcceleration: aceleracao };
        if (!(await suportada(tentativa))) continue;
        if (fechado) return false;
        decodificador.configure(tentativa);
        configAtual = identidade;
        hardware = aceleracao === 'prefer-hardware';
        return true;
      }
      fechado = true;
      aoFalhar?.(new Error(`este aparelho não decodifica ${config.codec}`));
      return false;
    }

    async function decodificar(item) {
      const { envelope, capturaUs, chegada } = item;
      if (envelope.chave) {
        if (!envelope.config) { esperarChave('quadro-chave sem configuração'); return; }
        if (!(await configurar(envelope.config))) return;
      }
      if (fechado || decodificador.state !== 'configured') return;
      if (decodificador.decodeQueueSize > FILA_MAXIMA_NO_DECODIFICADOR) { esperarChave('decodificador atrasado'); return; }
      // O timestamp do quadro é a hora da captura, em microssegundos: único, crescente, e é
      // por ele que a saída reencontra de onde o quadro veio.
      const timestamp = capturaUs || Math.round((performance.timeOrigin + chegada) * 1000);
      naFila.set(timestamp, { chegada, capturaUs });
      if (naFila.size > 32) naFila.delete(naFila.keys().next().value);
      try {
        decodificador.decode(new EncodedVideoChunk({ type: envelope.chave ? 'key' : 'delta', timestamp, data: envelope.dados }));
      } catch (erro) {
        // Um quadro que o decodificador recusa não derruba a tela: espera o próximo
        // quadro-chave, que recomeça do zero.
        console.warn('tela-decodificador: quadro recusado:', erro?.message || erro);
        esperarChave('quadro recusado');
      }
    }

    // Decodifica em ordem tudo o que já pode ser decodificado.
    async function escoar() {
      while (ativa && adiantados.has(ativa.esperado)) {
        const item = adiantados.get(ativa.esperado);
        adiantados.delete(ativa.esperado);
        ativa.esperado += 1;
        await decodificar(item);
      }
      vigiarBuraco();
    }

    // O que falta ANTES dos quadros adiantados: pede o reenvio na hora e espera por ele uma
    // ida e volta e meia, com folga. Pedir antes de esperar a ordem custa, no pior caso, um
    // quadro duplicado (ele só estava atrasado); esperar antes de pedir custaria atraso em
    // toda perda de verdade.
    //
    // É o NACK do RTP, que se perdeu na troca de transporte. Sem ele, cada pacote perdido
    // virava um quadro-chave -- e o quadro-chave, com vários pacotes, é justamente o que mais
    // se perde sob perda. Medido aqui: sem o reenvio, 8% de perda de pacotes congelava a
    // imagem por segundos seguidos.
    function vigiarBuraco() {
      if (!ativa || !adiantados.size) {
        clearTimeout(esperaPelaOrdem);
        esperaPelaOrdem = null;
        buraco = null;
        return;
      }
      if (adiantados.has(ativa.esperado) || buraco?.inicio === ativa.esperado) return;
      clearTimeout(esperaPelaOrdem);
      const ate = Math.min(...adiantados.keys()) - 1;
      const pedir = typeof aoPedirReenvio === 'function' && ate - ativa.esperado < MAXIMO_DO_REENVIO;
      if (pedir) {
        aoPedirReenvio(ativa.camada, ativa.geracao, ativa.esperado, ate);
        medindo.reenviosPedidos += 1;
        totais.reenviosPedidos += 1;
      }
      buraco = { inicio: ativa.esperado, fim: ate, pediu: pedir };
      const espera = pedir
        ? Math.min(MS_MAXIMOS_DE_ESPERA_PELO_REENVIO, Math.max(MS_DE_ESPERA_PELA_ORDEM, esperaPorReenvioMs?.() ?? 150))
        : MS_DE_ESPERA_PELA_ORDEM;
      esperaPelaOrdem = setTimeout(() => { cadeia = cadeia.then(desistirDaOrdem); }, espera);
    }

    // Esperou demais pelo que faltava: o que faltava se perdeu. Se entre os adiantados houver
    // um quadro-chave, a imagem segue dali sem pedir nada; senão, pede.
    function desistirDaOrdem() {
      esperaPelaOrdem = null;
      buraco = null;
      if (!ativa || !adiantados.size) return;
      const sequencias = [...adiantados.keys()].sort((a, b) => a - b);
      const chave = sequencias.find(s => adiantados.get(s).envelope.chave);
      if (chave !== undefined) {
        medindo.perdidos += chave - ativa.esperado;
        totais.perdidos += chave - ativa.esperado;
        for (const s of sequencias) if (s < chave) adiantados.delete(s);
        ativa.esperado = chave;
        cadeia = cadeia.then(escoar);
        return;
      }
      medindo.perdidos += sequencias[0] - ativa.esperado;
      totais.perdidos += sequencias[0] - ativa.esperado;
      esperarChave('buraco na sequência');
    }

    function recomecar(envelope) {
      // Velha é só a geração SUBSTITUÍDA na mesma camada: o codificador dela recomeçou, e um
      // quadro atrasado dela não pode ser confundido com um recomeço. Trocar de camada não
      // envelhece nada -- a camada que se deixou pode voltar a ser pedida com o mesmo
      // codificador ainda no ar, e marcá-la aqui a tornaria invisível para sempre.
      if (ativa && ativa.camada === envelope.camada && ativa.geracao !== envelope.geracao) {
        geracoesVelhas.add(`${ativa.camada}:${ativa.geracao}`);
        if (geracoesVelhas.size > 16) geracoesVelhas.delete(geracoesVelhas.values().next().value);
      }
      ativa = { camada: envelope.camada, geracao: envelope.geracao, esperado: envelope.sequencia };
      aguardandoChave = false;
      adiantados.clear();
      clearTimeout(esperaPelaOrdem);
      esperaPelaOrdem = null;
      buraco = null;
    }

    function processar(envelope, capturaUs, chegada) {
      if (fechado) return;
      const item = { envelope, capturaUs, chegada };
      const daAtiva = ativa && envelope.camada === ativa.camada;
      if (!daAtiva && envelope.camada !== alvo) return;
      if (geracoesVelhas.has(`${envelope.camada}:${envelope.geracao}`)) return;
      const outraGeracao = daAtiva && envelope.geracao !== ativa.geracao;

      if (envelope.chave) {
        // Um quadro-chave é ponto de partida válido quando: não há nada no ar ainda, é a troca
        // para a camada pedida, o codificador recomeçou, estávamos esperando por ele, ou ele
        // pula um buraco que ainda não tinha sido declarado.
        const troca = !daAtiva && envelope.camada === alvo;
        if (!ativa || troca || outraGeracao || aguardandoChave || envelope.sequencia > ativa.esperado) {
          if (ativa && daAtiva && !outraGeracao && !aguardandoChave && envelope.sequencia > ativa.esperado) {
            medindo.perdidos += envelope.sequencia - ativa.esperado;
            totais.perdidos += envelope.sequencia - ativa.esperado;
          }
          recomecar(envelope);
        }
      }
      if (!ativa || envelope.camada !== ativa.camada) return;
      if (envelope.geracao !== ativa.geracao) { if (!aguardandoChave) esperarChave('o codificador recomeçou'); return; }
      if (aguardandoChave) {
        if (performance.now() - desdeQueComecouAEsperar > MS_ATE_REPETIR_O_PEDIDO) {
          desdeQueComecouAEsperar = performance.now();
          pedirChave('ainda sem quadro-chave');
        }
        return;
      }
      // Atrasado ou repetido: o reenvio vai para todo mundo que assiste a camada, e quem não
      // tinha perdido nada recebe uma cópia do que já decodificou.
      if (envelope.sequencia < ativa.esperado || adiantados.has(envelope.sequencia)) { medindo.atrasados += 1; return; }
      adiantados.set(envelope.sequencia, item);
      if (envelope.sequencia === ativa.esperado) {
        if (buraco?.pediu && envelope.sequencia <= buraco.fim) { medindo.recuperados += 1; totais.recuperados += 1; }
        cadeia = cadeia.then(escoar);
        return;
      }
      if (adiantados.size > QUADROS_ADIANTADOS_GUARDADOS) { clearTimeout(esperaPelaOrdem); desistirDaOrdem(); return; }
      vigiarBuraco();
    }

    return {
      stream,
      get tipoDeSaida() { return saida.tipo; },
      get camadaAtiva() { return ativa && !aguardandoChave ? ativa.camada : null; },
      get camadaAlvo() { return alvo; },
      get temImagem() { return !primeira; },

      receber(envelope, capturaUs, bytesBrutos) {
        if (fechado || !envelope) return;
        medindo.recebidos += 1;
        medindo.bytes += bytesBrutos || envelope.dados.byteLength;
        totais.recebidos += 1;
        totais.bytes += bytesBrutos || envelope.dados.byteLength;
        const chegada = performance.now();
        cadeia = cadeia.then(() => processar(envelope, capturaUs, chegada)).catch(erro => console.error('tela-decodificador:', erro));
      },

      // A camada que se quer ver. A troca só acontece de fato no primeiro quadro-chave da
      // camada nova; até lá, a antiga continua na tela. Sem isto, cada troca de camada seria
      // um instante de tela preta.
      definirCamada(camada) {
        if (camada === alvo) return;
        alvo = camada;
        if (!ativa || ativa.camada !== camada) pedirChave('troca de camada');
      },

      // Chamado de tempos em tempos por quem assiste: um quadro-chave pedido e não recebido é
      // pedido de novo, mesmo que nenhum quadro chegue para disparar a conferência.
      vigiar() {
        if (fechado) return;
        const esperandoTroca = ativa && ativa.camada !== alvo;
        if ((aguardandoChave || esperandoTroca || !ativa) && performance.now() - Math.max(ultimoPedido, desdeQueComecouAEsperar) > MS_ATE_REPETIR_O_PEDIDO) {
          pedirChave(esperandoTroca ? 'troca de camada' : 'ainda sem quadro-chave');
        }
      },

      fecharJanela() {
        const agora = performance.now();
        ultimaJanela = { ...medindo, segundos: (agora - inicioDaJanela) / 1000 };
        medindo = janela();
        inicioDaJanela = agora;
        return this.estatisticas();
      },

      estatisticas() {
        const j = ultimaJanela;
        const s = Math.max(j.segundos, 0.001);
        const atrasos = [...j.atrasos].sort((a, b) => a - b);
        const mediana = atrasos.length ? atrasos[Math.floor(atrasos.length / 2)] : null;
        return {
          camada: ativa?.camada || null, alvo, aguardandoChave, hardware, saida: saida.tipo,
          codec: configAtual ? JSON.parse(configAtual)[0] : null,
          largura: medidas.largura, altura: medidas.altura,
          fps: j.exibidos / s, bps: j.bytes * 8 / s,
          recebidos: j.recebidos, perdidos: j.perdidos, atrasados: j.atrasados, decodificados: j.decodificados,
          descartadosNaSaida: j.descartadosNaSaida, pedidosDeChave: j.pedidosDeChave, pedidosPorBuraco: j.pedidosPorBuraco,
          reenviosPedidos: j.reenviosPedidos, recuperados: j.recuperados,
          perda: j.recebidos + j.perdidos ? j.perdidos / (j.recebidos + j.perdidos) : 0,
          atrasoMs: mediana, msDeDecodificacao: j.amostras ? j.msDeDecodificacao / j.amostras : null,
          bytesNaJanela: j.bytes,
          totais: { ...totais }
        };
      },

      // Fecha mesmo depois de uma falha: a falha marca `fechado`, mas quem encerra a faixa de
      // saída -- e com ela a imagem parada no palco -- é esta chamada.
      fechar() {
        fechado = true;
        clearTimeout(esperaPelaOrdem);
        if (decodificador.state !== 'closed') {
          try { decodificador.close(); } catch (_) { /* já fechado */ }
        }
        saida.fechar();
      }
    };
  }

  const api = { criarDecodificador, sondarRecebimento, podeExibir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaDecodificador = api;
})(typeof window === 'undefined' ? globalThis : window);
