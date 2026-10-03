/* O aplicativo Android, visto de dentro da sala.
 *
 * O Nexo para Android (android/, docs/android.md) é a mesma sala numa WebView, como o aplicativo
 * de mesa é a mesma sala numa janela do Electron. O que ele acrescenta ao navegador do celular é
 * a chamada continuar com a tela apagada e com outro aplicativo na frente: um serviço em primeiro
 * plano, com a notificação "Na sala #…", segura o microfone e o som.
 *
 * Este arquivo é a ponte do lado da página, e ela é estreita de propósito. A página conta se está
 * numa chamada, em qual sala e com o microfone aberto (sala.js, `atualizarModoSegundoPlano`); o
 * aplicativo devolve os botões da notificação da chamada (ligar ou desligar o microfone, sair da
 * sala), o toque nas outras notificações, e o estado da atualização (ver "O atualizador").
 *
 * `nexoAndroid` é posto pelo aplicativo (WebViewCompat.addWebMessageListener) SÓ na origem que a
 * pessoa escolheu: uma página de outro lugar não a enxerga. A versão vem do user agent
 * ("NexoAndroid/1.0.0"), que existe desde a primeira linha -- é com ela que a sala avisa que há
 * um APK mais novo (atualizacao-app.js).
 *
 * As notificações de amigos (mensagem direta, convite para sala, pedido de amizade, pedido
 * aceito) também passam por aqui: a página já recebe tudo isso pelo socket de amigos (social.js),
 * e com o Nexo fora da tela ela pede ao aplicativo uma notificação de verdade em vez do aviso no
 * canto, que ninguém veria. Tocar na notificação volta como 'aviso-tocado', e quem abre a conversa
 * é a página (inicio.js, social-sala.js). Com a página parada -- o Android congela o aplicativo que
 * saiu da tela --, quem pergunta é o próprio aplicativo, a cada 15 minutos (AvisosJob.java).
 */
(() => {
  const versao = /\bNexoAndroid\/(\d{1,4}\.\d{1,4}\.\d{1,4})\b/.exec(navigator.userAgent)?.[1] || null;
  if (!versao) return;
  // A ponte é da página de cima. O aplicativo põe `nexoAndroid` em todo quadro da origem dele, e o
  // início, quando abre por cima da sala (inicio-na-sala.js), é um quadro. O aplicativo só ouve o
  // quadro principal (MainActivity.aoMensagemDaSala descarta o resto), então a ponte ligada ali
  // falaria sozinha -- e a página de dentro, que tem o mesmo socket de amigos da de cima, montaria
  // notificações que ninguém recebe. A sala cuida de tudo isso por ela.
  try { if (window.parent !== window) return; } catch (_) { return; }
  const ponte = window.nexoAndroid || null;
  const ouvintes = new Map();

  ponte?.addEventListener('message', evento => {
    let dados;
    try { dados = JSON.parse(String(evento.data)); } catch (_) { return; }
    const tipo = typeof dados?.tipo === 'string' ? dados.tipo : '';
    for (const ouvir of ouvintes.get(tipo) || []) {
      try { ouvir(dados); } catch (erro) { console.error('[android]', erro); }
    }
  });

  // O estado vai só quando muda: `atualizarModoSegundoPlano` roda a cada mudança da sala, e a
  // notificação não precisa ser refeita a cada câmera ligada.
  let ultimo = '';
  function chamada({ ativa, sala = '', microfone = false, ensurdecido = false }) {
    if (!ponte) return;
    const estado = { tipo: 'chamada', ativa: Boolean(ativa), sala: String(sala || '').slice(0, 40), microfone: Boolean(microfone), ensurdecido: Boolean(ensurdecido) };
    const texto = JSON.stringify(estado);
    if (texto === ultimo) return;
    ultimo = texto;
    try { ponte.postMessage(texto); } catch (_) { /* o aplicativo saiu de cena */ }
  }

  function mandar(dados) {
    if (!ponte) return;
    try { ponte.postMessage(JSON.stringify(dados)); } catch (_) { /* o aplicativo saiu de cena */ }
  }

  // O início aberto por cima da sala (inicio-na-sala.js): com ele aberto, o "voltar" do aparelho o
  // fecha -- 'voltar-camada' --, em vez de mandar a chamada para o fundo. Só do APK que entende
  // este pedido; um mais velho ignora o tipo desconhecido e segue guardando o Nexo.
  function camada(aberta) {
    mandar({ tipo: 'camada', aberta: Boolean(aberta) });
  }

  // ---------- O atualizador (android/…/Atualizador.java) ----------
  // Só do APK 1.1.0 em diante: este arquivo vem do servidor, e um APK mais velho não entenderia
  // os pedidos -- para ele, atualizacao-app.js continua abrindo o .apk no navegador.
  const ATUALIZADOR_DESDE = [1, 1, 0];
  const temAtualizador = (() => {
    const partes = versao.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (partes[i] !== ATUALIZADOR_DESDE[i]) return partes[i] > ATUALIZADOR_DESDE[i];
    return true;
  })();
  const ESTADOS_DA_ATUALIZACAO = new Set(['pedido', 'baixando', 'pronto', 'permissao', 'instalando', 'cancelado', 'falhou']);
  let estadoDaAtualizacao = null;
  const aoMudarAtualizacao = [];
  const esperandoEstado = [];
  // O que vem do aplicativo passa por aqui antes de chegar à tela: números são números, e o
  // motivo de uma falha é texto curto.
  function limparAtualizacao(dados) {
    if (!ESTADOS_DA_ATUALIZACAO.has(dados?.estado)) return null;
    const versaoNova = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(dados.versao || '')) ? String(dados.versao) : '';
    const numero = valor => (Number.isFinite(Number(valor)) && Number(valor) > 0 ? Number(valor) : 0);
    return { estado: dados.estado, versao: versaoNova, recebidos: numero(dados.recebidos), total: numero(dados.total), motivo: String(dados.motivo || '').slice(0, 240) };
  }
  if (!ouvintes.has('atualizacao')) ouvintes.set('atualizacao', []);
  ouvintes.get('atualizacao').push(dados => {
    estadoDaAtualizacao = limparAtualizacao(dados);
    for (const responder of esperandoEstado.splice(0)) responder(estadoDaAtualizacao);
    if (estadoDaAtualizacao) for (const avisar of aoMudarAtualizacao) avisar(estadoDaAtualizacao);
  });
  const atualizacao = ponte && temAtualizador ? Object.freeze({
    // `url` é o /downloads/Nexo.apk que o servidor anuncia; o aplicativo só baixa da origem dele.
    baixar(versaoNova, url) { mandar({ tipo: 'atualizar', versao: String(versaoNova || ''), url: String(url || '') }); return Promise.resolve({ ok: true }); },
    cancelar() { mandar({ tipo: 'atualizacao-cancelar' }); return Promise.resolve(true); },
    // Instalar (ou, sem a permissão, abrir as configurações dela).
    abrir() { mandar({ tipo: 'atualizacao-instalar' }); return Promise.resolve(true); },
    estado() {
      return new Promise(resolve => {
        esperandoEstado.push(resolve);
        mandar({ tipo: 'atualizacao-estado' });
        setTimeout(() => resolve(estadoDaAtualizacao), 1500);
      });
    },
    aoProgresso(avisar) { aoMudarAtualizacao.push(avisar); }
  }) : null;

  window.NexoAndroid = Object.freeze({
    versao,
    chamada,
    camada,
    atualizacao,
    // 'alternar-microfone' e 'sair', dos botões da notificação da chamada; 'aviso-tocado', das
    // notificações ({ acao: 'abrir' | 'entrar' | 'aceitar' | 'pedidos' | 'atualizar', com, sala, codigo });
    // 'voltar-camada', do gesto de voltar do aparelho com a camada do início aberta.
    ao(tipo, ouvir) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
      ouvintes.get(tipo).push(ouvir);
    }
  });

  // ---------- As notificações de amigos ----------
  // Ligadas depois de todos os scripts: social.js vem depois deste arquivo na sala.
  const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
  const salaAberta = (/^\/([^/]+)\/sala\/?$/.exec(window.location.pathname) || [])[1] || null;
  const curto = (texto, n) => { const t = String(texto || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  function ligarAvisos() {
    const S = window.NexoSocial;
    if (!ponte || !S) return;
    // Só com o Nexo fora da tela: com ele à vista, o aviso no canto já basta.
    const escondida = () => document.visibilityState !== 'visible';
    // "Não incomodar" segura as mensagens; convite e amizade passam, porque pedem uma decisão.
    const naoIncomodar = () => S.estado.minha?.escolhido === 'ocupado';
    const lido = chave => mandar({ tipo: 'aviso-lido', chave });
    let recebidos = null;
    let enviados = null;

    function avisarMensagem(com, mensagem) {
      if (!mensagem || mensagem.de === S.estado.eu) return;
      const nome = curto(S.nomeDe(com), 60);
      if (mensagem.tipo === 'convite') {
        if (!CODIGO_DE_SALA.test(mensagem.sala || '') || mensagem.sala === salaAberta) return;
        mandar({ tipo: 'aviso', categoria: 'convite', com, nome, sala: mensagem.sala, em: mensagem.em || Date.now() });
        return;
      }
      if (naoIncomodar()) return;
      mandar({ tipo: 'aviso', categoria: 'mensagem', com, nome, texto: curto(mensagem.texto, 200), imagem: Boolean(mensagem.imagem), em: mensagem.em || Date.now() });
    }

    S.on('pronto', () => {
      // A conta está aqui: o aplicativo passa a perguntar sozinho quando a página parar.
      mandar({ tipo: 'avisos', ligado: true });
      for (const c of S.conversas()) {
        // Lida em outro lugar (no computador, noutra aba) enquanto esta página estava parada.
        if (!c.naoLidas) lido(`conversa:${c.com}`);
        // Chegou com a página parada e o socket caído: o evento não vem, o resumo sim. O aplicativo
        // descarta o que já avisou.
        else if (escondida()) avisarMensagem(c.com, c.ultima);
      }
    });
    S.on('sem-conta', () => mandar({ tipo: 'avisos', ligado: false }));
    S.on('mensagem', ({ com, mensagem }) => {
      // Respondi (aqui ou noutro aparelho): a conversa está em dia.
      if (mensagem.de === S.estado.eu) { lido(`conversa:${com}`); return; }
      if (escondida()) avisarMensagem(com, mensagem);
    });
    S.on('lida', ({ com, minha }) => { if (minha) lido(`conversa:${com}`); });
    S.on('amigos', listas => {
      const agoraRecebidos = new Map(listas.recebidos.map(p => [p.codigo, p]));
      const amigos = new Set(listas.amigos.map(p => p.codigo));
      // A primeira lista é a que já existia ao abrir: não avisa (o aplicativo avisa as que chegaram
      // com a página parada).
      if (recebidos) {
        for (const [codigo, p] of agoraRecebidos) {
          if (!recebidos.has(codigo) && escondida()) mandar({ tipo: 'aviso', categoria: 'pedido', codigo, nome: curto(p.apelido, 60) });
        }
        for (const codigo of enviados.keys()) {
          if (amigos.has(codigo) && escondida()) mandar({ tipo: 'aviso', categoria: 'aceito', codigo, nome: curto(enviados.get(codigo).apelido, 60) });
        }
      }
      // Os pedidos que ainda esperam, sempre, e não só a diferença: um pedido aceito no computador
      // com esta página parada também tira a notificação dele daqui.
      mandar({ tipo: 'pedidos', codigos: [...agoraRecebidos.keys()] });
      recebidos = agoraRecebidos;
      enviados = new Map(listas.enviados.map(p => [p.codigo, p]));
    });
    // Voltar ao Nexo pelo ícone (e não pela notificação) não apaga nada: as notificações das
    // conversas somem quando a conversa é lida, como no computador.
  }
  document.addEventListener('DOMContentLoaded', ligarAvisos);
})();
