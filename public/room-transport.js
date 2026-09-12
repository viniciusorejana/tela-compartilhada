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

  // Por quanto tempo a saida anunciada pela sinalizacao vale contra a lista do servidor de
  // midia. Precisa cobrir a espera dele por uma reconexao que nao vem.
  const SEGUNDOS_DE_LUTO = 90;

  // Teto da espera entre tentativas de voltar para a sala. A espera dobra a cada fracasso
  // para nao martelar um servidor que caiu, mas para de crescer aqui: quem deixou a aba
  // aberta quer voltar, e meia hora de silencio nao e um estado util.
  const SEGUNDOS_MAXIMOS_ENTRE_VOLTAS = 30;

  // Por quanto tempo uma tela que eu estava assistindo continua "minha" depois de a pessoa
  // cair. Dentro desta janela, a volta dela retoma a imagem sozinha; passada ela, a tela
  // volta a ser um convite, como qualquer outra.
  //
  // A memoria e LOCAL, de proposito. Cada um restabelece o que estava vendo, e quem nao
  // estava assistindo continua sem assistir -- ninguem e arrastado para uma tela por causa
  // da queda de outro.
  const SEGUNDOS_PARA_RETOMAR_A_TELA = 120;

  // Quanto tempo a conexao precisa passar boa antes de voltarmos a pedir imagem maior.
  // Descer e imediato; subir espera. A qualidade relatada oscila, e subir a cada respiro e
  // justamente o que cria o ciclo de afogar, recuperar e afogar de novo.
  const SEGUNDOS_PARA_CONFIAR_NA_MELHORA = 20;

  // Desconexoes que NAO pedem volta. Todas sao deliberadas -- alguem saiu, outra aba
  // assumiu a mesma identidade, a pessoa foi removida, a sala acabou -- e insistir na
  // segunda faria duas abas se expulsarem em revezamento para sempre.
  const MOTIVOS_SEM_VOLTA = new Set([
    LK.DisconnectReason?.CLIENT_INITIATED,
    LK.DisconnectReason?.DUPLICATE_IDENTITY,
    LK.DisconnectReason?.PARTICIPANT_REMOVED,
    LK.DisconnectReason?.ROOM_DELETED
  ].filter(motivo => motivo !== undefined));

  // ---------- Relógio que o navegador não estrangula ----------
  //
  // A lib passa TODO temporizador sensível por `CriticalTimers`, e os deixa trocáveis
  // justamente por causa disto: no navegador, um `setTimeout` de aba em segundo plano é
  // estrangulado até um disparo por minuto. O batimento da sinalização atrasa, o servidor
  // conclui que a pessoa sumiu, e ela cai sem ter feito nada -- que é exatamente a forma
  // como "desconectou sozinho depois de ficar um tempo quieto" aparece.
  //
  // Dentro de um Worker os mesmos temporizadores não sofrem esse estrangulamento. Este
  // Worker não faz mais nada: recebe "me avise daqui a tanto" e responde na hora certa.
  // Se o navegador não tiver Worker ou Blob, tudo continua como antes.
  function criarRelogioDeWorker() {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const codigo = [
      'const vivos = new Map();',
      'self.onmessage = function (e) {',
      '  const d = e.data || {};',
      '  if (d.acao === "iniciar") {',
      '    const avisar = function () { self.postMessage({ id: d.id }); };',
      '    vivos.set(d.id, d.repetir ? setInterval(avisar, d.atraso)',
      '      : setTimeout(function () { vivos.delete(d.id); avisar(); }, d.atraso));',
      '  } else if (d.acao === "parar") {',
      '    const h = vivos.get(d.id);',
      '    if (h !== undefined) { clearTimeout(h); clearInterval(h); vivos.delete(d.id); }',
      '  }',
      '};'
    ].join(' ');
    try {
      const endereco = URL.createObjectURL(new Blob([codigo], { type: 'application/javascript' }));
      const worker = new Worker(endereco);
      URL.revokeObjectURL(endereco);
      const pendentes = new Map();
      let sequencia = 0;
      worker.onmessage = evento => {
        const entrada = pendentes.get(evento.data?.id);
        if (!entrada) return;
        if (!entrada.repetir) pendentes.delete(evento.data.id);
        try { entrada.fn(...entrada.args); } catch (erro) { console.error('relógio:', erro); }
      };
      const agendar = repetir => (fn, atraso, ...args) => {
        const id = ++sequencia;
        pendentes.set(id, { fn, args, repetir });
        worker.postMessage({ acao: 'iniciar', id, atraso: atraso || 0, repetir });
        return id;
      };
      const cancelar = id => {
        if (id === undefined || id === null) return;
        pendentes.delete(id);
        worker.postMessage({ acao: 'parar', id });
      };
      return { setTimeout: agendar(false), setInterval: agendar(true), clearTimeout: cancelar, clearInterval: cancelar };
    } catch (_) { return null; }
  }

  const relogio = criarRelogioDeWorker();
  if (relogio && LK.CriticalTimers) {
    LK.CriticalTimers.setTimeout = relogio.setTimeout;
    LK.CriticalTimers.setInterval = relogio.setInterval;
    LK.CriticalTimers.clearTimeout = relogio.clearTimeout;
    LK.CriticalTimers.clearInterval = relogio.clearInterval;
  }
  // Os temporizadores desta sala que não podem atrasar pelo mesmo motivo: a conferência que
  // mantém a lista honesta e a tentativa de voltar depois de uma queda. Sem o relógio do
  // Worker, uma aba em segundo plano tentaria voltar uma vez por minuto, na melhor hipótese.
  const agendar = relogio ? relogio.setTimeout : setTimeout;
  const cancelar = relogio ? relogio.clearTimeout : clearTimeout;
  const repetir = relogio ? relogio.setInterval : setInterval;
  const pararDeRepetir = relogio ? relogio.clearInterval : clearInterval;

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

  function criarTransporte({
    peers, aoEntrar, aoSair, aoMudarMidia, aoMudarEstado, proximaOrdem,
    // Devolve `{ url, token }` novos. A cada volta se pede credencial nova em vez de
    // reaproveitar a antiga: ela tem prazo, e uma queda longa a deixa vencida.
    pedirCredencial,
    // Chamado depois de uma volta bem-sucedida. As faixas locais nao sobrevivem a uma
    // sessao nova no servidor de midia -- sem republicar, a pessoa volta muda e invisivel.
    aoReconectar,
    // Relata em que pe esta a conexao, para a sala poder DIZER em vez de so congelar.
    aoMudarConexao,
    // A qualidade da conexao DESTA maquina. Quem assiste usa para pedir menos imagem;
    // quem transmite usa para enviar menos.
    aoMudarQualidade
  }) {
    const sala = new LK.Room({
      adaptiveStream: false,
      dynacast: true,
      // Antes isto desligava a midia so por trocar de app no celular: a lib reage ao
      // "pagehide" do navegador, que tambem dispara ao entrar no bfcache (trocar de app),
      // nao so ao fechar a aba de verdade. A saida real ja e tratada a mao, em sala.js, no
      // "pagehide" que NAO veio acompanhado de "persisted" -- entao a lib nao precisa
      // fazer isso sozinha, e desligar a opcao publica evita o falso positivo do celular.
      disconnectOnPageLeave: false,
      // A lib ENCERRA as faixas locais quando a conexao cai -- e por padrao, nao por
      // acidente. Numa sala que volta sozinha isso e fatal: a camera e o microfone ate se
      // reabririam, mas a captura de tela NAO, porque pedi-la de novo exige um gesto da
      // pessoa. Quem caisse voltaria para a sala sem a tela que estava compartilhando, sem
      // entender por que, e com um botao para clicar de novo no meio da conversa.
      //
      // Quem manda no ciclo de vida das capturas e esta pagina, como ja mandava no
      // despublicar avulso (o "false" em unpublishTrack, em sala.js, pelo mesmo motivo).
      stopLocalTrackOnUnpublish: false
    });

    let conectada = false;
    let conferencia = null;
    // Quem a sinalizacao ja deu como fora. O servidor de midia demora bem mais para soltar
    // alguem que fechou a aba, entao sem esta lembranca a conferencia traria a pessoa de
    // volta cinco segundos depois de ela sair -- e a saida rapida, que e o caminho bom,
    // deixaria de valer para nada.
    const saidosRecentemente = new Map();

    // Telas que eu estava assistindo quando a pessoa (ou eu) caiu, com a hora da queda.
    const assistiaAoCair = new Map();

    // Supervisao da volta para a sala.
    let tentativasDeVolta = 0;
    let timerDeVolta = null;
    let saindoDeVez = false;

    // Adaptacao de banda de quem ASSISTE.
    let qualidadeLocal = LK.ConnectionQuality?.Unknown ?? 'unknown';
    // Teto imposto pela conexao desta maquina. `null` = ainda nao se sabe.
    let tetoDaConexao = null;
    let horaDaMelhora = 0;
    // Quem esta no palco. Uma camera no palco e vista grande; no quadradinho, nao.
    let destaque = null;
    // Ultima camada pedida por faixa, para nao repetir o pedido a cada conferencia.
    const camadasAplicadas = new Map();

    function avisar(estado, mensagem) {
      try { aoMudarConexao?.(estado, mensagem || null); } catch (_) { /* A sala avisa como quiser. */ }
    }

    function estadoDeConexao() {
      if (sala.state === 'connected') return 'connected';
      if (sala.state === 'reconnecting') return 'disconnected';
      // Fora do ar MAS com volta agendada nao e o mesmo que fora do ar de vez: dizer
      // "falhou" a quem esta a dois segundos de voltar e mentir sobre o que acontece.
      if (sala.state === 'disconnected') return timerDeVolta ? 'disconnected' : 'failed';
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

    // Uma queda apagava o par inteiro, e com ele o fato de que eu estava assistindo aquela
    // tela. A pessoa voltava alguns segundos depois e a tela dela vinha como convite: quem
    // estava no meio de uma partida ou de uma explicacao tinha de clicar em "Assistir" de
    // novo, toda vez que a internet dela tossisse.
    function voltouAssistindo(id) {
      const quando = assistiaAoCair.get(id);
      if (quando === undefined) return false;
      assistiaAoCair.delete(id);
      return Date.now() - quando <= SEGUNDOS_PARA_RETOMAR_A_TELA * 1000;
    }

    function garantirPar(participante) {
      const existente = peers.get(participante.identity);
      if (existente) return existente;
      const par = criarPar(participante, proximaOrdem);
      const retomando = voltouAssistindo(par.id);
      if (retomando) par.assistindo = true;
      peers.set(par.id, par);
      aoEntrar(par, { retomando });
      return par;
    }

    // Todo caminho de saida passa por aqui, e e por isso que a anotacao acima e confiavel:
    // ha cinco lugares diferentes que tiram alguem da lista -- o aviso do servidor, o
    // tempo de ausencia, a conferencia periodica, a sinalizacao e a minha propria queda --
    // e bastava um deles esquecer a anotacao para a retomada falhar de forma intermitente.
    function tirarDaLista(id, opcoes) {
      const par = peers.get(id);
      if (!par) return;
      if (opcoes?.lembrar !== false && par.assistindo) assistiaAoCair.set(id, Date.now());
      esquecerTemporizadores(par);
      peers.delete(id);
      aoSair(id, { nome: par.name, caiu: opcoes?.caiu ?? Boolean(par.semConexao) });
    }

    // Camera e voz chegam sozinhas: ver quem esta na sala e ouvir a conversa e o motivo de
    // entrar nela. Tela, nao -- ela e a fonte cara, e quem assiste decide quando pagar.
    const CHEGA_SOZINHA = new Set(['camera', 'micAudio']);

    // ---------- Quanta imagem pedir ----------
    //
    // A camada que desce NAO precisa ser decidida so pela estimativa de banda do servidor.
    // Sob perda alta essa estimativa nao assenta: ela desaba para dezenas de kbps, uma
    // sondagem volta inconclusiva, ela reseta para o teto, e o servidor volta a empurrar a
    // camada grande -- o ciclo inteiro em quatro segundos, repetido sem fim. No meio dele
    // o que afoga nao e so a imagem: a sinalizacao viaja no MESMO transporte, e e ela que
    // mantem a pessoa na sala. Por isso uma rede ruim nao dava video ruim, dava queda.
    //
    // Pedir a camada explicitamente tira a decisao da medicao e a poe onde ela e
    // confiavel: em quem esta sentindo a conexao ruim. O servidor ganha um teto que
    // respeita, em vez de uma estimativa que ele proprio derruba e reergue.
    function camadaParaQualidade(qualidade) {
      const Q = LK.ConnectionQuality || {};
      const V = LK.VideoQuality || {};
      if (qualidade === Q.Lost || qualidade === Q.Poor) return V.LOW;
      if (qualidade === Q.Good) return V.MEDIUM;
      if (qualidade === Q.Excellent) return V.HIGH;
      return null;
    }

    // Quanta imagem pedir de UMA faixa: o menor entre o que o TAMANHO na tela justifica e
    // o que a CONEXAO aguenta.
    //
    // O tamanho importa muito mais do que parece, e a camera era o caso pior da sala. Ela
    // chega sozinha, de todo mundo, e sem esta conta chegava sempre na camada cheia --
    // 720p a 1,7 Mbps POR PESSOA, para caber num quadradinho de duzentos pixels. Numa sala
    // de cinco eram mais de 8 Mbps descendo so de camera, antes de alguem abrir uma tela;
    // numa conexao modesta isso sozinho ja estourava a banda de quem so queria conversar.
    //
    // A camada do meio (640x360, 450 kbps) e o padrao porque serve aos dois tamanhos em que
    // uma camera de fato aparece aqui: o quadradinho e o card do modo multiplo. So o palco
    // -- uma camera de cada vez, ocupando a tela inteira -- justifica a camada cheia.
    //
    // Nao se usa o `adaptiveStream` da lib, que faria essa conta pelo tamanho real do
    // elemento, porque ele assume o controle do setVideoQuality e pausa faixa fora de
    // vista: as duas coisas brigariam com o "assistir a pedido", que e quem manda no que
    // desce nesta sala.
    function camadaDesejada(par, publicacao) {
      const V = LK.VideoQuality || {};
      const fonte = fonteDaPublicacao(publicacao);
      if (fonte !== 'screen' && fonte !== 'camera') return null;
      // Tela so desce depois de pedida, e quem pediu esta vendo grande.
      const noPalco = destaque?.id === par.id && destaque?.source === fonte;
      const pelaTela = fonte === 'screen' || noPalco ? V.HIGH : V.MEDIUM;
      if (tetoDaConexao === null || tetoDaConexao === undefined) return pelaTela;
      return Math.min(pelaTela, tetoDaConexao);
    }

    function aplicarCamada(par, publicacao) {
      if (!publicacao?.isSubscribed || typeof publicacao.setVideoQuality !== 'function') return;
      const desejada = camadaDesejada(par, publicacao);
      if (desejada === null || desejada === undefined) return;
      if (camadasAplicadas.get(publicacao.trackSid) === desejada) return;
      try {
        publicacao.setVideoQuality(desejada);
        camadasAplicadas.set(publicacao.trackSid, desejada);
      } catch (_) { /* A reavaliacao seguinte corrige. */ }
    }

    function aplicarCamadaEmTodos() {
      peers.forEach(par => par.publicacoes.forEach(publicacao => aplicarCamada(par, publicacao)));
    }

    // Chamada pela sala quando o palco muda: quem saiu dele volta ao quadradinho e para de
    // custar caro, quem entrou passa a merecer a imagem inteira.
    function definirDestaque(id, fonte) {
      const igual = destaque?.id === (id || null) && destaque?.source === (fonte || null);
      if (igual) return;
      destaque = id ? { id, source: fonte || null } : null;
      aplicarCamadaEmTodos();
    }

    // Chamada tanto pelo evento de qualidade quanto pela conferencia periodica. O evento so
    // dispara quando a qualidade MUDA: sem a chamada periodica, uma conexao que melhorou e
    // ficou boa nunca completaria a espera para voltar a pedir imagem maior, e a pessoa
    // ficaria presa na camada baixa ate a proxima oscilacao.
    function definirTeto(teto) {
      if (teto === tetoDaConexao) return;
      tetoDaConexao = teto;
      const V = LK.VideoQuality || {};
      window.registrarDiagnostico?.('midia.teto',
        teto === V.LOW ? 'baixa' : teto === V.MEDIUM ? 'media' : 'alta');
      aplicarCamadaEmTodos();
    }

    function reavaliarCamada() {
      const desejado = camadaParaQualidade(qualidadeLocal);
      if (desejado === null || desejado === undefined) return;
      if (tetoDaConexao === null || tetoDaConexao === undefined || desejado < tetoDaConexao) {
        // Descer e imediato: quem ja esta perdendo pacote nao tem tempo a conceder.
        horaDaMelhora = 0;
        definirTeto(desejado);
        return;
      }
      if (desejado === tetoDaConexao) { horaDaMelhora = 0; return; }
      if (!horaDaMelhora) horaDaMelhora = Date.now();
      if (Date.now() - horaDaMelhora >= SEGUNDOS_PARA_CONFIAR_NA_MELHORA * 1000) {
        horaDaMelhora = 0;
        definirTeto(desejado);
      }
    }

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
      aplicarCamada(par, publicacao);
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
      // Só avisa quando algo mudou de fato: assim a conferência periódica pode recalcular
      // todo mundo de graça, sem redesenhar a sala inteira a cada cinco segundos.
      const mudou = Object.keys(par.state).some(chave => par.state[chave] !== antes[chave]);
      if (mudou) aoMudarEstado(par);
      return mudou;
    }

    function guardarFaixa(par, publicacao, faixa) {
      const fonte = fonteDaPublicacao(publicacao);
      if (!fonte) return;
      par.remoteStreams[fonte] = faixa ? new MediaStream([faixa.mediaStreamTrack]) : new MediaStream();
      aoMudarMidia(par.id);
    }

    sala
      .on(LK.RoomEvent.ParticipantConnected, participante => {
        // Um evento de entrada e prova de que a pessoa esta de volta: a anotacao de saida
        // morre aqui, ou a conferencia seguinte tornaria a tira-la da lista.
        saidosRecentemente.delete(participante.identity);
        adotarParticipante(participante);
        sincronizarEstadoDeConexao();
      })
      .on(LK.RoomEvent.ParticipantDisconnected, participante => {
        tirarDaLista(participante.identity);
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
        camadasAplicadas.delete(publicacao.trackSid);
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
        // A camada so pode ser pedida depois de a assinatura existir. Sem esta chamada,
        // quem esta com a conexao ruim recebe a camada cheia de tudo que assinar daqui em
        // diante -- e volta a afogar no primeiro clique em "Assistir".
        aplicarCamada(par, publicacao);
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
        // A faixa deixou de descer: a camada pedida morre com ela. Sem apagar, uma nova
        // assinatura da MESMA faixa acharia que o pedido ja fora feito e nao o refaria.
        camadasAplicadas.delete(publicacao.trackSid);
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
        // A qualidade da conexao LOCAL nao fala de ninguem na lista: fala da rede de quem
        // esta aqui, e e ela que decide quanta imagem pedir.
        if (participante && (participante.isLocal || participante === sala.localParticipant)) {
          qualidadeLocal = qualidade;
          reavaliarCamada();
          try { aoMudarQualidade?.(qualidade); } catch (_) { /* A sala reage como quiser. */ }
          avisar(estadoDeConexao(), null);
          return;
        }
        const par = peers.get(participante?.identity);
        if (!par) return;
        const perdida = qualidade === LK.ConnectionQuality.Lost;
        if (perdida === Boolean(par.semConexao)) return;
        par.semConexao = perdida;
        clearTimeout(par.timeoutDeAusencia);
        par.timeoutDeAusencia = null;
        if (perdida) {
          par.timeoutDeAusencia = agendar(() => {
            if (peers.get(par.id) !== par || !par.semConexao) return;
            // Sai da lista com a queda anunciada: a sala toda fica sabendo por que a pessoa
            // sumiu, em vez de ve-la evaporar sem explicacao.
            tirarDaLista(par.id, { caiu: true });
          }, SEGUNDOS_ATE_DAR_POR_AUSENTE * 1000);
        }
        aoMudarEstado(par);
      })
      .on(LK.RoomEvent.ConnectionStateChanged, estado => {
        window.registrarDiagnostico?.('livekit.ConnectionStateChanged', estado);
        sincronizarEstadoDeConexao();
        avisar(estadoDeConexao(), null);
      })
      // Perder a conexao com o servidor de midia nao gera evento de saida para cada um: se
      // a lista nao for esvaziada aqui, todo mundo continua aparecendo na sala como se
      // estivesse la, com a imagem congelada, ate a pagina ser recarregada.
      .on(LK.RoomEvent.Disconnected, motivo => {
        window.registrarDiagnostico?.('livekit.Disconnected', String(motivo));
        conectada = false;
        pararDeRepetir(conferencia);
        conferencia = null;
        esvaziar();
        sincronizarEstadoDeConexao();
        // Este evento significa que o cliente DESISTIU: ele ja tentou voltar sozinho, pelo
        // tempo que se permite, e parou. Ate aqui ninguem recolhia esse aviso, e o
        // resultado era uma pagina que continuava aberta, com o chat vivo, e fora da sala
        // para sempre -- sem a propria lista (esvaziada logo acima) e sem aparecer na de
        // ninguem, ate alguem recarregar na mao. Quem cai numa rede ruim cai justamente
        // quando menos pode se dar ao luxo de perder o lugar.
        if (saindoDeVez || MOTIVOS_SEM_VOLTA.has(motivo)) {
          avisar('encerrado', null);
          return;
        }
        agendarVolta();
      })
      // Numa reconexao o servidor manda o estado atual da sala. Quem saiu enquanto a
      // conexao estava fora nao gera "participante saiu": some daqui por ausencia.
      .on(LK.RoomEvent.Reconnected, () => {
        window.registrarDiagnostico?.('livekit.Reconnected');
        for (const id of [...peers.keys()]) {
          if (!sala.remoteParticipants.has(id)) tirarDaLista(id);
        }
        sala.remoteParticipants.forEach(adotarParticipante);
        sincronizarEstadoDeConexao();
        avisar('conectado', null);
      });

    function esvaziar() {
      // As camadas pedidas morrem com as faixas. Sem isto o mapa cresceria a cada volta,
      // guardando identificadores de sessoes que nao existem mais.
      camadasAplicadas.clear();
      for (const id of [...peers.keys()]) {
        // Fui EU que cai, nao eles: ninguem precisa ver "fulano perdeu a conexao". Mas as
        // telas que eu estava assistindo ficam anotadas do mesmo jeito, para voltarem
        // comigo -- a nao ser que eu esteja saindo da sala de vez.
        tirarDaLista(id, { lembrar: !saindoDeVez, caiu: false });
      }
    }

    function adotarParticipante(participante) {
      const par = garantirPar(participante);
      // O objeto do participante e outro a cada sessao. Guardar o novo evita que o par
      // siga apontando para uma sessao morta depois de a pessoa voltar.
      par.participante = participante;
      participante.trackPublications.forEach(publicacao => {
        acompanharPublicacao(par, publicacao);
        if (publicacao.isSubscribed) guardarFaixa(par, publicacao, publicacao.track);
      });
      recalcularEstado(par);
    }

    // A anotacao de saida vale contra a SESSAO que saiu, nao contra a pessoa. Quem volta
    // abre uma sessao nova no servidor de midia, com outro sid; insistir na anotacao ai
    // significa recusar por ate um minuto e meio alguem que ja esta de volta -- e era
    // exatamente isso que deixava quem reconectava sozinho fora da lista de todo mundo,
    // mesmo com a conexao dele ja restabelecida.
    function aindaDeLuto(participante) {
      const nota = saidosRecentemente.get(participante.identity);
      if (!nota) return false;
      if (nota.sid && participante.sid && nota.sid !== participante.sid) {
        saidosRecentemente.delete(participante.identity);
        return false;
      }
      return true;
    }

    // Quem esta na sala e quem o servidor de midia diz que esta -- nao quem sobrou de uma
    // sequencia de avisos. Um aviso perdido (a rede do celular oscilou, a aba dormiu, o
    // socket reconectou no segundo errado) deixava alguem parado na lista para sempre, e
    // com mais gente na sala ha mais avisos para perder. A conferencia corrige nos DOIS
    // sentidos: tira quem nao esta mais la e traz de volta quem foi removido por engano.
    function conferirLista() {
      if (sala.state !== 'connected') return;
      const agora = Date.now();
      for (const [id, nota] of saidosRecentemente) {
        if (agora - nota.quando > SEGUNDOS_DE_LUTO * 1000) saidosRecentemente.delete(id);
      }
      for (const id of [...peers.keys()]) {
        if (sala.remoteParticipants.has(id)) continue;
        tirarDaLista(id);
      }
      sala.remoteParticipants.forEach(participante => {
        if (aindaDeLuto(participante)) return;
        const par = peers.get(participante.identity);
        if (!par) { adotarParticipante(participante); return; }
        // Quem voltou numa sessao nova traz publicacoes novas, com outros identificadores.
        // Sem readotar, o par continua com o mapa da sessao morta: a pessoa aparece na
        // lista, mas sem camera, sem voz e sem tela, e nada a tira desse estado.
        if (par.participante !== participante) { adotarParticipante(participante); return; }
        // A conferência corrigia só a PRESENÇA; o estado de quem já estava na lista
        // continuava refém de avisos pontuais. Um "desmutou" que não chega -- e ele não
        // chega, em alguns caminhos do servidor de mídia -- deixava a pessoa marcada como
        // muda para sempre, sem nada que a tirasse de lá. O estado é derivado das
        // publicações, que estão aqui na memória: recalcular é de graça, e só redesenha
        // quando encontra uma diferença de verdade.
        recalcularEstado(par);
      });
      reavaliarCamada();
    }

    // ---------- Voltar para a sala ----------

    // A lib registra um ouvinte de "freeze" INCONDICIONALMENTE -- ela olha para
    // `disconnectOnPageLeave` antes de assinar "pagehide" e "beforeunload", mas nao antes de
    // assinar este. E o ouvinte desconecta a sala.
    //
    // "freeze" e a Page Lifecycle do Chrome: uma aba escondida por alguns minutos e
    // congelada, e entao a sala cai sozinha, sem a pessoa ter feito nada. E a desconexao
    // por ociosidade em estado puro, e nao existe opcao para desliga-la.
    //
    // Entao a inscricao e recusada na origem: durante a conexao, e so durante ela, um
    // "freeze" nao chega a ser registrado. Qualquer outro tipo passa intacto, e o
    // `finally` devolve o metodo original mesmo se a conexao falhar. O ouvinte de
    // diagnostico que a sala mantem para "freeze" e registrado no carregamento da pagina,
    // bem antes desta janela, e continua valendo.
    async function conectarSemCongelar(url, token) {
      const original = window.addEventListener;
      if (typeof original !== 'function') return sala.connect(url, token, { autoSubscribe: false });
      window.addEventListener = function (tipo, ...resto) {
        if (tipo === 'freeze') return undefined;
        return original.call(this, tipo, ...resto);
      };
      try {
        return await sala.connect(url, token, { autoSubscribe: false });
      } finally {
        window.addEventListener = original;
      }
    }

    async function entrar(url, token) {
      await conectarSemCongelar(url, token);
      conectada = true;
      // Quem ja estava na sala antes desta conexao nao gera evento de entrada.
      sala.remoteParticipants.forEach(adotarParticipante);
      sincronizarEstadoDeConexao();
      pararDeRepetir(conferencia);
      conferencia = repetir(conferirLista, SEGUNDOS_ENTRE_CONFERENCIAS * 1000);
    }

    function agendarVolta() {
      if (saindoDeVez || timerDeVolta || typeof pedirCredencial !== 'function') return;
      const espera = Math.min(SEGUNDOS_MAXIMOS_ENTRE_VOLTAS, 2 ** tentativasDeVolta);
      tentativasDeVolta++;
      avisar('reconectando', `Sem mídia. Tentando voltar em ${espera}s.`);
      timerDeVolta = agendar(tentarVoltar, espera * 1000);
    }

    async function tentarVoltar() {
      timerDeVolta = null;
      if (saindoDeVez) return;
      avisar('reconectando', 'Voltando para a sala...');
      try {
        const credencial = await pedirCredencial();
        if (saindoDeVez) return;
        if (!credencial?.url || !credencial?.token) throw new Error('sem-credencial');
        await entrar(credencial.url, credencial.token);
        tentativasDeVolta = 0;
        avisar('conectado', 'De volta à sala.');
        // Republicar vem por ultimo e fora do caminho de erro da conexao: uma falha ao
        // subir a camera nao pode desfazer uma volta que ja deu certo.
        try { await aoReconectar?.(); } catch (_) { /* A fonte que falhou se religa na mao. */ }
      } catch (erro) {
        window.registrarDiagnostico?.('midia.voltaFalhou', erro?.message || String(erro));
        agendarVolta();
      }
    }

    // Chamado quando a sinalizacao -- que percebe uma saida em segundos -- diz que alguem
    // foi embora. Alem de tirar da lista, anota: o servidor de midia ainda vai insistir por
    // um bom tempo que a pessoa esta la, e a conferencia nao pode acreditar nele nisso.
    function descartar(id) {
      const par = peers.get(id);
      // A sinalizacao cai sozinha. Um socket que so oscilou -- aba em segundo plano, rede
      // movel trocando de antena, quinze segundos sem batimento -- dispara este aviso sem
      // a pessoa ter saido de lugar nenhum e sem a midia dela ter caido. Obedecer ao aviso
      // nesse caso tira da sala alguem que esta ali, com camera e tela no ar, e e essa a
      // "desconexao" que aparece para os outros.
      //
      // Quando a saida e de verdade -- aba fechada, navegador morto, rede perdida -- a
      // midia cai junto: ou o servidor marca a conexao como perdida (e o temporizador de
      // ausencia tira a pessoa em seguida), ou ela some da lista dele e a conferencia tira.
      // Os dois caminhos continuam valendo. O que se perde e alguns segundos de fantasma
      // num caso raro; o que se ganha e nao expulsar quem esta presente.
      const participante = sala.remoteParticipants.get(id);
      if (participante && !par?.semConexao) {
        window.registrarDiagnostico?.('midia.saidaIgnorada', id);
        return;
      }
      // O sid da sessao que saiu e o que permite reconhecer, depois, que quem voltou abriu
      // uma sessao NOVA -- e nao e a mesma que acabou de sair.
      const sid = sala.remoteParticipants.get(id)?.sid || par?.participante?.sid || null;
      saidosRecentemente.set(id, { quando: Date.now(), sid });
      tirarDaLista(id);
    }

    // O contraponto de `descartar`. A sinalizacao percebe uma saida em segundos, e e por
    // isso que ela manda tirar da lista -- mas ela percebe uma ENTRADA na mesma velocidade,
    // e a anotacao de saida precisa morrer quando isso acontece. Sem este caminho, um
    // socket que apenas oscilou (a pessoa nao saiu de lugar nenhum, a midia dela nunca
    // caiu) a tirava da lista de todo mundo e a mantinha fora pelo luto inteiro, porque a
    // sessao de midia continuava a mesma e o luto so sabe olhar para o sid.
    function readmitir(id) {
      if (!id) return;
      saidosRecentemente.delete(id);
      const participante = sala.remoteParticipants.get(id);
      if (participante) adotarParticipante(participante);
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
      // Parar de assistir e uma decisao, nao um acidente: apaga a anotacao, ou uma queda
      // logo depois traria de volta uma tela que a pessoa acabou de dispensar.
      if (!par.assistindo) assistiaAoCair.delete(id);
      par.publicacoes.forEach(publicacao => {
        const fonte = fonteDaPublicacao(publicacao);
        if (fonte !== 'screen' && fonte !== 'screenAudio') return;
        publicacao.setSubscribed(par.assistindo);
        if (par.assistindo) aplicarCamada(par, publicacao);
      });
      aoMudarEstado(par);
    }

    return {
      sala,
      get conectada() { return conectada; },
      // A sala mostra isto ao lado do proprio nome: saber que a SUA conexao e a ruim evita
      // a conclusao errada de que o problema e de quem esta transmitindo.
      get qualidade() { return qualidadeLocal; },

      assistir,
      descartar,
      readmitir,
      definirDestaque,

      async conectar(url, token) {
        saindoDeVez = false;
        // Sem assinatura automatica: quem entra numa sala com cinco telas no ar nao pode
        // receber as cinco de uma vez so por ter aberto a pagina.
        await entrar(url, token);
      },

      async desconectar() {
        saindoDeVez = true;
        cancelar(timerDeVolta);
        timerDeVolta = null;
        tentativasDeVolta = 0;
        conectada = false;
        pararDeRepetir(conferencia);
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
