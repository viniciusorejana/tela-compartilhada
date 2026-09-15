#!/usr/bin/env node
// O terminal e o painel usam o mesmo cálculo: corrigir uma média não pode deixar dois
// relatórios discordando sobre o que o servidor gastou.
const { criarLeitor, FONTES } = require('../telemetria/agregacao');
function argumento(nome, padrao) { const i = process.argv.indexOf(`--${nome}`); return i >= 0 ? process.argv[i + 1] : padrao; }
function legivel(bytes) {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} kB`;
}
async function main() {
  const dados = await criarLeitor().consultar({ periodo: 'tudo', dias: Number(argumento('dias', 0)), sala: argumento('sala', null) });
  if (dados.vazio) { console.log('Nada medido ainda. A medição grava a cada minuto; o painel distingue falta de dados de ociosidade.'); return; }
  console.log(`Banda de saída · ${new Date(dados.primeiro).toLocaleString('pt-BR')} até ${new Date(dados.ultimo).toLocaleString('pt-BR')}`);
  for (const sala of dados.salas) {
    console.log(`\n  ${sala.sala}: ${legivel(sala.total)} · ${(sala.mediaMbps || 0).toFixed(2)} Mbps em média · ${(sala.picoMbps || 0).toFixed(2)} Mbps no pico de janela`);
    for (const [f, nome] of Object.entries(FONTES)) if (sala.fontes[f]) console.log(`    ${nome}: ${legivel(sala.fontes[f])}`);
  }
  console.log(`\nTodas as salas: ${legivel(dados.total)} · ${(dados.mediaMbps || 0).toFixed(2)} Mbps em média · ${(dados.picoMbps || 0).toFixed(2)} Mbps no pico de janela`);
  console.log('Bytes de aplicação. Mídia autodeclarada; janelas de 60 s não representam picos instantâneos da porta.');
  if (dados.legado) console.log('O histórico antigo mistura voz e música. A separação só existe nas amostras novas.');
  if (dados.projecao.bytesMensais !== null) console.log(`Projeção ${dados.projecao.confianca}: ${legivel(dados.projecao.bytesMensais)} em 30 dias; US$ ${(dados.projecao.bytesMensais / 1e9 * 0.09).toFixed(2)} a US$ 0,09/GB (hipótese).`);
  else console.log('Amostra insuficiente para projetar: é necessário ao menos um dia de cobertura do coletor novo.');
  console.log('Tráfego incluso depende da franquia e do preço-base contratados; configure o cenário no painel.');
}
main().catch(() => { console.error('Não foi possível ler os arquivos de medição.'); process.exitCode = 1; });
