// As cores do tema do cartão, no editor: o seletor de cor do Nexo no lugar do quadrado nativo do navegador.
//
// Eram dois retângulos de cor soltos ("Cor 1", "Cor 2") que cada sistema desenha de um jeito e que destoavam
// do resto. Agora são duas gemas que abrem um seletor (public/seletor-cor.js: área de saturação e brilho,
// matiz, código da cor, cores prontas, conta-gotas), com o degradê entre elas, trocar de lugar e sortear.
// Aqui se prova o que a pessoa faz: escolher de todo jeito (arrastar, digitar, pronta, teclado), o cartão
// acompanhar, salvar e o valor chegar certo ao servidor; e o painelzinho se comportar (Esc fecha só ele,
// clicar fora, o toque no celular, por cima de um painel da sala).
//
// Sem servidor de mídia: o que se prova é a tela.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3239;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'cor');
fs.mkdirSync(saida, { recursive: true });
const erros = [];
let instancia, navegador;

const observar = (pagina, nome) => {
  pagina.on('pageerror', e => { erros.push(`${nome}: ${e.message}`); console.error(`erro na página de ${nome}:`, e.message); });
  return pagina;
};
async function esperarAte(condicao, mensagem, prazo = 8000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(typeof mensagem === 'function' ? mensagem() : mensagem);
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anacor', { apelido: 'Ana' });
  const guardada = async () => (await (await fetch(`${origem}/api/conta/vitrine`, { headers: { Cookie: ana.cookie } })).json()).guardada;

  navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1360, height: 900 } });
  await contexto.addCookies([{ name: 'nexo_conta', value: ana.cookie.split('=')[1], url: origem }]);
  const pagina = observar(await contexto.newPage(), 'Ana');
  await pagina.goto(`${origem}/?secao=perfil`);
  await pagina.locator('.ed-previa-cartao .nx-cartao').waitFor();

  const slot = nome => pagina.locator(`[data-ed="${nome}"]`);
  const hexDe = nome => slot(nome).locator('small').textContent();
  const painelzinho = pagina.locator('.nx-pop.nx-cor');
  // A cor do banner da prévia, lida do que o cartão está usando (as variáveis do cartão).
  const coresDoCartao = () => pagina.evaluate(() => { const c = document.querySelector('.ed-previa-cartao .nx-cartao'); return [c.style.getPropertyValue('--v1'), c.style.getPropertyValue('--v2')]; });
  // As amostras do catálogo (banner, fundo, borda, moldura e estilo do nome) mostram o cartão com as cores de
  // agora. Lê-se o par de variáveis que cada uma pinta (`--v1` e `--v2`) e o degradê da primeira amostra do
  // banner, que é a cor de verdade na tela. `raiz` é o editor: no início é a página; na sala, um painel.
  const amostras = (alvo, raiz = 'body') => alvo.evaluate(raiz => {
    const par = el => { const e = getComputedStyle(el); return [e.getPropertyValue('--v1').trim().toLowerCase(), e.getPropertyValue('--v2').trim().toLowerCase()]; };
    const de = (grupo, valor, seletor) => document.querySelector(`${raiz} [data-ed="${grupo}"] [data-valor="${valor}"] ${seletor}`);
    const bannerDoTema = de('banner', 'tema', '.ed-opcao-amostra');
    return {
      pintado: getComputedStyle(bannerDoTema).backgroundImage,
      cores: {
        banner: par(bannerDoTema),
        bannerAnimado: par(de('banner', 'aurora', '.nx-anim')),
        bannerImagem: par(de('banner', 'imagem', '.ed-opcao-amostra')),
        fundoDoTema: par(de('fundo', 'tema', '.ed-opcao-amostra')),
        fundoAnimado: par(de('fundo', 'estrelas', '.nx-anim')),
        borda: par(de('borda', 'tema', '.nx-av')),
        moldura: par(de('moldura', 'tema', '.ed-opcao-moldura')),
        nome: par(de('nome', 'tema', '.nx-nome-estilo'))
      }
    };
  }, raiz);
  // Espera todas as amostras chegarem às duas cores; devolve o que viu, para quem quiser conferir o degradê.
  const amostrasCom = async (a, b, motivo, alvo = pagina, raiz = 'body') => {
    let visto = null;
    await esperarAte(async () => { visto = await amostras(alvo, raiz); return Object.values(visto.cores).every(par => par[0] === a && par[1] === b); }, () => `${motivo}: ${JSON.stringify(visto)}`);
    return visto;
  };

  // ---------- O bloco: duas gemas, sem o quadrado nativo ----------
  assert.equal(await pagina.locator('.ed input[type="color"]').count(), 0, 'o quadrado nativo do navegador não está mais no editor');
  assert.equal(await hexDe('corA'), '#8879F6', 'a primeira gema mostra a cor do tema escolhido');
  assert.equal(await hexDe('corB'), '#2B2456');
  assert.equal(await slot('coresDoTema').isHidden(), true, 'sem cores exatas, não há o que desfazer');
  assert.equal(await slot('corA').getAttribute('aria-haspopup'), 'true');
  await pagina.locator('[data-ed="cores"]').screenshot({ path: path.join(saida, 'bloco.png') });
  await amostrasCom('#8879f6', '#2b2456', 'as amostras do catálogo não partem das cores do tema');
  console.log('PASS: o bloco das cores exatas são duas gemas com o código da cor, o degradê, trocar e sortear -- e nenhum quadrado nativo');

  // ---------- Abrir, digitar o código, o cartão acompanha ----------
  await slot('corA').click();
  await painelzinho.waitFor();
  assert.equal(await slot('corA').getAttribute('aria-expanded'), 'true');
  assert.equal(await painelzinho.getAttribute('role'), 'group', 'não é role="dialog": a sala não congela');
  assert.equal(await pagina.evaluate(() => document.activeElement?.classList.contains('nx-cor-area')), true, 'o foco entra na área da cor');
  assert.equal(await painelzinho.locator('.nx-cor-hex').inputValue(), '#8879F6');
  await painelzinho.locator('.nx-cor-hex').fill('#ff0066');
  await esperarAte(async () => (await hexDe('corA')) === '#FF0066', 'digitar o código não mudou a gema');
  await esperarAte(async () => (await coresDoCartao())[0] === '#ff0066', 'o cartão não acompanhou a cor digitada');
  assert.equal(await hexDe('corB'), '#2B2456', 'a outra cor não muda');
  // O banner, o fundo, a borda, a moldura e o nome do catálogo também mudam na hora, e não só o cartão: com um
  // tema já era assim, e com cores exatas as amostras ficavam com as do tema até a pessoa salvar.
  const comRosa = await amostrasCom('#ff0066', '#2b2456', 'as amostras do catálogo não acompanharam a cor digitada');
  assert.match(comRosa.pintado, /rgb\(255, 0, 102\)/, 'e o degradê do banner, na tela, usa a cor digitada');
  assert.equal(await slot('coresDoTema').isVisible(), true, 'com cores exatas, "Usar as do tema" aparece');
  assert.equal(await pagina.locator('[data-ed="salvar"]').isEnabled(), true, 'e há o que salvar');
  // O código inválido é dito, e não aplicado; o atalho de três dígitos vale.
  await painelzinho.locator('.nx-cor-hex').fill('#zz');
  assert.equal(await painelzinho.locator('.nx-cor-hex').getAttribute('aria-invalid'), 'true');
  assert.equal(await hexDe('corA'), '#FF0066');
  await painelzinho.locator('.nx-cor-hex').fill('0af');
  await esperarAte(async () => (await hexDe('corA')) === '#00AAFF', 'o código curto (#0af) não valeu');
  await amostrasCom('#00aaff', '#2b2456', 'o código curto não chegou às amostras do catálogo');
  assert.equal(await painelzinho.locator('.nx-cor-hex').getAttribute('aria-invalid'), null);
  console.log('PASS: digitar o código muda a gema e o cartão na hora; o inválido é dito e não aplicado; o curto vale');

  // ---------- Arrastar na área, o matiz, as cores prontas, o teclado ----------
  const area = await painelzinho.locator('.nx-cor-area').boundingBox();
  await pagina.mouse.move(area.x + area.width * 0.25, area.y + area.height * 0.25);
  await pagina.mouse.down();
  await pagina.mouse.move(area.x + area.width * 0.9, area.y + area.height * 0.1, { steps: 6 });
  await pagina.mouse.up();
  const arrastada = await hexDe('corA');
  assert.notEqual(arrastada, '#00AAFF', 'arrastar na área muda a cor');
  assert.equal(await painelzinho.locator('.nx-cor-hex').inputValue(), arrastada, 'e o código acompanha');
  await amostrasCom(arrastada.toLowerCase(), '#2b2456', 'arrastar na área não mudou as amostras do catálogo');
  const antesDoMatiz = await hexDe('corA');
  await painelzinho.locator('.nx-cor-matiz').fill('300');
  await esperarAte(async () => (await hexDe('corA')) !== antesDoMatiz, 'a régua do matiz não mudou a cor');
  const prontas = painelzinho.locator('.nx-cor-pronta');
  assert.equal(await prontas.count(), 10, 'as cores prontas são as vivas dos dez temas do cartão');
  await prontas.nth(1).click();
  assert.equal(await hexDe('corA'), '#3FD0B0', 'uma cor pronta vale na hora');
  assert.equal(await prontas.nth(1).getAttribute('aria-pressed'), 'true', 'e fica marcada');
  await amostrasCom('#3fd0b0', '#2b2456', 'a cor pronta não chegou às amostras do catálogo');
  await painelzinho.locator('.nx-cor-area').focus();
  const antesDaSeta = await hexDe('corA');
  await pagina.keyboard.press('ArrowLeft');
  await pagina.keyboard.press('Shift+ArrowDown');
  assert.notEqual(await hexDe('corA'), antesDaSeta, 'as setas movem a cor na área (e Shift de dez em dez)');
  await painelzinho.screenshot({ path: path.join(saida, 'seletor.png') });
  console.log('PASS: dá para escolher arrastando, pela régua do matiz, por uma cor pronta e pelo teclado');

  // ---------- Fechar: Esc só ele; clicar fora; clicar na mesma gema ----------
  await pagina.keyboard.press('Escape');
  await painelzinho.waitFor({ state: 'detached' });
  assert.equal(await slot('corA').getAttribute('aria-expanded'), 'false');
  assert.equal(await pagina.evaluate(() => document.activeElement === document.querySelector('[data-ed="corA"]')), true, 'o foco volta à gema');
  await slot('corA').click();
  await painelzinho.waitFor();
  await slot('corA').click();
  await painelzinho.waitFor({ state: 'detached' });
  await pagina.waitForTimeout(200);
  assert.equal(await painelzinho.count(), 0, 'clicar na mesma gema fecha, e não reabre');
  await slot('corB').click();
  await painelzinho.waitFor();
  await pagina.locator('.ed-abas [data-parte="visual"]').click();
  await painelzinho.waitFor({ state: 'detached' });
  await slot('corA').click();
  await painelzinho.waitFor();
  await slot('corB').click();
  await esperarAte(async () => (await slot('corB').getAttribute('aria-expanded')) === 'true' && (await slot('corA').getAttribute('aria-expanded')) === 'false', 'abrir a outra gema não trocou o painelzinho');
  assert.equal(await painelzinho.count(), 1, 'só um seletor de cada vez');
  await pagina.keyboard.press('Escape');
  console.log('PASS: Esc fecha só o seletor e devolve o foco à gema; clicar fora fecha; a mesma gema alterna; abrir outra troca; só um por vez');

  // ---------- Numa janela baixa o seletor cabe e rola por dentro ----------
  // O celular deitado tem uns 300 px de altura: a paleta e o código não podem ficar cortados para fora da tela.
  await pagina.setViewportSize({ width: 740, height: 300 });
  await slot('corA').scrollIntoViewIfNeeded();
  await slot('corA').click();
  await painelzinho.waitFor();
  await esperarAte(async () => { const c = await painelzinho.boundingBox(); return c && c.y >= 0 && c.y + c.height <= 300.5; }, 'o seletor de cor não coube numa janela de 300 px de altura');
  assert.equal(await painelzinho.evaluate(el => el.scrollHeight > el.clientHeight), true, 'o seletor rola por dentro quando a janela é baixa');
  await painelzinho.locator('.nx-cor-pronta').last().scrollIntoViewIfNeeded();
  const caixaBaixa = await painelzinho.boundingBox();
  const ultimaPronta = await painelzinho.locator('.nx-cor-pronta').last().boundingBox();
  assert.ok(ultimaPronta.y >= caixaBaixa.y && ultimaPronta.y + ultimaPronta.height <= caixaBaixa.y + caixaBaixa.height + 0.5, 'a última cor pronta fica ao alcance, rolando');
  await pagina.keyboard.press('Escape');
  await painelzinho.waitFor({ state: 'detached' });
  await pagina.setViewportSize({ width: 1360, height: 900 });
  console.log('PASS: numa janela baixa o seletor de cor cabe na tela e rola por dentro');

  // ---------- Trocar de lugar, sortear, voltar ao tema ----------
  await slot('corA').click();
  await painelzinho.waitFor();
  await painelzinho.locator('.nx-cor-hex').fill('#112233');
  await pagina.keyboard.press('Escape');
  const [a, b] = [await hexDe('corA'), await hexDe('corB')];
  await slot('trocarCores').click();
  assert.deepEqual([await hexDe('corA'), await hexDe('corB')], [b, a], 'trocar põe cada cor no lugar da outra');
  await esperarAte(async () => (await coresDoCartao())[0] === b.toLowerCase(), 'o cartão não acompanhou a troca');
  await amostrasCom(b.toLowerCase(), a.toLowerCase(), 'trocar de lugar não trocou as cores das amostras do catálogo');
  await slot('sortearCores').click();
  await esperarAte(async () => (await hexDe('corA')) !== b && (await hexDe('corB')) !== a, 'o dado não sorteou duas cores novas', 3000);
  await pagina.waitForTimeout(500);
  const sorteadas = [await hexDe('corA'), await hexDe('corB')];
  assert.ok(sorteadas.every(c => /^#[0-9A-F]{6}$/.test(c)), 'o sorteio dá duas cores válidas');
  assert.deepEqual((await coresDoCartao()).map(c => c.toUpperCase()), sorteadas, 'e o cartão usa as que pararam, não as da rolagem');
  await amostrasCom(sorteadas[0].toLowerCase(), sorteadas[1].toLowerCase(), 'o sorteio não chegou às amostras do catálogo');
  await pagina.locator('[data-ed="cores"]').screenshot({ path: path.join(saida, 'sorteadas.png') });
  console.log('PASS: trocar põe as cores uma no lugar da outra; o dado sorteia um par que combina, e o cartão usa o que parou');

  // ---------- Salvar: o servidor recebe #rrggbb ----------
  await slot('corA').click();
  await painelzinho.waitFor();
  await painelzinho.locator('.nx-cor-hex').fill('#FF0066');
  await pagina.keyboard.press('Escape');
  await pagina.locator('[data-ed="salvar"]').click();
  await esperarAte(async () => (await guardada()).cores?.a === '#ff0066', 'o servidor não recebeu a cor');
  assert.equal((await guardada()).cores.b, sorteadas[1].toLowerCase(), 'a outra cor também foi');
  await pagina.reload();
  // O endereço da seção some depois de aberta (inicio.js): recarregar volta aos amigos.
  await pagina.locator('.ini-secao[data-secao="perfil"]').click();
  await pagina.locator('.ed-previa-cartao .nx-cartao').waitFor();
  assert.equal(await hexDe('corA'), '#FF0066', 'depois de recarregar, a gema mostra o que ficou guardado');
  await amostrasCom('#ff0066', sorteadas[1].toLowerCase(), 'depois de recarregar, as amostras do catálogo não partem das cores guardadas');
  await slot('coresDoTema').click();
  assert.equal(await hexDe('corA'), '#8879F6', '"Usar as do tema" volta às cores do tema escolhido');
  assert.equal(await slot('coresDoTema').isHidden(), true);
  await amostrasCom('#8879f6', '#2b2456', '"Usar as do tema" não devolveu as amostras do catálogo às cores do tema');
  // E trocar de tema, que sempre refez as amostras, segue valendo.
  await pagina.locator('.ed-tema[data-valor="oceano"]').click();
  await amostrasCom('#4f9dff', '#123866', 'trocar o tema não mudou as amostras do catálogo');
  console.log('PASS: as cores chegam ao servidor como #rrggbb, voltam depois de recarregar, e "Usar as do tema" desfaz');

  // ---------- Dentro da sala: por cima do painel, e o Esc fecha só ele ----------
  const sala = observar(await contexto.newPage(), 'Ana na sala');
  await sala.goto(`${origem}/sala-das-cores/sala`);
  await sala.evaluate(() => window.NexoConta?.pronto);
  await sala.locator('#nameConfirmBtn').click();
  await sala.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await sala.evaluate(() => NexoSalaSocial.abrirEditor());
  await sala.locator('#editorCartaoSala [data-ed="corA"]').waitFor();
  await sala.locator('#editorCartaoSala [data-ed="corA"]').click();
  await sala.locator('.nx-pop.nx-cor').waitFor();
  assert.equal(await sala.evaluate(() => document.querySelector('.app').inert), true, 'a sala está inerte sob o painel, mas o seletor responde');
  await sala.locator('.nx-pop.nx-cor .nx-cor-hex').fill('#3366ff');
  await esperarAte(async () => (await sala.locator('#editorCartaoSala [data-ed="corA"] small').textContent()) === '#3366FF', 'o seletor não respondeu por cima do painel');
  await amostrasCom('#3366ff', sorteadas[1].toLowerCase(), 'no editor da sala, as amostras do catálogo não acompanharam a cor', sala, '#editorCartaoSala');
  console.log('PASS: as amostras do catálogo (banner, fundo, borda, moldura e nome) acompanham as cores exatas na hora -- digitar, arrastar, cor pronta, trocar, sortear, recarregar, "Usar as do tema" e outro tema --, no início e na sala');
  assert.equal(await sala.evaluate(() => { const p = document.querySelector('.nx-pop.nx-cor'); const r = p.getBoundingClientRect(); const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return p.contains(topo); }), true, 'o seletor está por cima do painel, e não por baixo');
  await sala.keyboard.press('Escape');
  await sala.locator('.nx-pop.nx-cor').waitFor({ state: 'detached' });
  assert.equal(await sala.locator('#editorCartaoPanel').evaluate(el => !el.classList.contains('hidden')), true, 'o Esc fecha só o seletor: o painel continua');
  await sala.locator('#editorCartaoSala [data-ed="corB"]').click();
  await sala.locator('.nx-pop.nx-cor').waitFor();
  await sala.mouse.click(4, 4);
  await sala.locator('.nx-pop.nx-cor').waitFor({ state: 'detached' });
  assert.equal(await sala.locator('#editorCartaoPanel').evaluate(el => !el.classList.contains('hidden')), true, 'clicar no fundo do painel fecha só o seletor');
  await sala.locator('#editorCartaoSala [data-ed="corB"]').click();
  await sala.locator('.nx-pop.nx-cor').waitFor();
  await sala.locator('#editorCartaoPanel .modal-fechar').click();
  await sala.locator('.nx-pop.nx-cor').waitFor({ state: 'detached' });
  console.log('PASS: dentro da sala o seletor abre por cima do painel, o Esc e o clique no fundo fecham só ele, e fechar o painel o leva junto');
  await sala.close();

  // ---------- No celular: a folha embaixo ----------
  const celular = await navegador.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  await celular.addCookies([{ name: 'nexo_conta', value: ana.cookie.split('=')[1], url: origem }]);
  const tel = observar(await celular.newPage(), 'Ana no celular');
  await tel.goto(`${origem}/?secao=perfil`);
  await tel.locator('.ed-previa-cartao .nx-cartao').waitFor();
  await tel.locator('[data-ed="corB"]').scrollIntoViewIfNeeded();
  await tel.locator('[data-ed="corB"]').tap();
  await tel.locator('.nx-pop.nx-cor').waitFor();
  await tel.waitForTimeout(400);
  for (const largura of [390, 320]) {
    await tel.setViewportSize({ width: largura, height: 700 });
    await tel.waitForTimeout(200);
    const caixa = await tel.locator('.nx-pop.nx-cor').boundingBox();
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura && caixa.y >= 0 && caixa.y + caixa.height <= 700, `a folha cabe na tela de ${largura} px: ${JSON.stringify(caixa)}`);
    assert.ok(caixa.y + caixa.height >= 700 - 20, `e fica embaixo, ao alcance do polegar (${largura} px)`);
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolar de lado em ${largura} px`);
  }
  await tel.screenshot({ path: path.join(saida, 'celular.png') });
  // O toque no fundo escurecido só dispensa a folha. A folha fecha no `pointerdown` e o fundo sai da página;
  // o `click` que o navegador sintetiza logo depois cairia no que estava por baixo -- um botão da página que
  // o dedo nem mirava. O ouvinte fica no `document`, em captura: o que a folha engole não chega até ele.
  await tel.evaluate(() => {
    window.__cliques = [];
    document.addEventListener('click', e => window.__cliques.push(e.target.id || String(e.target.className) || e.target.tagName), true);
  });
  await tel.locator('.nx-pop-fundo').tap({ position: { x: 20, y: 20 } });
  await tel.locator('.nx-pop.nx-cor').waitFor({ state: 'detached' });
  await tel.waitForTimeout(500);
  assert.deepEqual(await tel.evaluate(() => window.__cliques), [], 'o toque que dispensa a folha não vira clique no que estava por baixo');
  // E o que se engole é só o clique daquele toque. Se ele não vem (o toque virou rolagem: o navegador manda
  // `pointercancel` em vez de clicar), o toque seguinte, num botão da página, tem de ser atendido -- sem esperar
  // os 600 ms do prazo. O `pointerdown` sem clique é simulado; o toque seguinte é de verdade.
  await tel.locator('[data-ed="corB"]').tap();
  await tel.locator('.nx-pop.nx-cor').waitFor();
  await tel.evaluate(() => {
    window.__cliques.length = 0;
    document.querySelector('.nx-pop-fundo').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerType: 'touch' }));
  });
  await tel.locator('.nx-pop.nx-cor').waitFor({ state: 'detached' });
  await tel.touchscreen.tap(20, 20);
  await esperarAte(async () => (await tel.evaluate(() => window.__cliques.length)) >= 1, 'o toque seguinte a um toque sem clique foi engolido', 3000);
  console.log('PASS: no celular o seletor vira uma folha embaixo, cabe de 320 a 390 px e fecha pelo toque no fundo, sem clicar no que estava por baixo');

  assert.deepEqual(erros, []);
  console.log('PASS: nenhum erro nas páginas');
})().then(async () => {
  await navegador?.close();
  await instancia?.encerrar();
}).catch(async erro => {
  console.error(erro);
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
  process.exit(1);
});
