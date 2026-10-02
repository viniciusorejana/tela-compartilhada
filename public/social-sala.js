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
  S.on('mensagem', ({ com, mensagem }) => {
    pintarContagem();
    if (!$('mensagensPanel').classList.contains('hidden')) pintarConversas();
    if (mensagem.de === S.estado.eu || mensagem.tipo === 'convite' || naoIncomodar()) return;
    if (conversa?.codigo === com && !$('mensagensPanel').classList.contains('hidden')) return;
    aviso({ icone: 'mensagem', titulo: S.nomeDe(com), detalhe: (mensagem.texto || 'Mandou uma imagem').slice(0, 120), acoes: [{ rotulo: 'Responder', principal: true, fazer: () => abrirMensagens(com) }] });
  });
  S.on('convite', ({ de, apelido, sala }) => {
    if (sala === roomCode) return;
    aviso({ icone: 'convite', titulo: `${S.nomeDe(de) || apelido} chamou você`, detalhe: `Para a sala #${sala}. Entrar sai desta chamada.`, fecharEm: 15000, acoes: [{ rotulo: 'Entrar', principal: true, fazer: () => { window.location.href = `/${encodeURIComponent(sala)}/sala`; } }, { rotulo: 'Responder', fazer: () => abrirMensagens(de) }] });
  });
  S.on('conquista', c => {
    aviso({ tom: 'ok', icone: 'conquista', titulo: `Conquista: ${c.nome}`, detalhe: c.descricao, fecharEm: 8000, acoes: [{ rotulo: 'Ver no cartão', fazer: () => abrirEditor('sobre') }] });
    // Uma conquista pode liberar peças do cartão: o editor, se aberto de novo, já sabe.
    editor?.carregar();
  });
  S.on('minha', () => { if (!$('editorCartaoPanel').classList.contains('hidden')) editor?.pintarStatus(); });
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
    if (comConta) pintarContagem();
  });

  window.NexoSalaSocial = { pintarCartao, abrirMensagens, abrirConvite, abrirEditor };
})();
