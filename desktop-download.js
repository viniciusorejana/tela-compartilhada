const fs = require('node:fs/promises');
const { ipDoPedido } = require('./telemetria/origem');

// O executavel do Windows. Um arquivo so, fixo: nada que venha de um pedido vira caminho.
//
// Ele e grande -- um Electron empacotado carrega o Chromium inteiro -- e sai pela conexao
// de quem hospeda, que costuma ter upload bem menor que download. Por isso as tres regras
// abaixo: quem ja baixou nao rebaixa, quem retoma continua de onde parou, e ninguem
// sozinho ocupa a subida da casa inteira.

// Quantos downloads a MESMA pessoa pode ter em curso. Um navegador as vezes abre duas
// conexoes para o mesmo arquivo; mais do que isso e alguem tentando espremer banda com
// varias conexoes em paralelo -- e quem paga a conta e a sala, que divide a mesma subida.
const DOWNLOADS_SIMULTANEOS_POR_PESSOA = 3;

// Quantos downloads a mesma pessoa pode COMECAR numa janela. Generoso de proposito: uma
// retomada legitima reabre a conexao varias vezes, e um limite apertado transformaria uma
// rede instavel em "o download nao funciona". O que isto barra e o laco automatizado.
const DOWNLOADS_POR_JANELA = 20;
const MINUTOS_DA_JANELA = 10;

// Quem esta baixando agora e quem baixou ha pouco. Mora na memoria e some com o processo:
// nao ha nada aqui que valha a pena guardar entre execucoes.
const emCurso = new Map();     // cliente -> quantidade
const historico = new Map();   // cliente -> [instantes]

// Atras do Tailscale Funnel TODA conexao chega de 127.0.0.1, porque quem fala com o Node e
// o proxy local. Sem olhar o cabecalho, o limite por pessoa viraria um limite para a sala
// inteira: o primeiro a baixar gastaria a cota de todos.
//
// O cabeçalho só vale quando o proxy consta de NEXO_PROXIES_CONFIAVEIS. Mesmo um túnel
// local precisa ser declarado: localhost, sozinho, não prova a origem do cabeçalho.
function quemEsta(req) {
  return ipDoPedido(req);
}

function dentroDoLimite(cliente) {
  const agora = Date.now();
  if (!historico.has(cliente) && historico.size >= 2048) {
    esquecerAntigos();
    if (historico.size >= 2048) return { ok: false, segundos: 60 };
  }
  const recentes = (historico.get(cliente) || []).filter(quando => agora - quando < MINUTOS_DA_JANELA * 60_000);
  if (recentes.length >= DOWNLOADS_POR_JANELA) return { ok: false, segundos: Math.ceil((MINUTOS_DA_JANELA * 60_000 - (agora - recentes[0])) / 1000) };
  if ((emCurso.get(cliente) || 0) >= DOWNLOADS_SIMULTANEOS_POR_PESSOA) return { ok: false, segundos: 0 };
  recentes.push(agora);
  historico.set(cliente, recentes);
  return { ok: true };
}

// Sem esta limpeza o histórico cresceria para sempre num servidor que fica meses no ar --
// uma entrada por pessoa que já passou por aqui, para nunca mais ser consultada.
function esquecerAntigos() {
  const agora = Date.now();
  for (const [cliente, instantes] of historico) {
    const recentes = instantes.filter(quando => agora - quando < MINUTOS_DA_JANELA * 60_000);
    if (recentes.length) historico.set(cliente, recentes);
    else historico.delete(cliente);
  }
}

module.exports = function desktopDownload(app, file, { permitir = () => true, identificar = quemEsta } = {}) {
  const url = '/downloads/SalaCompartilhada.exe';
  const faxina = setInterval(esquecerAntigos, MINUTOS_DA_JANELA * 60_000);
  faxina.unref?.();

  async function artifact() {
    try {
      const info = await fs.stat(file);
      return info.isFile() && info.size > 0 ? info : null;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
  }
  app.get('/api/desktop-app', async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const info = await artifact();
      res.json(info ? { available: true, url, size: info.size, builtAt: info.mtime.toISOString(), platform: 'Windows x64' }
        : { available: false });
    } catch (error) { next(error); }
  });
  app.get(url, async (req, res, next) => {
    if (!permitir(req)) return res.status(429).set('Retry-After', '60').end();
    res.set({
      // Antes era "no-store", o que mandava o navegador esquecer o arquivo assim que ele
      // chegava: clicar de novo rebaixava tudo. Com revalidacao, o pedido seguinte carrega
      // o ETag e volta "304, nao mudou" -- zero byte no lugar de noventa e cinco megabytes.
      // Continua sem servir versao velha, porque a revalidacao e obrigatoria.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      // Anunciado explicitamente para quem baixa saber que pode retomar de onde parou. Numa
      // conexao que oscila, isso e a diferenca entre continuar e recomecar do zero.
      'Accept-Ranges': 'bytes'
    });
    try {
      if (!await artifact()) return res.status(503).type('text').send('O aplicativo para Windows ainda não está disponível. Você pode entrar na sala pelo navegador.');

      const cliente = identificar(req);
      const permissao = dentroDoLimite(cliente);
      if (!permissao.ok) {
        if (permissao.segundos) res.set('Retry-After', String(permissao.segundos));
        return res.status(429).type('text').send(permissao.segundos
          ? `Muitos downloads deste endereço. Tente de novo em ${Math.ceil(permissao.segundos / 60)} min.`
          : 'Já há downloads em andamento neste endereço. Aguarde eles terminarem.');
      }

      emCurso.set(cliente, (emCurso.get(cliente) || 0) + 1);
      let contabilizado = true;
      const devolverVaga = () => {
        if (!contabilizado) return;
        contabilizado = false;
        const restantes = (emCurso.get(cliente) || 1) - 1;
        if (restantes > 0) emCurso.set(cliente, restantes);
        else emCurso.delete(cliente);
      };
      // A vaga volta quando a resposta termina, seja qual for o desfecho: concluida,
      // cancelada no meio, ou com a rede caindo. Sem o "close", uma desistencia deixaria a
      // vaga ocupada para sempre e a pessoa ficaria trancada fora do proprio download.
      res.on('close', devolverVaga);

      res.download(file, 'SalaCompartilhada.exe', { cacheControl: false }, error => {
        devolverVaga();
        if (!error || res.headersSent || error.code === 'ECONNABORTED') return;
        if (error.code === 'ENOENT') res.status(503).send('Download temporariamente indisponível. Tente novamente.');
        else next(error);
      });
    } catch (error) { next(error); }
  });
};
