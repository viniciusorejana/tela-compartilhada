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
      // Os identificadores deste relógio começam MUITO acima dos que o navegador entrega.
      //
      // Sem isso, os dois relógios sorteiam números da mesma faixa pequena -- 1, 2, 3 -- e
      // um "clearTimeout" escrito por engano num temporizador daqui não só deixava de
      // cancelar o certo: ele cancelava um temporizador alheio, do navegador, com o mesmo
      // número. Falha em dois lugares ao mesmo tempo, e nenhum deles onde se está olhando.
      // Com a faixa separada, o engano vira um cancelamento que não acerta nada.
      const PRIMEIRO_ID = 1e9;
      const agendar = repetir => (fn, atraso, ...args) => {
        const id = PRIMEIRO_ID + (++sequencia);
        pendentes.set(id, { fn, args, repetir });
        worker.postMessage({ acao: 'iniciar', id, atraso: atraso || 0, repetir });
        return id;
      };
      // Cancela os dois tipos. Quem recebe um identificador não precisa lembrar de onde ele
      // veio, e misturar as duas origens deixa de ser capaz de produzir um temporizador
      // imortal.
      const cancelar = id => {
        if (id === undefined || id === null) return;
        if (id < PRIMEIRO_ID) { clearTimeout(id); clearInterval(id); return; }
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
  // A identidade do bot de musica. O servidor recusa esse nome para gente (ver
  // `nomeQueNaoSeFingeDeBot`, em server.js), entao ver este prefixo e prova de que aquele
  // participante e o bot -- e nao alguem que escolheu se chamar assim.
  const PREFIXO_DO_BOT = 'nexo-dj#';

  function criarPar(participante, sequencia) {
    return {
      id: participante.identity,
      name: participante.name || participante.identity.split('#')[0] || 'Participante',
      // Muda como a faixa de audio dele e recebida: musica pode esperar, conversa nao.
      ehBot: String(participante.identity || '').startsWith(PREFIXO_DO_BOT),
      state: estadoVazio(),
      remoteStreams: streamsVazios(),
      // A tela pelo RTP, guardada mesmo quando quem aparece em `remoteStreams.screen` é a do
      // caminho novo: é a reserva para quando ele sair do ar.
      telaPeloRtp: null,
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
    let economiaDeDados = false;
    let horaDaMelhora = 0;
    // Onde cada fonte está sendo mostrada. `destaque` é o palco -- uma fonte só; `naGrade`
    // são as do modo múltiplo. A sala informa os dois e o transporte decide a camada: ele não
    // precisa saber nada de layout, e a sala não precisa saber nada de camadas.
    let destaque = null;
    let naGrade = new Set();
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
      cancelar(par?.timeoutDeAusencia);
      cancelar(par?.toleranciaDaTroca);
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
      // Um par recriado (a pessoa saiu da lista e voltou) nasce com a tela vazia, mas a
      // recepção pelo caminho novo é por identidade e pode ter continuado no meio-tempo.
      escolherOrigemDaTela(par);
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
    // A tela seguia outra regra: bastava ser pedida para descer na camada cheia, em
    // qualquer tamanho. Parecia seguro -- quem pede uma tela está olhando para ela --, mas
    // "pedida" e "no palco" deixaram de ser a mesma coisa quando surgiu o modo múltiplo.
    // Ali três telas convivem em cards de algumas centenas de pixels, e cada uma descia na
    // camada cheia -- que é o bitrate de captura INTEIRO do perfil escolhido, não uma fatia
    // dele (ver quality-utils.js). Com o perfil alto de então eram 8 Mbps por card: 24 Mbps
    // para imagens que cabem num quarto do monitor, e mais a cada tela aberta.
    //
    // Agora a regra é uma só, para tela e para câmera: a camada cheia é do palco. Assistir
    // continua pinando (ver `assistirTela`, em sala.js), então quem pede uma tela para ver
    // grande recebe exatamente o que recebia antes; o que muda é o preço das outras.
    //
    // Nao se usa o `adaptiveStream` da lib, que faria essa conta pelo tamanho real do
    // elemento, porque ele assume o controle do setVideoQuality e pausa faixa fora de
    // vista: as duas coisas brigariam com o "assistir a pedido", que e quem manda no que
    // desce nesta sala.
    // Três tamanhos, três camadas. O palco ocupa a tela inteira e merece a imagem cheia; o
    // card da grade é uma fração dela; o quadradinho da plateia tem duzentos pixels, e mandar
    // 640x360 para ele era pagar três vezes pelo que ninguém consegue ver.
    function ondeAparece(id, fonte) {
      if (destaque?.id === id && destaque?.source === fonte) return 'palco';
      if (naGrade.has(`${id}|${fonte}`)) return 'grade';
      return 'plateia';
    }

    function camadaDesejada(par, publicacao) {
      const fonte = fonteDaPublicacao(publicacao);
      if (fonte !== 'screen' && fonte !== 'camera') return null;
      return camadaPara(par.id, fonte);
    }

    function camadaPara(id, fonte) {
      const V = LK.VideoQuality || {};
      const onde = ondeAparece(id, fonte);
      // A TELA sobe em dois degraus, não três (o porquê está em quality-utils.js). Pedir a
      // camada do meio numa escada de dois devolve a de CIMA -- o servidor arredonda para a
      // mais próxima que existe --, e a grade passaria a custar o mesmo que o palco, que é o
      // oposto do que a grade serve. Então, para a tela, tudo que não está no palco pede o
      // degrau de baixo. A câmera mantém três degraus e continua usando o do meio.
      const naGradeQuer = fonte === 'screen' ? V.LOW : V.MEDIUM;
      const pelaTela = onde === 'palco' ? V.HIGH : onde === 'grade' ? naGradeQuer : V.LOW;
      const tetoEconomico = economiaDeDados ? V.LOW : null;
      const teto = tetoDaConexao === null || tetoDaConexao === undefined ? tetoEconomico
        : tetoEconomico === null ? tetoDaConexao : Math.min(tetoDaConexao, tetoEconomico);
      return teto === null || teto === undefined ? pelaTela : Math.min(pelaTela, teto);
    }

    // A mesma conta para a tela pelo caminho novo, que tem as mesmas duas camadas: a cheia e a
    // de 360p. A camada do meio arredonda para cima, exatamente como o servidor faz no RTP --
    // assim as duas origens entregam a mesma imagem a quem está no mesmo lugar da tela e com a
    // mesma conexão.
    function camadaDaTelaPorWebCodecs(id) {
      const V = LK.VideoQuality || {};
      return camadaPara(id, 'screen') >= (V.MEDIUM ?? 1) ? 'alta' : 'baixa';
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

    // Chamada pela sala quando o palco ou a grade mudam: quem saiu volta ao quadradinho e
    // para de custar caro, quem entrou passa a merecer a imagem maior. A grade vem junto
    // porque as duas decisões saem da mesma passada de layout -- separá-las faria a sala
    // reavaliar tudo duas vezes, e pior, deixaria uma janela em que as duas discordam.
    function definirExibicao(id, fonte, chavesNaGrade) {
      const mesmoPalco = destaque?.id === (id || null) && destaque?.source === (fonte || null);
      const grade = chavesNaGrade instanceof Set ? chavesNaGrade : new Set(chavesNaGrade || []);
      const mesmaGrade = grade.size === naGrade.size && [...grade].every(chave => naGrade.has(chave));
      if (mesmoPalco && mesmaGrade) return;
      destaque = id ? { id, source: fonte || null } : null;
      naGrade = grade;
      // A CAMADA muda na hora: é só um pedido ao servidor, não mexe em quem está assinado e
      // portanto não dispara evento nenhum de volta.
      aplicarCamadaEmTodos();
      // A ASSINATURA, não. Trocar o palco pode liberar ou ocupar uma vaga de câmera, mas
      // assinar dispara eventos de faixa, que recalculam o estado, que reavaliam o destaque,
      // que voltam aqui -- e o palco passa a perseguir o próprio rastro antes de assentar.
      // Agendar quebra o ciclo e ainda agrupa a rajada de trocas de uma mudança de layout
      // numa passada só.
      agendarReavaliacaoDeAssinaturas();
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

    // ---------- Quanto desceu ----------
    //
    // A soma dos relatos estima a saída por fonte, mas não cobre overhead nem clientes
    // que deixaram de reportar. É contabilidade declarada, nunca evidência contra alguém.
    //
    // O que sobe daqui é o DELTA desde a leitura anterior, nunca o acumulado. Trocar
    // qualidade, codec ou fonte republica a faixa (ver a folga de tolerância, no topo deste
    // arquivo), e a faixa nova começa a contar do zero. Somando acumulados, cada troca dessas
    // apareceria como uma queda no total da sala -- e o relatório andaria para trás no exato
    // momento em que alguém mexeu na qualidade para ver o efeito.
    const bytesLidos = new Map();

    async function medirRecebimento() {
      const porFonte = { screen: 0, camera: 0, micAudio: 0, screenAudio: 0, musica: 0 };
      const vistos = new Set();
      const leituras = [];
      peers.forEach(par => par.publicacoes.forEach(publicacao => {
        const origem = fonteDaPublicacao(publicacao);
        const fonte = origem === 'micAudio' && par.ehBot ? 'musica' : origem;
        if (!fonte || !publicacao.isSubscribed) return;
        const faixa = publicacao.track;
        if (typeof faixa?.getRTCStatsReport !== 'function') return;
        vistos.add(publicacao.trackSid);
        leituras.push(faixa.getRTCStatsReport().then(stats => {
          if (!stats) return;
          let bytes = 0;
          for (const item of stats.values()) {
            if (item.type === 'inbound-rtp' && Number.isFinite(item.bytesReceived)) bytes += item.bytesReceived;
          }
          const anterior = bytesLidos.get(publicacao.trackSid) || 0;
          bytesLidos.set(publicacao.trackSid, bytes);
          // Contador que andou para trás é faixa reiniciada, não banda devolvida.
          porFonte[fonte] += bytes >= anterior ? bytes - anterior : bytes;
        }).catch(() => { /* Faixa encerrada no meio da leitura: sai da janela, sem estrago. */ }));
      }));
      await Promise.all(leituras);
      // Faixa que não existe mais não pode continuar guardada: numa sala longa este mapa
      // cresceria sem parar, cheio de identificadores de sessões encerradas.
      for (const sid of [...bytesLidos.keys()]) if (!vistos.has(sid)) bytesLidos.delete(sid);
      // A tela que veio pela faixa de dados não tem `inbound-rtp`: sem esta soma ela sairia do
      // relatório de banda, e a tela é justamente a fonte que a medição existe para acompanhar.
      // Já vem em delta, com o mesmo cuidado de cima.
      if (telaWC) porFonte.screen += telaWC.lerBytesRecebidos();
      return porFonte;
    }

    // ---------- Aba escondida ----------
    //
    // Uma aba em segundo plano continuava recebendo tudo: as câmeras e a tela que a pessoa
    // pediu seguiam descendo para uma janela que ninguém está olhando. Com uma tela aberta,
    // são alguns Mbps por pessoa ausente -- pagos por quem hospeda, para nada.
    //
    // Só o VÍDEO é dispensado. A voz continua, porque é justamente o motivo de a aba ter
    // ficado aberta; o som da tela também, porque ouvir uma apresentação enquanto se faz
    // outra coisa é uso legítimo, e emudecê-la seria quebrar a sala para economizar.
    //
    // A espera existe porque trocar de janela é corriqueiro. Sem ela, um alt+tab de cinco
    // segundos custaria uma renegociação na ida e outra na volta, e a imagem voltaria
    // piscando a cada vez -- o remédio sendo pior que a doença. Meio minuto separa "olhei
    // outra coisa" de "saí".
    const SEGUNDOS_ESCONDIDA_ATE_PAUSAR = 30;
    let pausadaPorAusencia = false;
    let timerDaAba = null;

    // ---------- Quantas câmeras cabem ----------
    //
    // A câmera é a única fonte que cresce ao QUADRADO. Cada pessoa publica uma, e cada uma
    // desce para todas as outras: numa sala de vinte são 380 fluxos. Mesmo na camada baixa
    // isso passa de cem megabits -- mais do que a tela que todo mundo entrou para ver, e
    // pagos por quem hospeda.
    //
    // A saída não é técnica, é de produto: ninguém olha vinte câmeras. Meet e Zoom também não
    // mostram todas. O critério aqui é o do Discord -- quem falou mais recentemente fica
    // visível, o resto vira avatar até abrir a boca --, e quem está no palco ou na grade entra
    // de graça, porque foi escolha explícita de quem está assistindo.
    const MAXIMO_DE_CAMERAS = 6;
    // Rajada de trocas de orador vira UMA reavaliação. Sem isto, uma conversa cruzada faria
    // as câmeras entrarem e saírem várias vezes por segundo, e cada entrada custa uma
    // renegociação -- o remédio pior que a doença.
    const SEGUNDOS_PARA_ACOMPANHAR_A_FALA = 3;
    const ultimaFala = new Map();
    let cameraLiberada = new Set();
    let timerDeFala = null;

    // Quem tem direito a descer com imagem agora. Ordem: destaque primeiro, depois quem falou
    // por último, e ordem de chegada para desempatar -- um critério estável, para que a lista
    // não se reorganize sozinha enquanto ninguém fala.
    // Derivado das publicações, e não de `par.state`: o estado é recalculado DEPOIS de a
    // publicação ser acompanhada, então perguntar a ele aqui faria a primeira câmera de uma
    // sala parecer inexistente e nunca descer.
    function publicaCamera(par) {
      for (const publicacao of par.publicacoes.values()) {
        if (fonteDaPublicacao(publicacao) === 'camera' && !publicacao.isMuted) return true;
      }
      return false;
    }

    function escolherCameras() {
      const comCamera = [...peers.values()].filter(publicaCamera);
      const escolhidas = new Set();
      for (const par of comCamera) {
        if (ondeAparece(par.id, 'camera') !== 'plateia') escolhidas.add(par.id);
      }
      const resto = comCamera
        .filter(par => !escolhidas.has(par.id))
        .sort((a, b) => ((ultimaFala.get(b.id) || 0) - (ultimaFala.get(a.id) || 0))
          || ((a.ordem.camera || 0) - (b.ordem.camera || 0)));
      const maximo = economiaDeDados ? 2 : MAXIMO_DE_CAMERAS;
      for (const par of resto) {
        if (escolhidas.size >= maximo) break;
        escolhidas.add(par.id);
      }
      return escolhidas;
    }

    function anotarFala(oradores) {
      const agora = Date.now();
      let mexeu = false;
      for (const orador of oradores || []) {
        const id = orador?.identity;
        if (!id || orador.isLocal || !peers.has(id)) continue;
        ultimaFala.set(id, agora);
        if (!cameraLiberada.has(id)) mexeu = true;
      }
      // Quem já está visível falando de novo não muda nada: só quem está de fora justifica
      // pagar uma reavaliação.
      if (!mexeu || timerDeFala) return;
      timerDeFala = agendar(() => { timerDeFala = null; reavaliarAssinaturas(); },
        SEGUNDOS_PARA_ACOMPANHAR_A_FALA * 1000);
    }

    // Quem decide o que desce. Quatro perguntas: a fonte chega sozinha ou foi pedida? A aba
    // está escondida? É vídeo? E, sendo câmera, ela cabe no teto? Reunir isso num lugar só
    // importa porque são três caminhos diferentes que assinam faixa -- a publicação nova, o
    // clique em assistir e a reavaliação --, e bastava um esquecer uma pergunta para o teto
    // vazar por ali.
    function deveReceber(par, fonte) {
      if (!CHEGA_SOZINHA.has(fonte) && !par.assistindo) return false;
      if (pausadaPorAusencia && (fonte === 'screen' || fonte === 'camera')) return false;
      if (fonte === 'camera' && !cameraLiberada.has(par.id)) return false;
      // A tela pelo caminho novo dispensa o RTP -- e é isso que faz o dynacast desligar as
      // camadas dele em quem transmite, tirando o codificador do WebRTC do processador.
      //
      // Na transição, o RTP que JÁ estava no ar continua até a primeira imagem do caminho novo
      // chegar: monta antes de desmontar, e ninguém vê a tela piscar. Mas quem começa a
      // assistir agora não assina o RTP só para largá-lo meio segundo depois -- isso acordaria
      // o codificador de quem transmite à toa.
      if (fonte === 'screen' && telaWC) {
        const modo = telaWC.modoDaTela(par.id);
        if (modo === 'pronto') return false;
        if (modo === 'iniciando') return Boolean(par.telaPeloRtp);
      }
      return true;
    }

    // Toda reavaliação de assinatura passa por aqui quando vem de uma mudança de layout. O
    // atraso é curto o bastante para ninguém perceber e longo o bastante para o palco ter
    // parado de se mexer antes de a conta ser refeita.
    const MS_ATE_REAVALIAR = 300;
    let timerDeAssinaturas = null;

    function agendarReavaliacaoDeAssinaturas() {
      if (timerDeAssinaturas) return;
      timerDeAssinaturas = agendar(() => { timerDeAssinaturas = null; reavaliarAssinaturas(); }, MS_ATE_REAVALIAR);
    }

    function reavaliarAssinaturas() {
      cameraLiberada = escolherCameras();
      // O caminho novo primeiro: é ele que diz, logo abaixo, se o RTP da tela ainda é preciso.
      if (telaWC) peers.forEach(par => telaWC.sincronizar(par.id));
      peers.forEach(par => par.publicacoes.forEach(publicacao => {
        const fonte = fonteDaPublicacao(publicacao);
        if (!fonte) return;
        const querer = deveReceber(par, fonte);
        if (publicacao.isSubscribed !== querer) publicacao.setSubscribed(querer);
        if (querer) aplicarCamada(par, publicacao);
      }));
    }

    // Chamada pela sala a cada "visibilitychange". Voltar é imediato -- a pessoa está
    // olhando agora --, sair espera.
    // Este cancelamento precisa ser o "cancelar" do relógio da sala, e não o clearTimeout do
    // navegador. O temporizador nasce em "agendar" -- no relógio do Worker, justamente para
    // não ser estrangulado pela aba em segundo plano, que é quando ele importa. Cancelado
    // pela API errada, ele sobrevivia: alt+tab rápido deixava um disparo pendente que
    // acordava DEPOIS de a pessoa já estar olhando, pausava o vídeo dela e não tinha quem
    // desfizesse -- só outro visibilitychange, que não vem de quem está parado assistindo.
    // O áudio continuava, porque a pausa só alcança vídeo. Tela preta com som.
    function definirAbaVisivel(visivel) {
      cancelar(timerDaAba);
      timerDaAba = null;
      if (visivel) {
        if (!pausadaPorAusencia) return;
        pausadaPorAusencia = false;
        window.registrarDiagnostico?.('midia.abaVoltou');
        reavaliarAssinaturas();
        return;
      }
      if (pausadaPorAusencia) return;
      timerDaAba = agendar(() => {
        timerDaAba = null;
        pausadaPorAusencia = true;
        window.registrarDiagnostico?.('midia.abaEscondida', 'vídeo pausado');
        reavaliarAssinaturas();
      }, SEGUNDOS_ESCONDIDA_ATE_PAUSAR * 1000);
    }

    function acompanharPublicacao(par, publicacao) {
      par.publicacoes.set(publicacao.trackSid, publicacao);
      const fonte = fonteDaPublicacao(publicacao);
      if (!fonte) return;
      // A tela voltou dentro da folga: era um ajuste, nao uma saida. Segue assistindo.
      if (fonte === 'screen' && par.toleranciaDaTroca) {
        cancelar(par.toleranciaDaTroca);
        par.toleranciaDaTroca = null;
      }
      // O som da tela acompanha a imagem: assistir sem ouvir (ou ouvir sem ver) nao e um
      // estado que alguem peca.
      //
      // A câmera que acabou de ser anunciada pode caber no teto -- ou empurrar outra para
      // fora. Refazer a conta aqui é o que permite decidir por esta faixa com a sala inteira
      // em vista, em vez de com a foto de antes dela existir.
      if (fonte === 'camera') cameraLiberada = escolherCameras();
      const querer = deveReceber(par, fonte);
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
        // Presença vem pela sinalização da sala e dura até a pessoa trocá-la. Recalcular
        // câmera/microfone a cada publicação não pode apagar esse estado independente.
        presenca: antes.presenca || '',
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

    // ---------- Música aguenta esperar; conversa, não ----------
    //
    // O navegador guarda uns 30 ms de áudio antes de tocar, e esse número existe para
    // CONVERSA: cada milissegundo a mais é um milissegundo de atraso entre alguém falar e
    // o outro ouvir. O preço é não ter folga nenhuma -- num Wi-Fi que oscila ou numa rede
    // móvel, qualquer pacote que chegue fora de hora vira um engasgo audível, porque não
    // havia reserva para cobrir o atraso.
    //
    // Com o bot, esse preço não se justifica: ninguém conversa com a música. Meio segundo
    // de reserva absorve a oscilação inteira sem que nada se perca -- e como o alvo é o
    // mesmo em todas as telas, quem está na mesma sala continua ouvindo junto.
    //
    // Vale só para a faixa do bot. A voz das pessoas continua com a folga curta de sempre.
    const MS_DE_RESERVA_PARA_MUSICA = 500;

    function amortecerSeForMusica(par, publicacao) {
      if (!par.ehBot || fonteDaPublicacao(publicacao) !== 'micAudio') return;
      const receptor = publicacao.track?.receiver || publicacao.receiver;
      if (!receptor) return;
      try {
        // `jitterBufferTarget` é o nome padronizado; `playoutDelayHint` é o antigo do
        // Chrome. Escrever nos dois cobre as duas gerações sem precisar detectar versão.
        if ('jitterBufferTarget' in receptor) receptor.jitterBufferTarget = MS_DE_RESERVA_PARA_MUSICA;
        else if ('playoutDelayHint' in receptor) receptor.playoutDelayHint = MS_DE_RESERVA_PARA_MUSICA / 1000;
      } catch (_) { /* Navegador sem o ajuste: fica com a folga padrão, como antes. */ }
    }

    function guardarFaixa(par, publicacao, faixa) {
      const fonte = fonteDaPublicacao(publicacao);
      if (!fonte) return;
      if (fonte === 'screen') {
        // A tela tem duas origens possíveis, e a do RTP fica guardada à parte: ela é a reserva
        // enquanto o caminho novo não tem imagem, e a imagem inteira quando ele sai do ar.
        par.telaPeloRtp = faixa ? new MediaStream([faixa.mediaStreamTrack]) : null;
        escolherOrigemDaTela(par);
      } else {
        par.remoteStreams[fonte] = faixa ? new MediaStream([faixa.mediaStreamTrack]) : new MediaStream();
      }
      aoMudarMidia(par.id);
    }

    // ---------- A tela por WebCodecs ----------
    //
    // A interface lê `par.remoteStreams.screen` e não sabe de onde a imagem vem. Quem escolhe é
    // esta função: a da faixa de dados quando ela já tem imagem, senão a do RTP. O objeto só
    // é trocado quando a origem muda de verdade -- cada troca faz o palco religar o vídeo, e
    // trocar à toa seria uma piscada a cada conferência.
    function escolherOrigemDaTela(par) {
      const desejada = telaWC?.streamDe(par.id) || par.telaPeloRtp || null;
      if (desejada) {
        if (par.remoteStreams.screen !== desejada) par.remoteStreams.screen = desejada;
      } else if (par.remoteStreams.screen.getTracks().length) {
        par.remoteStreams.screen = new MediaStream();
      }
    }

    // O caminho novo mudou de estado para a tela desta pessoa: a primeira imagem chegou, a
    // faixa de dados apareceu ou sumiu, a recepção foi encerrada. A assinatura do RTP é
    // refeita com a pergunta de sempre, e é ela que decide se a reserva desce ou não.
    function aoMudarTelaPorWebCodecs(id) {
      const par = peers.get(id);
      if (!par) return;
      escolherOrigemDaTela(par);
      par.publicacoes.forEach(publicacao => {
        if (fonteDaPublicacao(publicacao) !== 'screen') return;
        const querer = deveReceber(par, 'screen');
        if (publicacao.isSubscribed !== querer) publicacao.setSubscribed(querer);
        if (querer) aplicarCamada(par, publicacao);
      });
      aoMudarMidia(id);
    }

    const telaWC = root.NexoTelaWebCodecs?.disponivel() ? root.NexoTelaWebCodecs.criar({
      sala, LK,
      querTela: id => Boolean(peers.get(id)?.assistindo) && !pausadaPorAusencia,
      camadaPedida: id => camadaDaTelaPorWebCodecs(id),
      aoMudarTela: aoMudarTelaPorWebCodecs,
      agendar, cancelar, repetir,
      registrar: (evento, detalhe) => window.registrarDiagnostico?.(evento, detalhe)
    }) : null;

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
          cancelar(par.toleranciaDaTroca);
          par.toleranciaDaTroca = agendar(() => { par.assistindo = false; aoMudarEstado(par); },
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
        amortecerSeForMusica(par, publicacao);
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
      // Quem fala sobe na fila das câmeras visíveis. É o mesmo critério do Discord, e é o que
      // torna o teto aceitável: a pessoa que está falando aparece, mesmo que tenha entrado por
      // último numa sala cheia.
      .on(LK.RoomEvent.ActiveSpeakersChanged, oradores => anotarFala(oradores))
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
        cancelar(par.timeoutDeAusencia);
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
        telaWC?.aoDesconectar();
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
        telaWC?.aoRetomar();
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
      // O teto de câmeras se autocorrige aqui. Ele é mexido por vários caminhos -- alguém
      // falou, alguém ligou a câmera, o palco mudou, a aba voltou --, e esta passada é a
      // única que não depende de nenhum evento ter chegado.
      reavaliarAssinaturas();
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
      // Antes de adotar quem já está na sala: a adoção pergunta ao caminho novo se a tela de
      // cada um vem por ele, e ele precisa saber que a sala está no ar para responder.
      telaWC?.aoConectar();
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
      cancelar(par.toleranciaDaTroca);
      par.toleranciaDaTroca = null;
      par.assistindo = Boolean(ligar);
      // Parar de assistir e uma decisao, nao um acidente: apaga a anotacao, ou uma queda
      // logo depois traria de volta uma tela que a pessoa acabou de dispensar.
      if (!par.assistindo) assistiaAoCair.delete(id);
      // O caminho novo decide primeiro: com a recepção por ele já aberta, a pergunta de baixo
      // responde que o RTP da tela não precisa descer.
      telaWC?.sincronizar(id);
      par.publicacoes.forEach(publicacao => {
        const fonte = fonteDaPublicacao(publicacao);
        if (fonte !== 'screen' && fonte !== 'screenAudio') return;
        const querer = deveReceber(par, fonte);
        publicacao.setSubscribed(querer);
        if (querer) aplicarCamada(par, publicacao);
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
      definirExibicao,
      definirAbaVisivel,
      medirRecebimento,
      // A tela por WebCodecs. `null` num navegador sem os módulos, e então tudo segue pelo RTP.
      telaWebCodecs: telaWC,
      definirEconomia(ativa) {
        economiaDeDados = Boolean(ativa);
        aplicarCamadaEmTodos();
        reavaliarAssinaturas();
      },

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
