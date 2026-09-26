// Quanto tempo a sala está aberta, e quanto tempo cada pessoa está nela.
//
// O relógio da barra lateral contava da entrada NESTA aba: um F5 zerava tudo, e quem caiu por
// dez segundos voltava "chegando agora" depois de uma hora de conversa. Aqui o tempo é da
// PESSOA, não da conexão, e a pessoa é reconhecida por uma chave que sobrevive ao F5:
//
//   - com conta, a própria conta (`conta:<id>`) -- a mesma em qualquer aba ou aparelho;
//   - sem conta, um sorteio que o navegador guarda e apresenta ao conectar (`anon:<hex>`);
//   - sem nenhuma das duas (uma página antiga em cache), a identidade da sessão, que ao menos
//     cobre a oscilação de rede.
//
// A chave nunca sai do servidor. O que viaja é só o instante `desde`, por identidade de mídia.
//
// ---------- Voltar rápido não é chegar ----------
//
// Quem sai e volta dentro da tolerância retoma o relógio de onde estava. Três minutos cobrem o
// F5, a troca de Wi-Fi e o navegador que fechou sem querer; quem some por meia hora e volta
// começou outra conversa, e o relógio diz isso.
//
// Tudo mora na memória e morre com a sala (salas.js, `aoFechar`), como o chat e a mesa de
// sons: saber há quanto tempo alguém esteve numa sala fechada seria histórico, e o Nexo não
// guarda histórico de presença.
const TOLERANCIA_DE_VOLTA_MS = 3 * 60000;

function criarTempos({ agora = Date.now, toleranciaMs = TOLERANCIA_DE_VOLTA_MS } = {}) {
  // sala -> { abertaEm, pessoas: Map<chave, { desde, conexoes: Set, saiuEm }> }
  const porSala = new Map();

  // Quem saiu há mais tempo que a tolerância não volta mais ao mesmo relógio. A faxina roda a
  // cada entrada, e não num temporizador: uma sala sem movimento não cresce, e uma com
  // movimento limpa a si mesma.
  function esquecerQuemNaoVolta(registro) {
    const limite = agora() - toleranciaMs;
    for (const [chave, pessoa] of registro.pessoas) {
      if (!pessoa.conexoes.size && pessoa.saiuEm !== null && pessoa.saiuEm < limite) registro.pessoas.delete(chave);
    }
  }

  // Devolve o instante em que o relógio desta pessoa começou -- o de agora, ou o de antes, se
  // ela está voltando dentro da tolerância. A sala abre na primeira entrada: os 60 segundos
  // em que ela espera vazia não a fecham, e quem volta nesse intervalo encontra o relógio dela
  // andando.
  function entrou(sala, chave, conexao) {
    let registro = porSala.get(sala);
    if (!registro) { registro = { abertaEm: agora(), pessoas: new Map() }; porSala.set(sala, registro); }
    esquecerQuemNaoVolta(registro);
    let pessoa = registro.pessoas.get(chave);
    if (!pessoa) { pessoa = { desde: agora(), conexoes: new Set(), saiuEm: null }; registro.pessoas.set(chave, pessoa); }
    pessoa.conexoes.add(conexao);
    pessoa.saiuEm = null;
    return pessoa.desde;
  }

  // Uma pessoa pode ter duas conexões por um instante -- a aba nova entrando antes de a velha
  // perceber que caiu. Ela só "sai" quando a última delas sai.
  function saiu(sala, chave, conexao) {
    const pessoa = porSala.get(sala)?.pessoas.get(chave);
    if (!pessoa) return;
    pessoa.conexoes.delete(conexao);
    if (!pessoa.conexoes.size) pessoa.saiuEm = agora();
  }

  return {
    entrou, saiu,
    desde: (sala, chave) => porSala.get(sala)?.pessoas.get(chave)?.desde ?? null,
    abertaEm: sala => porSala.get(sala)?.abertaEm ?? null,
    fechou: sala => { porSala.delete(sala); },
    salas: () => porSala.size
  };
}

// A chave do relógio de quem entra. O sorteio do navegador só é aceito no formato exato: ele
// vira chave de mapa, e nada solto vindo do cliente entra aqui.
function chaveDeTempo({ contaId = null, identidade = '', sorteio = '' } = {}) {
  if (contaId) return `conta:${contaId}`;
  if (/^[a-f0-9]{32}$/.test(String(sorteio))) return `anon:${sorteio}`;
  return `id:${identidade}`;
}

module.exports = { criarTempos, chaveDeTempo, TOLERANCIA_DE_VOLTA_MS };
