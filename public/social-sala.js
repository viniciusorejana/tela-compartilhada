/* Amigos dentro da sala: o pedaço de amizade do cartão de perfil (adicionar, aceitar, mandar
 * mensagem), o painel de convidar amigos, as mensagens diretas sem sair da chamada e os avisos
 * de mensagem, convite e conquista.
 *
 * Só com conta: sem ela não há amigos, e nada daqui aparece. O socket de amigos (social.js) é
 * outro, separado do da sala -- cair um não derruba o outro.
 */
(() => {
  const $ = id => document.getElementById(id);
  const S = window.NexoSocial;
  const C = window.NexoCartao;
  let comConta = false;
  let conversa = null;

  const elemento = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const DESENHOS = {
    adicionar: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
    mensagem: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    certo: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    convite: '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16 4-4-4-4M14 12H4"/>'
  };
  function botao(rotulo, ico, classe, fazer) {
    const b = elemento('button', classe);
    b.type = 'button';
    if (ico) b.insertAdjacentHTML('beforeend', `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[ico]}</svg>`);
    b.append(elemento('span', '', rotulo));
    b.addEventListener('click', fazer);
    return b;
  }
  const aviso = opcoes => window.NexoToast?.mostrar({ fecharEm: 6000, ...opcoes });

  // ---------- No cartão de perfil ----------
  // Entre duas contas, o cartão diz a relação e oferece o próximo passo. Sem conta de um dos dois
  // lados, nada: amizade é de conta para conta.
  function pintarCartao(lugar, { codigo, nome, ehEu }) {
    lugar.replaceChildren();
    lugar.hidden = true;
    if (!comConta || !codigo || ehEu) return;
    const relacao = S.relacao(codigo);
    const linha = elemento('div', 'perfil-social-linha');
    if (relacao === 'amigos') {
      linha.append(elemento('span', 'perfil-social-texto', 'Vocês são amigos no Nexo.'));
      linha.append(botao('Mensagem', 'mensagem', 'nx-botao pequeno', () => abrirMensagens(codigo)));
    } else if (relacao === 'recebido') {
      linha.append(elemento('span', 'perfil-social-texto', `${nome} quer ser seu amigo.`));
      linha.append(botao('Aceitar', 'certo', 'nx-botao pequeno sucesso', async () => {
        const r = await S.aceitar(codigo);
        if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível aceitar', detalhe: r.dados.error }); return; }
        pintarCartao(lugar, { codigo, nome, ehEu });
      }));
    } else if (relacao === 'enviado') {
      linha.append(elemento('span', 'perfil-social-texto', 'Pedido de amizade enviado. Falta a resposta.'));
    } else if (relacao === 'nenhuma') {
      linha.append(elemento('span', 'perfil-social-texto', 'Amigos veem em que sala você está e conversam fora da chamada.'));
      linha.append(botao('Adicionar amigo', 'adicionar', 'nx-botao pequeno', async evento => {
        const alvo = evento.currentTarget;
        alvo.disabled = true;
        const r = await S.pedirAmizade(codigo);
        if (!r.ok) { alvo.disabled = false; aviso({ tom: 'erro', icone: 'erro', titulo: 'O pedido não saiu', detalhe: r.dados.error }); return; }
        pintarCartao(lugar, { codigo, nome, ehEu });
      }));
    } else return;
    lugar.append(linha);
    lugar.hidden = false;
  }

  // ---------- Convidar amigos ----------
  // O mesmo link do botão de copiar (sala.js): o endereço público configurado, quando há.
  function linkDaSala() {
    try { return RoomMedia.inviteUrl(window.location.href, publicInviteUrl, roomCode); } catch (_) { return `${location.origin}/${roomCode}/sala`; }
  }
  function pintarConvite() {
    const lista = $('convidarLista');
    const amigos = [...S.estado.amigos.amigos].sort((a, b) => {
      const pa = S.presencaDe(a.codigo), pb = S.presencaDe(b.codigo);
      return (pa.status === 'offline') - (pb.status === 'offline') || (a.apelidoMeu || a.apelido).localeCompare(b.apelidoMeu || b.apelido, 'pt-BR');
    });
    if (!amigos.length) { lista.replaceChildren(elemento('p', 'config-dica', 'Seus amigos aparecem aqui. Adicione alguém pelo cartão de perfil, clicando no nome da pessoa.')); return; }
    lista.replaceChildren(...amigos.map(p => {
      const linha = elemento('div', 'nx-amigo');
      const presenca = S.presencaDe(p.codigo);
      linha.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, status: presenca.status, tamanho: 'medio' }));
      const textos = elemento('span', 'nx-amigo-textos');
      const nomeEl = elemento('span', 'nx-amigo-nome');
      const nomeDoAmigo = elemento('span', '', p.apelidoMeu || p.apelido);
      C.estilizarNome(nomeDoAmigo, p.vitrine);
      nomeEl.append(nomeDoAmigo);
      const aqui = presenca.sala?.codigo === roomCode;
      textos.append(nomeEl, elemento('span', 'nx-amigo-detalhe', aqui ? 'Já está nesta sala' : C.descreverPresenca(presenca)));
      linha.append(textos);
      const acoes = elemento('span', 'nx-amigo-acoes');
      if (!aqui) acoes.append(botao('Convidar', 'convite', 'nx-botao pequeno', async evento => {
        const alvo = evento.currentTarget;
        alvo.disabled = true;
        const r = await S.convidar(p.codigo, roomCode);
        if (!r.ok) { alvo.disabled = false; aviso({ tom: 'erro', icone: 'erro', titulo: 'O convite não saiu', detalhe: r.error }); return; }
        alvo.querySelector('span').textContent = 'Convidado';
      }));
      linha.append(acoes);
      return linha;
    }));
  }
  function abrirConvite() {
    $('convidarLink').value = linkDaSala();
    pintarConvite();
    $('convidarPanel').classList.remove('hidden');
  }
  $('convidarCopiar').addEventListener('click', async () => {
    const botaoCopiar = $('convidarCopiar');
    try { await navigator.clipboard.writeText($('convidarLink').value); }
    catch (_) { $('convidarLink').select(); return; }
    botaoCopiar.textContent = 'Link copiado!';
    botaoCopiar.classList.add('copiado');
    setTimeout(() => { botaoCopiar.textContent = 'Copiar link'; botaoCopiar.classList.remove('copiado'); }, 1600);
  });
  // Com amigos, "Convidar amigos" abre o painel com eles; sem, continua copiando o link, como
  // sempre. A escuta é na captura do documento: chega antes do clique do próprio botão (sala.js).
  document.addEventListener('click', evento => {
    if (!comConta || !S.estado.amigos.amigos.length) return;
    if (!evento.target.closest('#copyLinkBtn, [data-action="invite"]')) return;
    evento.preventDefault();
    evento.stopPropagation();
    abrirConvite();
  }, true);

  // ---------- Mensagens, sem sair da sala ----------
  function pintarConversas() {
    const lista = $('mensagensConversas');
    const conversas = S.conversas().filter(c => S.pessoa(c.com));
    const amigosSemConversa = S.estado.amigos.amigos.filter(p => !conversas.some(c => c.com === p.codigo));
    const itens = [...conversas.map(c => ({ codigo: c.com, naoLidas: c.naoLidas, ultima: c.ultima })), ...amigosSemConversa.map(p => ({ codigo: p.codigo, naoLidas: 0, ultima: null }))];
    if (!itens.length) { lista.replaceChildren(elemento('li', 'mensagens-vazio', 'Sem amigos ainda. Adicione alguém pelo cartão de perfil.')); return; }
    lista.replaceChildren(...itens.map(item => {
      const p = S.pessoa(item.codigo);
      const li = elemento('li');
      const b = elemento('button', `mensagens-item${item.naoLidas ? ' nao-lida' : ''}`);
      b.type = 'button';
      if (conversa?.codigo === item.codigo) b.setAttribute('aria-current', 'true');
      b.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, status: S.presencaDe(item.codigo).status, tamanho: 'pequeno' }));
      const t = elemento('span', 'mensagens-item-textos');
      const nome = elemento('strong', '', p.apelidoMeu || p.apelido);
      C.estilizarNome(nome, p.vitrine);
      t.append(nome, elemento('small', '', item.ultima ? (item.ultima.tipo === 'convite' ? `Convite para #${item.ultima.sala}` : item.ultima.texto || (item.ultima.imagem ? 'Imagem' : '')) : C.descreverPresenca(S.presencaDe(item.codigo))));
      b.append(t);
      if (item.naoLidas) b.append(elemento('b', 'mensagens-contagem', String(item.naoLidas)));
      b.onclick = () => abrirMensagens(item.codigo);
      li.append(b);
      return li;
    }));
  }
  function abrirMensagens(codigo = null) {
    $('perfilPanel').classList.add('hidden');
    $('mensagensPanel').classList.remove('hidden');
    const alvo = codigo || S.conversas()[0]?.com || null;
    if (alvo && conversa?.codigo !== alvo) {
      conversa?.fechar();
      conversa = NexoConversa.abrir($('mensagensConversa'), alvo, { aoAbrirPerfil: null });
      setTimeout(() => conversa?.focar(), 60);
    }
    pintarConversas();
  }
  // Fechado o painel, a conversa para de marcar como lida o que chega.
  new MutationObserver(() => {
    if ($('mensagensPanel').classList.contains('hidden') && conversa) { conversa.fechar(); conversa = null; $('mensagensConversa').replaceChildren(elemento('p', 'mensagens-vazio', 'Escolha uma conversa. As mensagens diretas ficam só na memória do servidor e somem três dias depois da última.')); }
  }).observe($('mensagensPanel'), { attributes: true, attributeFilter: ['class'] });
  $('mensagensBtn').addEventListener('click', () => abrirMensagens());

  // ---------- O tamanho do painel de mensagens ----------
  // O painel nasce com 880 x 640 px, e a alça do canto (redimensionar.js) o muda: quem conversa muito
  // quer a conversa maior, e quem só responde, menor. O painel é centrado, então cada lado cresce a metade
  // do que o ponteiro andou (`fator: 2`) e o canto acompanha o mouse. Lembrado neste navegador, como a
  // largura do chat; guarda-se o que foi ESCOLHIDO, e o que vale é a escolha cabendo na janela de agora.
  const TAMANHO_DE_FABRICA = { largura: 880, altura: 640 };
  const LIMITES_DO_TAMANHO = {
    largura: () => [560, Math.max(560, Math.min(1400, document.documentElement.clientWidth - 32))],
    // 86% da janela é o teto de altura do próprio painel (sala.css).
    altura: () => [420, Math.max(420, Math.floor(window.innerHeight * 0.86))]
  };
  const VARIAVEL_DO_TAMANHO = { largura: '--msg-largura', altura: '--msg-altura' };
  const guardado = window.Preferencias?.ler('mensagensTamanho', null);
  const escolhido = {
    largura: Number.isFinite(guardado?.largura) ? guardado.largura : null,
    altura: Number.isFinite(guardado?.altura) ? guardado.altura : null
  };
  const cartaoDeMensagens = $('mensagensPanel').querySelector('.mensagens-card');
  const limitar = (dimensao, valor) => { const [minimo, maximo] = LIMITES_DO_TAMANHO[dimensao](); return Math.min(Math.max(valor, minimo), maximo); };
  const deFabrica = dimensao => limitar(dimensao, TAMANHO_DE_FABRICA[dimensao]);
  function aplicarTamanhoDeMensagens() {
    for (const dimensao of ['largura', 'altura']) {
      if (escolhido[dimensao] === null) $('mensagensPanel').style.removeProperty(VARIAVEL_DO_TAMANHO[dimensao]);
      else $('mensagensPanel').style.setProperty(VARIAVEL_DO_TAMANHO[dimensao], `${limitar(dimensao, escolhido[dimensao])}px`);
    }
  }
  aplicarTamanhoDeMensagens();
  const eixoDoTamanho = (eixo, dimensao, medida) => ({
    eixo, sentido: 1, fator: 2, passo: 24,
    ler: () => cartaoDeMensagens[medida],
    limites: LIMITES_DO_TAMANHO[dimensao],
    padrao: () => deFabrica(dimensao),
    aplicar: (valor, { final }) => {
      // Voltar ao tamanho de fábrica apaga a escolha, em vez de guardar o número de hoje.
      escolhido[dimensao] = Math.abs(valor - deFabrica(dimensao)) < 1 ? null : valor;
      aplicarTamanhoDeMensagens();
      if (!final) return;
      window.Preferencias?.gravar('mensagensTamanho', escolhido.largura === null && escolhido.altura === null ? null : { ...escolhido });
    }
  });
  if (window.NexoRedimensionar && $('mensagensAlca')) {
    NexoRedimensionar.ligar($('mensagensAlca'), {
      rotulo: 'Mudar o tamanho do painel de mensagens',
      eixos: [eixoDoTamanho('x', 'largura', 'offsetWidth'), eixoDoTamanho('y', 'altura', 'offsetHeight')]
    });
  }
  window.addEventListener('resize', aplicarTamanhoDeMensagens);

  // ---------- O cartão completo, sem sair da sala ----------
  // O mesmo editor do início (editor-cartao.js), num painel. Antes, "Personalizar o cartão" abria o
  // início numa aba nova -- e no aplicativo, a aba nova era o navegador. Salvo, o servidor manda o
  // perfil novo para a sala inteira (`peer-perfil`), como a foto e o apelido.
  let editor = null;
  function abrirEditor(parte = null) {
    if (!comConta) return;
    editor ||= NexoEditorCartao.criar($('editorCartaoSala'), { prefixo: 'editorSala', aviso });
    $('editorCartaoPanel').classList.remove('hidden');
    if (parte) editor.parte(parte);
    editor.abrir();
  }
  // Fechado o painel, o efeito da prévia para: ele desenha num canvas a cada quadro.
  new MutationObserver(() => {
    if ($('editorCartaoPanel').classList.contains('hidden')) editor?.parar();
  }).observe($('editorCartaoPanel'), { attributes: true, attributeFilter: ['class'] });

  function pintarContagem() {
    const n = S.totalNaoLidas();
    $('mensagensContagem').hidden = !n;
    $('mensagensContagem').textContent = String(n);
    $('mensagensBtn').setAttribute('aria-label', n ? `Mensagens diretas, ${n} não lidas` : 'Mensagens diretas');
  }

  // ---------- Avisos ----------
  // Na sala o canto de baixo é do chat e da barra: os avisos descem do topo (toast.js). "Não
  // incomodar" segura os de mensagem; os convites passam, porque pedem uma decisão.
  const naoIncomodar = () => S.estado.minha?.escolhido === 'ocupado';
  // Com o início aberto por cima da sala (inicio-na-sala.js), a página dentro dele ouve o mesmo
  // socket de amigos e avisa por conta própria -- com os botões dela, que abrem a conversa ali
  // mesmo. A sala calada evita o aviso em dobro, um por cima do outro.
  const camadaAberta = () => Boolean(window.NexoInicioNaSala?.aberta());
  // Entrar noutra sala sai desta: por `sairDaSala`, que avisa a sala e desliga a mídia direito.
  // Trocar a página direto deixava a sala acreditando que a pessoa ainda estava lá, por alguns
  // segundos, com a imagem congelada.
  function entrarNaSala(sala) {
    const destino = `/${encodeURIComponent(sala)}/sala`;
    // Quem aceitou o convite não precisa confirmar o nome de novo na sala (chassi.js).
    window.NexoChassi?.marcarEntrada(sala);
    if (typeof sairDaSala === 'function') sairDaSala(destino); else window.location.href = destino;
  }
  S.on('mensagem', ({ com, mensagem }) => {
    pintarContagem();
    if (!$('mensagensPanel').classList.contains('hidden')) pintarConversas();
    if (mensagem.de === S.estado.eu || mensagem.tipo === 'convite' || naoIncomodar() || camadaAberta()) return;
    if (conversa?.codigo === com && !$('mensagensPanel').classList.contains('hidden')) return;
    aviso({ icone: 'mensagem', titulo: S.nomeDe(com), detalhe: (mensagem.texto || 'Mandou uma imagem').slice(0, 120), acoes: [{ rotulo: 'Responder', principal: true, fazer: () => abrirMensagens(com) }] });
  });
  S.on('convite', ({ de, apelido, sala }) => {
    if (sala === roomCode || camadaAberta()) return;
    aviso({ icone: 'convite', titulo: `${S.nomeDe(de) || apelido} chamou você`, detalhe: `Para a sala #${sala}. Entrar sai desta chamada.`, fecharEm: 15000, acoes: [{ rotulo: 'Entrar', principal: true, fazer: () => entrarNaSala(sala) }, { rotulo: 'Responder', fazer: () => abrirMensagens(de) }] });
  });
  S.on('conquista', c => {
    if (camadaAberta()) { editor?.carregar(); return; }
    aviso({ tom: 'ok', icone: 'conquista', titulo: `Conquista: ${c.nome}`, detalhe: c.descricao, fecharEm: 8000, acoes: [{ rotulo: 'Ver no cartão', fazer: () => abrirEditor('sobre') }] });
    // Uma conquista pode liberar peças do cartão: o editor, se aberto de novo, já sabe.
    editor?.carregar();
  });
  // ---------- O status, no menu da sala ----------
  // O mesmo status do início e do editor, e é da conta: trocá-lo aqui vale para os amigos, para a sala
  // inteira (o servidor manda o perfil novo e o ponto de todo mundo muda) e para o que toca e avisa. Só com
  // conta: sem ela não há onde guardar um status, e o menu tem só o "agora na sala" e as reações.
  // A linha de baixo diz o que o escolhido faz -- a promessa dele, escrita onde a pessoa o troca.
  const DICA_DO_STATUS = {
    online: 'Seus amigos veem você conectado.',
    ausente: 'Conectado, mas longe: o ponto fica âmbar para todos.',
    ocupado: 'Sem sons nem avisos de mensagem, na sala e no celular. Convites e pedidos de amizade ainda chegam.',
    invisivel: 'Seus amigos veem você desconectado. Quem está nesta sala continua vendo você aqui.'
  };
  function pintarStatusDoMenu() {
    const atual = S.estado.minha?.escolhido || 'online';
    document.querySelectorAll('#presenceConta button[data-status]').forEach(b => {
      const sim = b.dataset.status === atual;
      b.classList.toggle('ativo', sim);
      b.setAttribute('aria-pressed', String(sim));
    });
    $('presenceStatusDica').textContent = DICA_DO_STATUS[atual] || '';
  }
  async function definirStatus(status) {
    const r = await S.definirStatus(status);
    if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'O status não mudou', detalhe: r.dados.error }); return; }
    pintarStatusDoMenu();
  }

  S.on('minha', () => {
    pintarStatusDoMenu();
    if (!$('editorCartaoPanel').classList.contains('hidden')) editor?.pintarStatus();
  });
  S.on('naoLidas', pintarContagem);
  S.on('lida', pintarContagem);
  S.on('amigos', () => {
    if (!$('convidarPanel').classList.contains('hidden')) pintarConvite();
    if (!$('mensagensPanel').classList.contains('hidden')) pintarConversas();
  });
  S.on('presenca', () => { if (!$('convidarPanel').classList.contains('hidden')) pintarConvite(); });

  // Começa quando a conta responde; sem conta, nada aparece.
  S.iniciar().then(ok => {
    comConta = Boolean(ok);
    $('mensagensBtn').hidden = !comConta;
    $('presenceConta').hidden = !comConta;
    if (comConta) { pintarContagem(); pintarStatusDoMenu(); }
  });

  // A notificação de amigos do aplicativo Android, tocada no meio da chamada (app-android.js). A
  // conversa abre no painel, sem sair da sala; entrar noutra sala sai desta pelo caminho de sempre.
  window.NexoAndroid?.ao('aviso-tocado', ({ acao, com, sala, codigo }) => {
    if (!comConta) return;
    if (acao === 'abrir' && S.relacao(com) === 'amigos') {
      // Com o início aberto por cima, a conversa abre nele; senão, no painel de mensagens da sala.
      if (camadaAberta()) window.NexoInicioNaSala.abrirConversa(com); else abrirMensagens(com);
    } else if (acao === 'entrar' && /^[a-z0-9_-]{4,32}$/.test(sala || '') && sala !== roomCode) entrarNaSala(sala);
    else if (acao === 'aceitar' && S.relacao(codigo) === 'recebido') {
      S.aceitar(codigo).then(r => { if (r.ok) aviso({ tom: 'ok', icone: 'amigo', titulo: `Você e ${S.nomeDe(codigo)} agora são amigos`, fecharEm: 3500 }); });
    }
  });

  window.NexoSalaSocial = { pintarCartao, abrirMensagens, abrirConvite, abrirEditor, definirStatus };
})();
