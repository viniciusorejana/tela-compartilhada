/* As notificações do Nexo fora da página: as do computador (a API Notification, no navegador e no aplicativo de mesa)
 * e as do celular (o aplicativo Android, por app-android.js). Um lugar só decide se uma notificação pode sair, para a
 * escolha da pessoa valer igual em todo canto -- antes, a menção e o pedido para entrar notificavam sempre que o
 * navegador tinha a permissão, e só a tela compartilhada tinha interruptor.
 *
 * As escolhas (Configurações → Sons → Avisos e notificações) ficam neste aparelho, e não na conta: quem quer o celular
 * quieto quase sempre quer o computador avisando, e o contrário.
 *
 *   computador  o interruptor geral do computador. Sem escolha guardada, ligado só no aplicativo de mesa (lá a
 *               permissão do sistema vem dada, e as menções já notificavam); no navegador, desligado até a pessoa
 *               ligar, que é quando o navegador pede a permissão.
 *   celular     o interruptor geral do aplicativo Android: desligado, a página não manda aviso nenhum e o aplicativo
 *               para de perguntar sozinho a cada 15 minutos (AvisosJob).
 *   mencao, mensagem, tela, entrada   o que avisa, nos dois. `mensagem` são as mensagens diretas, os convites e os
 *               pedidos de amizade.
 *
 * "Não incomodar" cala tudo, menos o que pede uma decisão de quem recebe (o pedido para entrar na sala).
 */
(function (root) {
  const CHAVE = 'notificacoes';
  const CATEGORIAS = ['mencao', 'mensagem', 'tela', 'entrada'];
  const PASSAM_NO_NAO_INCOMODAR = new Set(['entrada']);
  const $ = id => root.document.getElementById(id);

  const temApi = () => 'Notification' in root;
  const permitido = () => temApi() && root.Notification.permission === 'granted';
  const noAplicativoDeMesa = () => Boolean(root.appNativo);
  const noAndroid = () => Boolean(root.NexoAndroid);

  function ler() {
    const guardado = root.Preferencias?.ler(CHAVE, null) || {};
    // Quem ligou "Avisos do sistema" antes desta chave existir continua com ele ligado.
    const antigo = root.Preferencias?.ler('avisosVisuais', null)?.sistema;
    return {
      computador: typeof guardado.computador === 'boolean' ? guardado.computador : antigo === true || noAplicativoDeMesa(),
      celular: guardado.celular !== false,
      ...Object.fromEntries(CATEGORIAS.map(c => [c, guardado[c] !== false]))
    };
  }

  // Só o que foge do padrão fica guardado; `computador` fica sempre, porque o padrão dele depende de onde se abre.
  function gravar(parte) {
    const novas = { ...ler(), ...parte };
    const guardar = { computador: novas.computador };
    if (!novas.celular) guardar.celular = false;
    for (const c of CATEGORIAS) if (!novas[c]) guardar[c] = false;
    root.Preferencias?.gravar(CHAVE, guardar);
    for (const avisar of ouvintes) { try { avisar(novas); } catch (_) { /* um ouvinte não derruba os outros */ } }
    return novas;
  }
  const ouvintes = new Set();
  const aoMudar = avisar => { ouvintes.add(avisar); return () => ouvintes.delete(avisar); };

  const naoIncomodar = () => Boolean(root.NexoSocial?.naoIncomodar?.());
  const calada = categoria => naoIncomodar() && !PASSAM_NO_NAO_INCOMODAR.has(categoria);

  // Pode sair uma notificação do computador desta categoria agora? Quem chama decide o "quando" (a janela escondida).
  function pode(categoria) {
    const p = ler();
    return p.computador && p[categoria] !== false && permitido() && !calada(categoria);
  }

  function mostrar(categoria, titulo, { corpo = '', tag, silenciosa = false, aoClicar } = {}) {
    if (!pode(categoria)) return null;
    try {
      const notificacao = new root.Notification(titulo, { body: corpo, tag, silent: silenciosa });
      notificacao.onclick = () => { root.focus(); notificacao.close(); aoClicar?.(); };
      return notificacao;
    } catch (_) { return null; }   // o sistema recusou; o aviso dentro da página continua
  }

  // O celular (app-android.js): o interruptor geral e, com a categoria, a escolha dela.
  function celular(categoria) {
    const p = ler();
    return p.celular && (!categoria || p[categoria] !== false);
  }

  // ---------- Configurações → Sons → Avisos e notificações ----------
  function ligarConfiguracoes() {
    const computador = $('avisosSistema');
    if (!computador) return;
    const dica = $('avisosSistemaDica');
    const textoPadrao = dica.textContent;
    const linhaComputador = computador.closest('.toggle-line');
    const celularChave = $('notifCelular');
    const pintar = () => {
      const p = ler();
      computador.checked = p.computador && (permitido() || noAplicativoDeMesa());
      if (celularChave) celularChave.checked = p.celular;
      for (const c of CATEGORIAS) { const caixa = $(`notif-${c}`); if (caixa) caixa.checked = p[c]; }
    };
    // No Android a notificação é a do aplicativo, e o WebView não tem a API: a linha do computador sai, e entra a do
    // celular. No navegador e no aplicativo de mesa, o contrário.
    if (noAndroid()) {
      linhaComputador.hidden = true;
      if (celularChave) celularChave.closest('.toggle-line').hidden = false;
    } else if (!temApi()) {
      computador.disabled = true;
      dica.textContent = 'Este navegador não mostra notificações do sistema. O aviso no canto da sala continua.';
    } else if (root.Notification.permission === 'denied') {
      dica.textContent = 'O navegador bloqueou as notificações deste site. Libere nas configurações do site para ligar.';
    }
    pintar();

    computador.addEventListener('change', async () => {
      if (!computador.checked) { gravar({ computador: false }); dica.textContent = textoPadrao; return; }
      // O pedido de permissão só vale com um gesto: o clique no interruptor é ele.
      let permissao = temApi() ? root.Notification.permission : 'denied';
      if (permissao === 'default') {
        try { permissao = await root.Notification.requestPermission(); } catch (_) { permissao = 'denied'; }
      }
      if (permissao !== 'granted') {
        computador.checked = false;
        gravar({ computador: false });
        dica.textContent = permissao === 'denied'
          ? 'O navegador não deu a permissão. Libere as notificações nas configurações do site e tente de novo.'
          : textoPadrao;
        return;
      }
      gravar({ computador: true });
      dica.textContent = textoPadrao;
    });
    celularChave?.addEventListener('change', () => gravar({ celular: celularChave.checked }));
    for (const c of CATEGORIAS) $(`notif-${c}`)?.addEventListener('change', evento => gravar({ [c]: evento.target.checked }));
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', ligarConfiguracoes);
  else ligarConfiguracoes();

  root.NexoNotificacoes = { ler, gravar, aoMudar, pode, mostrar, celular, permitido, CATEGORIAS };
})(window);
