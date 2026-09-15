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

const { app, BrowserWindow, Menu, session, desktopCapturer, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
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

let janela = null;
let agente = null;
// Endereço que está sendo tentado agora. Só vira configuração se a página carregar.
let enderecoPendente = null;

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
  janela.loadURL(url);
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
      additionalArguments: [`--pid-do-app=${process.pid}`]
    }
  });

  // Um endereço só é guardado depois de carregar de verdade. Guardar antes prendia a pessoa
  // numa página quebrada -- e, sem tela de endereço, sem forma de corrigir: foi o que
  // aconteceu quando o servidor estava fora do ar no momento em que o endereço foi digitado.
  janela.webContents.on('did-finish-load', () => {
    if (!enderecoPendente) return;
    salvarConfig({ endereco: enderecoPendente });
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

  const config = lerConfig();
  if (config.endereco) irParaEndereco(config.endereco);
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
        // Página local, nossa, sem nada remoto: aqui o Node é seguro e evita mais um preload.
        nodeIntegration: true,
        contextIsolation: false
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
  return janela && evento.sender === janela.webContents && evento.senderFrame === janela.webContents.mainFrame
    && /^https?:/.test(evento.senderFrame.url);
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
      // Sem áudio de propósito. O Electron sabe capturar o som do sistema aqui
      // ('audio: loopback'), mas seria TODO o som, sem forma de tirar este aplicativo de
      // dentro -- ou seja, exatamente o eco que o aplicativo existe para evitar. Quem
      // captura som continua sendo o agente, que sabe excluir uma árvore de processos.
      responder(escolhida ? { video: escolhida } : undefined);
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
  disponivel: Boolean(caminhoDoAgente())
}));

ipcMain.handle('endereco:definir', (evento, endereco) => {
  let alvo;
  try { alvo = new URL(String(endereco)); } catch (_) { return { ok: false }; }
  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return { ok: false };
  irParaEndereco(alvo.toString());
  return { ok: true };
});

// Serve para voltar à tela de endereço sem precisar apagar arquivo nenhum.
ipcMain.handle('endereco:esquecer', () => {
  mostrarTelaDeEndereco('', lerConfig().endereco || '');
  return { ok: true };
});

// ---------------------------------------------------------------- menu
// A barra fica escondida (Alt mostra), mas os atalhos valem sempre. Sem isto, um endereço
// que parou de funcionar não teria como ser trocado de dentro do aplicativo.
function instalarMenu() {
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
    criarJanela();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });

  app.on('window-all-closed', () => { pararAgente(); app.quit(); });
  app.on('before-quit', pararAgente);
}
