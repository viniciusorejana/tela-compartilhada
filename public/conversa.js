/* A conversa direta com um amigo: a lista de mensagens, o convite com o botão de entrar, o "visto"
 * e a caixa de escrever. A mesma peça no início (no centro da tela) e na sala (num painel).
 *
 * As mensagens moram na memória do servidor e somem três dias depois da última (social.js); a
 * conversa diz isso uma vez, no topo, para ninguém contar com ela como arquivo.
 *
 * Texto de outra pessoa entra por `textContent`; só os links viram <a>, montados aqui.
 */
(function (root) {
  const doc = root.document;
  const S = () => root.NexoSocial;
  const MINUTOS_PARA_AGRUPAR = 5;

  const elemento = (tag, classe, texto) => {
    const el = doc.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const icone = (caminho, classe = 'ico') => {
    const el = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('class', classe);
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = caminho;
    return el;
  };
  const DESENHOS = {
    enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    porta: '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16 4-4-4-4M14 12H4"/>',
    voltar: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chamar: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4zm16 0h1v7h-4v-7h3z"/><path d="M12 3v4M10 5h4"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>'
  };

  // ---------- O visor da imagem ----------
  // Clicar numa imagem da conversa abre ela grande, por cima de tudo; clicar ou Esc fecha. O Esc é
  // ouvido na janela, antes de qualquer outro: na sala, o Esc fecharia o painel de mensagens junto.
  function abrirVisor(src, descricao) {
    // `nx-social`: o visor mora fora da conversa (no fim da página), e é essa classe que dá ao X a
    // base de botão das peças sociais, a salvo das regras globais de botão da sala.
    const visor = elemento('div', 'nx-dm-visor nx-social');
    visor.setAttribute('role', 'group');
    visor.setAttribute('aria-label', descricao);
    const img = elemento('img');
    img.src = src;
    img.alt = descricao;
    const fechar = elemento('button', 'nx-dm-visor-fechar');
    fechar.type = 'button';
    fechar.title = 'Fechar';
    fechar.setAttribute('aria-label', 'Fechar a imagem');
    fechar.append(icone(DESENHOS.fechar));
    visor.append(img, fechar);
    const antes = doc.activeElement;
    const sair = () => { root.removeEventListener('keydown', teclas, true); visor.remove(); antes?.focus?.(); };
    function teclas(evento) {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      sair();
    }
    visor.addEventListener('click', sair);
    root.addEventListener('keydown', teclas, true);
    doc.body.append(visor);
    fechar.focus();
  }

  const hora = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function quando(ms) {
    const data = new Date(ms), hoje = new Date();
    const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    if (data.toDateString() === hoje.toDateString()) return `Hoje às ${hora(ms)}`;
    if (data.toDateString() === ontem.toDateString()) return `Ontem às ${hora(ms)}`;
    return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora(ms)}`;
  }

  function texto(destino, conteudo) {
    String(conteudo || '').split(/(https?:\/\/[^\s<]+)/gi).forEach((parte, i) => {
      if (!parte) return;
      if (i % 2) {
        const a = elemento('a', '', parte);
        a.href = parte;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        destino.append(a);
      } else destino.append(doc.createTextNode(parte));
    });
  }

  // `opcoes`: aoVoltar (o botão de voltar, no celular), aoAbrirPerfil(codigo), aoChamar(codigo).
  function abrir(raiz, codigo, opcoes = {}) {
    const social = S();
    const pessoa = () => social.pessoa(codigo);
    let mensagens = [];
    let lidaPeloOutro = 0;
    let podeEscrever = true;
    let ultimoDigitar = 0;
    let digitandoTimer = null;
    let fechado = false;
    const paradas = [];
    const ouvir = (nome, fn) => { paradas.push(social.on(nome, dados => { if (!fechado) fn(dados); })); };

    const caixa = elemento('section', 'nx-dm');
    caixa.setAttribute('aria-label', `Conversa com ${social.nomeDe(codigo)}`);
    const topo = elemento('header', 'nx-dm-topo');
    if (opcoes.aoVoltar) {
      const voltar = elemento('button', 'nx-dm-botao nx-dm-voltar');
      voltar.type = 'button';
      voltar.title = voltar.ariaLabel = 'Voltar';
      voltar.setAttribute('aria-label', 'Voltar');
      voltar.append(icone(DESENHOS.voltar));
      voltar.onclick = () => opcoes.aoVoltar();
      topo.append(voltar);
    }
    const quem = elemento('button', 'nx-dm-quem');
    quem.type = 'button';
    quem.title = 'Ver o perfil';
    const avatarLugar = elemento('span', 'nx-dm-avatar');
    const nomes = elemento('span', 'nx-dm-nomes');
    const nome = elemento('strong', '', social.nomeDe(codigo));
    const presenca = elemento('small', '');
    nomes.append(nome, presenca);
    quem.append(avatarLugar, nomes);
    quem.onclick = () => opcoes.aoAbrirPerfil?.(codigo);
    topo.append(quem);
    const acoes = elemento('div', 'nx-dm-acoes');
    if (opcoes.aoChamar) {
      const chamar = elemento('button', 'nx-dm-botao');
      chamar.type = 'button';
      chamar.title = 'Chamar para uma sala';
      chamar.setAttribute('aria-label', 'Chamar para uma sala');
      chamar.append(icone(DESENHOS.chamar));
      chamar.onclick = evento => opcoes.aoChamar(codigo, evento.currentTarget);
      acoes.append(chamar);
    }
    topo.append(acoes);

    const lista = elemento('div', 'nx-dm-lista');
    lista.setAttribute('role', 'log');
    lista.setAttribute('aria-live', 'polite');
    lista.tabIndex = 0;
    const aviso = elemento('p', 'nx-dm-aviso');
    aviso.append(icone(DESENHOS.relogio, 'ico ico-p'), doc.createTextNode('As mensagens diretas ficam só na memória do servidor e somem três dias depois da última. Nada disso vai para um arquivo.'));
    const mensagensEl = elemento('div', 'nx-dm-mensagens');
    lista.append(aviso, mensagensEl);
    const digitandoEl = elemento('p', 'nx-dm-digitando');
    digitandoEl.setAttribute('aria-live', 'polite');

    const compor = elemento('form', 'nx-dm-compor');
    compor.noValidate = true;
    const campo = elemento('textarea');
    campo.rows = 1;
    campo.maxLength = 1000;
    campo.setAttribute('aria-label', `Mensagem para ${social.nomeDe(codigo)}`);
    const enviar = elemento('button', 'nx-dm-enviar');
    enviar.type = 'submit';
    enviar.title = 'Enviar';
    enviar.setAttribute('aria-label', 'Enviar');
    enviar.append(icone(DESENHOS.enviar));
    // A imagem: pelo botão, colando no campo ou arrastando para a conversa. Ela fica numa prévia
    // acima do campo até ir, para dar tempo de escrever a legenda -- ou de desistir.
    const anexar = elemento('button', 'nx-dm-anexar');
    anexar.type = 'button';
    anexar.title = 'Mandar uma imagem';
    anexar.setAttribute('aria-label', 'Mandar uma imagem');
    anexar.append(icone(DESENHOS.imagem));
    const arquivo = elemento('input');
    arquivo.type = 'file';
    arquivo.accept = 'image/png,image/jpeg,image/gif,image/webp';
    arquivo.hidden = true;
    compor.append(anexar, arquivo, campo, enviar);
    const previaDoAnexo = elemento('div', 'nx-dm-anexo');
    previaDoAnexo.hidden = true;
    const status = elemento('p', 'nx-dm-status');
    status.setAttribute('role', 'status');
    caixa.append(topo, lista, digitandoEl, previaDoAnexo, compor, status);
    raiz.replaceChildren(caixa);

    function pintarTopo() {
      const p = pessoa();
      const pres = social.presencaDe(codigo);
      nome.textContent = social.nomeDe(codigo);
      root.NexoCartao.estilizarNome(nome, p?.vitrine || null);
      presenca.textContent = root.NexoCartao.descreverPresenca(pres);
      avatarLugar.replaceChildren(root.NexoCartao.avatar({ nome: p?.apelido || codigo, perfil: p?.perfil, vitrine: p?.vitrine, status: pres.status, tamanho: 'pequeno' }));
      campo.placeholder = podeEscrever ? `Mensagem para ${social.nomeDe(codigo)}` : 'Só dá para escrever para amigos';
      campo.disabled = !podeEscrever;
      enviar.disabled = !podeEscrever;
      anexar.disabled = !podeEscrever;
    }

    const perto = () => lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
    const descer = () => { lista.scrollTop = lista.scrollHeight; };

    function desenhar() {
      const eu = social.estado.eu;
      mensagensEl.replaceChildren();
      let anterior = null;
      for (const m of mensagens) {
        const minha = m.de === eu;
        const agrupa = anterior && anterior.de === m.de && m.em - anterior.em < MINUTOS_PARA_AGRUPAR * 60000 && anterior.tipo !== 'convite' && m.tipo !== 'convite';
        const linha = elemento('div', `nx-dm-msg${agrupa ? ' agrupada' : ''}${minha ? ' minha' : ''}`);
        linha.dataset.id = m.id;
        if (!agrupa) {
          const autor = minha ? root.NexoConta?.atual()?.conta : pessoa();
          const perfilDoAutor = minha ? { conta: true, codigo: eu, ...(root.NexoConta?.atual()?.perfil || {}) } : pessoa()?.perfil;
          // A borda e o estilo do nome de cada um, como no cartão: os meus pelo cartão que a minha
          // conta mostra (conta-cliente.js), os do amigo pela lista de amigos.
          const vitrineDoAutor = (minha ? root.NexoConta?.atual()?.cartao?.vitrine : pessoa()?.vitrine) || null;
          const av = elemento('span', 'nx-dm-msg-avatar');
          root.NexoPerfil.pintar(av, minha ? (autor?.apelido || 'Você') : (autor?.apelido || '?'), perfilDoAutor);
          root.NexoCartao.decorarAvatar(av, vitrineDoAutor);
          av.setAttribute('aria-hidden', 'true');
          const cabeca = elemento('div', 'nx-dm-msg-cabeca');
          const nomeDoAutor = elemento('strong', '', minha ? 'Você' : social.nomeDe(m.de));
          root.NexoCartao.estilizarNome(nomeDoAutor, vitrineDoAutor);
          cabeca.append(nomeDoAutor, elemento('time', '', quando(m.em)));
          linha.append(av, cabeca);
        }
        if (m.tipo === 'convite') {
          const convite = elemento('div', 'nx-dm-convite');
          convite.append(icone(DESENHOS.porta));
          const textos = elemento('span', 'nx-dm-convite-texto');
          textos.append(elemento('strong', '', minha ? `Você chamou para #${m.sala}` : `Chamou você para #${m.sala}`), elemento('small', '', 'Convite para uma sala do Nexo'));
          const entrar = elemento('a', 'nx-dm-convite-entrar', 'Entrar na sala');
          entrar.href = `/${encodeURIComponent(m.sala)}/sala`;
          convite.append(textos, entrar);
          linha.append(convite);
        } else {
          if (m.texto) {
            const corpo = elemento('p', 'nx-dm-msg-texto');
            texto(corpo, m.texto);
            linha.append(corpo);
          }
          if (m.imagem) linha.append(imagemDaMensagem(m, minha));
        }
        if (minha) {
          const apagar = elemento('button', 'nx-dm-apagar');
          apagar.type = 'button';
          apagar.title = 'Apagar para os dois';
          apagar.setAttribute('aria-label', 'Apagar esta mensagem para os dois');
          apagar.append(icone(DESENHOS.lixo, 'ico ico-p'));
          apagar.onclick = async () => {
            const r = await social.apagar(codigo, m.id);
            if (!r.ok) dizer(r.error || 'Não foi possível apagar.');
          };
          linha.append(apagar);
        }
        mensagensEl.append(linha);
        anterior = m;
      }
      // "Visto", embaixo da última mensagem minha que o outro já leu.
      const ultimaMinha = [...mensagens].reverse().find(m => m.de === eu);
      if (ultimaMinha && lidaPeloOutro >= ultimaMinha.em) {
        const visto = elemento('p', 'nx-dm-visto', 'Visto');
        mensagensEl.append(visto);
      }
      if (!mensagens.length) mensagensEl.append(elemento('p', 'nx-dm-vazio', `Diga oi para ${social.nomeDe(codigo)}. A conversa é só de vocês dois.`));
    }

    // A imagem da mensagem, pelo endereço dela (só os dois da conversa abrem). O lugar já nasce do
    // tamanho certo -- as dimensões vêm com a mensagem --, e a conversa não pula quando ela chega.
    // A que saiu da memória (o teto do servidor, social.js) vira uma linha dizendo isso.
    const LARGURA_DA_IMAGEM = 360, ALTURA_DA_IMAGEM = 300;
    const saiuDaMemoria = () => elemento('p', 'nx-dm-img-saiu', 'Esta imagem já saiu da memória do servidor.');
    function imagemDaMensagem(m, minha) {
      if (!m.imagem?.id) return saiuDaMemoria();
      const descricao = `Imagem enviada por ${minha ? 'você' : social.nomeDe(m.de)}`;
      const src = `/api/social/imagem/${encodeURIComponent(m.imagem.id)}`;
      const botao = elemento('button', 'nx-dm-img');
      botao.type = 'button';
      botao.title = 'Ver a imagem maior';
      const img = elemento('img');
      img.alt = descricao;
      img.decoding = 'async';
      img.loading = 'lazy';
      const { largura, altura } = m.imagem;
      if (largura && altura) {
        const escala = Math.min(1, LARGURA_DA_IMAGEM / largura, ALTURA_DA_IMAGEM / altura);
        img.style.width = `${Math.round(largura * escala)}px`;
        img.style.aspectRatio = `${largura} / ${altura}`;
      }
      img.onerror = () => botao.replaceWith(saiuDaMemoria());
      img.src = src;
      botao.append(img);
      botao.onclick = () => abrirVisor(src, descricao);
      return botao;
    }

    // `tom`: 'erro' (o padrão, em vermelho) ou 'andamento' ("Enviando a imagem…", sem alarme).
    function dizer(textoDoStatus, tom = 'erro') {
      status.textContent = textoDoStatus || '';
      status.dataset.tom = tom;
      if (textoDoStatus) setTimeout(() => { if (status.textContent === textoDoStatus) status.textContent = ''; }, 4000);
    }

    async function carregar() {
      const r = await social.historico(codigo);
      if (fechado) return;
      if (!r.ok) { dizer(r.error || 'Não foi possível abrir a conversa.'); return; }
      mensagens = r.mensagens || [];
      lidaPeloOutro = r.lidaPeloOutro || 0;
      podeEscrever = r.podeEscrever !== false;
      pintarTopo();
      desenhar();
      descer();
      social.marcarLida(codigo);
    }

    // ---------- A imagem a enviar ----------
    let anexo = null;          // { dataUrl, largura, altura } (imagem-envio.js)
    let preparando = false;
    function pintarAnexo() {
      previaDoAnexo.hidden = !anexo;
      if (!anexo) { previaDoAnexo.replaceChildren(); return; }
      const miniatura = elemento('img', 'nx-dm-anexo-miniatura');
      miniatura.src = anexo.dataUrl;
      miniatura.alt = '';
      const textos = elemento('span', 'nx-dm-anexo-textos');
      textos.append(elemento('strong', '', 'Imagem pronta para enviar'), elemento('small', '', 'Escreva uma legenda, se quiser, e envie.'));
      const tirar = elemento('button', 'nx-dm-botao');
      tirar.type = 'button';
      tirar.title = 'Tirar a imagem';
      tirar.setAttribute('aria-label', 'Tirar a imagem');
      tirar.append(icone(DESENHOS.fechar));
      tirar.onclick = () => { anexo = null; pintarAnexo(); campo.focus(); };
      previaDoAnexo.replaceChildren(miniatura, textos, tirar);
    }
    async function anexarArquivo(arquivoEscolhido) {
      if (!arquivoEscolhido || !podeEscrever || preparando) return;
      if (!root.NexoImagem?.prepararParaConversa) { dizer('Este navegador não consegue preparar a imagem.'); return; }
      preparando = true;
      dizer('Preparando a imagem…', 'andamento');
      try {
        anexo = await root.NexoImagem.prepararParaConversa(arquivoEscolhido);
        dizer('');
        pintarAnexo();
        campo.focus();
      } catch (erro) {
        dizer(erro?.message || 'Não foi possível usar esta imagem.');
      } finally {
        preparando = false;
      }
    }
    anexar.onclick = () => arquivo.click();
    arquivo.onchange = () => { const escolhido = arquivo.files?.[0]; arquivo.value = ''; anexarArquivo(escolhido); };
    campo.addEventListener('paste', evento => {
      const item = [...(evento.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      evento.preventDefault();
      anexarArquivo(item.getAsFile());
    });
    caixa.addEventListener('dragover', evento => { if ([...(evento.dataTransfer?.types || [])].includes('Files')) evento.preventDefault(); });
    caixa.addEventListener('drop', evento => {
      const solto = evento.dataTransfer?.files?.[0];
      if (!solto) return;
      evento.preventDefault();
      anexarArquivo(solto);
    });

    compor.addEventListener('submit', async evento => {
      evento.preventDefault();
      const conteudo = campo.value.trim();
      if ((!conteudo && !anexo) || enviar.disabled || preparando) return;
      enviar.disabled = true;
      if (anexo) dizer('Enviando a imagem…', 'andamento');
      const r = await social.enviar(codigo, conteudo, anexo);
      enviar.disabled = !podeEscrever;
      if (!r.ok) { dizer(r.error || 'Não foi possível enviar.'); return; }
      dizer('');
      campo.value = '';
      anexo = null;
      pintarAnexo();
      ajustarAltura();
      campo.focus();
    });
    function ajustarAltura() { campo.style.height = 'auto'; campo.style.height = `${Math.min(campo.scrollHeight, 140)}px`; }
    campo.addEventListener('input', () => {
      ajustarAltura();
      if (Date.now() - ultimoDigitar > 2500) { ultimoDigitar = Date.now(); social.digitando(codigo); }
    });
    campo.addEventListener('keydown', evento => {
      if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) { evento.preventDefault(); compor.requestSubmit(); }
    });

    ouvir('mensagem', ({ com, mensagem }) => {
      if (com !== codigo) return;
      const descia = perto();
      mensagens.push(mensagem);
      if (mensagens.length > 60) mensagens.shift();
      digitandoEl.textContent = '';
      desenhar();
      if (descia || mensagem.de === social.estado.eu) descer();
      // Aberta e à vista, a conversa está lida.
      if (mensagem.de !== social.estado.eu && doc.visibilityState === 'visible') social.marcarLida(codigo);
    });
    ouvir('lida', ({ com, em, minha }) => { if (com === codigo && !minha) { lidaPeloOutro = em; desenhar(); } });
    ouvir('apagada', ({ com, id }) => { if (com !== codigo) return; mensagens = mensagens.filter(m => m.id !== id); desenhar(); });
    ouvir('digitando', ({ com }) => {
      if (com !== codigo) return;
      digitandoEl.textContent = `${social.nomeDe(codigo)} está escrevendo…`;
      clearTimeout(digitandoTimer);
      digitandoTimer = setTimeout(() => { digitandoEl.textContent = ''; }, 3500);
    });
    ouvir('presenca', ({ codigo: quemMudou }) => { if (quemMudou === codigo) pintarTopo(); });
    ouvir('amigos', () => pintarTopo());
    ouvir('pronto', () => carregar());
    const aoVoltarAVista = () => { if (doc.visibilityState === 'visible' && !fechado) social.marcarLida(codigo); };
    doc.addEventListener('visibilitychange', aoVoltarAVista);

    pintarTopo();
    desenhar();
    carregar();
    return {
      codigo,
      focar: () => campo.focus(),
      fechar() { fechado = true; clearTimeout(digitandoTimer); paradas.forEach(parar => parar()); doc.removeEventListener('visibilitychange', aoVoltarAVista); caixa.remove(); }
    };
  }

  root.NexoConversa = { abrir, quando };
})(window);
