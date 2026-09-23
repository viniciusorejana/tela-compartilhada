const path = require('node:path');
const { PASTA, lerRegistros } = require('./armazenamento');

const FONTES = Object.freeze({ screen: 'Tela', camera: 'Câmera', micAudio: 'Voz', screenAudio: 'Som da tela', musica: 'Música', soundboard: 'Soundboard', chat: 'Chat', outros: 'Outros', vozMista: 'Voz + música (legado)' });
const DIA = 86400000;
const finito = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const zerado = () => Object.fromEntries(Object.keys(FONTES).map(f => [f, 0]));
const mbps = (bytes, segundos) => segundos > 0 ? bytes * 8 / segundos / 1e6 : null;

function intervalo(r) {
  const fim = Date.parse(r?.t);
  const segundos = r?.segundos;
  if (!Number.isFinite(fim) || !finito(segundos) || segundos <= 0 || segundos > 86400) return null;
  return [fim - segundos * 1000, fim];
}
function normalizar(r) {
  if (!intervalo(r) || typeof r.sala !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(r.sala)) return null;
  const fontes = zerado();
  for (const f of Object.keys(fontes)) {
    if (r[f] !== undefined && (!finito(r[f]) || r[f] > Number.MAX_SAFE_INTEGER)) return null;
    fontes[f] = r[f] || 0;
  }
  if (r.v !== 2) { fontes.vozMista += fontes.micAudio; fontes.micAudio = 0; }
  const total = Object.values(fontes).reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(Math.ceil(total))) return null;
  return { ...r, ...fontes, total };
}
function uniao(intervalos) {
  let total = 0, inicio = null, fim = null;
  for (const [a, b] of intervalos.sort((x, y) => x[0] - y[0])) {
    if (inicio === null) { inicio = a; fim = b; }
    else if (a <= fim) fim = Math.max(fim, b);
    else { total += fim - inicio; inicio = a; fim = b; }
  }
  return (total + (inicio === null ? 0 : fim - inicio)) / 1000;
}
function fusoValido(fuso) {
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).format(); return fuso; }
  catch (_) { return 'America/Cuiaba'; }
}
function inicioDoDia(agora, fuso) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const obter = instante => Object.fromEntries(partes.formatToParts(instante).map(p => [p.type, p.value]));
  const p = obter(agora);
  const alvo = Date.UTC(+p.year, +p.month - 1, +p.day);
  let estimativa = alvo;
  for (let i = 0; i < 3; i++) {
    const q = obter(estimativa);
    estimativa += alvo - Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute, +q.second);
  }
  return estimativa;
}

function agregar(brutos, observacoes = [], { periodo = '7d', agora = Date.now(), fuso = 'America/Cuiaba', sala = null, dias = null } = {}) {
  fuso = fusoValido(fuso);
  if (!['hoje', '7d', '30d', 'tudo'].includes(periodo)) throw new Error('Período inválido.');
  const limite = dias > 0 ? agora - dias * DIA : ({ hoje: inicioDoDia(agora, fuso), '7d': agora - 7 * DIA, '30d': agora - 30 * DIA, tudo: 0 })[periodo];
  if (limite === undefined) throw new Error('Período inválido.');
  const fontes = zerado(), porSala = new Map(), minutos = new Map(), cobertura = [];
  const faixasCobertas = observacoes.map(intervalo).filter(Boolean).map(([a, b]) => [Math.max(a, limite), Math.min(b, agora)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const coberturaUnida = [];
  for (const faixa of faixasCobertas) {
    const ultima = coberturaUnida.at(-1);
    if (ultima && faixa[0] <= ultima[1]) ultima[1] = Math.max(ultima[1], faixa[1]);
    else coberturaUnida.push([...faixa]);
  }
  function segundosCobertos(inicio, fim) {
    let esquerda = 0, direita = coberturaUnida.length;
    while (esquerda < direita) { const meio = (esquerda + direita) >>> 1; if (coberturaUnida[meio][1] <= inicio) esquerda = meio + 1; else direita = meio; }
    let soma = 0;
    for (let i = esquerda; i < coberturaUnida.length && coberturaUnida[i][0] < fim; i++) soma += Math.max(0, Math.min(fim, coberturaUnida[i][1]) - Math.max(inicio, coberturaUnida[i][0]));
    return soma / 1000;
  }
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, bytes: 0, segundos: 0 }));
  const semana = Array.from({ length: 7 }, (_, dia) => ({ dia, bytes: 0, segundos: 0 }));
  const horaLocal = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const diasSemana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const indices = t => { const p = Object.fromEntries(horaLocal.formatToParts(t).map(p => [p.type, p.value])); return [+p.hour, diasSemana.indexOf(p.weekday)]; };
  let invalidos = 0, legado = false, primeiro = Infinity, ultimo = 0, entrada = 0, amostras = 0, amostrasSemCobertura = false;
  // No máximo um registro por sala e janela na escrita nova. Chaves repetidas de uma
  // rotação copiada não podem cobrar a mesma janela duas vezes.
  const vistos = new Set();
  for (const bruto of brutos) {
    const r = normalizar(bruto);
    if (!r) { invalidos++; continue; }
    const [a, b] = intervalo(r);
    if (b <= limite || a >= agora || (sala && r.sala !== sala)) continue;
    const chave = `${r.sala}|${r.t}|${r.segundos}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const inicio = Math.max(a, limite), fim = Math.min(b, agora), fracao = (fim - inicio) / (b - a);
    if (segundosCobertos(inicio, fim) + .001 < (fim - inicio) / 1000) amostrasSemCobertura = true;
    primeiro = Math.min(primeiro, inicio); ultimo = Math.max(ultimo, fim); legado ||= r.v !== 2 || r.vozMista > 0;
    amostras += finito(r.amostras) ? r.amostras : 0;
    entrada += finito(r.entrada) ? r.entrada * fracao : 0;
    let atual = porSala.get(r.sala);
    if (!atual) {
      // O ranking não precisa reter milhares de nomes produzidos por um ataque. O total
      // continua íntegro; a cauda fica explicitamente agrupada.
      const nome = porSala.size < 1024 ? r.sala : 'outras-salas';
      atual = porSala.get(nome) || { sala: nome, total: 0, fontes: zerado(), intervalos: [], picoMbps: 0, picoPessoas: 0 };
      porSala.set(nome, atual);
    }
    atual.total += r.total * fracao; atual.intervalos.push([inicio, fim]);
    atual.picoMbps = Math.max(atual.picoMbps, mbps(r.total, r.segundos));
    atual.picoPessoas = Math.max(atual.picoPessoas, finito(r.pessoas) ? r.pessoas : 0);
    for (const f of Object.keys(fontes)) { fontes[f] += r[f] * fracao; atual.fontes[f] += r[f] * fracao; }
    for (let t = inicio; t < fim;) {
      const minuto = Math.floor(t / 60000) * 60000;
      const ate = Math.min(fim, minuto + 60000), segundos = (ate - t) / 1000;
      const m = minutos.get(minuto) || { t: minuto, bytes: 0, intervalos: [] };
      m.bytes += r.total / r.segundos * segundos; m.intervalos.push([t, ate]); minutos.set(minuto, m);
      const [hora, dia] = indices(t), cobertos = segundosCobertos(t, ate);
      horas[hora].bytes += r.total / r.segundos * cobertos; semana[dia].bytes += r.total / r.segundos * cobertos;
      t = ate;
    }
  }
  const uso = { distribuicao: { '1': 0, '2': 0, '3–6': 0, '7–15': 0, '16+': 0 }, salasConcluidas: 0, segundosSalas: 0, sessoesConcluidas: 0, segundosPermanencia: 0, serie: [] };
  const vistosUso = new Set();
  const eventosSfu = { publicacoes: 0, republicacoes: 0, entradas: 0, saidas: 0 }, telas1440 = [];
  let picoRedeMbps = null, picoLacoMs = null;
  for (const r of observacoes) {
    const faixa = intervalo(r); if (!faixa || vistosUso.has(r.t)) continue;
    vistosUso.add(r.t);
    const inicio = Math.max(faixa[0], limite), fim = Math.min(faixa[1], agora);
    if (fim <= inicio) continue;
    cobertura.push([inicio, fim]); primeiro = Math.min(primeiro, inicio); ultimo = Math.max(ultimo, fim);
    const fracao = (fim - inicio) / (faixa[1] - faixa[0]);
    for (const nome of Object.keys(eventosSfu)) if (finito(r.eventosSfu?.[nome])) eventosSfu[nome] += r.eventosSfu[nome] * fracao;
    if (finito(r.telas1440)) telas1440.push({ t: fim, quantidade: r.telas1440 });
    for (const f of Object.keys(uso.distribuicao)) uso.distribuicao[f] += (finito(r.distribuicao?.[f]) ? r.distribuicao[f] : 0) * fracao;
    for (const f of ['salasConcluidas', 'segundosSalas', 'sessoesConcluidas', 'segundosPermanencia']) uso[f] += (finito(r[f]) ? r[f] : 0) * fracao;
    if (finito(r.picoRedeMbps)) picoRedeMbps = Math.max(picoRedeMbps || 0, r.picoRedeMbps);
    if (finito(r.picoLacoMs)) picoLacoMs = Math.max(picoLacoMs || 0, r.picoLacoMs);
    uso.serie.push({ t: fim, simultaneas: finito(r.simultaneas) ? r.simultaneas : 0, pico: finito(r.picoSimultaneas) ? r.picoSimultaneas : 0 });
  }
  for (const [inicio, fim] of coberturaUnida) for (let t = inicio; t < fim;) {
    const ate = Math.min(fim, Math.floor(t / 60000) * 60000 + 60000);
    const [hora, dia] = indices(t); horas[hora].segundos += (ate - t) / 1000; semana[dia].segundos += (ate - t) / 1000; t = ate;
  }
  const total = Object.values(fontes).reduce((a, b) => a + b, 0);
  const segundosObservados = uniao(cobertura);
  const segundosComDados = uniao([...minutos.values()].flatMap(m => m.intervalos));
  const segundos = uniao([...coberturaUnida, ...[...minutos.values()].flatMap(m => m.intervalos)]);
  let picoMbps = null;
  const porHora = new Map();
  for (const m of minutos.values()) {
    const taxa = mbps(m.bytes, uniao(m.intervalos)); picoMbps = Math.max(picoMbps || 0, taxa || 0);
    const h = Math.floor(m.t / 3600000) * 3600000;
    const item = porHora.get(h) || { t: h, bytes: 0, picoMbps: 0 };
    item.bytes += m.bytes; item.picoMbps = Math.max(item.picoMbps, taxa || 0); porHora.set(h, item);
  }
  const mediaMbps = mbps(total, segundos);
  const confianca = segundosObservados < 86400 ? 'insuficiente' : segundosObservados < 7 * 86400 ? 'preliminar' : 'observada';
  // A projeção só usa janelas novas com cobertura. Misturar meses legados com algumas
  // horas do coletor novo multiplicaria artificialmente o consumo mensal.
  const temCoberturaCompleta = segundosObservados > 0 && !amostrasSemCobertura;
  const podeProjetar = confianca !== 'insuficiente' && temCoberturaCompleta;
  return {
    periodo, fuso, total, entrada, fontes, legado, amostras, invalidos, vazio: !vistos.size,
    primeiro: Number.isFinite(primeiro) ? primeiro : null, ultimo: ultimo || null,
    segundosObservados, segundosComDados, mediaMbps, picoMbps, picoRedeMbps, picoLacoMs,
    coberturaConhecida: segundosObservados > 0, projecao: { confianca: podeProjetar ? confianca : 'insuficiente', bytesMensais: podeProjetar ? total / segundosObservados * 30 * 86400 : null },
    salas: [...porSala.values()].map(({ intervalos, ...r }) => ({ ...r, segundos: uniao(intervalos), mediaMbps: mbps(r.total, uniao(intervalos)) })).sort((a, b) => b.total - a.total),
    serie: [...porHora.values()].sort((a, b) => a.t - b.t), horas, semana, eventosSfu, telas1440: telas1440.sort((a, b) => a.t - b.t),
    uso: { ...uso, serie: uso.serie.sort((a, b) => a.t - b.t), duracaoMedia: uso.salasConcluidas ? uso.segundosSalas / uso.salasConcluidas : null, permanenciaMedia: uso.sessoesConcluidas ? uso.segundosPermanencia / uso.sessoesConcluidas : null }
  };
}

function criarLeitor({ pasta = PASTA, agora = Date.now } = {}) {
  let cache = null, validade = 0, lendo = null;
  const resultados = new Map();
  async function ler() {
    if (cache && agora() < validade) return cache;
    if (lendo) return lendo;
    lendo = Promise.all([lerRegistros(path.join(pasta, 'banda.jsonl')), lerRegistros(path.join(pasta, 'uso.jsonl'))]).then(([banda, uso]) => {
      cache = { banda, uso }; validade = agora() + 60000; resultados.clear(); return cache;
    }).finally(() => { lendo = null; });
    return lendo;
  }
  return { async consultar(opcoes = {}) {
    const { banda, uso } = await ler(), chave = JSON.stringify(opcoes);
    if (resultados.has(chave)) return resultados.get(chave);
    const resultado = { ...agregar(banda.registros, uso.registros, { ...opcoes, agora: agora() }), linhasIgnoradas: banda.invalidos + uso.invalidos };
    if (resultados.size >= 4) resultados.delete(resultados.keys().next().value);
    resultados.set(chave, resultado); return resultado;
  }, invalidar: () => { validade = 0; resultados.clear(); } };
}
module.exports = { FONTES, zerado, normalizar, agregar, criarLeitor, mbps, uniao, inicioDoDia };
