/* O perfil, de dentro da sala: quem abre o editor, e o caminho para a página da conta.
 *
 * Antes eram dois painéis para o mesmo perfil: "Meu perfil" (apelido, cor, marca, foto) e "Personalizar o
 * cartão" (banner, borda, bio, status). Quem queria mudar o apelido e a borda ia a um, voltava e ia ao outro,
 * e cada tela tinha dois botões para chegar a eles. Agora é um só -- o editor do perfil (editor-cartao.js, num
 * painel da sala, aberto por `NexoSalaSocial.abrirEditor`) --, e o servidor avisa a sala inteira
 * (`peer-perfil`, em sala.js) no instante em que a conta salva.
 *
 * Quem entrou sem conta não tem perfil para editar: o nome vale só naquela entrada, e trocá-lo no meio da
 * conversa seria um jeito fácil de se passar por outra pessoa. Para ela, o botão do "eu" abre um painel curto
 * que explica o que a conta traz e leva a criá-la.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('meuPerfilPanel');

  function abrir() {
    const { conta } = window.NexoConta?.atual() || {};
    // Com conta, o editor completo; ele abre sem sair da chamada.
    if (conta && window.NexoSalaSocial) { window.NexoSalaSocial.abrirEditor(); return; }
    pintarAvatar($('meuPerfilAvatar'), myName || '?', null);
    window.NexoFoto?.ampliavel($('meuPerfilAvatar'), null);
    $('meuPerfilNome').textContent = myName || 'Você';
    $('meuPerfilCodigo').textContent = 'Sem conta';
    painel.classList.remove('hidden');
  }

  $('meuPerfilBtn').addEventListener('click', abrir);
  $('meuPerfilCriar').href = `/conta?voltar=${encodeURIComponent(location.pathname)}`;

  // ---------- Ir para a página da conta ----------
  // A página da conta não abre numa aba nova: no aplicativo, a aba nova era o navegador, fora do Nexo. Quem tem
  // conta a vê por cima da sala, sem sair da chamada (inicio-na-sala.js: "Senha e conta", e qualquer link para
  // /conta). Quem vai CRIAR uma conta muda quem entrou na sala, e isso só se faz fora dela: a página abre NESTA
  // janela, depois de um painel que avisa que a pessoa sai da chamada; confirmado, ela sai direito
  // (`sairDaSala`, sala.js) com `?voltar=`, e o cadastro termina de volta nesta sala, já com a conta.
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
