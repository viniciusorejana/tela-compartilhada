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
    // O formato é conferido aqui também, para o aviso vir sem ida ao servidor. O servidor
    // confere de novo: a página é conveniência, não tranca.
    const lido = NexoRecuperacao.ler(valor(formulario, 'codigo'));
    if (lido.problema) { avisar(formulario, NexoRecuperacao.mensagem(lido)); $('recuperarCodigo').focus(); return; }
    const r = await api('/api/conta/recuperar', { metodo: 'POST', corpo: {
      usuario: valor(formulario, 'usuario'), codigo: NexoRecuperacao.formatar(lido.codigo), nova: valor(formulario, 'nova')
    } });
    if (!r.ok) { falhou(formulario, r); return; }
    formulario.reset();
    dicaDoCodigo();
    if (r.dados.perfil) perfil = r.dados.perfil;
    mostrarCodigo(r.dados.recuperacao, r.dados.conta);
  });

  // Quem errou a senha está a um clique da saída, com o usuário já digitado.
  $('irParaRecuperar').onclick = () => {
    const usuario = $('entrarUsuario').value.trim();
    if (usuario) $('recuperarUsuario').value = usuario;
    abrirAba('abaRecuperar', false);
    (usuario ? $('recuperarCodigo') : $('recuperarUsuario')).focus();
  };

  // O campo do código diz, enquanto a pessoa digita, se o que está ali já é um código -- e o
  // que falta, quando não é. Ao sair do campo, o código achado aparece no formato mostrado no
  // cadastro: é a confirmação de que a página leu o que a pessoa quis dizer.
  const DICA_DO_CODIGO = $('recuperarCodigoDica').textContent;
  function dicaDoCodigo() {
    const campo = $('recuperarCodigo');
    const dica = $('recuperarCodigoDica');
    const lido = NexoRecuperacao.ler(campo.value);
    dica.classList.toggle('certo', Boolean(lido.codigo));
    dica.classList.toggle('problema', Boolean(lido.problema) && lido.problema !== 'vazio' && campo.value.length > 4);
    if (lido.codigo) dica.textContent = `Código lido: ${NexoRecuperacao.formatar(lido.codigo)}`;
    else if (lido.problema === 'vazio' || campo.value.length <= 4) dica.textContent = DICA_DO_CODIGO;
    else dica.textContent = NexoRecuperacao.mensagem(lido);
    return lido;
  }
  $('recuperarCodigo').addEventListener('input', dicaDoCodigo);
  // Um campo de uma linha APAGA as quebras do que é colado, e o código grudava na palavra da
  // linha seguinte ("G6EYGerado") -- aí não havia mais código para achar. Colado aqui, cada
  // quebra vira espaço.
  $('recuperarCodigo').addEventListener('paste', evento => {
    const texto = evento.clipboardData?.getData('text');
    if (!texto || !/[\r\n]/.test(texto)) return;
    evento.preventDefault();
    const campo = evento.target;
    campo.setRangeText(texto.replace(/\s*[\r\n]+\s*/g, ' ').trim(), campo.selectionStart, campo.selectionEnd, 'end');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('recuperarCodigo').addEventListener('blur', () => {
    const lido = dicaDoCodigo();
    if (lido.codigo) $('recuperarCodigo').value = NexoRecuperacao.formatar(lido.codigo);
  });

  // ---------- O código de recuperação, mostrado uma vez ----------
  let contaDepoisDoCodigo = null;
  function mostrarCodigo(codigo, novaConta) {
    contaDepoisDoCodigo = novaConta;
    $('codigoNovoValor').textContent = codigo;
    $('copiarAviso').textContent = '';
    $('guardeiCodigo').checked = false;
    $('seguirDoCodigo').disabled = true;
    mostrar('codigoNovo');
  }
  $('guardeiCodigo').onchange = () => { $('seguirDoCodigo').disabled = !$('guardeiCodigo').checked; };
  $('copiarCodigo').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('codigoNovoValor').textContent);
      $('copiarCodigo').textContent = 'Copiado!';
      $('copiarAviso').textContent = 'Copiado. Cole num lugar seu antes de continuar.';
      setTimeout(() => { $('copiarCodigo').textContent = 'Copiar'; }, 1800);
    } catch (_) {
      // Sem permissão para a área de transferência, o código fica selecionado -- e a pessoa
      // PRECISA saber que não foi copiado, ou vai colar o que estava lá antes.
      const selecao = window.getSelection();
      const intervalo = document.createRange();
      intervalo.selectNodeContents($('codigoNovoValor'));
      selecao.removeAllRanges();
      selecao.addRange(intervalo);
      $('copiarAviso').textContent = 'Não deu para copiar sozinho: o código ficou selecionado. Use Ctrl+C (ou segure e copie, no celular).';
    }
  };
  // Um arquivo é o jeito mais difícil de errar uma letra: nada é redigitado. O texto em volta
  // do código não atrapalha -- colado inteiro na recuperação, a página acha o código nele.
  $('baixarCodigo').onclick = () => {
    const codigo = $('codigoNovoValor').textContent;
    const quem = contaDepoisDoCodigo?.usuario ? `@${contaDepoisDoCodigo.usuario}` : 'sua conta';
    const texto = [
      'Nexo · código de recuperação', '',
      // O código com espaço dos dois lados na mesma linha: se as quebras sumirem no caminho,
      // ele continua separado do texto em volta.
      `Conta: ${quem}`, `Código: ${codigo}  (vale uma vez)`, `Gerado em: ${new Date().toLocaleString('pt-BR')}`, '',
      'Use em "Esqueci a senha", na página da conta. O código vale uma vez: depois de usado,',
      'o Nexo mostra outro. Gerar um código novo cancela este.'
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([texto + '\r\n'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-recuperacao-${contaDepoisDoCodigo?.usuario || 'conta'}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('copiarAviso').textContent = 'Arquivo baixado. Guarde-o num lugar seu.';
  };
  $('seguirDoCodigo').onclick = () => {
    $('codigoNovoValor').textContent = '';
    $('copiarAviso').textContent = '';
    // Recuperar uma conta suspensa devolve o código novo, mas não uma sessão.
    if (contaDepoisDoCodigo) concluir(contaDepoisDoCodigo);
    else { mostrar('semConta'); abrirAba('abaEntrar'); }
  };

  // ---------- Com conta ----------
  let perfil = { cor: null, marca: null, avatar: null };

  function pintarAvatar(el, nome, dados) {
    NexoPerfil.pintar(el, nome, dados);
  }

  // As opções vêm do mesmo conjunto que o servidor aceita, montadas por perfil.js -- o mesmo
  // que monta o editor de dentro da sala.
  function montarEscolhas() {
    NexoPerfil.montarEscolhas($('perfilCores'), $('perfilMarcas'));
    $('formPerfil').addEventListener('input', previa);
  }
  const escolhido = grupo => $('formPerfil').querySelector(`input[name="${grupo}"]:checked`)?.value || null;
  // O avatar do topo acompanha a escolha antes de salvar: é ali que se vê como vai ficar.
  function previa() {
    pintarAvatar($('contaAvatar'), $('perfilApelido').value.trim() || conta.apelido, { cor: escolhido('cor'), marca: escolhido('marca'), avatar: perfil.avatar });
  }

  // ---------- A foto ----------
  // Sobe ao ser escolhida: a foto não é um campo do formulário do perfil, e esperar o "Salvar"
  // para uma escolha que já está na tela deixaria a pessoa achando que salvou.
  function pintarFoto() {
    $('fotoTirar').hidden = !perfil.avatar;
  }
  function dizerDaFoto(texto, problema = false) {
    $('fotoStatus').textContent = texto;
    $('fotoStatus').classList.toggle('problema', problema);
  }
  function aplicarFoto(r) {
    if (!r.ok) { dizerDaFoto(r.dados.error || 'Não foi possível trocar a foto.', true); return; }
    conta = r.dados.conta;
    perfil = r.dados.perfil;
    pintarConta();
  }
  $('fotoArquivo').addEventListener('change', async evento => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;
    dizerDaFoto('Preparando a foto…');
    let blob;
    try { blob = await NexoImagem.prepararAvatar(arquivo); }
    catch (erro) { dizerDaFoto(erro.message || 'Não foi possível abrir esta imagem.', true); return; }
    dizerDaFoto('Enviando…');
    aplicarFoto(await NexoImagem.enviar('/api/conta/avatar', blob, { csrf }));
    if ($('fotoStatus').classList.contains('problema')) return;
    dizerDaFoto('Foto trocada. Quem está numa sala com você já vê a nova.');
  });
  // O rótulo faz as vezes de botão; pelo teclado, Enter e espaço abrem a escolha também.
  document.querySelector('label[for="fotoArquivo"]').addEventListener('keydown', evento => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    evento.preventDefault();
    $('fotoArquivo').click();
  });
  $('fotoTirar').addEventListener('click', async () => {
    dizerDaFoto('Tirando…');
    aplicarFoto(await api('/api/conta/avatar', { metodo: 'DELETE' }));
    if (!$('fotoStatus').classList.contains('problema')) dizerDaFoto('Sem foto: a sala volta a mostrar a cor e a marca.');
  });
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
    pintarFoto();
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
    dizer('Perfil salvo. Quem está numa sala com você já vê o novo.');
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
    // As cores exatas do tema são do premium (planos.js). Esta página sabe o plano: atualiza o
    // que tema.js lembra, para a próxima página já nascer com as cores certas.
    const c = r.ok ? r.dados.conta : null;
    const premium = c?.plano === 'premium' && (!c.planoAte || c.planoAte > Date.now());
    if (window.NexoTema) { NexoTema.definirPermissao(r.dados?.planosLigados === false || premium); NexoTema.aplicar(); }
    if (r.ok && r.dados.conta) { conta = r.dados.conta; perfil = r.dados.perfil || perfil; pintarConta(); mostrar('comConta'); return; }
    mostrar('semConta');
  })();
})();
