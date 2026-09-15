// O navegador informa mídia recebida; o Node mede os corpos HTTP e mensagens que envia.
// São bytes de aplicação, não uma fatura de rede. Nenhum deles decide quem abusou:
// essa decisão pertence aos contadores do servidor em telemetria/abuso.js.
const path = require('node:path');
const { PASTA, criarGravador } = require('./telemetria/armazenamento');
const { zerado, FONTES: ROTULOS } = require('./telemetria/agregacao');

const ARQUIVO = path.join(PASTA, 'banda.jsonl');
const FONTES = ['screen', 'camera', 'micAudio', 'screenAudio', 'musica'];
const SEGUNDOS_POR_JANELA = 60;
const BYTES_MAXIMOS_POR_AMOSTRA = 2 * 1024 ** 3;

function criarMedicao({ arquivo = ARQUIVO, agora = Date.now, maximoSalas = 512 } = {}) {
  const janela = new Map();
  const gravador = criarGravador(arquivo);
  let inicio = agora(), timer = null, saturacoes = 0;
  function obter(sala) {
    if (!/^[a-z0-9_-]{1,32}$/.test(sala || '')) return null;
    if (!janela.has(sala)) {
      if (janela.size >= maximoSalas) { sala = 'outras-salas'; saturacoes++; }
      if (!janela.has(sala)) janela.set(sala, { ...zerado(), pessoas: 0, amostras: 0, entrada: 0 });
    }
    return janela.get(sala);
  }
  function registrar(sala, recebido, pessoas) {
    if (!recebido || typeof recebido !== 'object' || Array.isArray(recebido)) return;
    const dados = recebido.v === 2 ? recebido.fontes : recebido;
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return;
    const atual = obter(sala); if (!atual) return;
    let restante = BYTES_MAXIMOS_POR_AMOSTRA;
    for (const fonte of FONTES) {
      const valor = dados[fonte];
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) continue;
      const bytes = Math.min(Math.floor(valor), restante); restante -= bytes;
      atual[fonte === 'micAudio' && recebido.v !== 2 ? 'vozMista' : fonte] += bytes;
    }
    atual.amostras++;
    atual.pessoas = Math.max(atual.pessoas, Math.min(Number(pessoas) || 0, 2048));
  }
  function registrarServidor(sala, fonte, bytes, direcao = 'saida') {
    if (!['soundboard', 'chat', 'outros'].includes(fonte) || !Number.isFinite(bytes) || bytes <= 0) return;
    const atual = obter(sala || 'servidor'); if (!atual) return;
    atual[direcao === 'entrada' ? 'entrada' : fonte] += bytes;
  }
  function gravar() {
    const fim = agora();
    const segundos = Math.max(0.001, (fim - inicio) / 1000); inicio = fim;
    const linhas = [...janela].map(([sala, dados]) => ({ v: 2, t: new Date(fim).toISOString(), sala, segundos, ...dados,
      total: Object.keys(ROTULOS).reduce((s, f) => s + dados[f], 0) }));
    janela.clear(); return gravador.gravar(linhas);
  }
  function iniciar() {
    if (timer) return;
    inicio = agora(); timer = setInterval(gravar, SEGUNDOS_POR_JANELA * 1000); timer.unref?.();
  }
  async function encerrar() { clearInterval(timer); timer = null; await gravar(); await gravador.concluir(); }
  return { registrar, registrarServidor, iniciar, gravar, encerrar, estado: () => ({ ...gravador.estado(), salas: janela.size, saturacoes }) };
}
module.exports = { ...criarMedicao(), criarMedicao, ARQUIVO, FONTES, SEGUNDOS_POR_JANELA, BYTES_MAXIMOS_POR_AMOSTRA };
