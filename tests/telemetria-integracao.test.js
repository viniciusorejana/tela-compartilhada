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
