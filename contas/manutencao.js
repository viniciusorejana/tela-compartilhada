// O trabalho de disco das contas que não cabe no laço de eventos: checkpoint do WAL, limpeza
// de sessões vencidas e a cópia diária.
//
// Mesmo desenho de telemetria/leitor-worker.js, e pelo mesmo motivo: o laço principal entrega
// chat, entrada na sala e a sinalização da mídia de todas as salas ao mesmo tempo. O
// checkpoint é síncrono e o tempo dele depende do disco -- 5,5 ms neste NVMe, e o disco do
// VPS não é este. Numa conexão própria, dentro desta thread, ele pode demorar o que precisar.
//
// A cópia local NÃO é o backup. Ela protege contra apagar a conta errada ou corromper o
// arquivo; contra perder a máquina, só uma cópia fora dela -- cifrada antes de sair, com a
// restauração testada. Isso é operação, e está descrito no README.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MINUTO = 60000;
const COPIAS_GUARDADAS = 7;
const nomeDaCopia = data => `nexo-${data.toISOString().slice(0, 10)}.db`;

if (!isMainThread) {
  const { abrirManutencao } = require('./banco');
  const { backup } = require('node:sqlite');
  const { arquivo, pastaDeCopias, intervaloMs, copiasGuardadas } = workerData;
  const conexao = abrirManutencao({ arquivo });
  let copiando = null;

  async function copiar() {
    if (copiando) return copiando;
    copiando = (async () => {
      await fsp.mkdir(pastaDeCopias, { recursive: true });
      const destino = path.join(pastaDeCopias, nomeDaCopia(new Date()));
      // Copia para um nome provisório e só então renomeia: uma cópia interrompida no meio
      // nunca fica com cara de cópia boa.
      const provisorio = `${destino}.parcial`;
      await fsp.rm(provisorio, { force: true });
      await backup(conexao.conexao, provisorio);
      await fsp.rename(provisorio, destino);
      const antigas = (await fsp.readdir(pastaDeCopias)).filter(n => /^nexo-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().reverse().slice(copiasGuardadas);
      await Promise.all(antigas.map(n => fsp.rm(path.join(pastaDeCopias, n), { force: true })));
      return destino;
    })().finally(() => { copiando = null; });
    return copiando;
  }

  function rodada() {
    try {
      conexao.limparSessoesVencidas(Date.now());
      conexao.checkpoint();
    } catch (erro) { parentPort.postMessage({ tipo: 'falha', erro: erro.message }); }
    // Uma cópia por dia, na primeira rodada em que a de hoje ainda não existe.
    if (!fs.existsSync(path.join(pastaDeCopias, nomeDaCopia(new Date())))) {
      copiar().catch(erro => parentPort.postMessage({ tipo: 'falha', erro: erro.message }));
    }
  }

  const timer = setInterval(rodada, intervaloMs);
  rodada();
  parentPort.on('message', async mensagem => {
    if (mensagem?.tipo === 'copiar') {
      try { parentPort.postMessage({ tipo: 'copiado', id: mensagem.id, destino: await copiar() }); }
      catch (erro) { parentPort.postMessage({ tipo: 'copiado', id: mensagem.id, erro: erro.message }); }
    }
    if (mensagem?.tipo === 'encerrar') {
      clearInterval(timer);
      await copiando?.catch(() => {});
      conexao.fechar();
      parentPort.postMessage({ tipo: 'encerrada' });
    }
  });
} else {
  function iniciarManutencao({ arquivo, pastaDeCopias = path.join(path.dirname(arquivo), 'copias'), intervaloMs = MINUTO, copiasGuardadas = COPIAS_GUARDADAS, aoFalhar = () => {} }) {
    const worker = new Worker(__filename, { workerData: { arquivo, pastaDeCopias, intervaloMs, copiasGuardadas }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    worker.unref();
    const pendentes = new Map();
    let numero = 0, ultimaFalha = null;
    worker.on('message', mensagem => {
      if (mensagem.tipo === 'falha') { ultimaFalha = { em: Date.now(), erro: mensagem.erro }; aoFalhar(mensagem.erro); }
      if (mensagem.tipo === 'copiado') {
        const pedido = pendentes.get(mensagem.id); pendentes.delete(mensagem.id);
        if (mensagem.erro) pedido?.reject(new Error(mensagem.erro)); else pedido?.resolve(mensagem.destino);
      }
    });
    worker.on('error', erro => { ultimaFalha = { em: Date.now(), erro: erro.message }; aoFalhar(erro.message); });
    return {
      // Uma cópia agora, fora do horário. É o que o teste de restauração usa.
      copiarAgora() {
        const id = ++numero;
        return new Promise((resolve, reject) => { pendentes.set(id, { resolve, reject }); worker.postMessage({ tipo: 'copiar', id }); });
      },
      estado: () => ({ ultimaFalha, pastaDeCopias }),
      async encerrar() {
        const fim = new Promise(resolve => {
          const prazo = setTimeout(resolve, 3000); prazo.unref?.();
          worker.on('message', m => { if (m.tipo === 'encerrada') { clearTimeout(prazo); resolve(); } });
          worker.once('exit', () => { clearTimeout(prazo); resolve(); });
        });
        worker.postMessage({ tipo: 'encerrar' });
        await fim;
        await worker.terminate();
      }
    };
  }
  module.exports = { iniciarManutencao, nomeDaCopia, COPIAS_GUARDADAS };
}
