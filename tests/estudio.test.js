// O Estúdio: o link assinado, a chave de cada pessoa, a configuração dos rostos, as imagens da
// conta e o namespace `/estudio` pelo lado de fora, com o servidor de verdade (sem mídia).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const estudio = require('../estudio');
const { tipoDosBytes, conferirImagem } = require('../contas/imagens');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

const SENHA = 'cafe com pao no sabado';
const SEGREDO = Buffer.alloc(32, 7);

// ---------- O link ----------

test('o link vai e volta, e qualquer mudança nele o invalida', () => {
  const a = estudio.criarAssinador(SEGREDO);
  const link = a.criar({ tipo: 'fonte', diretor: 'k7m2-pq4x', geracao: 3, alvo: 'c:ABCD2345', fonte: 'camera', nome: 'Ana' });
  assert.deepEqual(a.ler(link), { tipo: 'fonte', diretor: 'K7M2PQ4X', geracao: 3, alvo: 'c:ABCD2345', fonte: 'camera', nome: 'Ana' });
  assert.match(link, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/, 'cabe numa URL sem escapar nada');

  const [corpo, assinatura] = link.split('.');
  const forjado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, 'base64url')), a: 'c:ZZZZ2345' })).toString('base64url');
  assert.equal(a.ler(`${forjado}.${assinatura}`), null, 'trocar a pessoa sem a chave do servidor não passa');
  assert.equal(a.ler(`${corpo}.${assinatura.slice(0, -1)}A`), null);
  assert.equal(estudio.criarAssinador(Buffer.alloc(32, 8)).ler(link), null, 'outro servidor não reconhece o link');
  assert.equal(a.ler(`${link}.x`), null);
  assert.equal(a.ler('x'.repeat(700)), null);
  assert.equal(a.ler(null), null);
});

test('o link dos rostos pode ser do grupo ou de uma pessoa; o de fonte exige pessoa e fonte', () => {
  const a = estudio.criarAssinador(SEGREDO);
  assert.equal(a.ler(a.criar({ tipo: 'reativo', diretor: 'K7M2PQ4X' })).alvo, null);
  assert.equal(a.ler(a.criar({ tipo: 'reativo', diretor: 'K7M2PQ4X', alvo: 'n:ana' })).alvo, 'n:ana');
  assert.throws(() => a.criar({ tipo: 'fonte', diretor: 'K7M2PQ4X', alvo: 'c:ABCD2345' }));
  assert.throws(() => a.criar({ tipo: 'fonte', diretor: 'K7M2PQ4X', alvo: 'c:ABCD2345', fonte: 'tudo' }));
  assert.throws(() => a.criar({ tipo: 'fonte', diretor: 'K7M2PQ4X', alvo: 'ana', fonte: 'camera' }), 'a chave tem forma fechada');
  assert.throws(() => a.criar({ tipo: 'reativo', diretor: 'OI' }), 'sem código de conta não há diretor');
  assert.throws(() => estudio.criarAssinador(Buffer.alloc(4)));
});

test('a chave da pessoa: o código para quem tem conta, o nome normalizado para quem não tem', () => {
  assert.equal(estudio.chaveDaPessoa({ codigo: 'k7m2-pq4x', nome: 'Ana' }), 'c:K7M2PQ4X');
  assert.equal(estudio.chaveDaPessoa({ nome: '  Ána   Souza ' }), 'n:ána souza');
  assert.equal(estudio.chaveDaPessoa({ codigo: 'curto', nome: 'Bia' }), 'n:bia', 'código inválido não vira conta');
  assert.equal(estudio.chaveDaPessoa({ nome: '   ' }), null);
  assert.equal(estudio.chaveValida('n:Ana'), null, 'a chave de nome já vem normalizada');
  assert.equal(estudio.chaveValida('c:K7M2PQ4I'), null, 'I não existe no alfabeto do código');
  assert.equal(estudio.chaveValida('n:ana'), 'n:ana');
});

// ---------- A configuração ----------

test('a configuração é fechada: o que não está na forma some, e os números ficam na faixa', () => {
  const img = 'a'.repeat(32);
  const mudo = 'b'.repeat(32);
  const surdo = 'c'.repeat(32);
  const limpa = estudio.limparConfig({
    estilo: { efeito: 'explodir', tamanho: 9000, espaco: 12, nomes: 'sim', sensibilidade: 50, invasor: true },
    pessoas: {
      'c:K7M2PQ4X': { parado: img, falando: 'nao-e-id', oculto: true, extra: 1 },
      'n:bia': { rotulo: 'Bia' },
      'n:caio': { mudo: mudo, ensurdecido: surdo, mudoDeNovo: img },
      'n:vazia': {},
      'lixo': { parado: img }
    },
    outraCoisa: 1
  });
  assert.equal(limpa.estilo.efeito, 'pulo');
  assert.equal(limpa.estilo.tamanho, estudio.ESTILO_PADRAO.tamanho, 'fora da faixa volta ao padrão, não é cortado');
  assert.equal(limpa.estilo.espaco, 12);
  assert.equal(limpa.estilo.nomes, true);
  assert.equal('invasor' in limpa.estilo, false);
  const sem = { parado: null, falando: null, mudo: null, ensurdecido: null };
  assert.deepEqual(limpa.pessoas, {
    'c:K7M2PQ4X': { ...sem, rotulo: '', parado: img, oculto: true },
    'n:bia': { ...sem, rotulo: 'Bia', oculto: false },
    'n:caio': { ...sem, rotulo: '', mudo, ensurdecido: surdo, oculto: false }
  }, 'mudo e ensurdecido sozinhos já bastam para a pessoa ficar na lista');
  assert.equal('outraCoisa' in limpa, false);
  assert.deepEqual([...estudio.imagensDaConfig(limpa)].sort(), [img, mudo, surdo].sort());
  const muitas = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`n:p${i}`, { rotulo: `P${i}` }]));
  assert.equal(Object.keys(estudio.limparConfig({ pessoas: muitas }).pessoas).length, estudio.PESSOAS_MAXIMAS_NA_CONFIGURACAO);
  // A escolha de origem: só as três, e só quando foi feita.
  const escolhas = estudio.limparConfig({ pessoas: { 'n:ana': { usar: 'nenhuma' }, 'n:bia': { usar: 'qualquer' }, 'n:caio': { usar: 'pessoa', rotulo: 'Caio' } } }).pessoas;
  assert.equal(escolhas['n:ana'].usar, 'nenhuma', 'escolher "nenhuma" basta para a pessoa ficar na lista');
  assert.equal('n:bia' in escolhas, false, 'uma escolha que não existe não diz nada');
  assert.equal(escolhas['n:caio'].usar, 'pessoa');
});

test('o rosto que a pessoa escolhe, e de onde vêm as imagens de cada uma', () => {
  const img = n => String(n).repeat(32).slice(0, 32);
  assert.equal(estudio.limparRosto(null), null);
  assert.equal(estudio.limparRosto({ parado: 'nao-e-id', outro: img(1) }), null, 'sem imagem válida, sem rosto');
  assert.deepEqual(estudio.limparRosto({ parado: img(1), mudo: img(2), extra: img(3) }), { parado: img(1), mudo: img(2) });

  const rosto = { parado: img(1) };
  const origem = estudio.origemDasImagens;
  assert.equal(origem({}, null), 'nenhuma', 'sem nada, a foto');
  assert.equal(origem({}, rosto), 'pessoa', 'quem nunca mexeu na pessoa vê o rosto que ela escolheu');
  assert.equal(origem({ parado: img(4) }, rosto), 'minhas', 'quem já tinha anexado imagens continua com as dele');
  assert.equal(origem({ parado: img(4), usar: 'pessoa' }, rosto), 'pessoa', 'a escolha guardada vence');
  assert.equal(origem({ usar: 'nenhuma' }, rosto), 'nenhuma');
  assert.equal(origem({ usar: 'pessoa' }, null), 'nenhuma', '"da pessoa" sem rosto próprio é a foto');
  assert.equal(origem({ usar: 'pessoa', mudo: img(5) }, null), 'minhas', '...ou as minhas, se houver');
});

// ---------- As imagens ----------

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(40, 1)]);

test('o tipo da imagem vem dos bytes; SVG e desencontros ficam de fora', () => {
  assert.equal(tipoDosBytes(PNG), 'image/png');
  assert.equal(tipoDosBytes(GIF), 'image/gif');
  assert.equal(tipoDosBytes(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'image/jpeg');
  assert.equal(tipoDosBytes(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(8)])), 'image/webp');
  assert.equal(tipoDosBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.match(conferirImagem(Buffer.from('<html><script></script></html>'), 'avatar', 'image/png').erro, /PNG, JPEG, GIF e WebP/);
  assert.match(conferirImagem(PNG, 'avatar', 'image/gif').erro, /não é do tipo/);
  assert.equal(conferirImagem(PNG, 'avatar', 'application/octet-stream').tipo, 'image/png');
  const comMb = mb => Buffer.concat([PNG, Buffer.alloc(mb * 1024 * 1024)]);
  assert.equal(conferirImagem(comMb(3), 'avatar', 'image/png').tipo, 'image/png', 'a foto aceita um GIF animado de alguns MB');
  assert.equal(conferirImagem(comMb(6), 'avatar', 'image/png').status, 413, 'acima de 6 MB, não');
  assert.match(conferirImagem(comMb(6), 'avatar', 'image/png').erro, /passa de 6 MB/);
  assert.equal(conferirImagem(comMb(11), 'estudio', 'image/png').tipo, 'image/png', 'o Estúdio aceita um GIF longo');
  assert.equal(conferirImagem(comMb(12), 'estudio', 'image/png').status, 413, 'acima de 12 MB, não');
  assert.equal(conferirImagem(comMb(11), 'rosto', 'image/png').tipo, 'image/png', 'o rosto tem o teto do Estúdio');
  assert.equal(conferirImagem(comMb(12), 'rosto', 'image/png').status, 413);
});

// ---------- Pelo servidor ----------

function cliente(origem) {
  let cookie = '';
  let csrf = '';
  async function pedir(caminho, { metodo = 'GET', corpo, cru = null, tipo = 'application/json' } = {}) {
    const cabecalhos = { 'Content-Type': tipo, Origin: origem };
    if (cookie) cabecalhos.Cookie = cookie;
    if (csrf) cabecalhos['X-Nexo-CSRF'] = csrf;
    const r = await fetch(origem + caminho, { method: metodo, headers: cabecalhos, body: cru || (corpo ? JSON.stringify(corpo) : undefined) });
    const definido = r.headers.get('set-cookie');
    if (definido) cookie = definido.split(';')[0];
    const dados = await r.json().catch(() => ({}));
    if (dados.csrf) csrf = dados.csrf;
    return { status: r.status, dados, cabecalhos: r.headers };
  }
  return { pedir, cookie: () => cookie };
}

async function cadastrar(origem, usuario, apelido) {
  const c = cliente(origem);
  const r = await c.pedir('/api/conta/cadastrar', { metodo: 'POST', corpo: { usuario, apelido, senha: SENHA } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return { ...c, conta: r.dados.conta };
}

// Uma página do OBS pelo protocolo cru do Socket.IO: o namespace `/estudio`, com o link no
// aperto de mão, e os estados que chegam.
async function paginaDoObs(origem, link) {
  const ws = new WebSocket(origem.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', { headers: { Origin: origem } });
  const estados = [];
  const ouvintes = new Set();
  let abertura = null;
  ws.on('message', bruto => {
    const texto = bruto.toString();
    if (texto === '2') { ws.send('3'); return; }
    if (texto.startsWith('0')) { ws.send('40/estudio,' + JSON.stringify({ link })); return; }
    if (texto.startsWith('40/estudio') || texto.startsWith('44/estudio')) { abertura?.(texto); return; }
    if (texto.startsWith('42/estudio,')) {
      const [evento, dados] = JSON.parse(texto.slice('42/estudio,'.length));
      if (evento === 'estado') { estados.push(dados); for (const ouvir of ouvintes) ouvir(dados); }
    }
  });
  const resposta = await new Promise((resolve, reject) => { abertura = resolve; ws.once('error', reject); setTimeout(() => reject(new Error('sem resposta')), 5000); });
  function esperar(predicado, prazo = 5000) {
    const achado = estados.findLast(predicado);
    if (achado && achado === estados.at(-1)) return Promise.resolve(achado);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ouvintes.delete(ouvir); reject(new Error(`Estado não chegou. Último: ${JSON.stringify(estados.at(-1))}`)); }, prazo);
      const ouvir = e => { if (predicado(e)) { clearTimeout(timer); ouvintes.delete(ouvir); resolve(e); } };
      ouvintes.add(ouvir);
    });
  }
  return { aceita: resposta.startsWith('40'), resposta, estados, esperar, fechar: () => ws.close() };
}

test('a foto de perfil: só imagem de verdade, servida sem nada que rode, e a antiga some', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await cadastrar(servidor.origem, 'ana', 'Ana');
  await ana.pedir('/api/conta/eu');
  const falsa = await ana.pedir('/api/conta/avatar', { metodo: 'PUT', cru: Buffer.from('<svg><script>1</script></svg>'), tipo: 'image/svg+xml' });
  assert.equal(falsa.status, 400);

  const primeira = await ana.pedir('/api/conta/avatar', { metodo: 'PUT', cru: PNG, tipo: 'image/png' });
  assert.equal(primeira.status, 200, JSON.stringify(primeira.dados));
  const id = primeira.dados.perfil.avatar;
  assert.match(id, /^[a-f0-9]{32}$/);
  const entregue = await fetch(`${servidor.origem}/api/imagem/${id}`);
  assert.equal(entregue.status, 200);
  assert.equal(entregue.headers.get('content-type'), 'image/png');
  assert.equal(entregue.headers.get('x-content-type-options'), 'nosniff');
  assert.match(entregue.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
  assert.deepEqual(Buffer.from(await entregue.arrayBuffer()), PNG);

  const segunda = await ana.pedir('/api/conta/avatar', { metodo: 'PUT', cru: GIF, tipo: 'image/gif' });
  assert.notEqual(segunda.dados.perfil.avatar, id);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${id}`)).status, 404, 'trocar a foto apaga a antiga');
  assert.equal((await ana.pedir('/api/conta/avatar', { metodo: 'DELETE' })).dados.perfil.avatar, null);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${segunda.dados.perfil.avatar}`)).status, 404);

  // O GIF animado vem como está, e é ele que usa o teto de 6 MB: um de 3 MB entra inteiro; acima
  // do teto, nem a rota aceita.
  const gifGrande = Buffer.concat([GIF, Buffer.alloc(3 * 1024 * 1024)]);
  const grande = await ana.pedir('/api/conta/avatar', { metodo: 'PUT', cru: gifGrande, tipo: 'image/gif' });
  assert.equal(grande.status, 200, JSON.stringify(grande.dados));
  assert.equal(Buffer.from(await (await fetch(`${servidor.origem}/api/imagem/${grande.dados.perfil.avatar}`)).arrayBuffer()).length, gifGrande.length);
  const demais = await ana.pedir('/api/conta/avatar', { metodo: 'PUT', cru: Buffer.concat([GIF, Buffer.alloc(7 * 1024 * 1024)]), tipo: 'image/gif' });
  assert.equal(demais.status, 413);

  // Sem sessão nem CSRF, nada sobe.
  const semConta = await fetch(`${servidor.origem}/api/conta/avatar`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Origin: servidor.origem }, body: PNG });
  assert.equal(semConta.status, 401);
});

test('o Estúdio guarda a configuração, só aceita imagens da própria conta e revoga os links', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await cadastrar(servidor.origem, 'ana', 'Ana');
  const bia = await cadastrar(servidor.origem, 'bia', 'Bia');
  const imagemDaBia = (await bia.pedir('/api/conta/estudio/imagens', { metodo: 'POST', cru: PNG, tipo: 'image/png' })).dados.imagem.id;
  const enviada = await ana.pedir('/api/conta/estudio/imagens', { metodo: 'POST', cru: GIF, tipo: 'image/gif' });
  assert.equal(enviada.status, 201, JSON.stringify(enviada.dados));
  const minha = enviada.dados.imagem.id;

  const salvo = await ana.pedir('/api/conta/estudio', { metodo: 'PUT', corpo: { config: {
    estilo: { efeito: 'pulso', tamanho: 200 },
    pessoas: { [`c:${bia.conta.codigo.replace('-', '')}`]: { parado: minha, falando: imagemDaBia, mudo: minha, ensurdecido: imagemDaBia } }
  } } });
  assert.equal(salvo.status, 200, JSON.stringify(salvo.dados));
  const pessoa = salvo.dados.config.pessoas[`c:${bia.conta.codigo.replace('-', '')}`];
  assert.equal(pessoa.parado, minha);
  assert.equal(pessoa.mudo, minha, 'a mesma imagem pode servir a dois estados');
  assert.equal(pessoa.falando, null, 'a imagem de outra conta não entra na configuração de ninguém');
  assert.equal(pessoa.ensurdecido, null, 'nem no estado de ensurdecida');

  const retrato = (await ana.pedir('/api/conta/estudio')).dados;
  assert.equal(retrato.config.estilo.efeito, 'pulso');
  assert.equal(retrato.sala, null, 'fora de uma sala não há quem mostrar agora');
  assert.match(retrato.links.grupo, /^\/obs\/[\w-]+\.[\w-]+$/);
  assert.ok(retrato.links.pessoas[`c:${bia.conta.codigo.replace('-', '')}`].camera, 'quem está na configuração já tem os links prontos');

  const achada = await ana.pedir('/api/conta/estudio/pessoa', { metodo: 'POST', corpo: { codigo: bia.conta.codigo.toLowerCase() } });
  assert.equal(achada.dados.pessoa.rotulo, 'Bia');
  assert.equal((await ana.pedir('/api/conta/estudio/pessoa', { metodo: 'POST', corpo: { nome: ' Carla  Dias ' } })).dados.pessoa.chave, 'n:carla dias');
  assert.equal((await ana.pedir('/api/conta/estudio/pessoa', { metodo: 'POST', corpo: { codigo: 'ZZZZ-ZZZZ' } })).status, 404);

  // O link, e a revogação que o desliga.
  const link = retrato.links.grupo.slice('/obs/'.length);
  const antes = await paginaDoObs(servidor.origem, link);
  t.after(antes.fechar);
  assert.ok(antes.aceita, antes.resposta);
  const aguardando = await antes.esperar(e => e.tipo === 'aguardando');
  assert.equal(aguardando.motivo, 'diretor');
  assert.match(aguardando.texto, /Aguardando Ana entrar numa sala/);
  assert.equal((await ana.pedir('/api/conta/estudio/revogar', { metodo: 'POST' })).dados.geracao, 1);
  await antes.esperar(e => e.tipo === 'revogado');

  // Apagar a imagem tira ela da configuração.
  const depois = await ana.pedir(`/api/conta/estudio/imagens/${minha}`, { metodo: 'DELETE' });
  assert.equal(depois.dados.config.pessoas[`c:${bia.conta.codigo.replace('-', '')}`], undefined);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${minha}`)).status, 404);

  // O link sem assinatura válida nem chega a abrir o socket.
  const falsa = await paginaDoObs(servidor.origem, `${link.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`);
  assert.equal(falsa.aceita, false);
  falsa.fechar();
});

test('o rosto: uma imagem por estado, trocada no lugar, no perfil que a sala vê', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await cadastrar(servidor.origem, 'ana', 'Ana');
  const parado = await ana.pedir('/api/conta/rosto/parado', { metodo: 'PUT', cru: GIF, tipo: 'image/gif' });
  assert.equal(parado.status, 200, JSON.stringify(parado.dados));
  const id = parado.dados.perfil.rosto.parado;
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${id}`)).status, 200);
  const trocado = await ana.pedir('/api/conta/rosto/parado', { metodo: 'PUT', cru: PNG, tipo: 'image/png' });
  assert.notEqual(trocado.dados.perfil.rosto.parado, id);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${id}`)).status, 404, 'trocar apaga a anterior daquele estado');
  const mudo = await ana.pedir('/api/conta/rosto/mudo', { metodo: 'PUT', cru: PNG, tipo: 'image/png' });
  assert.deepEqual(Object.keys(mudo.dados.perfil.rosto).sort(), ['mudo', 'parado']);
  assert.equal((await ana.pedir('/api/conta/rosto/cantando', { metodo: 'PUT', cru: PNG, tipo: 'image/png' })).status, 404, 'só os quatro estados');
  const tirado = await ana.pedir('/api/conta/rosto/mudo', { metodo: 'DELETE' });
  assert.deepEqual(Object.keys(tirado.dados.perfil.rosto), ['parado']);
  assert.equal((await fetch(`${servidor.origem}/api/imagem/${mudo.dados.perfil.rosto.mudo}`)).status, 404);
  assert.equal((await ana.pedir('/api/conta/eu')).dados.perfil.rosto.parado, trocado.dados.perfil.rosto.parado, 'o rosto é perfil');
});

test('o rosto que a Bia escolhe chega ao Estúdio da Ana e à fonte dos rostos, na hora', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await cadastrar(servidor.origem, 'ana', 'Ana');
  const bia = await cadastrar(servidor.origem, 'bia', 'Bia');
  const sala = 'squad-rosto';
  const entrar = async (pessoa, nome) => {
    const cred = await servidor.credencial(nome, sala, '', pessoa.cookie());
    const socket = await conectarSocket(servidor.origem, cred.credencialSessao);
    t.after(socket.fechar);
    await socket.pedir('join-room', sala, nome, 'x');
  };
  await entrar(ana, 'Ana');
  await entrar(bia, 'Bia');
  const grupo = (await ana.pedir('/api/conta/estudio')).dados.links.grupo;
  const obs = await paginaDoObs(servidor.origem, grupo.slice('/obs/'.length));
  t.after(obs.fechar);
  await obs.esperar(e => e.tipo === 'ok' && e.pessoas.length === 2);

  const id = (await bia.pedir('/api/conta/rosto/parado', { metodo: 'PUT', cru: GIF, tipo: 'image/gif' })).dados.perfil.rosto.parado;
  await obs.esperar(e => e.tipo === 'ok' && e.pessoas.some(p => p.nome === 'Bia' && p.perfil?.rosto?.parado === id));
  const daBia = (await ana.pedir('/api/conta/estudio')).dados.sala.pessoas.find(p => p.nome === 'Bia');
  assert.equal(daBia.perfil.rosto.parado, id, 'o painel do Estúdio da Ana vê o rosto que a Bia escolheu');

  // A escolha da Ana para a Bia fica guardada na configuração dela, e chega à fonte.
  const salvo = await ana.pedir('/api/conta/estudio', { metodo: 'PUT', corpo: { config: { pessoas: { [daBia.chave]: { usar: 'nenhuma' } } } } });
  assert.equal(salvo.dados.config.pessoas[daBia.chave].usar, 'nenhuma');
  await obs.esperar(e => e.tipo === 'ok' && e.config?.pessoas?.[daBia.chave]?.usar === 'nenhuma');
  assert.equal((await ana.pedir('/api/conta/estudio')).dados.config.pessoas[daBia.chave].usar, 'nenhuma', 'e continua lá na próxima abertura');
});

test('a página do OBS segue o diretor até a sala, espera a pessoa e respeita quem não deixa', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await cadastrar(servidor.origem, 'ana', 'Ana');
  const codigoDaAna = ana.conta.codigo.replace('-', '');
  const sala = 'squad-estudio';
  const caminho = (await ana.pedir('/api/conta/estudio/link', { metodo: 'POST', corpo: { tipo: 'fonte', alvo: 'n:bia', fonte: 'camera' } })).dados.caminho;
  assert.match(caminho, /^\/obs\//);
  const obs = await paginaDoObs(servidor.origem, caminho.slice('/obs/'.length));
  t.after(obs.fechar);
  await obs.esperar(e => e.tipo === 'aguardando' && e.motivo === 'diretor');

  // A Ana entra: a página passa a esperar a Bia, na sala dela.
  const credAna = await servidor.credencial('Ana', sala, '', ana.cookie());
  const socketAna = await conectarSocket(servidor.origem, credAna.credencialSessao);
  t.after(socketAna.fechar);
  const entrada = await socketAna.pedir('join-room', sala, 'Ana', 'x');
  assert.deepEqual(entrada.estudio, []);
  const esperando = await obs.esperar(e => e.tipo === 'aguardando' && e.motivo === 'alvo');
  assert.match(esperando.texto, /Aguardando bia entrar na sala de Ana/i);

  // A Bia chega sem conta e sem deixar: a página é recusada, e nada é anunciado.
  const credBia = await servidor.credencial('Bia', sala);
  const socketBia = await conectarSocket(servidor.origem, credBia.credencialSessao, { estudio: false });
  t.after(socketBia.fechar);
  await socketBia.pedir('join-room', sala, 'Bia', 'x');
  await obs.esperar(e => e.tipo === 'recusado');

  // Ela passa a deixar: a página fica no ar (sem mídia neste teste) e a sala fica sabendo.
  socketBia.emitir('estudio-permissao', { permitir: true });
  const noAr = await obs.esperar(e => e.tipo === 'ok');
  assert.equal(noAr.fonte, 'camera');
  assert.equal(noAr.alvo.nome, 'Bia');
  assert.equal(noAr.midia, null, 'sem servidor de mídia não há credencial, e a página espera');
  const aviso = await socketBia.esperar(texto => texto.startsWith('42["estudio-capturas"') && texto.includes('"camera"'));
  const { lista } = JSON.parse(aviso.slice(2))[1];
  assert.deepEqual(lista, [{ diretor: credAna.identidade, alvo: credBia.identidade, fonte: 'camera' }]);

  // Os links pelo cartão de perfil: com conta sim, sem conta não.
  const pelaSala = await socketAna.pedir('estudio-links', { alvo: credBia.identidade });
  assert.ok(pelaSala.ok, JSON.stringify(pelaSala));
  assert.deepEqual(Object.keys(pelaSala.links).sort(), ['camera', 'reativo', 'somDaTela', 'tela', 'voz']);
  assert.equal((await socketBia.pedir('estudio-links', { alvo: credAna.identidade })).motivo, 'sem-conta');

  // Ela desliga de novo: a captura cai na hora e a sala fica sabendo.
  socketBia.emitir('estudio-permissao', { permitir: false });
  await obs.esperar(e => e.tipo === 'recusado');
  await socketBia.esperar(texto => texto === '42["estudio-capturas",{"lista":[]}]');

  // O diretor sai: a página volta a esperar por ele.
  await socketAna.pedir('leave-room');
  await obs.esperar(e => e.tipo === 'aguardando' && e.motivo === 'diretor');
  assert.equal(codigoDaAna.length, 8);
});
