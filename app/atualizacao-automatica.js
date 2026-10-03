'use strict';

// A atualização sozinha do aplicativo INSTALADO: o instalador do Windows, o AppImage e o .deb.
//
// O portátil continua no caminho dele (main.js, "atualização"): baixar o .exe novo e abri-lo no
// lugar do velho. Um portátil não tem onde se instalar de novo -- ele É o arquivo --, e o
// electron-updater não sabe trocá-lo.
//
// Quem procura é o electron-updater, e onde ele procura é o servidor que a PESSOA escolheu: a
// origem da sala, em /downloads/atualizacoes (desktop-download.js). Não existe um servidor
// central de atualizações -- cada Nexo hospedado distribui a versão que empacotou, do mesmo jeito
// que já distribui o download da página. Por isso o endereço gravado no build (app-update.yml) é
// só um lugar-reservado, trocado aqui antes de cada procura.
//
// Por padrão a versão nova desce em silêncio -- nada aparece no meio da chamada -- e se instala
// quando o Nexo fecha. Pronta, a sala oferece "Reiniciar" num canto, uma vez. Quem prefere
// decidir desliga "Atualizar sozinho" no menu: aí a sala avisa que há versão nova, e o download
// só começa no clique, com o progresso à vista.
//
// O estado sai pelo mesmo canal do download do portátil ('atualizacao:progresso'), com os mesmos
// nomes -- a página desenha um e outro com o mesmo código (public/atualizacao-app.js).

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// A primeira procura espera a sala abrir e assentar: o que importa nos primeiros segundos é
// entrar na chamada. Depois, de tempos em tempos -- há quem deixe o Nexo aberto por dias.
const MS_ATE_A_PRIMEIRA_PROCURA = 15 * 1000;
const MS_ENTRE_PROCURAS = 4 * 60 * 60 * 1000;
// Dez avisos por segundo bastam à barra; um por pedaço seriam centenas atravessando a ponte.
const MS_ENTRE_AVISOS_DE_PROGRESSO = 100;

// Que Nexo é este. Só 'instalador', 'appimage' e 'deb' se atualizam sozinhos.
function tipoDeInstalacao() {
  if (!app.isPackaged) return 'desenvolvimento';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR ? 'portatil' : 'instalador';
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return 'appimage';
    // O .deb deixa este arquivo nos recursos (o electron-builder grava, o electron-updater lê).
    try {
      if (fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() === 'deb') return 'deb';
    } catch (_) { /* não é .deb */ }
  }
  // macOS sem assinatura: o atualizador do Mac recusa trocar um aplicativo não assinado.
  return 'outro';
}

const ATUALIZAVEIS = new Set(['instalador', 'appimage', 'deb']);

// `tipo` só vem de fora no teste (tests/electron.cjs), que roda o aplicativo sem empacotar e
// precisa dele "instalado" para provar a atualização de ponta a ponta.
function criarAtualizador({ lerConfig, salvarConfig, avisar, tipo = tipoDeInstalacao() }) {
  const ativo = ATUALIZAVEIS.has(tipo);
  let atualizador = null;
  let origem = null;
  let estado = null;      // { estado, versao, recebidos, total, silenciosa }
  let cancelamento = null;
  let ultimoAviso = 0;
  let relogio = null;

  const sozinho = () => lerConfig().atualizarSozinho !== false;

  function mudar(parcial) {
    estado = { recebidos: 0, total: 0, silenciosa: false, ...estado, ...parcial };
    avisar({ ...estado });
  }

  // Carregado só quando serve: o portátil e o modo de desenvolvimento nunca tocam nele.
  function carregar() {
    if (atualizador) return atualizador;
    const { autoUpdater } = require('electron-updater');
    atualizador = autoUpdater;
    // O registro padrão escreve cada passo no console; aqui só o que é problema.
    atualizador.logger = { info() {}, debug() {}, warn: (...a) => console.warn('[atualização]', ...a), error: (...a) => console.error('[atualização]', ...a) };
    atualizador.autoInstallOnAppQuit = true;
    atualizador.allowDowngrade = false;
    atualizador.allowPrerelease = false;
    // O instalador é um só, completo (nsis), e não o "web installer" que baixa o resto depois.
    atualizador.disableWebInstaller = true;

    atualizador.on('update-available', info => {
      // Um pedido da pessoa já em curso continua sendo o pedido dela, com o progresso à vista.
      if (estado && ['pedido', 'baixando'].includes(estado.estado)) { mudar({ versao: info.version }); return; }
      mudar(atualizador.autoDownload
        ? { estado: 'baixando', versao: info.version, recebidos: 0, total: 0, silenciosa: true }
        : { estado: 'disponivel', versao: info.version, recebidos: 0, total: 0, silenciosa: false });
    });
    atualizador.on('download-progress', progresso => {
      if (!estado) return;
      estado = { ...estado, estado: 'baixando', recebidos: progresso.transferred || 0, total: progresso.total || 0 };
      if (Date.now() - ultimoAviso < MS_ENTRE_AVISOS_DE_PROGRESSO) return;
      ultimoAviso = Date.now();
      avisar({ ...estado });
    });
    atualizador.on('update-downloaded', info => {
      cancelamento = null;
      mudar({ estado: 'pronto', versao: info.version, recebidos: estado?.total || 0 });
    });
    atualizador.on('error', erro => {
      // Falhar ao PROCURAR (o servidor sem a pasta de atualizações, a rede fora) não é notícia:
      // tenta de novo na próxima volta. Falhar no meio de um download é, se a pessoa pediu.
      if (estado && ['pedido', 'baixando'].includes(estado.estado)) {
        cancelamento = null;
        mudar({ estado: 'falhou' });
      }
      console.warn('[atualização]', erro?.message || erro);
    });
    return atualizador;
  }

  async function procurar() {
    if (!ativo || !origem) return null;
    // Já baixado: nada a procurar até instalar. Baixando: não começa outra.
    if (estado && ['pedido', 'baixando', 'pronto'].includes(estado.estado)) return null;
    const atualizacao = carregar();
    atualizacao.autoDownload = sozinho();
    atualizacao.setFeedURL({ provider: 'generic', url: `${origem}/downloads/atualizacoes`, channel: 'latest' });
    try {
      const resultado = await atualizacao.checkForUpdates();
      if (resultado?.downloadPromise) {
        cancelamento = resultado.cancellationToken || null;
        // A falha do download descido sozinho chega pelo 'error'; a promessa não pode ficar
        // rejeitada sem dono no processo principal.
        resultado.downloadPromise.catch(() => {});
      }
      return resultado;
    } catch (_) {
      return null;   // já registrado pelo 'error'
    }
  }

  function agendar() {
    clearTimeout(relogio);
    clearInterval(relogio);
    relogio = setTimeout(async () => {
      await procurar();
      relogio = setInterval(procurar, MS_ENTRE_PROCURAS);
      relogio.unref?.();
    }, MS_ATE_A_PRIMEIRA_PROCURA);
    relogio.unref?.();
  }

  // A sala abriu nesta origem. Trocar de servidor troca de onde vêm as atualizações.
  function definirOrigem(nova) {
    if (!ativo || !nova || nova === origem) return;
    origem = nova;
    agendar();
  }

  function definirSozinho(ligado) {
    salvarConfig({ ...lerConfig(), atualizarSozinho: Boolean(ligado) });
    if (atualizador) atualizador.autoDownload = Boolean(ligado);
    // Ligar de novo com uma versão já oferecida começa a descer agora, e não daqui a horas.
    if (ligado && estado?.estado === 'disponivel') baixar({ silenciosa: true });
  }

  // O clique em "Atualizar agora", ou o religar do "Atualizar sozinho".
  async function baixar({ silenciosa = false } = {}) {
    if (!ativo || !origem) return { ok: false, motivo: 'indisponivel' };
    if (estado?.estado === 'pronto') { avisar({ ...estado }); return { ok: true, jaEstava: true }; }
    if (estado && ['pedido', 'baixando'].includes(estado.estado)) {
      // Descendo em silêncio e a pessoa pediu: passa a mostrar o progresso.
      if (estado.silenciosa && !silenciosa) mudar({ silenciosa: false });
      return { ok: true, jaEstava: true };
    }
    mudar({ estado: 'pedido', recebidos: 0, total: 0, silenciosa });
    const atualizacao = carregar();
    atualizacao.autoDownload = false;
    atualizacao.setFeedURL({ provider: 'generic', url: `${origem}/downloads/atualizacoes`, channel: 'latest' });
    try {
      const resultado = await atualizacao.checkForUpdates();
      if (!resultado?.isUpdateAvailable) {
        // O servidor não tem nada mais novo do que este: não há o que baixar.
        estado = null;
        avisar({ estado: 'cancelado', versao: '', recebidos: 0, total: 0, silenciosa });
        return { ok: false, motivo: 'sem-versao-nova' };
      }
      const { CancellationToken } = require('electron-updater');
      cancelamento = new CancellationToken();
      atualizacao.downloadUpdate(cancelamento).catch(erro => {
        if (erro?.name === 'CancellationError' || /cancel/i.test(String(erro?.message))) mudar({ estado: 'cancelado' });
      });
      return { ok: true };
    } catch (_) {
      mudar({ estado: 'falhou' });
      return { ok: false, motivo: 'falhou' };
    } finally {
      atualizacao.autoDownload = sozinho();
    }
  }

  function cancelar() {
    if (!cancelamento || !estado || !['pedido', 'baixando'].includes(estado.estado)) return false;
    cancelamento.cancel();
    cancelamento = null;
    mudar({ estado: 'cancelado' });
    return true;
  }

  // Fecha e instala. No Windows o instalador roda calado e abre o Nexo de novo no fim; no Linux
  // o AppImage é trocado no lugar, e o .deb pede a senha (pkexec) para trocar o pacote.
  function instalar() {
    if (!atualizador || estado?.estado !== 'pronto') return false;
    atualizador.quitAndInstall(true, true);
    return true;
  }

  return {
    tipo, ativo, definirOrigem, sozinho, definirSozinho, procurar, baixar, cancelar, instalar,
    estado: () => (estado ? { ...estado } : null)
  };
}

module.exports = { criarAtualizador, tipoDeInstalacao };
