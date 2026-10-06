/* O cartão de perfil personalizável: monta o cartão, o avatar com borda e status, e toca o efeito
 * de abrir. A mesma peça no início, na sala e na prévia do editor.
 *
 * Quem decide o que vale é public/vitrine.js (e o servidor, antes): este arquivo só desenha o que
 * recebe. Tudo o que vem de outra pessoa entra por `textContent` -- nome, bio, frase e pensamento
 * são escritos por quem os usa, e nada deles vira marcação.
 */
(function (root) {
  const V = root.NexoVitrine;
  const doc = root.document;

  // Os desenhos das conquistas, no traço dos ícones do Nexo (24×24, linha de 1,9).
  const ICONES = {
    brilho: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/>',
    porta: '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16 4-4-4-4M14 12H4"/>',
    casa: '<path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
    tela: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    claquete: '<path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m3.5 10-.8-3.6L18.3 3l.8 3.6M8 4.8l2 3.3M13.5 3.6l2 3.3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>',
    pena: '<path d="M20 4C12 4 7 9 6 16l-2 4M6 16c5 0 10-3 12-8"/>',
    relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    lua: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    amigos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
    bandeira: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    medalha: '<circle cx="12" cy="15" r="5"/><path d="M8.5 10.5 6 3h4l2 5 2-5h4l-2.5 7.5"/>',
    coracao: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
    cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    trofeu: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'
  };
  const ICONE_DA_CONQUISTA = {
    'boas-vindas': 'brilho', 'primeira-sala': 'porta', anfitriao: 'casa', palco: 'tela', diretor: 'claquete',
    papo: 'chat', cronista: 'pena', maratona: 'relogio', morador: 'lua', turma: 'amigos', popular: 'estrela',
    pioneiro: 'bandeira', veterano: 'medalha'
  };
  const svg = (nome, classe = '') => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ICONES.trofeu}</svg>`;
  const conquista = id => V.CONQUISTAS.find(c => c.id === id);

  const NOMES_DOS_STATUS = { online: 'Disponível', ausente: 'Ausente', ocupado: 'Não incomodar', invisivel: 'Invisível', offline: 'Desconectado' };

  // A frase da presença, curta: o que a lista de amigos mostra embaixo do nome.
  function descreverPresenca(presenca) {
    if (!presenca || presenca.status === 'offline') return 'Desconectado';
    if (presenca.sala) return `Na sala #${presenca.sala.codigo}${presenca.sala.trancada ? ' · trancada' : ''}`;
    return NOMES_DOS_STATUS[presenca.status] || 'Disponível';
  }
  const desde = ms => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '');

  function aplicarCores(el, vitrine) {
    const [a, b] = V.coresDe(vitrine);
    el.style.setProperty('--v1', a);
    el.style.setProperty('--v2', b);
  }

  function elemento(tag, classe, texto) {
    const el = doc.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }

  function camada(id, imagem) {
    if (id === 'imagem' && imagem) {
      const img = elemento('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = `/api/imagem/${imagem}`;
      return img;
    }
    if (V.ANIMADOS.some(a => a.id === id)) {
      const anim = elemento('div', 'nx-anim');
      anim.dataset.anim = id;
      return anim;
    }
    return null;
  }

  // O avatar com a borda e o ponto de status. `tamanho`: '' (o do cartão), 'medio' ou 'pequeno'.
  function avatar({ nome, perfil, vitrine = null, status = null, tamanho = '', id = '' } = {}) {
    const caixa = elemento('span', `nx-av${tamanho ? ` ${tamanho}` : ''}`);
    caixa.dataset.borda = vitrine?.borda || 'nenhuma';
    if (vitrine) aplicarCores(caixa, vitrine);
    const img = elemento('span', 'nx-av-img');
    if (id) img.id = id;
    img.setAttribute('aria-hidden', 'true');
    root.NexoPerfil.pintar(img, nome, perfil);
    caixa.append(img);
    if (status) {
      const ponto = elemento('i', 'nx-av-status');
      ponto.dataset.status = status;
      ponto.title = NOMES_DOS_STATUS[status] || '';
      caixa.append(ponto);
    }
    return caixa;
  }
  function trocarStatus(caixa, status) {
    let ponto = caixa.querySelector('.nx-av-status');
    if (!status) { ponto?.remove(); return; }
    if (!ponto) { ponto = elemento('i', 'nx-av-status'); caixa.append(ponto); }
    ponto.dataset.status = status;
    ponto.title = NOMES_DOS_STATUS[status] || '';
  }

  // ---------- A personalização fora do cartão ----------
  //
  // A borda, o estilo do nome, a moldura e o fundo aparecem também onde a pessoa aparece, para
  // todo mundo ver o tempo todo: a lista da sala, o quadradinho da plateia, o chat, a foto grande,
  // a conversa direta, o início, a página da conta. Cada lugar continua com a peça dele (o avatar
  // de cantos arredondados da sala, o nome da lista); estas funções só acrescentam o que a pessoa
  // escolheu, e tiram quando ela não escolheu nada. `vitrine` é a efetiva (o que o servidor manda
  // em `perfil.cartao.vitrine`), ou null para quem não tem conta.
  const escolhida = (vitrine, grupo, padrao) => (vitrine?.[grupo] && vitrine[grupo] !== padrao ? vitrine[grupo] : '');

  // O anel em volta de um avatar que já existe, no formato dele (`--borda-raio`, cartao.css).
  function decorarAvatar(el, vitrine) {
    if (!el) return;
    const borda = escolhida(vitrine, 'borda', 'nenhuma');
    el.classList.toggle('nx-com-borda', Boolean(borda));
    if (!borda) { delete el.dataset.borda; return; }
    if (el.dataset.borda !== borda) el.dataset.borda = borda;
    aplicarCores(el, vitrine);
  }

  // O estilo do nome num texto que já existe. A cor própria do lugar (o nome colorido do chat)
  // sai quando há estilo: o estilo é a cor.
  function estilizarNome(el, vitrine) {
    if (!el) return;
    const estilo = escolhida(vitrine, 'nome', 'padrao');
    el.classList.toggle('nx-nome-estilo', Boolean(estilo));
    if (!estilo) { delete el.dataset.estilo; return; }
    if (el.dataset.estilo !== estilo) el.dataset.estilo = estilo;
    el.style.removeProperty('color');
    aplicarCores(el, vitrine);
  }

  // A moldura do cartão em volta de uma peça que já existe (o quadradinho, a foto grande).
  function moldurar(el, vitrine) {
    if (!el) return;
    const moldura = escolhida(vitrine, 'moldura', 'nenhuma');
    el.classList.toggle('nx-moldurado', Boolean(moldura));
    if (!moldura) { delete el.dataset.moldura; return; }
    if (el.dataset.moldura !== moldura) el.dataset.moldura = moldura;
    aplicarCores(el, vitrine);
  }

  // O fundo do cartão atrás de uma peça que já existe: uma camada por baixo do conteúdo dela. A
  // camada só é refeita quando o fundo muda -- o quadradinho é repintado a cada perfil que chega, e
  // refazer a imagem ou a animação a cada vez faria ela piscar.
  function vestirFundo(el, vitrine) {
    if (!el) return;
    let camadaEl = el.querySelector(':scope > .nx-fundo-vestido');
    if (!vitrine) {
      camadaEl?.remove();
      el.classList.remove('nx-vestido');
      delete el.dataset.fundo;
      return;
    }
    const chave = `${vitrine.fundo}|${vitrine.imagens?.fundo || ''}`;
    if (!camadaEl) {
      camadaEl = elemento('span', 'nx-fundo-vestido');
      camadaEl.setAttribute('aria-hidden', 'true');
      el.prepend(camadaEl);
    }
    if (camadaEl.dataset.chave !== chave) {
      const dentro = camada(vitrine.fundo, vitrine.imagens?.fundo);
      camadaEl.replaceChildren(...(dentro ? [dentro] : []));
      camadaEl.dataset.chave = chave;
    }
    el.classList.add('nx-vestido');
    if (el.dataset.fundo !== vitrine.fundo) el.dataset.fundo = vitrine.fundo;
    aplicarCores(el, vitrine);
  }

  function selos(ids, vitrine) {
    const lista = elemento('div', 'nx-selos');
    for (const id of ids) {
      const c = conquista(id);
      if (!c) continue;
      const selo = elemento('span', 'nx-selo');
      selo.innerHTML = svg(ICONE_DA_CONQUISTA[id]);
      selo.title = `${c.nome} · ${c.descricao}`;
      selo.setAttribute('role', 'img');
      selo.setAttribute('aria-label', `Conquista: ${c.nome}`);
      lista.append(selo);
    }
    if (vitrine) aplicarCores(lista, vitrine);
    return lista;
  }

  // O cartão inteiro. Devolve as peças que a página completa: `acoes` (os botões dela), `corpo`
  // (para o que só a sala tem, como o tempo na sala) e `avatar` (que, com foto, já abre a foto
  // grande sozinho).
  //   nome, perfil         como em NexoPerfil.pintar
  //   cartao               { vitrine, frase, conquistas, desde } -- o cartão público (servidor)
  //   presenca             { status, sala } -- só para amigos e para si; sem ela, sem ponto
  //   apelidoMeu           o apelido que quem vê deu a esta pessoa
  //   ids                  { avatar, nome, codigo }: ids para os elementos (a sala usa os dela)
  function montar({ nome, perfil = null, cartao = null, presenca = null, apelidoMeu = null, compacto = false, ids = {}, codigo = '', semCodigo = false } = {}) {
    const vitrine = cartao?.vitrine || V.vitrineEfetiva({});
    const el = elemento('article', `nx-cartao contexto-escuro${compacto ? ' compacto' : ''}`);
    el.dataset.fundo = vitrine.fundo;
    el.dataset.moldura = vitrine.moldura;
    aplicarCores(el, vitrine);

    const fundo = elemento('div', 'nx-cartao-fundo');
    const camadaDoFundo = camada(vitrine.fundo, vitrine.imagens?.fundo);
    if (camadaDoFundo) fundo.append(camadaDoFundo);
    el.append(fundo);

    const banner = elemento('div', 'nx-cartao-banner');
    const camadaDoBanner = camada(vitrine.banner, vitrine.imagens?.banner);
    if (camadaDoBanner) banner.append(camadaDoBanner);
    el.append(banner);

    const topo = elemento('div', 'nx-cartao-topo');
    const status = presenca ? (presenca.status === 'invisivel' ? 'offline' : presenca.status || 'offline') : null;
    const caixa = avatar({ nome, perfil, vitrine, status, id: ids.avatar || '' });
    topo.append(caixa);
    // Com foto, o avatar de TODO cartão abre a foto grande (foto-grande.js): o do início, o da
    // prévia do editor e o da sala. Sem foto não há o que ampliar -- a cor e as iniciais são as
    // mesmas em qualquer tamanho --, e o avatar continua sendo só um desenho.
    const foto = root.NexoPerfil.enderecoDaImagem(perfil?.avatar);
    if (foto) root.NexoFoto?.ampliavel(caixa.querySelector('.nx-av-img'), { foto, nome: apelidoMeu || nome, codigo: codigo || perfil?.codigo || '', vitrine: cartao?.vitrine || null });
    if (vitrine.pensamento?.texto) {
      const bolha = elemento('p', 'nx-pensamento', vitrine.pensamento.texto);
      bolha.title = 'Pensamento do dia';
      topo.append(bolha);
    }
    el.append(topo);

    const corpo = elemento('div', 'nx-cartao-corpo');
    const quem = elemento('div', 'nx-cartao-quem');
    const titulo = elemento('h2', 'nx-cartao-nome', apelidoMeu || nome);
    if (ids.nome) titulo.id = ids.nome;
    titulo.dataset.estilo = vitrine.nome;
    quem.append(titulo);
    // Com apelido dado por quem vê, o nome de verdade aparece logo embaixo: o apelido é seu, e a
    // pessoa continua sendo quem ela diz que é.
    const partes = [];
    if (apelidoMeu && apelidoMeu !== nome) partes.push(nome);
    if (vitrine.pronomes) partes.push(vitrine.pronomes);
    if (partes.length) quem.append(elemento('p', 'nx-cartao-linha', partes.join(' · ')));
    const codigoTexto = codigo || perfil?.codigo || '';
    if (!semCodigo) {
      const linhaDoCodigo = elemento('p', 'nx-cartao-linha nx-cartao-codigo', codigoTexto ? `Código ${codigoTexto}` : 'Sem conta');
      if (ids.codigo) linhaDoCodigo.id = ids.codigo;
      quem.append(linhaDoCodigo);
    }
    corpo.append(quem);

    if (cartao?.frase && (cartao.frase.texto || cartao.frase.emoji)) {
      const frase = elemento('p', 'nx-cartao-frase');
      if (cartao.frase.emoji) frase.append(elemento('b', '', cartao.frase.emoji));
      frase.append(doc.createTextNode(cartao.frase.texto || ''));
      corpo.append(frase);
    }
    if (presenca && presenca.status !== 'offline' && presenca.sala) {
      const onde = elemento('p', 'nx-cartao-presenca');
      onde.append(elemento('span', '', 'Na sala'), elemento('strong', '', `#${presenca.sala.codigo}`));
      if (presenca.sala.pessoas) onde.append(elemento('span', '', `· ${presenca.sala.pessoas} ${presenca.sala.pessoas === 1 ? 'pessoa' : 'pessoas'}`));
      corpo.append(onde);
    }
    if (vitrine.bio) {
      corpo.append(elemento('div', 'nx-cartao-separador'));
      corpo.append(elemento('p', 'nx-cartao-rotulo', 'Sobre mim'));
      corpo.append(elemento('p', 'nx-cartao-bio', vitrine.bio));
    }
    // Os selos escolhidos; sem escolha, as conquistas ganhas mais raras (as do fim da lista), até cinco.
    const escolhidos = vitrine.selos?.length ? vitrine.selos : (cartao?.conquistas || []).filter(id => id !== 'boas-vindas').slice(-V.SELOS_MAXIMOS);
    if (escolhidos.length) {
      corpo.append(elemento('p', 'nx-cartao-rotulo', 'Conquistas'));
      corpo.append(selos(escolhidos));
    }
    if (cartao?.desde) corpo.append(elemento('p', 'nx-cartao-desde', `No Nexo desde ${desde(cartao.desde)}`));
    const acoes = elemento('div', 'nx-cartao-acoes');
    corpo.append(acoes);
    el.append(corpo);
    return { el, acoes, corpo, avatar: caixa.querySelector('.nx-av-img'), caixaDoAvatar: caixa };
  }

  // ---------- O efeito de abrir ----------
  //
  // Um canvas transparente por cima do cartão, por 2,6 s, que não recebe clique. Pouca coisa por
  // vez: é um enfeite de quem abriu, e não pode pesar numa sala com tela compartilhada.
  const reduzido = () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches || doc.documentElement.classList.contains('menos-movimento');
  const sorteio = (a, b) => a + Math.random() * (b - a);
  const escolher = lista => lista[Math.floor(Math.random() * lista.length)];

  function coracao(ctx, x, y, t) {
    ctx.beginPath();
    ctx.moveTo(x, y + t * 0.3);
    ctx.bezierCurveTo(x, y, x - t * 0.5, y, x - t * 0.5, y + t * 0.3);
    ctx.bezierCurveTo(x - t * 0.5, y + t * 0.6, x, y + t * 0.8, x, y + t);
    ctx.bezierCurveTo(x, y + t * 0.8, x + t * 0.5, y + t * 0.6, x + t * 0.5, y + t * 0.3);
    ctx.bezierCurveTo(x + t * 0.5, y, x, y, x, y + t * 0.3);
    ctx.fill();
  }

  function efeito(alvo, id, vitrine) {
    if (!alvo || !id || id === 'nenhum' || reduzido()) return () => {};
    const largura = alvo.clientWidth, altura = alvo.clientHeight;
    if (!largura || !altura) return () => {};
    const [c1, c2] = V.coresDe(vitrine);
    const cores = [c1, c2, '#ffffff', '#ffd27a', '#7affc8', '#ff8fd0'];
    const canvas = elemento('canvas', 'nx-cartao-efeito');
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    alvo.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const DURACAO = 2600;
    const inicio = performance.now();
    // O avatar fica no canto de cima, à esquerda: é de lá que as faíscas saem.
    const origem = { x: Math.min(70, largura * 0.2), y: Math.min(120, altura * 0.3) };
    const p = [];
    const criar = (quantos, fazer) => { for (let i = 0; i < quantos; i++) p.push(fazer(i)); };

    if (id === 'confete') criar(70, () => ({ x: sorteio(0, largura), y: sorteio(-altura * 0.4, -10), vx: sorteio(-0.04, 0.04), vy: sorteio(0.12, 0.26), r: sorteio(0, 6), vr: sorteio(-0.01, 0.01), w: sorteio(5, 9), h: sorteio(3, 5), cor: escolher(cores) }));
    if (id === 'faiscas') criar(46, () => { const a = sorteio(0, Math.PI * 2), v = sorteio(0.08, 0.32); return { x: origem.x, y: origem.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: sorteio(700, 1500), cor: escolher([c1, '#fff', '#ffd27a']) }; });
    if (id === 'neve') criar(60, () => ({ x: sorteio(0, largura), y: sorteio(-altura, 0), vy: sorteio(0.03, 0.08), fase: sorteio(0, 6), raio: sorteio(1.2, 3.2) }));
    if (id === 'bolhas') criar(30, () => ({ x: sorteio(0, largura), y: altura + sorteio(0, altura * 0.5), vy: sorteio(0.05, 0.12), fase: sorteio(0, 6), raio: sorteio(4, 12) }));
    if (id === 'coracoes') criar(24, () => ({ x: sorteio(0, largura), y: altura + sorteio(0, altura * 0.4), vy: sorteio(0.06, 0.13), fase: sorteio(0, 6), t: sorteio(9, 17), cor: escolher([c1, '#ff6b9a', '#ff8fd0']) }));
    if (id === 'petalas') criar(32, () => ({ x: sorteio(0, largura), y: sorteio(-altura * 0.5, -8), vy: sorteio(0.05, 0.1), fase: sorteio(0, 6), r: sorteio(0, 6), t: sorteio(4, 7), cor: escolher(['#ffb3d1', '#ff8fbf', c1]) }));
    if (id === 'estrelas') criar(7, i => ({ x: sorteio(largura * 0.2, largura * 1.1), y: sorteio(-40, altura * 0.4), atraso: i * 260, v: sorteio(0.35, 0.55) }));
    if (id === 'fogos') criar(4, i => ({ x: sorteio(largura * 0.15, largura * 0.85), y: sorteio(altura * 0.12, altura * 0.45), atraso: i * 420, cor: escolher(cores), pontos: Array.from({ length: 34 }, () => { const a = sorteio(0, Math.PI * 2), v = sorteio(0.04, 0.16); return { vx: Math.cos(a) * v, vy: Math.sin(a) * v }; }) }));

    let quadro = 0;
    let parado = false;
    function desenhar(agora) {
      if (parado) return;
      const t = agora - inicio;
      if (t > DURACAO) { canvas.remove(); return; }
      ctx.clearRect(0, 0, largura, altura);
      // Apaga suave no último terço, para nada sumir de repente.
      ctx.globalAlpha = Math.min(1, (DURACAO - t) / 700);
      const dt = 16;
      if (id === 'aurora') {
        const x = (t / DURACAO) * (largura + altura) - altura;
        const g = ctx.createLinearGradient(x, 0, x + altura * 0.8, altura);
        g.addColorStop(0, 'transparent'); g.addColorStop(0.45, `${c1}55`); g.addColorStop(0.55, '#ffffff40'); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, largura, altura);
      }
      for (const q of p) {
        if (id === 'confete') {
          q.x += q.vx * dt; q.y += q.vy * dt; q.r += q.vr * dt;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.cor; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.r * 2))); ctx.restore();
        } else if (id === 'faiscas') {
          if (t > q.vida) continue;
          q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.985; q.vy = q.vy * 0.985 + 0.002;
          ctx.strokeStyle = q.cor; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 40, q.y - q.vy * 40); ctx.stroke();
        } else if (id === 'neve') {
          q.y += q.vy * dt; q.x += Math.sin(t / 600 + q.fase) * 0.3;
          ctx.fillStyle = '#ffffffd9'; ctx.beginPath(); ctx.arc(q.x, q.y, q.raio, 0, Math.PI * 2); ctx.fill();
        } else if (id === 'bolhas') {
          q.y -= q.vy * dt; q.x += Math.sin(t / 500 + q.fase) * 0.4;
          ctx.strokeStyle = '#ffffffa6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(q.x, q.y, q.raio, 0, Math.PI * 2); ctx.stroke();
        } else if (id === 'coracoes') {
          q.y -= q.vy * dt; q.x += Math.sin(t / 450 + q.fase) * 0.5;
          ctx.fillStyle = q.cor; coracao(ctx, q.x, q.y, q.t);
        } else if (id === 'petalas') {
          q.y += q.vy * dt; q.x += Math.sin(t / 520 + q.fase) * 0.6; q.r += 0.02;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.cor; ctx.beginPath(); ctx.ellipse(0, 0, q.t, q.t / 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        } else if (id === 'estrelas') {
          const vida = t - q.atraso;
          if (vida < 0) continue;
          const x = q.x - vida * q.v, y = q.y + vida * q.v * 0.55;
          const g = ctx.createLinearGradient(x, y, x + 60, y - 33);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'transparent');
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 33); ctx.stroke();
        } else if (id === 'fogos') {
          const vida = t - q.atraso;
          if (vida < 0 || vida > 1400) continue;
          ctx.fillStyle = q.cor;
          for (const ponto of q.pontos) {
            const px = q.x + ponto.vx * vida, py = q.y + ponto.vy * vida + 0.00004 * vida * vida;
            ctx.globalAlpha = Math.max(0, 1 - vida / 1400) * Math.min(1, (DURACAO - t) / 700);
            ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      quadro = root.requestAnimationFrame(desenhar);
    }
    quadro = root.requestAnimationFrame(desenhar);
    // Um prazo de segurança: aba em segundo plano não pinta quadros, e o canvas não pode ficar.
    const prazo = setTimeout(() => canvas.remove(), DURACAO + 600);
    return () => { parado = true; root.cancelAnimationFrame(quadro); clearTimeout(prazo); canvas.remove(); };
  }

  root.NexoCartao = { montar, avatar, trocarStatus, efeito, aplicarCores, decorarAvatar, estilizarNome, moldurar, vestirFundo, selos, descreverPresenca, desde, svg, ICONES, ICONE_DA_CONQUISTA, NOMES_DOS_STATUS };
})(window);
