// O relógio da sala, a página de "não encontrada" e as falas tipadas do bot, pelo servidor de
// verdade. O relógio é o que mais importa aqui: a promessa é que um F5 não zere a hora de
// conversa de ninguém -- com conta ou sem.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, conectarSocket } = require('./helpers/servidor-telemetria.cjs');

const SALA = 'squad-teste';

async function entrar(servidor, t, cred, extra = {}) {
  assert.ok(cred.credencialSessao, `sem credencial: ${JSON.stringify(cred)}`);
  const socket = await conectarSocket(servidor.origem, cred.credencialSessao, extra);
  t.after(socket.fechar);
  const entrada = await socket.pedir('join-room', SALA, 'ignorado', cred.identidade);
  assert.equal(entrada.ok, true, JSON.stringify(entrada));
  return { socket, entrada };
}
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

test('com conta, o F5 continua o relógio da pessoa e o da sala; quem está vê o mesmo instante', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await servidor.conta('ana', { apelido: 'Ana', sala: SALA });
  const primeira = await entrar(servidor, t, ana);
  const { tempos } = primeira.entrada;
  assert.ok(Number.isFinite(tempos.agora) && Number.isFinite(tempos.abertaEm) && Number.isFinite(tempos.desde));
  assert.ok(tempos.desde >= tempos.abertaEm, 'quem abriu a sala entrou quando ela abriu');

  const bia = await entrar(servidor, t, await servidor.credencial('Bia', SALA));
  assert.equal(bia.entrada.tempos.abertaEm, tempos.abertaEm, 'a sala tem um relógio só');
  assert.equal(bia.entrada.peers.find(p => p.identidade === ana.identidade).desde, tempos.desde, 'quem chega vê desde quando os outros estão');

  await esperar(60);
  primeira.socket.fechar();
  await bia.socket.esperar(m => m.includes('peer-left') && m.includes(ana.identidade));
  const deNovo = await servidor.credencial('Ana', SALA, '', ana.cookie);
  assert.notEqual(deNovo.identidade, ana.identidade, 'o F5 troca a identidade');
  const volta = await entrar(servidor, t, deNovo);
  assert.equal(volta.entrada.tempos.desde, tempos.desde, 'e não troca o relógio');
  const aviso = await bia.socket.esperar(m => m.includes('peer-joined') && m.includes(deNovo.identidade));
  assert.match(aviso, new RegExp(`"desde":${tempos.desde}`), 'quem estava vê a volta com o tempo de antes');
});

test('sem conta, o sorteio do navegador faz o mesmo papel; sem ele, cada entrada começa do zero', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const sorteio = 'ab'.repeat(16);
  const antes = await entrar(servidor, t, await servidor.credencial('Caio', SALA), { tempo: sorteio });
  await esperar(60);
  antes.socket.fechar();
  await esperar(250);
  const depois = await entrar(servidor, t, await servidor.credencial('Caio', SALA), { tempo: sorteio });
  assert.equal(depois.entrada.tempos.desde, antes.entrada.tempos.desde);
  const outro = await entrar(servidor, t, await servidor.credencial('Caio', SALA), { tempo: 'cd'.repeat(16) });
  assert.ok(outro.entrada.tempos.desde > antes.entrada.tempos.desde, 'outro navegador é outra pessoa');
  const forjado = await entrar(servidor, t, await servidor.credencial('Dani', SALA), { tempo: 'conta:1' });
  assert.ok(forjado.entrada.tempos.desde > antes.entrada.tempos.desde, 'um sorteio fora do formato não pega o relógio de ninguém');
});

test('um endereço que não existe recebe a página do Nexo, e uma API recebe um 404 curto', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const pagina = await fetch(`${servidor.origem}/squad-da-noite`, { headers: { Accept: 'text/html' } });
  assert.equal(pagina.status, 404);
  assert.match(await pagina.text(), /Esta página saiu da sala/);
  const codigoInvalido = await fetch(`${servidor.origem}/ab/sala`, { headers: { Accept: 'text/html' } });
  assert.equal(codigoInvalido.status, 404, 'um código que nenhuma sala pode ter não abre a sala');
  assert.equal((await fetch(`${servidor.origem}/abcd/sala`)).status, 200);
  const api = await fetch(`${servidor.origem}/api/nao-existe`);
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { error: 'Não encontrado.' });
  const texto = await fetch(`${servidor.origem}/nao-existe.png`, { headers: { Accept: 'image/png' } });
  assert.equal(texto.status, 404);
  assert.match(texto.headers.get('content-type'), /text\/plain/, 'quem não pediu página não recebe HTML');
});

test('o pedido de música leva um id, e cada fala do bot diz o que aconteceu', async t => {
  const servidor = await iniciarServidor(); t.after(servidor.encerrar);
  const ana = await entrar(servidor, t, await servidor.credencial('Ana', SALA));
  // Um comando que não busca nada: um pedido de verdade sairia para a internet sempre que a
  // máquina do teste tivesse o yt-dlp instalado.
  ana.socket.emitir('musica-comando', { texto: '!pausar' });
  const eco = JSON.parse((await ana.socket.esperar(m => m.includes('musica-mensagem') && m.includes('!pausar'))).slice(2))[1];
  assert.match(eco.id, /^[0-9a-f-]{36}$/, 'o eco do pedido tem id: é embaixo dele que o "procurando" aparece');
  // Com o bot instalado, "não tem nada tocando" é uma dica; sem ele, a fala é o erro de
  // instalação. As duas vêm com o tipo.
  const fala = JSON.parse((await ana.socket.esperar(m => m.includes('musica-mensagem') && m.includes('"doBot":true'))).slice(2))[1];
  assert.ok(['dica', 'erro'].includes(fala.tipo), JSON.stringify(fala));

  servidor.filaDeMusica(SALA, {
    tocando: { id: 't0', titulo: 'A que toca', duracao: 200, pedidoPor: 'Ana' },
    fila: [1, 2, 3].map(n => ({ id: `f${n}`, titulo: `Faixa ${n}`, duracao: 180, pedidoPor: 'Ana' }))
  });
  await ana.socket.esperar(m => m.includes('musica-estado') && m.includes('Faixa 3'));
  assert.equal((await ana.socket.pedir('musica-fila', { acao: 'mover', id: 'f3', para: 1 })).ok, true);
  const aSeguir = JSON.parse((await ana.socket.esperar(m => m.includes('musica-mensagem') && m.includes('Faixa 3'))).slice(2))[1];
  assert.equal(aSeguir.tipo, 'a-seguir');
  assert.match(aSeguir.texto, /\*\*Ana\*\* pôs \*\*Faixa 3\*\* para tocar a seguir/);
});
