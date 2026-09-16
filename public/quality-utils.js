// Perfis de captura. Repartir banda entre espectadores era tarefa desta pagina enquanto a
// sala era uma malha; o servidor de midia faz isso por pessoa, com simulcast, entao o
// orcamento por par, a histerese de resolucao e o limite de upload sairam daqui.
//
// A escada de simulcast, porem, PRECISA ser declarada aqui -- e essa e a licao mais cara
// que este arquivo guarda. Deixada por conta do cliente do servidor de midia, ela nasce com
// um degrau so abaixo do original: metade da resolucao e um quarto do bitrate. Numa captura
// de 1080p a 4 Mbps isso da 1 Mbps e 4 Mbps, e nada entre zero e 1 Mbps.
//
// O teto de cada perfil é orçamento, não meta: o codificador gasta o que receber. Ele já
// foi 4, 8 e 14 Mbps -- números de gravação local, não de transmissão -- e o custo disso
// não aparecia aqui, e sim do outro lado: o servidor envia UMA cópia por espectador, então
// cada Mbps a mais no teto é multiplicado pelo tamanho da sala. Numa sala de quinze com uma
// tela aberta, os 8 Mbps do perfil alto viravam 112 Mbps de saída.
//
// Os valores de hoje são a faixa em que Discord e Meet operam para a mesma tarefa. A perda
// de nitidez em texto parado é imperceptível; em cena de muito movimento a 60 quadros ela
// existe, e é por isso que "Fluidez máxima" continua a escolha de quem compartilha jogo.
//
// O estrago aparece do lado de quem assiste numa rede ruim. A estimativa de banda dele cai
// para algumas centenas de kbps; o servidor procura uma camada que caiba, nao encontra
// nenhuma, e manda a de 2 Mbps assim mesmo. O canal afoga, e junto com a imagem afoga a
// sinalizacao -- que viaja no MESMO transporte e e o que mantem a pessoa na sala. Ela nao
// fica com video ruim: ela CAI.
//
// Cada degrau declarado vira uma camada, e a captura fica sendo a de cima. Declarar UM
// degrau, portanto, publica duas camadas.
//
// Eram três, e a do meio foi retirada porque ela é paga por quem transmite, em processador.
//
// O custo de codificar acompanha os pixels por segundo, e as três camadas não custam o
// mesmo. Numa captura de 1920x810 a 30 quadros: a de cima são 47 Mpx/s, a do meio
// (1280x540) são 21, e a de baixo (640x270 a 15 quadros) são 2,6. A do meio sozinha é
// 30% de tudo -- treze vezes o que custa a de baixo.
//
// Quem paga isso é o computador de quem compartilha, e sem placa de vídeo que codifique
// H.264 é o processador dele. Quando ele não dá conta, o codificador engasga: a imagem
// congela do lado de quem assiste, sem perda de pacote, sem quadro descartado e sem nada
// no log da rede -- porque os quadros não se perderam, eles não chegaram a existir.
//
// O degrau de baixo FICA, e é o que não podia sair. A 300 kbps e 15 quadros ele cabe em
// praticamente qualquer lugar; quem está com a rede ruim vê a tela borrada em vez de não
// ver nada e perder o lugar na sala. É também o degrau que a plateia e a grade usam.
//
// O que se perde: em multi-view, a tela dos outros vem no degrau de baixo em vez de um
// intermediário. É uma troca deliberada -- multi-view é para acompanhar de canto de olho,
// e quem quer LER a tela põe ela no palco, onde a camada de cima continua inteira.
//
// ---------- O teto deixou de ser um número escrito por perfil ----------
//
// Era um valor fixo em cada perfil, e o MESMO valor para 30 e para 60 quadros. Esse detalhe
// cobrava dois preços diferentes pelo mesmo erro.
//
// Em "Fluidez máxima" a 1080p, os 4 Mbps tinham de cobrir o dobro dos quadros: 0,032 bit por
// pixel contra 0,064 a 30 quadros. Metade do orçamento por pixel -- e jogo em movimento é
// exatamente onde faltar bit aparece, como borrão em volta do que se move. Quem escolhia
// fluidez para jogar recebia menos bits justamente na cena que mais precisava deles.
//
// Do outro lado, uma captura ultrawide de 1920x810 recebia o orçamento inteiro de 1080p,
// pagando por 25% de pixels que não existem -- e pagando isso multiplicado por espectador.
//
// Agora o teto sai dos pixels que estão REALMENTE sendo capturados, na taxa que está
// realmente sendo pedida. Ninguém escreve um número por combinação, e não há combinação sem
// resposta.
(function(root) {
  // Bits por pixel a 30 quadros. A âncora é o caso central do Nexo, tela 1080p a 30, que
  // rendia 4 Mbps e continua rendendo isso: 0,064 x 1920 x 1080 x 30 = 3,98 Mbps. A escolha
  // de não mudar o caso central é deliberada -- ele é o que já foi visto funcionando em
  // sala, e o que se quer corrigir são as OUTRAS combinações.
  const BITS_POR_PIXEL = 0.064;
  // Dobrar os quadros não dobra o custo, e tratar como se dobrasse foi o erro anterior em
  // sentido contrário. Quadros vizinhos são parecidos, e é dessa semelhança que a compressão
  // vive: o codificador guarda a diferença, não a imagem. Meia potência é a aproximação que
  // a prática de codificação usa -- 60 quadros custam cerca de 1,4 vez o que custam 30.
  const EXPOENTE_DE_QUADROS = 0.5;
  // Onde estava o maior perfil. Não é um limite de qualidade, é um limite de CONTA: o
  // servidor envia UMA cópia por espectador, então cada Mbps aqui é multiplicado pelo
  // tamanho da sala. A 6 Mbps, dez pessoas assistindo são 60 Mbps de saída e 27 GB por hora.
  const TETO_ABSOLUTO = 6_000_000;
  // Abaixo disto a imagem deixa de servir para o que as pessoas de fato usam a tela: ler
  // texto e código. Uma captura minúscula não deve arrastar o teto para um valor que
  // inviabiliza a própria tarefa.
  const PISO = 1_200_000;

  // Ex.: (1920, 1080, 30) = 3,98 Mbps · (1920, 1080, 60) = 5,63 · (2560, 1440, 30) = 6,00
  // (no teto) · (1280, 720, 30) = 1,77 · (1920, 810, 30) = 2,99.
  function tetoDeEnvio(largura, altura, fps) {
    const pixels = Math.max(1, (largura || 0) * (altura || 0));
    const quadros = Math.max(1, fps || 30);
    const bits = BITS_POR_PIXEL * pixels * 30 * Math.pow(quadros / 30, EXPOENTE_DE_QUADROS);
    return Math.round(Math.min(TETO_ABSOLUTO, Math.max(PISO, bits)));
  }

  // Os perfis só declaram o que a pessoa escolhe: quanta resolução capturar. O teto é
  // consequência disso e da taxa de quadros, não uma terceira escolha independente.
  const profiles = {
    economical: {
      label: '720p · Econômica', width: 1280, height: 720,
      camadas: [[640, 360, 300_000, 15]]
    },
    high: {
      label: '1080p · Alta', width: 1920, height: 1080,
      camadas: [[640, 360, 300_000, 15]]
    },
    ultra: {
      label: '1440p · Máxima', width: 2560, height: 1440,
      camadas: [[640, 360, 300_000, 15]]
    }
  };
  // ---------- Encolher a imagem em vez de perder quadros ----------
  //
  // O porquê está em sala.js, junto de quem aplica isto nos remetentes. Aqui fica só a
  // DECISÃO, e ela mora neste arquivo por dois motivos: é onde as escolhas de qualidade são
  // tomadas, e assim ela pode ser testada sem navegador -- histerese é exatamente o tipo de
  // lógica que passa a oscilar em silêncio depois de um ajuste aparentemente inofensivo.
  //
  // A função é pura: recebe o estado inteiro e devolve o estado novo. Quem chama guarda os
  // contadores.

  // De 1000 ms de cada segundo, quanto a codificação pode ocupar antes de a imagem encolher.
  // Não são 1000: a mesma thread empacota, e a captura precisa de tempo para entregar o
  // quadro seguinte. Passando de uns 70%, a folga acaba e o atraso de um quadro vira quadro
  // perdido.
  const CUSTO_QUE_APERTA = 700;
  // Cada degrau divide largura e altura por este fator. Dois é o limite: além dele a camada
  // de cima chegaria perto da de baixo, e duas camadas do mesmo tamanho não servem para nada.
  const ESCADA_DE_ESCALA = [1, 1.25, 1.5, 2];
  // Encolher é rápido; crescer espera. Uma tela tem rajadas -- uma troca de cena custa mais
  // que o resto --, e reagir a cada rajada faria a resolução oscilar à vista, que é pior do
  // que ficar um degrau abaixo. A medição que alimenta isto roda a cada dois segundos.
  const AMOSTRAS_PARA_ENCOLHER = 2;
  const AMOSTRAS_PARA_CRESCER = 8;
  // Margem exigida para crescer. Voltar ao degrau de cima e estourar o teto no instante
  // seguinte é o ciclo que a histerese existe para evitar.
  const FOLGA_PARA_CRESCER = 0.9;

  function proximaEscala(estado) {
    const atual = ESCADA_DE_ESCALA.includes(estado.escala) ? estado.escala : 1;
    const posicao = ESCADA_DE_ESCALA.indexOf(atual);
    const custo = Number(estado.custoProjetado) || 0;
    let apertos = Number(estado.apertos) || 0;
    let folgas = Number(estado.folgas) || 0;

    if (custo > CUSTO_QUE_APERTA) {
      folgas = 0;
      apertos += 1;
      if (apertos < AMOSTRAS_PARA_ENCOLHER) return { escala: atual, apertos, folgas };
      return { escala: ESCADA_DE_ESCALA[Math.min(posicao + 1, ESCADA_DE_ESCALA.length - 1)], apertos: 0, folgas: 0 };
    }

    apertos = 0;
    if (posicao === 0) return { escala: atual, apertos, folgas: 0 };
    // Crescer só quando o degrau de cima CABE, e a conta é de pixels: voltar de 1,5 para 1,25
    // multiplica a área por (1,5/1,25)². Um piso fixo erraria nos dois sentidos, porque a
    // distância entre os degraus não é constante.
    const acima = ESCADA_DE_ESCALA[posicao - 1];
    if (custo * Math.pow(atual / acima, 2) > CUSTO_QUE_APERTA * FOLGA_PARA_CRESCER) {
      return { escala: atual, apertos, folgas: 0 };
    }
    folgas += 1;
    if (folgas < AMOSTRAS_PARA_CRESCER) return { escala: atual, apertos, folgas };
    return { escala: acima, apertos, folgas: 0 };
  }

  const api = {
    profiles, tetoDeEnvio, TETO_ABSOLUTO, PISO,
    proximaEscala, CUSTO_QUE_APERTA, ESCADA_DE_ESCALA, AMOSTRAS_PARA_ENCOLHER, AMOSTRAS_PARA_CRESCER
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
