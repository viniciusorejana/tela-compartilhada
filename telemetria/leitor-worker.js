const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { criarLeitor } = require('./agregacao');

if (!isMainThread) {
  const leitor = criarLeitor(workerData);
  parentPort.on('message', async mensagem => {
    if (mensagem.tipo === 'invalidar') { leitor.invalidar(); return; }
    try { parentPort.postMessage({ id: mensagem.id, dados: await leitor.consultar(mensagem.opcoes) }); }
    catch (_) { parentPort.postMessage({ id: mensagem.id, erro: 'Não foi possível agregar o histórico.' }); }
  });
} else {
  function criarLeitorIsolado(opcoes = {}) {
    let worker = null, numero = 0, ociosidade = null;
    const pendentes = new Map(), iguais = new Map();
    function encerrar() {
      clearTimeout(ociosidade);
      const antigo = worker; worker = null;
      for (const p of pendentes.values()) { clearTimeout(p.prazo); p.reject(new Error('Leitura interrompida.')); }
      pendentes.clear(); iguais.clear();
      return antigo?.terminate();
    }
    function iniciar() {
      if (worker) return;
      // Leitura e agregação grandes não ocupam o event loop que entrega chat e áudio.
      // É uma thread nativa do Node, criada só ao abrir o histórico e encerrada ociosa.
      const criado = new Worker(__filename, { workerData: opcoes, resourceLimits: { maxOldGenerationSizeMb: 192 } });
      worker = criado; criado.unref();
      criado.on('message', m => {
        const p = pendentes.get(m.id); if (!p) return;
        pendentes.delete(m.id); iguais.delete(p.chave); clearTimeout(p.prazo);
        if (m.erro) p.reject(new Error(m.erro)); else p.resolve(m.dados);
      });
      criado.on('error', () => { if (worker === criado) encerrar(); });
      criado.on('exit', () => { if (worker === criado) encerrar(); });
    }
    function consultar(consulta = {}) {
      const chave = JSON.stringify(consulta);
      if (iguais.has(chave)) return iguais.get(chave);
      if (pendentes.size >= 4) return Promise.reject(new Error('Aguarde a leitura em andamento.'));
      iniciar(); clearTimeout(ociosidade); ociosidade = setTimeout(encerrar, 5 * 60000); ociosidade.unref();
      const id = ++numero;
      const pedido = new Promise((resolve, reject) => {
        const prazo = setTimeout(() => encerrar(), 30000); prazo.unref();
        pendentes.set(id, { resolve, reject, prazo, chave });
        worker.postMessage({ id, opcoes: consulta });
      });
      iguais.set(chave, pedido); return pedido;
    }
    return { consultar, invalidar: () => worker?.postMessage({ tipo: 'invalidar' }), encerrar };
  }
  module.exports = { criarLeitorIsolado };
}
