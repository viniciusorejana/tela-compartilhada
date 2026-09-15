const fs = require('node:fs/promises');
const path = require('node:path');
const { lerRegistros } = require('./armazenamento');

function criarAlertas({ pasta, agora = Date.now, maximo = 500, dias = 7 } = {}) {
  const arquivo = path.join(pasta, 'alertas.jsonl');
  const alertas = new Map();
  let sujo = false, escrevendo = null, falha = null;
  function limpar() {
    const limite = agora() - dias * 86400000;
    for (const [id, a] of alertas) if (Date.parse(a.t) < limite) { alertas.delete(id); sujo = true; }
    while (alertas.size > maximo) alertas.delete(alertas.keys().next().value);
  }
  function adicionar(a) {
    if (!a || !Number.isFinite(Date.parse(a.t))) return;
    const limpo = { id: String(a.id).slice(0, 64), t: a.t, sessao: String(a.sessao || '').slice(0, 12), nome: String(a.nome || '').slice(0, 40), sala: String(a.sala || '').slice(0, 32), regra: String(a.regra || '').slice(0, 64), quantidade: Number(a.quantidade) || 0, teto: Number(a.teto) || 0, segundos: Number(a.segundos) || 60, acao: ['observado', 'recusado', 'desconectado'].includes(a.acao) ? a.acao : 'observado' };
    alertas.delete(limpo.id); alertas.set(limpo.id, limpo); sujo = true; limpar();
  }
  const pronto = lerRegistros(arquivo, { teto: 1024 * 1024 }).then(({ registros }) => {
    for (const a of registros) adicionar(a);
  }).catch(() => { falha = 'Não foi possível ler os alertas.'; });
  async function gravar() {
    await pronto; limpar(); if (!sujo || escrevendo) return escrevendo;
    sujo = false;
    // Reescrever uma fotografia pequena elimina também do disco os nomes expirados.
    const texto = [...alertas.values()].map(a => JSON.stringify(a)).join('\n') + '\n';
    escrevendo = fs.mkdir(pasta, { recursive: true }).then(() => fs.writeFile(`${arquivo}.tmp`, texto, { mode: 0o600 }))
      .then(() => fs.rename(`${arquivo}.tmp`, arquivo)).then(() => fs.rm(`${arquivo}.anterior`, { force: true }))
      .then(() => { falha = null; }).catch(() => { falha = 'Não foi possível persistir os alertas.'; sujo = true; }).finally(() => { escrevendo = null; });
    return escrevendo;
  }
  return { adicionar, gravar, pronto, listar: () => { limpar(); return [...alertas.values()].reverse(); }, estado: () => ({ falha, quantidade: alertas.size }) };
}
module.exports = { criarAlertas };
