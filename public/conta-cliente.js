/* A conta dentro da sala: quem está logado, e os ajustes que seguem a pessoa.
 *
 * Os ajustes sobem sozinhos, dois segundos depois da última mudança. Gravar a cada clique
 * seria uma escrita no banco por clique; esperar a pessoa parar de mexer junta tudo numa só.
 * Sair da página antes dos dois segundos não perde nada: o `pagehide` manda o que ficou.
 */
(() => {
  let estado = { conta: null, perfil: null, csrf: '' };
  let timer = null;
  let pendente = false;

  const pronto = fetch('/api/conta/eu', { credentials: 'same-origin' })
    .then(resposta => (resposta.ok ? resposta.json() : { conta: null }))
    .catch(() => ({ conta: null }))
    .then(dados => {
      estado = { conta: dados.conta || null, perfil: dados.perfil || null, csrf: dados.csrf || '', planosLigados: dados.planosLigados !== false };
      if (!estado.conta) return estado;
      // O que a conta tem vale; o que ela ainda não tem fica como está neste navegador -- e
      // sobe, para que o primeiro aparelho em que a pessoa entra ensine os outros.
      const doServidor = estado.perfil?.ajustes || {};
      window.Preferencias?.aplicarAjustesDaConta(doServidor);
      const locais = window.Preferencias?.ajustesSincronizaveis() || {};
      if (Object.keys(locais).some(nome => !(nome in doServidor))) enviarDepois();
      window.Preferencias?.aoMudarAjuste(enviarDepois);
      return estado;
    });

  function enviarDepois() {
    if (!estado.conta) return;
    pendente = true;
    clearTimeout(timer);
    timer = setTimeout(() => enviar(false), 2000);
  }

  function enviar(saindo) {
    if (!pendente || !estado.conta) return;
    pendente = false;
    clearTimeout(timer);
    const corpo = JSON.stringify({ ajustes: window.Preferencias?.ajustesSincronizaveis() || {} });
    // `keepalive` deixa o pedido terminar mesmo com a página indo embora.
    fetch('/api/conta/ajustes', {
      method: 'PUT', credentials: 'same-origin', keepalive: saindo,
      headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': estado.csrf }, body: corpo
    }).catch(() => { /* Continua guardado neste navegador; sobe na próxima mudança. */ });
  }
  window.addEventListener('pagehide', () => enviar(true));

  // `atualizar` recebe o que o servidor devolveu ao salvar o perfil de dentro da sala: a
  // próxima abertura do editor já parte do perfil novo.
  window.NexoConta = { pronto, atual: () => estado, atualizar: novo => { estado = { ...estado, ...novo }; } };
})();
