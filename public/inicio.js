/* O início de quem tem conta (inicio.html): as salas recentes, os amigos, as conversas, o que os
 * amigos estão fazendo agora, o editor do cartão de perfil e as conquistas.
 *
 * Nada daqui decide regra: amizade é do servidor (contas/amigos.js), o que o cartão aceita é de
 * public/vitrine.js, e a presença chega pelo socket de amigos (public/social.js). Texto de outra
 * pessoa entra sempre por `textContent`.
 */
(() => {
  const $ = id => document.getElementById(id);
  const S = window.NexoSocial;
  const C = window.NexoCartao;
  const V = window.NexoVitrine;
  const app = $('inicioApp');
  const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
  // Dentro de uma chamada, esta mesma página abre por cima da sala (public/camada.js, a camada de
  // inicio-na-sala.js): a chamada segue conectada por baixo. Aqui, "entrar" numa sala é pedir à sala
  // -- que pergunta, porque entrar sai da chamada --, e nada navega a página para fora do quadro.
  const camada = window.NexoCamada?.embutida ? window.NexoCamada : null;
  const ehMinhaSala = codigo => Boolean(camada) && String(codigo || '').toLowerCase() === camada.sala;

  let conta = null;
  let secao = 'amigos';
  let aba = 'disponiveis';
  let conversa = null;                // a conversa aberta (conversa.js)
  let recebidosVistos = null;         // para avisar só de pedido NOVO

  // ---------- Peças pequenas ----------
  function elemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }
  const DESENHOS = {
    mensagem: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    porta: '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16 4-4-4-4M14 12H4"/>',
    mais: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    certo: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lapis: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    chamar: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4zm16 0h1v7h-4v-7h3z"/>',
    remover: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 11h6"/>',
    bloquear: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    amigos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    adicionar: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
    sair: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    sala: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4zm16 0h1v7h-4v-7h3zM17 19c0 2-2 2-5 2"/>',
    nova: '<path d="M12 5v14M5 12h14"/>',
    lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'
  };
  const icone = (nome, classe = 'ico') => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[nome] || ''}</svg>`;
  function botao({ classe = 'nx-botao', rotulo = '', titulo = '', ico = '', fazer }) {
    const b = elemento('button', classe);
    b.type = 'button';
    if (ico) b.insertAdjacentHTML('beforeend', icone(ico));
    if (rotulo) b.append(elemento('span', '', rotulo));
    if (titulo) { b.title = titulo; if (!rotulo) b.setAttribute('aria-label', titulo); }
    if (fazer) b.addEventListener('click', evento => { evento.stopPropagation(); fazer(evento); });
    return b;
  }
  function aviso(opcoes) {
    return window.NexoToast?.mostrar({ fecharEm: 6000, ...opcoes });
  }
  const minhaPresencaEscolhida = () => S.estado.minha?.escolhido || 'online';

  // ---------- Salas recentes (o trilho) ----------
  // O trilho é o mesmo da sala (public/trilho.js): ele lê as recentes do navegador, como sempre
  // ficaram -- de onde você entrou e quando não sobe para a conta (docs/plano-contas.md, seção 5).
  const { salasRecentes, sigla: siglaDaSala } = window.NexoTrilho;
  function esquecerSala(codigo) {
    window.NexoTrilho.esquecerSala(codigo);
    pintarTrilho();
  }
  // Entrar numa sala daqui deixa o recado de entrada direta (chassi.js): a sala não repete a pergunta.
  const irParaSala = codigo => {
    if (camada) { camada.avisar('entrar', { sala: codigo }); return; }
    window.NexoChassi.irParaSala(codigo);
  };
  // Quem dos meus amigos está em cada sala agora.
  function amigosPorSala() {
    const mapa = new Map();
    for (const p of S.estado.amigos.amigos) {
      const sala = S.presencaDe(p.codigo).sala;
      if (!sala) continue;
      if (!mapa.has(sala.codigo)) mapa.set(sala.codigo, { sala, pessoas: [] });
      mapa.get(sala.codigo).pessoas.push(p);
    }
    return mapa;
  }
  const nomesJuntos = pessoas => {
    const nomes = pessoas.map(p => p.apelidoMeu || p.apelido);
    if (nomes.length <= 2) return nomes.join(' e ');
    return `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}`;
  };

  const esconderDica = () => window.NexoTrilho.esconderDica();
  function pintarTrilho() {
    window.NexoTrilho.pintar($('trilhoSalas'), {
      // A sala da chamada vem primeiro e marcada, mesmo que o navegador não a tenha guardado.
      aqui: camada ? camada.sala : null,
      porSala: amigosPorSala(),
      nomes: nomesJuntos,
      // Dentro da chamada nenhum clique navega o quadro: a sala decide (e pergunta, se for outra).
      aoEntrar: irParaSala,
      interceptarTudo: Boolean(camada),
      aoContexto: (link, codigo, aqui) => {
        if (aqui) { abrirMenu(link, [{ titulo: `#${codigo}` }, { rotulo: 'Voltar para a sala', ico: 'porta', fazer: () => irParaSala(codigo) }]); return; }
        abrirMenu(link, [{ titulo: `#${codigo}` }, { rotulo: 'Entrar na sala', ico: 'porta', fazer: () => irParaSala(codigo) }, { rotulo: 'Tirar das recentes', ico: 'lixo', perigo: true, fazer: () => esquecerSala(codigo) }]);
      }
    });
  }

  function novoCodigo() {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return `sala-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
  }
  // Sem acento (as marcas que a decomposição NFD separa da letra), sem o "#" e com hífen no espaço.
  const semAcento = texto => String(texto || '').normalize('NFD').replace(/\p{M}/gu, '');
  const normalizarCodigo = valor => semAcento(String(valor || '').trim().toLowerCase()).replace(/^#/, '').replace(/\s+/g, '-');
  $('trilhoCriar').onclick = () => irParaSala(novoCodigo());
  $('abrirCriar').onclick = () => irParaSala(novoCodigo());
  $('trilhoEntrar').onclick = () => {
    if (window.matchMedia('(max-width:1100px)').matches) {
      abrirMenu($('trilhoEntrar'), [{ titulo: 'Entrar numa sala' }, { campo: { placeholder: 'Código da sala', rotulo: 'Entrar', aoSalvar: valor => {
        const codigo = normalizarCodigo(valor);
        if (!CODIGO_DE_SALA.test(codigo)) return 'De 4 a 32 letras, números, hífen ou sublinhado.';
        irParaSala(codigo);
        return null;
      } } }]);
      return;
    }
    $('abrirCodigo').focus();
  };
  $('abrirForm').addEventListener('submit', evento => {
    evento.preventDefault();
    const codigo = normalizarCodigo($('abrirCodigo').value);
    const erro = $('abrirErro');
    if (!CODIGO_DE_SALA.test(codigo)) {
      erro.hidden = false;
      erro.textContent = 'Informe um código de 4 a 32 caracteres: letras, números, hífen ou sublinhado.';
      $('abrirCodigo').setAttribute('aria-invalid', 'true');
      $('abrirCodigo').focus();
      return;
    }
    irParaSala(codigo);
  });
  $('abrirCodigo').addEventListener('input', () => { $('abrirErro').hidden = true; $('abrirCodigo').removeAttribute('aria-invalid'); });

  // ---------- O menu que cai de um botão (4.6) ----------
  // Itens: { rotulo, ico, perigo, fazer } · { titulo } · 'separador' · { campo: { valor, placeholder,
  // rotulo, aoSalvar(valor) -> erro|null } } · { confirmar: { texto, rotulo, fazer } }.
  const menu = $('menuFlutuante');
  let ancoraDoMenu = null;
  function fecharMenu({ devolverFoco = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    ancoraDoMenu?.setAttribute('aria-expanded', 'false');
    if (devolverFoco) ancoraDoMenu?.focus();
    ancoraDoMenu = null;
  }
  function abrirMenu(ancora, itens) {
    fecharMenu();
    ancoraDoMenu = ancora;
    ancora.setAttribute('aria-expanded', 'true');
    menu.replaceChildren();
    for (const item of itens) {
      if (item === 'separador') { menu.append(elemento('div', 'nx-menu-separador')); continue; }
      if (item.titulo) { menu.append(elemento('p', 'nx-menu-titulo', item.titulo)); continue; }
      if (item.texto) { const p = elemento('p', 'nx-menu-titulo', item.texto); p.style.textTransform = 'none'; p.style.letterSpacing = '0'; p.style.fontWeight = '500'; p.style.fontSize = 'var(--fs-sm)'; p.style.color = 'var(--text-2)'; menu.append(p); continue; }
      if (item.campo) {
        const form = elemento('form', 'nx-menu-campo');
        const campo = elemento('input');
        campo.type = 'text';
        campo.value = item.campo.valor || '';
        campo.placeholder = item.campo.placeholder || '';
        campo.maxLength = item.campo.maximo || 64;
        campo.setAttribute('aria-label', item.campo.placeholder || item.campo.rotulo || '');
        const salvar = botao({ classe: 'nx-botao pequeno', rotulo: item.campo.rotulo || 'Salvar' });
        salvar.type = 'submit';
        const erro = elemento('p', 'nx-menu-titulo');
        erro.style.color = 'var(--danger-texto)';
        erro.style.textTransform = 'none';
        erro.style.letterSpacing = '0';
        erro.hidden = true;
        form.append(campo, salvar);
        form.addEventListener('submit', async evento => {
          evento.preventDefault();
          const problema = await item.campo.aoSalvar(campo.value);
          if (problema) { erro.textContent = problema; erro.hidden = false; return; }
          fecharMenu();
        });
        menu.append(form, erro);
        if (item.campo.aoDigitar) campo.addEventListener('input', () => item.campo.aoDigitar(campo.value));
        continue;
      }
      if (item.lugar) { menu.append(item.lugar); continue; }
      const b = botao({ classe: `nx-menu-item${item.perigo ? ' perigo' : ''}`, rotulo: item.rotulo, ico: item.ico, fazer: () => {
        if (item.confirmar) { abrirMenu(ancora, [{ texto: item.confirmar.texto }, { rotulo: item.confirmar.rotulo, ico: item.ico, perigo: true, fazer: item.confirmar.fazer }, { rotulo: 'Cancelar', ico: 'fechar', fazer: () => {} }]); return; }
        fecharMenu();
        item.fazer?.();
      } });
      // Uma escolha entre várias (o status): o ponto do cartão (cartao.css, `.nx-ponto`) no lugar do ícone, e a
      // escolhida marcada por `aria-checked` -- o destaque vem do CSS (social.css), e quem usa leitor de tela
      // fica sabendo qual é. Antes eram quatro carinhas iguais e um visto, que não diziam o que cada uma era.
      if (item.ponto) {
        const ponto = elemento('i', 'nx-ponto');
        ponto.dataset.status = item.ponto;
        ponto.setAttribute('aria-hidden', 'true');
        b.prepend(ponto);
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(Boolean(item.marcado)));
      } else b.setAttribute('role', 'menuitem');
      menu.append(b);
    }
    menu.hidden = false;
    posicionarMenu();
    (menu.querySelector('input') || menu.querySelector('button'))?.focus();
  }
  // Ancorado no botão que o abriu, nunca a uma distância fixa da quina (4.6).
  function posicionarMenu() {
    if (menu.hidden || !ancoraDoMenu) return;
    const r = ancoraDoMenu.getBoundingClientRect();
    const largura = menu.offsetWidth, altura = menu.offsetHeight;
    let x = Math.min(r.left, window.innerWidth - largura - 12);
    let y = r.bottom + 6;
    if (y + altura > window.innerHeight - 12) y = Math.max(12, r.top - altura - 6);
    // Da trilha, o menu sai ao lado do botão -- mas nunca passa da borda direita: num celular
    // estreito, os 280 px dele não cabem depois dos 72 da trilha.
    if (ancoraDoMenu.closest('.trilho')) { x = Math.min(r.right + 8, window.innerWidth - largura - 12); y = Math.min(r.top, window.innerHeight - altura - 12); }
    menu.style.left = `${Math.max(12, Math.round(x))}px`;
    menu.style.top = `${Math.round(y)}px`;
  }
  document.addEventListener('pointerdown', evento => {
    if (!menu.hidden && !menu.contains(evento.target) && !ancoraDoMenu?.contains(evento.target)) fecharMenu();
  });
  menu.addEventListener('keydown', evento => {
    if (evento.key === 'Escape') { evento.stopPropagation(); fecharMenu({ devolverFoco: true }); }
    if (['ArrowDown', 'ArrowUp'].includes(evento.key)) {
      const itens = [...menu.querySelectorAll('button')];
      const i = itens.indexOf(document.activeElement);
      itens[(i + (evento.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length]?.focus();
      evento.preventDefault();
    }
  });
  // Mudar o tamanho da janela reposiciona o menu, e não o fecha: no celular, o teclado que sobe
  // para o campo do menu muda o tamanho da janela, e fechar ali levava o campo e o teclado junto
  // -- "Entrar numa sala pelo código" abria e sumia antes de dar para digitar.
  window.addEventListener('resize', () => { posicionarMenu(); esconderDica(); });

  // ---------- Navegar entre as seções ----------
  const TITULOS = { amigos: 'Amigos', adicionar: 'Amigos', conversa: 'Conversa', perfil: 'Personalizar perfil', conquistas: 'Conquistas' };
  function irPara(nova, { codigo = null } = {}) {
    if (nova !== 'conversa' && conversa) { conversa.fechar(); conversa = null; }
    if (nova !== 'perfil') editor.parar();
    secao = nova;
    for (const [nome, id] of [['amigos', 'vistaAmigos'], ['adicionar', 'vistaAdicionar'], ['conversa', 'vistaConversa'], ['perfil', 'vistaPerfil'], ['conquistas', 'vistaConquistas']]) $(id).hidden = nome !== nova;
    document.querySelectorAll('.ini-secao').forEach(b => {
      const atual = b.dataset.secao === nova || (b.dataset.secao === 'amigos' && nova === 'adicionar');
      if (atual) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('tituloSecao').textContent = nova === 'conversa' && codigo ? S.nomeDe(codigo) : TITULOS[nova];
    $('abasAmigos').hidden = !['amigos', 'adicionar'].includes(nova);
    $('adicionarBtn').hidden = !['amigos', 'adicionar'].includes(nova);
    $('adicionarBtn').setAttribute('aria-pressed', String(nova === 'adicionar'));
    // A conversa tem o topo dela (com o nome e o "chamar"): o topo da página sai do caminho.
    document.querySelector('.ini-topo').hidden = nova === 'conversa' && !window.matchMedia('(max-width:760px)').matches;
    if (nova === 'perfil') editor.abrir();
    if (nova === 'conquistas') pintarConquistas();
    pintarConversas();
    fecharGaveta();
  }
  document.querySelectorAll('.ini-secao').forEach(b => { b.onclick = () => irPara(b.dataset.secao); });
  $('adicionarBtn').onclick = () => irPara(secao === 'adicionar' ? 'amigos' : 'adicionar');

  // As abas dos amigos: rádios de verdade pelo teclado (setas), como as da sala.
  const abas = [...document.querySelectorAll('#abasAmigos [role="tab"]')];
  function escolherAba(nova, focar = false) {
    aba = nova;
    abas.forEach(b => { const ativa = b.dataset.aba === nova; b.setAttribute('aria-selected', String(ativa)); b.tabIndex = ativa ? 0 : -1; if (ativa && focar) b.focus(); });
    if (secao !== 'amigos') irPara('amigos');
    pintarAmigos();
  }
  abas.forEach((b, i) => {
    b.onclick = () => escolherAba(b.dataset.aba);
    b.onkeydown = evento => {
      if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
      evento.preventDefault();
      escolherAba(abas[(i + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length].dataset.aba, true);
    };
  });

  // ---------- Gaveta (celular) ----------
  function fecharGaveta() { app.classList.remove('menu-aberto'); $('iniVeu').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
  function abrirGaveta() { app.classList.add('menu-aberto'); $('iniVeu').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); }
  $('menuBtn').onclick = () => (app.classList.contains('menu-aberto') ? fecharGaveta() : abrirGaveta());
  $('iniVeu').onclick = fecharGaveta;

  // ---------- Amigos ----------
  const ORDEM_DO_STATUS = { online: 0, ausente: 1, ocupado: 2, offline: 3 };
  function detalheDe(p) {
    const presenca = S.presencaDe(p.codigo);
    const linha = elemento('span', 'nx-amigo-detalhe');
    if (presenca.status !== 'offline' && presenca.sala) {
      const sala = elemento('span', 'sala', ehMinhaSala(presenca.sala.codigo) ? 'Na sua sala' : `Na sala #${presenca.sala.codigo}`);
      linha.append(sala);
    } else {
      linha.append(elemento('span', '', C.NOMES_DOS_STATUS[presenca.status] || 'Desconectado'));
    }
    const frase = p.frase && (p.frase.emoji || p.frase.texto) ? `${p.frase.emoji ? `${p.frase.emoji} ` : ''}${p.frase.texto || ''}`.trim() : '';
    if (frase) linha.append(elemento('span', '', `· ${frase}`));
    return linha;
  }
  function nomeDaLinha(p) {
    const nome = elemento('span', 'nx-amigo-nome');
    const principal = elemento('span', 'nx-nome-estilo', p.apelidoMeu || p.apelido);
    nome.append(principal);
    if (p.apelidoMeu && p.apelidoMeu !== p.apelido) nome.append(elemento('small', '', p.apelido));
    return nome;
  }

  function menuDoAmigo(p, ancora) {
    const presenca = S.presencaDe(p.codigo);
    abrirMenu(ancora, [
      { titulo: p.apelidoMeu || p.apelido },
      { rotulo: 'Ver o perfil', ico: 'perfil', fazer: () => abrirCartao(p.codigo) },
      { rotulo: 'Mandar mensagem', ico: 'mensagem', fazer: () => abrirConversa(p.codigo) },
      ...(presenca.sala && !ehMinhaSala(presenca.sala.codigo) ? [{ rotulo: presenca.sala.trancada ? `Pedir para entrar em #${presenca.sala.codigo}` : `Entrar em #${presenca.sala.codigo}`, ico: 'porta', fazer: () => irParaSala(presenca.sala.codigo) }] : []),
      { rotulo: 'Chamar para uma sala', ico: 'chamar', fazer: () => chamarParaSala(p.codigo, ancora) },
      { rotulo: p.apelidoMeu ? 'Trocar o apelido' : 'Dar um apelido', ico: 'lapis', fazer: () => apelidar(p, ancora) },
      'separador',
      { rotulo: 'Remover amizade', ico: 'remover', perigo: true, confirmar: { texto: `Remover ${p.apelidoMeu || p.apelido} dos amigos? A pessoa não é avisada.`, rotulo: 'Remover', fazer: () => desfazer(p) } },
      { rotulo: 'Bloquear', ico: 'bloquear', perigo: true, confirmar: { texto: `Bloquear ${p.apelidoMeu || p.apelido}? Desfaz a amizade, e a pessoa não consegue mais pedir nem mandar mensagem.`, rotulo: 'Bloquear', fazer: () => bloquear(p) } }
    ]);
  }
  function apelidar(p, ancora) {
    abrirMenu(ancora, [{ titulo: 'Apelido só seu' }, { texto: `Só você vê. ${p.apelido} continua com o nome dela.` }, { campo: { valor: p.apelidoMeu || '', placeholder: p.apelido, rotulo: 'Salvar', maximo: 40, aoSalvar: async valor => {
      const r = await S.apelidar(p.codigo, valor);
      if (!r.ok) return r.dados.error || 'Não foi possível salvar.';
      aviso({ tom: 'ok', icone: 'ok', titulo: valor.trim() ? 'Apelido salvo' : 'Apelido tirado', detalhe: valor.trim() ? `Para você, ${p.apelido} agora é ${valor.trim()}.` : `Você volta a ver ${p.apelido}.`, fecharEm: 3500 });
      return null;
    } } }]);
  }
  async function desfazer(p) {
    const r = await S.desfazer(p.codigo);
    if (!r.ok) aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível', detalhe: r.dados.error });
  }
  async function bloquear(p) {
    const r = await S.bloquear(p.codigo);
    if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível bloquear', detalhe: r.dados.error }); return; }
    if (conversa?.codigo === p.codigo) irPara('amigos');
    aviso({ tom: 'ok', icone: 'ok', titulo: `${p.apelido} foi bloqueado`, detalhe: 'Desbloqueie quando quiser, em Amigos → Bloqueados.', fecharEm: 4000 });
  }

  function linhaDeAmigo(p, tipo) {
    const linha = elemento('div', 'nx-amigo nx-amigo-clicavel');
    linha.tabIndex = 0;
    linha.setAttribute('role', 'button');
    linha.setAttribute('aria-label', `Ver o perfil de ${p.apelidoMeu || p.apelido}`);
    const presenca = S.presencaDe(p.codigo);
    const status = tipo === 'amigo' ? (presenca.status === 'invisivel' ? 'offline' : presenca.status) : null;
    linha.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, status, tamanho: 'medio' }));
    const textos = elemento('span', 'nx-amigo-textos');
    textos.append(nomeDaLinha(p));
    if (p.vitrine) C.aplicarCores(textos, p.vitrine);
    textos.querySelector('.nx-nome-estilo').dataset.estilo = p.vitrine?.nome === 'padrao' ? '' : p.vitrine?.nome || '';
    if (tipo === 'amigo') textos.append(detalheDe(p));
    else if (tipo === 'recebido') textos.append(elemento('span', 'nx-amigo-detalhe', 'Quer ser seu amigo'));
    else if (tipo === 'enviado') textos.append(elemento('span', 'nx-amigo-detalhe', 'Pedido enviado, esperando resposta'));
    else if (tipo === 'bloqueado') textos.append(elemento('span', 'nx-amigo-detalhe', 'Bloqueado'));
    linha.append(textos);
    const acoes = elemento('span', 'nx-amigo-acoes');
    if (tipo === 'amigo') {
      if (presenca.sala && !ehMinhaSala(presenca.sala.codigo)) acoes.append(botao({ classe: 'nx-botao pequeno sucesso', rotulo: presenca.sala.trancada ? 'Pedir' : 'Entrar', ico: 'porta', titulo: presenca.sala.trancada ? `Pedir para entrar em #${presenca.sala.codigo}` : `Entrar em #${presenca.sala.codigo}`, fazer: () => irParaSala(presenca.sala.codigo) }));
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Mandar mensagem', ico: 'mensagem', fazer: () => abrirConversa(p.codigo) }));
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Mais opções', ico: 'mais', fazer: evento => menuDoAmigo(p, evento.currentTarget) }));
    } else if (tipo === 'recebido') {
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Aceitar o pedido', ico: 'certo', fazer: async () => {
        const r = await S.aceitar(p.codigo);
        if (!r.ok) aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível aceitar', detalhe: r.dados.error });
        else aviso({ tom: 'ok', icone: 'amigo', titulo: `Você e ${p.apelido} agora são amigos`, fecharEm: 3500 });
      } }));
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Recusar o pedido', ico: 'fechar', fazer: () => desfazer(p) }));
    } else if (tipo === 'enviado') {
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Cancelar o pedido', ico: 'fechar', fazer: () => desfazer(p) }));
    } else if (tipo === 'bloqueado') {
      acoes.append(botao({ classe: 'nx-botao secundario pequeno', rotulo: 'Desbloquear', fazer: async () => {
        const r = await S.desbloquear(p.codigo);
        if (!r.ok) aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível desbloquear', detalhe: r.dados.error });
      } }));
    }
    linha.append(acoes);
    const abrir = () => abrirCartao(p.codigo);
    linha.addEventListener('click', abrir);
    linha.addEventListener('keydown', evento => { if ((evento.key === 'Enter' || evento.key === ' ') && evento.target === linha) { evento.preventDefault(); abrir(); } });
    return linha;
  }

  function vazio(icone_, titulo, texto, acao) {
    const caixa = elemento('div', 'ini-vazio');
    const desenho = elemento('span', 'ini-vazio-icone');
    desenho.innerHTML = icone(icone_);
    caixa.append(desenho, elemento('strong', '', titulo), elemento('p', '', texto));
    if (acao) caixa.append(botao({ classe: 'nx-botao', rotulo: acao.rotulo, ico: acao.ico, fazer: acao.fazer }));
    return caixa;
  }

  function pintarAmigos() {
    const { amigos, recebidos, enviados, bloqueados } = S.estado.amigos;
    const filtro = semAcento($('filtroAmigos').value.trim().toLowerCase());
    const casa = p => !filtro || [p.apelido, p.apelidoMeu, p.codigo].some(t => semAcento(String(t || '').toLowerCase()).includes(filtro));
    const lista = $('listaAmigos');
    let linhas = [];
    let titulo = '';
    if (aba === 'disponiveis' || aba === 'todos') {
      let escolhidos = amigos.filter(casa);
      if (aba === 'disponiveis') escolhidos = escolhidos.filter(p => S.presencaDe(p.codigo).status !== 'offline');
      escolhidos.sort((a, b) => {
        const pa = S.presencaDe(a.codigo), pb = S.presencaDe(b.codigo);
        return (Boolean(pb.sala) - Boolean(pa.sala)) || ((ORDEM_DO_STATUS[pa.status] ?? 3) - (ORDEM_DO_STATUS[pb.status] ?? 3)) || (a.apelidoMeu || a.apelido).localeCompare(b.apelidoMeu || b.apelido, 'pt-BR');
      });
      titulo = `${aba === 'disponiveis' ? 'Disponíveis' : 'Todos os amigos'} — ${escolhidos.length}`;
      linhas = escolhidos.map(p => linhaDeAmigo(p, 'amigo'));
      if (!linhas.length) {
        if (!amigos.length) linhas = [vazio('amigos', 'Seus amigos aparecem aqui', 'Peça amizade pelo nome de usuário ou pelo código da conta. Amigos veem em que sala você está e conversam com você aqui.', { rotulo: 'Adicionar amigo', ico: 'adicionar', fazer: () => irPara('adicionar') })];
        else if (filtro) linhas = [vazio('amigos', 'Ninguém com esse nome', 'Confira como está escrito, ou procure pelo código.')];
        else linhas = [vazio('amigos', 'Ninguém conectado agora', 'Quando um amigo abrir o Nexo, ele aparece aqui. Os outros estão em Todos.', { rotulo: 'Ver todos', fazer: () => escolherAba('todos') })];
      }
    } else if (aba === 'pedidos') {
      const r = recebidos.filter(casa), e = enviados.filter(casa);
      titulo = `Pedidos — ${r.length + e.length}`;
      linhas = [...r.map(p => linhaDeAmigo(p, 'recebido')), ...e.map(p => linhaDeAmigo(p, 'enviado'))];
      if (!linhas.length) linhas = [vazio('adicionar', 'Nenhum pedido esperando', 'Os pedidos que chegam para você e os que você mandou ficam aqui até alguém responder.')];
    } else {
      const b = bloqueados.filter(casa);
      titulo = `Bloqueados — ${b.length}`;
      linhas = b.map(p => linhaDeAmigo(p, 'bloqueado'));
      if (!linhas.length) linhas = [vazio('bloquear', 'Ninguém bloqueado', 'Quem você bloquear não consegue pedir amizade nem mandar mensagem, e não fica sabendo.')];
    }
    $('contagemLista').textContent = linhas[0]?.classList.contains('ini-vazio') ? '' : titulo;
    lista.replaceChildren(...linhas);
    // As contagens de pedido: na aba e na seção da lateral.
    const pedidos = recebidos.length;
    for (const id of ['contagemPedidos', 'contagemAbaPedidos']) { $(id).hidden = !pedidos; $(id).textContent = String(pedidos); }
  }
  $('filtroAmigos').addEventListener('input', pintarAmigos);

  // ---------- Agora no Nexo ----------
  function cartaoDeSala({ sala, pessoas }) {
    const caixa = elemento('article', 'ini-sala-viva');
    const topo = elemento('div', 'ini-sala-viva-topo');
    const icone_ = elemento('span', 'ini-sala-viva-icone', siglaDaSala(sala.codigo));
    icone_.style.setProperty('--cor-sala', NexoPerfil.corDoNome(sala.codigo));
    const textos = elemento('span', 'ini-sala-viva-textos');
    textos.append(elemento('strong', '', `#${sala.codigo}`), elemento('small', '', `${sala.pessoas || pessoas.length} ${(sala.pessoas || pessoas.length) === 1 ? 'pessoa' : 'pessoas'}${sala.trancada ? ' · trancada' : ''}`));
    topo.append(icone_, textos, elemento('span', 'ini-ao-vivo', 'AO VIVO'));
    const rostos = elemento('div', 'ini-rostos');
    for (const p of pessoas.slice(0, 5)) rostos.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, tamanho: 'pequeno' }));
    rostos.append(elemento('span', 'ini-rostos-nomes', nomesJuntos(pessoas)));
    // A sala da chamada não tem "entrar": a pessoa já está nela, e o botão a leva de volta.
    const minha = ehMinhaSala(sala.codigo);
    caixa.append(topo, rostos, botao({ classe: `nx-botao pequeno${sala.trancada && !minha ? ' secundario' : ''}`, rotulo: minha ? 'Voltar para a sala' : sala.trancada ? 'Pedir para entrar' : 'Entrar na sala', ico: 'porta', fazer: () => irParaSala(sala.codigo) }));
    return caixa;
  }
  function pintarAgora() {
    const porSala = [...amigosPorSala().values()].sort((a, b) => b.pessoas.length - a.pessoas.length);
    const disponiveis = S.estado.amigos.amigos.filter(p => { const pr = S.presencaDe(p.codigo); return pr.status !== 'offline' && !pr.sala; });
    const lado = [];
    for (const grupo of porSala) lado.push(cartaoDeSala(grupo));
    if (disponiveis.length) {
      const bloco = elemento('div', 'ini-disponiveis');
      const rotulo = elemento('p', 'ini-rotulo');
      rotulo.append(elemento('span', '', `Disponíveis — ${disponiveis.length}`));
      bloco.append(rotulo);
      for (const p of disponiveis.slice(0, 8)) {
        const b = botao({ classe: 'ini-conversa', fazer: () => abrirConversa(p.codigo) });
        b.title = `Mandar mensagem para ${p.apelidoMeu || p.apelido}`;
        const pr = S.presencaDe(p.codigo);
        b.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, status: pr.status, tamanho: 'pequeno' }));
        const t = elemento('span', 'ini-conversa-textos');
        const nome = elemento('strong', '', p.apelidoMeu || p.apelido);
        C.estilizarNome(nome, p.vitrine);
        t.append(nome, elemento('small', '', p.frase?.texto ? `${p.frase.emoji || ''} ${p.frase.texto}`.trim() : C.NOMES_DOS_STATUS[pr.status]));
        b.append(t);
        bloco.append(b);
      }
      lado.push(bloco);
    }
    if (!lado.length) {
      const vazio_ = elemento('div', 'ini-agora-vazio');
      vazio_.append(elemento('strong', '', 'Tudo quieto por enquanto'), document.createTextNode(S.estado.amigos.amigos.length ? 'Quando um amigo entrar numa sala, ela aparece aqui, com o botão de entrar junto.' : 'Adicione seus amigos para ver aqui em que sala cada um está.'));
      lado.push(vazio_);
    }
    $('agoraLista').replaceChildren(...lado);
    // Na tela estreita, só as salas, no topo dos amigos.
    $('agoraNoCentro').replaceChildren(...porSala.map(cartaoDeSala));
  }

  // ---------- Conversas ----------
  function pintarConversas() {
    const lista = $('listaConversas');
    const conversas = S.conversas().filter(c => S.pessoa(c.com));
    if (!conversas.length) {
      const item = elemento('li', 'ini-conversas-vazio', S.estado.amigos.amigos.length ? 'Nenhuma conversa ainda. Mande uma mensagem para um amigo pelo botão + acima.' : 'As conversas com seus amigos aparecem aqui.');
      lista.replaceChildren(item);
      return;
    }
    lista.replaceChildren(...conversas.map(c => {
      const p = S.pessoa(c.com);
      const item = elemento('li');
      const b = botao({ classe: `ini-conversa${c.naoLidas ? ' nao-lida' : ''}`, fazer: () => abrirConversa(c.com) });
      if (secao === 'conversa' && conversa?.codigo === c.com) b.setAttribute('aria-current', 'page');
      const pr = S.presencaDe(c.com);
      b.append(C.avatar({ nome: p.apelido, perfil: p.perfil, vitrine: p.vitrine, status: pr.status, tamanho: 'pequeno' }));
      const t = elemento('span', 'ini-conversa-textos');
      const ultima = c.ultima;
      const previa = !ultima ? '' : ultima.tipo === 'convite' ? `Convite para #${ultima.sala}` : `${ultima.de === S.estado.eu ? 'Você: ' : ''}${ultima.texto || (ultima.imagem ? 'Imagem' : '')}`;
      const nome = elemento('strong', '', p.apelidoMeu || p.apelido);
      C.estilizarNome(nome, p.vitrine);
      t.append(nome, elemento('small', '', previa));
      b.append(t);
      if (c.naoLidas) { const n = elemento('b', 'ini-contagem', String(c.naoLidas)); n.setAttribute('aria-label', `${c.naoLidas} não lidas`); b.append(n); }
      item.append(b);
      return item;
    }));
  }
  function abrirConversa(codigo) {
    if (conversa?.codigo === codigo && secao === 'conversa') { conversa.focar(); return; }
    irPara('conversa', { codigo });
    conversa?.fechar();
    conversa = NexoConversa.abrir($('vistaConversa'), codigo, {
      aoVoltar: window.matchMedia('(max-width:760px)').matches ? () => irPara('amigos') : null,
      aoAbrirPerfil: abrirCartao,
      aoChamar: chamarParaSala
    });
    $('tituloSecao').textContent = S.nomeDe(codigo);
    pintarConversas();
    setTimeout(() => conversa?.focar(), 50);
  }
  $('novaConversa').onclick = evento => {
    const amigos = S.estado.amigos.amigos;
    if (!amigos.length) { irPara('adicionar'); return; }
    abrirMenu(evento.currentTarget, [{ titulo: 'Conversar com' }, ...amigos.slice(0, 30).map(p => ({ rotulo: p.apelidoMeu || p.apelido, ico: 'mensagem', fazer: () => abrirConversa(p.codigo) }))]);
  };

  // ---------- Chamar para uma sala ----------
  function chamarParaSala(codigo, ancora) {
    const nome = S.nomeDe(codigo);
    // Dentro de uma chamada, a primeira opção é a sala em que a pessoa está: chamar um amigo para
    // ela é o que quase sempre se quer daqui.
    const recentes = (camada ? [camada.sala, ...salasRecentes().filter(sala => !ehMinhaSala(sala))] : salasRecentes()).slice(0, 6);
    const convidar = async (sala, entrar) => {
      const r = await S.convidar(codigo, sala);
      if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'O convite não saiu', detalhe: r.error }); return; }
      if (entrar) { irParaSala(sala); return; }
      aviso({ tom: 'ok', icone: 'convite', titulo: `Convite enviado para ${nome}`, detalhe: `#${sala}`, fecharEm: 3500, acoes: ehMinhaSala(sala) ? [] : [{ rotulo: 'Entrar na sala', principal: true, fazer: () => irParaSala(sala) }] });
    };
    abrirMenu(ancora, [
      { titulo: `Chamar ${nome} para` },
      // "Uma sala nova (e entrar nela)" tira a pessoa da chamada, e o convite sairia antes da
      // pergunta da sala: cancelar deixaria o amigo chamado para uma sala vazia. De dentro de uma
      // chamada, o convite é para a sala dela ou para uma que já exista.
      ...(camada ? [] : [{ rotulo: 'Uma sala nova (e entrar nela)', ico: 'nova', fazer: () => convidar(novoCodigo(), true) }]),
      ...recentes.map(sala => ({ rotulo: ehMinhaSala(sala) ? `#${sala} (esta sala)` : `#${sala}`, ico: 'sala', fazer: () => convidar(sala, false) }))
    ]);
  }

  // ---------- O cartão de alguém, por cima ----------
  const modal = $('cartaoModal');
  let antesDoModal = null;
  let pararEfeito = () => {};
  function fecharCartao() {
    if (modal.hidden) return;
    pararEfeito();
    modal.hidden = true;
    antesDoModal?.focus?.();
  }
  async function abrirCartao(codigo) {
    fecharMenu();
    antesDoModal = document.activeElement;
    const r = await S.cartao(codigo);
    if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível abrir o perfil', detalhe: r.dados.error }); return; }
    const p = r.dados.pessoa;
    const presenca = p.relacao === 'amigos' ? S.presencaDe(codigo) : p.relacao === 'eu' ? S.estado.minha : null;
    const montado = C.montar({ nome: p.apelido, perfil: p.perfil, cartao: p, presenca, apelidoMeu: p.apelidoMeu, ids: { nome: 'cartaoModalNome' } });
    const acoes = montado.acoes;
    const amigo = S.pessoa(codigo) || p;
    if (p.relacao === 'amigos') {
      acoes.append(botao({ classe: 'nx-botao pequeno', rotulo: 'Mensagem', ico: 'mensagem', fazer: () => { fecharCartao(); abrirConversa(codigo); } }));
      if (presenca?.sala && !ehMinhaSala(presenca.sala.codigo)) acoes.append(botao({ classe: 'nx-botao pequeno sucesso', rotulo: presenca.sala.trancada ? 'Pedir para entrar' : 'Entrar na sala', ico: 'porta', fazer: () => irParaSala(presenca.sala.codigo) }));
      acoes.append(botao({ classe: 'nx-icone cheio', titulo: 'Mais opções', ico: 'mais', fazer: evento => menuDoAmigo(amigo, evento.currentTarget) }));
    } else if (p.relacao === 'recebido') {
      acoes.append(botao({ classe: 'nx-botao pequeno', rotulo: 'Aceitar pedido', ico: 'certo', fazer: async () => { await S.aceitar(codigo); fecharCartao(); } }));
      acoes.append(botao({ classe: 'nx-botao secundario pequeno', rotulo: 'Recusar', fazer: async () => { await S.desfazer(codigo); fecharCartao(); } }));
    } else if (p.relacao === 'enviado') {
      acoes.append(botao({ classe: 'nx-botao secundario pequeno', rotulo: 'Cancelar o pedido', fazer: async () => { await S.desfazer(codigo); fecharCartao(); } }));
    } else if (p.relacao === 'nenhuma') {
      acoes.append(botao({ classe: 'nx-botao pequeno', rotulo: 'Adicionar amigo', ico: 'adicionar', fazer: async evento => {
        const alvo = evento.currentTarget;
        const resposta = await S.pedirAmizade(codigo);
        if (!resposta.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'O pedido não saiu', detalhe: resposta.dados.error }); return; }
        alvo.disabled = true;
        alvo.querySelector('span').textContent = resposta.dados.estado === 'amigos' ? 'Agora são amigos' : 'Pedido enviado';
      } }));
    } else if (p.relacao === 'bloqueado') {
      acoes.append(botao({ classe: 'nx-botao secundario pequeno', rotulo: 'Desbloquear', fazer: async () => { await S.desbloquear(codigo); fecharCartao(); } }));
    } else if (p.relacao === 'eu') {
      acoes.append(botao({ classe: 'nx-botao pequeno', rotulo: 'Personalizar perfil', ico: 'lapis', fazer: () => { fecharCartao(); irPara('perfil'); } }));
    }
    const caixa = $('cartaoModalCaixa');
    caixa.replaceChildren(montado.el, botao({ classe: 'ini-modal-fechar nx-social', titulo: 'Fechar', ico: 'fechar', fazer: fecharCartao }));
    modal.hidden = false;
    caixa.querySelector('.nx-cartao-acoes button')?.focus();
    // O efeito toca depois de o cartão aparecer: antes, ele não tem tamanho.
    requestAnimationFrame(() => { pararEfeito = C.efeito(montado.el, p.vitrine?.efeito, p.vitrine); });
  }
  modal.addEventListener('pointerdown', evento => { if (evento.target === modal) fecharCartao(); });
  modal.addEventListener('keydown', evento => {
    if (evento.key === 'Escape' && menu.hidden) { evento.preventDefault(); fecharCartao(); }
    // O foco fica preso no cartão enquanto ele está aberto (4.5).
    if (evento.key === 'Tab') {
      const focaveis = [...modal.querySelectorAll('button:not(:disabled),a[href]')];
      if (!focaveis.length) return;
      const [primeiro, ultimo] = [focaveis[0], focaveis.at(-1)];
      if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
      else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
    }
  });

  // ---------- Adicionar amigo ----------
  $('adicionarForm').addEventListener('submit', async evento => {
    evento.preventDefault();
    const retorno = $('adicionarRetorno');
    const valor = $('adicionarCampo').value.trim();
    if (!valor) { retorno.dataset.tom = 'erro'; retorno.textContent = 'Digite o nome de usuário ou o código de quem você quer adicionar.'; $('adicionarCampo').focus(); return; }
    $('adicionarEnviar').disabled = true;
    retorno.dataset.tom = '';
    retorno.textContent = 'Enviando…';
    const r = await S.pedirAmizade(valor);
    $('adicionarEnviar').disabled = false;
    if (!r.ok) { retorno.dataset.tom = 'erro'; retorno.textContent = r.dados.error || 'Não foi possível enviar o pedido.'; return; }
    const nome = r.dados.pessoa?.apelido || valor;
    retorno.textContent = r.dados.estado === 'amigos' ? `Você e ${nome} agora são amigos.` : `Pedido enviado para ${nome}. Quando aceitar, aparece na sua lista.`;
    $('adicionarCampo').value = '';
  });
  function copiarComConfirmacao(botaoDeCopiar, texto, rotulo) {
    botaoDeCopiar.onclick = async () => {
      try { await navigator.clipboard.writeText(texto); } catch (_) { return; }
      botaoDeCopiar.classList.add('copiado');
      botaoDeCopiar.textContent = 'Copiado';
      setTimeout(() => { botaoDeCopiar.classList.remove('copiado'); botaoDeCopiar.textContent = rotulo; }, 1600);
    };
  }

  // ---------- O editor do cartão (editor-cartao.js) ----------
  // O mesmo que a sala abre num painel. Ele guarda a vitrine carregada; daqui sai a contagem das
  // conquistas e a borda do avatar lá embaixo.
  // Sem o título do alto: a barra de cima já diz "Personalizar perfil", e repeti-lo logo abaixo era ruído.
  const editor = NexoEditorCartao.criar($('editorCartao'), {
    aviso,
    semTitulo: true,
    aoMudar: ({ dados }) => {
      if (dados) $('contagemConquistas').textContent = `${dados.lista.filter(c => c.ganhou).length}/${dados.lista.length}`;
      pintarEu();
    }
  });

  // ---------- Eu e o status ----------
  function pintarEu() {
    if (!conta) return;
    const minha = S.estado.minha;
    const perfil = NexoConta.atual().perfil || {};
    const escolhido = minhaPresencaEscolhida();
    const statusDoPonto = escolhido === 'invisivel' ? 'offline' : escolhido;
    // Como os outros veem: a borda e o estilo do nome do cartão efetivo.
    const vitrine = editor.dados()?.vitrine || NexoConta.atual().cartao?.vitrine || null;
    $('euAvatar').replaceChildren(C.avatar({ nome: conta.apelido, perfil: { conta: true, codigo: conta.codigo, ...perfil }, vitrine, status: statusDoPonto, tamanho: 'pequeno', forma: 'quadrado' }));
    $('euNome').textContent = conta.apelido;
    C.estilizarNome($('euNome'), vitrine);
    const frase = minha?.frase || perfil.social?.frase;
    $('euStatus').textContent = frase && (frase.texto || frase.emoji) ? `${frase.emoji || ''} ${frase.texto || ''}`.trim() : C.NOMES_DOS_STATUS[escolhido];
  }
  $('euBtn').onclick = evento => {
    const atual = minhaPresencaEscolhida();
    abrirMenu(evento.currentTarget, [
      { titulo: 'Seu status' },
      // O mesmo ponto e o mesmo destaque do menu de status da sala (4.14): cada status é o seu ponto, e o
      // escolhido fica marcado, em vez de um visto no lugar de uma carinha igual à dos outros.
      ...V.STATUS.map(s => ({ rotulo: s.nome, ponto: s.id, marcado: s.id === atual, fazer: () => editor.definirStatus(s.id) })),
      'separador',
      { rotulo: 'Definir uma frase', ico: 'lapis', fazer: () => { irPara('perfil'); editor.focarFrase(); } },
      { rotulo: `Copiar meu código (${conta.codigo})`, ico: 'copiar', fazer: () => navigator.clipboard?.writeText(conta.codigo).catch(() => {}) },
      'separador',
      // Dentro de uma chamada, sair da conta tira a pessoa da sala também (inicio-na-sala.js): a
      // conta é quem a abriu, e a pergunta vem antes.
      camada
        ? { rotulo: 'Sair da conta e da sala', ico: 'sair', perigo: true, confirmar: { texto: 'Sair da conta também tira você desta sala: a chamada acaba para você.', rotulo: 'Sair da conta e da sala', fazer: sairDaConta } }
        : { rotulo: 'Sair da conta', ico: 'sair', perigo: true, fazer: sairDaConta }
    ]);
  };
  async function sairDaConta() {
    await fetch('/api/conta/sair', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    if (camada) camada.avisar('conta-encerrada'); else window.location.href = '/';
  }



  // ---------- Conquistas ----------
  async function pintarConquistas() {
    const dados = await editor.carregar();
    if (!dados) return;
    const lista = dados.lista;
    const ganhas = lista.filter(c => c.ganhou).length;
    $('conquistasResumo').textContent = `${ganhas} de ${lista.length} conquistas. Algumas liberam peças do cartão de perfil.`;
    requestAnimationFrame(() => { $('conquistasBarra').style.width = `${Math.round((ganhas / lista.length) * 100)}%`; });
    const liberadas = id => Object.entries(V.CATALOGO).flatMap(([, itens]) => itens.filter(item => item.requer === id).map(item => item.nome));
    $('gradeConquistas').replaceChildren(...lista.map((c, i) => {
      const dados = V.CONQUISTAS.find(x => x.id === c.id);
      const caixa = elemento('article', `ini-conquista${c.ganhou ? ' ganha' : ''}`);
      caixa.style.animationDelay = `${Math.min(i * 30, 400)}ms`;
      const desenho = elemento('span', 'ini-conquista-icone');
      desenho.innerHTML = C.svg(C.ICONE_DA_CONQUISTA[c.id]);
      caixa.append(desenho, elemento('strong', '', dados.nome), elemento('small', '', dados.descricao));
      if (c.alvo && !c.ganhou) {
        const progresso = elemento('span', 'ini-conquista-progresso');
        const barra = elemento('span', 'ini-barra');
        const cheio = elemento('i');
        cheio.style.width = `${Math.round((c.valor / c.alvo) * 100)}%`;
        barra.append(cheio);
        progresso.append(barra, elemento('span', '', `${c.valor.toLocaleString('pt-BR')}/${c.alvo.toLocaleString('pt-BR')}`));
        caixa.append(progresso);
      }
      const pecas = liberadas(c.id);
      if (pecas.length) caixa.append(elemento('span', 'ini-conquista-libera', `Libera: ${pecas.join(', ')}`));
      return caixa;
    }));
  }

  // ---------- Buscar ----------
  // O campo do alto da lateral, com as sugestões caindo embaixo dele (o padrão de combobox: o foco
  // fica no campo e as setas andam pela lista). Antes era um botão que abria outro campo num balão
  // -- um campo para chegar a outro --, e no celular o balão fechava com o teclado que subia.
  const busca = $('buscaCampo');
  const buscaLugar = $('buscaLugar');
  const buscaLista = $('buscaLista');
  let sugestoes = [];
  let escolhida = -1;
  function marcarSugestao(i) {
    escolhida = i;
    sugestoes.forEach((s, j) => s.el.setAttribute('aria-selected', String(j === i)));
    const el = sugestoes[i]?.el;
    if (!el) { busca.removeAttribute('aria-activedescendant'); return; }
    busca.setAttribute('aria-activedescendant', el.id);
    // Rola só a lista. `scrollIntoView` rolaria também a página, que corta o que passa dela.
    if (el.offsetTop < buscaLista.scrollTop) buscaLista.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > buscaLista.scrollTop + buscaLista.clientHeight) buscaLista.scrollTop = el.offsetTop + el.offsetHeight - buscaLista.clientHeight;
  }
  function fecharBusca() {
    buscaLista.hidden = true;
    busca.setAttribute('aria-expanded', 'false');
    marcarSugestao(-1);
  }
  function seguirSugestao(sugestao) {
    fecharBusca();
    busca.value = '';
    sugestao.fazer();
  }
  function sugerir() {
    const texto = busca.value.trim();
    const t = texto.toLowerCase();
    const amigos = S.estado.amigos.amigos.filter(p => !t || [p.apelido, p.apelidoMeu, p.codigo].some(v => String(v || '').toLowerCase().includes(t))).slice(0, 8);
    const salas = salasRecentes().filter(s => t && s.includes(t.replace(/^#/, ''))).slice(0, 4);
    const lista = [
      ...amigos.map(p => ({ rotulo: p.apelidoMeu || p.apelido, ico: 'mensagem', fazer: () => abrirConversa(p.codigo) })),
      ...salas.map(s => ({ rotulo: `#${s}`, ico: 'sala', fazer: () => irParaSala(s) }))
    ];
    // Um código que não está nas recentes também leva à sala -- quando não é o nome de um amigo,
    // ou quando começa com "#". Sem botão de "Ir", era o Enter que fazia isso, sem ninguém saber.
    const codigo = normalizarCodigo(texto);
    if (CODIGO_DE_SALA.test(codigo) && !salas.includes(codigo) && (!amigos.length || texto.startsWith('#'))) {
      lista.push({ rotulo: `Entrar na sala #${codigo}`, ico: 'porta', fazer: () => irParaSala(codigo) });
    }
    sugestoes = lista.map((s, i) => {
      const el = botao({ classe: 'nx-menu-item', rotulo: s.rotulo, ico: s.ico, fazer: () => seguirSugestao(s) });
      el.id = `buscaSugestao${i}`;
      el.setAttribute('role', 'option');
      el.tabIndex = -1;
      return { el, fazer: s.fazer };
    });
    buscaLista.replaceChildren(...sugestoes.map(s => s.el));
    if (!sugestoes.length) buscaLista.append(elemento('p', 'nx-menu-titulo', t ? 'Nada com esse nome.' : 'Seus amigos aparecem aqui.'));
    buscaLista.hidden = false;
    busca.setAttribute('aria-expanded', 'true');
    // Com algo digitado, o Enter leva à primeira; com o campo vazio, a nenhuma.
    marcarSugestao(t && sugestoes.length ? 0 : -1);
  }
  busca.addEventListener('focus', sugerir);
  busca.addEventListener('input', sugerir);
  // Tocar no campo que já tem o foco (depois do Esc) abre a lista de novo.
  busca.addEventListener('click', () => { if (buscaLista.hidden) sugerir(); });
  busca.addEventListener('keydown', evento => {
    if (evento.isComposing) return;
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (buscaLista.hidden) { sugerir(); return; }
      const n = sugestoes.length;
      if (!n) return;
      const passo = evento.key === 'ArrowDown' ? 1 : -1;
      marcarSugestao(escolhida < 0 ? (passo > 0 ? 0 : n - 1) : (escolhida + passo + n) % n);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (!buscaLista.hidden && sugestoes[escolhida]) seguirSugestao(sugestoes[escolhida]);
    } else if (evento.key === 'Escape') {
      // O Esc fecha a lista, depois apaga o que foi digitado, e só então chega à gaveta.
      if (!buscaLista.hidden) fecharBusca();
      else if (busca.value) busca.value = '';
      else return;
      evento.stopPropagation();
    }
  });
  // Clicar numa sugestão não tira o foco do campo: a lista não corre o risco de fechar entre o
  // apertar e o soltar, e quem usa o teclado continua nele.
  buscaLista.addEventListener('mousedown', evento => evento.preventDefault());
  // Fecha ao tocar fora, ou quando o foco sai pelo Tab. Perder o foco sem destino (o toque numa
  // sugestão, num navegador que não foca botão) não fecha: a lista sumiria antes do clique.
  document.addEventListener('pointerdown', evento => { if (!buscaLista.hidden && !buscaLugar.contains(evento.target)) fecharBusca(); });
  buscaLugar.addEventListener('focusout', evento => { if (evento.relatedTarget && !buscaLugar.contains(evento.relatedTarget)) fecharBusca(); });
  function focarBusca() {
    if (window.matchMedia('(max-width:760px)').matches) abrirGaveta();
    busca.focus();
    if (buscaLista.hidden) sugerir();
  }
  document.addEventListener('keydown', evento => {
    // Ctrl K continua levando à busca; só não aparece mais escrito no campo.
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      focarBusca();
    }
    if (evento.key === 'Escape' && app.classList.contains('menu-aberto')) fecharGaveta();
  });

  // ---------- Dentro de uma chamada ----------
  // O Esc volta para a sala -- mas só quando não há nada aberto aqui para ele fechar antes (o
  // menu, o cartão, a gaveta, a lista da busca, o visor de imagem, as novidades) e a pessoa não está
  // no meio de um texto: um rascunho de mensagem não some com um Esc. A conferência é na captura,
  // antes dos outros ouvintes: eles fecham o que estiver aberto, e depois do Esc já não estaria.
  if (camada) {
    // Só campo de texto de verdade: um interruptor ou uma régua têm `value` mesmo sem ninguém escrever.
    const escrevendo = () => {
      const foco = document.activeElement;
      return Boolean(foco?.matches?.('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="password"],input[type="url"],input[type="tel"]') && foco.value);
    };
    const algoAberto = () => !menu.hidden || !modal.hidden || app.classList.contains('menu-aberto') || !buscaLista.hidden
      || Boolean(document.querySelector('.nx-dm-visor')) || Boolean(window.NexoNovidades?.estado().aberto)
      || !$('atualizarAppMenu').classList.contains('hidden');
    document.addEventListener('keydown', evento => {
      if (evento.key !== 'Escape' || evento.isComposing || algoAberto() || escrevendo()) return;
      camada.avisar('fechar');
    }, true);
    camada.ao('buscar', focarBusca);
    camada.ao('abrir-conversa', ({ com }) => { if (S.relacao(com) === 'amigos') abrirConversa(com); });
    camada.ao('secao', ({ nome }) => {
      if (['perfil', 'conquistas', 'adicionar'].includes(nome)) irPara(nome);
      else if (nome === 'pedidos') escolherAba('pedidos');
    });
    // A marca da trilha é "Início" aqui dentro: leva aos amigos, e não recarrega o quadro.
    document.querySelector('.trilho-marca').addEventListener('click', evento => { evento.preventDefault(); irPara('amigos'); });
    // A engrenagem abre a conta no mesmo quadro (a camada mostra a conta, e não a navegação).
    document.querySelector('.ini-eu-conta').addEventListener('click', evento => { evento.preventDefault(); camada.irPara('/conta'); });
  }

  // ---------- Avisos ----------
  // "Não incomodar" segura os avisos de mensagem no canto; a contagem continua.
  const naoIncomodar = () => minhaPresencaEscolhida() === 'ocupado';
  function atualizarTitulo() {
    const n = S.totalNaoLidas();
    document.title = n ? `(${n}) Nexo` : 'Nexo';
  }
  S.on('mensagem', ({ com, mensagem }) => {
    pintarConversas();
    atualizarTitulo();
    if (mensagem.de === S.estado.eu) return;
    const vendo = secao === 'conversa' && conversa?.codigo === com && document.visibilityState === 'visible';
    if (vendo || naoIncomodar() || mensagem.tipo === 'convite') return;
    aviso({ icone: 'mensagem', titulo: S.nomeDe(com), detalhe: (mensagem.texto || 'Mandou uma imagem').slice(0, 120), acoes: [{ rotulo: 'Responder', principal: true, fazer: () => abrirConversa(com) }] });
  });
  S.on('convite', ({ de, apelido, sala }) => {
    pintarConversas();
    // Chamado para a sala em que já está: a conversa mostra o convite, e o aviso não tem o que pedir.
    if (ehMinhaSala(sala)) return;
    aviso({ icone: 'convite', titulo: `${S.nomeDe(de) || apelido} chamou você`, detalhe: camada ? `Para a sala #${sala}. Entrar sai desta chamada.` : `Para a sala #${sala}`, fecharEm: 15000, acoes: [{ rotulo: 'Entrar na sala', principal: true, fazer: () => irParaSala(sala) }, { rotulo: 'Responder', fazer: () => abrirConversa(de) }] });
  });
  S.on('conquista', c => {
    aviso({ tom: 'ok', icone: 'conquista', titulo: `Conquista: ${c.nome}`, detalhe: c.descricao, fecharEm: 8000, acoes: [{ rotulo: 'Ver conquistas', fazer: () => irPara('conquistas') }] });
    editor.carregar();
  });
  S.on('lida', () => { pintarConversas(); atualizarTitulo(); });
  S.on('naoLidas', atualizarTitulo);
  S.on('amigos', ({ recebidos }) => {
    // Pedido novo, chegado agora: avisa uma vez. Os que já estavam na lista ao abrir não avisam.
    const codigos = new Set(recebidos.map(p => p.codigo));
    if (recebidosVistos) for (const p of recebidos) if (!recebidosVistos.has(p.codigo)) aviso({ icone: 'amigo', titulo: `${p.apelido} quer ser seu amigo`, fecharEm: 10000, acoes: [{ rotulo: 'Aceitar', principal: true, fazer: () => S.aceitar(p.codigo) }, { rotulo: 'Ver pedidos', fazer: () => escolherAba('pedidos') }] });
    recebidosVistos = codigos;
    repintar();
  });
  S.on('presenca', repintar);
  S.on('pronto', repintar);
  S.on('minha', () => { pintarEu(); if (secao === 'perfil') editor.pintarStatus(); });
  S.on('sem-conta', () => { if (camada) camada.avisar('sem-conta'); else window.location.href = '/'; });

  function repintar() {
    pintarAmigos();
    pintarAgora();
    pintarConversas();
    pintarTrilho();
    pintarEu();
  }

  // ---------- Começo ----------
  NexoConta.pronto.then(async dados => {
    // A sessão terminou entre o servidor escolher esta página e a conta responder: a apresentação.
    if (!dados?.conta) { if (camada) camada.avisar('sem-conta'); else window.location.href = '/'; return; }
    conta = dados.conta;
    $('copiarUsuario').textContent = `@${conta.usuario}`;
    $('copiarCodigo').textContent = conta.codigo;
    copiarComConfirmacao($('copiarUsuario'), `@${conta.usuario}`, `@${conta.usuario}`);
    copiarComConfirmacao($('copiarCodigo'), conta.codigo, conta.codigo);
    // As cores exatas do tema são do nível completo; esta página sabe o plano, e o tema lembra.
    if (window.NexoTema && window.NexoPlanos) { NexoTema.definirPermissao(NexoPlanos.podeUsarCoresExatas(conta.nivel, dados.planosLigados === false)); NexoTema.aplicar(); }
    repintar();
    await editor.carregar();
    await S.iniciar();
    recebidosVistos = new Set(S.estado.amigos.recebidos.map(p => p.codigo));
    repintar();
    const parametros = new URLSearchParams(window.location.search);
    const pedida = parametros.get('secao');
    if (['perfil', 'conquistas', 'adicionar'].includes(pedida)) irPara(pedida);
    if (pedida === 'pedidos') escolherAba('pedidos');
    if (S.estado.amigos.recebidos.length && !pedida) escolherAba('disponiveis');
    // A notificação de mensagem do aplicativo Android, tocada com a página ainda fechada.
    const comQuem = parametros.get('conversa');
    if (comQuem && S.relacao(comQuem) === 'amigos') abrirConversa(comQuem);
    if (pedida || comQuem) history.replaceState(null, '', window.location.pathname);
    avisarPronto();
  });
  // A camada espera o "pronto" para mostrar a página (inicio-na-sala.js). Ele vem quando a lista de
  // amigos já está pintada -- antes disso a página mostraria "Seus amigos aparecem aqui" por um
  // instante --, mas não espera para sempre: um servidor lento não pode deixar a camada girando.
  const avisarPronto = (() => {
    let avisado = false;
    return () => { if (avisado) return; avisado = true; camada?.avisar('pronto', { pagina: 'inicio' }); };
  })();
  if (camada) setTimeout(avisarPronto, 4000);
  // A notificação tocada com a página aberta (app-android.js): sem recarregar nada.
  window.NexoAndroid?.ao('aviso-tocado', ({ acao, com, sala, codigo }) => {
    if (acao === 'abrir' && S.relacao(com) === 'amigos') abrirConversa(com);
    else if (acao === 'entrar' && CODIGO_DE_SALA.test(sala || '')) irParaSala(sala);
    else if (acao === 'aceitar' && S.relacao(codigo) === 'recebido') {
      S.aceitar(codigo).then(r => {
        if (!r.ok) aviso({ tom: 'erro', icone: 'erro', titulo: 'Não foi possível aceitar', detalhe: r.dados.error });
        else aviso({ tom: 'ok', icone: 'amigo', titulo: `Você e ${S.nomeDe(codigo)} agora são amigos`, fecharEm: 3500 });
      });
    } else if (acao === 'aceitar' || acao === 'pedidos') escolherAba('pedidos');
  });
  // As salas recentes mudam quando outra aba entra numa sala.
  window.addEventListener('storage', evento => { if (evento.key === 'nexoRecentRooms') pintarTrilho(); });
  window.addEventListener('focus', pintarTrilho);
})();
