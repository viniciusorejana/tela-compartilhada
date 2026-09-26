/* Os avisos sonoros da sala.
 *
 * Quem olha para outra janela -- o jogo, a planilha, o vídeo que está sendo compartilhado --
 * não vê a lista mudar. Um som curto conta o que aconteceu sem pedir que a pessoa volte para
 * a sala. O preço de errar a mão é alto: um aviso alto ou repetido vira o motivo de alguém
 * silenciar tudo. Daí as regras daqui:
 *
 *   - baixo por padrão, com o volume e cada grupo de avisos ajustáveis nas configurações;
 *   - nunca em rajada: o mesmo aviso não se repete dentro de um intervalo, e dez mensagens
 *     seguidas são um toque, não dez;
 *   - câmera não toca: ela liga e desliga o tempo todo, e só a tela muda o que a sala está
 *     fazendo;
 *   - ensurdecido, a SALA fica em silêncio -- quem entrou, quem saiu, mensagens. O que é sobre
 *     você continua: o próprio som de ensurdecer, o microfone, a sua conexão caindo. Ensurdecer
 *     sem ouvir o som de ensurdecer seria apertar um botão sem saber se ele pegou.
 *
 * Os sons são arquivos em /sons, feitos a partir de timbres gerados no ElevenLabs (ver
 * scripts/sons/compor.cjs): cada um diz a função pela forma -- sobe quando alguém chega, desce
 * quando vai embora. Saem pela Web Audio, pelo fone escolhido nas configurações, como a voz.
 */
(() => {
  const ContextoDeAudio = window.AudioContext || window.webkitAudioContext;
  const SONS = ['entrada', 'saida', 'tela', 'tela-fim', 'assistir', 'mensagem', 'mencao', 'mic-ligado', 'mic-desligado', 'surdo', 'ouvir', 'pedido', 'caiu', 'voltou', 'teste'];
  // Qual chave das configurações liga e desliga cada som. Os pares andam juntos: quem não quer
  // ouvir a tela entrando também não quer ouvi-la saindo.
  const GRUPO = {
    entrada: 'entrada', saida: 'saida', tela: 'tela', 'tela-fim': 'tela', assistir: 'assistir', mensagem: 'mensagem', mencao: 'mencao',
    'mic-ligado': 'voce', 'mic-desligado': 'voce', surdo: 'voce', ouvir: 'voce', pedido: 'pedido', caiu: 'conexao', voltou: 'conexao'
  };
  // Entrar numa transmissão fica de fora: ensurdecido, a tela chega muda de qualquer jeito, e
  // um toque confirmando que você vai "ouvir" algo seria o único som de uma sala calada.
  const SOBRE_VOCE = new Set(['mic-ligado', 'mic-desligado', 'surdo', 'ouvir', 'caiu', 'voltou']);
  // O mesmo aviso não se repete dentro desta janela. Mensagem espera mais: uma conversa animada
  // manda três por segundo, e o que interessa é saber que ela existe. Os do microfone são
  // curtos de propósito -- quem alterna depressa quer ouvir cada alternância.
  const INTERVALO_MINIMO_MS = {
    entrada: 450, saida: 450, tela: 1500, 'tela-fim': 1500, assistir: 600, mensagem: 1600, mencao: 1200,
    'mic-ligado': 100, 'mic-desligado': 100, surdo: 150, ouvir: 150, pedido: 2500, caiu: 5000, voltou: 5000
  };
  const PADRAO = Object.freeze({ ligados: true, volume: 60, entrada: true, saida: true, tela: true, assistir: true, mensagem: true, mensagemSoFora: false, mencao: true, voce: true, pedido: true, conexao: true });
  const CHAVES_BOOLEANAS = Object.keys(PADRAO).filter(chave => chave !== 'volume');

  let ajustes = { ...PADRAO };
  let contexto = null;
  let mestre = null;
  const ultimos = new Map();
  const arquivos = new Map();       // som -> Promise<ArrayBuffer>
  const prontos = new Map();        // som -> AudioBuffer
  const decodificando = new Map();  // som -> Promise<AudioBuffer>

  function limpar(bruto) {
    const limpo = { ...PADRAO };
    if (!bruto || typeof bruto !== 'object') return limpo;
    if (Number.isInteger(bruto.volume) && bruto.volume >= 0 && bruto.volume <= 100) limpo.volume = bruto.volume;
    for (const chave of CHAVES_BOOLEANAS) if (typeof bruto[chave] === 'boolean') limpo[chave] = bruto[chave];
    return limpo;
  }

  function recarregar() {
    ajustes = limpar(window.Preferencias?.lerAjuste('sons', null));
    aplicarVolume();
    pintarPainel();
  }

  // Só o que difere do padrão é guardado: um ajuste que ninguém mexeu não precisa ir para a
  // conta nem ocupar o armazenamento.
  function definir(parcial) {
    ajustes = limpar({ ...ajustes, ...parcial });
    const diferente = Object.fromEntries(Object.entries(ajustes).filter(([chave, valor]) => PADRAO[chave] !== valor));
    window.Preferencias?.gravarAjuste('sons', Object.keys(diferente).length ? diferente : null);
    aplicarVolume();
    pintarPainel();
  }

  // O volume percebido cresce mais devagar que o número: ao quadrado, os 20% de baixo são
  // sussurro de verdade, e os 60% do padrão ficam uns dez decibéis abaixo de uma voz.
  function ganhoDoVolume() { return Math.pow(ajustes.volume / 100, 2); }

  // ---------- Os arquivos ----------
  //
  // Baixados em segundo plano logo depois de a página abrir -- são uns 130 KB no total, e o
  // primeiro aviso (o seu próprio "entrou") acontece segundos depois do clique em entrar. A
  // decodificação espera o contexto de áudio existir, que só nasce depois de um gesto.
  function baixar(som) {
    if (!arquivos.has(som)) {
      arquivos.set(som, fetch(`/sons/${som}.mp3`).then(resposta => {
        if (!resposta.ok) throw new Error(String(resposta.status));
        return resposta.arrayBuffer();
      }).catch(erro => { arquivos.delete(som); throw erro; }));
    }
    return arquivos.get(som);
  }
  function preparar(som) {
    if (prontos.has(som)) return Promise.resolve(prontos.get(som));
    if (!decodificando.has(som)) {
      decodificando.set(som, baixar(som)
        // O `slice` é porque decodificar consome o ArrayBuffer, e ele pode ser pedido de novo.
        .then(bruto => new Promise((resolve, reject) => contexto.decodeAudioData(bruto.slice(0), resolve, reject)))
        .then(buffer => { prontos.set(som, buffer); return buffer; })
        .finally(() => decodificando.delete(som)));
    }
    return decodificando.get(som);
  }
  const preCarregar = () => SONS.forEach(som => baixar(som).catch(() => {}));
  if ('requestIdleCallback' in window) requestIdleCallback(preCarregar, { timeout: 4000 }); else setTimeout(preCarregar, 1500);

  function garantirContexto() {
    if (!ContextoDeAudio) return null;
    if (!contexto) {
      try { contexto = new ContextoDeAudio({ latencyHint: 'interactive' }); } catch (_) { return null; }
      mestre = contexto.createGain();
      mestre.connect(contexto.destination);
      aplicarVolume();
      aplicarSaida();
      SONS.forEach(som => preparar(som).catch(() => {}));
    }
    // Criado antes de um gesto, o contexto nasce suspenso; a entrada na sala já foi um clique,
    // e retomar aqui custa nada quando ele já está rodando.
    if (contexto.state === 'suspended') contexto.resume().catch(() => {});
    return contexto;
  }

  function aplicarVolume() {
    if (mestre && contexto) mestre.gain.setTargetAtTime(ganhoDoVolume(), contexto.currentTime, 0.01);
  }

  // O mesmo fone da voz. Onde o navegador não deixa escolher a saída do contexto de áudio, o
  // aviso sai pela saída padrão do sistema -- que é, quase sempre, a mesma.
  function aplicarSaida() {
    const id = window.Preferencias?.lerAjuste('saida', '') || '';
    contexto?.setSinkId?.(id).catch(() => { /* aparelho sumiu: segue no padrão */ });
  }

  function soar(buffer) {
    const fonte = contexto.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(mestre);
    fonte.onended = () => { try { fonte.disconnect(); } catch (_) { /* já solto */ } };
    fonte.start();
  }

  // Toca já se o arquivo está pronto; senão, assim que ficar -- desde que ainda faça sentido.
  // Um "entrou" que chega um segundo depois de a pessoa entrar já não diz nada.
  function tocarArquivo(som) {
    const ctx = garantirContexto();
    if (!ctx || !mestre) return false;
    const pronto = prontos.get(som);
    if (pronto) { soar(pronto); return true; }
    const pedidoEm = performance.now();
    preparar(som).then(buffer => { if (performance.now() - pedidoEm < 800) soar(buffer); }).catch(() => {});
    return true;
  }

  // `chatAVista` vem de quem chamou: só a sala sabe se o chat está aberto na frente de quem
  // recebe a mensagem.
  function tocar(som, { chatAVista = false } = {}) {
    const grupo = GRUPO[som];
    if (!grupo || !ajustes.ligados || !ajustes[grupo] || !ajustes.volume) return false;
    if (!SOBRE_VOCE.has(som) && typeof ensurdecido !== 'undefined' && ensurdecido) return false;
    if (som === 'mensagem' && ajustes.mensagemSoFora && chatAVista) return false;
    const agora = Date.now();
    if (agora - (ultimos.get(som) || 0) < INTERVALO_MINIMO_MS[som]) return false;
    ultimos.set(som, agora);
    return tocarArquivo(som);
  }

  // A prévia do painel e o teste do fone tocam mesmo com o aviso desligado: é assim que se
  // decide se ele fica, e se o fone escolhido é o certo.
  function previa(som) {
    if (!SONS.includes(som)) return false;
    return tocarArquivo(som);
  }

  // ---------- O painel ----------
  const $ = id => document.getElementById(id);
  function pintarPainel() {
    const ligados = $('sonsLigados');
    if (!ligados) return;
    ligados.checked = ajustes.ligados;
    $('sonsAvisoVolume').value = String(ajustes.volume);
    $('sonsAvisoValor').textContent = `${ajustes.volume}%`;
    document.querySelectorAll('[data-som]').forEach(chave => {
      chave.checked = Boolean(ajustes[chave.dataset.som]);
      chave.disabled = !ajustes.ligados;
    });
    $('sonsMensagemSoFora').checked = ajustes.mensagemSoFora;
    $('sonsMensagemSoFora').disabled = !ajustes.ligados || !ajustes.mensagem;
    $('painelSons').classList.toggle('sons-desligados', !ajustes.ligados);
    $('sonsAvisoVolume').disabled = !ajustes.ligados;
  }

  function ligarPainel() {
    if (!$('sonsLigados')) return;
    $('sonsLigados').addEventListener('change', evento => definir({ ligados: evento.target.checked }));
    const volume = $('sonsAvisoVolume');
    volume.addEventListener('input', () => { $('sonsAvisoValor').textContent = `${volume.value}%`; });
    // Ao soltar, o volume novo toca: é a única forma de saber se "40%" é o que se queria.
    volume.addEventListener('change', () => { definir({ volume: Number(volume.value) }); previa('entrada'); });
    document.querySelectorAll('[data-som]').forEach(chave => chave.addEventListener('change', () => definir({ [chave.dataset.som]: chave.checked })));
    document.querySelectorAll('[data-previa]').forEach(botao => botao.addEventListener('click', () => {
      // Um grupo pode ter mais de um som ("ligar e desligar"): eles tocam em sequência.
      botao.dataset.previa.split(' ').forEach((som, i) => setTimeout(() => previa(som), i * 420));
      botao.classList.remove('tocou');
      void botao.offsetWidth;
      botao.classList.add('tocou');
    }));
    $('sonsMensagemSoFora').addEventListener('change', evento => definir({ mensagemSoFora: evento.target.checked }));
  }

  recarregar();
  ligarPainel();
  // Os ajustes da conta chegam depois da página: quando chegam, valem.
  window.NexoConta?.pronto.then(recarregar).catch(() => {});

  window.NexoSons = { tocar, previa, definir, recarregar, aplicarSaida, ajustes: () => ({ ...ajustes }), SONS };
})();
