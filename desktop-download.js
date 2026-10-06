const fs = require('node:fs/promises');
const path = require('node:path');
const { ipDoPedido } = require('./telemetria/origem');
const { valida } = require('./public/versao-app');

// Os executáveis do aplicativo. Um arquivo fixo por sistema, declarado aqui: nada que venha
// de um pedido vira caminho.
//
// Eles são grandes -- um Electron empacotado carrega o Chromium inteiro -- e saem pela
// conexão de quem hospeda, que costuma ter upload bem menor que download. Por isso as três
// regras abaixo: quem já baixou não rebaixa, quem retoma continua de onde parou, e ninguém
// sozinho ocupa a subida da casa inteira.
//
// As chaves são fechadas, e os nomes de arquivo também. Um mapa aberto -- "sirva o que a
// pessoa pedir dentro desta pasta" -- transformaria este módulo num leitor de arquivos
// arbitrários, que é exatamente o que uma rota de download não pode ser.
//
// `familia` agrupa as formas do mesmo sistema na página (o instalador e o portátil são os dois
// "Windows"); `atualizaSozinho` diz quais se atualizam pelo electron-updater, pela pasta de
// atualizações abaixo. A ordem é a da página quando ela não sabe qual é o sistema de quem vê.
const SISTEMAS = Object.freeze({
  'windows-instalador': { arquivo: 'Nexo-Setup.exe', nome: 'Windows x64', tipo: 'instalador .exe', familia: 'windows', atualizaSozinho: true },
  windows: { arquivo: 'SalaCompartilhada.exe', nome: 'Windows x64', tipo: '.exe portátil', familia: 'windows', atualizaSozinho: false },
  linux: { arquivo: 'Nexo.AppImage', nome: 'Linux x64', tipo: '.AppImage', familia: 'linux', atualizaSozinho: true },
  'linux-deb': { arquivo: 'Nexo.deb', nome: 'Linux x64 (Debian, Ubuntu)', tipo: 'instalador .deb', familia: 'linux', atualizaSozinho: true },
  mac: { arquivo: 'Nexo.dmg', nome: 'macOS', tipo: '.dmg', familia: 'mac', atualizaSozinho: false },
  android: { arquivo: 'Nexo.apk', nome: 'Android', tipo: '.apk', familia: 'android', atualizaSozinho: false }
});

// O que o aplicativo instalado lê para se atualizar (electron-updater, provedor "generic"): a
// ficha da versão de cada sistema, que o electron-builder escreve ao empacotar, e o mapa de
// blocos do instalador, que faz a atualização baixar só o que mudou. Os executáveis que as
// fichas citam são os mesmos dos downloads, com as mesmas regras.
const FICHAS_DE_ATUALIZACAO = Object.freeze(['latest.yml', 'latest-linux.yml']);
const MAPAS_DE_BLOCOS = Object.freeze({ 'Nexo-Setup.exe.blockmap': 'windows-instalador' });

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

// Atras de um proxy ou tunel (Caddy, Cloudflare Tunnel) TODA conexao chega de 127.0.0.1, porque
// quem fala com o Node e o proxy local. Sem olhar o cabecalho, o limite por pessoa viraria um limite para a sala
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

// A versão de cada build, anotada por app/escrever-versao.js ao empacotar. Sem o arquivo, ou
// sem a linha de um sistema, a versão fica desconhecida -- e desconhecida não gera aviso de
// atualização nenhum: é melhor não avisar do que mandar alguém baixar o mesmo arquivo em laço.
async function lerVersoes(arquivo) {
  if (!arquivo) return {};
  try {
    const { sistemas } = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    const versoes = {};
    for (const chave of Object.keys(SISTEMAS)) if (valida(sistemas?.[chave]?.versao)) versoes[chave] = sistemas[chave].versao;
    return versoes;
  } catch (_) { return {}; }
}

// `arquivos` é o caminho do executável do Windows (forma antiga, mantida) ou um mapa com os
// caminhos de cada build, pelas chaves de SISTEMAS. Cada sistema é opcional: quem compila só o
// Windows continua servindo só o Windows, e a página mostra o que existe. `atualizacoes` é a
// pasta das fichas do electron-updater (normalmente a mesma dos builds).
module.exports = function desktopDownload(app, arquivos, { permitir = () => true, identificar = quemEsta, versoes = null, atualizacoes = null } = {}) {
  const caminhos = typeof arquivos === 'string' ? { windows: arquivos } : (arquivos || {});
  const url = chave => `/downloads/${SISTEMAS[chave].arquivo}`;
  const faxina = setInterval(esquecerAntigos, MINUTOS_DA_JANELA * 60_000);
  faxina.unref?.();

  async function artifact(chave = 'windows') {
    const file = caminhos[chave];
    if (!file) return null;
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
      const versaoDe = await lerVersoes(versoes);
      const encontrados = await Promise.all(Object.keys(SISTEMAS).map(async chave => {
        const info = await artifact(chave);
        return info && { chave, ...SISTEMAS[chave], url: url(chave), size: info.size, builtAt: info.mtime.toISOString(), versao: versaoDe[chave] || null };
      }));
      const sistemas = encontrados.filter(Boolean);
      const windows = sistemas.find(s => s.chave === 'windows');
      // Os campos soltos são do Windows e continuam onde estavam. A página nova lê
      // `sistemas`; uma página antiga em cache continua funcionando com os campos de sempre,
      // e uma troca de formato que quebrasse isso apareceria como "o download desapareceu".
      res.json(windows
        ? { available: true, url: windows.url, size: windows.size, builtAt: windows.builtAt, platform: windows.nome, sistemas }
        : { available: false, sistemas });
    } catch (error) { next(error); }
  });
  for (const chave of Object.keys(SISTEMAS)) app.get(url(chave), (req, res, next) => servir(chave, req, res, next));

  // A pasta que o aplicativo instalado consulta. As fichas são pequenas e mudam a cada build:
  // sem cache nenhum, para ninguém ficar preso numa versão velha. O resto é a lista fechada.
  app.get('/downloads/atualizacoes/:arquivo', async (req, res, next) => {
    const pedido = String(req.params.arquivo || '');
    try {
      if (FICHAS_DE_ATUALIZACAO.includes(pedido) || Object.hasOwn(MAPAS_DE_BLOCOS, pedido)) {
        if (!permitir(req)) return res.status(429).set('Retry-After', '60').end();
        const caminho = FICHAS_DE_ATUALIZACAO.includes(pedido)
          ? (atualizacoes && path.join(atualizacoes, pedido))
          : (caminhos[MAPAS_DE_BLOCOS[pedido]] && `${caminhos[MAPAS_DE_BLOCOS[pedido]]}.blockmap`);
        if (!caminho || !await existe(caminho)) return res.status(404).type('text').send('Este servidor ainda não distribui atualizações automáticas.');
        res.set({ 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (pedido.endsWith('.yml')) res.type('text/yaml; charset=utf-8');
        return res.sendFile(caminho, { cacheControl: false, dotfiles: 'deny' });
      }
      // O executável que a ficha cita, pelo nome: só os que se atualizam sozinhos.
      const chave = Object.keys(SISTEMAS).find(c => SISTEMAS[c].atualizaSozinho && SISTEMAS[c].arquivo === pedido);
      if (chave) return servir(chave, req, res, next);
      res.status(404).end();
    } catch (error) { next(error); }
  });

  async function existe(caminho) {
    try { return (await fs.stat(caminho)).isFile(); } catch (_) { return false; }
  }

  async function servir(chave, req, res, next) {
    const { arquivo, nome } = SISTEMAS[chave];
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
      if (!await artifact(chave)) return res.status(503).type('text').send(`O aplicativo para ${nome} ainda não está disponível. Você pode entrar na sala pelo navegador.`);

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

      res.download(caminhos[chave], arquivo, { cacheControl: false }, error => {
        devolverVaga();
        if (!error || res.headersSent || error.code === 'ECONNABORTED') return;
        if (error.code === 'ENOENT') res.status(503).send('Download temporariamente indisponível. Tente novamente.');
        else next(error);
      });
    } catch (error) { next(error); }
  }
};
module.exports.SISTEMAS = SISTEMAS;
