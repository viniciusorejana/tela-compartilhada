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
 *
 * ---------- Baixar sem sair da sala ----------
 *
 * O aplicativo novo baixa a atualização ele mesmo (app/main.js), e o progresso aparece num
 * aviso no canto; no fim, "Reiniciar agora" troca um pelo outro. Um aplicativo antigo não tem
 * essa ponte, e para ele o botão continua abrindo o download no navegador do sistema -- o
 * mesmo caminho de sempre.
 */
(() => {
  const $ = id => document.getElementById(id);
  const botao = $('atualizarAppBtn');
  const rotuloDoBotao = botao.querySelector('span');
  const cartao = $('atualizarAppMenu');
  const baixar = $('atualizarAppBaixar');
  const ADIAMENTO = 3 * 24 * 60 * 60 * 1000;
  const CHAVE = 'nexo.atualizacao.adiada';

  const nativo = window.appNativo;
  const local = NexoVersao.doAplicativo(nativo);
  const baixaSozinho = Boolean(nativo?.baixarAtualizacao && nativo.aoProgressoDaAtualizacao && window.NexoToast);
  let situacao = null;
  let build = null;
  let toast = null;
  let ultimoEstado = null;
  const velocidade = window.NexoToast?.medidorDeVelocidade();

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
    baixar.focus();
  }
  function fechar() {
    cartao.classList.add('hidden');
    botao.setAttribute('aria-expanded', 'false');
  }

  async function conferir() {
    if (!local) return;
    situacao = { texto: `Nexo ${local}`, desatualizado: false };
    try {
      const resposta = await fetch('/api/desktop-app', { cache: 'no-store' });
      if (!resposta.ok) return;
      const dados = await resposta.json();
      const sistema = NexoVersao.SISTEMA_DA_PLATAFORMA[nativo.plataforma] || 'windows';
      build = (dados.sistemas || []).find(s => s.chave === sistema) || null;
    } catch (_) { return; }
    if (!build?.versao || NexoVersao.comparar(build.versao, local) <= 0) {
      if (build?.versao) situacao.texto = `Nexo ${local} (a versão mais recente)`;
      return;
    }
    situacao = { texto: `Nexo ${local} · a ${build.versao} já está disponível`, desatualizado: true };
    $('atualizarAppTitulo').textContent = `Nexo ${build.versao} disponível`;
    $('atualizarAppTexto').textContent = baixaSozinho
      ? `Você está com a ${local}. O aplicativo baixa a versão nova sem sair da sala e avisa quando ela estiver pronta: a conta, o servidor escolhido e os ajustes continuam.`
      : `Você está com a ${local}. Baixe o arquivo novo e abra ele no lugar do antigo: a conta, o servidor escolhido e os ajustes continuam.`;
    baixar.href = build.url;
    baixar.textContent = baixaSozinho ? 'Atualizar agora' : 'Baixar agora';
    botao.title = `Nexo ${build.versao} disponível (você está com a ${local})`;
    // Um download já em curso (a sala foi recarregada no meio dele) aparece mesmo com o aviso
    // adiado: foi a própria pessoa que pediu.
    if (baixaSozinho) {
      const emCurso = await nativo.estadoDaAtualizacao().catch(() => null);
      if (emCurso && ['pedido', 'baixando', 'pronto'].includes(emCurso.estado)) { botao.hidden = false; mostrarProgresso(emCurso); return; }
    }
    if (adiada(build.versao)) return;
    botao.hidden = false;

    $('atualizarAppDepois').onclick = () => {
      try { localStorage.setItem(CHAVE, JSON.stringify({ versao: build.versao, ate: Date.now() + ADIAMENTO })); } catch (_) { /* some só até recarregar */ }
      fechar();
      botao.hidden = true;
    };
  }

  // ---------- O progresso, vindo do aplicativo ----------
  function pintarBotao(texto) {
    rotuloDoBotao.textContent = texto;
  }

  function mostrarProgresso(dados) {
    const anterior = ultimoEstado;
    ultimoEstado = dados.estado;
    const versao = dados.versao || build?.versao || '';
    if (dados.estado === 'pedido' || dados.estado === 'baixando') {
      const fracao = dados.total ? dados.recebidos / dados.total : null;
      const porcento = fracao === null ? '' : ` · ${Math.floor(fracao * 100)}%`;
      pintarBotao(fracao === null ? 'Baixando…' : `Baixando ${Math.floor(fracao * 100)}%`);
      const detalhe = dados.estado === 'pedido' ? 'Conectando ao servidor…'
        : NexoToast.descreverProgresso({ recebidos: dados.recebidos, total: dados.total, bytesPorSegundo: velocidade(dados.recebidos) });
      const conteudo = { titulo: `Baixando o Nexo ${versao}${porcento}`, detalhe, icone: 'atualizar', tom: '', progresso: fracao, acoes: [],
        aoCancelar: () => nativo.cancelarAtualizacao(), rotuloCancelar: 'Cancelar a atualização', fecharEm: 0 };
      if (!toast || toast.fechado) toast = NexoToast.mostrar(conteudo); else toast.atualizar(conteudo);
      return;
    }
    if (dados.estado === 'pronto') {
      pintarBotao('Reiniciar');
      botao.title = `Nexo ${versao} baixado. Clique para reiniciar na versão nova.`;
      // O aviso de "pronto" aparece uma vez, quando o download termina -- e não a cada recarga.
      if (anterior === 'pronto' || (anterior === null && !toast)) return;
      const conteudo = {
        titulo: `Nexo ${versao} pronto`, icone: 'ok', tom: 'ok', progresso: 1, aoCancelar: null, fecharEm: 0,
        detalhe: `${dados.arquivo ? `${dados.arquivo} está em Downloads. ` : ''}Reinicie para usar a versão nova.`,
        acoes: [
          { rotulo: 'Reiniciar agora', principal: true, fecha: false, fazer: () => nativo.abrirAtualizacao() },
          { rotulo: 'Mostrar na pasta', fecha: false, fazer: () => nativo.mostrarAtualizacao() }
        ]
      };
      if (!toast || toast.fechado) toast = NexoToast.mostrar(conteudo); else toast.atualizar(conteudo);
      return;
    }
    // Cancelado ou falhou: o botão volta a oferecer a atualização.
    pintarBotao('Atualizar');
    const cancelou = dados.estado === 'cancelado';
    const conteudo = cancelou
      ? { titulo: 'Atualização cancelada', detalhe: 'Nada foi salvo. Dá para tentar de novo pelo botão Atualizar.', icone: 'erro', tom: '', progresso: false, aoCancelar: null, acoes: [], fecharEm: 4500 }
      : {
        titulo: 'A atualização parou no meio', detalhe: 'A conexão com o servidor caiu durante o download.', icone: 'erro', tom: 'erro', progresso: false, aoCancelar: null, fecharEm: 0,
        acoes: [
          { rotulo: 'Tentar de novo', principal: true, fazer: () => atualizar() },
          // Abre no navegador do sistema, como antes: a janela manda para fora todo link de aba nova.
          { rotulo: 'Baixar pelo navegador', fazer: () => { if (build?.url) window.open(build.url, '_blank', 'noopener'); } }
        ]
      };
    if (!toast || toast.fechado) toast = NexoToast.mostrar(conteudo); else toast.atualizar(conteudo);
  }

  async function atualizar() {
    if (!build?.versao) return;
    if (ultimoEstado === 'pronto') { nativo.abrirAtualizacao(); return; }
    if (ultimoEstado === 'pedido' || ultimoEstado === 'baixando') {
      toast?.elemento.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260 });
      return;
    }
    mostrarProgresso({ estado: 'pedido', versao: build.versao, recebidos: 0, total: 0 });
    const resposta = await nativo.baixarAtualizacao(build.versao).catch(() => ({ ok: false }));
    if (!resposta?.ok) mostrarProgresso({ estado: 'falhou', versao: build.versao });
  }
  if (baixaSozinho) nativo.aoProgressoDaAtualizacao(mostrarProgresso);

  botao.onclick = evento => {
    evento.stopPropagation();
    // Baixando ou pronto, o botão é o atalho da ação do momento, e não a porta do cartão.
    if (baixaSozinho && ['pedido', 'baixando', 'pronto'].includes(ultimoEstado)) { atualizar(); return; }
    if (cartao.classList.contains('hidden')) abrir(); else fechar();
  };
  // Baixar abre no navegador do sistema (o aplicativo manda para fora todo link de nova aba), e
  // o cartão sai de cena: o botão continua ali, para quem quiser o lembrete. Com o aplicativo
  // novo, quem baixa é ele, e o link fica só de reserva.
  baixar.addEventListener('click', evento => {
    fechar();
    if (!baixaSozinho) return;
    evento.preventDefault();
    atualizar();
  });
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
