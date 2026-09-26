// Quem está vendo a tela de quem.
//
// Assistir é um acerto entre a página e o servidor de mídia: a sinalização nunca soube quem
// recebe qual tela. Para mostrar a quem transmite "três pessoas vendo a sua tela", como o
// Discord faz, cada página conta aqui quais telas está recebendo, e o servidor repassa à sala.
//
// ---------- A lista inteira, e não "liguei" e "desliguei" ----------
//
// A página manda sempre TUDO o que está vendo. Um aviso perdido numa oscilação de rede, ou a
// retomada automática que o transporte faz depois de uma queda (sem clique nenhum), não deixa o
// placar errado para sempre: a próxima lista corrige tudo, sem que ninguém precise reconciliar
// uma sequência de eventos.
//
// Se a tela está no ar, quem sabe é o servidor de mídia, e não este: cada página só lista uma
// tela que ela vê no ar, e a tira quando ela cai. Então o que se guarda aqui é o que as
// páginas disseram, e nada é deduzido.
//
// Chaveado pela identidade de mídia, que é como a sala desenha a lista de pessoas. Mora na
// memória e morre com a sala, como o chat e o relógio.
const MAXIMO_DE_TELAS_POR_PESSOA = 32;

function criarEspectadores() {
  // sala -> Map<espectador, Set<dono da tela>>
  const porSala = new Map();

  function arrumar(sala, mapa) {
    if (!mapa.size) porSala.delete(sala);
  }

  // O que esta pessoa está vendo agora. Devolve os donos cujo placar mudou -- só a eles vale
  // mandar o aviso.
  function definir(sala, espectador, donos) {
    let mapa = porSala.get(sala);
    const antes = mapa?.get(espectador) || new Set();
    // Ninguém é espectador da própria tela: ela já está na máquina de quem transmite.
    const depois = new Set([...donos].filter(dono => dono && dono !== espectador).slice(0, MAXIMO_DE_TELAS_POR_PESSOA));
    const mudaram = [];
    for (const dono of antes) if (!depois.has(dono)) mudaram.push(dono);
    for (const dono of depois) if (!antes.has(dono)) mudaram.push(dono);
    if (!mudaram.length) return mudaram;
    if (!mapa) { mapa = new Map(); porSala.set(sala, mapa); }
    if (depois.size) mapa.set(espectador, depois); else mapa.delete(espectador);
    arrumar(sala, mapa);
    return mudaram;
  }

  // A tela desta pessoa saiu do ar de vez (ela saiu da sala): ninguém mais a vê.
  function esquecerTela(sala, dono) {
    const mapa = porSala.get(sala);
    if (!mapa) return false;
    let havia = false;
    for (const [espectador, donos] of mapa) {
      if (!donos.delete(dono)) continue;
      havia = true;
      if (!donos.size) mapa.delete(espectador);
    }
    arrumar(sala, mapa);
    return havia;
  }

  // Saiu da sala: deixa de ver o que via, e quem via a tela dela deixa de ver.
  function saiu(sala, identidade) {
    const mudaram = new Set(definir(sala, identidade, []));
    if (esquecerTela(sala, identidade)) mudaram.add(identidade);
    return [...mudaram];
  }

  // Na ordem em que cada um passou a ver alguma tela: o placar não embaralha a cada aviso.
  function de(sala, dono) {
    const lista = [];
    for (const [espectador, donos] of porSala.get(sala) || []) if (donos.has(dono)) lista.push(espectador);
    return lista;
  }

  function donos(sala) {
    const todos = new Set();
    for (const lista of (porSala.get(sala) || new Map()).values()) for (const dono of lista) todos.add(dono);
    return [...todos];
  }

  return {
    definir, saiu, de, donos,
    fechou: sala => { porSala.delete(sala); },
    salas: () => porSala.size
  };
}

module.exports = { criarEspectadores, MAXIMO_DE_TELAS_POR_PESSOA };
