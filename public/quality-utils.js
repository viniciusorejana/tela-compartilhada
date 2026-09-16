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
  const api = { profiles, tetoDeEnvio, TETO_ABSOLUTO, PISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
