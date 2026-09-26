/* Quem está vendo cada tela, como no Discord.
 *
 * Quem transmite não tinha como saber se alguém estava olhando -- e é justamente o que faz
 * alguém dizer "olha aqui" ou desistir de explicar. O servidor não sabe quem recebe qual tela
 * (isso é entre a página e o servidor de mídia), então cada página conta a ele o que está
 * vendo, e ele devolve o placar para a sala inteira (espectadores.js, na raiz).
 *
 * A página manda sempre a LISTA inteira do que está vendo, e só quando ela muda. É o transporte
 * que sabe disso -- ele liga uma tela no clique, mas também a retoma sozinho depois de uma
 * queda e a larga quando ela some por tempo demais --, então a conferência roda a cada mudança
 * de estado dele, e não só no botão "Assistir".
 *
 * O selo é discreto de propósito: um olho, um número e até três rostos, no canto da tela. Os
 * nomes aparecem ao passar o mouse ou focar, e não ocupam o vídeo o tempo todo.
 *
 * Usa as globais de sala.js (peers, socket, myId, nomeDe, pintarAvatar, perfilDe), como os
 * outros scripts da sala.
 */
(() => {
  // Identidade do dono da tela -> identidades de quem está vendo, na ordem do servidor.
  const porTela = new Map();
  // O que o servidor tem desta página. `null` até a entrada na sala terminar: antes disso ele
  // ignoraria a lista, e ela ficaria anotada aqui como enviada sem ter chegado.
  let enviada = null;
  const ROSTOS_A_MOSTRAR = 3;

  const identidadeDe = id => (id === 'self' ? myId : id);

  function sincronizar() {
    if (enviada === null || !socket?.connected) return;
    const telas = [];
    peers.forEach((par, id) => { if (id !== 'self' && par.assistindo && par.state?.screen) telas.push(id); });
    telas.sort();
    const chave = telas.join('\n');
    if (chave === enviada) return;
    enviada = chave;
    socket.emit('assistindo', { telas });
  }

  // A resposta do `join-room`: o placar de quem já estava vendo alguma coisa. A página acabou
  // de entrar, então o servidor não tem lista nenhuma dela -- se ela já estava vendo algo (uma
  // oscilação do socket, com a mídia de pé), a lista vai agora.
  function aoEntrar(placar) {
    porTela.clear();
    for (const [dono, lista] of Object.entries(placar || {})) if (Array.isArray(lista) && lista.length) porTela.set(dono, lista);
    enviada = '';
    sincronizar();
    repintar();
  }

  function aoCair() { enviada = null; }

  function atualizar({ dono, espectadores } = {}) {
    if (typeof dono !== 'string') return;
    if (Array.isArray(espectadores) && espectadores.length) porTela.set(dono, espectadores);
    else porTela.delete(dono);
    repintar();
  }

  function nomeDaIdentidade(identidade) {
    return identidade === myId ? 'Você' : nomeDe(identidade);
  }

  function rosto(identidade, classe) {
    const el = document.createElement('span');
    el.className = classe;
    const id = identidade === myId ? 'self' : identidade;
    pintarAvatar(el, id === 'self' ? myName : nomeDe(id), perfilDe(id));
    return el;
  }

  const OLHO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

  // Desenha o selo dentro de `el` para a tela de `id` ('self' é a própria). O conteúdo só é
  // refeito quando muda: o palco repinta a cada troca de estado, e reconstruir o selo toda vez
  // fecharia a lista de nomes no meio de uma leitura.
  function pintar(el, id) {
    if (!el) return;
    el.dataset.tela = id || '';
    const lista = id ? porTela.get(identidadeDe(id)) || [] : [];
    el.hidden = !lista.length;
    const nomes = lista.map(nomeDaIdentidade);
    const assinatura = lista.map((identidade, i) => `${identidade}:${nomes[i]}`).join('|');
    if (el.dataset.assinatura === assinatura) return;
    el.dataset.assinatura = assinatura;
    el.replaceChildren();
    if (!lista.length) return;

    const quantos = lista.length === 1 ? '1 pessoa vendo' : `${lista.length} pessoas vendo`;
    el.setAttribute('aria-label', `${quantos}: ${nomes.join(', ')}`);
    // No quadradinho a lista de nomes seria cortada pela borda: lá eles vão no título.
    if (el.classList.contains('espectadores-mini')) el.title = `${quantos}: ${nomes.join(', ')}`;

    const rostos = document.createElement('span');
    rostos.className = 'espectadores-rostos';
    lista.slice(0, ROSTOS_A_MOSTRAR).forEach(identidade => rostos.append(rosto(identidade, 'espectadores-rosto')));
    const conta = document.createElement('span');
    conta.className = 'espectadores-conta';
    conta.innerHTML = OLHO;
    conta.append(String(lista.length));

    // A lista de nomes, para quem passa o mouse ou foca. Um grupo e não um diálogo: é um
    // rótulo que aparece, e a sala trata todo dialog como modal (room-ui.js).
    const detalhe = document.createElement('span');
    detalhe.className = 'espectadores-lista';
    detalhe.setAttribute('role', 'group');
    detalhe.setAttribute('aria-hidden', 'true');
    const titulo = document.createElement('span');
    titulo.className = 'espectadores-titulo';
    titulo.textContent = 'Vendo agora';
    detalhe.append(titulo);
    lista.forEach((identidade, i) => {
      const linha = document.createElement('span');
      linha.className = 'espectadores-linha';
      const nome = document.createElement('span');
      nome.textContent = nomes[i];
      linha.append(rosto(identidade, 'espectadores-rosto'), nome);
      detalhe.append(linha);
    });
    el.append(rostos, conta, detalhe);
  }

  function repintar() {
    document.querySelectorAll('.espectadores[data-tela]').forEach(el => { delete el.dataset.assinatura; pintar(el, el.dataset.tela); });
  }

  // Um toque no selo mostra os nomes no celular, onde não há "passar o mouse". O clique não
  // pode chegar ao quadradinho de baixo: lá ele quer dizer "destacar esta tela".
  document.addEventListener('click', evento => {
    const selo = evento.target.closest?.('.espectadores');
    document.querySelectorAll('.espectadores.aberto').forEach(el => { if (el !== selo) el.classList.remove('aberto'); });
    if (!selo) return;
    evento.stopPropagation();
    selo.classList.toggle('aberto');
  }, true);

  window.NexoEspectadores = { sincronizar, aoEntrar, aoCair, atualizar, pintar, repintar, de: id => [...(porTela.get(identidadeDe(id)) || [])] };
})();
