// O início de quem tem conta, no computador e no toque. A busca é um campo de verdade, com as
// sugestões caindo embaixo dele; e o balão de "Entrar numa sala pelo código" aguenta o teclado do
// celular. O teclado que sobe muda o tamanho da janela, e o `resize` fechava o balão -- com o
// campo e o teclado junto, antes de dar para digitar. Encolher a janela à mão é o mesmo evento.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3223;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'inicio');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

async function novaPagina(contexto) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error('erro na página:', e.message); });
  await pagina.goto(origem);
  await pagina.locator('#inicioApp').waitFor();
  await pagina.waitForFunction(() => NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });
  return pagina;
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anabusca', { apelido: 'Ana' });
  const bia = await instancia.conta('biabusca', { apelido: 'Bia Souza' });
  // Amigas como pela tela: uma pede, e o pedido de volta vira amizade.
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biabusca', 201], [bia, '@anabusca', 200]]) {
    const r = await pedir(de, alvo);
    assert.equal(r.status, esperado, await r.text());
  }

  navegador = await chromium.launch({ headless: true });
  const comConta = async opcoes => {
    const contexto = await navegador.newContext(opcoes);
    await contexto.addCookies([{ name: 'nexo_conta', value: ana.cookie.split('=')[1], url: origem }]);
    return contexto;
  };

  // ---------- No computador ----------
  const pc = await novaPagina(await comConta({ viewport: { width: 1280, height: 820 } }));
  const busca = pc.locator('#buscaCampo');
  const sugestoes = pc.locator('#buscaLista [role="option"]');
  assert.equal(await pc.locator('.ini-busca kbd').count(), 0, 'o "Ctrl K" saiu do campo');
  await busca.click();
  await pc.locator('#buscaLista:not([hidden])').waitFor();
  assert.deepEqual(await sugestoes.allTextContents(), ['Bia Souza'], 'o campo vazio já sugere os amigos');
  assert.equal(await busca.getAttribute('aria-activedescendant'), null, 'vazio, o Enter não escolhe ninguém');
  await busca.pressSequentially('bia');
  assert.equal(await busca.getAttribute('aria-activedescendant'), await sugestoes.first().getAttribute('id'), 'com algo digitado, o Enter leva à primeira');
  await busca.press('Enter');
  await pc.locator('#vistaConversa:not([hidden])').waitFor();
  assert.equal(await busca.inputValue(), '');
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);

  // Um código que não é amigo nem sala recente também leva à sala, e diz isso na lista.
  await busca.fill('#Sala Nova');
  assert.deepEqual(await sugestoes.allTextContents(), ['Entrar na sala #sala-nova']);
  await busca.press('Escape');
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);
  assert.equal(await busca.inputValue(), '#Sala Nova', 'o primeiro Esc só fecha a lista');
  await busca.press('ArrowDown');
  assert.equal(await pc.locator('#buscaLista').isVisible(), true, 'a seta reabre a lista');
  await busca.press('Escape');
  await busca.press('Escape');
  assert.equal(await busca.inputValue(), '', 'o segundo Esc apaga o que foi digitado');
  // Clicar fora fecha.
  await busca.click();
  await pc.locator('#buscaLista:not([hidden])').waitFor();
  await pc.locator('#iniCentro').click({ position: { x: 400, y: 400 } });
  assert.equal(await pc.locator('#buscaLista').isHidden(), true);
  // O Ctrl K continua levando à busca, só não aparece escrito.
  await pc.evaluate(() => document.activeElement?.blur());
  await pc.keyboard.press('Control+K');
  assert.equal(await pc.evaluate(() => document.activeElement?.id), 'buscaCampo');
  assert.equal(await pc.locator('#buscaLista').isVisible(), true);
  await pc.close();

  // ---------- No celular: a busca e o "Entrar numa sala" moram na gaveta ----------
  const tel = await novaPagina(await comConta({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  }));
  const teclado = altura => tel.setViewportSize({ width: 390, height: altura });
  await tel.locator('#menuBtn').tap();
  await tel.locator('#buscaCampo').tap();
  await tel.locator('#buscaLista:not([hidden])').waitFor();
  assert.equal(await tel.locator('#buscaCampo').evaluate(el => getComputedStyle(el).fontSize), '16px', 'com menos, o iOS aproxima a página ao focar');
  await teclado(430);
  await tel.locator('#buscaCampo').pressSequentially('bia');
  assert.equal(await tel.evaluate(() => document.activeElement?.id), 'buscaCampo', 'o teclado que sobe não tira o foco da busca');
  assert.deepEqual(await tel.locator('#buscaLista [role="option"]').allTextContents(), ['Bia Souza']);
  await tel.waitForTimeout(250); // a lista entra com `nexo-surgir`: no meio dela, sai meio transparente
  await tel.screenshot({ path: path.join(saida, 'busca-celular.png') });
  await teclado(780);

  await tel.locator('#trilhoEntrar').tap();
  assert.equal(await tel.locator('#buscaLista').isHidden(), true, 'tocar fora fecha a lista da busca');
  const campo = tel.locator('#menuFlutuante:not([hidden]) input');
  await campo.waitFor();
  assert.equal(await campo.evaluate(el => document.activeElement === el && getComputedStyle(el).fontSize), '16px');
  await teclado(430);
  await tel.waitForTimeout(100);
  assert.equal(await tel.locator('#menuFlutuante').isVisible(), true, 'o teclado que sobe não fecha o balão');
  await tel.keyboard.type('Squad da Noite');
  assert.equal(await campo.inputValue(), 'Squad da Noite');
  const menu = await tel.locator('#menuFlutuante').boundingBox();
  assert.ok(menu.y >= 0 && menu.y + menu.height <= 430, 'e ele continua dentro da janela que sobrou');
  // O campo de 16 px alargava a coluna do balão, e o "Entrar" ficava cortado para fora dele.
  const cabeInteiro = async largura => {
    const caixa = await tel.locator('#menuFlutuante').boundingBox();
    const entrar = await tel.locator('#menuFlutuante button[type="submit"]').boundingBox();
    const rola = await tel.locator('#menuFlutuante').evaluate(el => el.scrollWidth - el.clientWidth);
    assert.ok(entrar.x >= caixa.x && entrar.x + entrar.width <= caixa.x + caixa.width - 4, `o "Entrar" cabe inteiro no balão em ${largura} px: ${JSON.stringify({ caixa, entrar })}`);
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura, `o balão cabe na tela de ${largura} px: ${JSON.stringify(caixa)}`);
    assert.equal(rola, 0, 'nada no balão passa da largura dele');
  };
  await cabeInteiro(390);
  await tel.screenshot({ path: path.join(saida, 'entrar-pelo-codigo-celular.png') });
  await tel.setViewportSize({ width: 320, height: 430 });
  await tel.waitForTimeout(100);
  await cabeInteiro(320);
  await tel.setViewportSize({ width: 390, height: 430 });
  await tel.locator('#menuFlutuante button[type="submit"]').tap();
  await tel.waitForURL('**/squad-da-noite/sala');

  assert.deepEqual(erros, []);
  console.log('PASS: a busca do início é um campo com sugestões embaixo (setas, Enter, Esc, Ctrl K), e no celular nem ela nem o balão de "Entrar numa sala" fecham com o teclado');

  // ---------- A versão nova do aplicativo de mesa, fora da sala ----------
  //
  // A ponte do Electron simulada (como em fila-e-perfil-browser.cjs): o aplicativo 1.0.0 e o
  // servidor com a 1.1.0. No início, o mesmo botão "Atualizar" da sala, com o cartão e o
  // progresso; na apresentação (quem abre o aplicativo sem conta), o aviso no canto.
  const pontePortatil = () => {
    const nada = async () => ({});
    const ouvintes = [];
    const avisar = dados => ouvintes.forEach(ouvir => ouvir(dados));
    window.chamadasDaPonte = [];
    window.appNativo = { pid: 0, versao: '1.0.0', plataforma: 'win32', estadoDoAgente: nada, iniciarAgente: async () => ({ rodando: false }),
      prepararCaptura: async () => false, capturaSelecionada: async () => null, encerreiCaptura: nada, aoEncerrarCaptura: () => {}, definirEndereco: nada, trocarServidor: nada,
      aoProgressoDaAtualizacao: ouvir => ouvintes.push(ouvir),
      estadoDaAtualizacao: async () => null,
      cancelarAtualizacao: async () => true,
      mostrarAtualizacao: async () => { chamadasDaPonte.push('mostrar'); return true; },
      abrirAtualizacao: async () => { chamadasDaPonte.push('abrir'); return true; },
      baixarAtualizacao: async versao => {
        chamadasDaPonte.push(`baixar ${versao}`);
        setTimeout(() => avisar({ estado: 'baixando', versao, recebidos: 42 * 1048576, total: 100 * 1048576, arquivo: '' }), 100);
        setTimeout(() => avisar({ estado: 'pronto', versao, recebidos: 100 * 1048576, total: 100 * 1048576, arquivo: 'Nexo 1.1.0.exe' }), 1200);
        return { ok: true };
      } };
  };
  const servidorComVersaoNova = rota => rota.fulfill({ json: { available: true, sistemas: [
    { chave: 'windows', nome: 'Windows x64', tipo: '.exe portátil', url: '/downloads/SalaCompartilhada.exe', size: 1, builtAt: new Date().toISOString(), versao: '1.1.0' }
  ] } });
  const contextoDoApp = await comConta({ viewport: { width: 1280, height: 820 } });
  await contextoDoApp.addInitScript(pontePortatil);
  await contextoDoApp.route('**/api/desktop-app', servidorComVersaoNova);
  const app = await novaPagina(contextoDoApp);
  await app.locator('#atualizarAppBtn').waitFor({ timeout: 5000 });
  assert.equal(await app.locator('#atualizarAppMenu').isVisible(), false, 'o cartão não abre sozinho');
  await app.locator('#atualizarAppBtn').click();
  assert.equal(await app.locator('#atualizarAppTitulo').textContent(), 'Nexo 1.1.0 disponível');
  assert.match(await app.locator('#atualizarAppTexto').textContent(), /Você está com a 1\.0\.0/);
  const cartaoDoApp = await app.locator('#atualizarAppMenu').boundingBox();
  const botaoDoApp = await app.locator('#atualizarAppBtn').boundingBox();
  assert.ok(cartaoDoApp.y >= botaoDoApp.y + botaoDoApp.height && cartaoDoApp.x + cartaoDoApp.width <= 1280, `o cartão abre embaixo do botão, dentro da janela: ${JSON.stringify({ cartaoDoApp, botaoDoApp })}`);
  // As abas não ficam apertadas por causa dele: a 1280 px o botão é só o ícone.
  assert.equal(await app.locator('#abasAmigos').evaluate(el => el.scrollWidth - el.clientWidth), 0, 'as abas dos amigos cabem inteiras com o "Atualizar" à vista');
  await app.waitForTimeout(300); // o cartão entra com `nexo-surgir`
  await app.screenshot({ path: path.join(saida, 'atualizacao-inicio.png') });
  await app.locator('#atualizarAppBaixar').click();
  await app.locator('.nexo-toast', { hasText: 'Baixando o Nexo 1.1.0 · 42%' }).waitFor({ timeout: 5000 });
  assert.equal(await app.locator('#atualizarAppBtn span').textContent(), 'Baixando 42%', 'o botão do início acompanha');
  await app.locator('.nexo-toast', { hasText: 'Nexo 1.1.0 pronto' }).waitFor({ timeout: 5000 });
  await app.locator('.nexo-toast').getByRole('button', { name: 'Reiniciar agora' }).click();
  assert.deepEqual(await app.evaluate(() => chamadasDaPonte), ['baixar 1.1.0', 'abrir']);
  assert.equal(await app.locator('#atualizarAppBtn span').textContent(), 'Reiniciar');
  await app.close();
  console.log('PASS: no início, o aplicativo de mesa mostra o mesmo "Atualizar" da sala, baixa com progresso e oferece reiniciar');

  // ---------- O aplicativo INSTALADO (o AppImage do Linux) ----------
  // A ponte só existe na página de cima, como no Electron (o preload é do quadro principal). Antes: o botão de atualizar
  // só aparecia com a versão já baixada (nada enquanto ela descia em silêncio, nada se a descida falhava), e a seção
  // "Aplicativo de mesa" sumia das configurações fora da sala, que moram num quadro.
  const ponteInstalada = () => {
    if (window !== window.top) return;
    const ouvintes = [];
    window.avisarDaPonte = dados => ouvintes.forEach(ouvir => ouvir(dados));
    window.chamadasDaPonte = [];
    const opcoes = { tipo: 'appimage', atualizaSozinho: true, atualizarSozinho: true, podeAbrirAoEntrar: true, abrirAoEntrar: false };
    window.appNativo = { pid: 0, versao: '1.0.0', plataforma: 'linux', instalacao: 'appimage', estadoDoAgente: async () => ({}), iniciarAgente: async () => ({ rodando: false }),
      prepararCaptura: async () => false, capturaSelecionada: async () => null, encerreiCaptura: async () => ({}), aoEncerrarCaptura: () => {}, definirEndereco: async () => ({}), trocarServidor: async () => ({}),
      opcoesDoAplicativo: async () => ({ ...opcoes }), definirOpcaoDoAplicativo: async (nome, valor) => { opcoes[nome] = valor; return { ...opcoes }; },
      procurarAtualizacao: async () => ({ ok: true, nova: true, versao: '1.1.0' }),
      aoProgressoDaAtualizacao: ouvir => ouvintes.push(ouvir), estadoDaAtualizacao: async () => null,
      cancelarAtualizacao: async () => true, mostrarAtualizacao: async () => true, abrirAtualizacao: async () => true,
      baixarAtualizacao: async versao => { chamadasDaPonte.push(`baixar ${versao}`); return { ok: true }; } };
  };
  const contextoInstalado = await comConta({ viewport: { width: 1280, height: 820 } });
  await contextoInstalado.addInitScript(ponteInstalada);
  await contextoInstalado.route('**/api/desktop-app', rota => rota.fulfill({ json: { available: true, sistemas: [
    { chave: 'linux', nome: 'Linux', tipo: 'AppImage', url: '/downloads/Nexo.AppImage', size: 1, builtAt: new Date().toISOString(), versao: '1.1.0' }
  ] } }));
  const instalado = await novaPagina(contextoInstalado);
  // Com nada em curso no processo principal, a página compara com o servidor e oferece o botão.
  await instalado.locator('#atualizarAppBtn').waitFor({ timeout: 5000 });
  // Descendo em silêncio: o botão diz que está a caminho, e nenhum aviso aparece no canto.
  await instalado.evaluate(() => avisarDaPonte({ estado: 'baixando', versao: '1.1.0', recebidos: 10, total: 100, silenciosa: true }));
  assert.equal(await instalado.locator('#atualizarAppBtn span').textContent(), 'Atualizando…');
  assert.equal(await instalado.locator('.nexo-toast').count(), 0, 'a descida silenciosa não abre aviso');
  // A descida silenciosa falhou: o botão volta a "Atualizar", e clicar pede o download com o progresso à vista.
  await instalado.evaluate(() => avisarDaPonte({ estado: 'falhou', versao: '1.1.0', silenciosa: true }));
  assert.equal(await instalado.locator('#atualizarAppBtn span').textContent(), 'Atualizar');
  assert.equal(await instalado.locator('#atualizarAppBtn').isVisible(), true);
  // A instalação que não terminou (no .deb, a senha recusada) chega com o motivo.
  await instalado.evaluate(() => avisarDaPonte({ estado: 'falhou', versao: '1.1.0', motivo: 'A instalação não terminou: a senha do sistema foi cancelada ou recusada. Tente de novo.' }));
  await instalado.locator('.nexo-toast', { hasText: 'a senha do sistema foi cancelada' }).waitFor({ timeout: 5000 });
  await instalado.locator('.nexo-toast .nexo-toast-fechar, .nexo-toast [aria-label="Fechar"]').first().click().catch(() => {});
  // A seção "Aplicativo de mesa" nas configurações fora da sala (o quadro), com a versão e as opções.
  await instalado.locator('.ini-eu-conta').click();
  const quadroDoApp = () => instalado.frames().find(f => /^https?:\/\/[^/]+\/configuracoes$/.test(f.url()));
  await instalado.waitForFunction(() => document.querySelector('.ini-configuracoes') && !document.querySelector('.ini-configuracoes').hidden);
  const cfgApp = quadroDoApp();
  await cfgApp.locator('#devicesPanel:not(.hidden)').waitFor();
  assert.equal(await cfgApp.locator('#abaAplicativo').isVisible(), true, 'a aba "Aplicativo de mesa" aparece fora da sala');
  await cfgApp.locator('#abaAplicativo').click();
  await cfgApp.locator('#appLinhaAtualizar:not([hidden])').waitFor();
  assert.equal(await cfgApp.locator('#appVersao').textContent(), 'Nexo 1.0.0');
  assert.equal(await cfgApp.locator('#appAtualizarSozinho').isChecked(), true);
  assert.equal(await cfgApp.locator('.nexo-toast').count(), 0, 'o quadro não repete os avisos do início');
  assert.deepEqual(erros, []);
  await instalado.close();
  console.log('PASS: o aplicativo instalado mostra "Atualizar" sempre que há versão nova (descendo, falhada ou com o motivo), e a seção "Aplicativo de mesa" aparece fora da sala');

  // Sem conta, o aplicativo abre a apresentação: o aviso vem no canto, e "Depois" vale.
  const contextoSemConta = await navegador.newContext({ viewport: { width: 1280, height: 820 } });
  await contextoSemConta.addInitScript(pontePortatil);
  await contextoSemConta.route('**/api/desktop-app', servidorComVersaoNova);
  const vitrine = await contextoSemConta.newPage();
  vitrine.on('pageerror', e => { erros.push(e.message); console.error('erro na apresentação:', e.message); });
  await vitrine.goto(origem);
  const avisoDaVitrine = vitrine.locator('.nexo-toast', { hasText: 'Nexo 1.1.0 disponível' });
  await avisoDaVitrine.waitFor({ timeout: 5000 });
  assert.match(await avisoDaVitrine.textContent(), /Você está com a 1\.0\.0/);
  await vitrine.screenshot({ path: path.join(saida, 'atualizacao-apresentacao.png') });
  await avisoDaVitrine.getByRole('button', { name: 'Depois' }).click();
  await vitrine.reload();
  await vitrine.waitForTimeout(2500);
  assert.equal(await vitrine.locator('.nexo-toast', { hasText: 'disponível' }).count(), 0, '"Depois" vale também fora da sala');
  // No navegador comum, nada: ele já é sempre a versão do servidor.
  const navegadorComum = await (await navegador.newContext()).newPage();
  await navegadorComum.route('**/api/desktop-app', servidorComVersaoNova);
  await navegadorComum.goto(origem);
  await navegadorComum.waitForTimeout(2500);
  assert.equal(await navegadorComum.locator('.nexo-toast', { hasText: 'disponível' }).count(), 0);
  assert.deepEqual(erros, []);
  console.log('PASS: na apresentação, o aplicativo sem conta vê a versão nova no canto, "Depois" vale, e o navegador não vê nada');

  // O cartão "Abrir uma sala" estourava a coluna "Agora no Nexo" quando a fonte do sistema é mais larga que a do
  // Windows (o Linux Mint de quem relatou): o campo tem largura natural pelo `size`, o botão saía do cartão e a
  // coluna ganhava barra para o lado. Uma monoespaçada grande faz o mesmo papel da fonte larga.
  const larga = await (await comConta({ viewport: { width: 1360, height: 820 } })).newPage();
  larga.on('pageerror', e => { erros.push(e.message); console.error('erro na fonte larga:', e.message); });
  await larga.goto(origem);
  await larga.locator('#inicioApp').waitFor();
  await larga.addStyleTag({ content: '.ini { font-family: "Courier New", monospace !important; } .ini input, .ini button { font-family: "Courier New", monospace !important; font-size: 15px !important; }' });
  const medidas = await larga.evaluate(() => {
    const agora = document.querySelector('.ini-agora');
    const abrir = document.querySelector('.ini-abrir');
    const botao = abrir.querySelector('#abrirForm button').getBoundingClientRect();
    return {
      agoraRolaParaLado: agora.scrollWidth - agora.clientWidth,
      botaoSaiDoCartao: Math.round(botao.right - abrir.getBoundingClientRect().right)
    };
  });
  assert.equal(medidas.agoraRolaParaLado, 0, `a coluna "Agora no Nexo" rola para o lado com fonte larga: ${JSON.stringify(medidas)}`);
  assert.ok(medidas.botaoSaiDoCartao <= 0, `o botão de "Abrir uma sala" sai do cartão com fonte larga: ${JSON.stringify(medidas)}`);
  assert.deepEqual(erros, []);
  console.log('PASS: o cartão "Abrir uma sala" cabe na coluna mesmo com uma fonte do sistema mais larga');

  // A engrenagem do início abre as configurações -- o mesmo painel da sala -- sem rota nova e sem carregar nada: o
  // painel já está num quadro carregado de antemão, e abre como dentro da sala. Nada de sala por trás; um ajuste feito
  // ali vale no início na hora; fechar esconde o quadro; e só "Senha e conta" troca de página.
  const navegacoes = [];
  larga.on('framenavigated', f => { if (f === larga.mainFrame()) navegacoes.push(f.url()); });
  await larga.waitForFunction(() => document.querySelector('.ini-configuracoes'));
  const quadroDasConfiguracoes = () => larga.frames().find(f => /^https?:\/\/[^/]+\/configuracoes$/.test(f.url()));
  const esperarAte = async (condicao, mensagem, ms = 15000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (await condicao()) return; await larga.waitForTimeout(100); }
    assert.fail(mensagem);
  };
  await esperarAte(async () => Boolean(await quadroDasConfiguracoes()?.evaluate(() => typeof NexoConfig === 'object' && document.title.startsWith('Configurações')).catch(() => false)), 'o quadro das configurações devia ficar pronto de antemão');
  const quadroCfg = quadroDasConfiguracoes();
  const antes = Date.now();
  await larga.locator('.ini-eu-conta').click();
  await quadroCfg.locator('#devicesPanel:not(.hidden)').waitFor();
  const demorou = Date.now() - antes;
  assert.ok(demorou < 800, `o painel devia abrir na hora, sem carregar (levou ${demorou} ms)`);
  assert.deepEqual(navegacoes, [], 'abrir as configurações não muda de rota');
  assert.equal(await larga.locator('.ini-configuracoes').isVisible(), true);
  await larga.waitForTimeout(300);
  await larga.screenshot({ path: path.join(saida, 'configuracoes-no-inicio.png') });
  const fora = await quadroCfg.evaluate(() => ({
    portao: getComputedStyle(document.getElementById('nameGate')).display,
    sala: getComputedStyle(document.querySelector('.app')).display,
    naChamada: Boolean(socket || transporte),
    recentes: localStorage.getItem('nexoRecentRooms') || ''
  }));
  assert.deepEqual({ portao: fora.portao, sala: fora.sala, naChamada: fora.naChamada }, { portao: 'none', sala: 'none', naChamada: false }, `as configurações fora da sala não mostram nem entram na sala: ${JSON.stringify(fora)}`);
  assert.ok(!fora.recentes.includes('principal'), 'abrir as configurações não vira sala recente');
  await quadroCfg.evaluate(() => NexoConfig.abrir('aparencia'));
  await quadroCfg.locator('#aparenciaContraste').setChecked(true);
  await larga.waitForFunction(() => document.documentElement.classList.contains('alto-contraste'));
  // Fechar esconde o quadro e devolve o foco à engrenagem; abrir de novo é instantâneo.
  await quadroCfg.locator('#devicesClose').click();
  await larga.locator('.ini-configuracoes').waitFor({ state: 'hidden' });
  assert.equal(await larga.evaluate(() => document.activeElement?.classList.contains('ini-eu-conta')), true, 'o foco volta à engrenagem');
  await larga.locator('.ini-eu-conta').click();
  await quadroCfg.locator('#devicesPanel:not(.hidden)').waitFor({ timeout: 800 });
  // Só "Senha e conta" troca a página inteira.
  await quadroCfg.evaluate(() => NexoConfig.abrir('perfil'));
  await quadroCfg.locator('#configConta').click();
  await larga.waitForURL(/\/conta$/);
  assert.equal(await larga.evaluate(() => document.documentElement.classList.contains('alto-contraste')), true, 'o ajuste segue na conta');
  assert.deepEqual(erros, []);
  console.log('PASS: a engrenagem do início abre as configurações da sala na hora, sem rota nova nem sala por trás; o ajuste vale no início; só "Senha e conta" troca de página');

  // Pela rede (e no celular) os scripts de depois do sala.js chegam um a um, e a conta respondia antes de o
  // configuracoes.js existir: o painel nunca abria e a tela ficava vazia. Aqui eles chegam 400 ms atrasados cada.
  // E "Personalizar perfil" abre o editor por cima: fechar o editor devolve o painel, e não manda ao início.
  const lenta = await comConta({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await lenta.route(/\/(configuracoes|room-ui|social-sala|editor-cartao|perfil-sala|novidades|atividade|notificacoes)\.js$/, async rota => { await new Promise(r => setTimeout(r, 400)); await rota.continue(); });
  const devagar = await lenta.newPage();
  devagar.on('pageerror', e => { erros.push(e.message); console.error('erro nas configurações lentas:', e.message); });
  await devagar.goto(`${origem}/configuracoes?voltar=/`);
  await devagar.locator('#devicesPanel:not(.hidden)').waitFor({ timeout: 20000 });
  assert.equal(await devagar.evaluate(() => { NexoConfig.abrir('estudio'); return getComputedStyle(document.getElementById('estudioAbrir')).display; }), 'none', 'fora da sala não há "Abrir o Estúdio"');
  await devagar.evaluate(() => NexoConfig.abrir('perfil'));
  await devagar.locator('#configCartao').click();
  await devagar.locator('#editorCartaoPanel:not(.hidden)').waitFor();
  assert.match(devagar.url(), /\/configuracoes/, 'abrir o editor não sai das configurações');
  await devagar.keyboard.press('Escape');
  await devagar.locator('#devicesPanel:not(.hidden)').waitFor();
  assert.match(devagar.url(), /\/configuracoes/, 'fechar o editor devolve o painel');
  assert.deepEqual(erros, []);
  console.log('PASS: as configurações fora da sala abrem mesmo com os scripts chegando devagar (celular), sem "Abrir o Estúdio", e o editor do cartão volta ao painel');
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
