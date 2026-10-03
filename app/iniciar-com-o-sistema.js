'use strict';

// "Abrir o Nexo ao entrar no computador". Desligado por padrão, e só no aplicativo instalado: um
// portátil pode estar em Downloads ou num pendrive e mudar de lugar amanhã, e registrar o caminho
// dele na inicialização seria deixar um atalho quebrado para trás.
//
// Aberto assim, o Nexo começa minimizado (`--em-segundo-plano`): quem liga o computador para
// trabalhar não quer uma sala na cara antes de qualquer outra coisa.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const ARGUMENTO = '--em-segundo-plano';

// O Electron não registra a inicialização no Linux: lá ela é um arquivo .desktop na pasta de
// início automático, que todo ambiente de mesa (GNOME, KDE, XFCE…) lê.
const arquivoNoLinux = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'nexo.desktop');

// O AppImage roda de dentro de uma montagem temporária, que muda a cada abertura: o caminho que
// vale é o do próprio arquivo, que ele publica em APPIMAGE.
const executavelNoLinux = () => process.env.APPIMAGE || process.execPath;

function ligado() {
  if (process.platform === 'linux') return fs.existsSync(arquivoNoLinux());
  return Boolean(app.getLoginItemSettings({ args: [ARGUMENTO] }).openAtLogin);
}

function definir(ligar) {
  if (process.platform === 'linux') {
    const arquivo = arquivoNoLinux();
    if (!ligar) { fs.rmSync(arquivo, { force: true }); return; }
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    // Entre aspas, com as aspas de dentro escapadas: um caminho com espaço viraria dois argumentos.
    const exec = `"${executavelNoLinux().replace(/(["\\`$])/g, '\\$1')}" ${ARGUMENTO}`;
    fs.writeFileSync(arquivo, ['[Desktop Entry]', 'Type=Application', 'Name=Nexo', `Exec=${exec}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n'));
    return;
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(ligar), args: [ARGUMENTO] });
}

const abertoPeloSistema = () => process.argv.includes(ARGUMENTO);

module.exports = { ligado, definir, abertoPeloSistema };
