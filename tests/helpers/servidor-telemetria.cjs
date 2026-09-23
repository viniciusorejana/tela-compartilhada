const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const net = require('node:net');
const dgram = require('node:dgram');

async function portasLivres() {
  const reservas = [], portas = [];
  try {
    for (let i = 0; i < 3; i++) {
      const reserva = net.createServer(); reservas.push(reserva);
      await new Promise((resolve, reject) => { reserva.once('error', reject); reserva.listen(0, '127.0.0.1', resolve); });
      portas.push(reserva.address().port);
    }
    const udp = dgram.createSocket('udp4'); reservas.push(udp);
    await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(0, '127.0.0.1', resolve); });
    portas.push(udp.address().port); return portas;
  } finally { await Promise.all(reservas.map(r => new Promise(resolve => r.close(resolve)))); }
}

// O binário dos testes fica num caminho FIXO, e é por isso que ele existe.
//
// A regra de firewall do Windows é por caminho de executável. Copiando para a pasta
// sorteada de cada execução, toda rodada de teste era um aplicativo novo aos olhos do
// Defender e abria a caixa de "permitir acesso" de novo. Num caminho fixo, permite-se uma
// vez e acabou.
//
// Continua sendo uma CÓPIA, e não o binário instalado, porque encerrarOrfaos() encerra
// processos casando pelo caminho exato: apontar para native/livekit faria um teste matar o
// servidor de verdade de quem estivesse com a sala aberta na mesma máquina.
const PASTA_DO_BINARIO = path.join(os.tmpdir(), 'nexo-sfu-de-teste');

async function binarioDeTeste() {
  const { caminhoDoBinario } = require('../../scripts/baixar-livekit.cjs');
  const origem = caminhoDoBinario();
  const destino = path.join(PASTA_DO_BINARIO, path.basename(origem));
  await fs.mkdir(PASTA_DO_BINARIO, { recursive: true });
  const [dados, copia] = await Promise.all([fs.stat(origem), fs.stat(destino).catch(() => null)]);
  if (copia && copia.size === dados.size && copia.mtimeMs >= dados.mtimeMs) return destino;
  // O Windows tranca o executável enquanto ele roda. Se outra execução de teste estiver
  // usando a cópia, ficamos com a que já está lá -- é a mesma versão em todo caso.
  try { await fs.copyFile(origem, destino); }
  catch (erro) { if (!copia) throw erro; }
  return destino;
}

async function iniciarServidor({ ambiente = {}, registros = [], observacoes = [], midia = false } = {}) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-painel-teste-'));
  const medicao = path.join(pasta, 'medicao'), painel = path.join(pasta, 'painel');
  await fs.mkdir(medicao, { recursive: true });
  if (registros.length) await fs.writeFile(path.join(medicao, 'banda.jsonl'), registros.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (observacoes.length) await fs.writeFile(path.join(medicao, 'uso.jsonl'), observacoes.map(r => JSON.stringify(r)).join('\n') + '\n');
  const pastaSfu = path.join(pasta, 'livekit');
  let binarioSfu = '';
  if (midia) { await fs.mkdir(pastaSfu); binarioSfu = await binarioDeTeste(); }
  const [portaSfu, portaMetricas, portaTcp, portaUdp] = await portasLivres();
  const filho = spawn(process.execPath, ['tests/helpers/iniciar-telemetria.cjs'], { cwd: path.join(__dirname, '..', '..'), windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: '', NEXO_PROXIES_CONFIAVEIS: '', NEXO_SEM_MIDIA: midia ? '0' : '1', NEXO_PASTA_SFU: pastaSfu, NEXO_BINARIO_SFU: binarioSfu, SFU_PORT: String(portaSfu), SFU_METRICAS_PORT: String(portaMetricas), SFU_TCP_PORT: String(portaTcp), SFU_UDP_PORTS: String(portaUdp), SFU_IPS: '', NEXO_IP_PUBLICO: '127.0.0.1', NEXO_ANUNCIAR_LAN: '1', NEXO_DADOS_TELEMETRIA: medicao, NEXO_PASTA_PAINEL: painel, NEXO_PASTA_CONTAS: path.join(pasta, 'contas'),
      // Os testes anteriores às contas abrem salas sem conta, e é isso que eles testam: a sala.
      // Quem testa "só conta abre sala" desliga esta janela com NEXO_ANONIMO_ABRE_SALA=0.
      NEXO_ANONIMO_ABRE_SALA: '1',
      // Pelo mesmo motivo, os testes de mídia transmitem sem o teto dos planos: eles escolhem
      // 1080p e 1440p a 60 quadros sem conta. Quem testa os planos liga com NEXO_PLANOS=1.
      NEXO_PLANOS: '0', ...ambiente },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let erros = ''; filho.stderr.on('data', p => { erros = (erros + p).slice(-16000); });
  async function encerrar() {
    if (filho.exitCode === null) {
      const fim = new Promise(resolve => filho.once('exit', resolve));
      if (filho.connected) filho.send({ tipo: 'encerrar' }); else filho.kill();
      const prazo = setTimeout(() => filho.kill(), 5000); await fim; clearTimeout(prazo);
    }
    const resolvido = path.resolve(pasta), temporario = path.resolve(os.tmpdir()) + path.sep;
    if (!resolvido.startsWith(temporario) || !path.basename(resolvido).startsWith('nexo-painel-teste-')) throw new Error('Pasta de teste inválida.');
    // O Windows pode manter o executável bloqueado por instantes após o processo sair.
    await fs.rm(resolvido, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  try {
    const porta = await new Promise((resolve, reject) => {
      const prazo = setTimeout(() => reject(new Error('O servidor não iniciou: ' + erros)), 20000);
      filho.once('error', erro => { clearTimeout(prazo); reject(erro); });
      filho.once('exit', () => { clearTimeout(prazo); reject(new Error('Servidor encerrou: ' + erros)); });
      filho.on('message', m => { if (m.tipo === 'pronto') { clearTimeout(prazo); resolve(m.porta); } });
    });
    const origem = `http://127.0.0.1:${porta}`;
    return { origem, pasta, medicao, painel, pastaSfu, portaMetricas, filho, encerrar, erros: () => erros,
      // Monta a fila de música de uma sala à mão (ver iniciar-telemetria.cjs).
      filaDeMusica(sala, dados) { filho.send({ tipo: 'fila-de-teste', sala, ...dados }); },
      async chave() { return JSON.parse(await fs.readFile(path.join(painel, 'segredo.json'), 'utf8')).segredo; },
      async credencial(nome = 'Teste', sala = 'squad-teste', credencial = '', cookie = '') {
        const cabecalhos = {};
        if (credencial) cabecalhos['X-Nexo-Sessao'] = credencial;
        if (cookie) cabecalhos.Cookie = cookie;
        const r = await fetch(`${origem}/api/sala-config?sala=${sala}&nome=${encodeURIComponent(nome)}`, { headers: cabecalhos });
        return r.json();
      },
      // Cria uma conta e devolve o cookie dela; com `sala`, já pede a entrada nela.
      async conta(usuario, { apelido = usuario, sala = null } = {}) {
        const r = await fetch(`${origem}/api/conta/cadastrar`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, apelido, senha: 'cafe com pao no sabado' }) });
        if (r.status !== 201) throw new Error(`Não foi possível criar a conta ${usuario}: ${r.status} ${await r.text()}`);
        const cookie = r.headers.get('set-cookie').split(';')[0];
        const conta = (await r.json()).conta;
        return { cookie, conta, ...(sala ? await this.credencial(apelido, sala, '', cookie) : {}) };
      }
    };
  } catch (erro) { await encerrar(); throw erro; }
}
async function conectarSocket(origem, credencial) {
  const ws = new WebSocket(origem.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
  const recebidos = [], ouvintes = new Set(); let id = 0;
  ws.on('message', bruto => {
    const texto = bruto.toString();
    if (texto === '2') { ws.send('3'); return; }
    recebidos.push(texto); while (recebidos.length > 200) recebidos.shift();
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
  ws.send('40' + JSON.stringify({ credencial }));
  const conectado = await esperar(t => t.startsWith('40') || t.startsWith('44'));
  if (conectado.startsWith('44')) { ws.close(); throw new Error(conectado); }
  return { ws, recebidos, esperar,
    emitir(evento, ...args) { ws.send('42' + JSON.stringify([evento, ...args])); },
    async pedir(evento, ...args) { const numero = ++id; ws.send(`42${numero}` + JSON.stringify([evento, ...args])); const texto = await esperar(t => t.startsWith(`43${numero}[`)); return JSON.parse(texto.slice(`43${numero}`.length))[0]; },
    fechar: () => ws.close()
  };
}
module.exports = { iniciarServidor, conectarSocket };
