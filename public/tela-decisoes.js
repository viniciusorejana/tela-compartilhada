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
      if (!p.cap.recebe) return rtp(`${p.nome} não pode receber por WebCodecs (desligado, sem suporte ou depois de uma falha)`);
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
      motivo: pelaPlaca ? 'codificação pela placa de vídeo' : 'WebCodecs forçado, codificando no processador'
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
  //
  // Sustentada quer dizer DUAS janelas seguidas. Um segundo ruim só -- um quadro-chave que se
  // perdeu, uma troca de cena que atrasou -- rebaixava por 20 s, e numa rede de verdade isso
  // punha a sala inteira em 360p quase o tempo todo (medido contra a VPS: um único segundo de
  // perda deixou os três espectadores 20 s na camada leve, com a rede já boa de novo). O tempo
  // rebaixado começa curto e só cresce se a conexão voltar a apertar logo depois.
  const PERDA_QUE_REBAIXA = 0.08;
  const PEDIDOS_QUE_REBAIXAM = 3;
  const JANELAS_RUINS_PARA_REBAIXAR = 2;
  const MS_REBAIXADO = 8000;
  const MS_REBAIXADO_MAXIMO = 32000;
  const MS_PARA_ESQUECER_O_REBAIXAMENTO = 60000;

  // `novaJanela`: a medição é de um segundo que ainda não foi contado. A camada é recalculada
  // sempre que algo muda na tela, várias vezes por segundo, e a mesma janela contada de novo a
  // cada vez rebaixaria por um segundo ruim só.
  function camadaDoEspectador(estado, { pedida, perda = 0, pedidosDeChave = 0, novaJanela = true, agora = Date.now() }) {
    let seguidas = estado?.seguidas || 0;
    let rebaixadaAte = estado?.rebaixadaAte || 0;
    let vezes = estado?.vezes || 0;
    if (novaJanela) {
      const ruim = perda > PERDA_QUE_REBAIXA || pedidosDeChave >= PEDIDOS_QUE_REBAIXAM;
      seguidas = ruim ? seguidas + 1 : 0;
      if (seguidas >= JANELAS_RUINS_PARA_REBAIXAR && agora >= rebaixadaAte) {
        // Rebaixar de novo pouco depois de voltar é sinal de que a volta foi cedo demais.
        vezes = rebaixadaAte && agora - rebaixadaAte < MS_PARA_ESQUECER_O_REBAIXAMENTO ? vezes + 1 : 1;
        rebaixadaAte = agora + Math.min(MS_REBAIXADO * 2 ** (vezes - 1), MS_REBAIXADO_MAXIMO);
      }
    }
    const rebaixada = agora < rebaixadaAte;
    const camada = pedida === 'baixa' || rebaixada ? 'baixa' : 'alta';
    return { camada, rebaixada, rebaixadaAte, seguidas, vezes };
  }

  // ---------- O caminho novo está entregando? ----------
  //
  // A faixa de dados custa ao servidor de mídia umas quatro vezes o processador do RTP por
  // megabit: ali cada pacote passa pelo SCTP, com confirmação, fila e temporizador, e não é só
  // repassado. Medido no mesmo servidor, 1440p60 para três espectadores: 28,6% de um núcleo pela
  // faixa de dados contra 5,5% pelo RTP. Numa máquina pequena (a VPS da Oracle do primeiro teste
  // de verdade), isso basta para o servidor engasgar: a tela chega atrasada, com perda, todo mundo cai para 360p --
  // e às vezes a faixa para de chegar de vez, sem voltar. Pelo RTP, a mesma máquina fica folgada.
  //
  // Então quem transmite confere, a cada segundo, o que cada espectador relata, e desiste do
  // caminho novo quando ele não entrega o que o RTP entregaria (a espera até tentar de novo é a
  // mesma de qualquer falha, `esperaAteTentarDeNovo`).
  //
  // Uma janela de um espectador é:
  //  - PARADA quando a camada saiu da placa e o relato diz que nada chegou;
  //  - RUIM quando chegou com atraso de fila, com perda que o reenvio não cobriu, ou quando a
  //    pessoa está rebaixada para a camada leve pela conexão.
  const MS_DE_ATRASO_RUIM = 350;
  const PERDA_RUIM = 0.1;
  const QUADROS_PARA_JULGAR_PARADA = 5;
  const JANELAS_PARADAS_QUE_DERRUBAM = 3;
  const JANELAS_DA_SAUDE = 8;
  const JANELAS_RUINS_QUE_DERRUBAM = 4;

  function janelaDoEspectador(relato, quadrosEnviados) {
    if (!relato) return { parado: quadrosEnviados >= QUADROS_PARA_JULGAR_PARADA, ruim: true };
    const parado = quadrosEnviados >= QUADROS_PARA_JULGAR_PARADA && !(relato.recebidos > 0);
    const total = (relato.recebidos || 0) + (relato.perdidos || 0);
    const perda = total ? relato.perdidos / total : 0;
    const ruim = parado || perda > PERDA_RUIM || (Number.isFinite(relato.atrasoMs) && relato.atrasoMs > MS_DE_ATRASO_RUIM) || relato.rebaixada === true;
    return { parado, ruim };
  }

  // `espectadores`: [{ nome, janelas: [{ parado, ruim }, ...] }], da janela mais velha para a mais
  // nova. Devolve o motivo de desistir, ou `null`.
  //
  // Parada derruba por UMA pessoa: é imagem congelada, e o RTP a traz de volta. Ruim só derruba
  // quando é a MAIORIA: uma pessoa com a rede ruim desce sozinha para a camada leve, e a sala
  // inteira não troca de caminho por causa dela.
  function caminhoFalhando(espectadores) {
    for (const { nome, janelas } of espectadores) {
      const ultimas = janelas.slice(-JANELAS_PARADAS_QUE_DERRUBAM);
      if (ultimas.length === JANELAS_PARADAS_QUE_DERRUBAM && ultimas.every(j => j.parado)) {
        return `a imagem parou de chegar a ${nome}`;
      }
    }
    const comProblema = espectadores.filter(({ janelas }) => janelas.slice(-JANELAS_DA_SAUDE).filter(j => j.ruim).length >= JANELAS_RUINS_QUE_DERRUBAM);
    if (espectadores.length && comProblema.length > espectadores.length / 2) {
      return 'a imagem chegava atrasada ou com perda a quem assiste (o servidor de mídia pode estar sem folga)';
    }
    return null;
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

  // ---------- A captura que não passa de ~30 ----------
  //
  // No Windows 10 o Chrome captura a tela pelo DXGI, com a GDI de reserva
  // (`FallbackDesktopCapturerWrapper`, no WebRTC). Um erro PERMANENTE do DXGI -- o monitor que
  // some numa troca de resolução, o quadro que não pôde ser preparado no tamanho novo -- passa a
  // captura para a GDI até o fim dela. E o Chrome limita a captura a 50% de um núcleo: o período
  // vira o dobro do tempo de cada captura. Medido nesta máquina, com a tela em movimento: 57
  // quadros pelo DXGI, 29 pela GDI. Só uma captura nova volta ao DXGI.
  //
  // A assinatura é o intervalo entre quadros, e não a média. O DXGI entrega na cadência do
  // monitor, e bastam duas mudanças seguidas para aparecer um intervalo de ~17 ms; a GDI nunca
  // entrega dois quadros a menos de ~30 ms. Movimento de sobra (mais de 20 quadros por segundo)
  // e nenhum intervalo curto em dez segundos: a captura está presa.
  //
  // O que isto não separa é o conteúdo que roda a 30 de verdade -- um vídeo, um jogo travado em
  // 30 --, com nada mais mudando na tela. Por isso a sala só SUGERE compartilhar de novo.
  const MS_DE_INTERVALO_CURTO = 24;
  const SEGUNDOS_PARA_CONCLUIR_CAPTURA_PRESA = 10;
  function capturaPresa(janelas, quadrosPedidos) {
    if (!(quadrosPedidos >= 50) || janelas.length < SEGUNDOS_PARA_CONCLUIR_CAPTURA_PRESA) return null;
    let quadros = 0, curtos = 0, segundos = 0;
    for (const j of janelas.slice(-SEGUNDOS_PARA_CONCLUIR_CAPTURA_PRESA)) {
      quadros += j.quadros; curtos += j.curtos; segundos += j.segundos;
    }
    if (segundos <= 0) return null;
    const fps = quadros / segundos;
    if (fps < 20 || fps > 40 || curtos > quadros * 0.02) return null;
    return { fps: Math.round(fps) };
  }

  // Quanto esperar antes de tentar o WebCodecs de novo, depois de uma falha no meio da
  // transmissão. Uma falha só era para sempre: o codificador que se perdeu numa troca de
  // resolução, ou a placa ocupada por um instante, deixavam a tela no WebRTC até alguém parar e
  // compartilhar de novo. A espera cresce para uma falha que se repete não virar troca de
  // caminho à vista de todos a cada dez segundos.
  const MS_ATE_TENTAR_DE_NOVO = [10_000, 30_000, 90_000, 300_000];
  const esperaAteTentarDeNovo = falhas => MS_ATE_TENTAR_DE_NOVO[Math.min(Math.max(falhas, 1), MS_ATE_TENTAR_DE_NOVO.length) - 1];

  // ========== A placa de vídeo pelo RTP (tela-placa-rtp.js) ==========
  //
  // A tela sai por uma publicação RTP comum, mas o conteúdo de cada quadro é trocado, numa
  // encoded transform, pelo quadro que a placa codificou. O servidor de mídia só repassa RTP --
  // umas três vezes menos processador por megabit do que a faixa de dados (medido,
  // docs/plano-webcodecs.md, "A placa pelo RTP") --, e quem assiste decodifica como sempre, em
  // qualquer navegador.

  // Por que a tela vai (ou não) pela placa. Ao contrário da faixa de dados, quem assiste não
  // entra na conta: RTP todo mundo recebe. Só o "Automático" usa: "Forçar WebCodecs" continua
  // levando à faixa de dados, que é o que ele sempre quis dizer e o que os testes exercitam.
  function decidirTelaPelaPlaca({ preferencia, desligadoPeloServidor, suportado, h264Hardware, falhaAte = 0, agora = Date.now() }) {
    const nao = motivo => ({ usar: false, motivo });
    if (preferencia !== 'automatico') return nao(preferencia === 'desligada' ? 'desligado por você, em Qualidade' : 'WebCodecs forçado: vai pela faixa de dados');
    if (desligadoPeloServidor) return nao('desligado no servidor para todo mundo');
    if (!suportado) return nao('este navegador não troca o conteúdo dos quadros do RTP');
    if (!h264Hardware) return nao('sem codificação de H.264 pela placa de vídeo nesta máquina');
    if (agora < falhaAte) return nao('a placa falhou há pouco; nova tentativa em seguida');
    return { usar: true, motivo: 'codificação pela placa de vídeo, transportada pelo RTP' };
  }

  // As miniaturas. O codificador do WebRTC continua trabalhando -- é o quadro DELE que o RTP
  // empacota, com o carimbo, o número e os pedidos de quadro-chave dele --, mas o conteúdo vai
  // ser trocado. Quanto menor a miniatura, menos processador de quem joga: 8x deixa 1440p em
  // 320x180. A camada leve (rid 'q', que o LiveKit já encolhe a 360p) vai mais longe, porque
  // miniatura de miniatura também custa.
  const ESCALA_DA_MINIATURA = 8;
  const ESCALA_DA_MINIATURA_LEVE = 32;
  function miniaturas(encodings) {
    return encodings.map(e => ({ ...e, scaleResolutionDownBy: e.rid === 'q' ? ESCALA_DA_MINIATURA_LEVE : ESCALA_DA_MINIATURA }));
  }
  const camadaDoRid = rid => (rid === 'q' ? 'baixa' : 'alta');

  // Qual quadro da captura vai no lugar do quadro que o WebRTC codificou. Os metadados do quadro
  // não trazem a hora da captura, só o carimbo do RTP, e cada camada (SSRC) começa o dela num
  // valor sorteado. O WebRTC ainda suaviza os carimbos (1–2 ms de deriva, medido). Então:
  //  - a ORDEM manda: só serve um quadro mais novo que o último usado nesta camada. É ela que
  //    mantém a cadeia de referências do nosso codificador; o carimbo só escolhe entre vizinhos;
  //  - o deslocamento entre os dois relógios é aprendido e acompanha a deriva, mas só com um
  //    casamento bom -- um quadro que faltou não pode arrastá-lo.
  // `fonte` é a lista de carimbos (µs) guardados; devolve o índice escolhido (ou -1) e o estado.
  const MS_DE_CASAMENTO_BOM = 8;
  function casarComACaptura(estado, rtpMs, fonte) {
    const ultimo = estado.ultimoUs ?? -Infinity;
    let escolhido = -1, distancia = Infinity;
    for (let i = 0; i < fonte.length; i++) {
      if (fonte[i] <= ultimo) continue;
      // Sem deslocamento aprendido, o mais novo: o WebRTC acabou de codificar o quadro mais
      // recente que viu.
      const d = estado.deslocamentoMs == null ? -fonte[i] : Math.abs(fonte[i] / 1000 - (rtpMs - estado.deslocamentoMs));
      if (d < distancia) { distancia = d; escolhido = i; }
    }
    if (escolhido < 0) return { indice: -1, estado };
    const bom = estado.deslocamentoMs == null || distancia <= MS_DE_CASAMENTO_BOM;
    return {
      indice: escolhido,
      estado: { deslocamentoMs: bom ? rtpMs - fonte[escolhido] / 1000 : estado.deslocamentoMs, ultimoUs: fonte[escolhido] }
    };
  }

  // Troca de cena. Na placa, o quadro comum de uma cena nova sai MAIOR que o quadro-chave dela
  // (~330 KB contra ~120 KB em 1440p, medido) -- e um quadro de 300 KB leva ~160 ms para sair
  // no ritmo do WebRTC, o bastante para quem assiste ver um congelamento. Dois sinais, os dois
  // de graça: o codificador do WebRTC decidiu fazer quadro-chave sozinho (ele tem detector de
  // cena), ou a miniatura dele saltou de tamanho. O quadro-chave que ele faz a PEDIDO de alguém
  // chega por outro caminho (as estatísticas de PLI), e é sempre atendido.
  const SALTO_DE_CENA = 4;
  const BYTES_MINIMOS_DE_CENA = 2000;
  function trocaDeCena(estado, { bytesDaMiniatura, chaveDoWebrtc }) {
    if (chaveDoWebrtc) return { cena: true, estado };
    const media = estado.mediaMiniatura;
    const cena = media != null && bytesDaMiniatura > SALTO_DE_CENA * media && bytesDaMiniatura > BYTES_MINIMOS_DE_CENA;
    return { cena, estado: { mediaMiniatura: media == null ? bytesDaMiniatura : media * 0.9 + bytesDaMiniatura * 0.1 } };
  }

  // O SPS e o PPS no começo de um quadro H.264 em Annex B (ver `chaveComParametros`, no Worker
  // da placa). Só o começo é lido: os dois vêm antes da primeira fatia, e o resto do quadro-chave
  // tem centenas de KB. Devolve os bytes de cada um, sem o código de início.
  const NAL_SPS = 7, NAL_PPS = 8;
  function parametrosDoH264(bytes) {
    const achados = { sps: null, pps: null };
    let inicio = -1;
    const fechar = fim => {
      const tipo = bytes[inicio] & 0x1f;
      if (tipo === NAL_SPS) achados.sps = bytes.subarray(inicio, fim);
      if (tipo === NAL_PPS) achados.pps = bytes.subarray(inicio, fim);
      return tipo >= 1 && tipo <= 5;   // uma fatia: dali em diante não há mais parâmetros
    };
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
      // O zero antes de 00 00 01 é do código de início de 4 bytes, e não do fim da unidade.
      if (inicio >= 0 && fechar(bytes[i - 1] === 0 ? i - 1 : i)) return achados;
      inicio = i + 3;
      i += 2;
    }
    if (inicio >= 0 && inicio < bytes.length) fechar(bytes.length);
    return achados;
  }

  // A transform que engole todos os quadros de uma camada: o codificador do WebRTC produzindo
  // miniaturas e nenhum byte saindo, por um prazo inteiro. Quem transmite aparece
  // "compartilhando", o som da tela passa (é outra faixa) e ninguém vê imagem -- o servidor
  // registra "publish time out". A conta usa só as estatísticas do remetente, de fora do Worker:
  // vale para qualquer motivo, até o Worker travado. `historico` são leituras
  // { agora, codificados, bytes } da camada; devolve o histórico aparado e se ela parou.
  // Camada pausada pelo servidor não conta: sem assinante, o WebRTC nem codifica.
  const MS_SEM_SAIDA_ATE_DESISTIR = 3000;
  const QUADROS_MINIMOS_SEM_SAIDA = 10;
  function saidaDaCamada(historico, leitura) {
    const lista = [...historico, leitura];
    // O primeiro da lista fica sendo a leitura mais nova com pelo menos o prazo de idade.
    while (lista.length > 1 && leitura.agora - lista[1].agora >= MS_SEM_SAIDA_ATE_DESISTIR) lista.shift();
    const antes = lista[0];
    const parada = leitura.agora - antes.agora >= MS_SEM_SAIDA_ATE_DESISTIR
      && leitura.codificados - antes.codificados >= QUADROS_MINIMOS_SEM_SAIDA
      && leitura.bytes === antes.bytes;
    return { historico: lista, parada };
  }

  // A placa que não cabe na subida. O WebRTC calcula os limites de cada camada pelo tamanho que
  // ELE codifica -- a miniatura --, e por isso nunca desliga nem encolhe a camada cheia por falta
  // de banda: com 400 kbps de subida destinou 60–100 kbps a ela, e com 1,5 Mbps, ~440 kbps
  // (medido). A placa não desce tanto: em 1440p60 mandou 500–650 kbps no primeiro caso e
  // 1,2–1,7 Mbps no segundo, e quem assistia via a imagem parar, com até meio segundo de atraso.
  // O WebRTC sozinho, com as mesmas subidas, mandou 360p a 15 quadros e 960p–1152p a 30, lisos.
  // Então a camada que passa uma janela inteira mandando bem mais do que o WebRTC destina a ela
  // devolve a tela ao WebRTC. O começo da transmissão não conta: ali o controle de
  // congestionamento ainda está subindo. `leitura` é { agora, desde, destinado, bytes, ativa }
  // (`desde`: quando a transmissão começou); a camada pausada pelo servidor recomeça a conta.
  const MS_DE_JANELA_DA_SUBIDA = 5000;
  const MS_DE_CARENCIA_DA_SUBIDA = 5000;
  const EXCESSO_SOBRE_O_DESTINADO = 1.5;
  const BPS_DE_EXCESSO_TOLERADO = 200_000;
  function placaNaoCabe(historico, leitura) {
    if (!leitura.ativa || leitura.agora - leitura.desde < MS_DE_CARENCIA_DA_SUBIDA) return { historico: [], naoCabe: false };
    const lista = [...historico, leitura];
    // O primeiro da lista fica sendo a leitura mais nova com pelo menos a janela de idade.
    while (lista.length > 1 && leitura.agora - lista[1].agora >= MS_DE_JANELA_DA_SUBIDA) lista.shift();
    const antes = lista[0];
    if (leitura.agora - antes.agora < MS_DE_JANELA_DA_SUBIDA) return { historico: lista, naoCabe: false };
    const enviado = (leitura.bytes - antes.bytes) * 8000 / (leitura.agora - antes.agora);
    const destinado = lista.reduce((soma, l) => soma + l.destinado, 0) / lista.length;
    const naoCabe = enviado > destinado * EXCESSO_SOBRE_O_DESTINADO && enviado - destinado > BPS_DE_EXCESSO_TOLERADO;
    return { historico: lista, naoCabe, enviado, destinado };
  }

  // Depois disso, a placa só é tentada de novo quando o controle de congestionamento medir banda
  // para ela -- pelo menos metade do que a camada cheia pediu: tentar às cegas trazia de volta a
  // imagem ruim a cada tentativa, e a tela piscava na republicação. O WebRTC continua sondando a
  // rede enquanto isso. Sem leitura, tenta.
  const FRACAO_DA_SUBIDA_PARA_TENTAR_A_PLACA = 0.5;
  const subidaComportaAPlaca = (bps, pedido) => !(bps > 0) || !(pedido > 0) || bps >= pedido * FRACAO_DA_SUBIDA_PARA_TENTAR_A_PLACA;

  // O orçamento do nosso codificador segue o que o controle de congestionamento do WebRTC
  // destina à camada (`targetBitrate`): é ele que mede a rede, e o ritmo de saída dos pacotes é
  // dele. Com histerese, porque reconfigurar tem custo -- e numa placa pode custar um quadro-chave.
  const FOLGA_PARA_RECONFIGURAR = 0.15;
  const MS_ENTRE_RECONFIGURACOES = 1000;
  function orcamentoDaCamada({ atual, destinado, maximo, minimo = 100_000, agora, ultimaMudanca = 0 }) {
    if (!(destinado > 0)) return null;
    const alvo = Math.round(Math.max(minimo, Math.min(maximo, destinado)));
    if (Math.abs(alvo - atual) <= atual * FOLGA_PARA_RECONFIGURAR) return null;
    if (agora - ultimaMudanca < MS_ENTRE_RECONFIGURACOES) return null;
    return alvo;
  }

  const api = {
    decidirTelaPelaPlaca, miniaturas, camadaDoRid, ESCALA_DA_MINIATURA, ESCALA_DA_MINIATURA_LEVE,
    casarComACaptura, MS_DE_CASAMENTO_BOM, trocaDeCena, SALTO_DE_CENA, orcamentoDaCamada, FOLGA_PARA_RECONFIGURAR,
    saidaDaCamada, MS_SEM_SAIDA_ATE_DESISTIR, QUADROS_MINIMOS_SEM_SAIDA, parametrosDoH264,
    placaNaoCabe, MS_DE_JANELA_DA_SUBIDA, MS_DE_CARENCIA_DA_SUBIDA, subidaComportaAPlaca, FRACAO_DA_SUBIDA_PARA_TENTAR_A_PLACA,
    capturaPresa, MS_DE_INTERVALO_CURTO, SEGUNDOS_PARA_CONCLUIR_CAPTURA_PRESA, esperaAteTentarDeNovo, MS_ATE_TENTAR_DE_NOVO,
    decidirModo, MS_DE_FOLGA_PARA_SE_APRESENTAR, servidorConfiavel, VERSAO_MINIMA_DO_SERVIDOR,
    necessario, ESCALAS, QUADROS_POSSIVEIS, dimensoesNaEscala, caberNaCaixa, iniciarCamada, ajustarCamada, degrausDaPlaca,
    SEGUNDOS_PARA_SUBIR_DE_DEGRAU, PERDA_QUE_APERTA,
    camadaDoEspectador, MS_REBAIXADO, MS_REBAIXADO_MAXIMO, JANELAS_RUINS_PARA_REBAIXAR,
    janelaDoEspectador, caminhoFalhando, JANELAS_PARADAS_QUE_DERRUBAM, JANELAS_RUINS_QUE_DERRUBAM, JANELAS_DA_SAUDE, MS_DE_ATRASO_RUIM,
    nivelH264, codecsH264
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaDecisoes = api;
})(typeof window === 'undefined' ? globalThis : window);
