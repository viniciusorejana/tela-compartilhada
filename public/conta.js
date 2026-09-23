/* A página da conta: entrar, criar, recuperar, e o que se faz com a conta depois.
 *
 * Tudo o que vem do servidor entra por `textContent`. O apelido é escolhido por quem cria a
 * conta, e nada dele vira marcação aqui.
 */
(() => {
  const $ = id => document.getElementById(id);
  let csrf = '';
  let conta = null;

  const parametros = new URLSearchParams(location.search);
  // Só caminhos DESTE site, e sem `//` no começo: um `voltar` para outro domínio faria desta
  // página um trampolim para qualquer lugar, com a cara do Nexo.
  const voltar = (() => {
    const valor = parametros.get('voltar') || '';
    return /^\/(?!\/)[\w\-/]*$/.test(valor) ? valor : '';
  })();
  if (parametros.get('motivo') === 'criar-sala') {
    $('motivoDaVisita').textContent = 'Para abrir uma sala, entre ou crie uma conta grátis. Quem recebe o seu convite entra sem conta nenhuma.';
  }

  async function api(caminho, { metodo = 'GET', corpo } = {}) {
    const cabecalhos = { 'Content-Type': 'application/json' };
    if (csrf) cabecalhos['X-Nexo-CSRF'] = csrf;
    let resposta;
    try {
      resposta = await fetch(caminho, { method: metodo, headers: cabecalhos, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
    } catch (_) {
      return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } };
    }
    const dados = await resposta.json().catch(() => ({}));
    if (dados.csrf) csrf = dados.csrf;
    return { ok: resposta.ok, status: resposta.status, dados };
  }

  function mostrar(qual) {
    for (const id of ['carregando', 'semConta', 'codigoNovo', 'comConta']) $(id).hidden = id !== qual;
    const alvo = $(qual).querySelector('input:not([type="checkbox"]), h1');
    if (alvo?.tagName === 'INPUT') alvo.focus();
  }

  // ---------- Abas ----------
  const abas = [['abaEntrar', 'formEntrar'], ['abaCriar', 'formCriar'], ['abaRecuperar', 'formRecuperar']];
  function abrirAba(abaId, focar = true) {
    for (const [aba, painel] of abas) {
      const ativa = aba === abaId;
      $(aba).setAttribute('aria-selected', String(ativa));
      $(aba).tabIndex = ativa ? 0 : -1;
      $(painel).hidden = !ativa;
    }
    if (focar) $(abas.find(([a]) => a === abaId)[1]).querySelector('input')?.focus();
  }
  abas.forEach(([aba], indice) => {
    $(aba).onclick = () => abrirAba(aba);
    $(aba).onkeydown = evento => {
      if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
      const proxima = abas[(indice + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length][0];
      $(proxima).focus();
      abrirAba(proxima, false);
    };
  });
  // Quem chegou pelo "Criar minha sala" veio criar uma conta, não entrar numa que não tem.
  if (parametros.get('motivo') === 'criar-sala') abrirAba('abaCriar', false);

  // ---------- Formulários ----------
  function avisar(formulario, texto) {
    const campo = formulario.querySelector('.error');
    campo.hidden = !texto;
    campo.textContent = texto || '';
  }
  // Um envio por vez: dois cliques no botão virariam duas contas tentando o mesmo usuário.
  function aoEnviar(formulario, fn) {
    formulario.addEventListener('submit', async evento => {
      evento.preventDefault();
      const botao = formulario.querySelector('button[type="submit"]');
      if (botao.disabled) return;
      botao.disabled = true;
      avisar(formulario, '');
      try { await fn(formulario); } finally { botao.disabled = false; }
    });
  }
  const valor = (formulario, nome) => formulario.querySelector(`[name="${nome}"]`)?.value ?? '';
  function falhou(formulario, resposta) {
    avisar(formulario, resposta.dados.error || 'Não foi possível concluir. Tente de novo.');
    const campo = resposta.dados.campo && formulario.querySelector(`[name="${resposta.dados.campo}"]`);
    campo?.focus();
  }

  aoEnviar($('formEntrar'), async formulario => {
    const r = await api('/api/conta/entrar', { metodo: 'POST', corpo: { usuario: valor(formulario, 'usuario'), senha: valor(formulario, 'senha') } });
    if (!r.ok) { falhou(formulario, r); return; }
    formulario.reset();
    concluir(r.dados.conta, r.dados.perfil);
  });

  aoEnviar($('formCriar'), async formulario => {
    const r = await api('/api/conta/cadastrar', { metodo: 'POST', corpo: {
      usuario: valor(formulario, 'usuario'), apelido: valor(formulario, 'apelido'), senha: valor(formulario, 'senha')
    } });
    if (!r.ok) { falhou(formulario, r); return; }
    formulario.reset();
    mostrarCodigo(r.dados.recuperacao, r.dados.conta);
  });

  aoEnviar($('formRecuperar'), async formulario => {
    const r = await api('/api/conta/recuperar', { metodo: 'POST', corpo: {
      usuario: valor(formulario, 'usuario'), codigo: valor(formulario, 'codigo'), nova: valor(formulario, 'nova')
    } });
    if (!r.ok) { falhou(formulario, r); return; }
    formulario.reset();
    if (r.dados.perfil) perfil = r.dados.perfil;
    mostrarCodigo(r.dados.recuperacao, r.dados.conta);
  });

  // ---------- O código de recuperação, mostrado uma vez ----------
  let contaDepoisDoCodigo = null;
  function mostrarCodigo(codigo, novaConta) {
    contaDepoisDoCodigo = novaConta;
    $('codigoNovoValor').textContent = codigo;
    $('guardeiCodigo').checked = false;
    $('seguirDoCodigo').disabled = true;
    mostrar('codigoNovo');
  }
  $('guardeiCodigo').onchange = () => { $('seguirDoCodigo').disabled = !$('guardeiCodigo').checked; };
  $('copiarCodigo').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('codigoNovoValor').textContent);
      $('copiarCodigo').textContent = 'Copiado!';
      setTimeout(() => { $('copiarCodigo').textContent = 'Copiar'; }, 1800);
    } catch (_) {
      const selecao = window.getSelection();
      const intervalo = document.createRange();
      intervalo.selectNodeContents($('codigoNovoValor'));
      selecao.removeAllRanges();
      selecao.addRange(intervalo);
    }
  };
  $('seguirDoCodigo').onclick = () => {
    $('codigoNovoValor').textContent = '';
    // Recuperar uma conta suspensa devolve o código novo, mas não uma sessão.
    if (contaDepoisDoCodigo) concluir(contaDepoisDoCodigo);
    else { mostrar('semConta'); abrirAba('abaEntrar'); }
  };

  // ---------- Com conta ----------
  let perfil = { cor: null, marca: null };

  function pintarAvatar(el, nome, dados) {
    const aparencia = NexoPerfil.aparencia(nome, dados);
    el.textContent = aparencia.texto;
    el.style.background = aparencia.cor;
    el.classList.toggle('com-marca', aparencia.marca);
  }

  // As opções vêm do mesmo conjunto que o servidor aceita (perfil.js), e cada uma é um rádio
  // de verdade: dá para escolher pelo teclado, e o leitor de tela diz o nome da cor.
  const NOMES_DAS_CORES = { lilas: 'Lilás', menta: 'Menta', ambar: 'Âmbar', coral: 'Coral', ceu: 'Céu', rosa: 'Rosa', limao: 'Limão', areia: 'Areia', turquesa: 'Turquesa', ameixa: 'Ameixa' };
  const NOMES_DAS_MARCAS = { brilho: 'Brilho', losango: 'Losango', estrela: 'Estrela', lua: 'Lua', raio: 'Raio', flor: 'Flor', cavalo: 'Cavalo', nota: 'Nota', coracao: 'Coração', sol: 'Sol', trevo: 'Trevo', circulo: 'Círculo' };
  function opcao(grupo, valor, rotulo, desenhar) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = grupo; radio.value = valor;
    radio.setAttribute('aria-label', rotulo);
    const amostra = document.createElement('span');
    amostra.className = 'escolha';
    amostra.title = rotulo;
    desenhar(amostra);
    label.append(radio, amostra);
    return label;
  }
  function montarEscolhas() {
    const cores = $('perfilCores'), marcas = $('perfilMarcas');
    cores.append(opcao('cor', '', 'A cor do meu nome', el => { el.classList.add('texto'); el.textContent = 'Do nome'; }));
    for (const [nome, cor] of Object.entries(NexoPerfil.CORES)) cores.append(opcao('cor', nome, NOMES_DAS_CORES[nome] || nome, el => { el.style.background = cor; }));
    marcas.append(opcao('marca', '', 'As iniciais do apelido', el => { el.classList.add('texto'); el.textContent = 'Iniciais'; }));
    for (const [nome, simbolo] of Object.entries(NexoPerfil.MARCAS)) marcas.append(opcao('marca', nome, NOMES_DAS_MARCAS[nome] || nome, el => { el.textContent = simbolo; el.style.background = '#ffffff14'; el.style.color = '#e4dcf6'; }));
    $('formPerfil').addEventListener('input', previa);
  }
  const escolhido = grupo => $('formPerfil').querySelector(`input[name="${grupo}"]:checked`)?.value || null;
  // O avatar do topo acompanha a escolha antes de salvar: é ali que se vê como vai ficar.
  function previa() {
    pintarAvatar($('contaAvatar'), $('perfilApelido').value.trim() || conta.apelido, { cor: escolhido('cor'), marca: escolhido('marca') });
  }
  function preencherPerfil() {
    $('perfilApelido').value = conta.apelido;
    for (const grupo of ['cor', 'marca']) {
      const atual = perfil[grupo] || '';
      $('formPerfil').querySelectorAll(`input[name="${grupo}"]`).forEach(r => { r.checked = r.value === atual; });
    }
  }

  function descreverPlano(c) {
    if (c.plano !== 'premium') return 'plano grátis';
    if (!c.planoAte) return 'premium';
    return c.planoAte > Date.now() ? `premium até ${new Date(c.planoAte).toLocaleDateString('pt-BR')}` : 'premium vencido';
  }

  function pintarConta() {
    $('contaApelido').textContent = conta.apelido;
    $('contaUsuario').textContent = `@${conta.usuario}`;
    $('contaCodigo').textContent = conta.codigo;
    $('contaPlano').textContent = descreverPlano(conta);
    pintarAvatar($('contaAvatar'), conta.apelido, perfil);
    preencherPerfil();
    $('voltarParaSala').hidden = !voltar;
    if (voltar) $('voltarParaSala').href = voltar;
  }

  // Quem veio de uma sala volta para ela: é para isso que entrou.
  function concluir(novaConta, novoPerfil) {
    conta = novaConta;
    if (novoPerfil) perfil = novoPerfil;
    if (voltar) { location.assign(voltar); return; }
    pintarConta();
    mostrar('comConta');
  }

  function dizer(texto, problema = false) {
    $('contaStatus').textContent = texto;
    $('contaStatus').classList.toggle('problema', problema);
  }

  aoEnviar($('formPerfil'), async formulario => {
    const r = await api('/api/conta/perfil', { metodo: 'PUT', corpo: { apelido: $('perfilApelido').value, cor: escolhido('cor'), marca: escolhido('marca') } });
    if (!r.ok) { falhou(formulario, r); return; }
    conta = r.dados.conta;
    perfil = r.dados.perfil;
    pintarConta();
    dizer('Perfil salvo. Ele vale na próxima vez que você entrar numa sala.');
  });

  $('apagarCerteza').onchange = () => { $('formApagar').querySelector('button').disabled = !$('apagarCerteza').checked; };
  $('formApagar').addEventListener('submit', async evento => {
    evento.preventDefault();
    const formulario = $('formApagar');
    const botao = formulario.querySelector('button');
    if (botao.disabled) return;
    botao.disabled = true;
    avisar(formulario, '');
    const r = await api('/api/conta/apagar', { metodo: 'POST', corpo: { senha: $('apagarSenha').value } });
    if (!r.ok) { avisar(formulario, r.dados.error || 'Não foi possível apagar a conta.'); botao.disabled = !$('apagarCerteza').checked; return; }
    formulario.reset();
    conta = null;
    csrf = '';
    $('motivoDaVisita').textContent = 'Sua conta foi apagada, com o perfil e as sessões. Para entrar numa sala você não precisa de conta.';
    mostrar('semConta');
    abrirAba('abaEntrar', false);
  });

  aoEnviar($('formSenha'), async formulario => {
    const r = await api('/api/conta/senha', { metodo: 'POST', corpo: { atual: $('senhaAtual').value, nova: $('senhaNova').value } });
    if (!r.ok) { avisar(formulario, r.dados.error || 'Não foi possível trocar a senha.'); return; }
    formulario.reset();
    formulario.closest('details').open = false;
    dizer('Senha trocada. A conta foi encerrada nos outros aparelhos.');
  });

  aoEnviar($('formRecuperacao'), async formulario => {
    const r = await api('/api/conta/recuperacao', { metodo: 'POST', corpo: { senha: $('recuperacaoSenha').value } });
    if (!r.ok) { avisar(formulario, r.dados.error || 'Não foi possível gerar o código.'); return; }
    formulario.reset();
    formulario.closest('details').open = false;
    mostrarCodigo(r.dados.recuperacao, conta);
  });

  $('sair').onclick = async () => {
    await api('/api/conta/sair', { metodo: 'POST' });
    conta = null;
    csrf = '';
    mostrar('semConta');
    abrirAba('abaEntrar');
  };

  montarEscolhas();
  (async () => {
    const r = await api('/api/conta/eu');
    if (r.ok && r.dados.conta) { conta = r.dados.conta; perfil = r.dados.perfil || perfil; pintarConta(); mostrar('comConta'); return; }
    mostrar('semConta');
  })();
})();
