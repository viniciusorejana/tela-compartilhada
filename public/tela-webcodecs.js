/* A tela por WebCodecs sobre faixas de dados do LiveKit: quem transmite e quem assiste.
 *
 * O desenho, em uma frase: a publicação RTP da tela CONTINUA existindo, como anúncio e como
 * reserva, e a imagem de verdade viaja numa faixa de dados codificada por nós.
 *
 * Manter o RTP é o que deixa o resto da sala intacto. "Fulano está compartilhando", o botão de
 * assistir, quem está vendo cada tela, a conferência do plano no servidor -- tudo isso lê a
 * publicação RTP, e nada disso precisou mudar. E ela não custa nada enquanto ninguém a assina:
 * o dynacast do servidor desliga as camadas que ninguém consome, então o codificador do WebRTC
 * fica parado. Quando o caminho novo sai do ar, por qualquer motivo, quem assiste volta a
 * assinar o RTP e a imagem continua de onde estava, sem ninguém clicar em nada.
 *
 * O caminho é decidido por transmissão, tudo ou nada (tela-decisoes.js), e a decisão é refeita
 * quando alguém entra, sai, muda o interruptor ou falha.
 *
 * Este módulo é do transporte. A interface não o conhece: ela continua lendo
 * `par.remoteStreams.screen`, e é room-transport.js quem decide qual das duas origens mora ali.
 */
(function (root) {
  const Quadro = root.NexoTelaQuadro;
  const Decisoes = root.NexoTelaDecisoes;
  const Codificador = root.NexoTelaCodificador;
  const Decodificador = root.NexoTelaDecodificador;

  const PREFIXO_DO_BOT = 'nexo-dj#';
  const PREFERENCIAS = ['automatico', 'sempre', 'desligada'];

  // Quem assiste avisa a cada segundo. Passado este tempo sem aviso, a pessoa fechou a aba,
  // perdeu a conexão ou parou de assistir sem conseguir dizer -- e a camada que só ela usava
  // não precisa continuar sendo codificada.
  const MS_ATE_ESQUECER_ESPECTADOR = 6000;
  // A camada sem ninguém continua ligada um pouco: trocar do palco para a grade e de volta é
  // corriqueiro, e cada religada custa um quadro-chave.
  const MS_ATE_DESLIGAR_CAMADA_VAZIA = 3000;
  const MS_ENTRE_PINGS = 10000;
  // O portão de envio: quanto pode esperar no buffer do canal antes de o quadro seguinte ser
  // pulado. É o "descartar em vez de acumular atraso" que o RTP fazia sozinho, e que o canal
  // de faixas de dados desta versão da biblioteca NÃO faz -- ele segura quem envia até ter
  // espaço, o que transformaria banda curta em atraso crescente.
  const SEGUNDOS_DE_BUFFER = 0.1;
  const BYTES_MINIMOS_DE_BUFFER = 48 * 1024;
  // Uma faixa de dados que não sai do ar em alguns segundos é uma resposta que não vem mais
  // (queda no meio do pedido). Sem prazo, a fila de mudanças de caminho travaria para sempre.
  const MS_DE_PRAZO_PARA_DESPUBLICAR = 3000;
  // Quantos quadros recentes cada camada guarda para reenviar. Três segundos a 30 quadros
  // cobrem com folga a espera de quem pede (no máximo 400 ms) mais a ida e volta.
  const QUADROS_GUARDADOS_PARA_REENVIO = 90;
  // Teto de reenvios por camada e por segundo. O reenvio vai para todo mundo que assiste a
  // camada; numa sala cheia de gente perdendo pacote, atender todo pedido multiplicaria o
  // tráfego exatamente quando ele menos cabe. Passado o teto, quem pediu cai no quadro-chave.
  const REENVIOS_POR_SEGUNDO = 60;
  // Depois de ligar ou redimensionar uma camada, os sinais de aperto ficam desligados por este
  // tempo. O codificador de hardware leva um instante para inicializar, e nesse instante a fila
  // enche -- sem esta espera, a própria partida parecia saturação, a imagem encolhia, o
  // encolhimento reconfigurava o codificador, que aquecia de novo: uma cascata que levou 1080p
  // a 864p na placa de vídeo sem aperto nenhum.
  const MS_DE_AQUECIMENTO = 3000;
  // Quanto dos quadros de uma janela precisa ter sido pulado para contar como aperto. Um
  // quadro-chave, sozinho, fecha o portão por um ou dois quadros enquanto escoa -- isso é o
  // quadro-chave, e não a rede.
  const FRACAO_PULADA_QUE_APERTA = 0.1;

  // Entre o aviso de fim e tirar as faixas de dados do ar. Cobre com folga a ida da mensagem e
  // o "solto" de quem assiste; é um atraso só na SAÍDA do caminho novo, e quem assiste já
  // voltou para o RTP no instante do aviso.
  const MS_ENTRE_O_AVISO_E_A_SAIDA = 300;

  const agoraMs = () => performance.timeOrigin + performance.now();
  const comPrazo = (promessa, ms) => Promise.race([promessa, new Promise(resolve => setTimeout(resolve, ms))]);
  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mediana = valores => {
    if (!valores.length) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    return ordenados[Math.floor(ordenados.length / 2)];
  };

  function criar({ sala, LK, querTela, camadaPedida, aoMudarTela, agendar, cancelar, repetir, registrar }) {
    const anotar = (evento, detalhe) => { try { registrar?.(evento, detalhe); } catch (_) { /* diagnóstico nunca derruba nada */ } };
    let preferencia = 'automatico';
    let desligadoPeloServidor = false;
    // Uma falha ao decodificar tira ESTE aparelho do caminho novo até recarregar: a sala
    // inteira volta ao caminho de hoje por causa dele, que é o tudo ou nada funcionando.
    let recebimentoFalhou = null;
    let conectado = false;
    let envio = null;
    let recebimento = null;
    const sondagens = Promise.all([Codificador.sondarEnvio(), Decodificador.sondarRecebimento()])
      .then(([e, r]) => { envio = e; recebimento = r; })
      .catch(() => { envio = { captura: false }; recebimento = { exibe: false }; });

    const capsRemotas = new Map();   // identidade → { dec, recebe }
    const chegadas = new Map();      // identidade → quando apareceu

    // ---------- Mensagens de controle ----------
    function enviar(tipo, dados, para) {
      if (!conectado || sala.state !== 'connected') return;
      let bytes;
      try { bytes = Quadro.mensagem(tipo, dados); } catch (_) { return; }
      const opcoes = { reliable: true, topic: Quadro.TOPICO };
      if (para) opcoes.destinationIdentities = [para];
      sala.localParticipant.publishData(bytes, opcoes).catch(() => { /* a próxima mensagem corrige */ });
    }

    function minhaCapacidade() {
      const dec = recebimento ? Quadro.CODECS_CONHECIDOS.filter(codec => recebimento[codec]) : [];
      const recebe = Boolean(recebimento?.exibe) && dec.length > 0
        && preferencia !== 'desligada' && !desligadoPeloServidor && !recebimentoFalhou;
      return { dec, recebe };
    }

    // A sala só entrega uma mensagem com remetente quando já conhece quem a mandou. O anúncio
    // que o recém-chegado faz ao entrar chega, nos outros, ANTES do aviso de entrada dele -- e
    // sai sem remetente, inútil. Por isso quem já está na sala pergunta (`pergunta`), e a
    // resposta vem quando os dois lados já se conhecem.
    async function anunciar(para, pergunta = false) {
      await sondagens;
      enviar('cap', { ...minhaCapacidade(), pergunta }, para);
    }

    // ========== Quem transmite ==========
    let transmissao = null;
    let filaDoCaminho = Promise.resolve();
    let timerDoCaminho = null;
    const geracoes = { alta: 0, baixa: 0 };
    const tetoPara = (l, a, q) => root.RoomQuality?.tetoDeEnvio?.(l, a, q) ?? Infinity;

    function participantesParaDecidir() {
      const lista = [];
      sala.remoteParticipants.forEach(p => {
        if (String(p.identity).startsWith(PREFIXO_DO_BOT)) return;
        lista.push({
          nome: p.name || String(p.identity).split('#')[0] || 'alguém',
          cap: capsRemotas.get(p.identity) || null,
          chegouEm: chegadas.get(p.identity) || 0
        });
      });
      return lista;
    }

    function reavaliarCaminho() {
      filaDoCaminho = filaDoCaminho.then(aplicarCaminho).catch(erro => console.error('tela-webcodecs:', erro));
      return filaDoCaminho;
    }

    // A nota da placa (ela não aceitou o tamanho pedido, e a imagem sobe um degrau abaixo) vai
    // junto do motivo enquanto o caminho novo estiver no ar: é o que explica, a quem pediu 1440p,
    // por que está saindo 1080p.
    function trocarMotivo(t, motivo) {
      t.motivoBase = motivo;
      const completo = t.modo === 'webcodecs' && t.notaDaPlaca ? `${motivo}; ${t.notaDaPlaca}` : motivo;
      if (t.motivo === completo) return;
      t.motivo = completo;
      anotar('tela.caminho', `${t.modo === 'webcodecs' ? `WebCodecs (${t.codec})` : 'RTP'}: ${completo}`);
    }

    async function aplicarCaminho() {
      const t = transmissao;
      if (!t) return;
      await sondagens;
      if (t !== transmissao) return;
      const decisao = conectado
        ? Decisoes.decidirModo({
          telaNoAr: true, desligadoPeloServidor, preferencia, envio, falha: t.falha,
          participantes: participantesParaDecidir(), modoAtual: t.modo,
          versaoDoServidor: sala.serverInfo?.version || null
        })
        : { modo: 'rtp', codec: null, motivo: 'sem conexão com o servidor de mídia', aguardando: false };
      if (decisao.aguardando) {
        cancelar(timerDoCaminho);
        timerDoCaminho = agendar(() => { timerDoCaminho = null; reavaliarCaminho(); }, 1000);
      }
      if (decisao.modo === t.modo && decisao.codec === t.codec) { trocarMotivo(t, decisao.motivo); return; }
      // O motivo muda no MESMO instante que o caminho: quem lê um sem o outro (o Diagnóstico,
      // o painel de medições) não pode ver "WebRTC" ao lado do motivo de estar em WebCodecs.
      if (t.modo === 'webcodecs') await sairDoWebCodecs(t, decisao.modo === 'rtp' ? decisao.motivo : 'trocando de codec');
      if (decisao.modo === 'webcodecs' && t === transmissao) {
        if (!(await entrarNoWebCodecs(t, decisao.codec, decisao.motivo))) {
          // A falha ficou anotada na transmissão; a próxima decisão a lê e fica no RTP,
          // dizendo por quê.
          if (t === transmissao) reavaliarCaminho();
          return;
        }
      }
      trocarMotivo(t, decisao.motivo);
    }

    // O alvo de cada camada. O da cheia é o que foi pedido, a não ser que a placa só tenha
    // aceitado um degrau abaixo (`limiteDaPlaca`, ver `escolherCodificadores`).
    function alvoDaCamada(t, camada) {
      const p = t.parametros;
      if (camada === 'alta') {
        const limite = t.limiteDaPlaca;
        if (limite) {
          return {
            largura: limite.largura, altura: limite.altura, quadros: limite.quadros,
            bitrateMax: Math.min(p.bitrateMax, tetoPara(limite.largura, limite.altura, limite.quadros)), bitrateMin: 300_000
          };
        }
        return { largura: p.largura, altura: p.altura, quadros: p.quadros, bitrateMax: p.bitrateMax, bitrateMin: 300_000 };
      }
      return {
        largura: p.baixa.largura, altura: p.baixa.altura, quadros: Math.min(p.baixa.quadros, p.quadros),
        bitrateMax: p.baixa.bitrate, bitrateMin: 100_000
      };
    }

    // O tamanho de partida de cada camada: a fonte encaixada no alvo, sem distorcer. Encaixar
    // antes, e não deixar os degraus da escala fazerem isso, importa: um monitor de 1440p com
    // perfil de 1080p cairia no degrau de 1,5 (960p) quando o que cabe é exatamente 1080p.
    function fonteDaCamada(t, camada) {
      const alvo = alvoDaCamada(t, camada);
      return Decisoes.caberNaCaixa(t.fonte, { largura: alvo.largura, altura: alvo.altura });
    }

    const emTexto = d => `${d.altura}p a ${d.quadros} quadros`;

    // Qual configuração cada camada usa. Devolve `null` quando deu certo, ou o motivo de não
    // ter dado.
    //
    // A camada cheia procura a placa de vídeo primeiro, em TODAS as preferências, descendo a
    // escada de `degrausDaPlaca` se o pedido não couber nela. Só depois, e só no "Sempre
    // ligada", aceita o processador no tamanho cheio. O automático nunca aceita o processador
    // na cheia: sem a placa, o caminho novo custaria o mesmo processador que o de hoje e
    // perderia o que o RTP dá de graça.
    //
    // A camada de 360p aceita o processador sempre: ali o custo é pequeno, e a placa pode não
    // ter sessão sobrando (as de consumo limitam quantas codificações simultâneas fazem).
    async function escolherCodificadores(t, codec) {
      const pedido = { largura: t.parametros.largura, altura: t.parametros.altura, quadros: t.parametros.quadros };
      let escolhaAlta = null;
      let limite = null;
      for (const degrau of Decisoes.degrausDaPlaca(pedido, t.parametros.prioridade)) {
        const bitrate = Math.min(t.parametros.bitrateMax, tetoPara(degrau.largura, degrau.altura, degrau.quadros));
        escolhaAlta = await Codificador.escolherConfiguracao({ codec, ...degrau, bitrate, somenteHardware: true });
        if (escolhaAlta) {
          const reduzido = degrau.altura !== pedido.altura || degrau.quadros !== pedido.quadros;
          limite = reduzido ? degrau : null;
          break;
        }
      }
      if (!escolhaAlta && preferencia === 'sempre') {
        escolhaAlta = await Codificador.escolherConfiguracao({ codec, ...pedido, bitrate: t.parametros.bitrateMax, somenteHardware: false });
      }
      if (!escolhaAlta) {
        return preferencia === 'sempre'
          ? `o codificador recusou ${emTexto(pedido)}, na placa e no processador`
          : `a placa de vídeo recusou ${emTexto(pedido)} e os degraus abaixo`;
      }
      const baixa = alvoDaCamada({ ...t, limiteDaPlaca: null }, 'baixa');
      const escolhaBaixa = await Codificador.escolherConfiguracao({ codec, largura: baixa.largura, altura: baixa.altura, quadros: baixa.quadros, bitrate: baixa.bitrateMax, somenteHardware: false });
      t.escolhas = { alta: escolhaAlta, baixa: escolhaBaixa };
      t.limiteDaPlaca = limite;
      t.notaDaPlaca = limite ? `a placa não aceita ${emTexto(pedido)}, então a imagem cheia sobe em ${emTexto(limite)}` : null;
      if (limite) anotar('tela.placa', t.notaDaPlaca);
      return null;
    }

    async function entrarNoWebCodecs(t, codec, motivo) {
      const recusa = await escolherCodificadores(t, codec);
      if (recusa) { t.falha = recusa; return false; }
      if (t !== transmissao) return false;
      const escolhaAlta = t.escolhas.alta;
      const escolhaBaixa = t.escolhas.baixa;
      const camadas = escolhaBaixa ? ['alta', 'baixa'] : ['alta'];
      try {
        for (const camada of camadas) {
          t.faixasDeDados.set(camada, await sala.localParticipant.publishDataTrack({ name: Quadro.nomeDaFaixa(camada) }));
        }
      } catch (erro) {
        const faixas = [...t.faixasDeDados.values()];
        t.faixasDeDados.clear();
        await tirarFaixas(faixas);
        t.falha = `o servidor de mídia recusou a faixa de dados (${erro?.reasonName || erro?.message || erro})`;
        return false;
      }
      if (t !== transmissao) {
        const faixas = [...t.faixasDeDados.values()];
        t.faixasDeDados.clear();
        await tirarFaixas(faixas);
        return false;
      }
      t.modo = 'webcodecs';
      t.codec = codec;
      trocarMotivo(t, motivo);
      anotar('tela.webcodecs', `${codec.toUpperCase()} ${escolhaAlta.hardware ? 'pela placa' : 'no processador'} · ${escolhaAlta.config.codec}`
        + `${escolhaAlta.declararTaxa ? '' : ' · taxa não declarada (a placa só aceita assim)'}${escolhaBaixa ? '' : ' · sem camada de 360p'}`);
      return true;
    }

    async function sairDoWebCodecs(t, motivo) {
      for (const camada of [...t.camadas.keys()]) pararCodificacao(t, camada);
      pararCaptura(t);
      const faixas = [...t.faixasDeDados.values()];
      t.faixasDeDados.clear();
      t.espectadores.clear();
      t.modo = 'rtp';
      t.codec = null;
      t.limiteDaPlaca = null;
      t.notaDaPlaca = null;
      trocarMotivo(t, motivo);
      await tirarFaixas(faixas);
    }

    // Avisa, espera, e só então tira. Ver `fim` em tela-quadro.js: sem o aviso, quem estivesse
    // assinando uma faixa no instante da remoção ficaria com a sinalização travada no servidor
    // 1.13.6 -- e sem imagem nenhuma, porque nem a volta para o RTP seria atendida.
    async function tirarFaixas(faixas) {
      if (!faixas.length) return;
      enviar('fim', {});
      await esperar(MS_ENTRE_O_AVISO_E_A_SAIDA);
      await Promise.all(faixas.map(f => comPrazo(f.unpublish().catch(() => {}), MS_DE_PRAZO_PARA_DESPUBLICAR)));
    }

    function garantirCaptura(t) {
      if (t.captura) return true;
      t.captura = Codificador.criarCaptura(t.faixa, quadro => aoQuadro(t, quadro));
      if (!t.captura) { falhar(t, 'este navegador não entrega os quadros da tela ao codificador'); return false; }
      return true;
    }

    function pararCaptura(t) {
      t.captura?.parar();
      t.captura = null;
    }

    function aoQuadro(t, quadro) {
      if (t !== transmissao) return;
      // A fonte mudou de tamanho: janela redimensionada, ou outra tela escolhida. As camadas
      // recomeçam a conta a partir do tamanho novo, em vez de esticar a imagem velha.
      if (quadro.displayWidth !== t.fonte.largura || quadro.displayHeight !== t.fonte.altura) {
        t.fonte = { largura: quadro.displayWidth, altura: quadro.displayHeight };
        for (const [camada, c] of t.camadas) {
          c.estado = Decisoes.iniciarCamada({ fonte: fonteDaCamada(t, camada), alvo: alvoDaCamada(t, camada), prioridade: t.parametros.prioridade, tetoPara });
          c.codificador.reconfigurar(c.estado);
          c.aquecendoAte = Date.now() + MS_DE_AQUECIMENTO;
        }
      }
      for (const c of t.camadas.values()) c.codificador.codificar(quadro);
    }

    function iniciarCodificacao(t, camada) {
      if (t.camadas.has(camada) || !t.escolhas?.[camada] || !t.faixasDeDados.has(camada)) return;
      if (!garantirCaptura(t)) return;
      const estado = Decisoes.iniciarCamada({ fonte: fonteDaCamada(t, camada), alvo: alvoDaCamada(t, camada), prioridade: t.parametros.prioridade, tetoPara });
      geracoes[camada] = (geracoes[camada] + 1) & 0xffff;
      let codificador;
      try {
        codificador = Codificador.criarCamada({
          id: camada, escolha: t.escolhas[camada], estado, geracao: geracoes[camada],
          podeEnviar: () => podeEnviar(t),
          aoSaida: saida => enviarQuadro(t, saida),
          aoErro: erro => falhar(t, `o codificador da camada ${camada} falhou: ${erro?.message || erro}`)
        });
      } catch (erro) {
        falhar(t, `o codificador da camada ${camada} não abriu: ${erro?.message || erro}`);
        return;
      }
      t.camadas.set(camada, {
        codificador, estado, geracao: geracoes[camada], vaziaDesde: 0, sinais: null, ultima: null,
        aquecendoAte: Date.now() + MS_DE_AQUECIMENTO, redeNaJanelaAnterior: false,
        recentes: new Map(), reenviados: 0, reenviosNaJanela: 0, janelaDeReenvio: 0
      });
      anotar('tela.camada', `${camada} ligada em ${estado.largura}×${estado.altura} a ${estado.quadros} quadros`);
    }

    function pararCodificacao(t, camada) {
      const c = t.camadas.get(camada);
      if (!c) return;
      c.codificador.fechar();
      t.camadas.delete(camada);
    }

    function canalDaTela() {
      // Campo interno da biblioteca, e por isso lido com cuidado: sem ele o portão fica aberto
      // e sobra só a contrapressão da própria biblioteca. A versão está travada no
      // package-lock, e o teste de navegador acusa se o campo sumir numa atualização.
      try { return sala.engine?.dataChannels?.dataTrack?.channelHandle || null; } catch (_) { return null; }
    }

    // ---------- Simulações, para diagnóstico ----------
    //
    // Perda e banda curta são exatamente onde este caminho tende a ser pior que o RTP (o plano
    // pede medir 1%, 5% e 10%), e são as duas coisas mais difíceis de produzir de propósito numa
    // rede de casa. Pelo console:
    //   transporte.telaWebCodecs.simularPerda(0.05)   descarta 5% dos PACOTES recebidos
    //   transporte.telaWebCodecs.simularAperto(0.5)   o portão de envio recusa metade dos quadros
    // Zero desliga. Nenhuma das duas é chamada pela sala.
    let apertoSimulado = 0;
    let perdaSimulada = 0;
    let perdaInstalada = false;
    function instalarPerdaSimulada() {
      // Por pacote, e não por quadro: um quadro-chave tem vários pacotes, e perder qualquer um
      // perde o quadro inteiro. Simular por quadro esconderia justamente o efeito que importa.
      const gerente = sala.incomingDataTrackManager;
      if (perdaInstalada || typeof gerente?.packetReceived !== 'function') return perdaInstalada;
      const original = gerente.packetReceived.bind(gerente);
      gerente.packetReceived = bytes => (perdaSimulada > 0 && Math.random() < perdaSimulada ? undefined : original(bytes));
      perdaInstalada = true;
      return true;
    }

    function podeEnviar(t) {
      if (apertoSimulado > 0 && Math.random() < apertoSimulado) return false;
      const canal = canalDaTela();
      if (!canal) return true;
      let bps = 0;
      for (const c of t.camadas.values()) bps += c.estado.bitrate;
      return canal.bufferedAmount <= Math.max(BYTES_MINIMOS_DE_BUFFER, (bps / 8) * SEGUNDOS_DE_BUFFER);
    }

    function enviarQuadro(t, saida) {
      if (t !== transmissao) return;
      const faixa = t.faixasDeDados.get(saida.camada);
      if (!faixa) return;
      let payload;
      try { payload = Quadro.montar(saida); } catch (_) { return; }
      t.bytesEnviados += payload.byteLength;
      const c = t.camadas.get(saida.camada);
      if (c) {
        c.recentes.set(saida.sequencia, { payload, capturaUs: saida.capturaUs });
        if (c.recentes.size > QUADROS_GUARDADOS_PARA_REENVIO) c.recentes.delete(c.recentes.keys().next().value);
      }
      empurrar(t, faixa, payload, saida.capturaUs);
    }

    function empurrar(t, faixa, payload, capturaUs) {
      try {
        faixa.tryPush({ payload, userTimestamp: BigInt(capturaUs) }).catch(() => { t.envioRecusado += 1; });
      } catch (_) { t.envioRecusado += 1; }
    }

    // O pedido de reenvio de quem assiste. Só da geração que ainda está no ar: a sequência
    // recomeça a cada geração, e reenviar o número certo da geração errada entregaria o quadro
    // errado. E só com o portão aberto: reenviar numa saída já apertada é o que a apertaria de
    // vez.
    function reenviar(mensagem) {
      const t = transmissao;
      const c = t?.camadas.get(mensagem.camada);
      const faixa = t?.faixasDeDados.get(mensagem.camada);
      if (!c || !faixa || c.geracao !== mensagem.geracao || !podeEnviar(t)) return;
      const agora = Date.now();
      if (agora - c.janelaDeReenvio >= 1000) { c.janelaDeReenvio = agora; c.reenviosNaJanela = 0; }
      for (let sequencia = mensagem.de; sequencia <= mensagem.ate; sequencia++) {
        if (c.reenviosNaJanela >= REENVIOS_POR_SEGUNDO) return;
        const guardado = c.recentes.get(sequencia);
        if (!guardado) continue;
        empurrar(t, faixa, guardado.payload, guardado.capturaUs);
        c.reenviados += 1;
        c.reenviosNaJanela += 1;
      }
    }

    function falhar(t, motivo) {
      if (t !== transmissao || t.falha) return;
      t.falha = motivo;
      anotar('tela.falhou', motivo);
      reavaliarCaminho();
    }

    // ---------- Quem está assistindo ----------
    // Vale assim que a faixa DAQUELA camada existe, e não só depois de o caminho inteiro subir:
    // as faixas são publicadas uma de cada vez, e quem assiste pede a primeira no instante em
    // que ela aparece -- antes de a segunda terminar de subir.
    function registrarEspectador(de, mensagem) {
      const t = transmissao;
      if (!t || !t.faixasDeDados.has(mensagem.camada)) return;
      if (!t.espectadores.has(de)) t.espectadores.set(de, new Map());
      const porCamada = t.espectadores.get(de);
      const novo = !porCamada.has(mensagem.camada);
      const registro = porCamada.get(mensagem.camada) || {};
      registro.visto = Date.now();
      if (mensagem.tipo === 'relato') registro.relato = mensagem;
      porCamada.set(mensagem.camada, registro);
      if (mensagem.tipo === 'quero' || novo) {
        iniciarCodificacao(t, mensagem.camada);
        // Quem acabou de chegar precisa de um ponto de partida agora, e não no próximo
        // quadro-chave periódico, quinze segundos depois.
        t.camadas.get(mensagem.camada)?.codificador.pedirChave();
      }
    }

    function soltarEspectador(de, camada) {
      transmissao?.espectadores.get(de)?.delete(camada);
    }

    function lerSaidaDisponivel(t) {
      const publicador = sala.engine?.pcManager?.publisher;
      if (typeof publicador?.getStats !== 'function') return;
      Promise.resolve(publicador.getStats()).then(stats => {
        stats?.forEach(item => {
          if (item.type === 'candidate-pair' && item.nominated && Number.isFinite(item.availableOutgoingBitrate)) {
            t.saidaDisponivel = item.availableOutgoingBitrate;
          }
        });
      }).catch(() => {});
    }

    function pararTransmissao() {
      const t = transmissao;
      if (!t) return;
      transmissao = null;
      cancelar(timerDoCaminho);
      timerDoCaminho = null;
      for (const camada of [...t.camadas.keys()]) pararCodificacao(t, camada);
      pararCaptura(t);
      const faixas = [...t.faixasDeDados.values()];
      t.faixasDeDados.clear();
      // Na fila: uma transmissão nova logo em seguida publica faixas com os MESMOS nomes, e o
      // servidor recusa nome repetido enquanto a antiga não saiu.
      filaDoCaminho = filaDoCaminho.then(() => tirarFaixas(faixas)).catch(() => {});
    }

    function passoDoEnvio() {
      const t = transmissao;
      if (!t || t.modo !== 'webcodecs') return;
      const agora = Date.now();
      for (const [id, porCamada] of t.espectadores) {
        for (const [camada, registro] of porCamada) if (agora - registro.visto > MS_ATE_ESQUECER_ESPECTADOR) porCamada.delete(camada);
        if (!porCamada.size) t.espectadores.delete(id);
      }
      for (const camada of Quadro.CAMADAS) {
        const alguemQuer = [...t.espectadores.values()].some(porCamada => porCamada.has(camada));
        const c = t.camadas.get(camada);
        if (alguemQuer && !c) iniciarCodificacao(t, camada);
        else if (!alguemQuer && c) {
          c.vaziaDesde ||= agora;
          if (agora - c.vaziaDesde > MS_ATE_DESLIGAR_CAMADA_VAZIA) {
            pararCodificacao(t, camada);
            anotar('tela.camada', `${camada} desligada: ninguém assistindo`);
          }
        } else if (c) c.vaziaDesde = 0;
      }
      // Ninguém assistindo, nada codificando: nem a captura precisa ler quadros. É o dynacast
      // do caminho novo, e é o que mantém o custo zero quando a tela está só anunciada.
      if (!t.camadas.size) pararCaptura(t);

      // A disponibilidade de saída que o WebRTC estima fica no Diagnóstico, e só lá. Ela é
      // medida pelo controle de congestionamento do RTP, que não vê o tráfego da faixa de
      // dados -- e com as camadas RTP da tela paradas, ela reflete só câmera e voz. Usá-la como
      // teto derrubaria a tela para o tamanho do microfone.
      if (agora - (t.saidaLidaEm || 0) > 2000) { t.saidaLidaEm = agora; lerSaidaDisponivel(t); }

      for (const [camada, c] of t.camadas) {
        const s = c.codificador.fecharJanela();
        const perdas = [];
        for (const porCamada of t.espectadores.values()) {
          const r = porCamada.get(camada)?.relato;
          if (r && r.recebidos + r.perdidos > 0) perdas.push(r.perdidos / (r.recebidos + r.perdidos));
        }
        // A MEDIANA de quem assiste, e não o pior. Um espectador com a rede ruim desce sozinho
        // para a camada leve; se a camada inteira cedesse por ele, todo mundo pagaria pela
        // conexão de uma pessoa.
        //
        // Os apertos precisam de evidência: uma fração dos quadros pulada numa janela, ou pulos
        // em duas janelas seguidas -- nunca um pulo isolado. E nada conta durante o aquecimento
        // (MS_DE_AQUECIMENTO).
        const aquecendo = agora < c.aquecendoAte;
        const fracao = n => (s.quadrosNaJanela > 0 ? n / s.quadrosNaJanela : 0);
        const redeAgora = s.descartes.rede > 0;
        const sinais = {
          saidaApertada: !aquecendo && (fracao(s.descartes.rede) > FRACAO_PULADA_QUE_APERTA || (redeAgora && c.redeNaJanelaAnterior)),
          perda: aquecendo ? 0 : mediana(perdas),
          codificadorApertado: !aquecendo && fracao(s.descartes.codificador) > FRACAO_PULADA_QUE_APERTA
        };
        c.redeNaJanelaAnterior = redeAgora;
        const novo = Decisoes.ajustarCamada(c.estado, sinais, tetoPara);
        const mudouTamanho = novo.largura !== c.estado.largura || novo.altura !== c.estado.altura || novo.quadros !== c.estado.quadros;
        if (mudouTamanho || novo.bitrate !== c.estado.bitrate) c.codificador.reconfigurar(novo);
        if (mudouTamanho) {
          c.aquecendoAte = agora + MS_DE_AQUECIMENTO;
          anotar('tela.adaptacao', `${camada}: ${novo.largura}×${novo.altura} a ${novo.quadros} quadros (${novo.ultimaMudanca || 'ajuste'})`);
        }
        c.estado = novo;
        c.sinais = sinais;
        c.ultima = s;
      }
    }

    // ========== Quem assiste ==========
    const telas = new Map();   // identidade de quem transmite → estado da recepção
    let bytesDeRecepcoesEncerradas = 0;

    function telaDe(id) {
      if (!telas.has(id)) telas.set(id, { id, faixas: new Map(), recepcao: null, relogio: [], desvio: null, rtt: null, adaptacao: {}, ultimaJanela: null, ultimoPing: 0, bytesLidos: 0 });
      return telas.get(id);
    }

    // `encerrando`: quem transmite avisou que vai tirar as faixas (ou uma delas já sumiu). Até
    // elas saírem de vez, nada é assinado -- assinar uma faixa no instante em que ela é removida
    // é o que trava a sinalização no servidor 1.13.6.
    const podeUsar = tela => Boolean(tela && tela.faixas.size && !tela.encerrando && minhaCapacidade().recebe);

    function falharRecebimento(motivo) {
      if (recebimentoFalhou) return;
      recebimentoFalhou = motivo;
      anotar('tela.recebimentoFalhou', motivo);
      anunciar();
      for (const tela of telas.values()) encerrarRecepcao(tela);
    }

    function iniciarRecepcao(tela) {
      try {
        const recepcao = { assinaturas: new Map(), comImagem: false, iniciadaEm: Date.now(), decodificador: null };
        recepcao.decodificador = Decodificador.criarDecodificador({
          aoPedirChave: camada => enviar('chave', { camada }, tela.id),
          aoPedirReenvio: (camada, geracao, de, ate) => enviar('reenvio', { camada, geracao, de, ate }, tela.id),
          // Uma ida e volta e meia, com folga para o quadro sair da fila de quem envia. Sem a
          // medida ainda (o primeiro ping não voltou), 150 ms cobrem uma rede comum.
          esperaPorReenvioMs: () => (Number.isFinite(tela.rtt) ? tela.rtt * 1.5 + 40 : 150),
          aoFalhar: erro => falharRecebimento(`a tela não pôde ser decodificada aqui: ${erro?.message || erro}`),
          aoPrimeiraImagem: () => {
            if (tela.recepcao !== recepcao) return;
            recepcao.comImagem = true;
            anotar('tela.recebendo', `${tela.id}: primeira imagem por WebCodecs em ${Date.now() - recepcao.iniciadaEm} ms`);
            aoMudarTela(tela.id);
          },
          desvioDoRelogioMs: () => tela.desvio
        });
        tela.recepcao = recepcao;
        pingar(tela);
      } catch (erro) {
        falharRecebimento(`este aparelho não monta a imagem recebida: ${erro?.message || erro}`);
      }
    }

    function assinar(tela, camada) {
      const faixa = tela.faixas.get(camada);
      const recepcao = tela.recepcao;
      if (!faixa || !recepcao) return;
      // Um quadro pode começar a chegar antes do anterior terminar: o canal não garante ordem.
      // Com o padrão da biblioteca (um quadro parcial por vez), isso descartaria o anterior
      // inteiro. Oito cobre a sobreposição de uma rede real com folga, e cada quadro parcial é
      // só um mapa de pedaços.
      try { faixa.setPipelineOptions({ maxPartialFrames: 8 }); } catch (_) { /* versão sem a opção */ }
      const controle = new AbortController();
      let leitor;
      try { leitor = faixa.subscribe({ signal: controle.signal, bufferSize: 32 }).getReader(); }
      catch (erro) { anotar('tela.assinaturaFalhou', erro?.message || String(erro)); return; }
      const assinatura = { camada, controle };
      recepcao.assinaturas.set(camada, assinatura);
      enviar('quero', { camada }, tela.id);
      (async () => {
        for (;;) {
          let lido;
          try { lido = await leitor.read(); } catch (_) { break; }
          if (lido.done) break;
          const bruto = lido.value;
          const envelope = Quadro.ler(bruto.payload);
          if (!envelope || envelope.camada !== camada || tela.recepcao !== recepcao) continue;
          recepcao.decodificador.receber(envelope, bruto.userTimestamp !== undefined ? Number(bruto.userTimestamp) : 0, bruto.payload.byteLength);
        }
        if (recepcao.assinaturas.get(camada) === assinatura) recepcao.assinaturas.delete(camada);
      })();
    }

    function soltar(tela, camada, avisar) {
      const assinatura = tela.recepcao?.assinaturas.get(camada);
      if (!assinatura) return;
      tela.recepcao.assinaturas.delete(camada);
      try { assinatura.controle.abort(); } catch (_) { /* já encerrada */ }
      if (avisar) enviar('solto', { camada }, tela.id);
    }

    function encerrarRecepcao(tela) {
      const recepcao = tela.recepcao;
      if (!recepcao) return;
      for (const camada of [...recepcao.assinaturas.keys()]) soltar(tela, camada, true);
      bytesDeRecepcoesEncerradas += Math.max(0, recepcao.decodificador.estatisticas().totais.bytes - tela.bytesLidos);
      tela.bytesLidos = 0;
      tela.recepcao = null;
      recepcao.decodificador.fechar();
      aoMudarTela(tela.id);
    }

    function pingar(tela) {
      tela.ultimoPing = Date.now();
      enviar('ping', { enviadoEm: agoraMs() }, tela.id);
    }

    // O relógio de quem transmite, trazido para o daqui: um ping/pong à moda do NTP, guardando
    // a amostra de menor ida e volta -- é a que menos esconde fila de rede no meio.
    function acertarRelogio(de, mensagem) {
      const tela = telas.get(de);
      if (!tela) return;
      const ida = agoraMs() - mensagem.enviadoEm;
      if (ida < 0 || ida > 10000) return;
      tela.relogio.push({ ida, desvio: mensagem.respondidoEm - (mensagem.enviadoEm + ida / 2) });
      if (tela.relogio.length > 6) tela.relogio.shift();
      const melhor = tela.relogio.reduce((a, b) => (b.ida < a.ida ? b : a));
      tela.desvio = melhor.desvio;
      tela.rtt = melhor.ida;
    }

    // Chamada pelo transporte sempre que algo que decide o recebimento muda: começou ou parou
    // de assistir, a aba escondeu, o palco mudou, a faixa de dados apareceu ou sumiu.
    function sincronizar(id) {
      const tela = telas.get(id);
      if (!tela) return;
      if (!podeUsar(tela) || !querTela(id)) { encerrarRecepcao(tela); return; }
      if (!tela.recepcao) iniciarRecepcao(tela);
      const recepcao = tela.recepcao;
      if (!recepcao) return;
      const janela = tela.ultimaJanela;
      tela.adaptacao = Decisoes.camadaDoEspectador(tela.adaptacao, {
        pedida: camadaPedida(id), perda: janela?.perda || 0, pedidosDeChave: janela?.pedidosPorBuraco || 0
      });
      let camada = tela.adaptacao.camada;
      if (!tela.faixas.has(camada)) camada = tela.faixas.has('alta') ? 'alta' : 'baixa';
      recepcao.decodificador.definirCamada(camada);
      if (!recepcao.assinaturas.has(camada)) assinar(tela, camada);
      // A camada antiga só é solta depois que a nova já está na tela.
      if (recepcao.decodificador.camadaAtiva === camada) {
        for (const outra of [...recepcao.assinaturas.keys()]) if (outra !== camada) soltar(tela, outra, true);
      }
    }

    function passoDoRecebimento() {
      for (const tela of telas.values()) {
        const recepcao = tela.recepcao;
        if (!recepcao) continue;
        recepcao.decodificador.vigiar();
        const janela = recepcao.decodificador.fecharJanela();
        tela.ultimaJanela = janela;
        // Um relato por camada assinada. Ele é também o "continuo aqui": quem transmite
        // desliga a camada de quem para de relatar.
        for (const camada of recepcao.assinaturas.keys()) {
          enviar('relato', {
            camada, recebidos: janela.recebidos, perdidos: janela.perdidos, decodificados: janela.decodificados,
            pedidosDeChave: janela.pedidosDeChave, bytes: janela.bytesNaJanela,
            atrasoMs: Number.isFinite(janela.atrasoMs) ? janela.atrasoMs : null
          }, tela.id);
        }
        if (Date.now() - tela.ultimoPing > MS_ENTRE_PINGS) pingar(tela);
        sincronizar(tela.id);
      }
    }

    // ========== Eventos da sala ==========
    sala
      .on(LK.RoomEvent.DataReceived, (payload, participante, _tipo, topico) => {
        if (topico !== Quadro.TOPICO || !participante) return;
        const mensagem = Quadro.lerMensagem(payload);
        if (!mensagem) return;
        const de = participante.identity;
        switch (mensagem.tipo) {
          case 'cap':
            capsRemotas.set(de, { dec: mensagem.dec, recebe: mensagem.recebe });
            if (mensagem.pergunta) anunciar(de);
            if (transmissao) reavaliarCaminho();
            break;
          case 'quero':
          case 'relato':
            registrarEspectador(de, mensagem);
            break;
          case 'solto':
            soltarEspectador(de, mensagem.camada);
            break;
          case 'chave':
            transmissao?.camadas.get(mensagem.camada)?.codificador.pedirChave();
            break;
          case 'reenvio':
            reenviar(mensagem);
            break;
          case 'fim': {
            const tela = telas.get(de);
            if (!tela) break;
            tela.encerrando = true;
            encerrarRecepcao(tela);
            break;
          }
          case 'ping':
            enviar('pong', { enviadoEm: mensagem.enviadoEm, respondidoEm: agoraMs() }, de);
            break;
          case 'pong':
            acertarRelogio(de, mensagem);
            break;
        }
      })
      .on(LK.RoomEvent.ParticipantConnected, participante => {
        chegadas.set(participante.identity, Date.now());
        capsRemotas.delete(participante.identity);
        anunciar(participante.identity, true);
        if (transmissao) {
          reavaliarCaminho();
          // Se a pessoa não se apresentar dentro da folga, a decisão precisa ser refeita sem
          // depender de nenhum evento chegar.
          agendar(reavaliarCaminho, Decisoes.MS_DE_FOLGA_PARA_SE_APRESENTAR + 200);
        }
      })
      .on(LK.RoomEvent.ParticipantDisconnected, participante => {
        const id = participante.identity;
        capsRemotas.delete(id);
        chegadas.delete(id);
        transmissao?.espectadores.delete(id);
        const tela = telas.get(id);
        if (tela) { encerrarRecepcao(tela); telas.delete(id); }
        if (transmissao) reavaliarCaminho();
      })
      .on(LK.RoomEvent.DataTrackPublished, faixa => {
        const camada = Quadro.camadaDaFaixa(faixa?.info?.name);
        if (!camada) return;
        const tela = telaDe(faixa.publisherIdentity);
        tela.faixas.set(camada, faixa);
        tela.encerrando = false;
        sincronizar(tela.id);
        aoMudarTela(tela.id);
      })
      // As camadas saem juntas. Uma sumir é a transmissão mudando de caminho, e a reação é
      // largar tudo de uma vez -- NUNCA recuar para a outra camada, que é a próxima a sumir.
      // Foi assinando a camada de 360p no instante em que ela era removida que a sinalização de
      // quem assistia travou no servidor.
      .on(LK.RoomEvent.DataTrackUnpublished, sid => {
        for (const tela of telas.values()) {
          for (const [camada, faixa] of tela.faixas) {
            if (faixa.info?.sid !== sid) continue;
            tela.faixas.delete(camada);
            soltar(tela, camada, false);
            tela.encerrando = tela.faixas.size > 0;
            encerrarRecepcao(tela);
            aoMudarTela(tela.id);
            return;
          }
        }
      });

    repetir(() => {
      try { passoDoEnvio(); } catch (erro) { console.error('tela-webcodecs (envio):', erro); }
      try { passoDoRecebimento(); } catch (erro) { console.error('tela-webcodecs (recebimento):', erro); }
    }, 1000);

    return {
      // ---------- Configuração ----------
      definirPreferencia(valor) {
        if (!PREFERENCIAS.includes(valor) || valor === preferencia) return;
        preferencia = valor;
        anunciar();
        // Mudar o interruptor é tentar de novo: a falha anterior não vale para a escolha nova.
        if (transmissao) { transmissao.falha = null; reavaliarCaminho(); }
        for (const id of telas.keys()) { sincronizar(id); aoMudarTela(id); }
      },
      get preferencia() { return preferencia; },

      definirDesligadoPeloServidor(desligado) {
        desligado = Boolean(desligado);
        if (desligado === desligadoPeloServidor) return;
        desligadoPeloServidor = desligado;
        anotar('tela.servidor', desligado ? 'caminho novo desligado para todo mundo' : 'caminho novo liberado');
        anunciar();
        if (transmissao) reavaliarCaminho();
        for (const id of telas.keys()) { sincronizar(id); aoMudarTela(id); }
      },
      get desligadoPeloServidor() { return desligadoPeloServidor; },

      // ---------- Ciclo da conexão ----------
      aoConectar() {
        conectado = true;
        const agora = Date.now();
        sala.remoteParticipants.forEach(p => { if (!chegadas.has(p.identity)) chegadas.set(p.identity, agora); });
        anunciar();
        if (transmissao) {
          reavaliarCaminho();
          agendar(reavaliarCaminho, Decisoes.MS_DE_FOLGA_PARA_SE_APRESENTAR + 200);
        }
      },

      // A biblioteca retomou a sessão sem trocar de conexão: as faixas de dados sobrevivem (ela
      // as republica sozinha), mas mensagens podem ter se perdido no meio.
      aoRetomar() {
        anunciar();
        for (const tela of telas.values()) {
          for (const camada of tela.recepcao?.assinaturas.keys() || []) enviar('quero', { camada }, tela.id);
        }
        if (transmissao) reavaliarCaminho();
      },

      // A sessão caiu. A biblioteca já zerou as faixas de dados dos dois lados; aqui se desfaz o
      // que era nosso, sem esperar resposta de um servidor que não está mais lá.
      aoDesconectar() {
        conectado = false;
        for (const tela of telas.values()) encerrarRecepcao(tela);
        telas.clear();
        capsRemotas.clear();
        chegadas.clear();
        const t = transmissao;
        if (t && t.modo === 'webcodecs') {
          for (const camada of [...t.camadas.keys()]) pararCodificacao(t, camada);
          pararCaptura(t);
          t.faixasDeDados.clear();
          t.espectadores.clear();
          t.modo = 'rtp';
          t.codec = null;
          trocarMotivo(t, 'sem conexão com o servidor de mídia');
        }
      },

      // ---------- Quem transmite ----------
      // Chamada toda vez que a tela é (re)publicada. Mesma faixa com parâmetros novos --
      // qualidade, quadros, prioridade -- não derruba nada: as camadas recomeçam no alvo novo.
      transmitir(faixa, parametros) {
        if (!faixa || faixa.readyState === 'ended') return;
        if (transmissao && transmissao.faixa === faixa) {
          const t = transmissao;
          if (JSON.stringify(t.parametros) === JSON.stringify(parametros)) return;
          t.parametros = parametros;
          if (t.modo !== 'webcodecs') return;
          // A configuração escolhida valia para o pedido antigo. Trocar 1080p a 30 por 1440p a
          // 60 no meio da transmissão com a escolha velha declararia uma taxa que a placa
          // recusa nesse tamanho -- e a tela cairia para o caminho de hoje no primeiro quadro.
          // Então a escolha é refeita, na fila, antes de as camadas voltarem.
          //
          // As restrições da captura também podem ter mudado junto, e uma cópia de faixa não
          // herda as restrições aplicadas depois dela: a captura recomeça numa cópia nova.
          filaDoCaminho = filaDoCaminho.then(async () => {
            if (t !== transmissao || t.modo !== 'webcodecs') return;
            const ligadas = [...t.camadas.keys()];
            for (const camada of ligadas) pararCodificacao(t, camada);
            pararCaptura(t);
            const recusa = await escolherCodificadores(t, t.codec);
            if (t !== transmissao || t.modo !== 'webcodecs') return;
            if (recusa) { falhar(t, recusa); return; }
            trocarMotivo(t, t.motivoBase || t.motivo);
            for (const camada of ligadas) iniciarCodificacao(t, camada);
          }).catch(erro => console.error('tela-webcodecs:', erro));
          return;
        }
        pararTransmissao();
        const medidas = faixa.getSettings?.() || {};
        transmissao = {
          faixa, parametros, modo: 'rtp', motivo: 'avaliando', motivoBase: 'avaliando', codec: null, falha: null,
          limiteDaPlaca: null, notaDaPlaca: null,
          escolhas: null, faixasDeDados: new Map(), captura: null, camadas: new Map(), espectadores: new Map(),
          fonte: { largura: medidas.width || parametros.largura, altura: medidas.height || parametros.altura },
          bytesEnviados: 0, envioRecusado: 0, saidaDisponivel: null, saidaLidaEm: 0, iniciadaEm: Date.now()
        };
        reavaliarCaminho();
      },

      pararTransmissao,

      estadoDoEnvio() {
        const t = transmissao;
        if (!t) return null;
        const canal = canalDaTela();
        return {
          modo: t.modo, motivo: t.motivo, codec: t.codec, preferencia, falha: t.falha,
          captura: t.captura?.tipo || null,
          fonte: { ...t.fonte },
          espectadores: t.espectadores.size,
          buffer: canal ? canal.bufferedAmount : null,
          saidaDisponivel: t.saidaDisponivel,
          envioRecusado: t.envioRecusado,
          camadas: [...t.camadas.entries()].map(([camada, c]) => ({
            ...c.codificador.estatisticas(),
            espectadores: [...t.espectadores.values()].filter(porCamada => porCamada.has(camada)).length,
            perda: c.sinais?.perda ?? 0,
            saidaApertada: Boolean(c.sinais?.saidaApertada),
            codificadorApertado: Boolean(c.sinais?.codificadorApertado),
            escala: c.estado.escala,
            ultimaMudanca: c.estado.ultimaMudanca || null,
            reenviados: c.reenviados,
            atrasos: [...t.espectadores.values()].map(porCamada => porCamada.get(camada)?.relato?.atrasoMs).filter(Number.isFinite)
          }))
        };
      },

      // ---------- Quem assiste ----------
      sincronizar(id) { sincronizar(id); },

      // 'rtp': a tela desta pessoa vem pelo caminho de hoje.
      // 'iniciando': vai vir pelo caminho novo, mas a primeira imagem ainda não chegou.
      // 'pronto': a imagem já está vindo pelo caminho novo.
      modoDaTela(id) {
        const tela = telas.get(id);
        if (!tela?.recepcao) return podeUsar(tela) && querTela(id) ? 'iniciando' : 'rtp';
        return tela.recepcao.comImagem ? 'pronto' : 'iniciando';
      },

      streamDe(id) {
        const recepcao = telas.get(id)?.recepcao;
        return recepcao?.comImagem ? recepcao.decodificador.stream : null;
      },

      // Os bytes recebidos pela faixa de dados desde a leitura anterior. Eles entram na mesma
      // soma do relatório de banda que o `inbound-rtp`: sem isto, a tela pelo caminho novo
      // sumiria da conta de quem hospeda, e ela é justamente a fonte central da medição.
      lerBytesRecebidos() {
        let total = bytesDeRecepcoesEncerradas;
        bytesDeRecepcoesEncerradas = 0;
        for (const tela of telas.values()) {
          if (!tela.recepcao) continue;
          const bytes = tela.recepcao.decodificador.estatisticas().totais.bytes;
          total += Math.max(0, bytes - tela.bytesLidos);
          tela.bytesLidos = bytes;
        }
        return total;
      },

      estadoDoRecebimento() {
        const lista = [];
        for (const tela of telas.values()) {
          if (!tela.recepcao) continue;
          lista.push({
            id: tela.id, ...tela.recepcao.decodificador.estatisticas(),
            comImagem: tela.recepcao.comImagem, rtt: tela.rtt, desvio: tela.desvio,
            camadasDisponiveis: [...tela.faixas.keys()]
          });
        }
        return lista;
      },

      capacidade() {
        return { envio, recebimento, anuncio: minhaCapacidade(), recebimentoFalhou, preferencia, desligadoPeloServidor };
      },

      simularPerda(fracao) {
        perdaSimulada = Math.max(0, Math.min(0.9, Number(fracao) || 0));
        const ok = instalarPerdaSimulada();
        anotar('tela.simulacao', `perda de ${Math.round(perdaSimulada * 100)}% dos pacotes recebidos${ok ? '' : ' (indisponível nesta versão da biblioteca)'}`);
        return ok;
      },

      simularAperto(fracao) {
        apertoSimulado = Math.max(0, Math.min(0.95, Number(fracao) || 0));
        anotar('tela.simulacao', `portão de envio recusando ${Math.round(apertoSimulado * 100)}% dos quadros`);
      },

      sondagens
    };
  }

  // Sem WebCodecs, sem módulo: o transporte segue sozinho, exatamente como antes.
  const disponivel = () => Boolean(Quadro && Decisoes && Codificador && Decodificador);

  const api = { criar, disponivel, PREFERENCIAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaWebCodecs = api;
})(typeof window === 'undefined' ? globalThis : window);
