/* Captura → VideoFrame → VideoEncoder, para a tela por WebCodecs.
 *
 * O ponto de tudo isto é o `hardwareAcceleration`. O WebRTC do navegador (e do aplicativo, que
 * é o mesmo Chromium) não alcança a placa de vídeo nesta classe de máquina; o WebCodecs
 * alcança, e é a única porta para NVENC, AMF e QSV que existe sem código nativo
 * (docs/captura-de-tela.md, docs/plano-webcodecs.md).
 *
 * E há um segundo ganho, que vale mesmo sem placa: aqui o laço de codificação é NOSSO. Quando
 * o codificador do WebRTC satura, ele derruba quadros na entrada e não diz nada. Aqui,
 * saturar é um número que a adaptação lê e responde encolhendo a imagem -- a resolução cede
 * antes dos quadros.
 */
(function (root) {
  const Decisoes = root.NexoTelaDecisoes;

  // Um quadro-chave de tempos em tempos, mesmo sem ninguém pedir. Os pedidos viajam pelo
  // canal confiável e não deveriam se perder, então isto é seguro contra o improvável: um
  // pedido que se perdeu numa reconexão deixaria a imagem parada para sempre.
  const MS_ENTRE_CHAVES_PERIODICAS = 15000;
  // O mínimo entre dois quadros-chave pedidos. Um quadro-chave custa dez a vinte vezes um
  // quadro comum; sob perda, atender cada pedido afogaria justamente a conexão que está
  // perdendo pacote, e o pedido seguinte viria ainda mais rápido.
  const MS_ENTRE_CHAVES_PEDIDAS = 300;
  // Quadros esperando o codificador. Acima disto ele não está acompanhando, e empilhar mais
  // só transforma atraso de codificação em atraso de imagem. Três, e não dois: a placa de
  // vídeo trabalha em linha de montagem, e dois quadros em voo é o normal dela -- com o limite
  // em dois, a NVENC perdia 5 de cada 60 quadros sem estar apertada.
  const FILA_MAXIMA_NO_CODIFICADOR = 3;

  // ---------- Onde esconder elementos que precisam existir na página ----------
  //
  // O caminho de reserva (vídeo que vira quadro, quadro que vira canvas) precisa de elementos
  // de verdade: fora do documento, alguns navegadores param de entregar quadros de um vídeo
  // ou de um canvas que "ninguém está vendo". Este canto tem 2 px, opacidade quase zero e não
  // recebe clique -- existe, mas não aparece nem atrapalha.
  let bastidor = null;
  function noBastidor(elemento) {
    if (!bastidor) {
      bastidor = document.createElement('div');
      bastidor.setAttribute('aria-hidden', 'true');
      bastidor.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:.01;pointer-events:none;z-index:-1';
      document.body.append(bastidor);
    }
    elemento.style.cssText = 'width:2px;height:2px';
    bastidor.append(elemento);
    return elemento;
  }

  // ---------- A fonte de quadros ----------
  //
  // Dois caminhos, porque o bom é só do Chrome. `MediaStreamTrackProcessor` entrega o quadro
  // da captura sem cópia. Onde ele não existe (Safari, Firefox), um `<video>` toca a faixa e
  // cada quadro apresentado vira um `VideoFrame` -- uma cópia por quadro, que é o preço de
  // funcionar ali.
  //
  // A captura trabalha numa CÓPIA da faixa. Parar o processador encerra a faixa que ele lê, e
  // a original continua publicada no RTP como reserva.
  //
  // A cópia sai do PROTÓTIPO, e não de `faixa.clone()`. A sala embrulha o `clone` da faixa da
  // tela para encerrar as cópias quando a publicação RTP sai do ar (`vigiarCopias`, em
  // sala.js) -- e trocar a qualidade despublica e publica de novo. Pelo embrulho, cada troca
  // de qualidade mataria a captura daqui no meio da transmissão. Quem encerra esta cópia é
  // `parar()`, chamado quando a tela para de verdade.
  function criarCaptura(faixa, aoQuadro) {
    const copia = MediaStreamTrack.prototype.clone.call(faixa);
    let parada = false;
    let tipo;
    let leitor = null;
    let video = null;
    const entregar = quadro => {
      if (parada) { quadro.close(); return; }
      try { aoQuadro(quadro); } catch (erro) { console.error('tela-codificador:', erro); } finally { quadro.close(); }
    };

    if (typeof MediaStreamTrackProcessor === 'function') {
      tipo = 'processador';
      // Dois quadros de folga, e não os dez do padrão: um quadro que esperou na fila é um
      // quadro velho, e codificá-lo é enviar o passado.
      const processador = new MediaStreamTrackProcessor({ track: copia, maxBufferSize: 2 });
      leitor = processador.readable.getReader();
      (async () => {
        for (;;) {
          let lido;
          try { lido = await leitor.read(); } catch (_) { break; }
          if (lido.done) break;
          entregar(lido.value);
        }
      })();
    } else if (typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      tipo = 'video';
      video = noBastidor(document.createElement('video'));
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([copia]);
      const passo = () => {
        if (parada) return;
        try { entregar(new VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) })); } catch (_) { /* quadro ainda não pronto */ }
        video.requestVideoFrameCallback(passo);
      };
      video.requestVideoFrameCallback(passo);
      video.play().catch(() => {});
    } else {
      copia.stop();
      return null;
    }

    return {
      tipo,
      parar() {
        if (parada) return;
        parada = true;
        try { leitor?.cancel(); } catch (_) { /* já encerrado */ }
        if (video) { video.srcObject = null; video.remove(); }
        copia.stop();
      }
    };
  }

  const podeCapturar = () => typeof MediaStreamTrackProcessor === 'function'
    || (typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype);

  // ---------- A configuração que o codificador aceita ----------

  // `quadros` só entra quando é para DECLARAR a taxa (ver `escolherConfiguracao`): sem ela, o
  // codificador controla o bitrate pelos carimbos de tempo dos quadros.
  function configBase({ codec, largura, altura, bitrate, quadros, aceleracao, modoDeBitrate }) {
    const config = {
      codec, width: largura, height: altura, bitrate,
      latencyMode: 'realtime', hardwareAcceleration: aceleracao
    };
    if (quadros) config.framerate = quadros;
    // Annex B: os parâmetros do H.264 vêm DENTRO de cada quadro-chave, e o receptor não
    // precisa de um `description` separado para começar do meio.
    if (codec.startsWith('avc1')) config.avc = { format: 'annexb' };
    if (modoDeBitrate) config.bitrateMode = modoDeBitrate;
    return config;
  }

  async function suportada(config) {
    try { return (await VideoEncoder.isConfigSupported(config)).supported === true; } catch (_) { return false; }
  }

  // Qual configuração usar, entre as que fazem sentido. `prefer-hardware` é uma PREFERÊNCIA
  // que o Chrome leva a sério: ele recusa a configuração quando não há placa para ela, e é
  // essa recusa que torna a pergunta útil.
  //
  // `constant` primeiro: um orçamento que a rede pode prever. O variável gasta mais nas trocas
  // de cena, que é justamente quando a conexão menos tem para dar.
  //
  // Na placa de vídeo, a taxa de quadros é declarada quando ela aceita, e OMITIDA quando não
  // aceita. O Chrome (e o Electron do aplicativo, que é o mesmo Chromium) publica para o
  // codificador do Windows uma tabela conservadora -- acima de 1080p, no máximo 30 quadros -- e
  // recusa 1440p a 60 e 4K a 60 com a taxa declarada. Sem ela, aceita, e a NVENC desta máquina
  // codificou 1440p a 60 inteiro, com o bitrate obedecendo (6,4 Mbps para 6 pedidos) e 10 ms
  // por quadro. Sem esta segunda tentativa, 1440p a 60 caía no processador: exatamente a
  // transmissão que mais precisa da placa.
  async function escolherConfiguracao({ codec, largura, altura, quadros, bitrate, somenteHardware }) {
    if (typeof VideoEncoder === 'undefined') return null;
    const candidatos = codec === 'h264' ? Decisoes.codecsH264(largura, altura, quadros).map(c => ({ ...c, familia: 'h264' }))
      : [{ perfil: 'vp8', codec: 'vp8', familia: 'vp8' }];
    const aceleracoes = somenteHardware ? ['prefer-hardware'] : ['prefer-hardware', 'no-preference'];
    for (const aceleracao of aceleracoes) {
      for (const candidato of candidatos) {
        for (const declararTaxa of aceleracao === 'prefer-hardware' ? [true, false] : [true]) {
          for (const modoDeBitrate of ['constant', null]) {
            const config = configBase({ codec: candidato.codec, largura, altura, bitrate, quadros: declararTaxa ? quadros : null, aceleracao, modoDeBitrate });
            if (await suportada(config)) {
              return { config, familia: candidato.familia, perfil: candidato.perfil, hardware: aceleracao === 'prefer-hardware', modoDeBitrate, declararTaxa };
            }
          }
        }
      }
    }
    return null;
  }

  // O que esta máquina consegue ENVIAR. Perguntado uma vez: sondar instancia codificadores de
  // teste, e a placa de vídeo não muda no meio da sala.
  let sondagem = null;
  function sondarEnvio() {
    if (sondagem) return sondagem;
    sondagem = (async () => {
      const resultado = { captura: podeCapturar(), h264Hardware: false, h264: false, vp8: false };
      if (typeof VideoEncoder === 'undefined') return resultado;
      // 1080p a 30 é a pergunta de referência: é o perfil padrão, e o mesmo que o Diagnóstico
      // já faz para o WebRTC -- as duas respostas ficam comparáveis. 720p a 30 também conta
      // como placa: há gráfico integrado que só vai até ali, e para ele a escada de
      // `degrausDaPlaca` ainda entrega a tela na placa, um degrau abaixo.
      const base = { largura: 1920, altura: 1080, quadros: 30, bitrate: 4_000_000 };
      resultado.h264Hardware = Boolean(await escolherConfiguracao({ ...base, codec: 'h264', somenteHardware: true }))
        || Boolean(await escolherConfiguracao({ largura: 1280, altura: 720, quadros: 30, bitrate: 2_000_000, codec: 'h264', somenteHardware: true }));
      resultado.h264 = resultado.h264Hardware || Boolean(await escolherConfiguracao({ ...base, codec: 'h264' }));
      resultado.vp8 = Boolean(await escolherConfiguracao({ ...base, codec: 'vp8' }));
      return resultado;
    })();
    return sondagem;
  }

  // O nível do H.264 acompanha o tamanho de VERDADE da camada, que muda com a adaptação e com
  // a fonte. A escolha foi feita para o alvo; a camada pode estar menor, e declarar o nível do
  // alvo seria prometer ao decodificador um fluxo maior do que o que chega.
  function codecNoTamanho(escolha, largura, altura, quadros) {
    if (escolha.familia !== 'h264') return escolha.config.codec;
    return escolha.config.codec.slice(0, 9) + Decisoes.nivelH264(largura, altura, quadros).toString(16).toUpperCase().padStart(2, '0');
  }

  // ---------- Uma camada codificada ----------
  //
  // Uma instância de `VideoEncoder` por camada. As duas recebem o MESMO quadro da captura:
  // `encode` copia o que precisa, e o quadro é fechado uma vez só, depois das duas.
  // A configuração num tamanho e numa taxa. A taxa só é declarada quando a escolha foi aceita
  // com ela: declarar agora o que a placa recusou na escolha faria o `configure` falhar -- e a
  // tela cair para o caminho de hoje -- no primeiro quadro.
  function configNoTamanho(escolha, base, { largura, altura, bitrate, quadros }) {
    const config = {
      ...base, codec: codecNoTamanho(escolha, largura, altura, quadros),
      width: largura, height: altura, bitrate
    };
    if (escolha.declararTaxa === false) delete config.framerate;
    else config.framerate = quadros;
    return config;
  }

  function criarCamada({ id, escolha, estado, podeEnviar, aoSaida, aoErro, geracao }) {
    let config = configNoTamanho(escolha, escolha.config, estado);
    let atual = { largura: estado.largura, altura: estado.altura, bitrate: estado.bitrate, quadros: estado.quadros };
    let configDoDecodificador = null;
    let sequencia = 0;
    let fechada = false;
    let precisaDeChave = true;
    let ultimaChave = 0;
    let ultimaChavePedida = 0;
    let baldeAnterior = null;
    // Hora de captura de cada quadro na fila do codificador, para carimbar a saída e medir o
    // tempo de codificação. O mapa é pequeno por construção: a fila tem no máximo dois.
    const naFila = new Map();
    let reconfiguracaoSoDeBitrate = false;

    const janela = () => ({ codificados: 0, bytes: 0, chaves: 0, descartes: { ritmo: 0, codificador: 0, fila: 0, rede: 0 }, msDeCodificacao: 0, amostras: 0 });
    let medindo = janela();
    let ultimaJanela = { ...janela(), segundos: 0 };
    let inicioDaJanela = performance.now();
    // Resposta empírica à pergunta que o plano deixou aberta: mudar só o bitrate custa um
    // quadro-chave? Se custar, a adaptação precisa ser muito mais parcimoniosa.
    const reconfiguracoes = { soDeBitrate: 0, comChaveEspontanea: 0 };

    const codificador = new VideoEncoder({
      output(pedaco, metadados) {
        if (fechada) return;
        if (metadados?.decoderConfig) configDoDecodificador = metadados.decoderConfig;
        const dados = new Uint8Array(pedaco.byteLength);
        pedaco.copyTo(dados);
        const origem = naFila.get(pedaco.timestamp);
        naFila.delete(pedaco.timestamp);
        const chave = pedaco.type === 'key';
        if (reconfiguracaoSoDeBitrate) {
          reconfiguracaoSoDeBitrate = false;
          if (chave && !origem?.chavePedida) reconfiguracoes.comChaveEspontanea += 1;
        }
        medindo.codificados += 1;
        medindo.bytes += dados.byteLength;
        if (chave) medindo.chaves += 1;
        if (origem) { medindo.msDeCodificacao += performance.now() - origem.em; medindo.amostras += 1; }
        aoSaida({
          camada: id, chave, dados, geracao,
          config: chave ? configDoDecodificador : null,
          largura: atual.largura, altura: atual.altura,
          sequencia: sequencia++,
          capturaUs: origem?.relogioUs ?? Math.round((performance.timeOrigin + performance.now()) * 1000)
        });
      },
      error(erro) {
        if (fechada) return;
        fechada = true;
        aoErro(erro);
      }
    });
    codificador.configure(config);

    // Quem fecha a janela é a adaptação, uma vez por segundo. O painel só LÊ a última janela
    // fechada: se ele também fechasse, cada olhada roubaria um pedaço do segundo que a
    // adaptação estava medindo, e ela passaria a decidir sobre frações de segundo.
    function fecharJanela() {
      const agora = performance.now();
      ultimaJanela = { ...medindo, segundos: (agora - inicioDaJanela) / 1000 };
      medindo = janela();
      inicioDaJanela = agora;
    }

    return {
      id,
      get fechada() { return fechada; },

      // Devolve o que aconteceu com o quadro, para quem chama poder contar.
      codificar(quadro) {
        if (fechada || codificador.state !== 'configured') return 'fechada';
        // Ritmo: o primeiro quadro de cada fatia de tempo. Com a fonte a 60 e o alvo a 24, isto
        // entrega 24 de verdade -- comparar só com o anterior daria 20, porque a sobra de
        // cada intervalo se perde.
        const intervaloUs = 1e6 / atual.quadros;
        const balde = Math.floor(quadro.timestamp / intervaloUs);
        if (baldeAnterior !== null && balde <= baldeAnterior) { medindo.descartes.ritmo += 1; return 'ritmo'; }
        if (codificador.encodeQueueSize >= FILA_MAXIMA_NO_CODIFICADOR) { medindo.descartes.codificador += 1; return 'codificador'; }
        // O portão de envio. Pular o quadro ANTES de codificar é o único descarte que não
        // quebra a cadeia de referências: jogar fora um quadro já codificado estragaria todos
        // os seguintes até o próximo quadro-chave. O portão diz POR QUE fechou -- a fila do
        // nosso ritmador ou o canal que não escoa --, porque só o segundo é a rede.
        const portao = podeEnviar();
        if (portao !== true) {
          const motivo = portao === 'fila' ? 'fila' : 'rede';
          medindo.descartes[motivo] += 1;
          return motivo;
        }
        baldeAnterior = balde;
        const agora = performance.now();
        const chave = precisaDeChave || agora - ultimaChave >= MS_ENTRE_CHAVES_PERIODICAS;
        if (chave) { precisaDeChave = false; ultimaChave = agora; }
        naFila.set(quadro.timestamp, { em: agora, relogioUs: Math.round((performance.timeOrigin + agora) * 1000), chavePedida: chave });
        if (naFila.size > 16) naFila.delete(naFila.keys().next().value);
        try { codificador.encode(quadro, { keyFrame: chave }); }
        catch (erro) { fechada = true; aoErro(erro); return 'fechada'; }
        return 'codificado';
      },

      pedirChave() {
        const agora = performance.now();
        if (agora - ultimaChavePedida < MS_ENTRE_CHAVES_PEDIDAS) return false;
        ultimaChavePedida = agora;
        precisaDeChave = true;
        return true;
      },

      // Trocar resolução, taxa ou orçamento sem recriar o codificador. Só o orçamento é
      // barato: mudar o tamanho produz um quadro-chave com configuração nova, e o receptor
      // reconfigura o decodificador ao vê-lo.
      reconfigurar(novo) {
        if (fechada) return;
        const tamanho = novo.largura !== atual.largura || novo.altura !== atual.altura || novo.quadros !== atual.quadros;
        if (!tamanho && novo.bitrate === atual.bitrate) return;
        atual = { largura: novo.largura, altura: novo.altura, bitrate: novo.bitrate, quadros: novo.quadros };
        config = configNoTamanho(escolha, config, atual);
        try { codificador.configure(config); }
        catch (erro) { fechada = true; aoErro(erro); return; }
        if (tamanho) { precisaDeChave = true; baldeAnterior = null; }
        else { reconfiguracoes.soDeBitrate += 1; reconfiguracaoSoDeBitrate = true; }
      },

      fecharJanela() {
        fecharJanela();
        return this.estatisticas();
      },

      estatisticas() {
        const j = ultimaJanela;
        const s = Math.max(j.segundos, 0.001);
        return {
          camada: id, codec: config.codec, hardware: escolha.hardware, perfil: escolha.perfil,
          taxaDeclarada: escolha.declararTaxa !== false,
          modoDeBitrate: escolha.modoDeBitrate || 'variable',
          largura: atual.largura, altura: atual.altura, quadrosAlvo: atual.quadros, bitrateAlvo: atual.bitrate,
          fps: j.codificados / s, bps: j.bytes * 8 / s, chaves: j.chaves,
          descartes: { ...j.descartes },
          quadrosNaJanela: j.codificados + j.descartes.codificador + j.descartes.fila + j.descartes.rede,
          msDeCodificacao: j.amostras ? j.msDeCodificacao / j.amostras : null,
          fila: codificador.encodeQueueSize,
          reconfiguracoes: { ...reconfiguracoes }
        };
      },

      fechar() {
        if (fechada) return;
        fechada = true;
        try { codificador.close(); } catch (_) { /* já fechado */ }
      }
    };
  }

  const api = { criarCaptura, criarCamada, escolherConfiguracao, sondarEnvio, podeCapturar, noBastidor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaCodificador = api;
})(typeof window === 'undefined' ? globalThis : window);
