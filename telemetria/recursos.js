const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executar = promisify(execFile);

async function recursosDoSistema(pid) {
  if (process.platform === 'win32') {
    // Uma consulta por coleta, sem processo residente e sem PowerShell síncrono na
    // entrega da mídia. Os únicos valores interpolados são PIDs numéricos locais.
    const consulta = Number.isInteger(pid) && pid > 0 ? `Get-Process -Id ${pid} -ErrorAction SilentlyContinue` : '$null';
    const codigo = `$ErrorActionPreference='Stop'; $p=${consulta}; $redes=@(Get-NetAdapterStatistics | Select-Object Name,SentBytes,ReceivedBytes); @{sfu=$(if($p){@{cpu=$p.TotalProcessorTime.TotalMilliseconds;memoria=$p.WorkingSet64}}else{$null});redes=$redes}|ConvertTo-Json -Compress -Depth 4`;
    const { stdout } = await executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', codigo], { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 });
    const dados = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    return { sfu: dados.sfu, redes: (dados.redes || []).slice(0, 64).map(r => ({ nome: r.Name, saida: r.SentBytes, entrada: r.ReceivedBytes })) };
  }
  if (process.platform === 'linux') {
    const redes = (await fs.readFile('/proc/net/dev', 'utf8')).split('\n').slice(2).flatMap(linha => {
      const [nome, dados] = linha.split(':'); if (!dados || nome.trim() === 'lo') return [];
      const valores = dados.trim().split(/\s+/).map(Number); return [{ nome: nome.trim(), entrada: valores[0], saida: valores[8] }];
    });
    let sfu = null;
    if (Number.isInteger(pid) && pid > 0) {
      const { stdout } = await executar('ps', ['-p', String(pid), '-o', 'time=', '-o', 'rss='], { timeout: 2000, maxBuffer: 4096 });
      const [tempo, memoria] = stdout.trim().split(/\s+/);
      const [dias, relogio] = tempo.includes('-') ? tempo.split('-') : ['0', tempo];
      const partes = relogio.split(':').map(Number);
      const segundos = partes.reduce((s, n) => s * 60 + n, 0) + Number(dias) * 86400;
      sfu = { cpu: segundos * 1000, memoria: Number(memoria) * 1024 };
    }
    return { redes: redes.slice(0, 64), sfu };
  }
  return { redes: [], sfu: null };
}

async function tamanhoDaPasta(pasta, { limiteArquivos = 50000, prazoMs = 15000 } = {}) {
  const pendentes = [pasta]; let bytes = 0, arquivos = 0, parcial = false;
  const inicio = Date.now();
  while (pendentes.length && !parcial) {
    const atual = pendentes.pop();
    let diretorio;
    try { diretorio = await fs.opendir(atual); } catch (_) { parcial = true; break; }
    for await (const item of diretorio) {
      if (++arquivos > limiteArquivos || Date.now() - inicio > prazoMs || pendentes.length > 2048) { parcial = true; break; }
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) pendentes.push(path.join(atual, item.name));
      else if (item.isFile()) { try { bytes += (await fs.stat(path.join(atual, item.name))).size; } catch (_) { parcial = true; } }
    }
  }
  return { bytes, arquivos, parcial, em: Date.now() };
}
function criarRecursos({ pid = () => null, pasta = path.join(__dirname, '..', 'native'), coletarSistema = recursosDoSistema, agora = Date.now } = {}) {
  let atual = { node: null, sfu: null, redes: [], disco: null }, anterior = null, coletando = null, discoPendente = null, picoRede = null;
  async function coletar() {
    if (coletando) return coletando;
    coletando = (async () => {
      const instante = agora(), cpu = process.cpuUsage(), uso = cpu.user + cpu.system, memoria = process.memoryUsage();
      const processo = pid();
      let sistema = null;
      try { sistema = await coletarSistema(processo); } catch (_) {}
      const ms = anterior ? instante - anterior.t : 0;
      atual.node = { cpu: ms > 0 ? Math.max(0, (uso - anterior.cpu) / 1000 / ms * 100) : null, memoria: memoria.rss, heap: memoria.heapUsed, uptime: process.uptime() };
      atual.sfu = sistema?.sfu ? { memoria: sistema.sfu.memoria, cpu: ms > 0 && anterior.pid === processo && anterior.sistema?.sfu && sistema.sfu.cpu >= anterior.sistema.sfu.cpu ? (sistema.sfu.cpu - anterior.sistema.sfu.cpu) / ms * 100 : null } : null;
      atual.redes = (sistema?.redes || []).map(r => {
        const antes = anterior?.sistema?.redes.find(n => n.nome === r.nome);
        const taxa = antes && ms > 0 && r.saida >= antes.saida ? (r.saida - antes.saida) * 8 / ms / 1000 : null;
        return { nome: r.nome, saidaMbps: taxa, bytesSaida: r.saida, bytesEntrada: r.entrada };
      });
      // Interfaces virtuais podem contar o mesmo tráfego duas vezes. Guardamos cada uma
      // e usamos a maior taxa observada; a interface escolhida fica explícita no painel.
      const candidatas = atual.redes.filter(r => r.saidaMbps !== null);
      const maior = candidatas.sort((a, b) => b.saidaMbps - a.saidaMbps)[0];
      if (maior) picoRede = Math.max(picoRede || 0, maior.saidaMbps);
      atual.em = instante; atual.nucleos = os.cpus().length; atual.coletaSistemaDisponivel = Boolean(sistema);
      anterior = { t: instante, cpu: uso, sistema, pid: processo };
    })().finally(() => { coletando = null; });
    return coletando;
  }
  async function disco() {
    if (discoPendente) return discoPendente;
    discoPendente = tamanhoDaPasta(pasta).then(d => { atual.disco = d; }).catch(() => { atual.disco = null; }).finally(() => { discoPendente = null; });
    return discoPendente;
  }
  return { coletar, disco, resumo: () => atual, retirarPico: () => { const p = picoRede; picoRede = null; return p; } };
}
module.exports = { criarRecursos, tamanhoDaPasta, recursosDoSistema };
