/* Amigos, presença e mensagens diretas, do lado da página: o socket `/social` (social.js, no
 * servidor) e as rotas de amigos (contas/rotas.js). Um estado só, e eventos para quem desenha --
 * o início (inicio.js) e a sala (social-sala.js) ouvem os mesmos.
 *
 * Só existe com conta: sem ela não há amigos, e o socket nem abre.
 *
 * Eventos (NexoSocial.on):
 *   pronto        o socket conectou; presenças e conversas chegaram
 *   amigos        a lista de amigos mudou
 *   presenca      { codigo, presenca } de um amigo
 *   minha         a minha presença (como os amigos me veem, e o status escolhido)
 *   mensagem      { com, mensagem, naoLidas } nova numa conversa
 *   lida          { com, em, minha }
 *   apagada       { com, id }
 *   digitando     { com }
 *   convite       { de, apelido, sala }
 *   conquista     { id, nome, descricao }
 *   naoLidas      o total mudou
 */
(function (root) {
  const alvo = new EventTarget();
  const estado = {
    eu: null, pronto: false, amigos: { amigos: [], recebidos: [], enviados: [], bloqueados: [] },
    presencas: {}, conversas: new Map(), minha: null
  };
  let socket = null;
  let iniciado = null;

  const emitir = (nome, detalhe) => alvo.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
  const csrf = () => root.NexoConta?.atual()?.csrf || '';

  async function api(caminho, { metodo = 'GET', corpo } = {}) {
    let resposta;
    try {
      resposta = await fetch(caminho, {
        method: metodo, credentials: 'same-origin', body: corpo ? JSON.stringify(corpo) : undefined,
        headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf() }
      });
    } catch (_) {
      return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } };
    }
    const dados = await resposta.json().catch(() => ({}));
    return { ok: resposta.ok, status: resposta.status, dados };
  }

  // Um pedido pelo socket, com resposta. Sem socket (ainda conectando), a resposta diz isso.
  // O prazo é maior para quem leva imagem: até 800 KB numa conexão lenta de celular.
  function pedirAoSocket(evento, dados, prazoMs = 8000) {
    return new Promise(resolve => {
      if (!socket?.connected) { resolve({ ok: false, error: 'Conectando… Tente de novo em um instante.' }); return; }
      const prazo = setTimeout(() => resolve({ ok: false, error: 'O servidor não respondeu. Tente de novo.' }), prazoMs);
      socket.emit(evento, dados, resposta => { clearTimeout(prazo); resolve(resposta || { ok: false }); });
    });
  }

  function guardarConversa(com, mudanca) {
    const atual = estado.conversas.get(com) || { com, naoLidas: 0, ultima: null, ultimaEm: 0 };
    estado.conversas.set(com, { ...atual, ...mudanca });
    emitir('naoLidas', totalNaoLidas());
  }
  const totalNaoLidas = () => [...estado.conversas.values()].reduce((soma, c) => soma + (c.naoLidas || 0), 0);

  async function carregarAmigos() {
    const r = await api('/api/conta/amigos');
    if (r.ok) { estado.amigos = r.dados; emitir('amigos', estado.amigos); }
    return r;
  }

  function conectar() {
    if (socket || typeof root.io !== 'function') return;
    // `withCredentials`: o cookie da conta vai no aperto de mão, e é ele que o servidor confere.
    socket = root.io('/social', { withCredentials: true });
    socket.on('pronto', dados => {
      estado.eu = dados.eu;
      estado.presencas = dados.presencas || {};
      estado.minha = dados.minha || null;
      estado.conversas = new Map((dados.conversas || []).map(c => [c.com, c]));
      estado.pronto = true;
      emitir('pronto', dados);
      emitir('naoLidas', totalNaoLidas());
      emitir('minha', estado.minha);
    });
    socket.on('presencas', mapa => { estado.presencas = mapa || {}; emitir('amigos', estado.amigos); });
    socket.on('presenca', ({ codigo, presenca }) => { estado.presencas[codigo] = presenca; emitir('presenca', { codigo, presenca }); });
    socket.on('minha-presenca', minha => { estado.minha = minha; emitir('minha', minha); });
    socket.on('dm-mensagem', ({ com, mensagem, naoLidas }) => {
      guardarConversa(com, { ultima: mensagem, ultimaEm: mensagem.em, naoLidas: naoLidas ?? 0 });
      emitir('mensagem', { com, mensagem, naoLidas });
    });
    socket.on('dm-lida', ({ com, em, minha }) => {
      if (minha) guardarConversa(com, { naoLidas: 0 });
      emitir('lida', { com, em, minha });
    });
    socket.on('dm-apagada', ({ com, id }) => emitir('apagada', { com, id }));
    socket.on('dm-digitando', ({ com }) => emitir('digitando', { com }));
    socket.on('convite', convite => emitir('convite', convite));
    socket.on('conquista', conquista => emitir('conquista', conquista));
    socket.on('amigos-mudou', () => { carregarAmigos(); });
    socket.on('connect_error', erro => {
      // Sem conta (a sessão terminou em outra aba): não adianta insistir.
      if (String(erro?.message || '') === 'sem-conta') { socket.disconnect(); emitir('sem-conta'); }
    });
    socket.on('disconnect', () => { estado.pronto = false; emitir('desconectou'); });
  }

  // Começa uma vez, quando a conta responde. Sem conta, não faz nada.
  function iniciar() {
    if (iniciado) return iniciado;
    iniciado = (root.NexoConta?.pronto || Promise.resolve({ conta: null })).then(async dados => {
      if (!dados?.conta) return false;
      conectar();
      await carregarAmigos();
      return true;
    });
    return iniciado;
  }

  // O nome que EU vejo de um amigo: o apelido que dei, senão o dele.
  function pessoa(codigo) {
    const listas = estado.amigos;
    return listas.amigos.find(a => a.codigo === codigo) || listas.recebidos.find(a => a.codigo === codigo) || listas.enviados.find(a => a.codigo === codigo) || null;
  }
  const nomeDe = codigo => { const p = pessoa(codigo); return p ? (p.apelidoMeu || p.apelido) : codigo; };
  const relacao = codigo => {
    const l = estado.amigos;
    if (l.amigos.some(a => a.codigo === codigo)) return 'amigos';
    if (l.recebidos.some(a => a.codigo === codigo)) return 'recebido';
    if (l.enviados.some(a => a.codigo === codigo)) return 'enviado';
    if (l.bloqueados.some(a => a.codigo === codigo)) return 'bloqueado';
    return 'nenhuma';
  };

  // As ações de amizade voltam já com a lista nova: a tela não espera o aviso do socket.
  const depois = async r => { if (r.ok) await carregarAmigos(); return r; };
  const codigoNaRota = codigo => encodeURIComponent(String(codigo || ''));

  root.NexoSocial = {
    estado, iniciar, carregarAmigos, pessoa, nomeDe, relacao, totalNaoLidas,
    // Devolve o "parar de ouvir": a conversa aberta e fechada várias vezes não acumula ouvintes.
    on: (nome, fn) => {
      const ouvinte = evento => fn(evento.detail);
      alvo.addEventListener(nome, ouvinte);
      return () => alvo.removeEventListener(nome, ouvinte);
    },
    presencaDe: codigo => estado.presencas[codigo] || { status: 'offline' },
    // "Não incomodar", como a conta o escolheu: quem decide o que toca ou avisa pergunta aqui (o som do
    // chat da sala, o aviso do sistema, o aviso no canto, a notificação do Android).
    naoIncomodar: () => estado.minha?.escolhido === 'ocupado',
    pedirAmizade: alvoTexto => api('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: alvoTexto } }).then(depois),
    aceitar: codigo => api(`/api/conta/amigos/${codigoNaRota(codigo)}/aceitar`, { metodo: 'POST' }).then(depois),
    desfazer: codigo => api(`/api/conta/amigos/${codigoNaRota(codigo)}`, { metodo: 'DELETE' }).then(depois),
    apelidar: (codigo, apelido) => api(`/api/conta/amigos/${codigoNaRota(codigo)}/apelido`, { metodo: 'PUT', corpo: { apelido } }).then(depois),
    bloquear: codigo => api(`/api/conta/amigos/${codigoNaRota(codigo)}/bloquear`, { metodo: 'POST' }).then(depois),
    desbloquear: codigo => api(`/api/conta/amigos/${codigoNaRota(codigo)}/bloqueio`, { metodo: 'DELETE' }).then(depois),
    cartao: codigo => api(`/api/conta/pessoa/${codigoNaRota(codigo)}`),
    definirSocial: dados => api('/api/conta/social', { metodo: 'PUT', corpo: dados }),
    // Troca o status (online, ausente, ocupado = "não incomodar", invisivel) de onde estiver -- o
    // início, o editor do cartão, o menu da sala --, e deixa esta página com o status novo antes de o
    // aviso do servidor voltar: quem decide algo pelo status (os avisos de mensagem, o som do chat)
    // não pode ficar um instante com o antigo. O servidor leva o resto: os amigos, a sala inteira
    // (`peer-perfil`) e as outras abas da pessoa.
    async definirStatus(status) {
      const r = await api('/api/conta/social', { metodo: 'PUT', corpo: { status } });
      if (!r.ok) return r;
      estado.minha = { ...(estado.minha || {}), escolhido: r.dados.social.status };
      const atual = root.NexoConta?.atual()?.perfil;
      if (atual) root.NexoConta.atualizar({ perfil: { ...atual, social: r.dados.social } });
      emitir('minha', estado.minha);
      return r;
    },
    // `imagem` é o que NexoImagem.prepararParaConversa devolve ({ dataUrl, largura, altura }).
    enviar: (para, texto, imagem = null) => (imagem
      ? pedirAoSocket('dm-enviar', { para, texto, imagem: imagem.dataUrl, largura: imagem.largura, altura: imagem.altura }, 30000)
      : pedirAoSocket('dm-enviar', { para, texto })),
    convidar: (para, sala) => pedirAoSocket('convidar', { para, sala }),
    historico: com => pedirAoSocket('dm-historico', { com }),
    marcarLida: com => { guardarConversa(com, { naoLidas: 0 }); return pedirAoSocket('dm-lida', { com }); },
    apagar: (com, id) => pedirAoSocket('dm-apagar', { com, id }),
    digitando: para => { if (socket?.connected) socket.emit('dm-digitando', { para }); },
    conversas: () => [...estado.conversas.values()].sort((a, b) => b.ultimaEm - a.ultimaEm)
  };
})(window);
