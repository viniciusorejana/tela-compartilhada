/* "Existe um Nexo mais novo" -- dito uma vez, num canto, e sem atrapalhar.
 *
 * Só no aplicativo de mesa: no navegador a página já é sempre a do servidor. O aviso é um
 * botão pequeno no topo da sala, e nada abre sozinho: a pessoa está no meio de uma chamada, e
 * um modal pedindo para atualizar agora seria justamente o que ela não pode fazer agora.
 * "Depois" guarda o adiamento por alguns dias, para aquela versão; uma versão mais nova que
 * ela volta a avisar.
 *
 * Quem decide qual é a versão atual é o build que o servidor distribui (app/dist/versao.json,
 * via /api/desktop-app), e não o código: avisar de uma versão que ainda não foi empacotada
 * mandaria a pessoa baixar o mesmo arquivo velho de novo.
 */
(() => {
  const $ = id => document.getElementById(id);
  const botao = $('atualizarAppBtn');
  const cartao = $('atualizarAppMenu');
  const ADIAMENTO = 3 * 24 * 60 * 60 * 1000;
  const CHAVE = 'nexo.atualizacao.adiada';

  const local = NexoVersao.doAplicativo(window.appNativo);
  let situacao = null;

  function adiada(versao) {
    try {
      const guardado = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      return guardado?.versao === versao && guardado.ate > Date.now();
    } catch (_) { return false; }
  }

  function abrir() {
    cartao.classList.remove('hidden');
    botao.setAttribute('aria-expanded', 'true');
    ancorarAbaixoDe(cartao, botao);
    $('atualizarAppBaixar').focus();
  }
  function fechar() {
    cartao.classList.add('hidden');
    botao.setAttribute('aria-expanded', 'false');
  }

  async function conferir() {
    if (!local) return;
    situacao = { texto: `Nexo ${local}`, desatualizado: false };
    let build;
    try {
      const resposta = await fetch('/api/desktop-app', { cache: 'no-store' });
      if (!resposta.ok) return;
      const dados = await resposta.json();
      const sistema = NexoVersao.SISTEMA_DA_PLATAFORMA[window.appNativo.plataforma] || 'windows';
      build = (dados.sistemas || []).find(s => s.chave === sistema);
    } catch (_) { return; }
    if (!build?.versao || NexoVersao.comparar(build.versao, local) <= 0) {
      if (build?.versao) situacao.texto = `Nexo ${local} (a versão mais recente)`;
      return;
    }
    situacao = { texto: `Nexo ${local} · a ${build.versao} já está disponível`, desatualizado: true };
    $('atualizarAppTitulo').textContent = `Nexo ${build.versao} disponível`;
    $('atualizarAppTexto').textContent = `Você está com a ${local}. Baixe o arquivo novo e abra ele no lugar do antigo: a conta, o servidor escolhido e os ajustes continuam.`;
    $('atualizarAppBaixar').href = build.url;
    botao.title = `Nexo ${build.versao} disponível (você está com a ${local})`;
    if (adiada(build.versao)) return;
    botao.hidden = false;

    $('atualizarAppDepois').onclick = () => {
      try { localStorage.setItem(CHAVE, JSON.stringify({ versao: build.versao, ate: Date.now() + ADIAMENTO })); } catch (_) { /* some só até recarregar */ }
      fechar();
      botao.hidden = true;
    };
  }

  botao.onclick = evento => {
    evento.stopPropagation();
    if (cartao.classList.contains('hidden')) abrir(); else fechar();
  };
  // Baixar abre no navegador do sistema (o aplicativo manda para fora todo link de nova aba), e
  // o cartão sai de cena: o botão continua ali, para quem quiser o lembrete.
  $('atualizarAppBaixar').addEventListener('click', fechar);
  document.addEventListener('click', evento => { if (!cartao.classList.contains('hidden') && !evento.target.closest('#atualizarAppMenu')) fechar(); });
  document.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape' || cartao.classList.contains('hidden')) return;
    evento.stopPropagation();
    fechar();
    botao.focus();
  }, true);

  // Um pouco depois de a sala abrir: o que importa nos primeiros segundos é entrar na chamada.
  setTimeout(conferir, 4000);

  window.NexoAtualizacao = { situacao: () => situacao, conferir };
})();
