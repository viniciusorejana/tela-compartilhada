/* As decisões da tela por WebCodecs, sem navegador.
 *
 * O caminho novo tem quatro perguntas que se respondem com aritmética e histerese -- por qual
 * caminho a tela vai, como cada camada cede quando aperta, que camada cada espectador pede e
 * qual nível de H.264 declarar -- e é exatamente esse tipo de lógica que passa a oscilar em
 * silêncio depois de um ajuste aparentemente inofensivo. Aqui elas são funções puras: recebem
 * o estado inteiro e devolvem o novo, e os testes as exercitam sem abrir uma sala.
 */
(function (root) {
  // ---------- Por qual caminho a tela vai ----------
  //
  // Tudo ou nada por transmissão. Se alguém na sala não decodifica, a tela inteira vai pelo
  // caminho de hoje: publicar pelos dois ao mesmo tempo cobraria a codificação em software de
  // qualquer jeito, e o ganho -- tirar a codificação do processador de quem joga --
  // evaporaria.
  //
  // O motivo volta junto, sempre. Um interruptor que muda de caminho sem dizer por quê vira
  // superstição, e o Diagnóstico mostra esta frase para quem transmite.

  // Quem acabou de entrar ainda não se apresentou. Sem esta folga, cada entrada na sala
  // derrubaria a transmissão para o caminho de hoje e a traria de volta um segundo depois.
  const MS_DE_FOLGA_PARA_SE_APRESENTAR = 4000;
  const NOME_DO_CODEC = { h264: 'H.264', vp8: 'VP8' };

  // O servidor de mídia a partir do qual o automático confia nas faixas de dados. A 1.13.6
  // TRAVA a sinalização de quem assina uma faixa de dados no instante em que ela é removida:
  // dali em diante nenhum pedido daquela pessoa é atendido -- nem a volta para o RTP --, e a
  // tela fica preta até ela recarregar. Reproduzido aqui, e corrigido na 1.13.7 ("data track
  // subscription deadlock", livekit#4843). O "Forçar WebCodecs" passa por cima, para diagnóstico.
  const VERSAO_MINIMA_DO_SERVIDOR = [1, 13, 7];
  function servidorConfiavel(versao) {
    const partes = String(versao || '').split('.').map(Number);
    if (partes.length < 3 || partes.some(n => !Number.isFinite(n))) return false;
    for (let i = 0; i < 3; i++) {
      if (partes[i] !== VERSAO_MINIMA_DO_SERVIDOR[i]) return partes[i] > VERSAO_MINIMA_DO_SERVIDOR[i];
    }
    return true;
  }

  function decidirModo({
    telaNoAr, desligadoPeloServidor, preferencia, envio = {}, falha = null,
    participantes = [], modoAtual = 'rtp', agora = Date.now(), versaoDoServidor = null
  }) {
    const rtp = motivo => ({ modo: 'rtp', codec: null, motivo, aguardando: false });
    if (!telaNoAr) return rtp('sem tela no ar');
    if (desligadoPeloServidor) return rtp('desligado no servidor para todo mundo');
    if (preferencia === 'desligada') return rtp('desligado por você, em Qualidade');
    if (falha) return rtp(falha);
    if (!envio.captura) return rtp('este navegador não entrega os quadros da tela ao codificador');
    const codecsDoEnvio = [];
    if (envio.h264Hardware || (preferencia === 'sempre' && envio.h264)) codecsDoEnvio.push('h264');
    // VP8 só no "Forçar WebCodecs": o automático existe para tirar a codificação do processador,
    // e VP8 nunca sai da placa de vídeo. Ele fica para o diagnóstico -- e para os testes, que
    // rodam num Chromium sem placa.
    if (preferencia === 'sempre' && envio.vp8) codecsDoEnvio.push('vp8');
    if (!codecsDoEnvio.length) {
      return rtp(preferencia === 'sempre'
        ? 'este navegador não codifica H.264 nem VP8 por WebCodecs'
        : 'sem codificação de H.264 pela placa de vídeo nesta máquina');
    }
    // Depois da placa: sem ela, a versão do servidor nem chega a importar, e o motivo mostrado
    // deve ser o que a pessoa pode resolver primeiro.
    if (preferencia !== 'sempre' && !servidorConfiavel(versaoDoServidor)) {
      return rtp(`o servidor de mídia é a ${versaoDoServidor || 'versão desconhecida'}; o automático pede a 1.13.7 ou mais nova`);
    }

    let codecs = codecsDoEnvio;
    let aguardando = false;
    for (const p of participantes) {
      if (!p.cap) {
        if (agora - (p.chegouEm || 0) < MS_DE_FOLGA_PARA_SE_APRESENTAR) { aguardando = true; continue; }
        return rtp(`${p.nome} está numa versão do Nexo que não recebe por aqui`);
      }
      if (!p.cap.recebe) return rtp(`${p.nome} não pode receber por WebCodecs (desligado ou sem suporte)`);
      codecs = codecs.filter(c => p.cap.dec.includes(c));
      if (!codecs.length) return rtp(`${p.nome} não decodifica ${codecsDoEnvio.map(c => NOME_DO_CODEC[c] || c).join(' nem ')} por WebCodecs`);
    }
    // Com alguém ainda por se apresentar, fica onde está: decidir agora seria decidir no
    // escuro, e a decisão errada custa uma troca de caminho à vista de todos.
    if (aguardando && modoAtual !== 'webcodecs') return { ...rtp('esperando quem acabou de entrar se apresentar'), aguardando: true };
    const codec = codecs[0];
    const pelaPlaca = codec === 'h264' && envio.h264Hardware;
    return {
      modo: 'webcodecs', codec, aguardando,
      motivo: pelaPlaca ? 'codificação pela placa de vídeo' : 'ligado em "Sempre", codificando no processador'
    };
  }

  // ---------- Quanto uma resolução precisa ----------
  //
  // O piso de qualidade aceitável em cada degrau, na mesma forma do teto de quality-utils.js:
  // bits por pixel, com a taxa de quadros entrando pela raiz -- quadros vizinhos se parecem, e
  // é disso que a compressão vive. O fator é 0,025 contra os 0,064 do teto: abaixo disto, na
  // resolução atual, a imagem vira pasta, e um degrau menor com o mesmo orçamento fica mais
  // nítido do que ela.
  const BPP_MINIMO = 0.025;
  function necessario(largura, altura, quadros) {
    return BPP_MINIMO * largura * altura * 30 * Math.sqrt(Math.max(1, quadros) / 30);
  }

  // Cada degrau divide largura e altura. O último fica perto de 360p a partir de 1080p, e
  // abaixo dele existe a camada baixa: a alta não precisa descer até lá.
  const ESCALAS = [1, 1.25, 1.5, 2, 2.5, 3];
  // Na prioridade de nitidez, o que cede são os quadros, e a resolução fica.
  const QUADROS_POSSIVEIS = [60, 30, 24, 20, 15, 10];
  const ALTURA_MINIMA_DA_ALTA = 360;

  // Múltiplos de 2: os codificadores de H.264 exigem, e uma dimensão ímpar faz o `configure`
  // falhar do jeito mais calado possível -- na primeira codificação, e não na chamada.
  const par = valor => Math.max(2, Math.round(valor / 2) * 2);

  function dimensoesNaEscala(fonte, escala) {
    return { largura: par(fonte.largura / escala), altura: par(fonte.altura / escala) };
  }

  // Cabe a fonte dentro de uma caixa, sem distorcer. Serve à camada baixa, que é uma caixa de
  // 640x360 em que a tela entra inteira, qualquer que seja o formato dela.
  function caberNaCaixa(fonte, caixa) {
    const fator = Math.min(1, caixa.largura / fonte.largura, caixa.altura / fonte.altura);
    return { largura: par(fonte.largura * fator), altura: par(fonte.altura * fator) };
  }

  // ---------- O que a placa aceita, quando ela não aceita o pedido ----------
  //
  // Há placa que codifica H.264 e mesmo assim recusa o tamanho ou a taxa pedidos: gráfico
  // integrado limitado a 1080p, notebook que não faz 60 quadros acima de 720p. A saída mais
  // barata seria cair para o processador no tamanho cheio -- e é a pior: o processador é
  // justamente o que o caminho novo existe para poupar. Então a escada desce AINDA NA PLACA, e
  // desce pelo lado que a prioridade manda ceder: em movimento, a resolução (1440p60 vira
  // 1080p60, depois 720p60); em nitidez, os quadros (1440p60 vira 1440p30).
  const ALTURAS_DA_PLACA = [1440, 1080, 720];

  function degrausDaPlaca(alvo, prioridade = 'fluidez') {
    const noTamanho = altura => ({ largura: par(alvo.largura * altura / alvo.altura), altura });
    const menores = ALTURAS_DA_PLACA.filter(altura => altura < alvo.altura).map(noTamanho);
    const cheio = { largura: alvo.largura, altura: alvo.altura };
    const taxaMenor = alvo.quadros > 30 ? 30 : null;
    const degraus = [{ ...cheio, quadros: alvo.quadros }];
    if (prioridade === 'nitidez') {
      if (taxaMenor) degraus.push({ ...cheio, quadros: taxaMenor });
      for (const tamanho of menores) degraus.push({ ...tamanho, quadros: taxaMenor || alvo.quadros });
    } else {
      for (const tamanho of menores) degraus.push({ ...tamanho, quadros: alvo.quadros });
      if (taxaMenor) for (const tamanho of [cheio, ...menores]) degraus.push({ ...tamanho, quadros: taxaMenor });
    }
    return degraus;
  }

  // ---------- Como uma camada cede e se recupera ----------
  //
  // Três sinais, e nenhum decide sozinho o que o outro deveria decidir:
  //  - a SAÍDA apertada (o portão de envio pulou quadro, ou o buffer do canal cresceu) diz que
  //    a banda de subida não comporta o que estamos mandando;
  //  - a PERDA relatada por quem assiste diz o mesmo sobre o caminho até eles;
  //  - o CODIFICADOR apertado diz que o problema não é rede: é o tempo de codificar.
  //
  // Rede apertada corta o orçamento; orçamento curto demais para a resolução troca a
  // resolução (ou, em nitidez, os quadros). Codificador apertado troca a resolução direto,
  // porque cortar bits não deixa a codificação mais barata.
  //
  // Descer é rápido; subir espera. É a mesma assimetria de tudo nesta sala: subir a cada
  // respiro é o que cria o ciclo de afogar, recuperar e afogar de novo.
  const SEGUNDOS_PARA_CRESCER_O_ORCAMENTO = 3;
  const SEGUNDOS_PARA_SUBIR_DE_DEGRAU = 10;
  const SEGUNDOS_ENTRE_DEGRAUS_PARA_BAIXO = 2;
  const PERDA_QUE_APERTA = 0.05;
  const FATOR_DE_CORTE = 0.75;

  function iniciarCamada({ fonte, alvo, prioridade = 'fluidez', tetoPara }) {
    const teto = tetoPara || ((l, a, q) => alvo.bitrateMax);
    // O ponto de partida é o que o alvo pede, e não o degrau mais baixo: começar pequeno e
    // subir custaria dez segundos de imagem ruim em toda transmissão, para proteger um caso --
    // a rede que não aguenta -- que a própria adaptação descobre em dois.
    const quadros = alvo.quadros;
    const estado = {
      fonte, alvo, prioridade, escala: 1, quadros,
      bitrate: Math.min(alvo.bitrateMax, teto(fonte.largura, fonte.altura, quadros)),
      folgas: 0, apertosDoCodificador: 0, segundosDesdeODegrau: 99
    };
    // A fonte pode ser maior que o alvo (monitor de 1440p com perfil de 1080p): o primeiro
    // degrau é o que já cabe no alvo, e não a escala 1.
    while (estado.escala < ESCALAS[ESCALAS.length - 1]) {
      const d = dimensoesNaEscala(fonte, estado.escala);
      if (d.largura <= alvo.largura && d.altura <= alvo.altura) break;
      estado.escala = ESCALAS[ESCALAS.indexOf(estado.escala) + 1];
    }
    estado.escalaInicial = estado.escala;
    return { ...estado, ...dimensoesNaEscala(fonte, estado.escala) };
  }

  function ajustarCamada(estado, sinais, tetoPara) {
    const teto = tetoPara || (() => estado.alvo.bitrateMax);
    const novo = { ...estado, segundosDesdeODegrau: estado.segundosDesdeODegrau + 1 };
    const indice = ESCALAS.indexOf(novo.escala);
    const podeEncolher = () => {
      const proxima = ESCALAS[indice + 1];
      if (!proxima) return false;
      return dimensoesNaEscala(novo.fonte, proxima).altura >= Math.min(ALTURA_MINIMA_DA_ALTA, novo.fonte.altura);
    };
    const quadrosAbaixo = () => QUADROS_POSSIVEIS.find(q => q < novo.quadros);
    const quadrosAcima = () => [...QUADROS_POSSIVEIS].reverse().find(q => q > novo.quadros && q <= novo.alvo.quadros);
    const ceder = motivo => {
      if (novo.segundosDesdeODegrau < SEGUNDOS_ENTRE_DEGRAUS_PARA_BAIXO) return false;
      if (novo.prioridade === 'nitidez') {
        const q = quadrosAbaixo();
        if (!q) return false;
        novo.quadros = q;
      } else {
        if (!podeEncolher()) return false;
        novo.escala = ESCALAS[indice + 1];
      }
      novo.segundosDesdeODegrau = 0;
      novo.ultimaMudanca = motivo;
      return true;
    };

    const saidaApertada = Boolean(sinais.saidaApertada) || (sinais.perda ?? 0) > PERDA_QUE_APERTA;
    if (sinais.codificadorApertado) {
      novo.apertosDoCodificador += 1;
      novo.folgas = 0;
      if (novo.apertosDoCodificador >= 2 && ceder('codificador')) novo.apertosDoCodificador = 0;
    } else {
      novo.apertosDoCodificador = 0;
    }

    if (saidaApertada) {
      novo.folgas = 0;
      novo.bitrate = Math.max(novo.alvo.bitrateMin, Math.round(novo.bitrate * FATOR_DE_CORTE));
      const d = dimensoesNaEscala(novo.fonte, novo.escala);
      if (novo.bitrate < necessario(d.largura, d.altura, novo.quadros)) ceder('rede');
    } else if (!sinais.codificadorApertado) {
      novo.folgas += 1;
      const d = dimensoesNaEscala(novo.fonte, novo.escala);
      const tetoAqui = Math.min(novo.alvo.bitrateMax, teto(d.largura, d.altura, novo.quadros));
      if (novo.folgas % SEGUNDOS_PARA_CRESCER_O_ORCAMENTO === 0 && novo.bitrate < tetoAqui) {
        novo.bitrate = Math.min(tetoAqui, Math.round(novo.bitrate * 1.1 + 100_000));
      }
      if (novo.folgas >= SEGUNDOS_PARA_SUBIR_DE_DEGRAU) {
        if (novo.prioridade === 'nitidez') {
          const q = quadrosAcima();
          if (q && novo.bitrate >= necessario(d.largura, d.altura, q) * 1.2) {
            novo.quadros = q; novo.folgas = 0; novo.segundosDesdeODegrau = 0; novo.ultimaMudanca = 'folga';
          }
        } else if (novo.escala > novo.escalaInicial) {
          const acima = ESCALAS[indice - 1];
          const da = dimensoesNaEscala(novo.fonte, acima);
          if (novo.bitrate >= necessario(da.largura, da.altura, novo.quadros) * 1.2) {
            novo.escala = acima; novo.folgas = 0; novo.segundosDesdeODegrau = 0; novo.ultimaMudanca = 'folga';
          }
        }
      }
    }
    // Com a resolução ou os quadros menores, o teto também é menor: mandar 6 Mbps para 720p
    // é pagar por bits que a imagem não aproveita.
    const final = dimensoesNaEscala(novo.fonte, novo.escala);
    novo.bitrate = Math.min(novo.bitrate, Math.min(novo.alvo.bitrateMax, teto(final.largura, final.altura, novo.quadros)));
    return { ...novo, ...final };
  }

  // ---------- Que camada o espectador pede ----------
  //
  // O lugar na tela decide primeiro, como no caminho de hoje: a camada cheia é do palco, e a
  // grade e o quadradinho ficam com a de 360p. Depois vem a conexão de quem assiste: perda
  // sustentada, ou pedidos de quadro-chave em série, rebaixam para a camada leve por um tempo.
  // É a versão desta sala do "a camada que a conexão aguenta" que o servidor fazia no RTP.
  const PERDA_QUE_REBAIXA = 0.08;
  const PEDIDOS_QUE_REBAIXAM = 3;
  const MS_REBAIXADO = 20000;

  function camadaDoEspectador(estado, { pedida, perda = 0, pedidosDeChave = 0, agora = Date.now() }) {
    const rebaixadaAte = (perda > PERDA_QUE_REBAIXA || pedidosDeChave >= PEDIDOS_QUE_REBAIXAM)
      ? agora + MS_REBAIXADO : (estado?.rebaixadaAte || 0);
    const camada = pedida === 'baixa' || agora < rebaixadaAte ? 'baixa' : 'alta';
    return { camada, rebaixadaAte };
  }

  // ---------- O nome do codec ----------
  //
  // O nível do H.264 declara o tamanho e a taxa máximos do fluxo, e o decodificador recusa o
  // que passar dele. Declarar sempre o mais alto parece seguro e não é: há decodificador que
  // recusa um nível alto mesmo com o fluxo pequeno. Então o nível é o menor que cabe.
  const NIVEIS_H264 = [
    // [nível, macroblocos por quadro, macroblocos por segundo]
    [0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2a, 8704, 522240],
    [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600]
  ];
  function nivelH264(largura, altura, quadros) {
    const blocos = Math.ceil(largura / 16) * Math.ceil(altura / 16);
    const porSegundo = blocos * Math.max(1, quadros);
    const nivel = NIVEIS_H264.find(([, porQuadro, maximo]) => blocos <= porQuadro && porSegundo <= maximo);
    return (nivel || NIVEIS_H264[NIVEIS_H264.length - 1])[0];
  }
  const hex = n => n.toString(16).toUpperCase().padStart(2, '0');
  // High primeiro: comprime melhor, e toda placa e todo celular recente decodificam. Os
  // outros ficam para o codificador que só sabe fazer o básico -- o de software do Chrome é
  // um deles.
  const PERFIS_H264 = [['alto', '6400'], ['principal', '4D00'], ['basico', '42E0']];
  function codecsH264(largura, altura, quadros) {
    const nivel = hex(nivelH264(largura, altura, quadros));
    return PERFIS_H264.map(([perfil, prefixo]) => ({ perfil, codec: `avc1.${prefixo}${nivel}` }));
  }

  const api = {
    decidirModo, MS_DE_FOLGA_PARA_SE_APRESENTAR, servidorConfiavel, VERSAO_MINIMA_DO_SERVIDOR,
    necessario, ESCALAS, QUADROS_POSSIVEIS, dimensoesNaEscala, caberNaCaixa, iniciarCamada, ajustarCamada, degrausDaPlaca,
    SEGUNDOS_PARA_SUBIR_DE_DEGRAU, PERDA_QUE_APERTA,
    camadaDoEspectador, MS_REBAIXADO,
    nivelH264, codecsH264
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaDecisoes = api;
})(typeof window === 'undefined' ? globalThis : window);
