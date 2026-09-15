const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const PASTA = path.resolve(process.env.NEXO_DADOS_TELEMETRIA || path.join(__dirname, '..', 'native', 'medicao'));

// Uma fila cheia perde telemetria e avisa. Nunca segura a mídia esperando o disco voltar.
function criarGravador(arquivo, { teto = 8 * 1024 * 1024, filaMaxima = 512 * 1024 } = {}) {
  let pendente = Promise.resolve();
  let bytesNaFila = 0;
  let descartados = 0;
  let falha = null;
  function gravar(registros) {
    const texto = registros.map(r => JSON.stringify(r)).join('\n') + (registros.length ? '\n' : '');
    const tamanho = Buffer.byteLength(texto);
    if (!tamanho) return pendente;
    if (tamanho > teto || bytesNaFila + tamanho > filaMaxima) { descartados += registros.length; return pendente; }
    bytesNaFila += tamanho;
    pendente = pendente.then(async () => {
      await fsp.mkdir(path.dirname(arquivo), { recursive: true });
      const anterior = `${arquivo}.anterior`;
      const tamanhoAtual = await fsp.stat(arquivo).then(s => s.size, e => { if (e.code !== 'ENOENT') throw e; return 0; });
      if (tamanhoAtual + tamanho > teto) {
        await fsp.rm(anterior, { force: true });
        await fsp.rename(arquivo, anterior).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
      await fsp.appendFile(arquivo, texto, { encoding: 'utf8', mode: 0o600 });
      falha = null;
    }).catch(() => { falha = 'Não foi possível gravar a telemetria.'; descartados += registros.length; })
      .finally(() => { bytesNaFila -= tamanho; });
    return pendente;
  }
  return { gravar, concluir: () => pendente, estado: () => ({ bytesNaFila, descartados, falha }) };
}

async function lerRegistros(arquivo, { teto = 8 * 1024 * 1024, linhaMaxima = 64 * 1024 } = {}) {
  const registros = [];
  let invalidos = 0;
  let ausentes = 0;
  for (const nome of [`${arquivo}.anterior`, arquivo]) {
    let info;
    try { info = await fsp.stat(nome); }
    catch (erro) { if (erro.code === 'ENOENT') { ausentes++; continue; } throw erro; }
    // Arquivos produzidos aqui são limitados. Um arquivo externo enorme não vira trabalho
    // ilimitado na thread que também entrega o chat.
    if (info.size > teto + linhaMaxima) { invalidos++; continue; }
    const fluxo = fs.createReadStream(nome, { encoding: 'utf8', highWaterMark: 16 * 1024 });
    const linhas = readline.createInterface({ input: fluxo, crlfDelay: Infinity });
    let quantidade = 0;
    try {
      for await (const linha of linhas) {
        if (!linha.trim()) continue;
        if (linha.length > linhaMaxima) { invalidos++; continue; }
        try { registros.push(JSON.parse(linha)); } catch (_) { invalidos++; }
        if (++quantidade % 250 === 0) await new Promise(resolve => setImmediate(resolve));
      }
    } finally { linhas.close(); fluxo.destroy(); }
  }
  return { registros, invalidos, ausente: ausentes === 2 };
}

module.exports = { PASTA, criarGravador, lerRegistros };
