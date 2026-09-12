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
  let contexto = null;
  let ganho = null;
  // id do som -> AudioBuffer ja decodificado. Baixar e decodificar acontece uma vez, quando
  // o som aparece na lista; o clique so encosta na memoria.
  const decodificados = new Map();
  const baixando = new Map();

  let volume = 0.7;
  let mudo = false;
  try {
    const guardado = Number(localStorage.getItem(CHAVE_DO_VOLUME));
    if (Number.isFinite(guardado) && guardado >= 0 && guardado <= 1) volume = guardado;
    mudo = localStorage.getItem(CHAVE_DO_MUDO) === '1';
  } catch (_) { /* Sem armazenamento, vale o padrao desta aba. */ }

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
    const alvo = mudo ? 0 : volume;
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
    const tarefa = fetch(enderecoDoSom(som.id))
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

  async function tocarLocalmente(id) {
    const contexto = garantirContexto();
    if (!contexto) return;
    const buffer = decodificados.get(id) || await prepararSom({ id });
    if (!buffer) return;
    const fonte = contexto.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ganho);
    fonte.start();
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
      botao.append(nome, autoria);
      botao.title = `Tocar "${som.nome}" para a sala`;
      botao.onclick = () => socket?.emit('soundboard-tocar', { id: som.id });

      const apagar = document.createElement('button');
      apagar.type = 'button';
      apagar.className = 'som-apagar';
      apagar.textContent = '✕';
      apagar.title = `Apagar "${som.nome}" da mesa`;
      apagar.onclick = evento => {
        evento.stopPropagation();
        socket?.emit('soundboard-remover', { id: som.id });
      };

      cartao.append(botao, apagar);
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
      const parametros = new URLSearchParams({ socket: socket.id, nome });
      if (segundos !== null) parametros.set('segundos', String(Math.round(segundos)));
      const resposta = await fetch(`/api/soundboard/${encodeURIComponent(roomCode)}?${parametros}`, {
        method: 'POST',
        headers: { 'Content-Type': arquivo.type || 'application/octet-stream' },
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
        sonsPreparados: decodificados.size
      };
    },
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
        tocarLocalmente(dados.id);
        acenderBotao(dados.id);
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
