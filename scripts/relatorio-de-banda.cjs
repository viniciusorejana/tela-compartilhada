#!/usr/bin/env node
// Lê o que medicao.js gravou e responde a pergunta que motivou medir: quanto cada fonte
// custa, e o que uma mudança de qualidade economizou de verdade.
//
//   node scripts/relatorio-de-banda.cjs              # tudo que houver
//   node scripts/relatorio-de-banda.cjs --dias 7     # só a última semana
//   node scripts/relatorio-de-banda.cjs --sala virus # uma sala
//
// A projeção mensal no fim é o número que decide onde hospedar: 1 TB por mês é irrelevante
// num servidor com tráfego incluso e custa perto de cem dólares num cobrado por GB.
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', 'native', 'medicao', 'banda.jsonl');
const FONTES = [
  ['screen', 'tela'], ['camera', 'câmera'],
  ['micAudio', 'voz'], ['screenAudio', 'som da tela']
];

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function legivel(bytes) {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} kB`;
}

// Mbps é a unidade que importa para dimensionar servidor: a porta é vendida em Gbps, e o que
// derruba uma sala é o pico, não a média.
function mbps(bytes, segundos) {
  return segundos > 0 ? (bytes * 8) / (segundos * 1_000_000) : 0;
}

function ler() {
  let bruto;
  try { bruto = fs.readFileSync(ARQUIVO, 'utf8'); }
  catch (_) {
    console.error(`Nada medido ainda -- ${ARQUIVO} não existe.`);
    console.error('A medição grava a cada minuto de sala com mídia passando. Abra uma sala,');
    console.error('compartilhe alguma coisa por alguns minutos e rode isto de novo.');
    process.exit(1);
  }
  const dias = Number(argumento('dias', 0));
  const salaPedida = argumento('sala', null);
  const limite = dias > 0 ? Date.now() - dias * 86400_000 : 0;
  const linhas = [];
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue;
    try {
      const registro = JSON.parse(linha);
      if (limite && new Date(registro.t).getTime() < limite) continue;
      if (salaPedida && registro.sala !== salaPedida) continue;
      linhas.push(registro);
    } catch (_) { /* Linha truncada por uma queda no meio da gravação: pula. */ }
  }
  return linhas;
}

const registros = ler();
if (!registros.length) {
  console.log('Nenhuma janela no período pedido.');
  process.exit(0);
}

const porSala = new Map();
for (const r of registros) {
  const atual = porSala.get(r.sala) || {
    total: 0, segundos: 0, janelas: 0, picoMbps: 0, picoPessoas: 0,
    screen: 0, camera: 0, micAudio: 0, screenAudio: 0
  };
  atual.total += r.total || 0;
  atual.segundos += r.segundos || 0;
  atual.janelas++;
  atual.picoMbps = Math.max(atual.picoMbps, mbps(r.total || 0, r.segundos || 1));
  atual.picoPessoas = Math.max(atual.picoPessoas, r.pessoas || 0);
  for (const [chave] of FONTES) atual[chave] += r[chave] || 0;
  porSala.set(r.sala, atual);
}

const geral = { total: 0, segundos: 0, screen: 0, camera: 0, micAudio: 0, screenAudio: 0 };
for (const dados of porSala.values()) {
  geral.total += dados.total;
  geral.segundos += dados.segundos;
  for (const [chave] of FONTES) geral[chave] += dados[chave];
}

const primeiro = new Date(registros[0].t);
const ultimo = new Date(registros[registros.length - 1].t);
console.log('');
console.log(`Banda de saída · ${primeiro.toLocaleString('pt-BR')} até ${ultimo.toLocaleString('pt-BR')}`);
console.log(`${registros.length} janelas medidas, ${porSala.size} sala(s)`);
console.log('');

const ordenadas = [...porSala.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [sala, dados] of ordenadas) {
  const horas = dados.segundos / 3600;
  console.log(`  ${sala}`);
  console.log(`    ${legivel(dados.total)} em ${horas.toFixed(1)} h de sala ativa`
    + ` · até ${dados.picoPessoas} pessoa(s)`);
  console.log(`    ${mbps(dados.total, dados.segundos).toFixed(1)} Mbps em média`
    + ` · ${dados.picoMbps.toFixed(1)} Mbps no pico`);
  for (const [chave, rotulo] of FONTES) {
    if (!dados[chave]) continue;
    const fatia = (dados[chave] / dados.total) * 100;
    console.log(`      ${rotulo.padEnd(12)} ${legivel(dados[chave]).padStart(10)}  ${fatia.toFixed(0).padStart(3)}%`);
  }
  console.log('');
}

console.log('  ── todas as salas ──');
console.log(`    ${legivel(geral.total)} · ${mbps(geral.total, geral.segundos).toFixed(1)} Mbps em média`);
for (const [chave, rotulo] of FONTES) {
  if (!geral[chave]) continue;
  console.log(`      ${rotulo.padEnd(12)} ${legivel(geral[chave]).padStart(10)}`
    + `  ${((geral[chave] / geral.total) * 100).toFixed(0).padStart(3)}%`);
}

// Extrapolar de poucas horas para um mês é grosseiro, e dizer isso é parte do número: a
// projeção serve para escolher categoria de hospedagem, não para fechar orçamento.
const horasMedidas = geral.segundos / 3600;
if (horasMedidas >= 0.5) {
  const porMes = (geral.total / horasMedidas) * 730;
  console.log('');
  console.log(`  No mesmo ritmo, 730 h de sala dariam ${legivel(porMes)} por mês.`);
  const gb = porMes / 1024 ** 3;
  console.log(`    cobrado por GB (AWS/GCP, ~US$ 0,09): ~US$ ${(gb * 0.09).toFixed(0)}/mês`);
  console.log('    com tráfego incluso (Hetzner/OVH): dentro da franquia');
  if (horasMedidas < 5) console.log(`    (baseado em só ${horasMedidas.toFixed(1)} h medidas -- ainda é chute)`);
}
console.log('');
