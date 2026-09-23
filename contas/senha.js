// Senha e código de recuperação, derivados com scrypt -- e sem atrasar sala nenhuma.
//
// A regra tem três partes, e a razão de cada uma foi medida (docs/plano-contas.md, seção 2):
//
//   1. `crypto.scrypt` assíncrono, nunca `scryptSync`. Vinte logins com a versão síncrona
//      pararam o laço de eventos por 571 ms: chat, entrada e sinalização da mídia de TODAS as
//      salas congelados. Por isso isto vira teste (tests/contas.test.js), e não comentário.
//   2. Uma derivação por vez. Assíncrono sozinho não basta: o scrypt roda no pool do libuv --
//      quatro threads, divididas com leitura de arquivo e DNS --, e com o pool cheio de hashes
//      ler um arquivo levou 167,5 ms em vez de 2. Com uma por vez, 0,2 ms. Quem espera é só
//      quem está logando; as salas, não.
//   3. Fila de no máximo 16. Cheia, recusa na hora -- enfileirar mais seria transformar uma
//      enxurrada em espera para todo mundo que tenta entrar depois.
//
// Os parâmetros vão dentro da string guardada. Trocá-los um dia não invalida senha nenhuma: a
// antiga é conferida com os parâmetros dela e, se estiver certa, derivada de novo com os novos.
const crypto = require('node:crypto');

// N = 2^15 custa 55 ms nesta máquina -- o dobro dos 27 ms medidos com o padrão do Node, e o
// dobro do trabalho de quem tentar adivinhar senhas de um banco copiado. O custo só cai em
// quem está entrando, porque a fila protege o resto; o VPS, mais lento, deve ficar perto de
// 100 ms, e 16 na fila são ainda 1,6 s no pior caso.
const PARAMETROS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, tamanho: 32 });
const FILA_MAXIMA = 16;

class FilaCheia extends Error {
  constructor() { super('Muita gente entrando ao mesmo tempo. Tente de novo em instantes.'); this.codigo = 'fila-cheia'; }
}

const B64 = /^[A-Za-z0-9_-]+$/;
function lerGuardada(texto) {
  const partes = String(texto || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return null;
  const [N, r, p] = partes.slice(1, 4).map(Number);
  // Limites de sanidade: um valor absurdo aqui pediria gigabytes de memória a uma thread.
  if (!Number.isInteger(Math.log2(N)) || N < 2 ** 10 || N > 2 ** 20 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  if (!B64.test(partes[4]) || !B64.test(partes[5])) return null;
  return { N, r, p, sal: Buffer.from(partes[4], 'base64url'), derivada: Buffer.from(partes[5], 'base64url') };
}

function criarSenhas({ parametros = PARAMETROS, filaMaxima = FILA_MAXIMA } = {}) {
  const fila = [];
  let ocupada = false;

  function rodar() {
    if (ocupada || !fila.length) return;
    ocupada = true;
    const { tarefa, resolve, reject } = fila.shift();
    tarefa().then(resolve, reject).finally(() => { ocupada = false; rodar(); });
  }
  function naVez(tarefa) {
    if (fila.length >= filaMaxima) return Promise.reject(new FilaCheia());
    return new Promise((resolve, reject) => { fila.push({ tarefa, resolve, reject }); rodar(); });
  }

  // NFC antes de derivar: "é" digitado no celular e "é" colado de outro lugar podem ser bytes
  // diferentes, e a pessoa não teria como saber por que a própria senha não entra.
  const derivarAgora = (texto, sal, { N, r, p, tamanho }) => new Promise((resolve, reject) => {
    crypto.scrypt(String(texto).normalize('NFC'), sal, tamanho, { N, r, p, maxmem: 256 * N * r }, (erro, chave) => (erro ? reject(erro) : resolve(chave)));
  });

  async function derivar(texto) {
    const sal = crypto.randomBytes(16);
    const chave = await naVez(() => derivarAgora(texto, sal, parametros));
    return `scrypt$${parametros.N}$${parametros.r}$${parametros.p}$${sal.toString('base64url')}$${chave.toString('base64url')}`;
  }

  // Conta inexistente também paga uma derivação inteira, contra um alvo de mentira. Sem isto,
  // "usuário não existe" responderia em 1 ms e "senha errada" em 55 -- e o login viraria uma
  // consulta de quem tem conta, que é justamente o que a resposta única existe para impedir.
  const ALVO_FALSO = { ...parametros, sal: crypto.randomBytes(16), derivada: crypto.randomBytes(parametros.tamanho) };

  async function conferir(texto, guardada) {
    const lida = lerGuardada(guardada);
    const alvo = lida || ALVO_FALSO;
    const chave = await naVez(() => derivarAgora(texto, alvo.sal, { N: alvo.N, r: alvo.r, p: alvo.p, tamanho: alvo.derivada.length }));
    const ok = Boolean(lida) && chave.length === alvo.derivada.length && crypto.timingSafeEqual(chave, alvo.derivada);
    return { ok, desatualizada: ok && (lida.N !== parametros.N || lida.r !== parametros.r || lida.p !== parametros.p) };
  }

  return { derivar, conferir, emEspera: () => fila.length + (ocupada ? 1 : 0), parametros };
}

module.exports = { criarSenhas, FilaCheia, PARAMETROS, FILA_MAXIMA, lerGuardada };
