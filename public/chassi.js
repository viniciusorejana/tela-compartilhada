/* A moldura do Nexo antes da primeira pintura (docs/plano-continuidade.md). Síncrono, no <head> do
 * início e da sala, como o tema.js: o que decide a primeira pintura tem de estar pronto antes dela.
 *
 * Duas coisas, as duas só dicas de aparência -- nada de segurança depende delas:
 *
 * 1. Quem tem conta vê o trilho das salas na lateral da sala; quem não tem não vê, porque não há início
 *    para onde voltar. Só que a sala só sabe de que lado a pessoa está quando a conta responde, e o
 *    trilho (64 px) apareceria depois do primeiro quadro, empurrando a sala inteira para o lado. O
 *    resultado da última vez fica no navegador, e a classe `com-conta` já entra no <html> antes de
 *    qualquer pintura. A conta, quando responde, confirma (trilho-sala.js): na primeira visita deste
 *    navegador o trilho entra uma vez, e nas outras nada se mexe.
 *
 * 2. Entrar numa sala sem o portão. Quem tem conta e clica em "Entrar" no início, no trilho, na
 *    pergunta de trocar de sala ou no convite de um amigo já disse que quer entrar: o portão da sala
 *    ("Você está entrando", o nome, outro botão) seria uma segunda pergunta. Quem sai da página deixa
 *    um recado, e a sala o lê e entra sozinha. O recado fica no `sessionStorage` -- é desta aba, vale
 *    15 s e uma vez --, então um link de convite aberto depois não o encontra: quem chega por link
 *    continua passando pelo portão. A classe `entrando-direto` esconde o portão já no primeiro
 *    quadro (sala.css); se a conta não responder, sala.js a tira e o portão volta.
 */
(() => {
  const raiz = document.documentElement;

  // ---------- Tem conta? ----------
  const CHAVE_DA_CONTA = 'nexoTemConta';
  try { if (localStorage.getItem(CHAVE_DA_CONTA) === '1') raiz.classList.add('com-conta'); } catch (_) { /* sem a dica, o trilho entra quando a conta responde */ }
  function definirConta(tem) {
    raiz.classList.toggle('com-conta', Boolean(tem));
    try { localStorage.setItem(CHAVE_DA_CONTA, tem ? '1' : '0'); } catch (_) { /* vale só agora */ }
  }

  // ---------- Entrar sem o portão ----------
  const CHAVE_DA_ENTRADA = 'nexo.entradaDireta';
  const VALIDADE_DA_ENTRADA_MS = 15000;
  const normalizar = codigo => String(codigo || '').toLowerCase();
  function marcarEntrada(codigo) {
    try { sessionStorage.setItem(CHAVE_DA_ENTRADA, JSON.stringify({ sala: normalizar(codigo), em: Date.now() })); } catch (_) { /* sem recado, o portão aparece: é o jeito de sempre */ }
  }
  function lerEntrada() {
    try {
      const { sala, em } = JSON.parse(sessionStorage.getItem(CHAVE_DA_ENTRADA) || 'null') || {};
      return typeof sala === 'string' && Date.now() - em < VALIDADE_DA_ENTRADA_MS ? sala : null;
    } catch (_) { return null; }
  }
  // Só olha: o primeiro quadro precisa saber, e quem decide e gasta o recado é a sala, com a conta na mão.
  const espiarEntrada = codigo => lerEntrada() === normalizar(codigo);
  // Lê e apaga: o recado vale uma vez.
  function consumirEntrada(codigo) {
    const vale = espiarEntrada(codigo);
    try { sessionStorage.removeItem(CHAVE_DA_ENTRADA); } catch (_) { /* expira sozinho */ }
    return vale;
  }
  function irParaSala(codigo) {
    marcarEntrada(codigo);
    // A tela de carregamento acende já nesta página, e a sala a abre acesa (carregando.js).
    window.NexoCarregando?.navegando(`Entrando em #${codigo}`);
    window.location.assign(`/${encodeURIComponent(codigo)}/sala`);
  }

  const daSala = location.pathname.match(/^\/([a-z0-9_-]{4,32})\/sala\/?$/i);
  if (daSala && espiarEntrada(daSala[1])) raiz.classList.add('entrando-direto');

  window.NexoChassi = Object.freeze({ definirConta, marcarEntrada, espiarEntrada, consumirEntrada, irParaSala });
})();
