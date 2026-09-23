const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const executar = promisify(execFile);

// O menor atraso que o histograma consegue medir. No Windows o relógio tem granularidade de
// ~15,6 ms, e o laço OCIOSO mede 15,5: qualquer valor até aqui significa "nada". No Linux do
// VPS o piso é ~1 ms. Sem esta nota, a primeira olhada no painel da máquina de casa pareceria
// um problema que não existe.
const PISO_DO_RELOGIO_MS = process.platform === 'win32' ? 15.6 : 1;

// Processador, memória e rede diziam como a máquina estava, mas não o que importa para quem
// está numa sala: se o laço de eventos parou. É por ele que passam o chat, a entrada e a
// sinalização da mídia de TODAS as salas, e meio segundo parado é meio segundo em que ninguém
// consegue começar a ver uma tela. Dois números: o pior atraso e o p99 da janela, e a fração
// do tempo em que o laço esteve ocupado.
function criarMedidorDoLaco() {
  const histograma = monitorEventLoopDelay({ resolution: 10 });
  histograma.enable();
  let referencia = performance.eventLoopUtilization();
  return {
    retirar() {
      const uso = performance.eventLoopUtilization(referencia);
      referencia = performance.eventLoopUtilization();
      const amostra = histograma.count ? {
        piorMs: histograma.max / 1e6, p99Ms: histograma.percentile(99) / 1e6, ocupacao: uso.utilization, pisoMs: PISO_DO_RELOGIO_MS
      } : { piorMs: null, p99Ms: null, ocupacao: uso.utilization, pisoMs: PISO_DO_RELOGIO_MS };
      histograma.reset();
      return amostra;
    },
    encerrar: () => histograma.disable()
  };
}

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
  let atual = { node: null, sfu: null, redes: [], disco: null, laco: null }, anterior = null, coletando = null, discoPendente = null, picoRede = null, picoLaco = null;
  const laco = criarMedidorDoLaco();
  async function coletar() {
    if (coletando) return coletando;
    coletando = (async () => {
      // O laço é lido PRIMEIRO, antes da consulta ao sistema: ela espera um processo externo,
      // e o que se quer medir é o laço de quem atende as salas, não esta coleta.
      atual.laco = laco.retirar();
      if (atual.laco.piorMs !== null) picoLaco = Math.max(picoLaco || 0, atual.laco.piorMs);
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
  return { coletar, disco, resumo: () => atual, retirarPico: () => { const p = picoRede; picoRede = null; return p; },
    // O pior atraso do laço na janela de um minuto, para o histórico: um travamento de meio
    // segundo às três da manhã precisa sobreviver até alguém abrir o painel.
    retirarPicoDoLaco: () => { const p = picoLaco; picoLaco = null; return p; },
    encerrar: () => laco.encerrar() };
}
module.exports = { criarRecursos, tamanhoDaPasta, recursosDoSistema, PISO_DO_RELOGIO_MS };
