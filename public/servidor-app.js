/* "Trocar de servidor", nas configurações da sala, dentro dos aplicativos.
 *
 * O aplicativo de mesa e o Android ficam presos ao servidor que a pessoa escolheu na primeira vez (é
 * uma regra de segurança deles: a sala é conteúdo remoto, e uma página não pode levá-los a outro lugar).
 * Quem queria outro servidor tinha de conhecer o atalho escondido -- Ctrl+Shift+S no computador, segurar
 * o ícone no celular. Aqui o caminho fica à vista, em Configurações → Aplicativo, e a escolha continua
 * sendo da pessoa: o botão pede o aplicativo, e só ele troca de tela.
 *
 * No navegador este bloco não aparece: o servidor é o próprio site em que se está.
 *
 *   - Aplicativo de mesa: `appNativo.trocarServidor()` leva à tela de endereço, que já vem com o endereço
 *     de agora (e o servidor padrão do Nexo à mão).
 *   - Android: `NexoAndroid.trocarServidor()`, do APK 1.2.0 em diante. Num APK mais velho o botão não
 *     existe, e a dica manda segurar o ícone do Nexo, o atalho que sempre funcionou.
 *
 * Trocar encerra a chamada de agora (a tela de endereço sai da sala), então o botão pede uma segunda
 * confirmação no próprio lugar: `window.confirm` não serve, porque a WebView do Android não o mostra.
 */
(() => {
  const $ = id => document.getElementById(id);
  const nativo = window.appNativo || null;
  const android = !nativo && window.NexoAndroid?.versao ? window.NexoAndroid : null;
  const aba = $('abaAplicativo');
  const bloco = $('appServidor');
  if ((!nativo && !android) || !aba || !bloco) return;

  const trocar = nativo?.trocarServidor ? () => nativo.trocarServidor() : android?.trocarServidor || null;

  // O Android não tem as opções do aplicativo de mesa (atualizar sozinho, abrir ao entrar no computador): a
  // seção é só o servidor. Um aplicativo de mesa muito antigo, sem `opcoesDoAplicativo`, fica igual.
  if (android || !nativo?.opcoesDoAplicativo) {
    aba.hidden = false;
    document.querySelectorAll('#painelAplicativo [data-so-mesa]').forEach(el => { el.hidden = true; });
  }
  if (android) {
    $('appTitulo').textContent = 'Aplicativo';
    $('appSubtitulo').textContent = 'O servidor a que este aplicativo está ligado.';
    aba.lastChild.textContent = 'Aplicativo';
  }

  bloco.hidden = false;
  const padrao = nativo?.servidorPadrao || '';
  const endereco = location.origin;
  $('appServidorEndereco').textContent = padrao && endereco === padrao ? `${location.host} · o servidor padrão do Nexo` : location.host;
  $('appServidorEndereco').title = endereco;

  const botao = $('appServidorTrocar');
  const dica = $('appServidorDica');
  const DICA = 'Você volta à tela de endereço e sai desta chamada. O endereço de agora fica guardado até você conectar a outro: se o novo não abrir, é só voltar a este.';
  if (!trocar) {
    // Um APK sem o pedido: o botão não teria o que chamar.
    botao.hidden = true;
    dica.hidden = false;
    dica.textContent = 'Para trocar de servidor, segure o ícone do Nexo na tela inicial do celular e toque em “Trocar de servidor”. Atualizando o aplicativo, o botão passa a estar aqui.';
    return;
  }
  dica.hidden = false;
  dica.textContent = DICA;

  let pedindo = false;
  let prazo = 0;
  function desistir() {
    pedindo = false;
    clearTimeout(prazo);
    botao.textContent = 'Trocar de servidor';
    botao.classList.remove('danger');
    botao.classList.add('secondary');
    dica.textContent = DICA;
  }
  botao.addEventListener('click', async () => {
    if (!pedindo) {
      pedindo = true;
      botao.textContent = 'Sair da sala e trocar';
      botao.classList.remove('secondary');
      botao.classList.add('danger');
      dica.textContent = 'Isto encerra a chamada de agora. Toque de novo para trocar, ou espere um instante para desistir.';
      // Quem não confirma não fica com um botão vermelho esperando para sempre.
      prazo = setTimeout(desistir, 6000);
      return;
    }
    clearTimeout(prazo);
    botao.disabled = true;
    try { await trocar(); } catch (_) { /* a página some quando a troca dá certo */ }
    // Se a página ainda está aqui, a troca não aconteceu: o aplicativo recusou, ou é um APK mais velho.
    setTimeout(() => { botao.disabled = false; desistir(); }, 1500);
  });
  // Mudar de seção das configurações é desistir.
  document.querySelectorAll('#settingsTabs [role="tab"], .abas [role="tab"]').forEach(outra => { if (outra !== aba) outra.addEventListener('click', desistir); });
})();
