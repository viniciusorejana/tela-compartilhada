// A fila de música e o perfil, mexidos de dentro da sala, com dois navegadores: o que uma
// pessoa faz tem de aparecer para a outra, na ordem certa e com o nome certo.
//
// A fila é montada à mão (iniciar-telemetria.cjs): o que se testa aqui é a tela e o servidor
// da fila, não o yt-dlp. Sem servidor de mídia, pelo mesmo motivo.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const port = 3225;
const origin = `http://localhost:${port}`;
const SALA = 'sala-da-fila';
const saida = path.join(__dirname, '..', 'test-results', 'fila-e-perfil');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, browser;

async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(mensagem);
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error(`erro na página de ${nome}:`, e.message); });
  await pagina.goto(`${origin}/${SALA}/sala`);
  await pagina.evaluate(() => window.NexoConta?.pronto);
  if (!(await pagina.locator('#nameInput').evaluate(el => el.readOnly))) await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await pagina.evaluate(() => NexoMusica.abrir());
  return pagina;
}

const ordem = pagina => pagina.locator('#musicaFilaLista .fila-info strong').allTextContents();
const numeros = titulos => titulos.map(t => t.replace('Faixa ', '')).join('');
async function esperarOrdem(pagina, esperada, mensagem) {
  await esperarAte(async () => numeros(await ordem(pagina)) === esperada, `${mensagem}: a fila ficou ${numeros(await ordem(pagina))}, e não ${esperada}`);
}
const ultimaDoBot = pagina => pagina.locator('#musicaMsgs .msg.do-bot .msg-texto').last().textContent();

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(port) } });
  browser = await chromium.launch({ headless: true });
  const contextoDaAna = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const contextoDaBia = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const { cookie } = await instancia.conta('ana', { apelido: 'Ana' });
  await contextoDaAna.addCookies([{ name: 'nexo_conta', value: cookie.split('=')[1], url: origin }]);
  const ana = await entrar(contextoDaAna, 'Ana');
  const bia = await entrar(contextoDaBia, 'Bia');

  instancia.filaDeMusica(SALA, {
    tocando: { id: 't0', titulo: 'A que toca', autor: 'Artista', duracao: 200, pedidoPor: 'Ana' },
    fila: [1, 2, 3, 4, 5].map(n => ({ id: `f${n}`, titulo: `Faixa ${n}`, autor: 'Artista', duracao: 170 + n, pedidoPor: 'Bia' }))
  });
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '12345', 'a fila montada chega às duas');
  assert.equal(await ana.locator('#musicaFilaTotal').textContent(), '5');
  assert.equal(await ana.locator('#musicaFilaDuracao').textContent(), '14 min', 'a duração somada de tudo o que espera (865 s)');
  await ana.screenshot({ path: path.join(saida, 'fila.png') });

  // ---------- Tocar a seguir ----------
  const linha = (pagina, titulo) => pagina.locator('#musicaFilaLista .fila-item', { hasText: titulo });
  await linha(ana, 'Faixa 4').hover();
  await linha(ana, 'Faixa 4').getByRole('button', { name: 'Tocar Faixa 4 a seguir' }).click();
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '41235', 'tocar a seguir põe a faixa no topo');
  await esperarAte(async () => /Ana.*pôs.*Faixa 4.*a seguir/.test(await ultimaDoBot(bia)), 'o canal diz quem mexeu na fila');
  console.log('PASS: "tocar a seguir" sobe a faixa para as duas pessoas, e o canal diz quem foi');

  // ---------- Teclado: foco na alça e seta ----------
  await linha(ana, 'Faixa 1').locator('.fila-alca').focus();
  await ana.keyboard.press('ArrowDown');
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '42135', 'seta para baixo desce uma posição');
  assert.equal(await ana.evaluate(() => document.activeElement.closest('.fila-item')?.dataset.id), 'f1', 'o foco acompanha a faixa, para a próxima seta');
  await ana.keyboard.press('Home');
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '14235', 'Home leva ao topo');
  // A tela muda na hora e o servidor confirma logo depois, redesenhando a lista. O estado
  // chega antes da mensagem do bot: esperá-la é saber que a lista parou de mudar.
  await esperarAte(async () => /Ana.*pôs.*Faixa 1.*a seguir/.test(await ultimaDoBot(ana)), 'a confirmação do Home não chegou');
  assert.equal(await ana.evaluate(() => document.activeElement.closest('.fila-item')?.dataset.id), 'f1', 'e o foco sobrevive à confirmação do servidor');
  console.log('PASS: reordenar pelo teclado, com o foco seguindo a faixa');

  // ---------- Arrastar ----------
  const alca = linha(ana, 'Faixa 5').locator('.fila-alca');
  const origem = await alca.boundingBox();
  const topo = await linha(ana, 'Faixa 1').boundingBox();
  await ana.mouse.move(origem.x + origem.width / 2, origem.y + origem.height / 2);
  await ana.mouse.down();
  for (let passo = 1; passo <= 12; passo++) await ana.mouse.move(origem.x + origem.width / 2, origem.y + (topo.y + 4 - origem.y) * passo / 12);
  assert.equal(await ana.locator('.fila-item.arrastando').count(), 1, 'a faixa segue o ponteiro');
  await ana.screenshot({ path: path.join(saida, 'arrastando.png') });
  await ana.mouse.up();
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '51423', 'arrastar a última para o topo');
  console.log('PASS: arrastar pela alça reordena para as duas pessoas');

  // ---------- Menu: mover para uma posição e tirar ----------
  await linha(ana, 'Faixa 3').hover();
  await linha(ana, 'Faixa 3').getByRole('button', { name: 'Mais opções para Faixa 3' }).click();
  await ana.locator('#musicaFilaMenu').getByRole('menuitem', { name: 'Mover para a posição…' }).click();
  const campo = ana.locator('#musicaFilaMenu input[type="number"]');
  await campo.waitFor();
  await ana.screenshot({ path: path.join(saida, 'mover-para-posicao.png') });
  await campo.fill('2');
  await ana.locator('#musicaFilaMenu').getByRole('button', { name: 'Mover' }).click();
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '53142', 'mover para a posição 2');
  await linha(bia, 'Faixa 4').hover();
  await linha(bia, 'Faixa 4').getByRole('button', { name: 'Mais opções para Faixa 4' }).click();
  await bia.locator('#musicaFilaMenu').getByRole('menuitem', { name: 'Tirar da fila' }).click();
  for (const pagina of [ana, bia]) await esperarOrdem(pagina, '5312', 'tirar pelo menu');
  console.log('PASS: o menu da faixa move para uma posição digitada e tira da fila');

  // ---------- Repetir ----------
  //
  // Um botão que gira entre desligado, a fila e a faixa. O modo chega às duas telas, o canal diz
  // quem mexeu, e o estado está no desenho (o ponto, o "1") e no nome falado.
  const repetir = pagina => pagina.locator('#musicaRepetir');
  assert.equal(await repetir(ana).getAttribute('aria-pressed'), 'false', 'começa desligado');
  await repetir(ana).click();
  for (const pagina of [ana, bia]) await esperarAte(async () => (await repetir(pagina).getAttribute('aria-label')) === 'Repetir: a fila inteira', 'repetir a fila não chegou às duas');
  await esperarAte(async () => /Ana.*ligou repetir a fila/.test(await ultimaDoBot(bia)), 'o canal diz quem ligou o repetir');
  assert.match(await bia.locator('#musicaFilaDuracao').textContent(), /repetindo/, 'a fila diz que não acaba');
  await repetir(bia).click();
  for (const pagina of [ana, bia]) await esperarAte(async () => (await repetir(pagina).getAttribute('data-modo')) === 'faixa', 'repetir a faixa não chegou às duas');
  assert.equal(await repetir(ana).getAttribute('aria-pressed'), 'true');
  await esperarAte(async () => /Bia.*pôs.*A que toca.*para repetir/.test(await ultimaDoBot(ana)), 'o canal diz que a faixa vai repetir');
  await ana.locator('#tocandoAgora').screenshot({ path: path.join(saida, 'repetir-a-faixa.png') });
  await repetir(ana).click();
  for (const pagina of [ana, bia]) await esperarAte(async () => (await repetir(pagina).getAttribute('aria-pressed')) === 'false', 'desligar o repetir não chegou às duas');
  console.log('PASS: o repetir gira entre fila, faixa e desligado, para as duas pessoas, com o canal dizendo quem mexeu');

  // ---------- Esvaziar ----------
  ana.once('dialog', dialogo => dialogo.accept());
  await ana.locator('#musicaEsvaziar').click();
  for (const pagina of [ana, bia]) await esperarAte(async () => pagina.locator('#musicaFila').isHidden(), 'a fila vazia some das duas telas');
  await esperarAte(async () => /esvaziou a fila \(4 faixas\)/.test(await ultimaDoBot(bia)), 'o canal diz que a fila foi esvaziada');
  console.log('PASS: esvaziar tira tudo o que espera e mantém a que toca');

  // ---------- O perfil, sem sair da sala ----------
  await ana.locator('#meuPerfilBtn').click();
  await ana.locator('#meuPerfilPanel').waitFor();
  assert.equal(await ana.locator('#meuPerfilSalvar').isDisabled(), true, 'sem mudança, não há o que salvar');
  await ana.locator('#meuPerfilApelido').fill('Ana Clara');
  // Clica na amostra, como uma pessoa: o rádio em si é invisível, e é o rótulo que se toca.
  await ana.locator('#meuPerfilCores label:has(input[value="menta"])').click();
  await ana.locator('#meuPerfilMarcas label:has(input[value="lua"])').click();
  assert.equal(await ana.locator('#meuPerfilAvatar').textContent(), '☾', 'a prévia acompanha a escolha antes de salvar');
  await ana.screenshot({ path: path.join(saida, 'perfil-na-sala.png') });
  await ana.locator('#meuPerfilSalvar').click();
  await esperarAte(async () => /Salvo/.test(await ana.locator('#meuPerfilStatus').textContent()), 'o perfil não foi salvo');
  // O aviso do servidor chega a quem mudou também: é ele que troca o nome no rodapé.
  await esperarAte(async () => (await ana.locator('#selfName').textContent()) === 'Ana Clara', 'o rodapé da Ana não mostrou o apelido novo');
  assert.equal(await ana.locator('#selfAvatar').textContent(), '☾');
  await esperarAte(async () => bia.evaluate(() => [...perfisPorIdentidade.values()].some(p => p.cor === 'menta' && p.marca === 'lua')), 'o perfil novo não chegou à Bia');
  await ana.keyboard.press('Escape');
  // Sem servidor de mídia, a lista lateral só tem a própria pessoa: é pelo chat que se vê a
  // outra. A mensagem nova sai com o apelido, a cor e a marca novos.
  await ana.evaluate(() => abrirChat());
  await ana.locator('#chatInput').fill('agora com o nome novo');
  await ana.locator('#chatSend').click();
  await bia.evaluate(() => abrirChat());
  const mensagem = bia.locator('.msg', { hasText: 'agora com o nome novo' });
  await esperarAte(async () => (await mensagem.locator('.msg-autor').textContent().catch(() => '')) === 'Ana Clara', 'a mensagem nova não saiu com o apelido novo');
  assert.equal(await mensagem.locator('.msg-avatar').textContent(), '☾', 'a marca nova chega a quem está na sala');
  assert.equal(await mensagem.locator('.msg-avatar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(127, 209, 174)', 'e a cor também');
  console.log('PASS: o perfil muda de dentro da sala, e a outra pessoa vê nome, cor e marca novos na hora');

  // ---------- O aplicativo desatualizado ----------
  //
  // Um aplicativo 1.0.0 (a ponte do Electron, simulada) numa sala cujo servidor distribui a
  // 1.1.0. O aviso aparece num botão, nada abre sozinho, e "Depois" vale por alguns dias.
  const contextoDoApp = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await contextoDoApp.addInitScript(() => {
    const nada = async () => ({});
    window.appNativo = { pid: 0, versao: '1.0.0', plataforma: 'win32', estadoDoAgente: nada, iniciarAgente: async () => ({ rodando: false }),
      prepararCaptura: async () => false, capturaSelecionada: async () => null, encerreiCaptura: nada, aoEncerrarCaptura: () => {}, definirEndereco: nada, trocarServidor: nada };
  });
  await contextoDoApp.route('**/api/desktop-app', rota => rota.fulfill({ json: { available: true, sistemas: [
    { chave: 'windows', nome: 'Windows x64', tipo: '.exe portátil', url: '/downloads/SalaCompartilhada.exe', size: 1, builtAt: new Date().toISOString(), versao: '1.1.0' }
  ] } }));
  const app = await entrar(contextoDoApp, 'Caio');
  assert.equal(await app.locator('#atualizarAppMenu').isVisible(), false, 'o cartão não abre sozinho');
  await app.evaluate(() => NexoAtualizacao.conferir());
  await app.locator('#atualizarAppBtn').waitFor();
  await app.locator('#atualizarAppBtn').click();
  const caixa = await app.locator('#atualizarAppMenu').boundingBox();
  assert.ok(caixa && caixa.width > 100 && caixa.y > 0, `o cartão abre à vista, embaixo do botão: ${JSON.stringify(caixa)} ${await app.locator('#atualizarAppMenu').getAttribute('class')}`);
  assert.equal(await app.locator('#atualizarAppTitulo').textContent(), 'Nexo 1.1.0 disponível');
  assert.match(await app.locator('#atualizarAppTexto').textContent(), /Você está com a 1\.0\.0/);
  assert.equal(await app.locator('#atualizarAppBaixar').getAttribute('href'), '/downloads/SalaCompartilhada.exe');
  await app.screenshot({ path: path.join(saida, 'atualizacao.png') });
  assert.match((await app.evaluate(() => NexoAtualizacao.situacao())).texto, /a 1\.1\.0 já está disponível/, 'o diagnóstico diz a versão');
  await app.locator('#atualizarAppDepois').click();
  assert.equal(await app.locator('#atualizarAppBtn').isHidden(), true, '"Depois" tira o aviso da frente');
  await app.reload();
  await app.evaluate(() => NexoAtualizacao.conferir());
  await app.waitForTimeout(300);
  assert.equal(await app.locator('#atualizarAppBtn').isHidden(), true, 'e ele não volta a cada recarga');
  // O navegador comum não é aplicativo: nada de aviso.
  await bia.evaluate(() => NexoAtualizacao.conferir());
  assert.equal(await bia.locator('#atualizarAppBtn').isHidden(), true);
  console.log('PASS: o aplicativo antigo vê "Atualizar" num canto, com a versão nova e o link, e "Depois" vale');

  // ---------- O aplicativo novo baixa sozinho ----------
  //
  // A ponte nova do Electron (simulada): a sala pede a versão, o progresso chega aos pedaços e
  // o fim oferece reiniciar. Nada disso sai do canto da tela.
  const contextoDoAppNovo = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await contextoDoAppNovo.addInitScript(() => {
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
        setTimeout(() => avisar({ estado: 'pronto', versao, recebidos: 100 * 1048576, total: 100 * 1048576, arquivo: 'Nexo 1.1.0.exe' }), 1400);
        return { ok: true };
      } };
  });
  await contextoDoAppNovo.route('**/api/desktop-app', rota => rota.fulfill({ json: { available: true, sistemas: [
    { chave: 'windows', nome: 'Windows x64', tipo: '.exe portátil', url: '/downloads/SalaCompartilhada.exe', size: 1, builtAt: new Date().toISOString(), versao: '1.1.0' }
  ] } }));
  const appNovo = await entrar(contextoDoAppNovo, 'Duda');
  await appNovo.evaluate(() => NexoAtualizacao.conferir());
  await appNovo.locator('#atualizarAppBtn').click();
  assert.equal(await appNovo.locator('#atualizarAppBaixar').textContent(), 'Atualizar agora', 'com a ponte nova, quem baixa é o aplicativo');
  await appNovo.locator('#atualizarAppBaixar').click();
  await appNovo.locator('.nexo-toast', { hasText: 'Baixando o Nexo 1.1.0 · 42%' }).waitFor({ timeout: 5000 });
  assert.match(await appNovo.locator('.nexo-toast small').first().textContent(), /42,0 de 100,0 MB/);
  assert.equal(await appNovo.locator('#atualizarAppBtn span').textContent(), 'Baixando 42%', 'o botão do topo acompanha');
  await appNovo.screenshot({ path: path.join(saida, 'atualizacao-baixando.png') });
  await appNovo.locator('.nexo-toast', { hasText: 'Nexo 1.1.0 pronto' }).waitFor({ timeout: 5000 });
  await appNovo.locator('.nexo-toast').getByRole('button', { name: 'Reiniciar agora' }).click();
  assert.deepEqual(await appNovo.evaluate(() => chamadasDaPonte), ['baixar 1.1.0', 'abrir']);
  assert.equal(await appNovo.locator('#atualizarAppBtn span').textContent(), 'Reiniciar');
  console.log('PASS: o aplicativo novo baixa a atualização com o progresso num aviso, e oferece reiniciar no fim');

  // ---------- O aplicativo instalado se atualiza sozinho ----------
  //
  // A ponte do instalado (simulada): o processo principal procura e baixa em silêncio, e a sala
  // só fica sabendo no fim -- um aviso, uma vez, e o botão "Reiniciar". As opções do aplicativo
  // moram nas configurações, na seção "Aplicativo de mesa".
  const contextoDoInstalado = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await contextoDoInstalado.addInitScript(() => {
    const nada = async () => ({});
    const ouvintes = [];
    window.avisarDoPrincipal = dados => ouvintes.forEach(ouvir => ouvir(dados));
    window.chamadasDaPonte = [];
    let opcoes = { tipo: 'instalador', atualizaSozinho: true, atualizarSozinho: true, podeAbrirAoEntrar: true, abrirAoEntrar: false };
    window.appNativo = { pid: 0, versao: '1.2.0', plataforma: 'win32', instalacao: 'instalador', estadoDoAgente: nada, iniciarAgente: async () => ({ rodando: false }),
      prepararCaptura: async () => false, capturaSelecionada: async () => null, encerreiCaptura: nada, aoEncerrarCaptura: () => {}, definirEndereco: nada, trocarServidor: nada,
      aoProgressoDaAtualizacao: ouvir => ouvintes.push(ouvir),
      estadoDaAtualizacao: async () => null,
      cancelarAtualizacao: async () => true,
      mostrarAtualizacao: async () => false,
      abrirAtualizacao: async () => { chamadasDaPonte.push('abrir'); return true; },
      baixarAtualizacao: async versao => { chamadasDaPonte.push(`baixar ${versao}`); return { ok: true, jaEstava: true }; },
      procurarAtualizacao: async () => { chamadasDaPonte.push('procurar'); return { ok: true, nova: false, versao: '' }; },
      opcoesDoAplicativo: async () => ({ ...opcoes }),
      definirOpcaoDoAplicativo: async (nome, valor) => { chamadasDaPonte.push(`${nome}=${valor}`); opcoes = { ...opcoes, [nome]: valor }; return { ...opcoes }; } };
  });
  const instalado = await entrar(contextoDoInstalado, 'Edu');
  await instalado.evaluate(() => NexoAtualizacao.conferir());
  await instalado.evaluate(() => avisarDoPrincipal({ estado: 'baixando', versao: '1.3.0', recebidos: 10 * 1048576, total: 100 * 1048576, silenciosa: true }));
  await instalado.waitForTimeout(300);
  assert.equal(await instalado.locator('.nexo-toast').count(), 0, 'a versão que desce sozinha não aparece no meio da chamada');
  assert.equal(await instalado.locator('#atualizarAppBtn').isHidden(), true, 'nem o botão');
  await instalado.evaluate(() => avisarDoPrincipal({ estado: 'pronto', versao: '1.3.0', recebidos: 100 * 1048576, total: 100 * 1048576, silenciosa: true }));
  await instalado.locator('.nexo-toast', { hasText: 'Nexo 1.3.0 pronto' }).waitFor({ timeout: 5000 });
  assert.match(await instalado.locator('.nexo-toast').textContent(), /se instala quando você fechar o Nexo/);
  assert.equal(await instalado.locator('.nexo-toast').getByRole('button', { name: 'Mostrar na pasta' }).count(), 0, 'o instalado não tem arquivo para mostrar');
  assert.equal(await instalado.locator('#atualizarAppBtn span').textContent(), 'Reiniciar');
  await instalado.screenshot({ path: path.join(saida, 'atualizacao-instalado-pronta.png') });
  await instalado.locator('.nexo-toast').getByRole('button', { name: 'Reiniciar agora' }).click();
  assert.deepEqual(await instalado.evaluate(() => chamadasDaPonte), ['abrir']);

  await instalado.locator('#devicesBtn').click();
  await instalado.locator('#abaAplicativo').click();
  await instalado.locator('#painelAplicativo').waitFor();
  assert.equal(await instalado.locator('#appVersao').textContent(), 'Nexo 1.2.0');
  assert.match(await instalado.locator('#appVersaoEstado').textContent(), /instalado · a 1\.3\.0 está pronta/);
  assert.equal(await instalado.locator('#appAtualizarSozinho').isChecked(), true, '"Atualizar sozinho" vem ligado');
  assert.equal(await instalado.locator('#appAbrirAoEntrar').isChecked(), false, '"Abrir ao entrar no computador" vem desligado');
  await instalado.locator('#appLinhaAbrir').click();
  await esperarAte(async () => (await instalado.evaluate(() => chamadasDaPonte)).includes('abrirAoEntrar=true'), 'ligar "abrir ao entrar" não chegou ao aplicativo');
  assert.equal(await instalado.locator('#appAbrirAoEntrar').isChecked(), true);
  await instalado.locator('#painelAplicativo').screenshot({ path: path.join(saida, 'aplicativo-de-mesa.png') });
  console.log('PASS: o instalado baixa calado, avisa uma vez que está pronto, e as opções dele ficam em "Aplicativo de mesa"');

  // ---------- A mesma conta em outro aparelho ----------
  //
  // A Ana abre a mesma conta em outro navegador e entra na sala: a aba antiga sai, com o
  // motivo e o caminho de volta -- que, usado, tira a conta do outro aparelho.
  const outroAparelho = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await outroAparelho.addCookies([{ name: 'nexo_conta', value: cookie.split('=')[1], url: origin }]);
  const anaNoCelular = await entrar(outroAparelho, 'Ana');
  await ana.locator('#removidoPanel').waitFor({ timeout: 10000 });
  assert.equal(await ana.locator('#removidoTitulo').textContent(), 'Sua conta está em outro aparelho');
  assert.match(await ana.locator('#removidoMotivo').textContent(), /entrou nesta sala por outro aparelho/);
  assert.equal(await ana.locator('#removidoVoltar').isVisible(), true);
  await ana.screenshot({ path: path.join(saida, 'outro-aparelho.png') });
  await ana.waitForTimeout(800);
  assert.equal(await ana.locator('#removidoPanel').isVisible(), true, 'a aba antiga não volta sozinha para a sala');
  assert.equal(await anaNoCelular.locator('#removidoPanel').isVisible(), false);
  await ana.locator('#removidoVoltar').click();
  await ana.waitForLoadState();
  await ana.evaluate(() => window.NexoConta?.pronto);
  await ana.locator('#nameConfirmBtn').click();
  await ana.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await anaNoCelular.locator('#removidoPanel').waitFor({ timeout: 10000 });
  console.log('PASS: a mesma conta em outro aparelho tira a conexão antiga, que mostra o motivo e o caminho de volta');

  assert.deepEqual(erros, []);
  console.log('Fila, perfil, atualização e conta única na sala: tudo certo.');
})().catch(async erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await instancia?.encerrar();
});
