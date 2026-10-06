/* O aviso visual de que alguém começou algo na sala: compartilhou a tela, pôs uma música.
 *
 * Os sons já avisavam (sons.js: "tela ao vivo" e companhia), mas quem não está olhando para o palco não
 * via nada, e nem sempre ouve: o chat em foco esconde o palco, o início aberto por cima da sala (a camada)
 * o cobre, e com a janela em outra aba ou atrás de um jogo ninguém repara no quadradinho novo. Este
 * módulo decide SE e COMO avisar, pelo que a pessoa está vendo agora:
 *
 *   - palco à vista (janela visível, com foco, e nada por cima dele): não avisa. O quadradinho novo, com
 *     o convite para assistir, e o som já são o aviso, e um canto cheio de balões por cima do que se
 *     assiste seria ruído;
 *   - palco coberto (chat em foco, camada do início, gaveta do chat ou da música aberta): um aviso no
 *     canto, com "Assistir" -- que traz o palco de volta e já pede a tela;
 *   - janela em segundo plano (outra aba, minimizada, sem foco): o título da aba ganha um ponto (some
 *     quando a pessoa volta) e, com a permissão dada em Configurações → Sons, uma notificação do sistema,
 *     sem som -- a sala já tocou o dela. Clicar nela traz a janela e o palco.
 *
 * "Não incomodar" cala a notificação do sistema (uma interrupção de fora da sala), e não o aviso no canto,
 * que é da chamada, como os sons dela. Tudo se desliga em Configurações → Sons → Avisos na tela.
 *
 * Quem avisa chama `NexoAtividade.anunciar` (sala.js, na tela; musica.js, na música) e `encerrar` quando a
 * atividade acaba antes de o aviso sumir.
 */
(function (root) {
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  const CHAVE = 'avisosVisuais';
  const PADRAO = { atividade: true, sistema: false };
  const MS_DO_AVISO = 12000;

  const lerPreferencias = () => ({ ...PADRAO, ...(root.Preferencias?.ler(CHAVE, null) || {}) });
  function gravarPreferencias(parte) {
    const novas = { ...lerPreferencias(), ...parte };
    // Só se guarda o que foge do padrão: igual a ele, a chave sai.
    root.Preferencias?.gravar(CHAVE, novas.atividade === PADRAO.atividade && novas.sistema === PADRAO.sistema ? null : novas);
    return novas;
  }

  // O que cada atividade diz. `titulo(quem)` e `acao` são o aviso; `sistema` diz se vale uma notificação do
  // sistema (a música não: ela se ouve, e uma notificação a mais por faixa seria insistência).
  // `palco` diz se a atividade está no palco (a tela): "Assistir" o traz de volta antes de pedi-la. A música
  // está no canal dela, e não no palco, então só a camada do início sai da frente.
  const TIPOS = {
    tela: { icone: 'tela', titulo: quem => `${quem} começou a compartilhar a tela`, acao: 'Assistir', sistema: true, palco: true, titulo_aba: quem => `${quem} compartilhou a tela` },
    musica: { icone: 'musica', titulo: quem => `${quem} pôs uma música`, acao: 'Abrir a música', sistema: false, palco: false }
  };

  // ---------- Onde está o que a pessoa vê ----------
  const larga = () => root.matchMedia('(min-width: 1101px)').matches;
  function palcoCoberto() {
    const app = doc.querySelector('.app');
    if (!app) return false;
    // A camada do início (inicio-na-sala.js) é uma página inteira por cima da sala.
    if (root.NexoInicioNaSala?.aberta?.()) return true;
    // O foco no chat ou na música esconde o palco e a plateia (sala.css, `.foco-chat`).
    if (app.classList.contains('foco-chat')) return true;
    // Até 1100 px o chat e a música são gavetas por cima do palco; no celular, a lateral também.
    if (!larga() && (doc.getElementById('chatPanel')?.classList.contains('aberto') || doc.getElementById('musicaPanel')?.classList.contains('aberto'))) return true;
    if (app.classList.contains('sidebar-open')) return true;
    return false;
  }
  const foraDeFoco = () => doc.hidden || !doc.hasFocus();
  // A música à vista: o canal dela é a coluna do chat (ou a gaveta) e está aberto. Quem está lendo o canal
  // vê a faixa mudar ali, e um aviso por cima dele repetiria o que ele já tem na frente.
  function musicaAVista() {
    const app = doc.querySelector('.app');
    if (!app?.classList.contains('painel-musica') || app.classList.contains('sem-chat') || foraDeFoco()) return false;
    return larga() || Boolean(doc.getElementById('musicaPanel')?.classList.contains('aberto')) || app.classList.contains('foco-chat');
  }

  // Traz o palco de volta: sai da camada, do foco no chat e das gavetas. É o que "Assistir" faz antes de
  // pedir a tela -- pedir a tela com o palco coberto seria assistir a uma imagem que ninguém vê.
  function trazerOPalco() {
    root.NexoInicioNaSala?.fechar?.();
    if (doc.querySelector('.app')?.classList.contains('foco-chat')) root.definirFocoChat?.(false);
    if (!larga()) {
      if (doc.getElementById('chatPanel')?.classList.contains('aberto')) root.fecharChat?.();
      if (doc.getElementById('musicaPanel')?.classList.contains('aberto')) root.NexoMusica?.fechar?.();
      doc.querySelector('.app')?.classList.remove('sidebar-open');
    }
  }

  // ---------- O título da aba ----------
  let tituloOriginal = null;
  function marcarTitulo(texto) {
    if (!doc.hidden) return;
    if (tituloOriginal === null) tituloOriginal = doc.title;
    doc.title = `● ${texto} · ${tituloOriginal}`;
  }
  function limparTitulo() {
    if (tituloOriginal === null) return;
    doc.title = tituloOriginal;
    tituloOriginal = null;
  }
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) limparTitulo(); });
  root.addEventListener('focus', limparTitulo);

  // ---------- O aviso no canto, e a notificação do sistema ----------
  const abertos = new Map();   // chave -> { toast, notificacao }
  function esquecer(chave) {
    const aberto = abertos.get(chave);
    if (!aberto) return;
    abertos.delete(chave);
    aberto.toast?.fechar();
    try { aberto.notificacao?.close(); } catch (_) { /* já fechada */ }
  }

  const naoIncomodar = () => Boolean(root.NexoSocial?.naoIncomodar?.());
  const sistemaPermitido = () => lerPreferencias().sistema && 'Notification' in root && root.Notification.permission === 'granted' && !naoIncomodar();

  // `chave`: identifica a atividade ("tela:<id>"), para avisar uma vez e encerrar com ela.
  // `assistir`: o que "Assistir" faz depois de trazer o palco; `sala`: o código, para a notificação do sistema.
  function anunciar({ tipo, chave, quem, detalhe = '', assistir = null, sala = '' }) {
    const descricao = TIPOS[tipo];
    if (!descricao || !chave || !lerPreferencias().atividade) return false;
    // O palco na frente de quem olha já é o aviso -- e o canal de música aberto, o da música.
    if (!foraDeFoco() && !palcoCoberto()) return false;
    if (tipo === 'musica' && musicaAVista()) return false;
    esquecer(chave);
    const nome = String(quem || 'Alguém').slice(0, 40);
    const agir = () => {
      if (descricao.palco) trazerOPalco(); else root.NexoInicioNaSala?.fechar?.();
      assistir?.();
    };
    const aberto = { toast: null, notificacao: null };

    if (!doc.hidden) {
      aberto.toast = root.NexoToast?.mostrar({
        icone: descricao.icone, titulo: descricao.titulo(nome), detalhe, fecharEm: MS_DO_AVISO,
        acoes: [{ rotulo: descricao.acao, principal: true, fazer: agir }]
      }) || null;
    }
    if (foraDeFoco()) {
      if (descricao.titulo_aba) marcarTitulo(descricao.titulo_aba(nome));
      if (descricao.sistema && sistemaPermitido()) {
        try {
          const notificacao = new root.Notification(descricao.titulo(nome), { body: `${sala ? `Sala ${sala} · ` : ''}${detalhe || 'Clique para assistir'}`, tag: `nexo-atividade-${chave}`, silent: true });
          notificacao.onclick = () => { root.focus(); notificacao.close(); agir(); };
          aberto.notificacao = notificacao;
        } catch (_) { /* o sistema recusou (um navegador sem o recurso); o título já avisou */ }
      }
    }
    abertos.set(chave, aberto);
    return true;
  }

  // A atividade acabou (a tela saiu do ar): o aviso que ainda esperava um clique não tem mais o que oferecer.
  const encerrar = chave => esquecer(chave);

  // ---------- Configurações → Sons → Avisos na tela ----------
  function ligarConfiguracoes() {
    const atividade = $('avisosAtividade');
    const sistema = $('avisosSistema');
    if (!atividade || !sistema) return;
    const dica = $('avisosSistemaDica');
    const textoPadrao = dica.textContent;
    const preferencias = lerPreferencias();
    atividade.checked = preferencias.atividade;
    // Sem a API (o WebView do Android, o Safari do iPhone) não há notificação do sistema para ligar.
    if (!('Notification' in root)) {
      sistema.disabled = true;
      dica.textContent = 'Este navegador não mostra notificações do sistema. O aviso no canto da sala continua.';
    } else {
      sistema.checked = preferencias.sistema && root.Notification.permission === 'granted';
      if (root.Notification.permission === 'denied') dica.textContent = 'O navegador bloqueou as notificações deste site. Libere nas configurações do site para ligar.';
    }
    atividade.addEventListener('change', () => { gravarPreferencias({ atividade: atividade.checked }); });
    sistema.addEventListener('change', async () => {
      if (!sistema.checked) { gravarPreferencias({ sistema: false }); dica.textContent = textoPadrao; return; }
      // O pedido só vale com um gesto: o clique no interruptor é ele.
      let permissao = root.Notification.permission;
      if (permissao === 'default') {
        try { permissao = await root.Notification.requestPermission(); } catch (_) { permissao = 'denied'; }
      }
      if (permissao !== 'granted') {
        sistema.checked = false;
        gravarPreferencias({ sistema: false });
        dica.textContent = permissao === 'denied'
          ? 'O navegador não deu a permissão. Libere as notificações nas configurações do site e tente de novo.'
          : textoPadrao;
        return;
      }
      gravarPreferencias({ sistema: true });
      dica.textContent = textoPadrao;
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ligarConfiguracoes); else ligarConfiguracoes();

  root.NexoAtividade = { anunciar, encerrar, palcoCoberto, trazerOPalco, preferencias: lerPreferencias };
})(window);
