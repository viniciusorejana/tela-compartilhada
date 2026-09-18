const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

test('servidor real protege painel, vincula sessões e limita handlers Socket.IO', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await servidor.credencial('Ana'); assert.ok(ana.credencialSessao);
  const a = await conectarSocket(servidor.origem, ana.credencialSessao); t.after(a.fechar);
  const entrada = await a.pedir('join-room', 'squad-teste', 'Nome forjado', 'Identidade forjada'); assert.equal(entrada.ok, true);
  const bia = await servidor.credencial('Bia'); const b = await conectarSocket(servidor.origem, bia.credencialSessao); t.after(b.fechar);
  const outra = await b.pedir('join-room', 'squad-teste', 'Bia', bia.identidade); assert.equal(outra.peers[0].name, 'Ana');
  assert.equal((await a.pedir('join-room', 'outra-sala', 'Ana', ana.identidade)).ok, false);
  for (let i = 0; i < 9; i++) a.emitir('chat-message', { texto: `mensagem-${i}` });
  await a.esperar(m => m.startsWith('42') && m.includes('limite-atingido'));
  await new Promise(r => setTimeout(r, 80));
  const mensagens = b.recebidos.filter(m => m.startsWith('42') && m.includes('chat-mensagem'));
  assert.equal(mensagens.length, 6);
  const falsoUpload = await fetch(servidor.origem + `/api/soundboard/squad-teste?socket=${entrada.selfId}`, { method: 'POST', body: Buffer.alloc(30) });
  assert.equal(falsoUpload.status, 403);
  assert.equal((await fetch(servidor.origem + '/painel/api/resumo')).status, 401);
  const login = await fetch(servidor.origem + '/painel/entrar', { method: 'POST', headers: { Origin: servidor.origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await servidor.chave() }) });
  assert.equal(login.status, 200, servidor.erros());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const resumo = await (await fetch(servidor.origem + '/painel/api/resumo', { headers: { Cookie: cookie } })).json();
  assert.equal(resumo.atual.salas[0].pessoas, 2); assert.ok(resumo.atual.alertas.some(a => a.nome === 'Ana'));
  assert.ok(!JSON.stringify(resumo.contabilidade).includes('Ana'));
  assert.ok(!JSON.stringify(resumo.atual.abuso.emissores).includes('Ana'));
  assert.ok(resumo.atual.limites['chat-message']);
  const saida = await a.pedir('leave-room'); assert.equal(saida.ok, true);
});
// O relato é o único caminho pelo qual um problema de quem usa chega até quem mantém. O que
// se afirma aqui é o que não pode falhar em silêncio: que ele exige sessão, que a sala e o
// nome vêm DA SESSÃO e não do corpo (senão qualquer um assina relato como outra pessoa), que
// o protocolo volta para quem enviou, e que o painel mostra o que chegou.
test('relato exige sessão, carimba sala e nome pela sessão, e aparece no painel', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const cred = await servidor.credencial('Ana');
  const enviar = (corpo, cabecalhos = {}) => fetch(servidor.origem + '/api/relato', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhos }, body: JSON.stringify(corpo)
  });

  // Sem sessão não há relato: é a sessão que diz de que sala ele fala.
  assert.equal((await enviar({ mensagem: 'sem sessão' })).status, 403);
  const comSessao = { 'X-Nexo-Sessao': cred.credencialSessao };
  // Uma linha em branco no disco não é um relato.
  assert.equal((await enviar({ mensagem: '   ', relatorio: '' }, comSessao)).status, 400);

  // O corpo TENTA se passar por outra pessoa em outra sala. Os dois campos precisam ser
  // ignorados -- é a sessão que responde por eles.
  const resposta = await enviar({
    mensagem: 'A tela do Fulano ficou preta no celular.',
    relatorio: 'codec=H.264\nlimitado por=cpu',
    sala: 'sala-forjada', nome: 'Nome forjado', protocolo: 'NX-FORJADO'
  }, comSessao);
  assert.equal(resposta.status, 200, servidor.erros());
  const { ok, protocolo } = await resposta.json();
  assert.equal(ok, true);
  assert.match(protocolo, /^NX-[A-Z2-9]{6}$/, `protocolo inesperado: ${protocolo}`);

  const login = await fetch(servidor.origem + '/painel/entrar', { method: 'POST', headers: { Origin: servidor.origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await servidor.chave() }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const lidos = await (await fetch(servidor.origem + '/painel/api/relatos', { headers: { Cookie: cookie } })).json();
  assert.equal(lidos.relatos.length, 1);
  const relato = lidos.relatos[0];
  assert.equal(relato.protocolo, protocolo, 'o painel precisa mostrar o mesmo protocolo que voltou para quem enviou');
  assert.equal(relato.sala, 'squad-teste', `a sala veio do corpo em vez da sessão: ${relato.sala}`);
  assert.equal(relato.nome, 'Ana', `o nome veio do corpo em vez da sessão: ${relato.nome}`);
  assert.match(relato.mensagem, /tela do Fulano/);
  assert.match(relato.relatorio, /limitado por=cpu/);

  // O painel é protegido pela mesma porta que o resto dele. Sem cookie, nada.
  assert.equal((await fetch(servidor.origem + '/painel/api/relatos')).status, 401);
});

// "Não está funcionando" e "seria bom se" chegam pela mesma rota e pedem coisas opostas de
// quem recebe: o primeiro é urgente e traz o relatório técnico; o segundo é para ler com
// calma. Se eles se misturarem na leitura, a sugestão atrapalha o problema e o problema
// enterra a sugestão.
test('sugestões e problemas viajam pela mesma rota e chegam em listas separadas', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const cred = await servidor.credencial('Bia');
  const cabecalhos = { 'Content-Type': 'application/json', 'X-Nexo-Sessao': cred.credencialSessao };
  const enviar = corpo => fetch(servidor.origem + '/api/relato', { method: 'POST', headers: cabecalhos, body: JSON.stringify(corpo) });

  assert.equal((await enviar({ tipo: 'problema', mensagem: 'a tela ficou preta', relatorio: 'limitado por=cpu' })).status, 200);
  assert.equal((await enviar({ tipo: 'sugestao', mensagem: 'queria a sala aberta para voltar depois' })).status, 200);
  // Um tipo inventado não perde o relato: ele cai na lista de problemas, porque entre perder
  // o texto e guardá-lo na lista errada, guardar é melhor.
  assert.equal((await enviar({ tipo: 'inventado', mensagem: 'tipo desconhecido' })).status, 200);

  const login = await fetch(servidor.origem + '/painel/entrar', { method: 'POST', headers: { Origin: servidor.origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: await servidor.chave() }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const lidos = await (await fetch(servidor.origem + '/painel/api/relatos', { headers: { Cookie: cookie } })).json();

  assert.deepEqual(lidos.sugestoes.map(s => s.mensagem), ['queria a sala aberta para voltar depois']);
  assert.deepEqual(lidos.relatos.map(r => r.mensagem), ['tipo desconhecido', 'a tela ficou preta']);
  assert.equal(lidos.total, 3);
  // A sugestão não carrega relatório técnico: anexar sessenta linhas de medições a "seria bom
  // poder voltar na mesma sala" só encheria o arquivo.
  assert.equal(lidos.sugestoes[0].relatorio, '');
  assert.match(lidos.relatos[1].relatorio, /limitado por=cpu/);
});

// Três por minuto é um gesto; o quarto é alguém testando o campo. Cada relato carrega até
// 16 KB de relatório, o que faz desta a rota mais cara por unidade no servidor inteiro.
test('relatos em excesso são recusados sem derrubar a sessão', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const cred = await servidor.credencial('Insistente');
  const cabecalhos = { 'Content-Type': 'application/json', 'X-Nexo-Sessao': cred.credencialSessao };
  const situacoes = [];
  for (let i = 0; i < 5; i++) {
    const r = await fetch(servidor.origem + '/api/relato', { method: 'POST', headers: cabecalhos, body: JSON.stringify({ mensagem: `relato ${i}` }) });
    situacoes.push(r.status);
  }
  assert.deepEqual(situacoes.slice(0, 3), [200, 200, 200], `os três primeiros deveriam passar: ${situacoes}`);
  assert.ok(situacoes.slice(3).every(s => s === 429), `o excesso deveria ser recusado com 429: ${situacoes}`);
  // A sessão continua válida: recusar um relato não pode custar o lugar na sala. Aqui se
  // confere a credencial, e não o token de mídia -- este servidor de teste sobe sem SFU.
  const depois = await servidor.credencial('Insistente', 'squad-teste', cred.credencialSessao);
  assert.ok(depois.credencialSessao, 'a sessão deveria continuar servindo depois de um relato recusado');
});

test('bytes de upload abortado continuam no contador do servidor', async t => {
  const servidor = await iniciarServidor({ ambiente: { NEXO_LIMITES: JSON.stringify({ 'soundboard-bytes': { sessao: 150000, sala: 1000000 } }) } }); t.after(servidor.encerrar);
  const cred = await servidor.credencial('Upload'); const a = await conectarSocket(servidor.origem, cred.credencialSessao); t.after(a.fechar);
  await a.pedir('join-room', 'squad-teste', 'Upload', cred.identidade);
  await new Promise(resolve => {
    const req = http.request(servidor.origem + '/api/soundboard/squad-teste', { method: 'POST', headers: { 'X-Nexo-Sessao': cred.credencialSessao, 'Content-Type': 'audio/wav', 'Content-Length': 1000000 } });
    req.on('error', () => {}); req.write(Buffer.alloc(100000));
    setTimeout(() => { req.destroy(); resolve(); }, 120);
  });
  await new Promise(r => setTimeout(r, 80));
  const r = await fetch(servidor.origem + '/api/soundboard/squad-teste', { method: 'POST', headers: { 'X-Nexo-Sessao': cred.credencialSessao, 'Content-Type': 'audio/wav' }, body: Buffer.alloc(20) });
  assert.equal(r.status, 400, 'upload abortado deve devolver a vaga de conversão');
  const excesso = await fetch(servidor.origem + '/api/soundboard/squad-teste', { method: 'POST', headers: { 'X-Nexo-Sessao': cred.credencialSessao, 'Content-Type': 'audio/wav' }, body: Buffer.alloc(100000) });
  assert.equal(excesso.status, 429, 'os bytes da tentativa abortada continuam consumindo o orçamento');
});
test('agente pode anunciar porta antes do navegador, mas flood de controle é encerrado', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ws = new WebSocket(servidor.origem.replace('http:', 'ws:') + '/agente?token=' + 'a'.repeat(32));
  t.after(() => ws.terminate()); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ evento: 'porta-local', porta: 12345 }));
  const fim = new Promise((resolve, reject) => { const prazo = setTimeout(() => reject(new Error('O agente não foi limitado.')), 3000); ws.once('close', codigo => { clearTimeout(prazo); resolve(codigo); }); });
  for (let i = 0; i < 125; i++) ws.send(JSON.stringify({ evento: 'porta-local', porta: 12345 }));
  assert.equal(await fim, 1008);
});
