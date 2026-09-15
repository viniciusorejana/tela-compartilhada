const crypto = require('node:crypto');
const http = require('node:http');

function pedir({ porta, caminho, corpo, autorizacao, limite = 1024 * 1024, tipo = 'application/json' }) {
  return new Promise((resolve, reject) => {
    const pedido = http.request({ hostname: '127.0.0.1', port: porta, path: caminho, method: corpo ? 'POST' : 'GET', headers: { Authorization: autorizacao || '', 'Content-Type': tipo }, timeout: 2000 }, resposta => {
      const partes = []; let total = 0;
      resposta.on('data', p => { total += p.length; if (total > limite) pedido.destroy(new Error('Resposta excedeu o teto.')); else partes.push(p); });
      resposta.on('end', () => resposta.statusCode === 200 ? resolve(Buffer.concat(partes).toString('utf8')) : reject(new Error('SFU indisponível.')));
      resposta.on('error', reject);
    });
    pedido.on('timeout', () => pedido.destroy(new Error('O SFU não respondeu a tempo.')));
    pedido.on('error', reject); pedido.end(corpo);
  });
}
function validarWebhook(corpo, autorizacao, chaves, agora = Date.now()) {
  if (!Buffer.isBuffer(corpo) || corpo.length > 64 * 1024 || typeof autorizacao !== 'string' || autorizacao.length > 8192) throw new Error('Notificação inválida.');
  const partes = autorizacao.replace(/^Bearer /, '').split('.');
  if (partes.length !== 3) throw new Error('Assinatura inválida.');
  const cabecalho = JSON.parse(Buffer.from(partes[0], 'base64url'));
  const claims = JSON.parse(Buffer.from(partes[1], 'base64url'));
  const assinatura = crypto.createHmac('sha256', chaves.apiSecret).update(`${partes[0]}.${partes[1]}`).digest();
  const recebida = Buffer.from(partes[2], 'base64url');
  if (cabecalho.alg !== 'HS256' || cabecalho.crit || recebida.length !== assinatura.length || !crypto.timingSafeEqual(recebida, assinatura)) throw new Error('Assinatura inválida.');
  if (claims.iss !== chaves.apiKey || !Number.isFinite(claims.exp) || claims.exp * 1000 <= agora || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > agora + 5000))) throw new Error('Credencial inválida.');
  const resumo = crypto.createHash('sha256').update(corpo).digest();
  const informado = Buffer.from(typeof claims.sha256 === 'string' ? claims.sha256 : '', 'base64');
  if (informado.length !== resumo.length || !crypto.timingSafeEqual(informado, resumo)) throw new Error('Corpo adulterado.');
  const evento = JSON.parse(corpo);
  if (typeof evento.id !== 'string' || evento.id.length > 64 || !Number.isFinite(Number(evento.createdAt))) throw new Error('Evento inválido.');
  return evento;
}

const METRICAS = ['livekit_node_packet_total', 'livekit_room_total', 'livekit_participant_total', 'livekit_forward_latency', 'livekit_forward_jitter', 'livekit_quality_rating', 'livekit_quality_score', 'livekit_room_duration_seconds'];
function interpretarPrometheus(texto) {
  const resultado = {};
  for (const linha of texto.split('\n')) {
    if (!linha || linha.startsWith('#')) continue;
    const m = linha.match(/^([a-zA-Z_:][\w:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/);
    if (!m || !Number.isFinite(Number(m[3]))) continue;
    const base = METRICAS.find(n => m[1] === n || ['_sum', '_count', '_bucket'].some(s => m[1] === n + s));
    if (!base) continue;
    const rotulos = {}; for (const r of (m[2] || '').matchAll(/(\w+)="((?:\\.|[^"\\])*)"/g)) rotulos[r[1]] = r[2];
    // Só dimensões técnicas fechadas sobrevivem. Labels de participantes nunca vão
    // para a série em disco, mesmo se uma versão futura passar a expô-los.
    let chave = m[1];
    if (base === 'livekit_node_packet_total') { if (!['out', 'dropped'].includes(rotulos.type)) continue; chave += `:${rotulos.type}`; }
    if (m[1].endsWith('_bucket')) { if (!/^(?:\+Inf|\d+(?:\.\d+)?)$/.test(rotulos.le || '')) continue; chave += `:${rotulos.le}`; }
    if (rotulos.quantile) continue;
    resultado[chave] = (resultado[chave] || 0) + Number(m[3]);
  }
  return resultado;
}

function criarObservador({ sfu, aoEvento = () => {}, agora = Date.now } = {}) {
  const vistos = new Map(), participantes = new Map();
  let coleta = null, reconciliando = null, anterior = null, atual = { disponivel: false }, reconciliadoEm = null, ultimaLimpeza = -Infinity, proximaSala = 0;
  const fonte = valor => ({ CAMERA: 'camera', MICROPHONE: 'microphone', SCREEN_SHARE: 'screen_share', SCREEN_SHARE_AUDIO: 'screen_share_audio', 1: 'camera', 2: 'microphone', 3: 'screen_share', 4: 'screen_share_audio' })[valor] || 'outra';
  function limparVistos() {
    if (agora() - ultimaLimpeza < 10000) return;
    ultimaLimpeza = agora();
    for (const [id, quando] of vistos) if (agora() - quando > 10 * 60000) vistos.delete(id);
  }
  function receber(evento) {
    limparVistos();
    if (vistos.has(evento.id)) return false;
    if (vistos.size >= 8192) { atual.saturado = true; return false; }
    vistos.set(evento.id, agora());
    const sala = evento.room?.name, identidade = evento.participant?.identity;
    if (!/^[a-z0-9_-]{4,32}$/.test(sala || '') || typeof identidade !== 'string' || identidade.length > 100) return true;
    const chave = `${sala}|${identidade}`;
    if (evento.event === 'participant_left') participantes.delete(chave);
    else {
      let p = participantes.get(chave);
      if (!p && participantes.size < 2048) { p = { sala, identidade, nome: String(evento.participant.name || '').slice(0, 40), faixas: new Map(), visto: agora() }; participantes.set(chave, p); }
      if (p) {
        p.visto = agora();
        if (evento.event === 'track_published' && p.faixas.size < 16) p.faixas.set(evento.track?.sid, { fonte: fonte(evento.track?.source), largura: Number(evento.track?.width) || 0, altura: Number(evento.track?.height) || 0, muda: Boolean(evento.track?.muted) });
        if (evento.event === 'track_unpublished') p.faixas.delete(evento.track?.sid);
      }
    }
    aoEvento({ tipo: evento.event, sala, identidade, fonte: fonte(evento.track?.source), quando: Number(evento.createdAt) * 1000 }); return true;
  }
  async function coletar() {
    if (coleta) return coleta;
    coleta = sfu.metricas().then(texto => {
      const medidas = interpretarPrometheus(texto), instante = agora();
      const segundos = anterior ? (instante - anterior.t) / 1000 : 0;
      const delta = chave => anterior && medidas[chave] !== undefined && anterior.medidas[chave] !== undefined && medidas[chave] >= anterior.medidas[chave] ? medidas[chave] - anterior.medidas[chave] : null;
      const saida = delta('livekit_node_packet_total:out'), descartados = delta('livekit_node_packet_total:dropped');
      atual = { disponivel: true, em: instante, pacotesSaidaSegundo: segundos > 0 && saida !== null ? saida / segundos : null,
        descartadosSegundo: segundos > 0 && descartados !== null ? descartados / segundos : null,
        // O ForwardStats da versão 1.13.6 publica as gauges em nanossegundos.
        latencia: medidas.livekit_forward_latency !== undefined ? medidas.livekit_forward_latency / 1e6 : null,
        jitter: medidas.livekit_forward_jitter !== undefined ? medidas.livekit_forward_jitter / 1e6 : null,
        salas: medidas.livekit_room_total ?? null, participantes: medidas.livekit_participant_total ?? null,
        qualidade: medidas.livekit_quality_score ?? null, rating: medidas.livekit_quality_rating ?? null };
      anterior = { t: instante, medidas };
    }).catch(() => { atual = { ...atual, disponivel: false, erro: 'Métricas do SFU indisponíveis.' }; anterior = null; }).finally(() => { coleta = null; });
    return coleta;
  }
  async function reconciliar() {
    if (reconciliando) return reconciliando;
    reconciliando = (async () => {
      const dados = await sfu.consultar('ListRooms', {});
      const salas = (dados.rooms || []).slice(0, 512), nomes = new Set(salas.map(s => s.name));
      const presentes = new Set(), consultadas = new Set(), inicio = agora();
      let indice = 0;
      // Duas consultas por vez, até seis segundos de trabalho por rodada. Sob carga,
      // a próxima rodada começa onde esta parou; uma sala não consultada não vira vazia.
      const deslocamento = proximaSala % (salas.length || 1);
      async function consultarProxima() {
        while (indice < salas.length && agora() - inicio < 6000) {
          const sala = salas[(deslocamento + indice++) % salas.length];
          let resposta;
          try { resposta = await sfu.consultar('ListParticipants', { room: sala.name }); } catch (_) { continue; }
          consultadas.add(sala.name);
          for (const p of (resposta.participants || []).slice(0, 2048)) {
            const chave = `${sala.name}|${p.identity}`; presentes.add(chave);
            if (!participantes.has(chave) && participantes.size >= 2048) continue;
            participantes.set(chave, { sala: sala.name, identidade: p.identity, nome: String(p.name || '').slice(0, 40), visto: agora(), faixas: new Map((p.tracks || []).slice(0, 16).map(t => [t.sid, { fonte: fonte(t.source), largura: t.width || 0, altura: t.height || 0, muda: Boolean(t.muted) }])) });
          }
        }
      }
      await Promise.all([consultarProxima(), consultarProxima()]);
      proximaSala = deslocamento + indice;
      atual.reconciliacaoParcial = consultadas.size < (dados.rooms || []).length;
      for (const [chave, p] of participantes) if ((!nomes.has(p.sala) || (consultadas.has(p.sala) && !presentes.has(chave))) && agora() - p.visto > 30000) participantes.delete(chave);
      reconciliadoEm = agora();
    })().catch(() => {}).finally(() => { reconciliando = null; });
    return reconciliando;
  }
  function resumo() {
    // Se a reconciliação parar, uma presença antiga não vira uma afirmação de presença.
    return { ...atual, reconciliadoEm, participantesAtuais: [...participantes.values()].filter(p => agora() - p.visto < 90000).map(({ faixas, ...p }) => ({ ...p, bot: p.identidade.startsWith('nexo-dj#'), faixas: [...faixas.values()] })) };
  }
  return { receber, coletar, reconciliar, resumo, validar: (corpo, auth) => sfu.validarWebhook(corpo, auth), tamanho: () => vistos.size };
}
module.exports = { pedir, validarWebhook, interpretarPrometheus, criarObservador };
