// Amigos, o cartão de perfil e as mensagens diretas, pelo lado de fora: o servidor de verdade,
// com cookie, origem e CSRF nas rotas, e o socket `/social` com o cookie no aperto de mão.
// Ver docs/amigos-e-perfil.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const vitrine = require('../public/vitrine');

const SENHA = 'cafe com pao no sabado';

function cliente(origem) {
  let cookie = '';
  let csrf = '';
  async function pedir(caminho, { metodo = 'GET', corpo } = {}) {
    const cabecalhos = { 'Content-Type': 'application/json', Origin: origem };
    if (cookie) cabecalhos.Cookie = cookie;
    if (csrf) cabecalhos['X-Nexo-CSRF'] = csrf;
    const r = await fetch(origem + caminho, { method: metodo, headers: cabecalhos, body: corpo ? JSON.stringify(corpo) : undefined });
    const definido = r.headers.get('set-cookie');
    if (definido) cookie = /Max-Age=0/.test(definido) ? '' : definido.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    const dados = tipo.includes('json') ? await r.json().catch(() => ({})) : await r.text();
    if (dados?.csrf) csrf = dados.csrf;
    return { status: r.status, dados };
  }
  return { pedir, cookie: () => cookie };
}

async function criarConta(servidor, usuario, apelido = usuario) {
  const c = cliente(servidor.origem);
  const r = await c.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario, apelido, senha: SENHA } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return { ...c, conta: r.dados.conta };
}

// O socket `/social` falado à mão, como o helper faz com o da sala: o cookie vai no aperto de mão
// do WebSocket, e a origem também -- é ela que o servidor confere antes de tudo.
async function conectarSocial(origem, cookie) {
  const ws = new WebSocket(origem.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', { headers: { Cookie: cookie, Origin: origem } });
  const recebidos = [], ouvintes = new Set(); let id = 0;
  ws.on('message', bruto => {
    const texto = bruto.toString();
    if (texto === '2') { ws.send('3'); return; }
    recebidos.push(texto);
    for (const ouvir of ouvintes) ouvir(texto);
  });
  function esperar(predicado, timeout = 5000) {
    const existente = recebidos.find(predicado); if (existente) return Promise.resolve(existente);
    return new Promise((resolve, reject) => {
      const prazo = setTimeout(() => { ouvintes.delete(ouvir); reject(new Error('Evento não chegou.')); }, timeout);
      const ouvir = texto => { if (predicado(texto)) { clearTimeout(prazo); ouvintes.delete(ouvir); resolve(texto); } }; ouvintes.add(ouvir);
    });
  }
  await esperar(t => t.startsWith('0'));
  ws.send('40/social,');
  const resposta = await esperar(t => t.startsWith('40/social') || t.startsWith('44/social'));
  if (resposta.startsWith('44')) { ws.close(); throw new Error(resposta); }
  const evento = nome => esperar(t => t.startsWith(`42/social,["${nome}"`)).then(t => JSON.parse(t.slice('42/social,'.length))[1]);
  return {
    recebidos, evento,
    // Espera um evento NOVO: os que já chegaram ficam de fora.
    proximo(nome, timeout) { const ja = recebidos.length; return esperar(t => recebidos.indexOf(t) >= ja && t.startsWith(`42/social,["${nome}"`), timeout).then(t => JSON.parse(t.slice('42/social,'.length))[1]); },
    async pedir(nome, dados) {
      const numero = ++id;
      ws.send(`42/social,${numero}` + JSON.stringify([nome, dados]));
      const texto = await esperar(t => t.startsWith(`43/social,${numero}[`));
      return JSON.parse(texto.slice(`43/social,${numero}`.length))[0];
    },
    emitir(nome, dados) { ws.send('42/social,' + JSON.stringify([nome, dados])); },
    fechar: () => ws.close()
  };
}

test('o catálogo do cartão: forma fechada, o que vale para os outros e as conquistas', () => {
  const limpa = vitrine.limparVitrine({ tema: 'aurora', borda: 'inventada', bio: `oi${String.fromCharCode(0x202e)} tudo`, selos: ['papo', 'nao-existe'], extra: 'x' });
  assert.equal(limpa.tema, 'aurora');
  assert.equal(limpa.borda, 'nenhuma', 'o que não está no catálogo volta ao padrão');
  assert.equal(limpa.bio, 'oi tudo', 'a marca de direção sai');
  assert.deepEqual(limpa.selos, ['papo']);
  assert.equal('extra' in limpa, false);
  // Premium e conquista: guardado, mas não vale para os outros sem o requisito.
  const efetiva = vitrine.vitrineEfetiva({ borda: 'neon', banner: 'chuva', efeito: 'confete', selos: ['papo'] }, { premium: false, conquistas: new Set() });
  assert.equal(efetiva.borda, 'nenhuma');
  assert.equal(efetiva.banner, 'tema');
  assert.equal(efetiva.efeito, 'confete', 'o comum vale para todo mundo');
  assert.deepEqual(efetiva.selos, [], 'só se mostra a conquista ganha');
  const liberada = vitrine.vitrineEfetiva({ borda: 'neon', banner: 'chuva' }, { premium: true, conquistas: new Set(['maratona']) });
  assert.equal(liberada.borda, 'neon');
  assert.equal(liberada.banner, 'chuva');
  // O pensamento vence em 24 horas.
  const agora = Date.now();
  assert.equal(vitrine.vitrineEfetiva({ pensamento: { texto: 'ontem', em: agora - 25 * 3600000 } }, { agora }).pensamento, null);
  assert.equal(vitrine.vitrineEfetiva({ pensamento: { texto: 'agora', em: agora - 3600000 } }, { agora }).pensamento.texto, 'agora');
  // As conquistas: contador, regra e a que não se perde.
  const lista = vitrine.conquistasDe({ contadores: { minutos: 600, salas: 1 }, amigos: 1, criadaEm: agora, agora, jaGanhas: ['turma'] });
  const ganha = id => lista.find(c => c.id === id).ganhou;
  assert.equal(ganha('maratona'), true);
  assert.equal(ganha('primeira-sala'), true);
  assert.equal(ganha('anfitriao'), false);
  assert.equal(ganha('turma'), true, 'desfazer uma amizade não tira a conquista já ganha');
  assert.equal(vitrine.umEmoji('A'), '', 'letra não é emoji');
  assert.equal(vitrine.umEmoji('👍🏽 ok'), '👍🏽', 'o emoji inteiro, com o tom de pele');
});

test('amizade: pedir pelo usuário, aceitar, apelidar só para si, e desfazer', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await criarConta(servidor, 'ana', 'Ana');
  const bia = await criarConta(servidor, 'bia', 'Bia');

  assert.equal((await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: '@ana' } })).status, 400, 'pedir a si mesmo');
  assert.equal((await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: 'ninguem' } })).status, 404);
  const pedido = await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: '@Bia' } });
  assert.equal(pedido.status, 201, JSON.stringify(pedido.dados));
  assert.equal(pedido.dados.estado, 'enviado');
  assert.equal(JSON.stringify(pedido.dados).includes('"id"'), false, 'o id interno não sai do servidor');

  const listaDaBia = (await bia.pedir('/api/conta/amigos')).dados;
  assert.equal(listaDaBia.recebidos.length, 1);
  assert.equal(listaDaBia.recebidos[0].apelido, 'Ana');
  const codigoDaAna = listaDaBia.recebidos[0].codigo;
  assert.equal(codigoDaAna, ana.conta.codigo);

  const aceite = await bia.pedir(`/api/conta/amigos/${codigoDaAna}/aceitar`, { metodo: 'POST' });
  assert.equal(aceite.status, 200, JSON.stringify(aceite.dados));
  assert.equal((await ana.pedir('/api/conta/amigos')).dados.amigos[0].apelido, 'Bia');

  // O apelido vale só para quem deu.
  assert.equal((await bia.pedir(`/api/conta/amigos/${codigoDaAna}/apelido`, { metodo: 'PUT', corpo: { apelido: '  Aninha  ' } })).status, 200);
  assert.equal((await bia.pedir('/api/conta/amigos')).dados.amigos[0].apelidoMeu, 'Aninha');
  assert.equal((await ana.pedir('/api/conta/amigos')).dados.amigos[0].apelidoMeu, null);
  const cartao = await bia.pedir(`/api/conta/pessoa/${codigoDaAna}`);
  assert.equal(cartao.dados.pessoa.relacao, 'amigos');
  assert.equal(cartao.dados.pessoa.apelidoMeu, 'Aninha');

  // Os dados da conta levam os amigos, com o apelido que você deu.
  const dados = await bia.pedir('/api/conta/dados');
  const exportados = typeof dados.dados === 'string' ? JSON.parse(dados.dados) : dados.dados;
  assert.equal(exportados.amigos[0].apelidoQueVoceDeu, 'Aninha');

  assert.equal((await ana.pedir(`/api/conta/amigos/${bia.conta.codigo}`, { metodo: 'DELETE' })).status, 200);
  assert.equal((await bia.pedir('/api/conta/amigos')).dados.amigos.length, 0, 'desfazer vale para os dois lados');
});

test('pedidos cruzados viram amizade, e o bloqueio é silencioso para quem foi bloqueado', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await criarConta(servidor, 'ana2', 'Ana');
  const bia = await criarConta(servidor, 'bia2', 'Bia');
  const caio = await criarConta(servidor, 'caio2', 'Caio');
  await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: bia.conta.codigo } });
  const cruzado = await bia.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: ana.conta.codigo.replace('-', '').toLowerCase() } });
  assert.equal(cruzado.dados.estado, 'amigos', 'quem já tinha sido pedido vira amigo ao pedir de volta (e o código vale sem traço e em minúscula)');

  assert.equal((await caio.pedir(`/api/conta/amigos/${ana.conta.codigo}/bloquear`, { metodo: 'POST' })).status, 200);
  const doBloqueado = await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: '@caio2' } });
  assert.equal(doBloqueado.dados.estado, 'enviado', 'a mesma resposta de sempre');
  assert.equal((await caio.pedir('/api/conta/amigos')).dados.recebidos.length, 0, 'e nada foi criado');
  assert.equal((await caio.pedir('/api/conta/amigos')).dados.bloqueados[0].codigo, ana.conta.codigo);
  assert.equal((await caio.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: '@ana2' } })).status, 409, 'quem bloqueou desbloqueia antes');
});

test('o cartão: salvar, imagem só para premium, e o que a sala recebe', async t => {
  // Planos ligados: o premium deixa de ser de todo mundo, e o que ele libera fica guardado sem valer.
  const servidor = await iniciarServidor({ ambiente: { NEXO_PLANOS: '1' } }); t.after(servidor.encerrar);
  const ana = await criarConta(servidor, 'ana3', 'Ana');
  const salvo = await ana.pedir('/api/conta/vitrine', { metodo: 'PUT', corpo: { vitrine: { tema: 'cereja', borda: 'neon', efeito: 'neve', bio: 'Jogo de tudo um pouco.', pensamento: 'pizza hoje?' } } });
  assert.equal(salvo.status, 200, JSON.stringify(salvo.dados));
  assert.equal(salvo.dados.guardada.borda, 'neon', 'a escolha fica guardada');
  assert.equal(salvo.dados.vitrine.borda, 'nenhuma', 'mas não vale sem o premium');
  assert.equal(salvo.dados.vitrine.efeito, 'neve');
  assert.equal(salvo.dados.vitrine.pensamento.texto, 'pizza hoje?');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const imagem = await fetch(`${servidor.origem}/api/conta/vitrine/imagem/banner`, { method: 'PUT', headers: { Cookie: ana.cookie(), Origin: servidor.origem, 'Content-Type': 'image/png', 'X-Nexo-CSRF': (await ana.pedir('/api/conta/eu')).dados.csrf }, body: png });
  assert.equal(imagem.status, 200);
  const comImagem = await imagem.json();
  assert.match(comImagem.guardada.imagens.banner, /^[a-f0-9]{32}$/);
  assert.equal(comImagem.vitrine.imagens.banner, null, 'a imagem guardada e não escolhida não sai para ninguém');

  const status = await ana.pedir('/api/conta/social', { metodo: 'PUT', corpo: { status: 'ausente', frase: { texto: 'no trabalho', emoji: '💼', ate: Date.now() + 3600000 } } });
  assert.equal(status.status, 200, JSON.stringify(status.dados));
  assert.equal(status.dados.social.status, 'ausente');
  // Sem servidor de mídia a entrada responde 503, mas a sessão sai com o cartão dentro.
  const config = await ana.pedir('/api/sala-config?sala=cartao-teste');
  assert.ok([200, 503].includes(config.status), JSON.stringify(config.dados));
  assert.ok(config.dados.credencialSessao);
});

test('a porta de entrada: com conta é o início, sem conta a apresentação', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const semConta = await (await fetch(servidor.origem + '/')).text();
  assert.match(semConta, /Bora para a sala\?/);
  const ana = await criarConta(servidor, 'ana4', 'Ana');
  const comConta = await fetch(servidor.origem + '/', { headers: { Cookie: ana.cookie() } });
  assert.equal(comConta.headers.get('cache-control'), 'no-store', 'a resposta depende de quem pediu');
  assert.match(await comConta.text(), /id="inicioApp"/);
  assert.match(await (await fetch(servidor.origem + '/sobre', { headers: { Cookie: ana.cookie() } })).text(), /Bora para a sala\?/, 'a apresentação continua em /sobre');
});

test('mensagens diretas: só entre amigos, ao vivo, com lida, convite e presença', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await criarConta(servidor, 'ana5', 'Ana');
  const bia = await criarConta(servidor, 'bia5', 'Bia');
  const caio = await criarConta(servidor, 'caio5', 'Caio');
  await ana.pedir('/api/conta/amigos', { metodo: 'POST', corpo: { alvo: '@bia5' } });
  await bia.pedir(`/api/conta/amigos/${ana.conta.codigo}/aceitar`, { metodo: 'POST' });

  await assert.rejects(conectarSocial(servidor.origem, ''), /sem-conta/, 'sem conta não há socket de amigos');
  const a = await conectarSocial(servidor.origem, ana.cookie()); t.after(a.fechar);
  const pronto = await a.evento('pronto');
  assert.equal(pronto.eu, ana.conta.codigo);
  assert.equal(pronto.presencas[bia.conta.codigo].status, 'offline');

  const b = await conectarSocial(servidor.origem, bia.cookie()); t.after(b.fechar);
  await b.evento('pronto');
  const presenca = await a.proximo('presenca');
  assert.equal(presenca.codigo, bia.conta.codigo);
  assert.equal(presenca.presenca.status, 'online');

  const chegou = b.proximo('dm-mensagem');
  const enviada = await a.pedir('dm-enviar', { para: bia.conta.codigo, texto: `  oi, Bia!${String.fromCharCode(0x202e)}  ` });
  assert.equal(enviada.ok, true, JSON.stringify(enviada));
  assert.equal(enviada.mensagem.texto, 'oi, Bia!');
  const recebida = await chegou;
  assert.equal(recebida.com, ana.conta.codigo);
  assert.equal(recebida.naoLidas, 1);
  const conversas = await b.pedir('dm-conversas', {});
  assert.equal(conversas.conversas[0].com, ana.conta.codigo);

  const vista = a.proximo('dm-lida');
  await b.pedir('dm-lida', { com: ana.conta.codigo });
  assert.equal((await vista).minha, false, 'quem escreveu fica sabendo que foi lida');

  // Não amigo não recebe nada.
  const c = await conectarSocial(servidor.origem, caio.cookie()); t.after(c.fechar);
  await c.evento('pronto');
  assert.equal((await c.pedir('dm-enviar', { para: ana.conta.codigo, texto: 'oi' })).ok, false);

  // O convite chega como mensagem e como aviso.
  const aviso = b.proximo('convite');
  const convite = await a.pedir('convidar', { para: bia.conta.codigo, sala: 'squad-da-noite' });
  assert.equal(convite.ok, true, JSON.stringify(convite));
  assert.equal((await aviso).sala, 'squad-da-noite');
  assert.equal((await a.pedir('convidar', { para: bia.conta.codigo, sala: '../x' })).ok, false);

  // Apagar a própria mensagem apaga para os dois.
  const apagada = b.proximo('dm-apagada');
  assert.equal((await a.pedir('dm-apagar', { com: bia.conta.codigo, id: enviada.mensagem.id })).ok, true);
  assert.equal((await apagada).id, enviada.mensagem.id);
  const historico = await b.pedir('dm-historico', { com: ana.conta.codigo });
  assert.equal(historico.mensagens.length, 1, 'sobrou o convite');
  assert.equal(historico.podeEscrever, true);

  // Invisível aparece desconectado para os amigos.
  const sumiu = a.proximo('presenca');
  await bia.pedir('/api/conta/social', { metodo: 'PUT', corpo: { status: 'invisivel' } });
  assert.equal((await sumiu).presenca.status, 'offline');
});
