'use strict';

// Aplicativo de mesa: a MESMA sala que roda no navegador, só que fora dele.
//
// O motivo não é estético. No navegador o Chrome usa dois chapéus ao mesmo tempo: ele é o
// cliente (toca a voz e as telas dos outros) e é uma fonte legítima de som (um vídeo que
// você quer compartilhar). A captura do Windows exclui UMA árvore de processos, então os
// dois papéis não cabem na mesma escolha -- ou você perde o Chrome como fonte, ou ele
// devolve para a rede tudo o que acabou de receber dela.
//
// Aqui o cliente é este aplicativo. Ele entrega o próprio PID para o agente, que exclui
// esta árvore da captura, e o navegador volta a ser apenas mais um programa que faz som.
//
// A interface não é copiada para cá: a janela carrega a mesma URL do servidor. Uma
// interface só, um lugar para manter.

const { app, BrowserWindow, Menu, session, desktopCapturer, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const { criarAtualizador } = require('./atualizacao-automatica');
const inicializacao = require('./iniciar-com-o-sistema');
const executar = promisify(execFile);

const ARQUIVO_DE_CONFIG = () => path.join(app.getPath('userData'), 'config.json');

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_DE_CONFIG(), 'utf8')); }
  catch (_) { return {}; }
}

function salvarConfig(dados) {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_DE_CONFIG()), { recursive: true });
    fs.writeFileSync(ARQUIVO_DE_CONFIG(), JSON.stringify(dados, null, 2));
  } catch (erro) { console.error('Não foi possível salvar a configuração:', erro.message); }
}

// O servidor que a tela de endereço já traz preenchido. Quem abre o Nexo pela primeira vez só aperta "Conectar",
// sem saber digitar um endereço; quem usa outro servidor troca o texto, e a sala tem "Trocar de servidor" nas
// configurações. O valor é o NEXO_SERVIDOR_PADRAO do .env.prod, gravado em servidor-padrao.json ao empacotar
// (scripts/servidor-padrao.cjs: o aplicativo instalado não lê o .env de ninguém). A variável, se estiver no
// ambiente, vence o arquivo, para desenvolver contra outro servidor. Só entra uma origem http(s) válida: o que
// passa daqui vai para a página.
function servidorPadrao() {
  let doArquivo = '';
  try { doArquivo = JSON.parse(fs.readFileSync(path.join(__dirname, 'servidor-padrao.json'), 'utf8')).endereco; } catch (_) { /* sem arquivo: sem padrão */ }
  return origemHttp(process.env.NEXO_SERVIDOR_PADRAO) || origemHttp(doArquivo) || '';
}

let janela = null;
let agente = null;
// Endereço que está sendo tentado agora. Só vira configuração se a página carregar.
let enderecoPendente = null;
// A única origem em que a janela pode ficar, e a única que fala com as funções nativas. Ela
// nasce do endereço que a PESSOA escolheu -- digitado na tela local ou salvo de uma vez
// anterior -- e nunca de um pedido da página, que é conteúdo remoto.
//
// Antes, a página conseguia trocar o servidor salvo, a janela podia navegar para qualquer
// lugar levando a ponte nativa junto, e as funções nativas aceitavam qualquer página http(s).
// Somadas, bastava uma falha de XSS na sala -- ou um servidor malicioso aberto uma vez -- para
// prender o aplicativo num endereço de fora e, de lá, ligar o agente de áudio desta máquina.
let origemDaSala = null;

function origemHttp(endereco) {
  try {
    const alvo = new URL(String(endereco));
    return alvo.protocol === 'http:' || alvo.protocol === 'https:' ? alvo.origin : null;
  } catch (_) { return null; }
}

const PAGINA_DE_ENDERECO = pathToFileURL(path.join(__dirname, 'endereco.html')).pathname;

function mostrarTelaDeEndereco(erro, anterior) {
  if (!janela) return;
  enderecoPendente = null;
  const consulta = {};
  if (erro) consulta.erro = erro;
  if (anterior) consulta.anterior = anterior;
  janela.loadFile(path.join(__dirname, 'endereco.html'), { query: consulta });
}

function irParaEndereco(url) {
  if (!janela) return;
  enderecoPendente = url;
  origemDaSala = origemHttp(url);
  janela.loadURL(url);
}

// A abertura do aplicativo: a janela mostra o Nexo carregando (carregando.html, local, na hora) enquanto o servidor
// responde -- o endereço, a conexão, o HTML chegando --, em vez de uma janela escura e vazia. A tela fica até a sala
// pintar pela primeira vez; se o servidor não responde, o `did-fail-load` de sempre leva à tela de endereço.
// O endereço só entra em `enderecoPendente` DEPOIS de a abertura carregar: o `did-finish-load` dela não pode
// "guardar" um endereço que ainda não carregou (veja o comentário de `did-finish-load`).
function abrirComCarregamento(url) {
  if (!janela) return;
  janela.loadFile(path.join(__dirname, 'carregando.html'))
    .catch(() => { /* sem a tela de abertura a janela só espera: o servidor abre do mesmo jeito */ })
    .finally(() => irParaEndereco(url));
}

// ---------------------------------------------------------------- janela principal
function criarJanela() {
  janela = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#06080a',
    autoHideMenuBar: true,
    title: 'Sala compartilhada',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // A sala é conteúdo REMOTO: fica isolada do Node, como qualquer página.
      contextIsolation: true,
      nodeIntegration: false,
      // É por aqui que o PID do aplicativo chega até a página. O PID que interessa é o do
      // processo principal: ele é a raiz da árvore, e excluir a raiz exclui os filhos --
      // inclusive o processo de áudio, que é quem realmente toca o som.
      // A versão vai pelo mesmo caminho: é com ela que a sala diz, sem insistir, que existe um
      // aplicativo mais novo (public/versao-app.js).
      // E o tipo de instalação, que decide se a página espera a atualização sozinha (instalador,
      // AppImage, .deb) ou oferece o download do arquivo novo (portátil).
      // O servidor padrão vai pelo mesmo caminho: é a tela de endereço que o mostra preenchido.
      additionalArguments: [`--pid-do-app=${process.pid}`, `--versao-do-app=${app.getVersion()}`, `--instalacao=${atualizador.tipo}`, `--servidor-padrao=${servidorPadrao()}`]
    }
  });

  // Aberto pelo sistema, ao entrar no computador: começa minimizado (iniciar-com-o-sistema.js).
  if (inicializacao.abertoPeloSistema()) janela.minimize();

  // Um endereço só é guardado depois de carregar de verdade. Guardar antes prendia a pessoa
  // numa página quebrada -- e, sem tela de endereço, sem forma de corrigir: foi o que
  // aconteceu quando o servidor estava fora do ar no momento em que o endereço foi digitado.
  janela.webContents.on('did-finish-load', () => {
    // A sala abriu: é dela que vêm as atualizações do aplicativo instalado.
    if (origemDaSala && origemHttp(janela.webContents.getURL()) === origemDaSala) atualizador.definirOrigem(origemDaSala);
    if (!enderecoPendente) return;
    // O resto da configuração (atualizar sozinho, por exemplo) sobrevive à troca de servidor.
    salvarConfig({ ...lerConfig(), endereco: enderecoPendente });
    enderecoPendente = null;
  });

  janela.webContents.on('did-fail-load', (evento, codigo, descricao, urlQueFalhou, ehJanelaPrincipal) => {
    // -3 é navegação abortada (a própria troca de página), não é falha.
    if (!ehJanelaPrincipal || codigo === -3) return;
    const tentado = enderecoPendente || urlQueFalhou;
    // O endereço anterior que funcionava continua guardado: o servidor pode só estar fora do
    // ar por um momento, e apagar a configuração obrigaria a redigitar por nada.
    mostrarTelaDeEndereco(`${descricao || 'falha ao carregar'} (${codigo})`, tentado);
  });

  // O próprio endereço escolhido pode redirecionar ao abrir -- http para https, o domínio sem
  // "www" para o com --, e aí a origem certa é a de chegada. Só enquanto o endereço está sendo
  // aberto: depois disso, a origem só muda pela tela de endereço.
  janela.webContents.on('did-navigate', (_evento, url) => {
    if (enderecoPendente) origemDaSala = origemHttp(url);
  });

  // A janela fica na origem da sala. Qualquer outro destino abre no navegador de verdade, como
  // os links do chat já abrem: é lá que um site de fora deve rodar, longe da ponte nativa.
  const manterNaSala = detalhes => {
    if (origemDaSala && origemHttp(detalhes.url) === origemDaSala) return;
    detalhes.preventDefault();
    if (origemHttp(detalhes.url)) shell.openExternal(detalhes.url);
  };
  janela.webContents.on('will-navigate', manterNaSala);
  janela.webContents.on('will-redirect', detalhes => {
    if (!detalhes.isMainFrame || enderecoPendente) return;
    manterNaSala(detalhes);
  });

  const config = lerConfig();
  if (config.endereco) abrirComCarregamento(config.endereco);
  else janela.loadFile(path.join(__dirname, 'endereco.html'));

  // Link externo abre no navegador de verdade, não dentro da sala.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  janela.on('closed', () => { janela = null; });
}

// ---------------------------------------------------------------- escolha da tela
// O Electron não traz seletor de tela: quem pergunta "qual janela?" é a aplicação. Esta é
// a janelinha com as miniaturas.
function escolherFonte(fontes) {
  return new Promise((resolver) => {
    const escolha = new BrowserWindow({
      width: 900,
      height: 620,
      parent: janela,
      modal: true,
      backgroundColor: '#0b0e11',
      autoHideMenuBar: true,
      title: 'O que você quer compartilhar?',
      webPreferences: {
        // Isolada como a sala, mesmo sendo página nossa: os nomes que ela mostra vêm de qualquer
        // programa aberto (ver preload-escolher.js).
        preload: path.join(__dirname, 'preload-escolher.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    let respondido = false;
    const responder = (valor) => {
      if (respondido) return;
      respondido = true;
      ipcMain.removeListener('escolher:pronto', aoEscolher);
      if (!escolha.isDestroyed()) escolha.close();
      resolver(valor);
    };

    const aoEscolher = (evento, id) => {
      if (evento.sender !== escolha.webContents) return;
      responder(fontes.find(f => f.id === id) || null);
    };

    ipcMain.on('escolher:pronto', aoEscolher);
    // Fechar a janela no X é uma resposta válida: quer dizer "desisti".
    escolha.on('closed', () => responder(null));

    escolha.webContents.once('did-finish-load', () => {
      escolha.webContents.send('escolher:fontes', fontes.map(f => ({
        id: f.id,
        nome: f.name,
        tipo: f.id.startsWith('screen:') ? 'tela' : 'janela',
        miniatura: f.thumbnail.toDataURL()
      })));
    });
    escolha.loadFile(path.join(__dirname, 'escolher.html'));
  });
}

let capturaPendente = null;
let ultimaCaptura = null;
let selecionandoCaptura = false;
function remetenteDaSala(evento) {
  if (!janela || !origemDaSala || evento.sender !== janela.webContents || evento.senderFrame !== janela.webContents.mainFrame) return false;
  return origemHttp(evento.senderFrame.url) === origemDaSala;
}
// A tela de endereço é a única página que troca o servidor.
function remetenteLocal(evento) {
  if (!janela || evento.sender !== janela.webContents || evento.senderFrame !== janela.webContents.mainFrame) return false;
  try {
    const pagina = new URL(evento.senderFrame.url);
    return pagina.protocol === 'file:' && pagina.pathname === PAGINA_DE_ENDERECO;
  } catch (_) { return false; }
}
// Fechar o aplicativo compartilhado deveria encerrar a transmissão, e não encerrava: a
// faixa de vídeo continuava "viva", congelada no último quadro, e a sala seguia pagando
// banda por uma imagem parada que ninguém podia mais mudar.
//
// O evento "ended" da faixa é quem deveria avisar, e no navegador ele avisa. Aqui dentro
// não dá para contar com ele: quem entrega os quadros é o capturador de janela do Chromium,
// e a janela sumir nem sempre vira fim de faixa. Então o aplicativo passa a vigiar por
// fora, com o dado que já tinha em mãos.
//
// Vigiar o PROCESSO, e não a janela. Enumerar janelas seria o sinal mais preciso -- pegaria
// até fechar uma janela de um aplicativo que continua aberto --, mas desktopCapturer não
// lista todas as janelas do sistema (medido: um Bloco de Notas aberto não aparece), e um
// sinal que some sozinho encerraria a transmissão de quem não fechou nada. Entre falhar em
// encerrar e encerrar por engano, o engano é muito pior.
//
// O processo, ao contrário, é inequívoco: se ele não existe mais, aquela janela não volta.
const MS_ENTRE_CONFERENCIAS = 2000;
let vigiaDaCaptura = null;

function pararDeVigiarCaptura() {
  if (vigiaDaCaptura) { clearInterval(vigiaDaCaptura); vigiaDaCaptura = null; }
}

function vigiarProcessoDaCaptura(pid) {
  pararDeVigiarCaptura();
  if (!Number.isInteger(pid) || pid <= 0) return;
  vigiaDaCaptura = setInterval(() => {
    let vivo = true;
    // O sinal 0 não mata nada: só pergunta se o processo existe e se podemos alcançá-lo.
    // "Sem permissão" é resposta de processo VIVO -- encerrar por causa dela seria desligar
    // a tela de quem compartilhou algo que roda com outro usuário.
    try { process.kill(pid, 0); } catch (erro) { vivo = erro.code === 'EPERM'; }
    if (vivo) return;
    pararDeVigiarCaptura();
    ultimaCaptura = null;
    if (janela && !janela.isDestroyed()) janela.webContents.send('captura:encerrada', { motivo: 'processo-encerrado' });
  }, MS_ENTRE_CONFERENCIAS);
  vigiaDaCaptura.unref?.();
}

ipcMain.handle('captura:preparar', (evento, tipo) => {
  if (!remetenteDaSala(evento) || selecionandoCaptura || !['monitor', 'window'].includes(tipo)) return false;
  capturaPendente = { tipo, frame: evento.senderFrame, criada: Date.now() };
  ultimaCaptura = null;
  pararDeVigiarCaptura();
  return true;
});
ipcMain.handle('captura:selecionada', evento => remetenteDaSala(evento) ? ultimaCaptura : null);
// A sala avisa quando para de compartilhar. Sem isto o vigia continuaria de pé depois de a
// transmissão já ter acabado, e o aviso chegaria fora de hora -- quando a pessoa fechasse
// aquele aplicativo horas depois, sem estar compartilhando nada.
ipcMain.handle('captura:encerrei', evento => { if (remetenteDaSala(evento)) { pararDeVigiarCaptura(); ultimaCaptura = null; } });

async function processoDaFonte(fonte) {
  const hwnd = /^window:(\d+):/.exec(fonte.id)?.[1];
  const caminho = caminhoDoAgente();
  if (!hwnd || !caminho) return 0;
  try {
    const { stdout } = await executar(caminho, ['--janela', hwnd], { windowsHide: true, timeout: 4000, maxBuffer: 4096 });
    const pid = JSON.parse(stdout).pid;
    // Sharing this application's audio would feed the room back into itself.
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid ? pid : 0;
  } catch (_) { return 0; }
}

function instalarSeletorDeTela() {
  session.defaultSession.setDisplayMediaRequestHandler(async (pedido, responder) => {
    const pedidoPreparado = capturaPendente;
    capturaPendente = null;
    if (selecionandoCaptura || !pedidoPreparado || pedido.frame !== pedidoPreparado.frame
      || Date.now() - pedidoPreparado.criada > 60000) { responder(undefined); return; }
    selecionandoCaptura = true;
    try {
      const fontes = await desktopCapturer.getSources({
        types: [pedidoPreparado.tipo === 'window' ? 'window' : 'screen'],
        thumbnailSize: { width: 320, height: 180 }
      });
      const escolhida = await escolherFonte(fontes);
      if (escolhida) ultimaCaptura = { tipo: pedidoPreparado.tipo, nome: escolhida.name,
        pid: pedidoPreparado.tipo === 'window' ? await processoDaFonte(escolhida) : 0 };
      // Só janela é vigiada. Uma tela inteira não tem dono que possa fechar, e o monitor
      // sumir (cabo, projetor desligado) já vira fim de faixa por conta própria.
      if (ultimaCaptura?.tipo === 'window') vigiarProcessoDaCaptura(ultimaCaptura.pid);
      // O áudio depende de haver agente, e a escolha aqui é entre dois defeitos.
      //
      // Onde o agente EXISTE (Windows, hoje), ele é quem captura: só ele sabe excluir uma
      // árvore de processos, e é essa exclusão que evita o eco -- o som da sala voltando para
      // a sala. Pedir `loopback` ali seria capturar tudo, inclusive este aplicativo, e trocar
      // uma solução boa por uma ruim.
      //
      // Onde ele NÃO existe (Linux e macOS, até haver um agente nativo para eles), a escolha
      // passa a ser entre `loopback` com risco de eco e nenhum som. E som com ressalva vale
      // mais do que silêncio: quem usa fone não tem eco nenhum, e quem usa caixa é avisado
      // pela própria sala antes de compartilhar.
      const comAgente = Boolean(caminhoDoAgente());
      responder(escolhida
        ? (comAgente ? { video: escolhida } : { video: escolhida, audio: 'loopback' })
        : undefined);
    } catch (erro) {
      console.error('Falha ao listar as telas:', erro.message);
      responder(undefined);
    } finally {
      selecionandoCaptura = false;
    }
  }, { useSystemPicker: true });
}

// ---------------------------------------------------------------- agente de áudio
function caminhoDoAgente() {
  const candidatos = [
    path.join(process.resourcesPath || '', 'AgenteAudio.exe'),
    path.join(path.dirname(app.getPath('exe')), 'AgenteAudio.exe'),
    path.join(__dirname, '..', 'native', 'audio-agent', 'x64', 'Release', 'AgenteAudio.exe')
  ];
  return candidatos.find(c => c && fs.existsSync(c)) || null;
}

function pararAgente() {
  if (agente && !agente.killed) { try { agente.kill(); } catch (_) { /* já morreu */ } }
  agente = null;
}

ipcMain.handle('agente:iniciar', (evento, url) => {
  // A sala é conteúdo remoto, e isto aqui lança um processo. O endereço tem de ser um
  // WebSocket do MESMO servidor que a janela está mostrando -- senão uma página qualquer
  // poderia apontar o agente desta máquina para onde quisesse.
  //
  // E a própria página tem de ser a da sala escolhida. Sozinha, a trava do endereço não
  // servia: uma página de outro servidor apontava o agente para ela mesma e passava.
  if (!remetenteDaSala(evento)) return { rodando: false, motivo: 'outro-servidor' };
  let alvo;
  try { alvo = new URL(String(url)); } catch (_) { return { rodando: false, motivo: 'url-invalida' }; }
  if (alvo.protocol !== 'ws:' && alvo.protocol !== 'wss:') return { rodando: false, motivo: 'url-invalida' };

  let atual;
  try { atual = new URL(evento.sender.getURL()); } catch (_) { return { rodando: false, motivo: 'url-invalida' }; }
  if (atual.host !== alvo.host) return { rodando: false, motivo: 'outro-servidor' };

  if (agente && !agente.killed) return { rodando: true, jaEstava: true };

  const caminho = caminhoDoAgente();
  if (!caminho) return { rodando: false, motivo: 'nao-encontrado' };

  try {
    agente = spawn(caminho, [alvo.toString()], { windowsHide: true, stdio: 'ignore' });
    agente.on('exit', () => { agente = null; });
    agente.on('error', () => { agente = null; });
    return { rodando: true, caminho };
  } catch (erro) {
    agente = null;
    return { rodando: false, motivo: erro.message };
  }
});

ipcMain.handle('agente:estado', () => ({
  rodando: Boolean(agente && !agente.killed),
  disponivel: Boolean(caminhoDoAgente()),
  // Sem agente, o som da tela vem pelo loopback do próprio Electron -- e a sala precisa saber
  // disso para avisar do eco ANTES de a pessoa compartilhar. O aviso depois não serve: o eco
  // aparece no ouvido dos outros, não no de quem transmite.
  loopback: !caminhoDoAgente(),
  plataforma: process.platform
}));

ipcMain.handle('endereco:definir', (evento, endereco) => {
  // Só a tela local troca o servidor. O endereço vira configuração assim que carrega, e vale
  // nas próximas aberturas: se a sala pudesse chamar isto, o aplicativo ficaria preso para
  // sempre onde uma página remota mandasse.
  if (!remetenteLocal(evento)) return { ok: false };
  let alvo;
  try { alvo = new URL(String(endereco)); } catch (_) { return { ok: false }; }
  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return { ok: false };
  irParaEndereco(alvo.toString());
  return { ok: true };
});

// Serve para voltar à tela de endereço sem precisar apagar arquivo nenhum.
ipcMain.handle('endereco:esquecer', evento => {
  if (!remetenteDaSala(evento) && !remetenteLocal(evento)) return { ok: false };
  mostrarTelaDeEndereco('', lerConfig().endereco || '');
  return { ok: true };
});

// ---------------------------------------------------------------- atualização
// A versão nova baixada pelo próprio aplicativo, com o progresso na sala. Antes, "Baixar agora"
// abria o navegador do sistema: noventa megabytes descendo lá fora, sem sinal nenhum aqui
// dentro, e depois a pessoa ainda tinha de achar o arquivo e trocar um pelo outro na mão.
//
// A página é conteúdo remoto, então ela só PEDE, e só a versão: o endereço é montado aqui, na
// origem da sala e num caminho fixo por sistema; o arquivo vai para Downloads com um nome
// montado aqui; e abrir o que foi baixado passa por uma pergunta nativa, que página nenhuma
// consegue responder sozinha.
//
// Isso é o PORTÁTIL. O aplicativo instalado (o instalador do Windows, o AppImage, o .deb) se
// atualiza sozinho pelo electron-updater, em atualizacao-automatica.js; os canais abaixo são os
// mesmos para os dois, e cada um passa adiante para quem cuida daquele tipo.
const atualizador = criarAtualizador({
  lerConfig, salvarConfig,
  avisar: dados => { if (janela && !janela.isDestroyed()) janela.webContents.send('atualizacao:progresso', dados); }
});
const BUILD_DO_SISTEMA = { win32: 'SalaCompartilhada.exe', linux: 'Nexo.AppImage', darwin: 'Nexo.dmg' };
const ESTADOS_DA_ATUALIZACAO = new Set(['disponivel', 'pedido', 'baixando', 'pronto', 'cancelado', 'falhou']);
let atualizacao = null; // { url, versao, estado, item, caminho, recebidos, total }

function avisarAtualizacao() {
  if (!atualizacao || !janela || janela.isDestroyed()) return;
  const { estado, versao, recebidos = 0, total = 0, caminho } = atualizacao;
  janela.webContents.send('atualizacao:progresso', { estado, versao, recebidos, total, arquivo: caminho ? path.basename(caminho) : '' });
}

// "Nexo 1.2.0.exe", ou "Nexo 1.2.0 (2).exe" se já houver um: nunca por cima de um arquivo que
// a pessoa guardou -- nem do próprio aplicativo aberto, que pode estar justamente em Downloads.
function caminhoLivre(pasta, base, extensao) {
  for (let n = 1; n < 100; n++) {
    const candidato = path.join(pasta, `${base}${n > 1 ? ` (${n})` : ''}${extensao}`);
    if (!fs.existsSync(candidato)) return candidato;
  }
  return path.join(pasta, `${base} ${Date.now()}${extensao}`);
}

function instalarDownloadDaAtualizacao() {
  session.defaultSession.on('will-download', (_evento, item) => {
    // Só o download que ESTE módulo pediu. Os outros (uma imagem do chat, os dados da conta)
    // seguem o caminho de sempre, com a janela de "salvar como".
    if (atualizacao?.estado !== 'pedido' || !item.getURLChain().includes(atualizacao.url)) return;
    const extensao = path.extname(BUILD_DO_SISTEMA[process.platform]);
    const destino = caminhoLivre(app.getPath('downloads'), `Nexo ${atualizacao.versao}`, extensao);
    item.setSavePath(destino);
    Object.assign(atualizacao, { estado: 'baixando', item, caminho: destino, recebidos: 0, total: item.getTotalBytes() });
    avisarAtualizacao();
    let ultimoAviso = 0;
    item.on('updated', () => {
      atualizacao.recebidos = item.getReceivedBytes();
      atualizacao.total = item.getTotalBytes();
      // Dez avisos por segundo bastam à barra; um por pedaço seriam centenas atravessando a ponte.
      if (Date.now() - ultimoAviso < 100) return;
      ultimoAviso = Date.now();
      avisarAtualizacao();
    });
    item.once('done', (_e, desfecho) => {
      atualizacao.item = null;
      atualizacao.recebidos = item.getReceivedBytes();
      if (desfecho === 'completed') {
        // Um AppImage baixado chega sem permissão de execução, e "abrir" falharia calado.
        if (process.platform === 'linux') { try { fs.chmodSync(destino, 0o755); } catch (_) { /* segue: a pessoa ainda pode abrir pela pasta */ } }
        atualizacao.estado = 'pronto';
      } else {
        atualizacao.estado = desfecho === 'cancelled' ? 'cancelado' : 'falhou';
        // Um arquivo pela metade em Downloads só confundiria.
        try { fs.rmSync(destino, { force: true }); } catch (_) { /* o Chromium já pode ter apagado */ }
        atualizacao.caminho = null;
      }
      avisarAtualizacao();
    });
  });
}

ipcMain.handle('atualizacao:baixar', (evento, versao) => {
  if (!remetenteDaSala(evento)) return { ok: false, motivo: 'outro-servidor' };
  // Instalado: quem sabe qual é a versão nova é a ficha do servidor, e não a página.
  if (atualizador.ativo) return atualizador.baixar();
  const arquivo = BUILD_DO_SISTEMA[process.platform];
  if (!arquivo || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(versao))) return { ok: false, motivo: 'versao-invalida' };
  if (atualizacao && ['pedido', 'baixando'].includes(atualizacao.estado)) return { ok: true, jaEstava: true };
  if (atualizacao?.estado === 'pronto' && atualizacao.versao === versao && fs.existsSync(atualizacao.caminho)) { avisarAtualizacao(); return { ok: true, jaEstava: true }; }
  const url = new URL(`/downloads/${arquivo}`, origemDaSala).toString();
  atualizacao = { url, versao: String(versao), estado: 'pedido', item: null, caminho: null, recebidos: 0, total: 0 };
  janela.webContents.downloadURL(url);
  // Um servidor que nem responde não chega a virar download, e a barra ficaria andando para
  // sempre. Vinte segundos sem começar é falha, com o caminho do navegador oferecido na sala.
  const pedida = atualizacao;
  setTimeout(() => { if (atualizacao === pedida && pedida.estado === 'pedido') { pedida.estado = 'falhou'; avisarAtualizacao(); } }, 20000).unref?.();
  return { ok: true };
});
ipcMain.handle('atualizacao:cancelar', evento => {
  if (!remetenteDaSala(evento)) return false;
  if (atualizador.ativo) return atualizador.cancelar();
  if (!atualizacao?.item) return false;
  atualizacao.item.cancel();
  return true;
});
// A página recarregada no meio do download volta a mostrar a barra de onde ela estava.
ipcMain.handle('atualizacao:estado', evento => {
  if (!remetenteDaSala(evento)) return null;
  if (atualizador.ativo) return atualizador.estado();
  if (!atualizacao || !ESTADOS_DA_ATUALIZACAO.has(atualizacao.estado)) return null;
  return { estado: atualizacao.estado, versao: atualizacao.versao, recebidos: atualizacao.recebidos || 0, total: atualizacao.total || 0 };
});
// "Procurar agora", das configurações: sem esperar a volta das quatro horas.
ipcMain.handle('atualizacao:procurar', async evento => {
  if (!remetenteDaSala(evento) || !atualizador.ativo) return { ok: false };
  // Já achada (descendo ou pronta): não há o que procurar, e a resposta é a que já se tem.
  const atual = atualizador.estado();
  if (atual && ['disponivel', 'pedido', 'baixando', 'pronto'].includes(atual.estado)) return { ok: true, nova: true, versao: atual.versao };
  const resultado = await atualizador.procurar();
  // Sem resultado é falha de procura: o servidor fora, ou sem a pasta de atualizações.
  return { ok: Boolean(resultado), nova: Boolean(resultado?.isUpdateAvailable), versao: resultado?.updateInfo?.version || '' };
});
ipcMain.handle('atualizacao:mostrar', evento => {
  if (!remetenteDaSala(evento) || atualizador.ativo || atualizacao?.estado !== 'pronto') return false;
  shell.showItemInFolder(atualizacao.caminho);
  return true;
});
ipcMain.handle('atualizacao:abrir', async evento => {
  if (!remetenteDaSala(evento)) return false;
  if (atualizador.ativo) {
    const pronta = atualizador.estado();
    if (pronta?.estado !== 'pronto') return false;
    const { response } = await dialog.showMessageBox(janela, {
      type: 'question', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Atualizar o Nexo', message: `Instalar o Nexo ${pronta.versao} agora?`,
      detail: 'O Nexo fecha, instala a versão nova e abre de novo. Uma chamada em andamento cai por alguns segundos. "Depois" instala quando você fechar o Nexo.'
    });
    return response === 0 ? atualizador.instalar() : false;
  }
  if (atualizacao?.estado !== 'pronto' || !fs.existsSync(atualizacao.caminho)) return false;
  // O .dmg não é o aplicativo: é o instalador do macOS, que a pessoa arrasta para Aplicativos.
  if (process.platform === 'darwin') { shell.openPath(atualizacao.caminho); return true; }
  const { response } = await dialog.showMessageBox(janela, {
    type: 'question', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1, noLink: true,
    title: 'Atualizar o Nexo', message: `Abrir o Nexo ${atualizacao.versao} agora?`,
    detail: 'Este aplicativo fecha e o novo abre no lugar. Uma chamada em andamento cai por alguns segundos; a conta, o servidor escolhido e os ajustes continuam.'
  });
  if (response !== 0) return false;
  // O novo abre DEPOIS de este fechar: aberto antes, ele esbarraria na trava de instância
  // única e fecharia sozinho, devolvendo o foco a esta janela velha.
  app.relaunch({ execPath: atualizacao.caminho, args: [] });
  app.quit();
  return true;
});

// ---------------------------------------------------------------- opções do aplicativo
// O que o aplicativo instalado faz e o navegador não: atualizar sozinho e abrir ao entrar no
// computador. Ficam nas configurações da sala (public/atualizacao-app.js) e no menu. A página
// só lê e liga, por nome de uma lista fechada -- nunca escreve na configuração direto.
const podeAbrirAoEntrar = () => atualizador.ativo || (app.isPackaged && process.platform === 'darwin');
function opcoesDoAplicativo() {
  return {
    tipo: atualizador.tipo,
    atualizaSozinho: atualizador.ativo,
    atualizarSozinho: atualizador.ativo ? atualizador.sozinho() : false,
    podeAbrirAoEntrar: podeAbrirAoEntrar(),
    abrirAoEntrar: podeAbrirAoEntrar() ? inicializacao.ligado() : false
  };
}
function definirOpcao(nome, valor) {
  if (nome === 'atualizarSozinho' && atualizador.ativo) atualizador.definirSozinho(Boolean(valor));
  else if (nome === 'abrirAoEntrar' && podeAbrirAoEntrar()) inicializacao.definir(Boolean(valor));
  else return false;
  instalarMenu();
  return true;
}
ipcMain.handle('app:opcoes', evento => (remetenteDaSala(evento) ? opcoesDoAplicativo() : null));
ipcMain.handle('app:opcao', (evento, nome, valor) => {
  if (!remetenteDaSala(evento)) return null;
  try { definirOpcao(String(nome), valor === true); } catch (erro) { console.error('Opção do aplicativo:', erro.message); }
  return opcoesDoAplicativo();
});

// ---------------------------------------------------------------- permissões
// Sem isto, o Electron concede a qualquer página tudo o que ela pedir -- câmera, microfone,
// notificações --, sem perguntar a ninguém. A sala precisa dessas permissões; um conteúdo de
// outra origem que entrasse nela, como um iframe injetado, não pode herdá-las.
function instalarPermissoes() {
  const daSala = endereco => Boolean(origemDaSala) && origemHttp(endereco) === origemDaSala;
  session.defaultSession.setPermissionRequestHandler((_conteudo, _permissao, responder, detalhes) => {
    responder(daSala(detalhes?.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_conteudo, _permissao, origem) => daSala(origem));
}

// ---------------------------------------------------------------- menu
// A barra fica escondida (Alt mostra), mas os atalhos valem sempre. Sem isto, um endereço
// que parou de funcionar não teria como ser trocado de dentro do aplicativo.
function instalarMenu() {
  // As opções do aplicativo instalado também moram nas configurações da sala; aqui elas são o
  // caminho de quem está na tela de endereço, sem sala nenhuma aberta.
  const opcoes = opcoesDoAplicativo();
  const doAplicativo = [
    opcoes.atualizaSozinho && {
      label: 'Atualizar sozinho', type: 'checkbox', checked: opcoes.atualizarSozinho,
      click: item => definirOpcao('atualizarSozinho', item.checked)
    },
    opcoes.atualizaSozinho && { label: 'Procurar atualização agora', click: () => atualizador.procurar() },
    opcoes.podeAbrirAoEntrar && {
      label: 'Abrir ao entrar no computador', type: 'checkbox', checked: opcoes.abrirAoEntrar,
      click: item => definirOpcao('abrirAoEntrar', item.checked)
    }
  ].filter(Boolean);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Sala',
      submenu: [
        {
          label: 'Trocar de servidor...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mostrarTelaDeEndereco('', lerConfig().endereco || '')
        },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => janela?.reload() },
        ...(doAplicativo.length ? [{ type: 'separator' }, ...doAplicativo] : []),
        { type: 'separator' },
        {
          label: 'Ferramentas de desenvolvedor',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => janela?.webContents.toggleDevTools()
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    }
  ]));
}

// ---------------------------------------------------------------- ciclo de vida
// Duas janelas do mesmo aplicativo brigariam pelo mesmo agente e pelo mesmo token.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });

  app.whenReady().then(() => {
    instalarMenu();
    instalarSeletorDeTela();
    instalarPermissoes();
    instalarDownloadDaAtualizacao();
    criarJanela();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });

  app.on('window-all-closed', () => { pararAgente(); app.quit(); });
  app.on('before-quit', pararAgente);
}
