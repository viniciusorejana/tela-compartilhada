/* "Existe um Nexo mais novo" -- dito uma vez, num canto, e sem atrapalhar.
 *
 * Só no aplicativo: no navegador a página já é sempre a do servidor. O aviso é um botão pequeno
 * no topo (da sala e do início), e nada abre sozinho: a pessoa pode estar no meio de uma chamada,
 * e um modal pedindo para atualizar agora seria justamente o que ela não pode fazer agora.
 * Numa página sem o botão (a apresentação, que é o que o aplicativo abre para quem não tem
 * conta), o mesmo aviso vem no canto, com "Depois". "Depois" guarda o adiamento por alguns dias,
 * para aquela versão; uma versão mais nova que ela volta a avisar.
 *
 * Três aplicativos, três caminhos:
 *
 *   - O INSTALADO (o instalador do Windows, o AppImage, o .deb) se atualiza sozinho pelo
 *     processo principal (app/atualizacao-automatica.js): a versão nova desce em silêncio e se
 *     instala quando o Nexo fecha. Aqui só aparece o fim -- "Reiniciar" --, uma vez. Com
 *     "Atualizar sozinho" desligado, o aviso volta a ser o botão, e o download espera o clique.
 *   - O PORTÁTIL baixa o arquivo novo ele mesmo (app/main.js), com o progresso num aviso no
 *     canto, e no fim "Reiniciar agora" troca um pelo outro. Um aplicativo antigo não tem essa
 *     ponte, e para ele o botão abre o download no navegador do sistema.
 *   - O ANDROID, da 1.1.0 em diante, baixa o .apk ele mesmo (android/…/Atualizador.java), confere
 *     que é o Nexo, mais novo e com a mesma assinatura, e chama o instalador do Android: a pessoa
 *     toca em "Instalar" e confirma. O progresso chega pela ponte (public/app-android.js) com os
 *     mesmos estados do portátil, mais 'permissao' (o Android pede para deixar o Nexo instalar
 *     as próprias atualizações) e 'instalando'. Um APK anterior a 1.1.0 não tem o atualizador:
 *     para ele o botão abre o .apk no navegador do celular, que baixa e oferece instalar por cima.
 *
 * Nos dois últimos, quem decide qual é a versão atual é o build que o servidor distribui
 * (app/dist/versao.json, via /api/desktop-app), e não o código: avisar de uma versão que ainda
 * não foi empacotada mandaria a pessoa baixar o mesmo arquivo velho de novo.
 */
(() => {
  const $ = id => document.getElementById(id);
  // O botão e o cartão dele existem na sala e no início; fora deles, o aviso é o do canto.
  const botao = $('atualizarAppBtn');
  const rotuloDoBotao = botao?.querySelector('span') || null;
  const cartao = botao ? $('atualizarAppMenu') : null;
  const baixar = botao ? $('atualizarAppBaixar') : null;
  const NA_SALA = Boolean($('abaAplicativo'));
  const ADIAMENTO = 3 * 24 * 60 * 60 * 1000;
  const CHAVE = 'nexo.atualizacao.adiada';

  const nativo = window.appNativo || null;
  const android = !nativo && window.NexoAndroid?.versao ? window.NexoAndroid : null;
  const local = nativo ? NexoVersao.doAplicativo(nativo) : android ? android.versao : null;
  // Quem baixa e instala: o processo principal do Electron, ou o Atualizador do Android. Os dois
  // falam a mesma língua (os estados de `mostrarProgresso`); o Android não tem "mostrar na pasta".
  const motor = nativo?.baixarAtualizacao && nativo.aoProgressoDaAtualizacao
    ? {
      baixar: versao => nativo.baixarAtualizacao(versao),
      cancelar: () => nativo.cancelarAtualizacao(),
      estado: () => nativo.estadoDaAtualizacao(),
      abrir: () => nativo.abrirAtualizacao(),
      mostrar: () => nativo.mostrarAtualizacao(),
      aoProgresso: retorno => nativo.aoProgressoDaAtualizacao(retorno)
    }
    : android?.atualizacao || null;
  const baixaSozinho = Boolean(motor && window.NexoToast);
  const ehAndroid = Boolean(android?.atualizacao);
  // O processo principal procura, baixa e instala; a página só mostra.
  const instalado = Boolean(baixaSozinho && ['instalador', 'appimage', 'deb'].includes(nativo?.instalacao));
  // O arquivo de cada forma instalada, para "Baixar pelo navegador" quando a atualização falha.
  const ARQUIVO_DO_INSTALADO = { instalador: '/downloads/Nexo-Setup.exe', appimage: '/downloads/Nexo.AppImage', deb: '/downloads/Nexo.deb' };
  let situacao = null;
  // Se já se comparou com o servidor: antes disso, "a versão mais recente" seria um chute.
  let verificado = false;
  let build = null;
  let toast = null;
  let ultimoEstado = null;
  // A versão que o processo principal achou, no aplicativo instalado.
  let versaoAchada = '';
  const velocidade = window.NexoToast?.medidorDeVelocidade();

  function adiada(versao) {
    try {
      const guardado = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      return guardado?.versao === versao && guardado.ate > Date.now();
    } catch (_) { return false; }
  }

  const mostrarBotao = visivel => { if (botao) botao.hidden = !visivel; };
  const adiar = versao => {
    try { localStorage.setItem(CHAVE, JSON.stringify({ versao, ate: Date.now() + ADIAMENTO })); } catch (_) { /* some só até recarregar */ }
  };

  // Alinhado pela borda direita do botão e preso na janela, como os menus da sala (sala.js tem
  // o mesmo; o início não carrega sala.js).
  function ancorar(painel, ancora) {
    if (typeof window.ancorarAbaixoDe === 'function') { window.ancorarAbaixoDe(painel, ancora); return; }
    const base = ancora.getBoundingClientRect();
    const folga = 8;
    painel.style.left = `${Math.round(Math.max(folga, Math.min(base.right - painel.offsetWidth, window.innerWidth - painel.offsetWidth - folga)))}px`;
    painel.style.top = `${Math.round(base.bottom + 6)}px`;
  }
  function abrir() {
    cartao.classList.remove('hidden');
    botao.setAttribute('aria-expanded', 'true');
    ancorar(cartao, botao);
    baixar.focus();
  }
  function fechar() {
    if (!cartao) return;
    cartao.classList.add('hidden');
    botao.setAttribute('aria-expanded', 'false');
  }

  // O botão "Atualizar" no topo, com o cartão que diz de qual versão para qual. Sem o botão, o
  // aviso do canto, que fica até a pessoa escolher.
  function oferecer(versao, { url = '', texto }) {
    if (!botao) {
      if (adiada(versao) || !window.NexoToast || (toast && !toast.fechado)) return;
      toast = NexoToast.mostrar({
        icone: 'atualizar', titulo: `Nexo ${versao} disponível`, detalhe: texto, fecharEm: 0,
        acoes: [
          { rotulo: baixaSozinho ? 'Atualizar agora' : 'Baixar agora', principal: true, fazer: () => { if (baixaSozinho) atualizar(); else if (url) window.open(url, '_blank', 'noopener'); } },
          { rotulo: 'Depois', fazer: () => adiar(versao) }
        ]
      });
      return;
    }
    $('atualizarAppTitulo').textContent = `Nexo ${versao} disponível`;
    $('atualizarAppTexto').textContent = texto;
    baixar.href = url || '#';
    baixar.textContent = baixaSozinho ? 'Atualizar agora' : 'Baixar agora';
    botao.title = `Nexo ${versao} disponível (você está com a ${local})`;
    if (adiada(versao)) return;
    botao.hidden = false;
    $('atualizarAppDepois').onclick = () => {
      adiar(versao);
      fechar();
      botao.hidden = true;
    };
  }

  async function conferir() {
    if (!local) return;
    situacao = { texto: `Nexo ${local}${instalado ? ' · instalado' : ''}`, desatualizado: false };
    // Instalado: o processo principal é quem sabe. Uma versão já achada (ou já baixada) aparece
    // mesmo depois de a página recarregar.
    if (instalado) {
      const emCurso = await motor.estado().catch(() => null);
      if (emCurso) mostrarProgresso(emCurso);
      pintarSecao();
      return;
    }
    try {
      const resposta = await fetch('/api/desktop-app', { cache: 'no-store' });
      if (!resposta.ok) return;
      const dados = await resposta.json();
      const sistema = android ? 'android' : NexoVersao.SISTEMA_DA_PLATAFORMA[nativo.plataforma] || 'windows';
      build = (dados.sistemas || []).find(s => s.chave === sistema) || null;
    } catch (_) { return; }
    verificado = Boolean(build?.versao);
    if (!build?.versao || NexoVersao.comparar(build.versao, local) <= 0) {
      if (build?.versao) situacao.texto = `Nexo ${local} (a versão mais recente)`;
      pintarSecao();
      return;
    }
    situacao = { texto: `Nexo ${local} · a ${build.versao} já está disponível`, desatualizado: true };
    pintarSecao();
    // Um download já em curso (a sala foi recarregada no meio dele) aparece mesmo com o aviso
    // adiado: foi a própria pessoa que pediu.
    if (baixaSozinho) {
      const emCurso = await motor.estado().catch(() => null);
      if (emCurso && ['pedido', 'baixando', 'pronto', 'permissao', 'instalando'].includes(emCurso.estado)) { mostrarBotao(true); mostrarProgresso(emCurso); return; }
    }
    oferecer(build.versao, {
      url: build.url,
      texto: ehAndroid
        ? `Você está com a ${local}. O Nexo baixa a versão nova e pede para instalar por cima deste: a conta, o servidor escolhido e os ajustes continuam.`
        : baixaSozinho
          ? `Você está com a ${local}. O aplicativo baixa a versão nova sem fechar o Nexo e avisa quando ela estiver pronta: a conta, o servidor escolhido e os ajustes continuam.`
          : android
          ? `Você está com a ${local}. Baixe o arquivo novo e instale por cima deste: a conta, o servidor escolhido e os ajustes continuam.`
          : `Você está com a ${local}. Baixe o arquivo novo e abra ele no lugar do antigo: a conta, o servidor escolhido e os ajustes continuam.`
    });
  }

  // ---------- O progresso, vindo do aplicativo ----------
  function pintarBotao(texto) {
    if (rotuloDoBotao) rotuloDoBotao.textContent = texto;
  }
  const mostrarToast = conteudo => { if (!toast || toast.fechado) toast = NexoToast.mostrar(conteudo); else toast.atualizar(conteudo); };

  function mostrarProgresso(dados) {
    const anterior = ultimoEstado;
    ultimoEstado = dados.estado;
    const versao = dados.versao || versaoAchada || build?.versao || '';
    if (dados.versao) versaoAchada = dados.versao;
    if (instalado && versao && ['disponivel', 'pedido', 'baixando', 'pronto'].includes(dados.estado)) {
      situacao = { texto: `Nexo ${local} · instalado · a ${versao} ${dados.estado === 'pronto' ? 'está pronta para instalar' : 'já está disponível'}`, desatualizado: true };
    }
    pintarSecao();

    // Com "Atualizar sozinho" desligado, o aplicativo instalado só avisa; baixar espera o clique.
    if (dados.estado === 'disponivel') {
      pintarBotao('Atualizar');
      oferecer(versao, { texto: `Você está com a ${local}. O aplicativo baixa a versão nova sem fechar o Nexo e avisa quando ela estiver pronta: a conta, o servidor escolhido e os ajustes continuam.` });
      return;
    }
    if (dados.estado === 'pedido' || dados.estado === 'baixando') {
      // Descendo sozinha, ninguém pediu: nada aparece no meio da chamada.
      if (dados.silenciosa) return;
      mostrarBotao(true);
      const fracao = dados.total ? dados.recebidos / dados.total : null;
      const porcento = fracao === null ? '' : ` · ${Math.floor(fracao * 100)}%`;
      pintarBotao(fracao === null ? 'Baixando…' : `Baixando ${Math.floor(fracao * 100)}%`);
      const detalhe = dados.estado === 'pedido' ? 'Conectando ao servidor…'
        : NexoToast.descreverProgresso({ recebidos: dados.recebidos, total: dados.total, bytesPorSegundo: velocidade(dados.recebidos) });
      const conteudo = { titulo: `Baixando o Nexo ${versao}${porcento}`, detalhe, icone: 'atualizar', tom: '', progresso: fracao, acoes: [],
        aoCancelar: () => motor.cancelar(), rotuloCancelar: 'Cancelar a atualização', fecharEm: 0 };
      mostrarToast(conteudo);
      return;
    }
    // Só no Android: o sistema pede que a pessoa deixe o Nexo instalar as próprias atualizações
    // (uma vez), e depois mostra a confirmação dele.
    if (dados.estado === 'permissao') {
      mostrarBotao(true);
      pintarBotao('Instalar');
      mostrarToast({
        titulo: 'Falta uma permissão', icone: 'atualizar', tom: '', progresso: false, aoCancelar: null, fecharEm: 0,
        detalhe: 'Nas configurações que abriram, ligue “Permitir desta fonte” para o Nexo e volte: a instalação continua sozinha.',
        acoes: [{ rotulo: 'Abrir as configurações', principal: true, fecha: false, fazer: () => motor.abrir() }]
      });
      return;
    }
    if (dados.estado === 'instalando') {
      mostrarBotao(true);
      pintarBotao('Instalando…');
      mostrarToast({ titulo: `Instalando o Nexo ${versao}`, detalhe: 'Confirme na janela do Android. O Nexo fecha por um instante.', icone: 'atualizar', tom: '', progresso: null, aoCancelar: null, acoes: [], fecharEm: 0 });
      return;
    }
    if (dados.estado === 'pronto') {
      mostrarBotao(true);
      pintarBotao(ehAndroid ? 'Instalar' : 'Reiniciar');
      if (botao) botao.title = ehAndroid ? `Nexo ${versao} baixado. Toque para instalar.` : `Nexo ${versao} baixado. Clique para reiniciar na versão nova.`;
      // O aviso de "pronto" aparece uma vez, quando o download termina -- e não a cada recarga.
      // Fora da sala (sem o botão), aparece sempre: é o único lugar dele.
      if (anterior === 'pronto' || (anterior === null && !toast && botao)) return;
      const conteudo = ehAndroid
        ? {
          titulo: `Nexo ${versao} pronto`, icone: 'ok', tom: 'ok', progresso: 1, aoCancelar: null, fecharEm: 0,
          detalhe: dados.motivo || (NA_SALA ? 'Instalar fecha o Nexo por um instante, e a chamada cai. Depois é só abrir de novo.' : 'Instalar fecha o Nexo por um instante. Depois é só abrir de novo.'),
          acoes: [{ rotulo: 'Instalar agora', principal: true, fecha: false, fazer: () => motor.abrir() }]
        }
        : instalado
        ? {
          titulo: `Nexo ${versao} pronto`, icone: 'ok', tom: 'ok', progresso: 1, aoCancelar: null, fecharEm: 0,
          detalhe: 'Ele se instala quando você fechar o Nexo. Para usar agora, reinicie.',
          acoes: [{ rotulo: 'Reiniciar agora', principal: true, fecha: false, fazer: () => motor.abrir() }]
        }
        : {
          titulo: `Nexo ${versao} pronto`, icone: 'ok', tom: 'ok', progresso: 1, aoCancelar: null, fecharEm: 0,
          detalhe: `${dados.arquivo ? `${dados.arquivo} está em Downloads. ` : ''}Reinicie para usar a versão nova.`,
          acoes: [
            { rotulo: 'Reiniciar agora', principal: true, fecha: false, fazer: () => motor.abrir() },
            { rotulo: 'Mostrar na pasta', fecha: false, fazer: () => motor.mostrar() }
          ]
        };
      mostrarToast(conteudo);
      return;
    }
    // Cancelado ou falhou. O que descia sozinho tenta de novo na próxima volta, calado.
    if (dados.silenciosa) return;
    // Cancelado sem versão: a procura pedida não achou nada mais novo.
    if (dados.estado === 'cancelado' && !dados.versao) return;
    pintarBotao('Atualizar');
    const cancelou = dados.estado === 'cancelado';
    const conteudo = cancelou
      ? { titulo: 'Atualização cancelada', detalhe: 'Nada foi salvo. Dá para tentar de novo pelo botão Atualizar.', icone: 'erro', tom: '', progresso: false, aoCancelar: null, acoes: [], fecharEm: 4500 }
      : {
        // O Android diz o motivo quando é dele (a assinatura, um arquivo que não é o Nexo).
        titulo: dados.motivo ? 'A atualização não instalou' : 'A atualização parou no meio',
        detalhe: dados.motivo || 'A conexão com o servidor caiu durante o download.', icone: 'erro', tom: 'erro', progresso: false, aoCancelar: null, fecharEm: 0,
        acoes: [
          { rotulo: 'Tentar de novo', principal: true, fazer: () => atualizar() },
          // Abre no navegador do sistema, como antes: a janela manda para fora todo link de aba nova.
          { rotulo: 'Baixar pelo navegador', fazer: () => { const url = build?.url || ARQUIVO_DO_INSTALADO[nativo?.instalacao] || ''; if (url) window.open(url, '_blank', 'noopener'); } }
        ]
      };
    mostrarToast(conteudo);
  }

  async function atualizar() {
    const versao = build?.versao || versaoAchada;
    if (!versao && !instalado) return;
    if (['pronto', 'permissao'].includes(ultimoEstado)) { motor.abrir(); return; }
    if (ultimoEstado === 'pedido' || ultimoEstado === 'baixando' || ultimoEstado === 'instalando') {
      // Descendo em silêncio: o clique passa a mostrar o progresso (o processo principal avisa).
      if (instalado) { motor.baixar(versao).catch(() => {}); return; }
      toast?.elemento.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260 });
      return;
    }
    mostrarProgresso({ estado: 'pedido', versao, recebidos: 0, total: 0 });
    const resposta = await motor.baixar(versao, build?.url || '').catch(() => ({ ok: false }));
    if (resposta?.motivo === 'sem-versao-nova') { mostrarProgresso({ estado: 'cancelado', versao: '' }); mostrarBotao(false); return; }
    if (!resposta?.ok) mostrarProgresso({ estado: 'falhou', versao });
  }
  if (baixaSozinho) motor.aoProgresso(mostrarProgresso);

  // A notificação "Nexo X disponível" do Android, tocada com a página aberta: direto ao download.
  window.NexoAndroid?.ao('aviso-tocado', async ({ acao }) => {
    if (acao !== 'atualizar' || !baixaSozinho) return;
    if (!build) await conferir();
    if (build?.versao && NexoVersao.comparar(build.versao, local) > 0) atualizar();
  });

  if (botao) {
    botao.onclick = evento => {
      evento.stopPropagation();
      // Baixando ou pronto, o botão é o atalho da ação do momento, e não a porta do cartão.
      if (baixaSozinho && ['pedido', 'baixando', 'pronto', 'permissao', 'instalando'].includes(ultimoEstado)) { atualizar(); return; }
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
  }

  // ---------- A seção "Aplicativo de mesa", nas configurações ----------
  //
  // O menu do aplicativo fica escondido (Alt mostra), e o que só existe num menu escondido
  // ninguém descobre. As duas opções do instalado -- atualizar sozinho e abrir ao entrar no
  // computador -- moram aqui, junto da versão. No portátil, a seção diz o que ele não faz e por
  // quê; no navegador e no Android, ela não aparece.
  const secao = nativo?.opcoesDoAplicativo ? $('abaAplicativo') : null;
  let opcoes = null;

  function pintarSecao() {
    if (!secao) return;
    $('appVersao').textContent = `Nexo ${local}`;
    const estado = $('appVersaoEstado');
    estado.classList.toggle('tem-novidade', Boolean(situacao?.desatualizado));
    const forma = { instalador: 'instalado', appimage: 'AppImage', deb: 'instalado pelo .deb', portatil: 'portátil', desenvolvimento: 'em desenvolvimento' }[nativo.instalacao] || 'aplicativo de mesa';
    if (ultimoEstado === 'pronto') estado.textContent = `${forma} · a ${versaoAchada || build?.versao} está pronta: reinicie para usar`;
    else if (situacao?.desatualizado) estado.textContent = `${forma} · a ${versaoAchada || build?.versao} já está disponível`;
    else if (verificado) estado.textContent = `${forma} · a versão mais recente deste servidor`;
    else if (instalado) estado.textContent = `${forma} · ${opcoes?.atualizarSozinho === false ? 'avisa quando houver versão nova' : 'se atualiza sozinho'}`;
    else estado.textContent = forma;
    if (!opcoes) return;
    $('appOpcoes').hidden = !opcoes.atualizaSozinho && !opcoes.podeAbrirAoEntrar;
    $('appLinhaAtualizar').hidden = !opcoes.atualizaSozinho;
    $('appAtualizarSozinho').checked = opcoes.atualizarSozinho;
    $('appLinhaAbrir').hidden = !opcoes.podeAbrirAoEntrar;
    $('appAbrirAoEntrar').checked = opcoes.abrirAoEntrar;
    $('appDica').textContent = opcoes.tipo === 'portatil'
      ? 'Este é o Nexo portátil: ele roda de onde estiver, sem instalar, e por isso não se atualiza sozinho nem abre com o computador. O instalador faz as duas coisas — ele está na página inicial do Nexo, em “Baixar”.'
      : opcoes.atualizaSozinho
        ? 'As atualizações vêm deste servidor, o mesmo das suas salas. Uma chamada em andamento nunca é interrompida para instalar.'
        : '';
  }

  if (secao) {
    secao.hidden = false;
    nativo.opcoesDoAplicativo().then(lidas => { opcoes = lidas; pintarSecao(); }).catch(() => {});
    const trocar = (nome, campo) => campo.addEventListener('change', async () => {
      campo.disabled = true;
      const novas = await nativo.definirOpcaoDoAplicativo(nome, campo.checked).catch(() => null);
      if (novas) opcoes = novas;
      campo.disabled = false;
      pintarSecao();
    });
    trocar('atualizarSozinho', $('appAtualizarSozinho'));
    trocar('abrirAoEntrar', $('appAbrirAoEntrar'));
    $('appProcurar').addEventListener('click', async () => {
      const estado = $('appVersaoEstado');
      const procurar = $('appProcurar');
      procurar.disabled = true;
      estado.textContent = 'Procurando…';
      let falhou = false;
      if (instalado && nativo.procurarAtualizacao) {
        const achou = await nativo.procurarAtualizacao().catch(() => null);
        falhou = !achou?.ok;
        // Achou e "Atualizar sozinho" está ligado: a versão já começou a descer, calada; o clique
        // foi de quem quer ver, então o progresso passa a aparecer.
        if (achou?.nova && opcoes?.atualizarSozinho) await motor.baixar(achou.versao).catch(() => {});
        if (achou?.ok && !achou.nova) verificado = true;
      } else {
        await conferir();
        falhou = !verificado;
      }
      procurar.disabled = false;
      pintarSecao();
      if (falhou) estado.textContent = 'Não deu para procurar agora: o servidor não respondeu, ou ainda não distribui esta forma do aplicativo.';
    });
  }

  // Um pouco depois de a sala abrir: o que importa nos primeiros segundos é entrar na chamada.
  // Fora dela, logo.
  setTimeout(conferir, NA_SALA ? 4000 : 1500);

  window.NexoAtualizacao = { situacao: () => situacao, conferir };
})();
