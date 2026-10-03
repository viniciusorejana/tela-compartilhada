/* O perfil editado de dentro da sala.
 *
 * Antes, mudar o apelido ou a cor pedia sair da chamada, ir à página da conta e voltar --
 * e o perfil novo só valia "na próxima vez que você entrar numa sala". Aqui ele muda sem
 * sair, e o servidor avisa a sala inteira (`peer-perfil`, em sala.js) no instante em que a
 * conta salva. A rota é a mesma da página da conta: uma regra só, conferida no servidor.
 *
 * Sem conta, não há o que editar: o nome de quem entrou sem conta vale só naquela entrada, e
 * trocá-lo no meio da conversa seria um jeito fácil de se passar por outra pessoa.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('meuPerfilPanel');
  const formulario = $('meuPerfilForm');
  const salvar = $('meuPerfilSalvar');
  let montado = false;
  // O que está salvo. O botão só acende quando o que está na tela é diferente disto.
  let salvo = null;

  const escolhido = grupo => formulario.querySelector(`input[name="sala-${grupo}"]:checked`)?.value || null;
  const naTela = () => ({ apelido: $('meuPerfilApelido').value.replace(/\s+/g, ' ').trim(), cor: escolhido('cor'), marca: escolhido('marca') });
  const mudou = atual => atual.apelido !== salvo.apelido || atual.cor !== salvo.cor || atual.marca !== salvo.marca;

  function dizer(texto, tipo = '') {
    $('meuPerfilStatus').textContent = texto;
    $('meuPerfilStatus').dataset.tipo = tipo;
  }

  // A prévia do topo acompanha cada escolha antes de salvar: é ali que se vê como vai ficar.
  // A foto não passa pelo "Salvar": sobe ao ser escolhida, como na página da conta, e o servidor
  // leva a nova à sala inteira pelo mesmo `peer-perfil` do apelido.
  const fotoAtual = () => (meuPerfil ? meuPerfil.avatar : window.NexoConta?.atual()?.perfil?.avatar) || null;

  function previa() {
    const atual = naTela();
    const nome = atual.apelido || salvo.apelido;
    pintarAvatar($('meuPerfilAvatar'), nome, { cor: atual.cor, marca: atual.marca, avatar: fotoAtual() });
    // Com foto, a prévia abre a foto grande: é onde a pessoa troca a foto e quer ver como ela ficou.
    window.NexoFoto?.ampliavel($('meuPerfilAvatar'), fotoAtual() ? { foto: NexoPerfil.enderecoDaImagem(fotoAtual()), nome, codigo: window.NexoConta?.atual()?.conta?.codigo || '', vitrine: vitrineDe('self') } : null);
    $('meuPerfilNome').textContent = nome;
    $('meuPerfilFotoTirar').hidden = !fotoAtual();
    salvar.disabled = !atual.apelido || !mudou(atual);
  }

  async function trocarFoto(pedido) {
    const r = await pedido;
    if (!r.ok) { dizer(r.dados?.error || 'Não foi possível trocar a foto.', 'problema'); return; }
    window.NexoConta?.atualizar({ conta: r.dados.conta, perfil: r.dados.perfil });
    if (meuPerfil) meuPerfil = { ...meuPerfil, avatar: r.dados.perfil.avatar || null };
    previa();
    dizer(r.dados.perfil.avatar ? 'Foto trocada. A sala já vê a nova.' : 'Sem foto: a sala volta a mostrar a cor e a marca.', 'certo');
  }

  $('meuPerfilFotoArquivo').addEventListener('change', async evento => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;
    dizer('Preparando a foto…');
    let blob;
    try { blob = await NexoImagem.prepararAvatar(arquivo); }
    catch (erro) { dizer(erro.message || 'Não foi possível abrir esta imagem.', 'problema'); return; }
    dizer('Enviando…');
    await trocarFoto(NexoImagem.enviar('/api/conta/avatar', blob, { csrf: window.NexoConta?.atual().csrf || '' }));
  });
  $('meuPerfilFotoTirar').addEventListener('click', () => {
    dizer('Tirando…');
    trocarFoto(fetch('/api/conta/avatar', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Nexo-CSRF': window.NexoConta?.atual().csrf || '' } })
      .then(async resposta => ({ ok: resposta.ok, dados: await resposta.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } })));
  });
  document.querySelector('label[for="meuPerfilFotoArquivo"]').addEventListener('keydown', evento => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    evento.preventDefault();
    $('meuPerfilFotoArquivo').click();
  });

  function abrir() {
    const { conta, perfil } = window.NexoConta?.atual() || {};
    const comConta = Boolean(conta);
    formulario.hidden = !comConta;
    $('meuPerfilFoto').hidden = !comConta;
    $('meuPerfilSub').hidden = !comConta;
    $('meuPerfilSemConta').hidden = comConta;
    salvar.hidden = !comConta;
    $('meuPerfilConta').hidden = !comConta;
    // O cartão completo (banner, borda, efeito, bio, status) tem o painel dele, aberto daqui sem
    // sair da sala (social-sala.js): aqui ficam só apelido, cor, marca e foto.
    $('meuPerfilCartao').hidden = !comConta || !window.NexoSalaSocial;
    $('meuPerfilCriar').hidden = comConta;
    dizer('');
    if (!comConta) {
      pintarAvatar($('meuPerfilAvatar'), myName || '?', null);
      window.NexoFoto?.ampliavel($('meuPerfilAvatar'), null);
      $('meuPerfilNome').textContent = myName || 'Você';
      $('meuPerfilCodigo').textContent = 'Sem conta';
      painel.classList.remove('hidden');
      return;
    }
    if (!montado) {
      NexoPerfil.montarEscolhas($('meuPerfilCores'), $('meuPerfilMarcas'), 'sala-');
      montado = true;
    }
    // O que a SALA mostra agora vence o que a página guardou ao carregar: a pessoa pode ter
    // mudado o perfil em outra aba, e o `peer-perfil` já trouxe o novo até aqui.
    salvo = {
      apelido: myName || conta.apelido,
      cor: (meuPerfil ? meuPerfil.cor : perfil?.cor) || null,
      marca: (meuPerfil ? meuPerfil.marca : perfil?.marca) || null
    };
    $('meuPerfilApelido').value = salvo.apelido;
    for (const grupo of ['cor', 'marca']) {
      formulario.querySelectorAll(`input[name="sala-${grupo}"]`).forEach(radio => { radio.checked = radio.value === (salvo[grupo] || ''); });
    }
    $('meuPerfilCodigo').textContent = `@${conta.usuario} · código ${conta.codigo}`;
    previa();
    painel.classList.remove('hidden');
  }

  formulario.addEventListener('input', () => { previa(); dizer(''); });
  formulario.addEventListener('submit', async evento => {
    evento.preventDefault();
    const atual = naTela();
    if (salvar.disabled) return;
    if (!atual.apelido) { dizer('O apelido não pode ficar vazio.', 'problema'); $('meuPerfilApelido').focus(); return; }
    salvar.disabled = true;
    salvar.setAttribute('aria-busy', 'true');
    dizer('Salvando…');
    try {
      const resposta = await fetch('/api/conta/perfil', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': window.NexoConta?.atual().csrf || '' },
        body: JSON.stringify(atual)
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        dizer(dados.error || 'Não foi possível salvar. Tente de novo.', 'problema');
        if (dados.campo === 'apelido') $('meuPerfilApelido').focus();
        salvar.disabled = false;
        return;
      }
      window.NexoConta?.atualizar({ conta: dados.conta, perfil: dados.perfil });
      salvo = { apelido: dados.conta.apelido, cor: dados.perfil.cor || null, marca: dados.perfil.marca || null };
      // O servidor limpa espaços e caracteres de controle: o campo mostra o que ficou valendo.
      $('meuPerfilApelido').value = salvo.apelido;
      previa();
      dizer('Salvo. A sala já vê o perfil novo.', 'certo');
    } catch (_) {
      dizer('Sem conexão com o servidor. Tente de novo.', 'problema');
      salvar.disabled = false;
    } finally {
      salvar.removeAttribute('aria-busy');
    }
  });

  $('meuPerfilBtn').addEventListener('click', abrir);
  $('meuPerfilCriar').href = `/conta?voltar=${encodeURIComponent(location.pathname)}`;
  $('meuPerfilCartao').addEventListener('click', () => {
    painel.classList.add('hidden');
    window.NexoSalaSocial?.abrirEditor();
  });

  // ---------- Ir para a página da conta ----------
  // A página da conta não abre numa aba nova: no aplicativo, a aba nova era o navegador, fora do
  // Nexo. Quem tem conta a vê por cima da sala, sem sair da chamada (inicio-na-sala.js: "Senha e
  // conta", e qualquer link para /conta). Quem vai CRIAR uma conta muda quem entrou na sala, e isso
  // só se faz fora dela: a página abre NESTA janela, depois de um painel que avisa que a pessoa sai
  // da chamada; confirmado, ela sai direito (`sairDaSala`, sala.js) com `?voltar=`, e o cadastro
  // termina de volta nesta sala, já com a conta.
  const TEXTOS_DA_IDA = {
    conta: {
      titulo: 'Sair da sala para ir à conta?',
      texto: 'A senha, o código de recuperação e os seus dados ficam na página da conta, que abre aqui, no lugar da sala. Você sai da chamada: o microfone, a câmera e a tela param, e a sala vê você sair. Na página da conta, “Voltar para a sala” traz você de volta.',
      botao: 'Sair e ir para a conta'
    },
    criar: {
      titulo: 'Sair da sala para criar a conta?',
      texto: 'A conta é criada na página da conta, que abre aqui, no lugar da sala. Você sai da chamada: o microfone, a câmera e a tela param, e a sala vê você sair. Criada a conta, você volta direto para esta sala, já com ela.',
      botao: 'Sair e criar a conta'
    }
  };
  function confirmarIrParaConta() {
    // Quem tem conta vê a página dela por cima da sala (inicio-na-sala.js), sem sair da chamada:
    // senha, código de recuperação e dados não pedem mais que a pessoa saia. O aviso abaixo fica para
    // quem vai criar uma conta (que muda quem entrou na sala) e para quando a camada não puder abrir.
    if (window.NexoConta?.atual()?.conta && window.NexoInicioNaSala?.abrir({ pagina: 'conta' })) return;
    const textos = TEXTOS_DA_IDA[window.NexoConta?.atual()?.conta ? 'conta' : 'criar'];
    $('irParaContaTitulo').textContent = textos.titulo;
    $('irParaContaTexto').textContent = textos.texto;
    $('irParaContaConfirmar').textContent = textos.botao;
    $('irParaContaConfirmar').disabled = false;
    $('irParaContaPanel').classList.remove('hidden');
  }
  document.querySelectorAll('[data-ir-para-conta]').forEach(botao => botao.addEventListener('click', confirmarIrParaConta));
  // Todo link para a página da conta passa pelo aviso enquanto a pessoa está na chamada -- os de
  // "Criar conta grátis" (configurações, Estúdio, meu perfil, mesa de sons, o aviso de qualidade, o
  // próprio cartão) e os que ainda vierem. Antes de entrar (a porta, a espera) ou depois de sair
  // (o aviso de remoção), a página troca direto: não há chamada para perder. Clique com Ctrl ou
  // Shift continua sendo a escolha de quem quer a página noutra aba.
  document.addEventListener('click', evento => {
    const link = evento.target.closest?.('a[href^="/conta"]');
    if (!link || evento.button || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
    if (link.closest('#nameGate, #waitingPanel, #removidoPanel')) return;
    if (typeof tiles === 'undefined' || !tiles.has('self')) return;
    evento.preventDefault();
    confirmarIrParaConta();
  }, true);
  $('irParaContaConfirmar').addEventListener('click', () => {
    $('irParaContaConfirmar').disabled = true;
    $('irParaContaConfirmar').textContent = 'Saindo da sala…';
    sairDaSala(`/conta?voltar=${encodeURIComponent(location.pathname)}`);
  });

  window.NexoPerfilSala = { abrir, confirmarIrParaConta };
})();
