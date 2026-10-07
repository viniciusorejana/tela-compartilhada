/* O trilho das salas dentro da sala (docs/plano-continuidade.md).
 *
 * É o mesmo trilho do início (trilho.js, trilho.css), no mesmo lugar: quem tem conta troca de página
 * e o trilho nem se mexe. Aqui ele mostra as salas recentes com a de agora primeiro e o anel verde,
 * o "N" abre o início por cima da chamada (inicio-na-sala.js) e clicar noutra sala pergunta antes --
 * entrar noutra sala sai desta chamada.
 *
 * Só com conta: sem ela não há início para onde voltar, e o trilho fica escondido (sala.css). A conta
 * responde de forma assíncrona, e o que se sabia da última vez (chassi.js) já pôs a classe `com-conta`
 * no <html> antes da primeira pintura; aqui a resposta a confirma ou a corrige.
 */
(() => {
  const salaDaChamada = String(roomCode).toLowerCase();
  const lugar = document.getElementById('trilhoSalas');
  if (!lugar || !window.NexoTrilho) return;

  const nomesJuntos = pessoas => {
    const nomes = pessoas.map(p => p.apelidoMeu || p.apelido);
    if (nomes.length <= 2) return nomes.join(' e ');
    return `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}`;
  };
  // Quem dos meus amigos está em cada sala agora (o socket de amigos de social-sala.js).
  function amigosPorSala() {
    const S = window.NexoSocial;
    const mapa = new Map();
    for (const p of S?.estado?.amigos?.amigos || []) {
      const sala = S.presencaDe(p.codigo).sala;
      if (!sala) continue;
      if (!mapa.has(sala.codigo)) mapa.set(sala.codigo, { sala, pessoas: [] });
      mapa.get(sala.codigo).pessoas.push(p);
    }
    return mapa;
  }
  function pintar() {
    window.NexoTrilho.pintar(lugar, {
      aqui: salaDaChamada,
      porSala: amigosPorSala(),
      nomes: nomesJuntos,
      // A mesma sala é só voltar; outra pergunta antes (a camada decide, inicio-na-sala.js).
      aoEntrar: codigo => window.NexoInicioNaSala?.pedirEntrada(codigo)
    });
  }

  // Antes de a conta responder, o que a dica da última vez disse: as recentes vêm do navegador, e
  // não precisam esperar ninguém.
  if (document.documentElement.classList.contains('com-conta')) pintar();

  window.NexoConta?.pronto.then(({ conta }) => {
    const antes = document.documentElement.classList.contains('com-conta');
    window.NexoChassi?.definirConta(Boolean(conta));
    // O trilho entrou ou saiu: a grade mudou sem a janela mudar (o palco e o limite do chat medem no `resize`).
    if (antes !== Boolean(conta)) window.dispatchEvent(new Event('resize'));
    if (!conta) return;
    pintar();
    // Os amigos entram e saem de salas, e quem entra em outra aba muda as recentes.
    window.NexoSocial?.on('amigos', pintar);
    window.NexoSocial?.on('presenca', pintar);
  });
  window.addEventListener('storage', evento => { if (evento.key === window.NexoTrilho.CHAVE) pintar(); });
  window.addEventListener('resize', () => window.NexoTrilho.esconderDica());
})();
