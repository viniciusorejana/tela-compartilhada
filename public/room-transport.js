/* Transporte de midia sobre o servidor de midia (SFU).
 *
 * Antes cada participante mantinha uma conexao com cada outro e enviava uma copia do
 * proprio video para cada um. Agora todo mundo conversa com UM servidor: uma copia sobe,
 * e ele distribui. Isso resolve dois problemas de uma vez -- a conexao e sempre de SAIDA
 * para um endereco publico (nao ha mais NAT dos dois lados para furar), e quem transmite
 * para de multiplicar o proprio upload pelo tamanho da sala.
 *
 * Este modulo existe para que NADA da interface precise saber disso. Ele mantem o mesmo
 * mapa `peers` que os quadradinhos, o palco, o modo multiplo e o destaque ja consomem:
 * cada par tem id, name, state, remoteStreams por fonte e ordem de chegada.
 */
(function (root) {
  const LK = root.LivekitClient;

  // O SFU carimba a fonte de cada faixa no proprio protocolo. Isso substitui a antiga
  // identificacao por MID e por id de stream: nao ha mais faixa ambigua para adivinhar.
  const FONTES = {
    camera: 'camera',
    microphone: 'micAudio',
    screen_share: 'screen',
    screen_share_audio: 'screenAudio'
  };

  function fonteDaPublicacao(publicacao) {
    return FONTES[publicacao?.source] || null;
  }

  // Tempo que alguem pode ficar sem conexao antes de sair da lista. Curto demais tira da
  // sala quem so passou por um tunel; longo demais deixa fantasma na conversa.
  const SEGUNDOS_ATE_DAR_POR_AUSENTE = 25;

  // De quanto em quanto tempo a lista e conferida contra o servidor de midia. Todo o resto
  // -- "fulano saiu", "fulano entrou" -- e aviso avulso: quem nao estava ouvindo no
  // instante exato perde o aviso e nunca mais fica sabendo. Esta conferencia e o unico
  // mecanismo que nao depende de ter ouvido nada.
  const SEGUNDOS_ENTRE_CONFERENCIAS = 5;

  // Trocar a qualidade, o codec ou a fonte da tela REPUBLICA a faixa: ela sai e volta em
  // menos de dois segundos. Sem esta folga, cada ajuste de quem transmite expulsaria todo
  // mundo que estava assistindo, e a sala inteira teria de clicar em "Assistir" de novo.
  // Depois dela, quem parou de compartilhar de verdade precisa ser pedido outra vez.
  const SEGUNDOS_DE_TOLERANCIA_NA_TROCA = 12;

  function estadoVazio() {
    return { camera: false, screen: false, screenAudio: false, micMuted: true };
  }

  function streamsVazios() {
    return {
      camera: new MediaStream(), screen: new MediaStream(),
      micAudio: new MediaStream(), screenAudio: new MediaStream()
    };
  }

  // Cria a mesma forma de objeto que a interface sempre recebeu. `pc` sobrevive apenas
  // como um estado de conexao sintetico: e o unico campo que a lista da sala consulta.
  function criarPar(participante, sequencia) {
    return {
      id: participante.identity,
      name: participante.name || participante.identity.split('#')[0] || 'Participante',
      state: estadoVazio(),
      remoteStreams: streamsVazios(),
      ordem: { screen: 0, camera: 0 },
      publicacoes: new Map(),
      participante,
      pc: { connectionState: 'connecting' },
      // Tela de outra pessoa so chega depois de a gente pedir. Ver a lista de quem esta
      // compartilhando nao custa nada; RECEBER a imagem custa banda e processador de quem
      // assiste, e antes esse custo era cobrado de todo mundo automaticamente.
      assistindo: false,
      toleranciaDaTroca: null,
      // Marcado quando o servidor de midia da a conexao dessa pessoa como perdida.
      semConexao: false,
      timeoutDeAusencia: null,
      proximaOrdem: sequencia
    };
  }

  function criarTransporte({ peers, aoEntrar, aoSair, aoMudarMidia, aoMudarEstado, proximaOrdem }) {
    const sala = new LK.Room({
      adaptiveStream: false,
      dynacast: true,
      // Uma sala fica aberta por horas com a aba em segundo plano; sem isto o navegador
      // pode suspender a conexao e a pessoa "some" para os outros sem sair.
      disconnectOnPageLeave: true
    });

    let conectada = false;
    let conferencia = null;

    function estadoDeConexao() {
      if (sala.state === 'connected') return 'connected';
      if (sala.state === 'reconnecting') return 'disconnected';
      if (sala.state === 'disconnected') return 'failed';
      return 'connecting';
    }

    function sincronizarEstadoDeConexao() {
      peers.forEach(par => { par.pc.connectionState = estadoDeConexao(); });
    }

    // Um par removido nao pode deixar temporizador vivo atras de si: ele voltaria a mexer
    // num objeto que ninguem mais consulta.
    function esquecerTemporizadores(par) {
      clearTimeout(par?.timeoutDeAusencia);
      clearTimeout(par?.toleranciaDaTroca);
    }

    function garantirPar(participante) {
      const existente = peers.get(participante.identity);
      if (existente) return existente;
      const par = criarPar(participante, proximaOrdem);
      peers.set(par.id, par);
      aoEntrar(par);
      return par;
    }

    // Camera e voz chegam sozinhas: ver quem esta na sala e ouvir a conversa e o motivo de
    // entrar nela. Tela, nao -- ela e a fonte cara, e quem assiste decide quando pagar.
    const CHEGA_SOZINHA = new Set(['camera', 'micAudio']);

    function acompanharPublicacao(par, publicacao) {
      par.publicacoes.set(publicacao.trackSid, publicacao);
      const fonte = fonteDaPublicacao(publicacao);
      if (!fonte) return;
      // A tela voltou dentro da folga: era um ajuste, nao uma saida. Segue assistindo.
      if (fonte === 'screen' && par.toleranciaDaTroca) {
        clearTimeout(par.toleranciaDaTroca);
        par.toleranciaDaTroca = null;
      }
      // O som da tela acompanha a imagem: assistir sem ouvir (ou ouvir sem ver) nao e um
      // estado que alguem peca.
      const querer = CHEGA_SOZINHA.has(fonte) || par.assistindo;
      if (publicacao.isSubscribed !== querer) publicacao.setSubscribed(querer);
    }

    // O estado anunciado (camera ligada, tela ligada, tela com som) deixa de vir de uma
    // mensagem separada: ele E a lista de publicacoes. Uma faixa muda conta como desligada,
    // porque e assim que uma pausa aparece do outro lado.
    function recalcularEstado(par) {
      const antes = { ...par.state };
      const ativa = fonte => [...par.publicacoes.values()].some(p => fonteDaPublicacao(p) === fonte && !p.isMuted);
      par.state = {
        camera: ativa('camera'),
        screen: ativa('screen'),
        screenAudio: ativa('screenAudio'),
        micMuted: !ativa('micAudio')
      };
      if (par.state.screen && !antes.screen) par.ordem.screen = par.proximaOrdem();
      if (!par.state.screen) par.ordem.screen = 0;
      if (par.state.camera && !antes.camera) par.ordem.camera = par.proximaOrdem();
      if (!par.state.camera) par.ordem.camera = 0;
      aoMudarEstado(par);
    }

    function guardarFaixa(par, publicacao, faixa) {
      const fonte = fonteDaPublicacao(publicacao);
      if (!fonte) return;
      par.remoteStreams[fonte] = faixa ? new MediaStream([faixa.mediaStreamTrack]) : new MediaStream();
      aoMudarMidia(par.id);
    }

    sala
      .on(LK.RoomEvent.ParticipantConnected, participante => { garantirPar(participante); sincronizarEstadoDeConexao(); })
      .on(LK.RoomEvent.ParticipantDisconnected, participante => {
        const par = peers.get(participante.identity);
        if (!par) return;
        esquecerTemporizadores(par);
        peers.delete(participante.identity);
        aoSair(participante.identity);
      })
      // Publicar e assinar deixaram de ser a mesma coisa. "Publicada" e o anuncio -- chega
      // para todo mundo e e o que a lista da sala mostra; "assinada" e o video descendo de
      // verdade. Antes so existia o segundo evento, entao aparecer na lista exigia estar
      // pagando pela imagem.
      .on(LK.RoomEvent.TrackPublished, (publicacao, participante) => {
        const par = garantirPar(participante);
        acompanharPublicacao(par, publicacao);
        recalcularEstado(par);
      })
      .on(LK.RoomEvent.TrackUnpublished, (publicacao, participante) => {
        const par = peers.get(participante.identity);
        if (!par) return;
        par.publicacoes.delete(publicacao.trackSid);
        guardarFaixa(par, publicacao, null);
        // Parou de compartilhar: da proxima vez pede-se de novo, como no Discord. Retomar
        // sozinho traria de volta um custo que a pessoa nao pediu duas vezes -- mas so
        // depois da folga, porque um simples ajuste de qualidade passa por aqui tambem.
        if (fonteDaPublicacao(publicacao) === 'screen' && par.assistindo) {
          clearTimeout(par.toleranciaDaTroca);
          par.toleranciaDaTroca = setTimeout(() => { par.assistindo = false; aoMudarEstado(par); },
            SEGUNDOS_DE_TOLERANCIA_NA_TROCA * 1000);
        }
        recalcularEstado(par);
      })
      .on(LK.RoomEvent.TrackSubscribed, (faixa, publicacao, participante) => {
        const par = garantirPar(participante);
        par.publicacoes.set(publicacao.trackSid, publicacao);
        guardarFaixa(par, publicacao, faixa);
        recalcularEstado(par);
      })
      // Deixar de receber NAO e deixar de existir: quem parou de assistir continua vendo na
      // lista que a tela esta no ar. Apagar a publicacao aqui faria a tela sumir da sala
      // inteira no instante em que UMA pessoa fechasse a transmissao.
      .on(LK.RoomEvent.TrackUnsubscribed, (_faixa, publicacao, participante) => {
        const par = peers.get(participante.identity);
        if (!par) return;
        if (!participante.trackPublications.has(publicacao.trackSid)) par.publicacoes.delete(publicacao.trackSid);
        guardarFaixa(par, publicacao, null);
        recalcularEstado(par);
      })
      // Parar de compartilhar nem sempre encerra a faixa: as vezes ela so fica muda. Sem
      // reagir a isso, o palco ficaria com a imagem congelada.
      .on(LK.RoomEvent.TrackMuted, (publicacao, participante) => {
        const par = peers.get(participante.identity);
        if (!par || !par.publicacoes.has(publicacao.trackSid)) return;
        recalcularEstado(par);
        aoMudarMidia(par.id);
      })
      .on(LK.RoomEvent.TrackUnmuted, (publicacao, participante) => {
        const par = peers.get(participante.identity);
        if (!par || !par.publicacoes.has(publicacao.trackSid)) return;
        recalcularEstado(par);
        aoMudarMidia(par.id);
      })
      // Quem fecha o notebook, perde o Wi-Fi ou mata o navegador nao consegue avisar
      // ninguem. O servidor de midia guarda essa pessoa por um bom tempo esperando ela
      // voltar -- prudente para uma oscilacao de rede, mas do lado de ca ela fica parada na
      // lista, com a imagem congelada, como se ainda estivesse na conversa. Entao: assim que
      // a conexao dela e dada como perdida, ela aparece marcada; se nao voltar, sai.
      .on(LK.RoomEvent.ConnectionQualityChanged, (qualidade, participante) => {
        const par = peers.get(participante?.identity);
        if (!par) return;
        const perdida = qualidade === LK.ConnectionQuality.Lost;
        if (perdida === Boolean(par.semConexao)) return;
        par.semConexao = perdida;
        clearTimeout(par.timeoutDeAusencia);
        par.timeoutDeAusencia = null;
        if (perdida) {
          par.timeoutDeAusencia = setTimeout(() => {
            if (peers.get(par.id) !== par || !par.semConexao) return;
            peers.delete(par.id);
            aoSair(par.id);
          }, SEGUNDOS_ATE_DAR_POR_AUSENTE * 1000);
        }
        aoMudarEstado(par);
      })
      .on(LK.RoomEvent.ConnectionStateChanged, sincronizarEstadoDeConexao)
      // Perder a conexao com o servidor de midia nao gera evento de saida para cada um: se
      // a lista nao for esvaziada aqui, todo mundo continua aparecendo na sala como se
      // estivesse la, com a imagem congelada, ate a pagina ser recarregada.
      .on(LK.RoomEvent.Disconnected, () => {
        conectada = false;
        esvaziar();
        sincronizarEstadoDeConexao();
      })
      // Numa reconexao o servidor manda o estado atual da sala. Quem saiu enquanto a
      // conexao estava fora nao gera "participante saiu": some daqui por ausencia.
      .on(LK.RoomEvent.Reconnected, () => {
        for (const id of [...peers.keys()]) {
          if (!sala.remoteParticipants.has(id)) { peers.delete(id); aoSair(id); }
        }
        sala.remoteParticipants.forEach(adotarParticipante);
        sincronizarEstadoDeConexao();
      });

    function esvaziar() {
      for (const id of [...peers.keys()]) {
        esquecerTemporizadores(peers.get(id));
        peers.delete(id);
        aoSair(id);
      }
    }

    function adotarParticipante(participante) {
      const par = garantirPar(participante);
      participante.trackPublications.forEach(publicacao => {
        acompanharPublicacao(par, publicacao);
        if (publicacao.isSubscribed) guardarFaixa(par, publicacao, publicacao.track);
      });
      recalcularEstado(par);
    }

    // Quem esta na sala e quem o servidor de midia diz que esta -- nao quem sobrou de uma
    // sequencia de avisos. Um aviso perdido (a rede do celular oscilou, a aba dormiu, o
    // socket reconectou no segundo errado) deixava alguem parado na lista para sempre, e
    // com mais gente na sala ha mais avisos para perder. A conferencia corrige nos DOIS
    // sentidos: tira quem nao esta mais la e traz de volta quem foi removido por engano.
    function conferirLista() {
      if (sala.state !== 'connected') return;
      for (const id of [...peers.keys()]) {
        if (sala.remoteParticipants.has(id)) continue;
        esquecerTemporizadores(peers.get(id));
        peers.delete(id);
        aoSair(id);
      }
      sala.remoteParticipants.forEach(participante => {
        if (!peers.has(participante.identity)) adotarParticipante(participante);
      });
    }

    // Ligar e desligar o recebimento da tela de alguem. Nao e um "hidden" no video: a
    // imagem para de descer do servidor de midia, entao quem nao esta assistindo nao gasta
    // banda nem processador -- que e o ponto todo.
    function assistir(id, ligar) {
      const par = peers.get(id);
      if (!par || par.assistindo === Boolean(ligar)) return;
      clearTimeout(par.toleranciaDaTroca);
      par.toleranciaDaTroca = null;
      par.assistindo = Boolean(ligar);
      par.publicacoes.forEach(publicacao => {
        const fonte = fonteDaPublicacao(publicacao);
        if (fonte === 'screen' || fonte === 'screenAudio') publicacao.setSubscribed(par.assistindo);
      });
      aoMudarEstado(par);
    }

    return {
      sala,
      get conectada() { return conectada; },

      assistir,

      async conectar(url, token) {
        // Sem assinatura automatica: quem entra numa sala com cinco telas no ar nao pode
        // receber as cinco de uma vez so por ter aberto a pagina.
        await sala.connect(url, token, { autoSubscribe: false });
        conectada = true;
        // Quem ja estava na sala antes desta conexao nao gera evento de entrada.
        sala.remoteParticipants.forEach(adotarParticipante);
        sincronizarEstadoDeConexao();
        clearInterval(conferencia);
        conferencia = setInterval(conferirLista, SEGUNDOS_ENTRE_CONFERENCIAS * 1000);
      },

      async desconectar() {
        conectada = false;
        clearInterval(conferencia);
        conferencia = null;
        esvaziar();
        try { await sala.disconnect(); } catch (_) { /* Sair nunca deve travar a navegação. */ }
      },

      estadoDeConexao
    };
  }

  const api = { criarTransporte, FONTES, fonteDaPublicacao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomTransport = api;
})(typeof window === 'undefined' ? globalThis : window);
