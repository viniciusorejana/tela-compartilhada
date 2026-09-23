// O ciclo de vida de uma sala: quem pode abri-la, quem está nela, e quando ela é esquecida.
//
// Três regras moram aqui (docs/plano-contas.md, "Quem abre a sala"):
//
//   1. Só uma conta ABRE uma sala. Abrir é ser o primeiro a entrar num código que não está
//      aberto. Quem tem o link entra enquanto ela estiver aberta, com conta ou sem.
//   2. A sala fica aberta 60 segundos depois de esvaziar. Era esquecida no mesmo instante, o
//      que já custava a conversa a quem estava sozinho e apertou F5 -- e, com a regra 1,
//      custaria a volta a um anônimo que caiu por dois segundos, porque voltar seria abrir.
//      É memória, não disco: "nada fica guardado" continua verdade, um minuto depois.
//   3. O link morre com a sala. "Ainda não abriu" e "já fechou" são o mesmo estado, e não por
//      descuido: sem persistência não há como saber se um código fechado já esteve aberto.
//
// ---------- Por que um módulo ----------
//
// O fechamento era uma lista de dez limpezas dentro de `sairDaSalaAtual`, e cada mapa novo
// por sala precisava ser lembrado ali -- esquecer um é um vazamento que só aparece semanas
// depois. Aqui, quem guarda algo por sala registra a própria limpeza uma vez (`aoFechar`), e
// o fechamento chama todas. É também o lugar onde "sala persistente", um dia, vai consultar o
// banco antes de esquecer: uma mudança num arquivo.
const CARENCIA_MS = 60000;
const MAXIMO_DE_SALAS = 512;

function criarSalas({
  carenciaMs = CARENCIA_MS, maximoDeSalas = MAXIMO_DE_SALAS, anonimoAbre = false,
  agendar = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, cancelar = clearTimeout
} = {}) {
  // sala -> Map<socketId, membro>. O mesmo mapa que o resto do servidor lê como `roomMembers`.
  const membros = new Map();
  const carencias = new Map();
  const limpezas = [];

  const aberta = sala => membros.has(sala) || carencias.has(sala);

  // O que acontece com quem chega a este código agora:
  //   'entra'   a sala está aberta (com gente, ou na carência)
  //   'abre'    não está, e esta pessoa pode abri-la
  //   'espera'  não está, e só uma conta abre
  //   'lotado'  não está, e o servidor já tem salas demais
  function acesso(sala, { temConta = false } = {}) {
    if (aberta(sala)) return 'entra';
    if (!temConta && !anonimoAbre) return 'espera';
    if (membros.size + carencias.size >= maximoDeSalas) return 'lotado';
    return 'abre';
  }

  function entrou(sala, socketId, membro) {
    const timer = carencias.get(sala);
    // Qualquer entrada durante a carência cancela o fechamento: é para isso que ela existe.
    if (timer) { cancelar(timer); carencias.delete(sala); }
    let daSala = membros.get(sala);
    const abriu = !daSala && !timer;
    if (!daSala) { daSala = new Map(); membros.set(sala, daSala); }
    daSala.set(socketId, membro);
    return { abriu };
  }

  function saiu(sala, socketId) {
    const daSala = membros.get(sala);
    if (!daSala?.delete(socketId) || daSala.size) return;
    membros.delete(sala);
    carencias.set(sala, agendar(() => fechar(sala), carenciaMs));
  }

  function fechar(sala) {
    carencias.delete(sala);
    // Alguém pode ter entrado no mesmo instante em que o prazo venceu.
    if (membros.has(sala)) return;
    for (const limpar of limpezas) {
      try { limpar(sala); } catch (erro) { console.error(`Limpeza da sala falhou: ${erro.message}`); }
    }
  }

  return {
    acesso, entrou, saiu, aberta,
    aoFechar: fn => { limpezas.push(fn); },
    da: sala => membros.get(sala),
    // Quantas pessoas estão AGORA, contando cada identidade uma vez: durante uma reconexão a
    // mesma pessoa pode ter dois sockets por um instante.
    pessoas: sala => new Set([...(membros.get(sala)?.values() || [])].map(m => m.identidade)).size,
    emCarencia: sala => carencias.has(sala),
    mapa: membros,
    encerrar() { for (const timer of carencias.values()) cancelar(timer); carencias.clear(); }
  };
}

module.exports = { criarSalas, CARENCIA_MS, MAXIMO_DE_SALAS };
