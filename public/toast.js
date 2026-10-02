/* Avisos que chegam num canto, dizem o que está acontecendo e vão embora sozinhos.
 *
 * Existe por causa do download do aplicativo: noventa megabytes descendo sem nada na tela
 * pareciam um clique que não funcionou, e a pessoa clicava de novo -- e baixava duas vezes.
 * Um toast com a barra andando responde "está vindo, falta tanto" sem tirar ninguém do que
 * estava fazendo, inclusive no meio de uma chamada.
 *
 * Um aviso é um objeto vivo: quem o cria o atualiza (progresso, texto, ações) e o fecha. O
 * texto entra sempre como texto -- nomes de arquivo e mensagens do servidor nunca viram HTML.
 */
(function (root) {
  const DESENHOS = {
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    atualizar: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
    ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    erro: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    // Os de amigos (social.js): mensagem direta, convite para uma sala, pedido de amizade e
    // conquista ganha.
    mensagem: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>',
    convite: '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16 4-4-4-4M14 12H4"/>',
    amigo: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
    conquista: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'
  };
  const icone = nome => `<svg viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[nome] || DESENHOS.download}</svg>`;

  let pilha = null;
  function garantirPilha() {
    if (pilha?.isConnected) return pilha;
    pilha = document.createElement('div');
    pilha.className = 'nexo-toasts';
    pilha.setAttribute('role', 'region');
    pilha.setAttribute('aria-label', 'Avisos');
    document.body.append(pilha);
    return pilha;
  }

  function mostrar(opcoes = {}) {
    const el = document.createElement('div');
    el.className = 'nexo-toast';
    // `status` e não `alert`: um progresso que muda dez vezes por segundo não pode interromper
    // o leitor de tela a cada décimo. Ele lê quando a frase muda de sentido.
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="nexo-toast-icone"></span><div class="nexo-toast-texto"><strong></strong><small></small></div><button type="button" class="nexo-toast-fechar"></button><div class="nexo-toast-acoes" hidden></div><div class="nexo-toast-barra" hidden><i></i></div>';
    const [elIcone, elTitulo, elDetalhe, elFechar, elAcoes, elBarra] = ['.nexo-toast-icone', 'strong', 'small', '.nexo-toast-fechar', '.nexo-toast-acoes', '.nexo-toast-barra'].map(s => el.querySelector(s));
    elFechar.innerHTML = icone('fechar');
    let estado = {};
    let timer = null;
    let fechado = false;

    function fechar() {
      if (fechado) return;
      fechado = true;
      clearTimeout(timer);
      el.classList.add('saindo');
      // Sem animação (movimento reduzido, aba em segundo plano) o `animationend` não chega.
      const remover = () => el.remove();
      el.addEventListener('animationend', remover, { once: true });
      setTimeout(remover, 400);
      estado.aoFechar?.();
    }

    function atualizar(novo = {}) {
      if (fechado) return controle;
      estado = { ...estado, ...novo };
      el.dataset.tom = estado.tom || '';
      if ('icone' in novo || !elIcone.firstChild) elIcone.innerHTML = icone(estado.icone || 'download');
      elTitulo.textContent = estado.titulo || '';
      elDetalhe.textContent = estado.detalhe || '';
      elDetalhe.hidden = !estado.detalhe;
      // `null` é "sem medida": a barra anda sozinha, como quem diz que algo acontece sem saber
      // quanto falta. Um número é a fração feita.
      const temBarra = estado.progresso !== undefined && estado.progresso !== false;
      elBarra.hidden = !temBarra;
      elBarra.classList.toggle('indeterminada', temBarra && estado.progresso === null);
      if (temBarra && estado.progresso !== null) elBarra.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, estado.progresso)) * 1000) / 10}%`;
      // O X muda de sentido: enquanto algo acontece, ele cancela; depois, só tira o aviso.
      const rotulo = estado.aoCancelar ? (estado.rotuloCancelar || 'Cancelar') : 'Fechar aviso';
      elFechar.title = rotulo;
      elFechar.setAttribute('aria-label', rotulo);
      if ('acoes' in novo) {
        elAcoes.replaceChildren(...(estado.acoes || []).map(acao => {
          const botao = document.createElement('button');
          botao.type = 'button';
          botao.className = acao.principal ? 'principal' : '';
          botao.textContent = acao.rotulo;
          botao.onclick = () => { acao.fazer?.(controle); if (acao.fecha !== false) fechar(); };
          return botao;
        }));
        elAcoes.hidden = !elAcoes.childElementCount;
      }
      clearTimeout(timer);
      if (estado.fecharEm) timer = setTimeout(fechar, estado.fecharEm);
      return controle;
    }

    elFechar.onclick = () => {
      const cancelar = estado.aoCancelar;
      if (cancelar) { estado.aoCancelar = null; cancelar(controle); return; }
      fechar();
    };
    // Passar o mouse segura o aviso na tela: ninguém lê uma frase que some debaixo do cursor.
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { if (estado.fecharEm && !fechado) timer = setTimeout(fechar, Math.min(estado.fecharEm, 3000)); });

    const controle = { atualizar, fechar, elemento: el, get fechado() { return fechado; } };
    atualizar(opcoes);
    garantirPilha().append(el);
    return controle;
  }

  // Tamanhos e ritmo do jeito que se lê: "38,2 de 91,0 MB", "4,1 MB/s", "falta ~12 s".
  const megabytes = bytes => (bytes / (1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function faltaLegivel(segundos) {
    if (!Number.isFinite(segundos) || segundos <= 0) return '';
    if (segundos < 60) return `falta ~${Math.max(1, Math.round(segundos))} s`;
    const minutos = Math.round(segundos / 60);
    return minutos < 60 ? `falta ~${minutos} min` : `falta ~${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
  }
  function descreverProgresso({ recebidos, total, bytesPorSegundo }) {
    const partes = [total ? `${megabytes(recebidos)} de ${megabytes(total)} MB` : `${megabytes(recebidos)} MB`];
    if (bytesPorSegundo > 0) partes.push(`${megabytes(bytesPorSegundo)} MB/s`);
    if (total && bytesPorSegundo > 0) partes.push(faltaLegivel((total - recebidos) / bytesPorSegundo));
    return partes.filter(Boolean).join(' · ');
  }

  // A velocidade é uma média que esquece devagar: a leitura instantânea pula entre 2 e 9 MB/s
  // a cada pedaço, e o "falta" junto com ela.
  function medidorDeVelocidade() {
    let ultimo = null;
    let media = 0;
    return recebidos => {
      const agora = performance.now();
      if (ultimo && agora - ultimo.em > 250) {
        const instantanea = (recebidos - ultimo.recebidos) / ((agora - ultimo.em) / 1000);
        media = media ? media * 0.75 + instantanea * 0.25 : instantanea;
        ultimo = { em: agora, recebidos };
      } else if (!ultimo) ultimo = { em: agora, recebidos };
      return media;
    };
  }

  root.NexoToast = { mostrar, descreverProgresso, medidorDeVelocidade, megabytes };
})(window);
