/* O aplicativo Android, visto de dentro da sala.
 *
 * O Nexo para Android (android/, docs/android.md) é a mesma sala numa WebView, como o aplicativo
 * de mesa é a mesma sala numa janela do Electron. O que ele acrescenta ao navegador do celular é
 * a chamada continuar com a tela apagada e com outro aplicativo na frente: um serviço em primeiro
 * plano, com a notificação "Na sala #…", segura o microfone e o som.
 *
 * Este arquivo é a ponte do lado da página, e ela é estreita de propósito. A página conta se está
 * numa chamada, em qual sala e com o microfone aberto (sala.js, `atualizarModoSegundoPlano`); o
 * aplicativo devolve só dois pedidos, vindos dos botões da notificação: ligar ou desligar o
 * microfone, e sair da sala.
 *
 * `nexoAndroid` é posto pelo aplicativo (WebViewCompat.addWebMessageListener) SÓ na origem que a
 * pessoa escolheu: uma página de outro lugar não a enxerga. A versão vem do user agent
 * ("NexoAndroid/1.0.0"), que existe desde a primeira linha -- é com ela que a sala avisa que há
 * um APK mais novo (atualizacao-app.js).
 */
(() => {
  const versao = /\bNexoAndroid\/(\d{1,4}\.\d{1,4}\.\d{1,4})\b/.exec(navigator.userAgent)?.[1] || null;
  if (!versao) return;
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

  window.NexoAndroid = Object.freeze({
    versao,
    chamada,
    // 'alternar-microfone' e 'sair', dos botões da notificação.
    ao(tipo, ouvir) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
      ouvintes.get(tipo).push(ouvir);
    }
  });
})();
