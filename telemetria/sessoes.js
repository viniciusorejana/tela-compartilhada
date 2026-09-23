const crypto = require('node:crypto');

const hash = segredo => crypto.createHash('sha256').update(segredo).digest('hex');
function criarSessoes({ agora = Date.now, maximo = 2048, ociosidade = 10 * 60000 } = {}) {
  const sessoes = new Map(), porIdentidade = new Map();
  function limpar() {
    for (const [chave, sessao] of sessoes) if (!sessao.socket && agora() - sessao.ultimo > ociosidade) {
      sessoes.delete(chave); porIdentidade.delete(`${sessao.sala}|${sessao.identidade}`);
    }
  }
  function obter(credencial) {
    if (typeof credencial !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credencial)) return null;
    const sessao = sessoes.get(hash(credencial));
    if (!sessao) return null;
    if (!sessao.socket && agora() - sessao.ultimo > ociosidade) { limpar(); return null; }
    sessao.ultimo = agora(); return sessao;
  }
  // `conta` é `{ id, perfil }` de quem entrou logado. O id fica SÓ aqui, no servidor: a
  // identidade de mídia continua sorteada, porque é ela que vai para o token do LiveKit, para
  // as webhooks e para os relatos -- e com a conta dentro, tudo isso viraria um histórico de
  // quem esteve onde. A ligação entre as duas não sai desta sessão.
  function emitir({ sala, nome, credencial, conta = null }) {
    const anterior = obter(credencial);
    // Entrar ou sair da conta muda quem é a pessoa na sala: a sessão antiga não serve mais.
    if (anterior && anterior.sala === sala && anterior.nome === nome && anterior.contaId === (conta?.id || null)) {
      anterior.perfil = conta?.perfil || null;
      return { sessao: anterior, credencial };
    }
    limpar();
    if (sessoes.size >= maximo) return null;
    const segredo = crypto.randomBytes(32).toString('base64url');
    const identidade = `${nome}#${crypto.randomBytes(8).toString('hex')}`;
    const sessao = { id: crypto.randomBytes(16).toString('hex'), sala, nome, identidade, ultimo: agora(), socket: null, sequencia: -1, contaId: conta?.id || null, perfil: conta?.perfil || null };
    sessoes.set(hash(segredo), sessao); porIdentidade.set(`${sala}|${identidade}`, sessao);
    return { sessao, credencial: segredo };
  }
  function associar(sessao, socket) {
    // A credencial privada prova a retomada. Uma conexão antiga pode levar 35 s para
    // perceber a queda; substituí-la evita um ciclo de recusas durante esse intervalo.
    if (sessao.socket && sessao.socket !== socket && sessao.socket.connected) sessao.socket.disconnect(true);
    sessao.socket = socket; sessao.ultimo = agora(); return true;
  }
  function soltar(sessao, socket) { if (sessao?.socket === socket) { sessao.socket = null; sessao.ultimo = agora(); } }
  return { emitir, obter, associar, soltar, limpar, localizar: (sala, identidade) => porIdentidade.get(`${sala}|${identidade}`), tamanho: () => sessoes.size };
}
module.exports = { criarSessoes, hash };
