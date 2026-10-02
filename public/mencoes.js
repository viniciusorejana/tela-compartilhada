/* Sugestão de quem mencionar, como no Discord: digitar "@" abre a lista de quem está na sala, e
 * cada letra a estreita.
 *
 * Mencionar já funcionava, mas só para quem acertasse o nome inteiro, com acento e maiúscula
 * onde a pessoa pôs -- "@joao" não chamava o João. A lista resolve as duas coisas: mostra quem
 * dá para chamar, e escreve o nome exatamente como a sala o reconhece.
 *
 * O nome pode ter espaço ("Ana Clara"), então a busca aceita espaço enquanto ainda houver
 * alguém cujo nome começa com o que foi digitado; quando não há mais, a lista some e o texto
 * segue normal.
 *
 * A lista é um listbox preso ao campo (aria-activedescendant): o foco nunca sai do campo, e o
 * leitor de tela anuncia a opção escolhida. Um grupo, e não um diálogo -- a sala trata todo
 * dialog como modal (room-ui.js).
 *
 * Usa as globais de sala.js (chatInput, peers, myName, perfilDe, pintarAvatar, rotuloDe).
 */
(() => {
  const compor = chatInput.closest('.chat-compose');
  const lista = document.createElement('div');
  lista.id = 'mencoesSugeridas';
  lista.className = 'mencoes';
  lista.setAttribute('role', 'listbox');
  lista.setAttribute('aria-label', 'Pessoas para mencionar');
  lista.hidden = true;
  compor.append(lista);
  chatInput.setAttribute('aria-autocomplete', 'list');
  chatInput.setAttribute('aria-controls', lista.id);
  chatInput.setAttribute('aria-expanded', 'false');

  const MAXIMO = 8;
  let opcoes = [];     // [{ id, nome }]
  let escolhida = 0;
  let consulta = null; // { inicio, fim } do "@texto" dentro do campo

  // Sem acento e sem maiúscula dos dois lados: "@joao" acha o João.
  const normalizar = texto => String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // Quem pode ser mencionado: todo mundo na sala, menos você. Nomes repetidos aparecem uma vez
  // por pessoa, cada um com o trecho do código que os distingue (rotuloDe, em sala.js).
  function candidatos() {
    const lista = [];
    peers.forEach((par, id) => { if (id !== 'self' && par?.name) lista.push({ id, nome: par.name }); });
    return lista;
  }

  // O "@texto" que termina no cursor, se houver. Precisa começar a palavra: "email@dominio" não
  // é menção.
  function lerConsulta() {
    if (chatInput.selectionStart !== chatInput.selectionEnd) return null;
    const ate = chatInput.selectionStart;
    const antes = chatInput.value.slice(0, ate);
    const achado = /(^|\s)@([^@\n]{0,40})$/.exec(antes);
    if (!achado) return null;
    return { inicio: ate - achado[2].length - 1, fim: ate, texto: achado[2] };
  }

  // Quem começa com o que foi digitado vem antes de quem só tem uma palavra do meio começando
  // assim; dentro de cada grupo, em ordem alfabética.
  function filtrar(texto) {
    const busca = normalizar(texto);
    const pontuados = [];
    for (const pessoa of candidatos()) {
      const nome = normalizar(pessoa.nome);
      let nota = -1;
      if (nome.startsWith(busca)) nota = 0;
      else if (!/\s/.test(busca) && nome.split(/\s+/).some(palavra => palavra.startsWith(busca))) nota = 1;
      if (nota >= 0) pontuados.push({ ...pessoa, nota });
    }
    pontuados.sort((a, b) => a.nota - b.nota || a.nome.localeCompare(b.nome, 'pt-BR'));
    return pontuados.slice(0, MAXIMO);
  }

  function fechar() {
    consulta = null;
    opcoes = [];
    lista.hidden = true;
    lista.replaceChildren();
    chatInput.setAttribute('aria-expanded', 'false');
    chatInput.removeAttribute('aria-activedescendant');
  }

  function pintarEscolhida() {
    lista.querySelectorAll('.mencao-opcao').forEach((el, i) => {
      const ativa = i === escolhida;
      el.classList.toggle('ativa', ativa);
      el.setAttribute('aria-selected', String(ativa));
      if (ativa) { chatInput.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  }

  function desenhar() {
    lista.replaceChildren();
    const titulo = document.createElement('div');
    titulo.className = 'mencoes-titulo';
    titulo.setAttribute('aria-hidden', 'true');
    titulo.textContent = 'Mencionar';
    lista.append(titulo);
    opcoes.forEach((pessoa, i) => {
      const opcao = document.createElement('div');
      opcao.className = 'mencao-opcao';
      opcao.id = `mencao-opcao-${i}`;
      opcao.setAttribute('role', 'option');
      const avatar = document.createElement('span');
      avatar.className = 'mencao-avatar';
      pintarAvatar(avatar, pessoa.nome, perfilDe(pessoa.id));
      const nome = document.createElement('span');
      nome.className = 'mencao-nome';
      nome.textContent = pessoa.nome;
      if (typeof vitrineDe === 'function') window.NexoCartao?.estilizarNome(nome, vitrineDe(pessoa.id));
      opcao.append(avatar, nome);
      // O trecho do código só aparece quando há duas pessoas com o mesmo nome.
      const rotulo = typeof rotuloDe === 'function' ? rotuloDe(pessoa.id) : pessoa.nome;
      if (rotulo !== pessoa.nome) {
        const extra = document.createElement('small');
        extra.textContent = rotulo.slice(pessoa.nome.length).replace(/^\s*·\s*/, '');
        opcao.append(extra);
      }
      // No mousedown, e não no click: o click viria depois de o campo perder o foco.
      opcao.addEventListener('mousedown', evento => { evento.preventDefault(); escolhida = i; completar(); });
      opcao.addEventListener('mousemove', () => { if (escolhida !== i) { escolhida = i; pintarEscolhida(); } });
      lista.append(opcao);
    });
    lista.hidden = false;
    chatInput.setAttribute('aria-expanded', 'true');
    pintarEscolhida();
  }

  function avaliar() {
    const achada = lerConsulta();
    if (!achada) { fechar(); return; }
    const encontrados = filtrar(achada.texto);
    // Com espaço no meio e ninguém mais batendo, o "@" era só texto: a lista sai do caminho.
    if (!encontrados.length) { fechar(); return; }
    const mesmaLista = consulta && encontrados.length === opcoes.length && encontrados.every((p, i) => p.id === opcoes[i].id);
    consulta = achada;
    if (mesmaLista) return;
    const anterior = opcoes[escolhida]?.id;
    opcoes = encontrados;
    escolhida = Math.max(0, opcoes.findIndex(p => p.id === anterior));
    desenhar();
  }

  // Troca o "@texto" pelo nome inteiro e um espaço, com o cursor logo depois -- pronto para
  // continuar a frase.
  function completar() {
    const pessoa = opcoes[escolhida];
    if (!pessoa || !consulta) return;
    const texto = `@${pessoa.nome} `;
    const valor = chatInput.value;
    const depois = valor.slice(consulta.fim).replace(/^ /, '');
    chatInput.value = valor.slice(0, consulta.inicio) + texto + depois;
    const cursor = consulta.inicio + texto.length;
    chatInput.setSelectionRange(cursor, cursor);
    fechar();
    chatInput.focus();
    // O campo cresce com o texto (sala.js ouve o input).
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Na captura, para vir antes do Enter que envia a mensagem (sala.js): com a lista aberta,
  // Enter escolhe a pessoa, e a mensagem só sai no Enter seguinte.
  chatInput.addEventListener('keydown', evento => {
    if (lista.hidden || !opcoes.length) return;
    const tecla = evento.key;
    if (tecla === 'ArrowDown' || tecla === 'ArrowUp') {
      evento.preventDefault();
      escolhida = (escolhida + (tecla === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length;
      pintarEscolhida();
    } else if ((tecla === 'Enter' && !evento.shiftKey) || tecla === 'Tab') {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      completar();
    } else if (tecla === 'Escape') {
      // Fecha só a lista: o Esc não pode seguir adiante e fechar o chat junto.
      evento.preventDefault();
      evento.stopImmediatePropagation();
      fechar();
    }
  }, true);
  chatInput.addEventListener('input', avaliar);
  // Andar com o cursor para dentro ou para fora de um "@" também abre e fecha a lista.
  chatInput.addEventListener('click', avaliar);
  chatInput.addEventListener('keyup', evento => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) avaliar(); });
  chatInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== chatInput) fechar(); }, 120));

  window.NexoMencoes = { fechar, avaliar };
})();
