/* O trilho das salas: a marca do Nexo, as salas recentes deste navegador e as novidades.
 *
 * É a mesma peça no início de quem tem conta (inicio.js) e dentro da sala (sala.js): na troca de
 * página ela fica onde estava, e a sala de agora aparece primeiro, com o anel verde
 * (docs/plano-continuidade.md). Aqui moram o que as duas páginas dividem -- ler as recentes, a sigla
 * e a cor de cada sala, a dica ao passar o mouse, o desenho --, e o que muda de uma para a outra
 * (o que um clique faz, o menu do botão direito) vem de quem monta.
 *
 * As recentes ficam no navegador, como sempre ficaram: de onde você entrou e quando não sobe para a
 * conta (docs/plano-contas.md, seção 5). Texto de sala entra sempre por `textContent`.
 */
(() => {
  const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
  const CHAVE = 'nexoRecentRooms';
  // A mesma chave e o mesmo teto que sala.js usa ao gravar a sala de agora.
  const MAXIMO = 12;

  function salasRecentes() {
    try {
      const lista = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(lista) ? lista.filter(c => typeof c === 'string' && CODIGO_DE_SALA.test(c)).slice(0, MAXIMO) : [];
    } catch (_) { return []; }
  }
  function esquecerSala(codigo) {
    try { localStorage.setItem(CHAVE, JSON.stringify(salasRecentes().filter(c => c !== codigo))); } catch (_) { /* vale só agora */ }
  }
  // "squad-da-noite" -> "SD"; um código de uma palavra só fica com as duas primeiras letras.
  function sigla(codigo) {
    const partes = codigo.split(/[-_]+/).filter(Boolean);
    return (partes.length > 1 ? partes[0][0] + partes[1][0] : codigo.replace(/[-_]/g, '').slice(0, 2)).toUpperCase();
  }
  const cor = codigo => (window.NexoPerfil ? window.NexoPerfil.corDoNome(codigo) : '');

  // ---------- A dica ao lado do quadrado ----------
  let dica = null;
  function esconderDica() { dica?.remove(); dica = null; }
  function mostrarDica(ancora, titulo, detalhe) {
    esconderDica();
    dica = document.createElement('div');
    dica.className = 'trilho-dica';
    const forte = document.createElement('strong');
    forte.textContent = titulo;
    dica.append(forte);
    if (detalhe) {
      const pequeno = document.createElement('small');
      pequeno.textContent = detalhe;
      dica.append(pequeno);
    }
    document.body.append(dica);
    const r = ancora.getBoundingClientRect();
    dica.style.left = `${Math.round(r.right + 10)}px`;
    dica.style.top = `${Math.round(r.top + r.height / 2 - dica.offsetHeight / 2)}px`;
  }

  // Desenha as salas dentro de `lugar`. `aqui` é a sala em que a pessoa está (vem primeiro, mesmo que
  // o navegador não a tenha guardado); `porSala` diz quem dos amigos está em cada uma; e quem monta
  // decide o clique (`aoEntrar`) e o menu do botão direito (`aoContexto`, opcional).
  //   aoEntrar(codigo)              o clique simples, sem tecla; os outros cliques seguem como link,
  //                                 a não ser com `interceptarTudo` (dentro de um quadro, nenhum clique
  //                                 pode navegar a página para fora dele)
  //   aoContexto(link, codigo, aqui)
  //   nomes(pessoas)                "Bia e Caio": para a dica e para o leitor de tela
  function pintar(lugar, { aqui = null, porSala = new Map(), nomes = () => '', aoEntrar = null, aoContexto = null, interceptarTudo = false } = {}) {
    const salas = salasRecentes();
    if (aqui) salas.splice(0, salas.length, aqui, ...salas.filter(codigo => codigo !== aqui));
    // Os quadrados são refeitos a cada mudança de presença: uma dica de um que já saiu da tela
    // ficaria sem o `mouseleave` que a tira.
    esconderDica();
    lugar.replaceChildren(...salas.map(codigo => {
      const ehAqui = codigo === aqui;
      const link = document.createElement('a');
      link.className = 'trilho-sala nx-social';
      link.textContent = sigla(codigo);
      link.href = `/${encodeURIComponent(codigo)}/sala`;
      link.style.setProperty('--cor-sala', cor(codigo));
      const gente = porSala.get(codigo)?.pessoas || [];
      link.setAttribute('aria-label', `Sala #${codigo}${ehAqui ? ', a sua sala agora' : ''}${gente.length ? `, com ${nomes(gente)}` : ''}`);
      if (ehAqui) { link.classList.add('aqui'); link.setAttribute('aria-current', 'true'); }
      // Só o clique simples é nosso; Ctrl, Shift e o botão do meio continuam abrindo noutra aba.
      if (aoEntrar) {
        link.addEventListener('click', evento => {
          if (!interceptarTudo && (evento.button || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey)) return;
          evento.preventDefault();
          esconderDica();
          aoEntrar(codigo);
        });
      }
      if (gente.length) {
        const marca = document.createElement('span');
        marca.className = 'trilho-sala-amigos';
        marca.textContent = String(gente.length);
        marca.setAttribute('aria-hidden', 'true');
        link.append(marca);
      }
      const detalhe = ehAqui
        ? (gente.length ? `Sua sala agora, com ${nomes(gente)}` : 'Sua sala agora')
        : gente.length ? `${nomes(gente)} ${gente.length === 1 ? 'está' : 'estão'} aqui agora` : 'Sala recente';
      link.addEventListener('mouseenter', () => mostrarDica(link, `#${codigo}`, detalhe));
      link.addEventListener('focus', () => mostrarDica(link, `#${codigo}`, detalhe));
      link.addEventListener('mouseleave', esconderDica);
      link.addEventListener('blur', esconderDica);
      if (aoContexto) {
        link.addEventListener('contextmenu', evento => {
          evento.preventDefault();
          esconderDica();
          aoContexto(link, codigo, ehAqui);
        });
      }
      return link;
    }));
  }

  window.NexoTrilho = Object.freeze({ salasRecentes, esquecerSala, sigla, pintar, esconderDica, CHAVE });
})();
