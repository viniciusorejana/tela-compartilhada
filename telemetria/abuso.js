const crypto = require('node:crypto');

const MiB = 1024 * 1024;
const MINUTO = 60000;
const REGRAS = Object.freeze({
  'soundboard-tocar': { sessao: 30, sala: 90, intervalo: 400 },
  'soundboard-upload': { sessao: 6, sala: 24 },
  'soundboard-bytes': { sessao: 12 * MiB, sala: 48 * MiB },
  'soundboard-download': { sessao: 90, sala: 900 },
  'soundboard-download-bytes': { sessao: 48 * MiB, sala: 512 * MiB },
  'soundboard-remover': { sessao: 30, sala: 90 },
  'soundboard-lista': { sessao: 30, sala: 300 },
  'musica-comando': { sessao: 20, sala: 60 },
  'musica-busca': { sessao: 6, sala: 24 },
  'musica-estado': { sessao: 30, sala: 300 },
  'musica-saude': { sessao: 30, sala: 300 },
  'chat-message': { sessao: 40, sala: 240, rajada: [6, 2000] },
  'chat-imagem': { sessao: 4, sala: 40 },
  'chat-bytes': { sessao: 4 * MiB, sala: 20 * MiB },
  'join-room': { sessao: 6, sala: 120, longa: [20, 10 * MINUTO] },
  'leave-room': { sessao: Infinity },
  'media-state': { sessao: 30, sala: 600 },
  'medicao-de-banda': { sessao: 3, sala: 1536 },
  'audio-start': { sessao: 12, sala: 60 },
  'audio-stop': { sessao: Infinity },
  'audio-escolha': { sessao: 12, sala: 60 },
  'audio-capabilities': { sessao: 30 },
  'registrar-agente': { sessao: 12 },
  'agente-aplicativos': { sessao: 30 },
  'agente-controle': { sessao: 120 },
  'agente-pacotes': { sessao: 12000 },
  'agente-bytes': { sessao: 32 * MiB },
  // Um relato é um gesto deliberado de quem está com problema, então o teto é baixo de
  // propósito: quem manda três num minuto está testando o campo, não relatando. E cada um
  // carrega até 16 KB de relatório técnico, o que faz deste o evento mais caro por unidade.
  'relato': { sessao: 3, sala: 12, longa: [10, 10 * MINUTO] },
  'sala-token': { sessao: 20, sala: 300 },
  'conexao': { sessao: 60 },
  'origem-token': { sessao: 120 },
  'origem-http': { sessao: 300 },
  'total': { sessao: 300, rajada: [60, 5000] },
  'publicacao': { sessao: 20, observar: true },
  'republicacao': { sessao: 4, longa: [12, 5 * MINUTO], observar: true },
  'transicao': { sessao: 12, observar: true },
  'churn-sfu': { sessao: 12, observar: true },
  'outros': { sessao: 30 }
});

// Doze fatias por janela limitam memória mesmo para uploads em milhares de pedaços.
// A fatia de borda permanece inteira: no pior caso espera-se alguns segundos a mais.
function somar(contador, quantidade, agora, periodo) {
  const passo = Math.max(100, Math.ceil(periodo / 12));
  const fatia = Math.floor(agora / passo);
  contador.partes = contador.partes.filter(p => p[0] >= fatia - 12);
  const ultima = contador.partes.at(-1);
  if (ultima?.[0] === fatia) ultima[1] += quantidade;
  else contador.partes.push([fatia, quantidade]);
  return contador.partes.reduce((s, p) => s + p[1], 0);
}

function criarAntiabuso({ agora = Date.now, aoAlertar = () => {}, maximo = 2048, maximoSalas = 512, regras = {} } = {}) {
  const sessoes = new Map(), salas = new Map(), taxas = new Map(), taxasSocket = new Map();
  const configuradas = Object.fromEntries(Object.entries(REGRAS).map(([k, v]) => [k, { ...v, ...regras[k] }]));
  let saturacoes = 0;
  let global = { partes: [] };
  function limpar() {
    const limite = agora() - 10 * MINUTO;
    for (const mapa of [sessoes, salas]) for (const [chave, valor] of mapa) if (valor.ultimo < limite) mapa.delete(chave);
  }
  function estado(mapa, chave, teto) {
    let item = mapa.get(chave);
    if (!item) {
      if (mapa.size >= teto) { limpar(); if (mapa.size >= teto) { saturacoes++; return null; } }
      item = { ultimo: agora(), baldes: new Map(), incidentes: new Map(), pseudonimo: crypto.randomBytes(3).toString('hex'), eventos: { partes: [] } };
      mapa.set(chave, item);
    }
    item.ultimo = agora(); return item;
  }
  function contar(item, chave, quantidade, periodo = MINUTO) {
    const contador = item.baldes.get(chave) || { partes: [] };
    item.baldes.set(chave, contador);
    return somar(contador, quantidade, agora(), periodo);
  }
  function alerta(item, regra, contexto, quantidade, teto, periodo, acao) {
    const anterior = item.incidentes.get(regra);
    // A escrita é uma fotografia agregada do incidente, no máximo uma por minuto.
    if (anterior && agora() - anterior.quando < MINUTO) return;
    const id = anterior && agora() - anterior.quando < 10 * MINUTO ? anterior.id : crypto.randomUUID();
    item.incidentes.set(regra, { quando: agora(), id });
    aoAlertar({ id, t: new Date(agora()).toISOString(), sessao: item.pseudonimo,
      nome: String(contexto.nome || 'Sessão sem nome').slice(0, 40), sala: String(contexto.sala || '').slice(0, 32),
      regra, quantidade, teto, segundos: periodo / 1000, acao });
  }
  function verificar(chave, tipo, contexto = {}, quantidade = 1) {
    tipo = Object.hasOwn(configuradas, tipo) ? tipo : 'outros';
    if (!Number.isFinite(quantidade) || quantidade <= 0) return { ok: false, motivo: 'quantidade-invalida', segundos: 60 };
    const regra = configuradas[tipo];
    const instante = agora();
    // Uma saída sempre precisa poder liberar os recursos que já ocupou.
    if (['leave-room', 'audio-stop'].includes(tipo)) return { ok: true };
    const item = estado(sessoes, String(chave).slice(0, 160), maximo);
    if (!item) return { ok: false, motivo: 'capacidade', segundos: 60 };
    const taxa = taxas.get(tipo) || { tentativas: { partes: [] }, recusadas: { partes: [] } };
    taxas.set(tipo, taxa);
    somar(taxa.tentativas, 1, instante, MINUTO);
    let estourou = null;
    const observar = regra.observar;
    const fonte = ['camera', 'screen', 'microphone', 'screen_share', 'screen_share_audio', 'micAudio', 'screenAudio'].includes(contexto.fonte) ? contexto.fonte : 'outra';
    const nomeRegra = tipo === 'republicacao' ? `${tipo}:${fonte}` : tipo;
    const total = contar(item, nomeRegra, quantidade);
    if (Number.isFinite(regra.sessao) && total > regra.sessao) estourou = [total, regra.sessao, MINUTO];
    for (const [sufixo, par] of [['rajada', regra.rajada], ['longa', regra.longa]]) {
      if (!par) continue;
      const valor = contar(item, `${nomeRegra}:${sufixo}`, quantidade, par[1]);
      if (valor > par[0]) estourou = [valor, par[0], par[1]];
    }
    if (regra.intervalo) {
      const ultimo = item.baldes.get('ultimo-som');
      if (ultimo !== undefined && instante - ultimo < regra.intervalo) estourou = [2, 1, regra.intervalo];
      if (!estourou) item.baldes.set('ultimo-som', instante);
    }
    if (regra.sala && contexto.sala) {
      const sala = estado(salas, String(contexto.sala).slice(0, 32), maximoSalas);
      if (!sala) return { ok: false, motivo: 'capacidade', segundos: 60 };
      const totalSala = contar(sala, tipo, quantidade);
      if (totalSala > regra.sala) {
        // Um teto coletivo não autoriza culpar o último participante que chegou.
        alerta(sala, `${tipo}:sala`, { sala: contexto.sala, nome: 'Limite coletivo da sala' }, totalSala, regra.sala, MINUTO, 'recusado');
        somar(taxa.recusadas, 1, instante, MINUTO);
        return { ok: false, motivo: 'limite-da-sala', segundos: 60 };
      }
    }
    if (estourou) {
      const acao = observar ? 'observado' : 'recusado';
      alerta(item, nomeRegra, contexto, ...estourou, acao);
      if (!observar) somar(taxa.recusadas, 1, instante, MINUTO);
      return { ok: Boolean(observar), excedeu: true, motivo: 'limite', segundos: Math.ceil(estourou[2] / 1000), extremo: tipo === 'total' && total > 900 };
    }
    return { ok: true };
  }
  function permitirGlobal() {
    return somar(global, 1, agora(), 1000) <= 2000;
  }
  function contarEvento(chave, tipo, recusado = false) {
    tipo = Object.hasOwn(REGRAS, tipo) ? tipo : 'outros';
    const item = estado(sessoes, String(chave).slice(0, 160), maximo);
    const taxa = taxasSocket.get(tipo) || { tentativas: { partes: [] }, recusadas: { partes: [] } };
    taxasSocket.set(tipo, taxa);
    somar(taxa[recusado ? 'recusadas' : 'tentativas'], 1, agora(), MINUTO);
    if (item && !recusado) somar(item.eventos, 1, agora(), MINUTO);
  }
  function resumo() {
    limpar();
    const totalRecente = c => somar(c, 0, agora(), MINUTO);
    return { saturacoes, sessoes: sessoes.size, salas: salas.size,
      taxasSocket: [...taxasSocket].map(([tipo, t]) => ({ tipo, tentativas: totalRecente(t.tentativas), recusadas: totalRecente(t.recusadas) })).sort((a, b) => b.tentativas - a.tentativas),
      taxas: [...taxas].map(([tipo, t]) => ({ tipo, tentativas: totalRecente(t.tentativas), recusadas: totalRecente(t.recusadas) })).sort((a, b) => b.tentativas - a.tentativas),
      emissores: [...sessoes.values()].map(s => ({ sessao: s.pseudonimo, eventos: totalRecente(s.eventos) })).filter(s => s.eventos).sort((a, b) => b.eventos - a.eventos).slice(0, 10) };
  }
  return { verificar, contarEvento, permitirGlobal, resumo, limpar, regras: configuradas };
}
module.exports = { criarAntiabuso, REGRAS };
