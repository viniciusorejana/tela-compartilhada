// Amigos ao vivo: presença, mensagens diretas e convites para salas.
//
// Um namespace próprio do Socket.IO (`/social`), aberto por toda aba de quem tem conta -- o início
// e cada sala. Ele não tem nada a ver com a sessão de sala (telemetria/sessoes.js): quem entra
// aqui é reconhecido pelo cookie da conta, conferido no aperto de mão, e a origem do socket já foi
// conferida pelo servidor (`allowRequest`, server.js) antes de chegar a este arquivo.
//
// ---------- O que mora aqui, e só na memória ----------
//
//   - quem está conectado (as abas de cada conta);
//   - as MENSAGENS DIRETAS: até 60 por conversa, 1.000 caracteres cada, e a conversa some três
//     dias depois da última mensagem, ou quando o servidor reinicia. Decisão, e não descuido: a
//     promessa de que conversa não toca o disco continua valendo (docs/amigos-e-perfil.md).
//   - as IMAGENS das mensagens diretas, também só na memória, e com teto: até 20 por conversa e
//     64 MB no servidor inteiro. Passou do teto, a mais antiga sai primeiro, e a mensagem dela diz
//     que a imagem saiu. Elas não vão dentro da mensagem: cada uma tem um endereço
//     (/api/social/imagem/:id, server.js) que só os dois da conversa abrem -- o histórico continua
//     leve, e quem nunca rola até a imagem nunca a baixa.
//
// Amizades, apelidos e bloqueios são da conta, e moram no banco (contas/amigos.js).
//
// ---------- A presença ----------
//
// "Conectado" é ter o início aberto, ou estar numa sala. O que os amigos veem: o status escolhido
// (invisível aparece desconectado), a frase, e -- se a pessoa deixa -- a sala em que ela está.
// Só amigos: a presença nunca vai para quem não é.
const crypto = require('node:crypto');
const { criarAntiabuso, regrasDoAmbiente } = require('./telemetria/abuso');
const { formatarCodigo, normalizarCodigo } = require('./contas/regras');
const { tipoDosBytes } = require('./contas/imagens');

const DIA = 24 * 60 * 60 * 1000;
const VIDA_DA_CONVERSA = 3 * DIA;
const MENSAGENS_POR_CONVERSA = 60;
const TEXTO_MAXIMO = 1000;
// A imagem chega reduzida pela página (public/imagem-envio.js, até 1280 px), como data URL -- o
// mesmo formato e o mesmo teto do chat da sala, que cabem no limite de um evento do Socket.IO.
const IMAGEM_EM_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/;
const DATA_URL_MAXIMA = 820 * 1024;
const IMAGENS_POR_CONVERSA = 20;
const BYTES_DE_IMAGENS_NO_SERVIDOR = 64 * 1024 * 1024;
const CONVERSAS_NO_SERVIDOR = 20000;
const ABAS_POR_CONTA = 8;
const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;
// Quem entra numa sala muda a contagem de pessoas para os amigos de todo mundo que está nela; meio
// segundo junta uma rajada de entradas num aviso só.
const MS_PARA_JUNTAR_AVISOS = 500;

// Controles e marcas de direção saem do texto, como no apelido (contas/regras.js). A quebra de
// linha fica. A classe é montada pelos códigos: escritos, esses caracteres são invisíveis no arquivo.
const caractere = String.fromCharCode;
const INVISIVEIS = new RegExp(`[${caractere(0)}-${caractere(8)}${caractere(0x0b)}-${caractere(0x1f)}${caractere(0x7f)}${caractere(0x200b)}${caractere(0x200e)}${caractere(0x200f)}${caractere(0x202a)}-${caractere(0x202e)}${caractere(0x2066)}-${caractere(0x2069)}${caractere(0xfeff)}]`, 'g');
const limparTexto = texto => [...String(texto ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
  .replace(INVISIVEIS, '')
  .replace(/\n{3,}/g, '\n\n')].slice(0, TEXTO_MAXIMO).join('').trim();

// `ondeEsta(contaId)` diz a sala em que a conta está agora ({ sala, desde, pessoas, trancada }) ou
// null; `tokenDoPedido(req)` lê o cookie da conta (contas/rotas.js).
function criarSocial({ io, contas, amigos, tokenDoPedido, ondeEsta = () => null, limitarOrigem = () => true, agora = Date.now, regras = regrasDoAmbiente() || {} }) {
  const banco = contas.banco;
  const freio = criarAntiabuso({ agora, regras, maximo: 4096 });
  const abas = new Map();          // contaId -> Set<socket>
  const conversas = new Map();     // 'idA|idB' (ordenados) -> { a, b, mensagens, ultimaEm, lidas }
  const conversasDe = new Map();   // contaId -> Set<chave>
  const avisosPendentes = new Map();
  const codigoDe = new Map();      // contaId -> código formatado (cache: o código nunca muda)
  const imagens = new Map();       // id da imagem -> { bytes, tipo, chave, mensagemId }, na ordem de chegada
  let bytesDeImagens = 0;

  function codigoDaConta(contaId) {
    if (codigoDe.has(contaId)) return codigoDe.get(contaId);
    const conta = contas.contaPorId(contaId);
    const codigo = conta ? formatarCodigo(conta.codigo) : null;
    if (codigo) codigoDe.set(contaId, codigo);
    if (codigoDe.size > 20000) codigoDe.clear();
    return codigo;
  }
  const contaPeloCodigo = codigo => contas.contaPorCodigo(normalizarCodigo(codigo));
  const emitirPara = (contaId, evento, dados) => { for (const aba of abas.get(contaId) || []) aba.emit(evento, dados); };

  // ---------- Presença ----------
  function presencaDe(contaId) {
    const social = contas.socialDe(contaId);
    const onde = ondeEsta(contaId);
    const conectado = abas.has(contaId) || Boolean(onde);
    if (!conectado || social.status === 'invisivel') return { status: 'offline' };
    const sala = social.mostrarSala && onde ? { codigo: onde.sala, pessoas: onde.pessoas, trancada: Boolean(onde.trancada), desde: onde.desde || null } : null;
    return { status: social.status, frase: social.frase, sala };
  }
  // A própria pessoa vê a presença dela como os amigos a veem -- e mais o status escolhido, que
  // não aparece para eles quando é invisível.
  function presencaPropria(contaId) {
    return { ...presencaDe(contaId), escolhido: contas.socialDe(contaId).status };
  }
  function presencasDosAmigos(contaId) {
    const mapa = {};
    for (const amigo of banco.idsDosAmigos(contaId)) {
      const codigo = codigoDaConta(amigo);
      if (codigo) mapa[codigo] = presencaDe(amigo);
    }
    return mapa;
  }
  function anunciarPresenca(contaId) {
    const codigo = codigoDaConta(contaId);
    if (!codigo) return;
    const presenca = presencaDe(contaId);
    for (const amigo of banco.idsDosAmigos(contaId)) emitirPara(amigo, 'presenca', { codigo, presenca });
    emitirPara(contaId, 'minha-presenca', presencaPropria(contaId));
  }
  // Juntado: uma sala que recebe cinco pessoas de uma vez avisa os amigos uma vez.
  function mudouPresenca(contaId) {
    if (!contaId || avisosPendentes.has(contaId)) return;
    const timer = setTimeout(() => { avisosPendentes.delete(contaId); anunciarPresenca(contaId); }, MS_PARA_JUNTAR_AVISOS);
    timer.unref?.();
    avisosPendentes.set(contaId, timer);
  }

  // ---------- Conversas ----------
  const chaveDoPar = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  function indexar(chave, conversa) {
    for (const id of [conversa.a, conversa.b]) {
      if (!conversasDe.has(id)) conversasDe.set(id, new Set());
      conversasDe.get(id).add(chave);
    }
  }
  function esquecerConversa(chave) {
    const conversa = conversas.get(chave);
    if (!conversa) return;
    for (const m of conversa.mensagens) if (m.imagem?.id) largarImagem(m.imagem.id);
    conversas.delete(chave);
    for (const id of [conversa.a, conversa.b]) {
      conversasDe.get(id)?.delete(chave);
      if (conversasDe.get(id)?.size === 0) conversasDe.delete(id);
    }
  }
  function conversaEntre(a, b, criar = false) {
    const chave = chaveDoPar(a, b);
    let conversa = conversas.get(chave);
    if (!conversa && criar) {
      // O servidor guarda um número fixo de conversas; a mais parada sai para a nova entrar.
      while (conversas.size >= CONVERSAS_NO_SERVIDOR) esquecerConversa(conversas.keys().next().value);
      conversa = { a: a < b ? a : b, b: a < b ? b : a, mensagens: [], ultimaEm: agora(), lidas: {} };
      conversas.set(chave, conversa);
      indexar(chave, conversa);
    }
    return conversa ? { chave, conversa } : null;
  }
  // A conversa mexida vai para o fim do mapa: é a ordem em que elas saem quando ele enche.
  function tocar(chave, conversa) {
    conversa.ultimaEm = agora();
    conversas.delete(chave);
    conversas.set(chave, conversa);
  }
  const naoLidas = (conversa, contaId) => {
    const lida = conversa.lidas[contaId] || 0;
    const meu = codigoDaConta(contaId);
    return conversa.mensagens.filter(m => m.em > lida && m.de !== meu).length;
  };
  function resumoDasConversas(contaId) {
    const lista = [];
    for (const chave of conversasDe.get(contaId) || []) {
      const conversa = conversas.get(chave);
      if (!conversa || !conversa.mensagens.length) continue;
      const outro = conversa.a === contaId ? conversa.b : conversa.a;
      const codigo = codigoDaConta(outro);
      if (!codigo) continue;
      lista.push({ com: codigo, ultima: conversa.mensagens.at(-1), naoLidas: naoLidas(conversa, contaId), ultimaEm: conversa.ultimaEm });
    }
    return lista.sort((x, y) => y.ultimaEm - x.ultimaEm);
  }

  // ---------- Imagens ----------
  //
  // A data URL é lida aqui e guardada em bytes; o tipo é o dos BYTES (contas/imagens.js), e não o
  // que a data URL diz: o endereço da imagem é servido com esse tipo, e um "PNG" que fosse outra
  // coisa por dentro não passa.
  function lerImagem(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > DATA_URL_MAXIMA) return { erro: 'A imagem é grande demais. Mande uma menor.' };
    const partes = IMAGEM_EM_DATA_URL.exec(dataUrl);
    if (!partes) return { erro: 'Aceitamos PNG, JPEG, GIF e WebP.' };
    const bytes = Buffer.from(partes[2], 'base64');
    if (tipoDosBytes(bytes) !== `image/${partes[1]}`) return { erro: 'O arquivo não é do tipo que diz ser.' };
    return { bytes, tipo: `image/${partes[1]}` };
  }
  // As dimensões que a página manda servem só para reservar o lugar da imagem antes de ela chegar
  // (a conversa não pula); fora do razoável, ficam de fora.
  const dimensao = valor => (Number.isInteger(valor) && valor > 0 && valor <= 8192 ? valor : null);
  function guardarImagem(chave, mensagemId, { bytes, tipo }) {
    const id = crypto.randomBytes(16).toString('hex');
    imagens.set(id, { bytes, tipo, chave, mensagemId });
    bytesDeImagens += bytes.length;
    return id;
  }
  // Tira a imagem da memória; a mensagem fica, dizendo que a imagem saiu.
  function largarImagem(id) {
    const imagem = imagens.get(id);
    if (!imagem) return;
    imagens.delete(id);
    bytesDeImagens -= imagem.bytes.length;
    const mensagem = conversas.get(imagem.chave)?.mensagens.find(m => m.id === imagem.mensagemId);
    if (mensagem?.imagem) mensagem.imagem = { saiu: true };
  }
  // Os tetos: as 20 mais novas de cada conversa, e 64 MB no servidor. A mais antiga sai primeiro.
  function caberImagens(conversa) {
    const comImagem = conversa.mensagens.filter(m => m.imagem?.id);
    for (const m of comImagem.slice(0, Math.max(0, comImagem.length - IMAGENS_POR_CONVERSA))) largarImagem(m.imagem.id);
    while (bytesDeImagens > BYTES_DE_IMAGENS_NO_SERVIDOR && imagens.size) largarImagem(imagens.keys().next().value);
  }
  // A imagem de uma mensagem, para quem é da conversa -- e só para quem é.
  function imagemPara(contaId, id) {
    const imagem = imagens.get(String(id || ''));
    const conversa = imagem && conversas.get(imagem.chave);
    if (!conversa || (conversa.a !== contaId && conversa.b !== contaId)) return null;
    return { bytes: imagem.bytes, tipo: imagem.tipo };
  }

  // Uma mensagem nova numa conversa, para os dois lados. `com` é sempre a OUTRA pessoa, do ponto
  // de vista de quem recebe o evento.
  function publicar(de, para, mensagem) {
    const { chave, conversa } = conversaEntre(de.id, para.id, true);
    conversa.mensagens.push(mensagem);
    while (conversa.mensagens.length > MENSAGENS_POR_CONVERSA) {
      const saiu = conversa.mensagens.shift();
      if (saiu.imagem?.id) largarImagem(saiu.imagem.id);
    }
    caberImagens(conversa);
    // Quem escreve leu tudo até a própria mensagem.
    conversa.lidas[de.id] = mensagem.em;
    tocar(chave, conversa);
    emitirPara(para.id, 'dm-mensagem', { com: formatarCodigo(de.codigo), mensagem, naoLidas: naoLidas(conversa, para.id) });
    emitirPara(de.id, 'dm-mensagem', { com: formatarCodigo(para.codigo), mensagem, naoLidas: 0 });
  }

  const limpeza = setInterval(() => {
    const limite = agora() - VIDA_DA_CONVERSA;
    for (const [chave, conversa] of conversas) if (conversa.ultimaEm < limite) esquecerConversa(chave);
  }, 10 * 60 * 1000);
  limpeza.unref?.();

  // ---------- O namespace ----------
  const ns = io.of('/social');
  ns.use((socket, next) => {
    if (!limitarOrigem(socket.request, 'social-conexao')) return next(new Error('Muitas conexões. Aguarde um minuto.'));
    const achada = contas.sessao(tokenDoPedido(socket.request));
    if (!achada) return next(new Error('sem-conta'));
    if ((abas.get(achada.conta.id)?.size || 0) >= ABAS_POR_CONTA) return next(new Error('Abas demais abertas com esta conta.'));
    socket.data.contaId = achada.conta.id;
    socket.data.sessaoId = achada.sessaoId;
    next();
  });

  ns.on('connection', socket => {
    const contaId = socket.data.contaId;
    const primeira = !abas.has(contaId);
    if (primeira) abas.set(contaId, new Set());
    abas.get(contaId).add(socket);

    // Cada evento passa pelo freio da conta, e pelo total. Um evento sem regra cai em 'outros'.
    socket.use((args, next) => {
      const evento = args[0];
      const tipo = { 'dm-enviar': 'dm-enviar', convidar: 'convidar', 'dm-digitando': 'dm-digitando' }[evento] || 'dm-acao';
      const total = freio.verificar(contaId, 'social-total');
      const resultado = total.ok ? freio.verificar(contaId, tipo) : total;
      if (resultado.ok) return next();
      const responder = args.at(-1);
      if (typeof responder === 'function') responder({ ok: false, error: 'Devagar: muitas mensagens em pouco tempo. Aguarde um instante.', segundos: resultado.segundos || 5 });
    });

    socket.emit('pronto', { eu: codigoDaConta(contaId), presencas: presencasDosAmigos(contaId), conversas: resumoDasConversas(contaId), minha: presencaPropria(contaId) });
    if (primeira) mudouPresenca(contaId);

    const conta = () => contas.contaPorId(contaId);
    const responderCom = fn => (dados, responder) => {
      const resposta = typeof responder === 'function' ? responder : () => {};
      try { resposta(fn(dados || {})); } catch (erro) { console.error('Social:', erro?.message || erro); resposta({ ok: false, error: 'Não foi possível concluir. Tente de novo.' }); }
    };

    socket.on('dm-conversas', responderCom(() => ({ ok: true, conversas: resumoDasConversas(contaId) })));

    socket.on('dm-historico', responderCom(({ com }) => {
      const outro = contaPeloCodigo(com);
      if (!outro) return { ok: false, error: 'Essa conta não existe mais.' };
      const achada = conversaEntre(contaId, outro.id);
      return {
        ok: true, mensagens: achada?.conversa.mensagens || [],
        lidaPeloOutro: achada?.conversa.lidas[outro.id] || 0,
        podeEscrever: amigos.saoAmigos(contaId, outro.id) && !banco.bloqueioEntre(contaId, outro.id)
      };
    }));

    // Texto, imagem, ou os dois: a imagem vai junto da legenda, como no chat da sala.
    socket.on('dm-enviar', responderCom(({ para, texto, imagem, largura, altura }) => {
      const eu = conta();
      const outro = contaPeloCodigo(para);
      if (!eu || !outro || contas.suspensa(outro)) return { ok: false, error: 'Essa conta não existe mais.' };
      // Só entre amigos, e nunca com bloqueio no meio -- em qualquer direção.
      if (!amigos.saoAmigos(eu.id, outro.id) || banco.bloqueioEntre(eu.id, outro.id)) return { ok: false, error: 'Mensagem direta é só entre amigos.' };
      const limpo = limparTexto(texto);
      let lida = null;
      if (imagem) {
        lida = lerImagem(imagem);
        if (lida.erro) return { ok: false, error: lida.erro };
        const freada = freio.verificar(contaId, 'dm-imagem');
        if (!freada.ok) return { ok: false, error: 'Imagens demais em pouco tempo. Aguarde um instante.', segundos: freada.segundos || 10 };
      }
      if (!limpo && !lida) return { ok: false, error: 'A mensagem está vazia.' };
      const mensagem = { id: crypto.randomUUID(), de: formatarCodigo(eu.codigo), texto: limpo, em: agora(), tipo: 'texto' };
      if (lida) {
        const { chave } = conversaEntre(eu.id, outro.id, true);
        mensagem.imagem = { id: guardarImagem(chave, mensagem.id, lida), largura: dimensao(largura), altura: dimensao(altura) };
      }
      publicar(eu, outro, mensagem);
      return { ok: true, mensagem };
    }));

    // O convite é uma mensagem com a sala dentro, e um aviso a mais para quem recebe: ele aparece
    // no canto de qualquer aba em que a pessoa esteja, inclusive no meio de outra chamada.
    socket.on('convidar', responderCom(({ para, sala }) => {
      const eu = conta();
      const outro = contaPeloCodigo(para);
      const codigo = String(sala || '').toLowerCase();
      if (!CODIGO_DE_SALA.test(codigo)) return { ok: false, error: 'Código de sala inválido.' };
      if (!eu || !outro || contas.suspensa(outro)) return { ok: false, error: 'Essa conta não existe mais.' };
      if (!amigos.saoAmigos(eu.id, outro.id) || banco.bloqueioEntre(eu.id, outro.id)) return { ok: false, error: 'Convites são só entre amigos.' };
      const mensagem = { id: crypto.randomUUID(), de: formatarCodigo(eu.codigo), texto: `Bora para a sala #${codigo}?`, em: agora(), tipo: 'convite', sala: codigo };
      publicar(eu, outro, mensagem);
      emitirPara(outro.id, 'convite', { de: formatarCodigo(eu.codigo), apelido: eu.apelido, sala: codigo, id: mensagem.id });
      return { ok: true, mensagem };
    }));

    socket.on('dm-lida', responderCom(({ com }) => {
      const outro = contaPeloCodigo(com);
      const achada = outro && conversaEntre(contaId, outro.id);
      if (!achada) return { ok: true };
      const em = achada.conversa.mensagens.at(-1)?.em || agora();
      achada.conversa.lidas[contaId] = Math.max(achada.conversa.lidas[contaId] || 0, em);
      // As outras abas da pessoa apagam a contagem; quem escreveu vê "visto".
      emitirPara(contaId, 'dm-lida', { com: formatarCodigo(outro.codigo), em, minha: true });
      emitirPara(outro.id, 'dm-lida', { com: codigoDaConta(contaId), em, minha: false });
      return { ok: true };
    }));

    // Apagar a própria mensagem apaga para os dois.
    socket.on('dm-apagar', responderCom(({ com, id }) => {
      const outro = contaPeloCodigo(com);
      const achada = outro && conversaEntre(contaId, outro.id);
      const meu = codigoDaConta(contaId);
      const indice = achada ? achada.conversa.mensagens.findIndex(m => m.id === String(id || '') && m.de === meu) : -1;
      if (indice < 0) return { ok: false, error: 'Mensagem não encontrada.' };
      const [apagada] = achada.conversa.mensagens.splice(indice, 1);
      if (apagada.imagem?.id) largarImagem(apagada.imagem.id);
      emitirPara(contaId, 'dm-apagada', { com: formatarCodigo(outro.codigo), id });
      emitirPara(outro.id, 'dm-apagada', { com: meu, id });
      return { ok: true };
    }));

    socket.on('dm-digitando', ({ para } = {}) => {
      const outro = contaPeloCodigo(para);
      if (outro && amigos.saoAmigos(contaId, outro.id) && !banco.bloqueioEntre(contaId, outro.id)) emitirPara(outro.id, 'dm-digitando', { com: codigoDaConta(contaId) });
    });

    socket.on('disconnect', () => {
      const conjunto = abas.get(contaId);
      conjunto?.delete(socket);
      if (conjunto && !conjunto.size) { abas.delete(contaId); mudouPresenca(contaId); }
    });
  });

  // ---------- O que o servidor avisa daqui ----------

  // A lista de amizades dessas contas mudou (pedido, aceite, desfeita, bloqueio, apelido): as abas
  // delas pedem a lista de novo, e quem acabou de virar amigo recebe a presença do outro.
  function mudouAmizade(contaIds, motivo) {
    for (const id of contaIds) {
      emitirPara(id, 'amigos-mudou', { motivo });
      emitirPara(id, 'presencas', presencasDosAmigos(id));
    }
  }

  // O cartão de alguém mudou (foto, apelido, vitrine, frase): os amigos pedem a lista de novo.
  function mudouPerfil(contaId) {
    for (const amigo of banco.idsDosAmigos(contaId)) emitirPara(amigo, 'amigos-mudou', { motivo: 'perfil' });
    emitirPara(contaId, 'amigos-mudou', { motivo: 'perfil' });
    mudouPresenca(contaId);
  }

  // Alguém entrou, saiu ou a sala mudou de tranca: quem tem conta ali muda de presença.
  function mudouSala(contaIds) { for (const id of contaIds) mudouPresenca(id); }

  function conquistou(contaId, conquista) { emitirPara(contaId, 'conquista', conquista); }

  // O que o aplicativo Android pergunta quando a página dele está parada (o Android congela o
  // aplicativo que saiu da tela, e o socket vai junto): as conversas com mensagem não lida e os
  // pedidos de amizade esperando. Só o que vira notificação -- o texto vai curto, a imagem vira
  // "imagem", e nada de quem não é amigo (um bloqueio desfaz a amizade, então sai daqui também).
  function avisosPara(contaId) {
    const conta = contas.contaPorId(contaId);
    if (!conta) return null;
    const lista = amigos.lista(conta);
    const nomes = new Map(lista.amigos.map(p => [p.codigo, p.apelidoMeu || p.apelido]));
    const meu = codigoDaConta(contaId);
    const conversasNaoLidas = [];
    for (const chave of conversasDe.get(contaId) || []) {
      const conversa = conversas.get(chave);
      if (!conversa) continue;
      const com = codigoDaConta(conversa.a === contaId ? conversa.b : conversa.a);
      if (!nomes.has(com)) continue;
      const lida = conversa.lidas[contaId] || 0;
      const novas = conversa.mensagens.filter(m => m.em > lida && m.de !== meu);
      if (!novas.length) continue;
      conversasNaoLidas.push({
        com, nome: nomes.get(com), naoLidas: novas.length,
        mensagens: novas.slice(-5).map(m => ({ id: m.id, em: m.em, tipo: m.tipo, sala: m.sala || null, texto: m.texto.slice(0, 200), imagem: Boolean(m.imagem) }))
      });
    }
    conversasNaoLidas.sort((x, y) => y.mensagens.at(-1).em - x.mensagens.at(-1).em);
    return {
      // "Não incomodar" segura as mensagens, como o aviso no canto da página; convites passam.
      naoIncomodar: contas.socialDe(contaId).status === 'ocupado',
      conversas: conversasNaoLidas.slice(0, 10),
      pedidos: lista.recebidos.slice(0, 10).map(p => ({ codigo: p.codigo, nome: p.apelido, desde: p.desde || 0 }))
    };
  }

  // A conta foi apagada: as conversas dela somem agora, e não em três dias.
  function esquecerConta(contaId) {
    for (const chave of [...(conversasDe.get(contaId) || [])]) esquecerConversa(chave);
    for (const aba of abas.get(contaId) || []) aba.disconnect(true);
    abas.delete(contaId);
    codigoDe.delete(contaId);
  }

  return {
    mudouAmizade, mudouPerfil, mudouSala, mudouPresenca, conquistou, esquecerConta, presencaDe, imagemPara, avisosPara,
    conectado: contaId => abas.has(contaId),
    estado: () => ({ contasConectadas: abas.size, conversas: conversas.size, imagens: imagens.size, bytesDeImagens }),
    encerrar() { clearInterval(limpeza); for (const timer of avisosPendentes.values()) clearTimeout(timer); avisosPendentes.clear(); },
    VIDA_DA_CONVERSA, MENSAGENS_POR_CONVERSA, TEXTO_MAXIMO
  };
}

module.exports = { criarSocial, VIDA_DA_CONVERSA, MENSAGENS_POR_CONVERSA, TEXTO_MAXIMO };
