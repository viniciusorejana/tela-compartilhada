const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { criarAntiabuso } = require('./abuso');
const { criarSessoes } = require('./sessoes');
const { criarAutenticacao, PASTA_PRIVADA } = require('./autenticacao');
const { criarAlertas } = require('./alertas');
const { criarLeitorIsolado } = require('./leitor-worker');
const { criarUso } = require('./uso');
const { criarGravador, PASTA } = require('./armazenamento');
const { criarObservador } = require('./livekit');
const { criarRecursos } = require('./recursos');
const { instalarRotas } = require('./rotas');
const { ipDoPedido } = require('./origem');
const { criarRelatos, MAXIMO_DA_MENSAGEM, MAXIMO_DO_RELATORIO } = require('./relatos');

function iniciarTelemetria({ app, io, sfu, medicao, salas, soundboard, moderacao = null, contas = null, midia = null, aoFaixaDeTela = () => {}, aoPublicarTela = () => {}, tetoDePessoas = null, aceitarCaptura = () => false }) {
  const auth = criarAutenticacao();
  const alertas = criarAlertas({ pasta: PASTA_PRIVADA });
  let regras = {};
  try {
    regras = JSON.parse(process.env.NEXO_LIMITES || '{}');
    if (!regras || typeof regras !== 'object' || Array.isArray(regras)) throw new Error();
  } catch (_) { regras = {}; console.error('NEXO_LIMITES inválido: serão usados os tetos padrão.'); }
  const abuso = criarAntiabuso({ aoAlertar: alertas.adicionar, regras });
  // As origens têm um orçamento próprio: muitas conexões sem sessão não expulsam do
  // mapa os contadores das pessoas que já estão conversando.
  const origens = criarAntiabuso({ regras, aoAlertar: a => alertas.adicionar({ ...a, nome: 'Origem de rede (temporária)' }) });
  const agentes = criarAntiabuso({ regras, maximo: 128, aoAlertar: alertas.adicionar });
  const sessoes = criarSessoes();
  const uso = criarUso(), gravadorUso = criarGravador(path.join(PASTA, 'uso.jsonl'));
  const leitor = criarLeitorIsolado();
  const segredoDaOrigem = crypto.randomBytes(32);
  const chaveDaOrigem = req => crypto.createHmac('sha256', segredoDaOrigem).update(ipDoPedido(req)).digest('hex');
  const buscas = new Set(), buscasPorSala = new Map(), uploads = new Set();
  const contexto = sessao => ({ sala: sessao?.sala || '', nome: sessao?.nome || '' });
  let eventosSfu = { publicacoes: 0, republicacoes: 0, entradas: 0, saidas: 0 }, revisao = 0, picoTelas1440 = null;
  const observador = criarObservador({ sfu, aoEvento(evento) {
    const sessao = sessoes.localizar(evento.sala, evento.identidade);
    if (evento.tipo === 'participant_joined') eventosSfu.entradas++;
    if (evento.tipo === 'participant_left') eventosSfu.saidas++;
    if (evento.tipo === 'track_published') eventosSfu.publicacoes++;
    if (!sessao) return;
    sessao.ultimo = Date.now();
    // A tela publicada segue para a conferência do teto do plano (server.js). O evento já
    // chega ligado à sessão -- é a sessão que sabe a conta, e a conta que sabe o plano.
    if (evento.tipo === 'track_published' && evento.fonte === 'screen_share' && evento.faixa) aoFaixaDeTela(sessao, evento.faixa);
    // A publicação de uma tela, uma vez (a reconciliação abaixo vê a mesma tela de novo, e não
    // passa por aqui): é o que soma no contador de telas da conta.
    if (evento.tipo === 'track_published' && evento.fonte === 'screen_share') { try { aoPublicarTela(sessao); } catch (_) { /* contador é enfeite */ } }
    const con = { ...contexto(sessao), fonte: evento.fonte };
    const recente = Date.now() - evento.quando < 15000 && sfu.diagnostico().uptime > 60;
    if (evento.tipo === 'track_published') {
      sessao.fontesPublicadas ||= new Set();
      if (sessao.fontesPublicadas.has(evento.fonte)) {
        eventosSfu.republicacoes++;
        if (recente) abuso.verificar(sessao.id, 'republicacao', con);
      }
      sessao.fontesPublicadas.add(evento.fonte);
      if (recente) abuso.verificar(sessao.id, 'publicacao', con);
    }
    if (recente && ['track_published', 'track_unpublished'].includes(evento.tipo)) abuso.verificar(sessao.id, 'transicao', con);
    if (recente && ['participant_joined', 'participant_left'].includes(evento.tipo)) abuso.verificar(sessao.id, 'churn-sfu', con);
  } });
  const recursos = criarRecursos({ pid: () => sfu.diagnostico().pid });
  function vivo() {
    const ativos = [...salas()].slice(0, 512).map(([sala, membros]) => ({ sala, pessoas: membros.size, membros: [...membros.values()].map(m => ({ nome: m.name, estadoDeclarado: m.state })) }));
    return { em: Date.now(), revisao, salas: ativos, teto: tetoDePessoas?.() || null, abuso: abuso.resumo(), origens: origens.resumo(), limites: abuso.regras, alertas: alertas.listar(), sfu: { ...sfu.diagnostico(), ...observador.resumo() }, eventosSfu, recursos: recursos.resumo(), soundboard: soundboard.usoGlobal(), coleta: { banda: medicao.estado(), uso: gravadorUso.estado(), alertas: alertas.estado(), relatos: relatos.estado() } };
  }
  const relatos = criarRelatos();
  const rotas = instalarRotas(app, { auth, relatos, contas, midia, consultar: async periodo => ({ contabilidade: await leitor.consultar({ periodo, fuso: process.env.NEXO_FUSO || Intl.DateTimeFormat().resolvedOptions().timeZone }), atual: vivo() }), instante: vivo });

  // ---------- "Não está funcionando" chegando até aqui ----------
  //
  // Exige sessão, e isso não é burocracia: a sessão é o que dá sala e nome ao relato sem
  // pedi-los ao cliente, e é o que faz o limite por pessoa existir. Quem não está numa sala
  // não tem o que relatar sobre uma sala.
  //
  // O corpo é pequeno de propósito. Um relato é texto, e um limite generoso aqui
  // transformaria a rota no único lugar do servidor onde qualquer pessoa escreve em disco
  // sem cota de bytes.
  app.post('/api/relato', (req, res, next) => {
    if (!limitarOrigem(req, 'origem-http')) return res.status(429).set('Retry-After', '60').json({ error: 'Muitos pedidos. Aguarde um minuto.' });
    next();
  }, express.json({ limit: MAXIMO_DO_RELATORIO + MAXIMO_DA_MENSAGEM + 2048, strict: true }), (req, res) => {
    const sessao = sessoes.obter(req.headers['x-nexo-sessao']);
    if (!sessao) return res.status(403).json({ error: 'Entre numa sala antes de enviar um relato.' });
    if (!abuso.verificar(sessao.id, 'relato', contexto(sessao)).ok) {
      return res.status(429).set('Retry-After', '60').json({ error: 'Você já enviou um relato agora. Aguarde um minuto.' });
    }
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).json({ error: 'Relato inválido.' });
    // Sem mensagem E sem relatório não há relato: seria uma linha em branco no disco.
    if (!String(corpo.mensagem || '').trim() && !String(corpo.relatorio || '').trim()) {
      return res.status(400).json({ error: 'Escreva o que aconteceu antes de enviar.' });
    }
    const protocolo = relatos.registrar({
      tipo: corpo.tipo,
      mensagem: corpo.mensagem,
      relatorio: corpo.relatorio,
      agenteDoNavegador: req.headers['user-agent'],
      sala: sessao.sala,
      nome: sessao.nome
    });
    res.json({ ok: true, protocolo });
  });
  app.use('/api/relato', (_erro, _req, res, _next) => { if (!res.headersSent) res.status(400).json({ error: 'Não foi possível enviar o relato.' }); });

  app.post('/api/telemetria/livekit', (req, res, next) => {
    // O endereço local não substitui a assinatura: um proxy também chega de localhost.
    if (!origens.permitirGlobal()) return res.status(429).end();
    next();
  }, express.raw({ type: 'application/webhook+json', limit: '64kb' }), (req, res) => {
    try { observador.receber(observador.validar(req.body, req.headers.authorization)); res.status(204).end(); }
    catch (_) { res.status(401).end(); }
  });
  app.use('/api/telemetria', (_erro, _req, res, _next) => res.status(400).end());

  // Este middleware fica antes de static/downloads. Conta bytes entregues ao transporte
  // HTTP do Node, com a mesma limitação explícita dos corpos Socket.IO (sem overhead).
  app.use((req, res, next) => {
    if (req.path.startsWith('/painel') || req.path.startsWith('/api/telemetria') || req.method === 'HEAD') return next();
    let sala = req.path.match(/^\/api\/soundboard\/([a-z0-9_-]{4,32})/)?.[1] || 'servidor';
    const fonte = req.path.startsWith('/api/soundboard/') ? 'soundboard' : 'outros';
    const contar = (pedaco, codificacao) => {
      if (res.statusCode === 204 || res.statusCode === 304 || !pedaco) return;
      const bytes = Buffer.isBuffer(pedaco) || ArrayBuffer.isView(pedaco) ? pedaco.byteLength : Buffer.byteLength(String(pedaco), typeof codificacao === 'string' ? codificacao : 'utf8');
      medicao.registrarServidor(sala, fonte, bytes);
    };
    const escrever = res.write, terminar = res.end;
    res.write = function (p, c, ...resto) { contar(p, c); return escrever.call(this, p, c, ...resto); };
    res.end = function (p, c, ...resto) { contar(p, c); return terminar.call(this, p, c, ...resto); };
    next();
  });

  function limitarOrigem(req, tipo = 'origem-http') {
    return origens.permitirGlobal() && origens.verificar(chaveDaOrigem(req), tipo).ok;
  }
  function prepararSessao(req, res, sala, nome, conta = null) {
    if (!limitarOrigem(req, 'origem-token')) { res.status(429).set('Retry-After', '60').json({ error: 'Muitas entradas. Aguarde um minuto.' }); return null; }
    const emitida = sessoes.emitir({ sala, nome, credencial: req.headers['x-nexo-sessao'], conta });
    if (!emitida) { res.status(503).json({ error: 'O servidor atingiu a capacidade de sessões.' }); return null; }
    if (!abuso.verificar(emitida.sessao.id, 'sala-token', contexto(emitida.sessao)).ok || emitida.sessao.bloqueadaAte > Date.now()) { res.status(429).set('Retry-After', '60').json({ error: 'Aguarde antes de reconectar.' }); return null; }
    return emitida;
  }

  io.use((socket, next) => {
    if (!limitarOrigem(socket.request, 'conexao')) return next(new Error('Muitas conexões. Aguarde um minuto.'));
    const sessao = sessoes.obter(socket.handshake.auth?.credencial);
    if (!sessao || sessao.bloqueadaAte > Date.now() || !sessoes.associar(sessao, socket)) return next(new Error('Sessão inválida. Recarregue a página.'));
    socket.data.sessaoNexo = sessao;
    next();
  });
  function recusar(socket, evento, resultado, args) {
    abuso.contarEvento(socket.data.sessaoNexo.id, evento, true);
    const callback = args.at(-1);
    const erro = { ok: false, error: 'Limite temporário atingido. Aguarde para tentar novamente.', segundos: resultado.segundos || 60 };
    if (typeof callback === 'function') callback(erro);
    if (!socket.data.ultimoAvisoLimite || Date.now() - socket.data.ultimoAvisoLimite > 2000) { socket.data.ultimoAvisoLimite = Date.now(); socket.emit('limite-atingido', { evento, ...erro }); }
    if (resultado.extremo) {
      const sessao = socket.data.sessaoNexo; sessao.bloqueadaAte = Date.now() + 60000;
      alertas.adicionar({ id: crypto.randomUUID(), t: new Date().toISOString(), nome: sessao.nome, sala: sessao.sala, regra: 'flood-persistente', quantidade: 900, teto: 300, segundos: 60, acao: 'desconectado' });
      sfu.consultar('RemoveParticipant', { room: sessao.sala, identity: sessao.identidade }).catch(() => {});
      socket.disconnect(true);
    }
  }
  function instalarSocket(socket) {
    const sessao = socket.data.sessaoNexo;
    socket.use((args, next) => {
      const evento = args[0]; sessao.ultimo = Date.now();
      abuso.contarEvento(sessao.id, evento);
      if (['leave-room', 'audio-stop'].includes(evento)) return next();
      if (!abuso.permitirGlobal()) { recusar(socket, evento, { segundos: 1 }, args); return; }
      let resultado = abuso.verificar(sessao.id, 'total', contexto(sessao));
      if (resultado.ok) resultado = abuso.verificar(sessao.id, evento, contexto(sessao));
      if (resultado.ok && evento === 'chat-message' && args[1]?.imagem) {
        resultado = abuso.verificar(sessao.id, 'chat-imagem', contexto(sessao));
        if (resultado.ok) resultado = abuso.verificar(sessao.id, 'chat-bytes', contexto(sessao), Buffer.byteLength(String(args[1].imagem)));
      }
      if (!resultado.ok) { recusar(socket, evento, resultado, args); return; }
      const responder = args.at(-1);
      if (typeof responder === 'function') args[args.length - 1] = (...dados) => {
        const contar = (fonte, valor) => { try { medicao.registrarServidor(sessao.sala, fonte, Buffer.byteLength(JSON.stringify(valor))); } catch (_) {} };
        if (evento === 'join-room' && dados[0]?.ok) {
          const { historico, soundboard: sons, ...resto } = dados[0];
          contar('chat', historico); contar('soundboard', sons); contar('outros', resto);
        } else contar(evento.startsWith('soundboard-') ? 'soundboard' : evento.startsWith('chat-') ? 'chat' : 'outros', dados);
        return responder(...dados);
      };
      next();
    });
    socket.onAnyOutgoing((evento, ...args) => {
      if (evento === 'limite-atingido') return;
      const fonte = evento.startsWith('chat-') ? 'chat' : evento.startsWith('soundboard-') ? 'soundboard' : 'outros';
      if (evento === 'audio-data') { medicao.registrarServidor(sessao.sala, fonte, args[0]?.byteLength || 0); return; }
      try { medicao.registrarServidor(sessao.sala, fonte, Buffer.byteLength(JSON.stringify([evento, ...args]))); } catch (_) {}
    });
    socket.on('disconnect', () => { uso.sair(sessao.id); sessoes.soltar(sessao, socket); });
  }
  function entrou(socket) { uso.entrar(socket.data.sessaoNexo.id, socket.data.sessaoNexo.sala); }
  function saiu(socket) { uso.sair(socket.data.sessaoNexo.id); }

  function soundboardHttp(req, res, next) {
    if (!limitarOrigem(req)) return res.status(429).set('Retry-After', '60').end();
    const sessao = sessoes.obter(req.headers['x-nexo-sessao']);
    const sala = req.path.split('/')[1];
    if (!sessao || sessao.sala !== sala || !sessao.socket?.connected || !salas().get(sala)?.has(sessao.socket.id)) return res.status(403).json({ error: 'Entre na sala antes de acessar os sons.' });
    req.sessaoNexo = sessao;
    const tipo = req.method === 'POST' ? 'soundboard-upload' : 'soundboard-download';
    if (!abuso.verificar(sessao.id, tipo, contexto(sessao)).ok) return res.status(429).set('Retry-After', '60').json({ error: 'Limite temporário de sons atingido.' });
    if (req.method !== 'POST') return next();
    if (uploads.size >= 2 || uploads.has(sessao.id)) return res.status(429).set('Retry-After', '10').json({ error: 'Aguarde a conversão dos sons em andamento.' });
    uploads.add(sessao.id); let liberado = false, bytes = 0, interrompido = false;
    const liberar = () => { if (!liberado) { liberado = true; uploads.delete(sessao.id); } };
    req.terminarUpload = liberar;
    res.on('close', () => { if (!req.processandoUpload) liberar(); });
    req.on('aborted', () => { if (!req.processandoUpload) liberar(); });
    req.setTimeout(15000, () => req.destroy());
    req.on('data', pedaco => {
      medicao.registrarServidor(sala, 'soundboard', pedaco.length, 'entrada'); bytes += pedaco.length;
      const permitido = abuso.verificar(sessao.id, 'soundboard-bytes', contexto(sessao), pedaco.length).ok;
      if (!interrompido && (!permitido || bytes > soundboard.BYTES_MAXIMOS_DO_SOM)) {
        interrompido = true;
        if (!res.headersSent) res.status(permitido ? 413 : 429).set({ Connection: 'close', 'Retry-After': '60' }).json({ error: 'Limite de upload atingido.' });
        req.pause(); res.once('finish', () => req.destroy()); liberar();
      }
    });
    next();
  }
  function downloadPermitido(req, res, bytes) {
    const s = req.sessaoNexo;
    if (!abuso.verificar(s.id, 'soundboard-download-bytes', contexto(s), bytes).ok) { res.status(429).set('Retry-After', '60').end(); return false; }
    return true;
  }
  function agentePermitido(token, dados, binario, socket) {
    const chave = crypto.createHmac('sha256', segredoDaOrigem).update(token).digest('hex');
    const con = socket?.data.sessaoNexo ? contexto(socket.data.sessaoNexo) : { nome: 'Agente sem navegador pareado' };
    return agentes.permitirGlobal() && agentes.verificar(chave, binario ? 'agente-pacotes' : 'agente-controle', con).ok
      && agentes.verificar(chave, 'agente-bytes', con, Math.max(1, dados.length)).ok;
  }
  function comecarBusca(socket, texto) {
    const comando = texto.match(/^!(\S+)/)?.[1]?.toLowerCase();
    if (comando && !['bot', 'tocar', 'p', 'play', 'toca', 'lista', 'playlist', 'album', 'álbum'].includes(comando)) return () => {};
    const s = socket.data.sessaoNexo;
    const resultado = abuso.verificar(s.id, 'musica-busca', contexto(s));
    if (!resultado.ok || buscas.has(s.id) || buscas.size >= 4 || (buscasPorSala.get(s.sala) || 0) >= 2) { recusar(socket, 'musica-comando', resultado, []); return null; }
    buscas.add(s.id); buscasPorSala.set(s.sala, (buscasPorSala.get(s.sala) || 0) + 1);
    return () => { buscas.delete(s.id); const n = (buscasPorSala.get(s.sala) || 1) - 1; if (n) buscasPorSala.set(s.sala, n); else buscasPorSala.delete(s.sala); };
  }
  sfu.configurarAcesso(req => {
    let token; try { token = new URL(req.url, 'http://local').searchParams.get('access_token'); } catch (_) { return false; }
    const identidade = sfu.identidadeDoToken(token || String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const sessao = identidade && sessoes.localizar(identidade.sala, identidade.identidade);
    // A página do OBS não tem sessão de sala: quem responde por ela é o Estúdio, que só
    // reconhece a identidade oculta que ele mesmo emitiu, para a sala em que ele a emitiu.
    if (!sessao && identidade) return Boolean(aceitarCaptura(identidade));
    if (!sessao || sessao.bloqueadaAte > Date.now()) return false;
    // Um token já emitido continua valendo por minutos, e ser removido da sala não pode
    // esperar por isso. Esta é a terceira porta -- as outras duas são `/api/sala-config` e o
    // `join-room` --, e é a única que fecha para quem já tinha o token na mão.
    if (moderacao?.banido(sessao.sala, { contaId: sessao.contaId || null, nome: sessao.nome })) return false;
    return true;
  });
  medicao.iniciar();
  const timers = [];
  const repetir = (fn, ms) => { const t = setInterval(() => Promise.resolve(fn()).catch(() => {}), ms); t.unref?.(); timers.push(t); };
  async function fecharJanela() {
    // O teto de pessoas no histórico: quantas salas encostaram nele e quantas entradas ele
    // recusou. É o que diz se 25 e 50 são os números certos.
    const teto = tetoDePessoas?.({ zerar: true });
    await gravadorUso.gravar([{ ...uso.fechar(), picoRedeMbps: recursos.retirarPico(), picoLacoMs: recursos.retirarPicoDoLaco(), eventosSfu, telas1440: picoTelas1440,
      salasNoTetoBase: teto?.salasNoTetoBase ?? null, recusasPorLotacao: teto?.recusas ?? null }]);
    picoTelas1440 = null;
    eventosSfu = { publicacoes: 0, republicacoes: 0, entradas: 0, saidas: 0 }; revisao++; leitor.invalidar();
    sessoes.limpar(); if (!auth.falha()) await alertas.gravar();
  }
  repetir(async () => {
    await Promise.all([recursos.coletar(), observador.coletar()]);
    const estado = observador.resumo();
    if (estado.reconciliadoEm && Date.now() - estado.reconciliadoEm < 90000) {
      const total = estado.participantesAtuais.reduce((n, p) => n + p.faixas.filter(f => f.fonte === 'screen_share' && f.altura >= 1440 && !f.muda).length, 0);
      picoTelas1440 = Math.max(picoTelas1440 || 0, total);
    }
  }, 15000);
  // A reconciliação também confere o teto das telas: a webhook só avisa na publicação, e a
  // resolução pode subir depois dela.
  repetir(async () => {
    await observador.reconciliar();
    for (const p of observador.resumo().participantesAtuais) {
      const sessao = sessoes.localizar(p.sala, p.identidade);
      if (!sessao) continue;
      for (const faixa of p.faixas) if (faixa.fonte === 'screen_share' && !faixa.muda) aoFaixaDeTela(sessao, faixa);
    }
  }, 30000);
  repetir(recursos.disco, 300000); repetir(fecharJanela, 60000);
  recursos.coletar().catch(() => {}); recursos.disco().catch(() => {});
  return { prepararSessao, instalarSocket, entrou, saiu, soundboardHttp, downloadPermitido, agentePermitido, comecarBusca, limitarOrigem, sessoes,
    alertar: alertas.adicionar,
    async encerrar() { timers.forEach(clearInterval); rotas.encerrar(); recursos.encerrar(); await leitor.encerrar(); await Promise.all([medicao.encerrar(), fecharJanela()]); await Promise.all([gravadorUso.concluir(), relatos.concluir()]); },
    estado: vivo };
}
module.exports = { iniciarTelemetria };
