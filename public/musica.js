/* Canal de musica: o que a sala pede e o que o bot responde.
 *
 * O SOM nao passa por aqui. Ele chega como qualquer outro participante -- o bot publica
 * uma faixa de audio e o quadradinho dele aparece na sala com o controle de volume que
 * todo participante tem. Este arquivo cuida so do canal: os pedidos, a fila e o que esta
 * tocando.
 *
 * Por isso o volume aparece em dois lugares, e eles nao brigam: o daqui e o do bot (vale
 * para a sala inteira, como abaixar o rádio); o do quadradinho e o de cada um (vale so
 * para quem mexeu, como tapar o proprio ouvido).
 */
(() => {
  const $ = id => document.getElementById(id);
  const appRoot = document.querySelector('.app');
  const painel = $('musicaPanel');
  const mensagens = $('musicaMsgs');
  const entrada = $('musicaInput');

  let naoLidasNaMusica = 0;
  let estadoAtual = { conectado: false, tocando: null, fila: [], volume: 85, pausado: false };
  let disponivel = true;
  let pertoDoFim = true;
  // O tempo decorrido anda de segundo em segundo aqui, entre um aviso e outro do servidor.
  // Sem isto a barra so se mexeria quando alguma coisa mudasse -- e ficaria parada durante
  // a musica inteira, que e justamente quando alguem olha para ela.
  let relogio = null;
  let decorridoLocal = 0;

  function painelVisivel() {
    if (appRoot.classList.contains('teatro')) return false;
    if (!appRoot.classList.contains('painel-musica')) return false;
    if (appRoot.classList.contains('sem-chat')) return false;
    return window.matchMedia('(min-width: 1101px)').matches || painel.classList.contains('aberto');
  }

  function abrirMusica() {
    definirModoTeatro(false);
    appRoot.classList.add('painel-musica');
    appRoot.classList.remove('sem-chat');
    painel.classList.add('aberto');
    // O painel do chat divide a coluna com este: deixar a classe dele ligada faria os dois
    // aparecerem sobrepostos na tela estreita, onde ambos sao camadas.
    $('chatPanel').classList.remove('aberto');
    naoLidasNaMusica = 0;
    marcarSidebar();
    entrada.focus();
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  function fecharMusica() {
    painel.classList.remove('aberto');
    appRoot.classList.remove('painel-musica');
    appRoot.classList.add('sem-chat');
  }

  // O chat e a musica dividem a mesma coluna: abrir um tem de fechar o outro, e quem abre
  // o chat passa por `abrirChat`, que nao conhece este arquivo -- o botao do topo, o X, o
  // Escape e a barra lateral, todos. Envolver as duas funcoes e o que mantem a coluna
  // coerente sem repetir a regra em cada um desses lugares.
  const abrirChatOriginal = window.abrirChat;
  window.abrirChat = function () {
    appRoot.classList.remove('painel-musica');
    painel.classList.remove('aberto');
    abrirChatOriginal.apply(this, arguments);
    marcarSidebar();
  };
  const fecharChatOriginal = window.fecharChat;
  window.fecharChat = function () {
    fecharChatOriginal.apply(this, arguments);
    marcarSidebar();
  };

  function marcarSidebar() {
    for (const botao of document.querySelectorAll('.channel[data-action]')) {
      const ehMusica = botao.dataset.action === 'musica';
      const ehChat = botao.dataset.action === 'chat';
      const ehSala = botao.dataset.action === 'room';
      const musicaAberta = appRoot.classList.contains('painel-musica') && !appRoot.classList.contains('sem-chat');
      const chatAberto = !appRoot.classList.contains('painel-musica') && !appRoot.classList.contains('sem-chat');
      botao.classList.toggle('active', (ehMusica && musicaAberta) || (ehChat && chatAberto) || (ehSala && appRoot.classList.contains('sem-chat')));
    }
    const resumo = $('sidebarMusica');
    if (resumo) {
      resumo.textContent = estadoAtual.tocando
        ? (estadoAtual.pausado ? 'Pausado' : estadoAtual.tocando.titulo)
        : estadoAtual.fila.length ? `${estadoAtual.fila.length} na fila` : 'Peça uma música';
    }
    $('musicaLive').hidden = !estadoAtual.tocando || estadoAtual.pausado;
  }

  // ---------- Texto ----------
  //
  // O bot manda **negrito**, `código` e links. NADA vira HTML por concatenacao: cada
  // pedaco entra como no de texto ou como elemento criado a mao, que e o que impede uma
  // mensagem de virar marcacao na tela de quem le.
  const PEDACOS = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<]+)/g;

  function montarTextoDaMusica(destino, texto) {
    for (const linha of String(texto).split('\n')) {
      if (destino.childNodes.length) destino.appendChild(document.createElement('br'));
      for (const parte of linha.split(PEDACOS)) {
        if (!parte) continue;
        if (parte.startsWith('**') && parte.endsWith('**') && parte.length > 4) {
          const forte = document.createElement('strong');
          forte.textContent = parte.slice(2, -2);
          destino.appendChild(forte);
        } else if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2) {
          const codigo = document.createElement('code');
          codigo.textContent = parte.slice(1, -1);
          destino.appendChild(codigo);
        } else if (/^https?:\/\//.test(parte)) {
          const link = document.createElement('a');
          link.href = parte;
          link.textContent = parte.length > 48 ? `${parte.slice(0, 45)}…` : parte;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          destino.appendChild(link);
        } else {
          destino.appendChild(document.createTextNode(parte));
        }
      }
    }
  }

  function mostrarMensagemDeMusica(msg) {
    const vazio = mensagens.querySelector('.chat-vazio');
    if (vazio) vazio.remove();
    pertoDoFim = mensagens.scrollHeight - mensagens.scrollTop - mensagens.clientHeight < 80;

    const el = document.createElement('div');
    el.className = msg.doBot ? 'msg do-bot' : 'msg';
    const avatar = document.createElement('span');
    avatar.className = 'msg-avatar';
    avatar.textContent = msg.doBot ? '♪' : iniciais(msg.autor || '?');
    if (!msg.doBot) avatar.style.background = corDoNome(msg.autor || '');
    avatar.setAttribute('aria-hidden', 'true');

    const topo = document.createElement('div');
    topo.className = 'msg-topo';
    const autor = document.createElement('span');
    autor.className = 'msg-autor';
    autor.textContent = msg.autor || 'Alguém';
    if (!msg.doBot) autor.style.color = corDoNome(msg.autor || '');
    const hora = document.createElement('span');
    hora.className = 'msg-hora';
    hora.textContent = horaCurta(msg.em || Date.now());
    topo.append(autor, hora);

    const corpo = document.createElement('div');
    corpo.className = 'msg-texto';
    montarTextoDaMusica(corpo, msg.texto || '');

    // Listas encontradas por nome viram botões. O endereço fica guardado no objeto, nunca
    // escrito no HTML: ele vem de uma busca externa, e um botão é um alvo mais seguro do
    // que um link montado com texto de fora.
    if (Array.isArray(msg.opcoes) && msg.opcoes.length) {
      const escolhas = document.createElement('div');
      escolhas.className = 'escolhas-de-lista';
      for (const opcao of msg.opcoes.slice(0, 8)) {
        if (!/^https:\/\/(www\.|music\.)?youtube\.com\//i.test(opcao?.endereco || '')) continue;
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.textContent = opcao.titulo || 'Lista';
        botao.title = `Enfileirar "${opcao.titulo}"`;
        botao.onclick = () => {
          // Desabilita o grupo inteiro: dois toques seguidos enfileirariam duas listas.
          escolhas.querySelectorAll('button').forEach(b => { b.disabled = true; });
          botao.classList.add('escolhida');
          enviarComando(`!lista ${opcao.endereco}`);
        };
        escolhas.appendChild(botao);
      }
      if (escolhas.childElementCount) corpo.appendChild(escolhas);
    }

    el.append(avatar, topo, corpo);
    mensagens.appendChild(el);
    if (pertoDoFim) mensagens.scrollTop = mensagens.scrollHeight;

    if (!painelVisivel() && msg.autorId !== meuSocketId) {
      naoLidasNaMusica++;
      marcarSidebar();
    }
  }

  function mostrarVazioDaMusica() {
    mensagens.replaceChildren();
    const p = document.createElement('div');
    p.className = 'chat-vazio';
    const titulo = document.createElement('strong');
    titulo.textContent = disponivel ? 'Peça uma música.' : 'O bot não está instalado.';
    p.append(titulo, document.createTextNode(disponivel
      ? 'Escreva o nome, cole um link do YouTube, SoundCloud ou Spotify, e eu entro na chamada para tocar.'
      : 'Na máquina que hospeda a sala, rode "npm run musica:instalar". O resto da sala funciona normalmente.'));
    mensagens.appendChild(p);
  }

  // ---------- O que está tocando ----------

  function tempoLegivel(segundos) {
    const inteiro = Math.max(0, Math.floor(segundos || 0));
    return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, '0')}`;
  }

  function pintarTocando() {
    const tocando = estadoAtual.tocando;
    $('tocandoAgora').hidden = !tocando;
    $('musicaVolume').hidden = !estadoAtual.conectado;
    if (!tocando) {
      $('tocandoCapa').style.backgroundImage = '';
      return;
    }
    $('tocandoAgora').classList.toggle('pausado', estadoAtual.pausado);
    $('tocandoTitulo').textContent = tocando.titulo;
    $('tocandoAutor').textContent = [tocando.autor, tocando.pedidoPor && `pedida por ${tocando.pedidoPor}`].filter(Boolean).join(' · ');
    // A capa vem de fora e vai para uma propriedade de CSS: sem as aspas e a checagem de
    // esquema, uma URL com parenteses ou com "javascript:" sairia do lugar dela.
    $('tocandoCapa').style.backgroundImage = /^https:\/\//.test(tocando.capa || '') ? `url("${CSS.escape(tocando.capa).replace(/\\/g, '\\\\')}")` : '';
    $('tocandoCapa').textContent = tocando.capa ? '' : '♪';
    $('musicaPausar').textContent = estadoAtual.pausado ? '▶' : '⏸';
    $('musicaPausar').title = estadoAtual.pausado ? 'Voltar' : 'Pausar';

    const duracao = tocando.duracao || 0;
    $('tocandoTempo').textContent = duracao ? `${tempoLegivel(decorridoLocal)} / ${tempoLegivel(duracao)}` : tempoLegivel(decorridoLocal);
    $('tocandoProgresso').style.width = duracao ? `${Math.min(100, (decorridoLocal / duracao) * 100)}%` : '0%';
  }

  function pintarFila() {
    const fila = estadoAtual.fila;
    $('musicaFila').hidden = !fila.length;
    $('musicaFilaTotal').textContent = fila.length;
    $('musicaFilaLista').replaceChildren(...fila.slice(0, 30).map((faixa, indice) => {
      const item = document.createElement('li');
      const nome = document.createElement('span');
      nome.textContent = faixa.titulo;
      const detalhe = document.createElement('small');
      detalhe.textContent = [faixa.duracao ? tempoLegivel(faixa.duracao) : null, faixa.pedidoPor].filter(Boolean).join(' · ');
      const tirar = document.createElement('button');
      tirar.type = 'button';
      tirar.textContent = '✕';
      tirar.title = `Tirar ${faixa.titulo} da fila`;
      tirar.onclick = () => enviarComando(`!remover ${indice + 1}`);
      item.append(nome, tirar, detalhe);
      return item;
    }));
  }

  function pintarVolume() {
    $('musicaVolumeSlider').value = estadoAtual.volume;
    $('musicaVolumeValor').textContent = `${estadoAtual.volume}%`;
  }

  function aplicarEstado(novo) {
    if (!novo) return;
    const trocouDeFaixa = novo.tocando?.id !== estadoAtual.tocando?.id;
    estadoAtual = novo;
    // O tempo do servidor manda na troca de faixa e sempre que o desvio passar de dois
    // segundos. Entre isso, o relogio local conta sozinho -- adotar o valor do servidor a
    // cada aviso faria a barra pular para tras por causa do atraso da rede.
    const doServidor = novo.tocando?.decorrido || 0;
    if (trocouDeFaixa || Math.abs(doServidor - decorridoLocal) > 2) decorridoLocal = doServidor;
    pintarTocando();
    pintarFila();
    pintarVolume();
    marcarSidebar();
    tocarRelogio();
  }

  function tocarRelogio() {
    clearInterval(relogio);
    relogio = null;
    if (!estadoAtual.tocando || estadoAtual.pausado) return;
    relogio = setInterval(() => {
      decorridoLocal++;
      pintarTocando();
    }, 1000);
  }

  // ---------- Enviar ----------

  function enviarComando(texto) {
    const limpo = String(texto || '').trim();
    if (!limpo) return;
    if (!socket?.connected) { status.textContent = 'Aguarde a reconexão para pedir música.'; return; }
    socket.emit('musica-comando', { texto: limpo });
  }

  $('musicaSend').onclick = () => {
    const texto = entrada.value.trim();
    if (!texto) return;
    enviarComando(texto);
    entrada.value = '';
    entrada.style.height = 'auto';
  };
  entrada.addEventListener('keydown', evento => {
    if (evento.key === 'Enter' && !evento.shiftKey) { evento.preventDefault(); $('musicaSend').click(); }
  });
  entrada.addEventListener('input', () => {
    entrada.style.height = 'auto';
    entrada.style.height = `${Math.min(120, entrada.scrollHeight)}px`;
  });
  mensagens.addEventListener('scroll', () => {
    pertoDoFim = mensagens.scrollHeight - mensagens.scrollTop - mensagens.clientHeight < 80;
  });

  $('musicaClose').onclick = fecharMusica;
  $('musicaPausar').onclick = () => enviarComando(estadoAtual.pausado ? '!voltar' : '!pausar');
  $('musicaPular').onclick = () => enviarComando('!pular');

  // O volume do bot vale para a sala toda, entao ele so e enviado quando a pessoa SOLTA o
  // controle. Mandando a cada pixel, um arrasto viraria trinta avisos para todo mundo.
  $('musicaVolumeSlider').addEventListener('input', () => {
    $('musicaVolumeValor').textContent = `${$('musicaVolumeSlider').value}%`;
  });
  $('musicaVolumeSlider').addEventListener('change', () => enviarComando(`!volume ${$('musicaVolumeSlider').value}`));

  mostrarVazioDaMusica();
  // Em tela larga a sala abre com o chat na coluna, e nao com "Sala de voz" -- que era o
  // que o HTML marcava. Acertar aqui, uma vez, evita que o primeiro clique em qualquer
  // canal seja tambem o que corrige a marcacao.
  marcarSidebar();

  window.NexoMusica = {
    abrir: abrirMusica,
    fechar: fecharMusica,
    marcarSidebar,
    // Chamado por sala.js assim que o socket existe. O Socket.IO reconecta sozinho sem
    // trocar de objeto, entao ligar uma vez basta para a sessao inteira.
    ligar(soquete) {
      soquete.on('musica-mensagem', mostrarMensagemDeMusica);
      soquete.on('musica-estado', aplicarEstado);
    },
    // Chamado pelo `join-room`: o estado inteiro do canal chega de uma vez, junto com o
    // resto da sala, em vez de custar duas idas e voltas so para descobrir se ha musica.
    aoEntrar(pacote) {
      if (!pacote) return;
      disponivel = pacote.disponivel !== false;
      mensagens.replaceChildren();
      if (Array.isArray(pacote.historico) && pacote.historico.length) pacote.historico.forEach(mostrarMensagemDeMusica);
      else mostrarVazioDaMusica();
      aplicarEstado(pacote.estado);
      naoLidasNaMusica = 0;
      marcarSidebar();
    }
  };

  window.addEventListener('pagehide', () => clearInterval(relogio));
})();
