/* A mesa de sons da sala.
 *
 * O som toca AQUI, no navegador de cada um, no instante em que o aviso chega -- ele nao
 * sobe para o servidor de midia nem volta de la. Um efeito sonoro vale pelo tempo: a volta
 * completa custaria algumas centenas de milissegundos, e um toque que chega tarde perde
 * a graca. Tocando local, o atraso e so o do aviso, e o arquivo ja esta no navegador
 * desde que apareceu na lista.
 *
 * O som passa pela Web Audio, e nao por um <audio>, por tres motivos que importam numa
 * mesa de sons: comeca sem atraso de decodificacao (o arquivo ja esta decodificado na
 * memoria), dois toques se sobrepoem em vez de um cortar o outro, e o volume e um no de
 * ganho -- muda na hora, inclusive no meio de um som que ja esta tocando.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('soundboardPanel');
  const grade = $('sonsGrade');
  const ContextoDeAudio = window.AudioContext || window.webkitAudioContext;

  const CHAVE_DO_VOLUME = 'nexoVolumeDosSons';
  const CHAVE_DO_MUDO = 'nexoSonsMudos';

  let sons = [];
  let espaco = null;
  let limiteDoSom = 2 * 1024 * 1024;
  // Quem pode apagar vem da sala, que é quem sabe quem modera; este arquivo só desenha.
  // Começa em falso porque mostrar o ✕ antes de saber seria oferecer uma ação que o
  // servidor recusa.
  let podeApagar = false;
  let contexto = null;
  let ganho = null;
  // id do som -> AudioBuffer ja decodificado. Baixar e decodificar acontece uma vez, quando
  // o som aparece na lista; o clique so encosta na memoria.
  const decodificados = new Map();
  const baixando = new Map();

  // O volume da mesa é POR SALA. Cada sala tem os sons dela, e o quanto eles incomodam
  // depende de quais são: uma mesa de gritaria pede 20%, uma de trilha pede 80%. Guardar
  // um número só para todas fazia reajustar a cada troca de sala.
  //
  // As duas chaves antigas continuam valendo como ponto de partida -- é o último volume
  // escolhido em qualquer lugar. Entrar numa sala nova não recomeça do zero: começa no que
  // a pessoa costuma usar, e só depois do primeiro ajuste aquela sala passa a ter o dela.
  let volume = 0.7;
  let mudo = false;
  let mudoGlobal = false;
  try {
    // A chave ausente volta como `null`, e `Number(null)` é ZERO -- que passa raspando no
    // teste de faixa logo abaixo. Quem entrava pela primeira vez ficava com a mesa em 0%:
    // clicava num som, nada saía, e não havia nada na tela explicando. Por isso a ausência
    // é conferida ANTES da conversão, e não pela aparência do número que ela produz.
    const bruto = localStorage.getItem(CHAVE_DO_VOLUME);
    const guardado = bruto === null ? NaN : Number(bruto);
    if (Number.isFinite(guardado) && guardado >= 0 && guardado <= 1) volume = guardado;
    mudo = localStorage.getItem(CHAVE_DO_MUDO) === '1';
  } catch (_) { /* Sem armazenamento, vale o padrao desta aba. */ }
  if (window.Preferencias) {
    const daSala = window.Preferencias.daSala(roomCode, 'sons', null);
    if (daSala && typeof daSala === 'object') {
      if (Number.isFinite(daSala.volume) && daSala.volume >= 0 && daSala.volume <= 1) volume = daSala.volume;
      mudo = Boolean(daSala.mudo);
    }
  }

  function garantirContexto() {
    if (!ContextoDeAudio) return null;
    if (!contexto) {
      contexto = new ContextoDeAudio({ latencyHint: 'interactive' });
      ganho = contexto.createGain();
      ganho.connect(contexto.destination);
      aplicarGanho();
    }
    // Um contexto criado antes de qualquer gesto nasce suspenso. Retomar a cada disparo
    // custa nada quando ele ja esta rodando, e e o que faz o primeiro som depois de um
    // clique funcionar sem a pessoa precisar de um botao de "ativar".
    if (contexto.state === 'suspended') contexto.resume().catch(() => {});
    return contexto;
  }

  function aplicarGanho() {
    if (!ganho) return;
    // A rampa curta evita o estalo que um corte seco no ganho produz.
    const alvo = (mudo || mudoGlobal) ? 0 : volume;
    ganho.gain.setTargetAtTime(alvo, contexto.currentTime, 0.01);
  }

  function pintarVolume() {
    $('sonsVolume').value = Math.round(volume * 100);
    $('sonsVolumeValor').textContent = mudo ? 'mudo' : `${Math.round(volume * 100)}%`;
    $('sonsMudo').textContent = mudo ? '🔇' : '🔊';
    $('sonsMudo').setAttribute('aria-pressed', String(mudo));
    $('sonsMudo').title = mudo ? 'Ouvir a mesa de sons' : 'Calar a mesa de sons';
  }

  function guardarPreferencia() {
    // Guardado nos dois lugares: nesta sala, que é o que vale ao voltar para ela, e no
    // valor geral, que é o ponto de partida da próxima sala em que nunca se mexeu.
    window.Preferencias?.guardarDaSala(roomCode, 'sons', { volume, mudo });
    try {
      localStorage.setItem(CHAVE_DO_VOLUME, String(volume));
      localStorage.setItem(CHAVE_DO_MUDO, mudo ? '1' : '0');
    } catch (_) { /* Vale so nesta aba. */ }
  }

  // ---------- Baixar e decodificar ----------

  function enderecoDoSom(id) {
    return `/api/soundboard/${encodeURIComponent(roomCode)}/${encodeURIComponent(id)}`;
  }

  function prepararSom(som) {
    if (decodificados.has(som.id) || baixando.has(som.id)) return baixando.get(som.id);
    const contexto = garantirContexto();
    if (!contexto) return null;
    const tarefa = fetch(enderecoDoSom(som.id), { headers: window.NexoSessao?.cabecalhos() || {} })
      .then(resposta => (resposta.ok ? resposta.arrayBuffer() : Promise.reject(new Error(String(resposta.status)))))
      .then(bytes => contexto.decodeAudioData(bytes))
      .then(buffer => { decodificados.set(som.id, buffer); baixando.delete(som.id); return buffer; })
      .catch(erro => {
        baixando.delete(som.id);
        console.warn('Mesa de sons:', som.nome, erro.message);
        return null;
      });
    baixando.set(som.id, tarefa);
    return tarefa;
  }

  // ---------- Um som de cada vez, POR PESSOA ----------
  //
  // Cada disparo criava uma fonte nova e nada segurava a anterior: apertar cinco vezes
  // tocava as cinco cópias sobrepostas, e um som de trinta segundos deixava a sala
  // inteira debaixo de uma parede de barulho que ninguém conseguia interromper -- não há
  // botão de "parar", e o limite de dois cliques por segundo do servidor ainda permite
  // umas setenta cópias ao vivo.
  //
  // A regra é por PESSOA, e não por som nem pela sala: duas pessoas tocando coisas
  // diferentes ao mesmo tempo é a mesa funcionando, e é metade da graça. Uma pessoa
  // tocando duas ao mesmo tempo é sempre engano ou bagunça. Então cada participante tem
  // um canal só: o disparo novo dela corta o que ela tinha começado antes, seja o mesmo
  // som ou outro.
  //
  // Todo mundo chega à mesma conclusão sozinho, sem o servidor arbitrar: os avisos chegam
  // na mesma ordem para todos, e a decisão depende só de quem disparou.
  const tocandoPorPessoa = new Map();

  // Cortar uma onda no meio estala. Um desligamento de 40 ms é curto demais para soar
  // como "abaixou o volume" e longo o suficiente para não estalar.
  const SEGUNDOS_DO_CORTE = 0.04;

  // `id`, quando vem, é o som que se quer cortar: um "parar" atrasado pela rede não pode
  // derrubar o som NOVO que a mesma pessoa disparou logo depois.
  function cortarDe(quem, id = null) {
    const atual = tocandoPorPessoa.get(quem);
    if (!atual || (id && atual.id !== id)) return;
    tocandoPorPessoa.delete(quem);
    try {
      atual.ganho.gain.setTargetAtTime(0, atual.contexto.currentTime, SEGUNDOS_DO_CORTE / 3);
      atual.fonte.stop(atual.contexto.currentTime + SEGUNDOS_DO_CORTE);
    } catch (_) { /* Ja terminou sozinha; nao ha o que cortar. */ }
  }

  // ---------- Parar o som que eu toquei ----------
  //
  // Um som de trinta segundos disparado por engano ficava na sala inteira até o fim: a única
  // saída era disparar outro por cima. Agora o botão do som que EU toquei vira "Parar" enquanto
  // ele toca, e parar vale para todo mundo -- o aviso passa pelo servidor como o de tocar, e
  // cada navegador corta o canal de quem pediu.
  //
  // Só o próprio som. Parar o de outra pessoa seria uma briga de botões, e a mesa já tem o
  // mudo de cada um para quem não quer ouvir.
  let meuToque = null;
  // Cada disparo tem um número: o mesmo som tocado de novo é outro toque, e a barra dele
  // recomeça do zero em vez de continuar a do anterior.
  let toques = 0;

  function souEu(quem) {
    return Boolean(socket?.id) && quem === socket.id;
  }

  function pintarMeuToque() {
    const atual = meuToque ? String(meuToque.numero) : null;
    for (const botao of grade.querySelectorAll('.som-btn.meu-tocando')) {
      if (botao.dataset.toque === atual) continue;
      botao.classList.remove('meu-tocando');
      delete botao.dataset.toque;
      botao.style.removeProperty('--som-duracao');
      botao.style.removeProperty('--som-inicio');
      botao.title = botao.dataset.titulo || '';
      botao.removeAttribute('aria-label');
      const rodape = botao.querySelector('small');
      if (rodape) rodape.textContent = rodape.dataset.texto || '';
      // Tirar e pôr a classe no mesmo quadro não reinicia a animação; ler o tamanho no meio sim.
      void botao.offsetWidth;
    }
    if (!meuToque) return;
    const botao = grade.querySelector(`[data-som-id="${CSS.escape(meuToque.id)}"]`);
    if (!botao || botao.dataset.toque === atual) return;
    botao.dataset.toque = atual;
    botao.classList.add('meu-tocando');
    // A barra que anda embaixo do botão é uma animação CSS; redesenhar a grade no meio do som
    // (alguém enviou outro) a recomeça do ponto certo, e não do zero.
    const decorrido = Math.max(0, meuToque.contexto.currentTime - meuToque.inicio);
    botao.style.setProperty('--som-duracao', `${meuToque.duracao.toFixed(2)}s`);
    botao.style.setProperty('--som-inicio', `-${decorrido.toFixed(2)}s`);
    const nome = botao.querySelector('strong')?.textContent || 'o som';
    botao.title = `Parar "${nome}" para todo mundo`;
    botao.setAttribute('aria-label', `Parar ${nome} para todo mundo`);
    const rodape = botao.querySelector('small');
    if (rodape) {
      rodape.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
      rodape.append(document.createTextNode('Parar'));
    }
  }

  function pararMeuSom() {
    if (!meuToque) return;
    const { id } = meuToque;
    // Corta aqui na hora, sem esperar a volta do servidor: quem apertou "Parar" espera silêncio
    // no mesmo instante. Os outros param quando o aviso chega, como pararam de esperar o "tocar".
    if (socket?.id) cortarDe(socket.id, id);
    if (socket?.connected) socket.emit('soundboard-parar', { id });
  }

  async function tocarLocalmente(id, quem) {
    const contexto = garantirContexto();
    if (!contexto) return;
    const buffer = decodificados.get(id) || await prepararSom({ id });
    if (!buffer) return;
    // O corte fica DEPOIS do await de propósito: um som que ainda não terminou de baixar
    // cortaria o anterior e não colocaria nada no lugar, deixando um buraco no áudio.
    cortarDe(quem);

    // Um ganho por disparo, entre a fonte e o volume da mesa. É ele que permite desligar
    // este som sem mexer no volume geral nem no som que outra pessoa esteja tocando.
    const proprio = contexto.createGain();
    proprio.connect(ganho);
    const fonte = contexto.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(proprio);
    const registro = { id, numero: ++toques, fonte, ganho: proprio, contexto, inicio: contexto.currentTime, duracao: buffer.duration };
    fonte.onended = () => {
      // Só se ainda for o meu: um corte já trocou a entrada por outra mais nova.
      if (tocandoPorPessoa.get(quem) === registro) tocandoPorPessoa.delete(quem);
      try { proprio.disconnect(); } catch (_) { /* ja desconectado */ }
      if (meuToque === registro) { meuToque = null; pintarMeuToque(); }
    };
    tocandoPorPessoa.set(quem, registro);
    fonte.start();
    if (souEu(quem)) { meuToque = registro; pintarMeuToque(); }
  }

  // ---------- Interface ----------

  function pintarGrade() {
    $('sonsVazio').hidden = sons.length > 0;
    grade.replaceChildren(...sons.map(som => {
      const cartao = document.createElement('div');
      cartao.className = 'som-card';

      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'som-btn';
      botao.dataset.somId = som.id;
      const nome = document.createElement('strong');
      nome.textContent = som.nome;
      const autoria = document.createElement('small');
      autoria.textContent = som.porQuem ? `por ${som.porQuem}` : '';
      // O que o botão diz fora do "Parar", para voltar a dizer quando o som acaba.
      autoria.dataset.texto = autoria.textContent;
      botao.append(nome, autoria);
      botao.title = `Tocar "${som.nome}" para a sala`;
      botao.dataset.titulo = botao.title;
      // Enquanto o MEU toque deste som dura, o mesmo botão o para. Outro som continua sendo
      // tocar (e corta o meu anterior, como sempre).
      botao.onclick = () => {
        if (meuToque?.id === som.id) pararMeuSom();
        else socket?.emit('soundboard-tocar', { id: som.id });
      };
      cartao.append(botao);
      if (!podeApagar) return cartao;

      const apagar = document.createElement('button');
      apagar.type = 'button';
      apagar.className = 'som-apagar';
      apagar.textContent = '✕';
      apagar.title = `Apagar "${som.nome}" da mesa`;
      apagar.onclick = evento => {
        evento.stopPropagation();
        // A recusa só acontece se o papel mudou entre o desenho e o clique. Mesmo rara, ela
        // precisa dizer o motivo: um ✕ que não faz nada parece defeito.
        socket?.emit('soundboard-remover', { id: som.id }, resposta => {
          if (resposta && !resposta.ok && resposta.error) $('sonsEspaco').textContent = resposta.error;
        });
      };
      cartao.append(apagar);
      return cartao;
    }));

    if (espaco) {
      // Efeitos sonoros pesam quilobytes. Medir tudo em MB fazia a mesa inteira aparecer
      // como "0.0 de 24.0 MB" -- como se nada tivesse sido enviado.
      const tamanho = bytes => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
      $('sonsEspaco').textContent = `${espaco.sons} de ${espaco.maximoDeSons} sons · ${tamanho(espaco.usado)} de ${tamanho(espaco.total)}`;
    }
    const resumo = $('sidebarSons');
    if (resumo) resumo.textContent = sons.length ? `${sons.length} ${sons.length === 1 ? 'som' : 'sons'}` : 'Nenhum som ainda';
    pintarMeuToque();
  }

  // Um som recem-tocado se acende por um instante: numa sala com varias pessoas, saber
  // QUEM disparou (e qual) e a diferenca entre um efeito e um barulho sem explicacao.
  function acenderBotao(id) {
    const botao = grade.querySelector(`[data-som-id="${CSS.escape(id)}"]`);
    if (!botao) return;
    botao.classList.add('tocando-agora');
    setTimeout(() => botao.classList.remove('tocando-agora'), 650);
  }

  // Uma mesa de sons é feita de efeitos, não de músicas. Mas recusar um arquivo longo é
  // grosseiro: quem arrasta uma música de três minutos quase sempre quer o comecinho dela.
  // Então o servidor CORTA nos primeiros 30 s, e o que este lado faz é só avisar antes,
  // para ninguém levar um susto com um som que termina no meio.
  //
  // A medição aqui sai de graça porque este lado já decodifica o arquivo para poder
  // tocá-lo. Ela não é a garantia -- quem corta de verdade é o ffmpeg no servidor, que
  // não depende de o navegador ter sido honesto.
  const SEGUNDOS_MAXIMOS_DO_SOM = 30;

  function duracaoDoArquivo(arquivo) {
    const contexto = garantirContexto();
    if (!contexto) return Promise.resolve(null);   // sem Web Audio, o limite de bytes decide
    return arquivo.arrayBuffer()
      .then(bytes => contexto.decodeAudioData(bytes))
      .then(buffer => buffer.duration)
      .catch(() => null);                          // ilegível: o servidor recusa por assinatura
  }

  async function enviarArquivo(arquivo) {
    if (!arquivo) return;
    if (arquivo.size > limiteDoSom) {
      $('sonsEspaco').textContent = `"${arquivo.name}" passa de ${Math.round(limiteDoSom / 1024 / 1024)} MB. Use um trecho mais curto.`;
      return;
    }
    if (!socket?.connected) { $('sonsEspaco').textContent = 'Aguarde a reconexão para enviar.'; return; }

    // O nome do arquivo vira o rotulo do botao, sem a extensao: "risada.mp3" fica "risada".
    const nome = arquivo.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Som';
    const segundos = await duracaoDoArquivo(arquivo);
    const vaiCortar = segundos !== null && segundos > SEGUNDOS_MAXIMOS_DO_SOM;
    $('sonsEspaco').textContent = vaiCortar
      ? `"${nome}" tem ${Math.round(segundos)}s — mando os primeiros ${SEGUNDOS_MAXIMOS_DO_SOM}s…`
      : `Enviando "${nome}"…`;
    try {
      const parametros = new URLSearchParams({ nome });
      if (segundos !== null) parametros.set('segundos', String(Math.round(segundos)));
      const resposta = await fetch(`/api/soundboard/${encodeURIComponent(roomCode)}?${parametros}`, {
        method: 'POST',
        headers: { 'Content-Type': arquivo.type || 'application/octet-stream', ...window.NexoSessao?.cabecalhos() },
        body: arquivo
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) $('sonsEspaco').textContent = corpo.error || 'Não deu para enviar esse arquivo.';
      else if (corpo.cortado) $('sonsEspaco').textContent = `"${nome}" entrou com os primeiros ${SEGUNDOS_MAXIMOS_DO_SOM}s.`;
    } catch (_) {
      $('sonsEspaco').textContent = 'Não deu para enviar: a conexão falhou.';
    }
  }

  function abrirPainel() {
    painel.classList.remove('hidden');
    // Abrir o painel e um gesto: e a hora certa de destravar o audio e adiantar o download
    // dos sons, para que o primeiro clique ja saia na hora.
    garantirContexto();
    sons.forEach(prepararSom);
    pintarGrade();
    pintarVolume();
  }

  $('soundboardBtn').onclick = abrirPainel;
  $('sonsEnviarBtn').onclick = () => $('sonsArquivo').click();
  $('sonsArquivo').onchange = () => {
    enviarArquivo($('sonsArquivo').files[0]);
    $('sonsArquivo').value = '';
  };
  $('sonsVolume').addEventListener('input', () => {
    volume = Number($('sonsVolume').value) / 100;
    // Arrastar o volume para cima quer dizer "quero ouvir": tira do mudo sozinho, como ja
    // acontece no volume de cada participante.
    if (volume > 0) mudo = false;
    aplicarGanho();
    pintarVolume();
    guardarPreferencia();
  });
  $('sonsMudo').onclick = () => {
    mudo = !mudo;
    aplicarGanho();
    pintarVolume();
    guardarPreferencia();
  };
  painel.addEventListener('click', evento => { if (evento.target === painel) painel.classList.add('hidden'); });
  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape' && !painel.classList.contains('hidden')) painel.classList.add('hidden');
  });

  pintarVolume();

  window.NexoSoundboard = {
    abrir: abrirPainel,
    definirMudoGlobal(ativo) { mudoGlobal = Boolean(ativo); aplicarGanho(); },
    definirPodeApagar(pode) {
      if (podeApagar === Boolean(pode)) return;
      podeApagar = Boolean(pode);
      pintarGrade();
    },
    // Enviar um som pede conta; tocar os que já estão na mesa, não. O botão continua à vista,
    // e desligado com o motivo: um botão escondido é uma funcionalidade que ninguém sabe que
    // existe, e um desligado com a porta ao lado é o convite para criar a conta.
    definirPodeEnviar(pode) {
      $('sonsEnviarBtn').disabled = !pode;
      $('sonsEnviarBtn').title = pode ? 'Enviar um arquivo de som para a mesa' : 'Enviar sons pede uma conta grátis';
      const aviso = $('sonsSemConta');
      if (aviso) {
        aviso.hidden = Boolean(pode);
        aviso.querySelector('a').href = `/conta?voltar=${encodeURIComponent(location.pathname)}`;
      }
    },
    // "Esquecer o que ajustei", em Dispositivos. Devolve a mesa ao padrão e apaga as duas
    // chaves antigas -- elas são desta mesa, e não da camada de preferências, então
    // ninguém mais pode apagá-las.
    esquecerAjustes() {
      volume = 0.7;
      mudo = false;
      try {
        localStorage.removeItem(CHAVE_DO_VOLUME);
        localStorage.removeItem(CHAVE_DO_MUDO);
      } catch (_) { /* Sem armazenamento, nao havia o que apagar. */ }
      aplicarGanho();
      pintarVolume();
    },
    // Chamado por `retomarMidias`, em sala.js, junto com todo <audio> da página: no toque
    // em "Ativar reprodução", ao voltar do segundo plano e no "pageshow".
    //
    // Sem isto, um iPhone que entrasse na sala e nunca abrisse esta janela ficaria com o
    // contexto suspenso: o Safari só o libera dentro de um gesto, e o `resume()` que o
    // disparo tenta por conta própria não vale como gesto. A pessoa não ouviria os sons da
    // mesa, sem nada na tela explicando por quê -- enquanto ouviria a voz da sala
    // normalmente, o que tornaria o defeito quase impossível de descrever.
    destravar() {
      garantirContexto();
      // Prepara o que já está na mesa aproveitando o gesto: o download e a decodificação
      // deixam de acontecer no meio do primeiro clique de alguém.
      sons.forEach(prepararSom);
    },

    // Para o diagnóstico da sala e para os testes: "a mesa está muda?" é uma pergunta que
    // não dá para responder olhando a tela, porque um som que não toca é indistinguível de
    // um som que ninguém disparou.
    estado() {
      return {
        suportado: Boolean(ContextoDeAudio),
        audioLiberado: contexto ? contexto.state === 'running' : false,
        contextoCriado: Boolean(contexto),
        sonsNaMesa: sons.length,
        sonsPreparados: decodificados.size,
        // Quantas pessoas têm um som tocando agora neste navegador, e qual é o meu.
        canaisTocando: tocandoPorPessoa.size,
        meuSom: meuToque?.id || null
      };
    },
    pararMeuSom,
    ligar(soquete) {
      soquete.on('soundboard-lista', dados => {
        sons = Array.isArray(dados?.sons) ? dados.sons : [];
        espaco = dados?.espaco || espaco;
        // Som que saiu da mesa nao precisa continuar ocupando memoria aqui.
        for (const id of [...decodificados.keys()]) if (!sons.some(som => som.id === id)) decodificados.delete(id);
        // O download comeca assim que o som aparece, nao quando alguem abre o painel: o
        // primeiro toque de um som novo tem de sair tao rapido quanto o segundo.
        if (contexto) sons.forEach(prepararSom);
        pintarGrade();
      });
      soquete.on('soundboard-tocou', dados => {
        if (!dados?.id) return;
        // Quem disparou é o que separa um canal do outro. O servidor sempre manda; o
        // `||` é só para nunca cair num `undefined` que juntaria pessoas diferentes.
        tocarLocalmente(dados.id, String(dados.porId || 'sem-dono'));
        acenderBotao(dados.id);
      });
      // Quem tocou pediu para parar: corta o canal dessa pessoa, se ainda for o mesmo som.
      soquete.on('soundboard-parou', dados => {
        if (!dados?.porId || !dados.id) return;
        cortarDe(String(dados.porId), String(dados.id));
      });
    },
    aoEntrar(pacote) {
      if (!pacote) return;
      sons = Array.isArray(pacote.sons) ? pacote.sons : [];
      espaco = pacote.espaco || null;
      limiteDoSom = Number(pacote.limiteDoSom) || limiteDoSom;
      // Quem entra numa sala que JÁ tem mesa montada precisa baixar o que está nela agora,
      // e não no meio do primeiro clique de alguém -- senão o primeiro disparo que essa
      // pessoa ouvir chega atrasado, justamente o que a mesa existe para evitar.
      if (contexto) sons.forEach(prepararSom);
      pintarGrade();
    }
  };
})();
