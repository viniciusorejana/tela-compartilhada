// As rotas da conta. A regra está em index.js; aqui fica só o que é HTTP: cookie, CSRF,
// origem, código de resposta.
//
// O cookie segue o formato do painel -- HttpOnly, SameSite=Strict, Secure atrás de HTTPS --,
// com duas diferenças: vale para o site inteiro (a sala precisa dele) e dura 30 dias desde o
// último uso, e não oito horas.
const express = require('express');
const crypto = require('node:crypto');
const { FilaCheia, VALIDADE_DA_SESSAO } = require('./index');
const { origemDaPaginaPermitida, pedidoSeguro } = require('../telemetria/origem');

const COOKIE = 'nexo_conta';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function tokenDoPedido(req) {
  const partes = String(req.headers?.cookie || '').split(';').map(p => p.trim());
  const valor = partes.find(p => p.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return TOKEN.test(valor || '') ? valor : null;
}

function cookie(req, valor, maxAge) {
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${pedidoSeguro(req) ? '; Secure' : ''}`;
}
const gravarCookie = (req, res, token) => res.append('Set-Cookie', cookie(req, token, Math.floor(VALIDADE_DA_SESSAO / 1000)));
const apagarCookie = (req, res) => res.append('Set-Cookie', cookie(req, '', 0));

const iguais = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// `aoMudarPerfil(conta)` é chamado depois de salvar apelido, cor, marca ou foto: server.js leva
// a mudança às salas em que essa conta está agora, sem ninguém precisar sair e voltar.
//
// `estudio` é a parte ao vivo do Estúdio (estudio-ao-vivo.js): quem está na sala do diretor,
// os links assinados e o aviso de que a configuração mudou. Sem ela, as rotas do Estúdio não
// existem -- os testes de conta sobem sem sala nenhuma.
function instalarRotasDeContas(app, { contas, limitarOrigem = () => true, abrirSemConta = false, planosLigados = true, novidadesAutomaticas = true, aoMudarPerfil = () => {}, estudio = null }) {
  const json = express.json({ limit: 8 * 1024, strict: true });
  const imagemCrua = limite => express.raw({ type: () => true, limit: limite });

  // ---------- As imagens ----------
  //
  // Fora de /api/conta de propósito: a imagem é pedida por quem NÃO tem a conta -- cada pessoa
  // da sala, e a página do OBS, que roda num navegador sem cookie nenhum. O endereço é o id
  // sorteado de 128 bits; quem o tem pode ver a imagem, e é para isso que ele foi entregue.
  //
  // O que sai daqui nunca roda: tipo fixo lido do banco (que só guardou o que os bytes
  // provaram ser), `nosniff`, e uma CSP que bloqueia tudo -- até quem abrir o endereço direto
  // numa aba recebe uma imagem, e só.
  app.get('/api/imagem/:id', (req, res) => {
    if (!limitarOrigem(req, 'imagem')) return res.status(429).set('Retry-After', '60').end();
    const imagem = contas.imagem(String(req.params.id || ''));
    if (!imagem) return res.status(404).end();
    res.set({
      'Content-Type': imagem.tipo, 'Content-Length': String(imagem.tamanho),
      // O id muda a cada envio e a imagem nunca muda depois de guardada.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    res.end(Buffer.from(imagem.bytes));
  });

  app.use('/api/conta', (req, res, next) => {
    // Resposta de conta nunca fica em cache de ninguém: ela diz quem está logado.
    res.set('Cache-Control', 'no-store');
    // Toda escrita exige a origem de uma página deste servidor. Com o cookie SameSite=Strict
    // isto é a segunda tranca, e não a primeira -- mas é a que continua valendo num navegador
    // antigo que ignore o SameSite.
    if (!['GET', 'HEAD'].includes(req.method) && !origemDaPaginaPermitida(req, { exigir: true })) {
      return res.status(403).json({ error: 'Pedido recusado.' });
    }
    next();
  });

  // Uma rota assíncrona que falha por fila cheia responde 429 na hora, em vez de esperar.
  const tratar = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(erro => {
    if (erro instanceof FilaCheia) return res.status(429).set('Retry-After', '2').json({ error: erro.message });
    next(erro);
  });
  const recusar = (res, r) => {
    if (r.segundos) res.set('Retry-After', String(r.segundos));
    return res.status(r.status || 400).json({ error: r.error, campo: r.campo || undefined });
  };
  const limitada = tipo => (req, res, next) => {
    if (!limitarOrigem(req, tipo)) return res.status(429).set('Retry-After', '60').json({ error: 'Muitas tentativas desta rede. Aguarde alguns minutos.' });
    next();
  };

  // Lê a sessão e, quando ela foi tocada, renova o prazo do cookie junto com o do banco.
  function sessaoDoPedido(req, res) {
    const token = tokenDoPedido(req);
    const achada = contas.sessao(token);
    if (achada?.tocada) gravarCookie(req, res, token);
    return achada ? { ...achada, token } : null;
  }
  const autenticada = (req, res, next) => {
    const achada = sessaoDoPedido(req, res);
    if (!achada) return res.status(401).json({ error: 'Sua sessão terminou. Entre na conta de novo.' });
    // Leitura não pede CSRF: o cookie Strict não vai num pedido de outro site, e nenhum site de
    // fora consegue ler a resposta de um GET daqui.
    if (req.method !== 'GET' && !iguais(req.headers['x-nexo-csrf'], achada.csrf)) return res.status(403).json({ error: 'Pedido recusado. Recarregue a página.' });
    req.contaNexo = achada;
    next();
  };

  // "Quem sou eu" responde 200 mesmo sem conta. Sem conta é o estado normal da maioria das
  // visitas, e um 401 aqui encheria o console de toda página de um erro que não é erro.
  app.get('/api/conta/eu', (req, res) => {
    const achada = sessaoDoPedido(req, res);
    // `abrirSemConta` diz à página inicial se "Criar minha sala" pede conta: na janela de
    // transição (NEXO_ANONIMO_ABRE_SALA) ainda não pede.
    // `planosLigados` diz à sala se ela deve mostrar os cadeados antes mesmo de entrar.
    // `novidadesAutomaticas` diz se a apresentação pode abrir sozinha (NEXO_NOVIDADES).
    if (!achada) return res.json({ conta: null, abrirSemConta, planosLigados, novidadesAutomaticas });
    res.json({ conta: contas.publica(achada.conta), perfil: contas.perfil(achada.conta), csrf: achada.csrf, abrirSemConta, planosLigados, novidadesAutomaticas });
  });

  app.put('/api/conta/perfil', json, autenticada, (req, res) => {
    const { apelido, cor, marca } = req.body || {};
    const r = contas.salvarPerfil(req.contaNexo.conta, { apelido, cor, marca });
    if (!r.ok) return recusar(res, r);
    try { aoMudarPerfil(r.conta); } catch (erro) { console.error('Perfil nas salas:', erro?.message || erro); }
    res.json({ conta: contas.publica(r.conta), perfil: r.perfil });
  });

  app.put('/api/conta/ajustes', json, autenticada, (req, res) => {
    const r = contas.salvarAjustes(req.contaNexo.conta, req.body?.ajustes);
    if (!r.ok) return recusar(res, r);
    res.json({ ajustes: r.ajustes });
  });

  // A foto de perfil. A sessão é conferida ANTES de ler o corpo: sem conta, o meio megabyte
  // nem chega a ser recebido.
  const avisarPerfil = conta => { try { aoMudarPerfil(conta); } catch (erro) { console.error('Perfil nas salas:', erro?.message || erro); } };
  app.put('/api/conta/avatar', autenticada, imagemCrua('6mb'), (req, res) => {
    const r = contas.salvarAvatar(req.contaNexo.conta, { bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), tipo: req.headers['content-type'] });
    if (!r.ok) return recusar(res, r);
    avisarPerfil(r.conta);
    res.json({ conta: contas.publica(r.conta), perfil: r.perfil });
  });
  app.delete('/api/conta/avatar', autenticada, (req, res) => {
    const r = contas.apagarAvatar(req.contaNexo.conta);
    if (!r.ok) return recusar(res, r);
    avisarPerfil(r.conta);
    res.json({ conta: contas.publica(r.conta), perfil: r.perfil });
  });

  // O rosto da pessoa nos Estúdios dos outros: uma imagem por estado (parado, falando, mudo,
  // ensurdecido). É perfil, como a foto: a sala e as fontes do OBS ficam sabendo na hora.
  app.put('/api/conta/rosto/:estado', autenticada, imagemCrua('12mb'), (req, res) => {
    const r = contas.salvarRosto(req.contaNexo.conta, String(req.params.estado || ''), { bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), tipo: req.headers['content-type'] });
    if (!r.ok) return recusar(res, r);
    avisarPerfil(r.conta);
    res.json({ conta: contas.publica(r.conta), perfil: r.perfil });
  });
  app.delete('/api/conta/rosto/:estado', autenticada, (req, res) => {
    const r = contas.apagarRosto(req.contaNexo.conta, String(req.params.estado || ''));
    if (!r.ok) return recusar(res, r);
    avisarPerfil(r.conta);
    res.json({ conta: contas.publica(r.conta), perfil: r.perfil });
  });

  // ---------- O Estúdio ----------
  if (estudio) {
    const jsonDoEstudio = express.json({ limit: 32 * 1024, strict: true });
    // Tudo o que o painel do Estúdio precisa numa ida só: a configuração, as imagens, e quem
    // está na sala em que a pessoa está agora -- é dali que saem os links de cada fonte.
    const retrato = conta => ({ ...contas.estudio(conta), ...estudio.retrato(conta) });

    app.get('/api/conta/estudio', autenticada, (req, res) => res.json(retrato(req.contaNexo.conta)));

    app.put('/api/conta/estudio', jsonDoEstudio, autenticada, (req, res) => {
      const r = contas.salvarEstudio(req.contaNexo.conta, req.body?.config);
      if (!r.ok) return recusar(res, r);
      estudio.mudouConta(req.contaNexo.conta.id);
      res.json({ config: r.config });
    });

    app.post('/api/conta/estudio/imagens', autenticada, imagemCrua('12mb'), (req, res) => {
      const r = contas.adicionarImagemDoEstudio(req.contaNexo.conta, { bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), tipo: req.headers['content-type'] });
      if (!r.ok) return recusar(res, r);
      res.status(201).json({ imagem: r.imagem });
    });

    app.delete('/api/conta/estudio/imagens/:id', autenticada, (req, res) => {
      const r = contas.apagarImagemDoEstudio(req.contaNexo.conta, String(req.params.id || ''));
      if (!r.ok) return recusar(res, r);
      estudio.mudouConta(req.contaNexo.conta.id);
      res.json({ config: r.config });
    });

    // Um link novo para uma pessoa (pela chave: código de conta ou nome) e uma fonte, ou para os
    // rostos que reagem. Criar não pede nada da pessoa: quem decide se aparece é ela, na hora
    // em que a captura acontece (estudio-ao-vivo.js).
    app.post('/api/conta/estudio/link', json, autenticada, (req, res) => {
      const r = estudio.criarLink(req.contaNexo.conta, req.body || {});
      if (!r.ok) return recusar(res, r);
      res.json({ caminho: r.caminho });
    });

    // Achar alguém para dar uma imagem: pelo código de conta, ou pelo nome de quem entra sem.
    // Com freio por conta: sem ele, a rota viraria um jeito de varrer códigos e colher apelidos.
    app.post('/api/conta/estudio/pessoa', json, autenticada, (req, res) => {
      if (!contas.permitidoParaAConta(req.contaNexo.conta.id, 'conta-busca')) return res.status(429).set('Retry-After', '60').json({ error: 'Buscas demais em pouco tempo. Aguarde um minuto.' });
      const r = estudio.acharPessoa(req.body || {});
      if (!r.ok) return recusar(res, r);
      res.json({ pessoa: r.pessoa });
    });

    app.post('/api/conta/estudio/revogar', autenticada, (req, res) => {
      const r = contas.revogarEstudio(req.contaNexo.conta);
      if (!r.ok) return recusar(res, r);
      estudio.mudouConta(req.contaNexo.conta.id);
      res.json({ geracao: r.geracao });
    });
  }

  app.get('/api/conta/dados', autenticada, (req, res) => {
    const dia = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="nexo-meus-dados-${dia}.json"`);
    res.type('application/json').send(JSON.stringify(contas.dados(req.contaNexo.conta), null, 2));
  });

  // Duas contas diferentes: `cadastrar-tentativa` segura quem varre nomes de usuário, e o teto
  // diário (`cadastrar`) conta só as contas que de fato seriam criadas -- contas.cadastrar
  // pergunta por ele depois de conferir o pedido.
  app.post('/api/conta/cadastrar', limitada('cadastrar-tentativa'), json, tratar(async (req, res) => {
    const { usuario, apelido, senha } = req.body || {};
    const r = await contas.cadastrar({ usuario, apelido, senha, agente: req.headers['user-agent'], permitirCriacao: () => limitarOrigem(req, 'cadastrar') });
    if (!r.ok) return recusar(res, r);
    gravarCookie(req, res, r.token);
    res.status(201).json({ conta: contas.publica(r.conta), csrf: contas.csrfDe(r.token), recuperacao: r.recuperacao });
  }));

  app.post('/api/conta/entrar', limitada('entrar'), json, tratar(async (req, res) => {
    const { usuario, senha } = req.body || {};
    const r = await contas.entrar({ usuario, senha, agente: req.headers['user-agent'] });
    if (!r.ok) return recusar(res, r);
    // Entrar de novo no mesmo navegador troca a sessão, em vez de acumular duas.
    contas.sair(tokenDoPedido(req));
    gravarCookie(req, res, r.token);
    res.json({ conta: contas.publica(r.conta), perfil: contas.perfil(r.conta), csrf: contas.csrfDe(r.token) });
  }));

  // O formato do código e a senha nova são conferidos ANTES do freio da rede: são erros de
  // digitação, e antes três deles gastavam a cota de quem estava com o código certo na mão.
  const recuperacaoBemFormada = (req, res, next) => {
    const problema = contas.problemaNaRecuperacao(req.body || {});
    if (problema) return recusar(res, problema);
    next();
  };
  app.post('/api/conta/recuperar', json, recuperacaoBemFormada, limitada('recuperar'), tratar(async (req, res) => {
    const { usuario, codigo, nova } = req.body || {};
    const r = await contas.recuperar({ usuario, codigo, nova, agente: req.headers['user-agent'] });
    if (!r.ok) return recusar(res, r);
    if (r.suspensa) return res.json({ conta: null, recuperacao: r.recuperacao, suspensa: true });
    gravarCookie(req, res, r.token);
    res.json({ conta: contas.publica(r.conta), perfil: contas.perfil(r.conta), csrf: contas.csrfDe(r.token), recuperacao: r.recuperacao });
  }));

  // Sair não exige CSRF: o pior que um site de fora conseguiria é deslogar alguém, e exigir o
  // token aqui deixaria preso quem está com a sessão já vencida.
  app.post('/api/conta/sair', (req, res) => {
    contas.sair(tokenDoPedido(req));
    apagarCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/conta/senha', json, autenticada, tratar(async (req, res) => {
    const r = await contas.trocarSenha(req.contaNexo.conta, req.contaNexo.sessaoId, req.body || {});
    if (!r.ok) return recusar(res, r);
    res.json({ ok: true });
  }));

  app.post('/api/conta/recuperacao', json, autenticada, tratar(async (req, res) => {
    const r = await contas.novaRecuperacao(req.contaNexo.conta, req.body || {});
    if (!r.ok) return recusar(res, r);
    res.json({ recuperacao: r.recuperacao });
  }));

  app.post('/api/conta/apagar', json, autenticada, tratar(async (req, res) => {
    const r = await contas.apagar(req.contaNexo.conta, req.body || {});
    if (!r.ok) return recusar(res, r);
    apagarCookie(req, res);
    res.json({ ok: true });
  }));

  app.use('/api/conta', (erro, _req, res, _next) => {
    if (res.headersSent) return;
    if (erro?.type === 'entity.too.large') return res.status(413).json({ error: 'Pedido grande demais.' });
    if (erro?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Pedido inválido.' });
    console.error('Contas:', erro?.message || erro);
    res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' });
  });

  return { tokenDoPedido, sessaoDoPedido };
}

module.exports = { instalarRotasDeContas, tokenDoPedido, COOKIE };
