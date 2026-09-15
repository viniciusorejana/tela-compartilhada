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
  function emitir({ sala, nome, credencial }) {
    const anterior = obter(credencial);
    if (anterior && anterior.sala === sala && anterior.nome === nome) return { sessao: anterior, credencial };
    limpar();
    if (sessoes.size >= maximo) return null;
    const segredo = crypto.randomBytes(32).toString('base64url');
    const identidade = `${nome}#${crypto.randomBytes(8).toString('hex')}`;
    const sessao = { id: crypto.randomBytes(16).toString('hex'), sala, nome, identidade, ultimo: agora(), socket: null, sequencia: -1 };
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
