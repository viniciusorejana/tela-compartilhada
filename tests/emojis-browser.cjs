// O seletor de emojis, e os lugares onde ele entrou: a frase do status (no lugar do campo com o controle de
// videogame de exemplo), as reações das mensagens do chat, as reações da plateia, o campo do chat da sala, as
// mensagens diretas e os campos de texto do perfil -- e NÃO o canal de música, onde se pede música.
//
// O que se prova aqui é o que a pessoa faz: abrir, buscar sem acento, andar pelo teclado, escolher, o tom de
// pele e os usados por último que ficam, o que cada lugar faz com o emoji escolhido, e o painelzinho se
// comportar (Esc fecha só ele, por cima de um painel da sala, no celular uma folha). A regra do servidor
// (qualquer emoji, e só emoji) tem o teste dela em tests/emojis.test.js.
//
// Sem servidor de mídia: o chat e a sinalização bastam.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const porta = 3240;
const origem = `http://localhost:${porta}`;
const saida = path.join(__dirname, '..', 'test-results', 'emojis');
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
const TOM_DE_PELE = /[\u{1F3FB}-\u{1F3FF}]/u;

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  const ana = await instancia.conta('anaemojis', { apelido: 'Ana' });
  const bia = await instancia.conta('biaemojis', { apelido: 'Bia' });
  const pedir = async (de, alvo) => {
    const { csrf } = await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: de.cookie } })).json();
    return fetch(`${origem}/api/conta/amigos`, { method: 'POST', headers: { Origin: origem, 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf, Cookie: de.cookie }, body: JSON.stringify({ alvo }) });
  };
  for (const [de, alvo, esperado] of [[ana, '@biaemojis', 201], [bia, '@anaemojis', 200]]) assert.equal((await pedir(de, alvo)).status, esperado);
  const social = async quem => (await (await fetch(`${origem}/api/conta/eu`, { headers: { Cookie: quem.cookie } })).json()).perfil.social;

  navegador = await chromium.launch({ headless: true });
  const comConta = async (quem, opcoes = { viewport: { width: 1360, height: 900 } }) => {
    const contexto = await navegador.newContext(opcoes);
    await contexto.addCookies([{ name: 'nexo_conta', value: quem.cookie.split('=')[1], url: origem }]);
    return contexto;
  };
  const contextoDaAna = await comConta(ana);
  const contextoDaBia = await comConta(bia);

  // ---------- O seletor, pela frase do status ----------
  const inicio = observar(await contextoDaAna.newPage(), 'Ana no início');
  await inicio.goto(`${origem}/?secao=perfil`);
  await inicio.locator('.ed-previa-cartao .nx-cartao').waitFor();
  await inicio.locator('.ed-abas [data-parte="status"]').click();
  const botaoDoEmoji = inicio.locator('[data-ed="fraseEmojiBtn"]');
  const seletor = inicio.locator('.nx-pop.nx-emo-pop');
  assert.equal(await inicio.locator('[data-ed="fraseEmoji"]').getAttribute('type'), 'hidden', 'o valor do emoji fica num campo escondido');
  assert.equal(await inicio.locator('.ed-frase input[placeholder="🎮"]').count(), 0, 'o campo com o controle de videogame de exemplo não existe mais');
  assert.equal(await botaoDoEmoji.locator('svg').count(), 1, 'sem emoji, o botão mostra a carinha');
  assert.equal(await inicio.locator('[data-ed="fraseEmojiTirar"]').isHidden(), true);
  await botaoDoEmoji.click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  assert.equal(await seletor.getAttribute('role'), 'group', 'não é role="dialog": a sala não congela');
  assert.equal(await botaoDoEmoji.getAttribute('aria-expanded'), 'true');
  assert.equal(await inicio.evaluate(() => document.activeElement?.classList.contains('nx-emo-campo')), true, 'o foco entra na busca');
  const total = await seletor.locator('.nx-emo-item').count();
  assert.ok(total > 1000, `todos os emojis que o aparelho desenha (${total})`);
  const grupos = await seletor.locator('.nx-emo-secao:not([hidden]) .nx-emo-titulo').allTextContents();
  assert.ok(grupos.includes('Carinhas e emoções') && grupos.includes('Pessoas e corpo') && grupos.includes('Símbolos'), `as categorias: ${grupos.join(' | ')}`);
  assert.equal(await seletor.locator('.nx-emo-secao[data-grupo="recentes"]').isHidden(), true, 'sem uso, não há "usados por último"');
  assert.equal(await seletor.locator('.nx-emo-tom').count(), 6, 'o tom padrão e os cinco de pele');
  await seletor.screenshot({ path: path.join(saida, 'seletor.png') });

  // A busca olha o nome e as palavras, em português e sem acento; o vermelho vem antes dos outros corações.
  const buscar = async texto => { await seletor.locator('.nx-emo-campo').fill(texto); await inicio.waitForTimeout(150); };
  const resultados = () => seletor.locator('.nx-emo-resultados .nx-emo-item').evaluateAll(l => l.map(e => e.textContent));
  await buscar('coracao');
  assert.equal((await resultados())[0], '❤️', 'corações: o vermelho primeiro');
  await buscar('polegar');
  assert.ok((await resultados()).includes('👍'), 'o nome em português acha o emoji');
  await buscar('beleza');
  assert.ok((await resultados()).includes('👍'), 'as palavras-chave também (sem acento e fora do nome)');
  await buscar('foguete');
  assert.equal((await resultados())[0], '🚀');
  await buscar('rosto feliz');
  assert.ok((await resultados()).length > 3, 'várias palavras: todas precisam estar');
  await buscar('xyzxyzxyz');
  assert.match(await seletor.locator('.nx-emo-vazio').textContent(), /Nenhum emoji para “xyzxyzxyz”/);
  assert.equal(await seletor.locator('.nx-emo-secoes').isHidden(), true, 'com busca, as categorias saem de cena');
  await seletor.locator('.nx-emo-limpar').click();
  assert.equal(await seletor.locator('.nx-emo-campo').inputValue(), '');
  assert.equal(await seletor.locator('.nx-emo-secoes').isVisible(), true, 'limpar a busca traz as categorias de volta');
  console.log('PASS: o seletor abre com a busca em foco, mostra as categorias e a busca acha por nome e palavra, em português e sem acento');

  // O teclado: Enter na busca escolhe o primeiro resultado; as setas andam pela grade.
  await seletor.locator('.nx-emo-campo').press('ArrowDown');
  const primeiroDaGrade = await inicio.evaluate(() => document.activeElement?.textContent);
  assert.equal(await inicio.evaluate(() => document.activeElement?.classList.contains('nx-emo-item')), true, 'seta para baixo na busca desce para a grade');
  await inicio.keyboard.press('ArrowRight');
  assert.notEqual(await inicio.evaluate(() => document.activeElement?.textContent), primeiroDaGrade, 'a seta para a direita anda');
  const colunaAntes = await inicio.evaluate(() => Math.round(document.activeElement.getBoundingClientRect().left));
  await inicio.keyboard.press('ArrowDown');
  assert.equal(await inicio.evaluate(() => Math.round(document.activeElement.getBoundingClientRect().left)), colunaAntes, 'para baixo fica na mesma coluna');
  await inicio.keyboard.press('ArrowUp');
  await inicio.keyboard.press('ArrowLeft');
  await inicio.keyboard.press('ArrowUp');
  assert.equal(await inicio.evaluate(() => document.activeElement?.classList.contains('nx-emo-campo')), true, 'seta para cima na primeira linha volta à busca');
  // Digitar e apertar Enter no mesmo instante, antes de o filtro (que espera 60 ms) rodar: o Enter tem de
  // escolher da busca que acabou de ser digitada, e não da lista que estava na tela. Tudo num passo só da
  // página, para a corrida ser sempre a mesma e não depender da pressa do teste.
  await inicio.evaluate(() => {
    const campo = document.querySelector('.nx-emo-campo');
    campo.value = 'foguete';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await seletor.waitFor({ state: 'detached' });
  assert.equal(await botaoDoEmoji.textContent(), '🚀', 'o botão mostra o escolhido');
  assert.equal(await inicio.locator('[data-ed="fraseEmoji"]').inputValue(), '🚀');
  assert.equal(await inicio.evaluate(() => document.activeElement?.getAttribute('data-ed')), 'fraseTexto', 'o foco segue para a frase, que é o que vem depois');
  assert.equal(await inicio.locator('[data-ed="fraseEmojiTirar"]').isVisible(), true, 'e há como tirar o emoji');
  console.log('PASS: o teclado anda pela grade (setas, Enter na busca escolhe o primeiro) e o emoji escolhido vai para o botão da frase');

  // O emoji escolhido e ainda não salvo não some quando o editor se repinta (o status mudou, por exemplo).
  await inicio.locator('.ed-status-opcao', { hasText: 'Ausente' }).click();
  await esperarAte(async () => (await social(ana)).status === 'ausente', 'o status não mudou');
  assert.equal(await botaoDoEmoji.textContent(), '🚀', 'o emoji escolhido continua depois de um repintar');
  await inicio.locator('.ed-status-opcao', { hasText: 'Disponível' }).click();
  await inicio.locator('[data-ed="fraseTexto"]').fill('em lançamento');
  await inicio.locator('[data-ed="salvarFrase"]').click();
  await esperarAte(async () => (await social(ana)).frase?.emoji === '🚀', 'o servidor não recebeu o emoji da frase');
  assert.deepEqual({ emoji: (await social(ana)).frase.emoji, texto: (await social(ana)).frase.texto }, { emoji: '🚀', texto: 'em lançamento' });
  assert.match(await inicio.locator('#euStatus').textContent(), /🚀 em lançamento/, 'a lateral mostra a frase com o emoji');
  // Tirar o emoji e salvar guarda só o texto.
  await inicio.locator('[data-ed="fraseEmojiTirar"]').click();
  assert.equal(await botaoDoEmoji.locator('svg').count(), 1);
  await inicio.locator('[data-ed="salvarFrase"]').click();
  await esperarAte(async () => !(await social(ana)).frase?.emoji, 'o emoji não saiu da frase');
  assert.equal((await social(ana)).frase.texto, 'em lançamento');
  console.log('PASS: o emoji da frase vai para o servidor, sobrevive a um repintar enquanto não é salvo e sai quando a pessoa o tira');

  // Os usados por último, o tom de pele (que ficam entre as aberturas e as páginas) e o Shift.
  await botaoDoEmoji.click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  assert.equal(await seletor.locator('.nx-emo-secao[data-grupo="recentes"] .nx-emo-item').first().textContent(), '🚀', 'o último usado vem primeiro');
  assert.equal(await seletor.locator('.nx-emo-aba[data-alvo="recentes"]').isVisible(), true, 'e a aba dos usados aparece');
  await seletor.locator('.nx-emo-tom').nth(3).click();
  await buscar('polegar');
  const polegar = seletor.locator('.nx-emo-resultados .nx-emo-item', { hasText: '👍' }).first();
  assert.match(await polegar.textContent(), TOM_DE_PELE, 'com um tom escolhido, as mãos saem na pele dele');
  assert.equal(await seletor.locator('.nx-emo-resultados .nx-emo-item', { hasText: '🚀' }).count(), 0, 'e o foguete (que não tem tom) não aparece na busca por polegar');
  const comTom = await polegar.textContent();
  await polegar.click({ modifiers: ['Shift'] });
  assert.equal(await seletor.count(), 1, 'Shift+clique escolhe e deixa aberto');
  assert.equal(await inicio.locator('[data-ed="fraseEmoji"]').inputValue(), comTom, 'e o emoji escolhido tem o tom');
  await seletor.locator('.nx-emo-limpar').click();
  assert.equal(await seletor.locator('.nx-emo-secao[data-grupo="recentes"] .nx-emo-item').first().textContent(), comTom, 'o usado por último guarda o tom que foi escolhido');
  await inicio.keyboard.press('Escape');
  await seletor.waitFor({ state: 'detached' });
  await inicio.reload();
  await inicio.locator('.ini-secao[data-secao="perfil"]').click();
  await inicio.locator('.ed-abas [data-parte="status"]').click();
  await botaoDoEmoji.click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  assert.equal(await seletor.locator('.nx-emo-tom').nth(3).getAttribute('aria-checked'), 'true', 'o tom de pele escolhido fica, mesmo recarregando a página');
  assert.equal(await seletor.locator('.nx-emo-secao[data-grupo="recentes"] .nx-emo-item').first().textContent(), comTom, 'os usados por último também');
  await seletor.locator('.nx-emo-tom').nth(0).click();
  await inicio.keyboard.press('Escape');
  console.log('PASS: os usados por último e o tom de pele ficam (inclusive depois de recarregar), o tom vale na grade e na busca, e Shift+clique deixa aberto');

  // ---------- Os campos de texto do perfil ----------
  await inicio.locator('.ed-abas [data-parte="sobre"]').click();
  await inicio.locator('[data-ed="bio"]').fill('Jogo à noite  e de manhã');
  // O cursor fica entre os dois espaços: o emoji entra ali, e não no fim.
  await inicio.locator('[data-ed="bio"]').evaluate(el => { el.focus(); el.setSelectionRange(13, 13); });
  await inicio.locator('[data-ed="bioEmoji"] button').click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  await buscar('lua');
  await seletor.locator('.nx-emo-resultados .nx-emo-item').first().click();
  const bio = await inicio.locator('[data-ed="bio"]').inputValue();
  assert.match(bio, /^Jogo à noite \S+ e de manhã$/u, `o emoji entrou onde estava o cursor: ${JSON.stringify(bio)}`);
  assert.equal(await inicio.evaluate(() => document.activeElement?.getAttribute('data-ed')), 'bio', 'e o foco voltou ao campo');
  await esperarAte(async () => (await inicio.locator('.ed-previa-cartao .nx-cartao-bio').textContent()).includes([...bio].find(c => /\p{Extended_Pictographic}/u.test(c))), 'a prévia não mostrou o emoji da descrição');
  await inicio.locator('[data-ed="pensamentoEmoji"] button').click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  await buscar('foguete');
  await seletor.locator('.nx-emo-resultados .nx-emo-item').first().click();
  assert.match(await inicio.locator('[data-ed="pensamento"]').inputValue(), /🚀/);
  // Cheio, não cabe: nada acontece em vez de cortar o emoji ao meio.
  await inicio.locator('[data-ed="pensamento"]').fill('x'.repeat(69));
  await inicio.locator('[data-ed="pensamentoEmoji"] button').click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  await buscar('foguete');
  await seletor.locator('.nx-emo-resultados .nx-emo-item').first().click();
  assert.equal(await inicio.locator('[data-ed="pensamento"]').inputValue(), 'x'.repeat(69), 'sem espaço no maxlength, o emoji não entra (e não é cortado ao meio)');
  console.log('PASS: o botão do campo de texto do perfil põe o emoji onde está o cursor, devolve o foco, refaz a prévia e respeita o limite');

  // ---------- As mensagens diretas ----------
  await inicio.locator('.ini-secao[data-secao="amigos"]').click();
  await inicio.waitForFunction(() => NexoSocial.estado.amigos.amigos.length === 1, null, { timeout: 10000 });
  await inicio.locator('#abasAmigos [data-aba="todos"]').click();
  await inicio.locator('#listaAmigos .nx-amigo', { hasText: 'Bia' }).click();
  await inicio.locator('#cartaoModal:not([hidden])').waitFor();
  await inicio.locator('#cartaoModal .nx-cartao-acoes button', { hasText: 'Mensagem' }).click();
  await inicio.locator('.nx-dm-compor textarea').waitFor();
  const emojiDaConversa = inicio.locator('.nx-dm-compor .nx-dm-anexar[aria-haspopup="true"]');
  assert.equal(await emojiDaConversa.count(), 1, 'a conversa direta tem o botão de emoji');
  await inicio.locator('.nx-dm-compor textarea').fill('oi Bia ');
  await emojiDaConversa.click();
  await seletor.locator('.nx-emo-item').first().waitFor();
  await buscar('festa');
  await seletor.locator('.nx-emo-resultados .nx-emo-item').first().click();
  const textoDaMensagem = await inicio.locator('.nx-dm-compor textarea').inputValue();
  assert.match(textoDaMensagem, /^oi Bia \S+$/u, textoDaMensagem);
  assert.equal(await inicio.evaluate(() => document.activeElement?.tagName), 'TEXTAREA', 'o foco volta ao campo da mensagem');
  await inicio.locator('.nx-dm-compor textarea').press('Enter');
  await inicio.locator('.nx-dm-msg-texto', { hasText: textoDaMensagem.trim() }).waitFor();
  console.log('PASS: a conversa direta tem o seletor: o emoji entra na mensagem e segue com ela');

  // ---------- Na sala: o chat, as reações da mensagem e as da plateia ----------
  const SALA = 'sala-dos-emojis';
  const entrar = async (contexto, nome) => {
    const pagina = observar(await contexto.newPage(), nome);
    await pagina.goto(`${origem}/${SALA}/sala`);
    await pagina.evaluate(() => window.NexoConta?.pronto);
    await pagina.locator('#nameConfirmBtn').click();
    await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
    return pagina;
  };
  const salaDaAna = await entrar(contextoDaAna, 'Ana na sala');
  const salaDaBia = await entrar(contextoDaBia, 'Bia na sala');
  const seletorDaBia = salaDaBia.locator('.nx-pop.nx-emo-pop');
  const seletorDaAna = salaDaAna.locator('.nx-pop.nx-emo-pop');

  // O chat: o botão está ao lado do campo; o canal de música não tem.
  assert.equal(await salaDaAna.locator('#chatEmojiBtn').isVisible(), true);
  assert.equal(await salaDaAna.locator('#musicaPanel #chatEmojiBtn, #musicaPanel .nx-emo-botao, #musicaPanel [aria-haspopup="true"]').count(), 0, 'o canal de música não tem seletor de emoji');
  await salaDaAna.locator('#chatInput').fill('bora jogar  hoje');
  await salaDaAna.locator('#chatInput').evaluate(el => { el.focus(); el.setSelectionRange(11, 11); });
  await salaDaAna.locator('#chatEmojiBtn').click();
  await seletorDaAna.locator('.nx-emo-item').first().waitFor();
  assert.equal(await salaDaAna.evaluate(() => document.querySelector('.app').inert), false, 'o seletor não congela a sala');
  await seletorDaAna.locator('.nx-emo-campo').fill('controle');
  await salaDaAna.waitForTimeout(150);
  await seletorDaAna.locator('.nx-emo-resultados .nx-emo-item').first().click();
  const noChat = await salaDaAna.locator('#chatInput').inputValue();
  assert.match(noChat, /^bora jogar \S+ {1,2}hoje$/u, `o emoji entrou onde estava o cursor: ${JSON.stringify(noChat)}`);
  assert.equal(await salaDaAna.evaluate(() => document.activeElement?.id), 'chatInput', 'o foco voltou ao campo do chat');
  await salaDaAna.locator('#chatSend').click();
  await salaDaBia.locator('.msg-texto', { hasText: 'bora jogar' }).waitFor();
  assert.match(await salaDaBia.locator('.msg-texto', { hasText: 'bora jogar' }).textContent(), /\p{Extended_Pictographic}/u, 'a mensagem chega com o emoji');
  // O limite do campo: cheio, o emoji não entra.
  await salaDaAna.locator('#chatInput').fill('a'.repeat(1999));
  await salaDaAna.locator('#chatEmojiBtn').click();
  await seletorDaAna.locator('.nx-emo-item').first().waitFor();
  await seletorDaAna.locator('.nx-emo-item').nth(3).click();
  assert.equal((await salaDaAna.locator('#chatInput').inputValue()).length, 1999, 'no limite do campo, o emoji não entra');
  await salaDaAna.locator('#chatInput').fill('');
  console.log('PASS: o chat da sala tem o seletor (o canal de música não): o emoji entra no cursor, o foco volta ao campo, a mensagem chega e o limite vale');

  // As reações da mensagem: o "+" do menu abre o seletor, e qualquer emoji vira reação.
  const mensagem = salaDaBia.locator('.msg', { hasText: 'bora jogar' }).first();
  const reacoesDe = (pagina, emoji) => pagina.locator('.msg', { hasText: 'bora jogar' }).first().locator(`.msg-reactions button[data-emoji="${emoji}"]`);
  assert.equal(await mensagem.locator('.msg-reactions').count(), 0, 'sem reações, não há fileira nem o "+" dela');
  await mensagem.hover();
  await mensagem.locator('[data-chat-action="abrir-reacoes"]').click();
  assert.equal(await salaDaBia.locator('#chatMsgMenu .msg-menu-emoji').count(), 6, 'os cinco de sempre e o "+"');
  assert.equal(await salaDaBia.locator('#chatMsgMenu [data-menu-action="mais-emojis"]').getAttribute('aria-label'), 'Reagir com outro emoji');
  await salaDaBia.locator('#chatMsgMenu [data-menu-action="mais-emojis"]').click();
  await seletorDaBia.locator('.nx-emo-item').first().waitFor();
  assert.equal(await salaDaBia.locator('#chatMsgMenu.hidden').count(), 1, 'o menu rápido fecha quando o seletor abre');
  await seletorDaBia.locator('.nx-emo-campo').fill('foguete');
  await salaDaBia.waitForTimeout(150);
  await seletorDaBia.locator('.nx-emo-resultados .nx-emo-item').first().click();
  await reacoesDe(salaDaBia, '🚀').waitFor();
  await reacoesDe(salaDaAna, '🚀').waitFor();
  assert.equal((await reacoesDe(salaDaAna, '🚀').textContent()).trim(), '🚀 1', 'a reação com um emoji que a lista de cinco nunca deixou passar chega às duas pessoas');
  assert.equal(await reacoesDe(salaDaBia, '🚀').evaluate(el => el.classList.contains('minha')), true, 'e a minha vem marcada');
  // O "+" no fim da fileira acrescenta outra; reagir de novo com a mesma tira a minha.
  await mensagem.locator('.msg-reactions .adicionar').click();
  await seletorDaBia.locator('.nx-emo-item').first().waitFor();
  await seletorDaBia.locator('.nx-emo-campo').fill('palmas');
  await salaDaBia.waitForTimeout(150);
  const palmas = await seletorDaBia.locator('.nx-emo-resultados .nx-emo-item').first().textContent();
  await seletorDaBia.locator('.nx-emo-resultados .nx-emo-item').first().click();
  await reacoesDe(salaDaAna, palmas).waitFor();
  await reacoesDe(salaDaBia, '🚀').click();
  await reacoesDe(salaDaAna, '🚀').waitFor({ state: 'detached' });
  await reacoesDe(salaDaBia, '🚀').waitFor({ state: 'detached' });
  assert.equal(await reacoesDe(salaDaBia, '🚀').count() + await reacoesDe(salaDaAna, '🚀').count(), 0, 'reagir de novo com o mesmo emoji tira a reação, e o emoji sai da fileira');
  await salaDaBia.screenshot({ path: path.join(saida, 'reacoes-da-mensagem.png') });
  console.log('PASS: as reações da mensagem aceitam qualquer emoji: o "+" do menu e o "+" da fileira abrem o seletor, e a reação chega às duas pessoas');

  // As reações da plateia: o "+" do menu de status e reações.
  await salaDaBia.locator('#presenceBtn').click();
  assert.equal(await salaDaBia.locator('#presenceMenu .presence-reactions button').count(), 6, 'as cinco de sempre e o "+"');
  await salaDaBia.locator('#presenceMais').click();
  await seletorDaBia.locator('.nx-emo-item').first().waitFor();
  assert.equal(await salaDaBia.locator('#presenceMenu.hidden').count(), 1, 'o menu de status fecha quando o seletor abre');
  await seletorDaBia.locator('.nx-emo-campo').fill('danca');
  await salaDaBia.waitForTimeout(150);
  const festa = await seletorDaBia.locator('.nx-emo-resultados .nx-emo-item').first().textContent();
  await seletorDaBia.locator('.nx-emo-resultados .nx-emo-item').first().click();
  await salaDaAna.waitForFunction(emoji => document.querySelector('.room-reaction')?.getAttribute('aria-label') === `Bia reagiu com ${emoji}`, festa, { timeout: 6000 });
  assert.equal(await salaDaAna.locator('.room-reaction .room-reaction-emoji').first().textContent(), festa, 'a reação voa na tela da Ana com o emoji que a Bia escolheu');
  console.log('PASS: a reação da plateia aceita qualquer emoji: o "+" do menu abre o seletor e a reação voa na tela de todos');

  // ---------- Esc, por cima de um painel, e o erro de carregar ----------
  await salaDaAna.evaluate(() => NexoSalaSocial.abrirEditor('status'));
  await salaDaAna.locator('#editorCartaoSala [data-ed="fraseEmojiBtn"]').waitFor();
  await salaDaAna.locator('#editorCartaoSala [data-ed="fraseEmojiBtn"]').click();
  await seletorDaAna.locator('.nx-emo-item').first().waitFor();
  assert.equal(await salaDaAna.evaluate(() => { const p = document.querySelector('.nx-pop.nx-emo-pop'); const r = p.getBoundingClientRect(); return p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), true, 'o seletor está por cima do painel do editor');
  await salaDaAna.keyboard.press('Escape');
  await seletorDaAna.waitFor({ state: 'detached' });
  assert.equal(await salaDaAna.locator('#editorCartaoPanel').evaluate(el => !el.classList.contains('hidden')), true, 'o Esc fecha só o seletor: o painel continua');
  await salaDaAna.locator('#editorCartaoPanel .modal-fechar').click();

  const semRede = observar(await contextoDaBia.newPage(), 'Bia sem a lista');
  await semRede.route('**/emojis.json', rota => rota.abort());
  await semRede.goto(`${origem}/?secao=perfil`);
  await semRede.locator('.ed-abas [data-parte="status"]').click();
  await semRede.locator('[data-ed="fraseEmojiBtn"]').click();
  await semRede.locator('.nx-emo-estado', { hasText: 'Não foi possível carregar os emojis.' }).waitFor();
  await semRede.unroute('**/emojis.json');
  await semRede.locator('.nx-emo-tentar').click();
  await semRede.locator('.nx-pop.nx-emo-pop .nx-emo-item').first().waitFor();
  assert.ok(await semRede.locator('.nx-emo-item').count() > 1000, 'a segunda tentativa carregou');
  await semRede.close();
  console.log('PASS: o Esc fecha só o seletor (o painel de onde veio continua), e sem a lista dá para tentar de novo');

  // ---------- No celular: a folha ----------
  const contextoDoTel = await comConta(bia, {
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const tel = observar(await contextoDoTel.newPage(), 'Bia no celular');
  await tel.goto(`${origem}/?secao=perfil`);
  await tel.locator('.ed-abas [data-parte="status"]').tap();
  await tel.locator('[data-ed="fraseEmojiBtn"]').tap();
  const folha = tel.locator('.nx-pop.nx-emo-pop');
  await folha.locator('.nx-emo-item').first().waitFor();
  await tel.waitForTimeout(400);
  assert.equal(await tel.evaluate(() => document.activeElement?.classList.contains('nx-emo-campo')), false, 'no toque o teclado da tela não sobe sozinho');
  for (const largura of [390, 320]) {
    await tel.setViewportSize({ width: largura, height: 700 });
    await tel.waitForTimeout(200);
    const caixa = await folha.boundingBox();
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura && caixa.y >= 0 && caixa.y + caixa.height <= 700, `a folha cabe na tela de ${largura} px: ${JSON.stringify(caixa)}`);
    assert.ok(caixa.y + caixa.height >= 700 - 20, `e fica embaixo, ao alcance do polegar (${largura} px)`);
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolar de lado em ${largura} px`);
    // Os emojis têm tamanho de toque.
    const lado = (await folha.locator('.nx-emo-item').first().boundingBox()).width;
    assert.ok(lado >= 38, `cada emoji tem tamanho de toque (${Math.round(lado)} px em ${largura} px)`);
  }
  await tel.screenshot({ path: path.join(saida, 'celular.png') });
  await folha.locator('.nx-emo-item').nth(2).tap();
  await folha.waitFor({ state: 'detached' });
  assert.equal(await tel.locator('[data-ed="fraseEmoji"]').inputValue() !== '', true, 'tocar num emoji escolhe');
  console.log('PASS: no celular o seletor é uma folha embaixo, cabe de 320 a 390 px, tem emojis do tamanho do toque e escolhe pelo toque');

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
