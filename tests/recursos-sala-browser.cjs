// Fluxos de produto que cruzam HTTP, Socket.IO e interface: chat rico, presença e sala
// trancada. Roda sem servidor de mídia; assim o teste observa exatamente a camada que
// implementa estes recursos e termina rápido.
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3222;
const origem = `http://localhost:${porta}`;
const sala = 'recursos-sala';
let instancia, servidor, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

async function entrar(contexto, nome) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/${sala}/sala`);
  await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  return pagina;
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  servidor = instancia.filho;
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contextoA = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const contextoB = await navegador.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
  });
  const dono = await entrar(contextoA, 'Dono');
  const convidado = await entrar(contextoB, 'Convidado');
  assert.equal(await dono.locator('#dataSaverField').isHidden(), true);

  // Os avisos sonoros passam por um espião: o que se testa é QUANDO a sala pede um som, e não
  // o som em si, que o navegador sem tela nem toca.
  const espiarSons = pagina => pagina.evaluate(() => {
    window.sonsPedidos = [];
    const tocar = NexoSons.tocar;
    NexoSons.tocar = (tipo, opcoes) => { sonsPedidos.push(tipo); return tocar(tipo, opcoes); };
  });
  await espiarSons(dono);
  await espiarSons(convidado);

  await dono.locator('#chatInput').fill('Olá @Convidado');
  await dono.locator('#chatSend').click();
  await convidado.waitForFunction(() => [...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes('Olá @Convidado')));
  assert.equal(await convidado.locator('.msg.mencionou').count(), 1);
  assert.deepEqual(await convidado.evaluate(() => sonsPedidos), ['mencao'], 'a mensagem que menciona você toca o sino, no lugar do som de mensagem');
  assert.deepEqual(await dono.evaluate(() => sonsPedidos), [], 'a própria, não');
  // Ensurdecido, a sala fica em silêncio -- mas o próprio gesto soa: ensurdecer sem ouvir o som
  // de ensurdecer seria apertar um botão sem saber se pegou. E um aviso desligado não toca.
  assert.deepEqual(await convidado.evaluate(() => {
    sonsPedidos.length = 0;
    deafenBtn.click();
    const surdo = NexoSons.tocar('entrada');
    deafenBtn.click();
    const gestos = [...sonsPedidos];
    NexoSons.definir({ entrada: false });
    const desligado = NexoSons.tocar('entrada');
    NexoSons.definir({ entrada: true });
    return { surdo, gestos, desligado, guardado: Preferencias.lerAjuste('sons', 'nada') };
  }), { surdo: false, gestos: ['surdo', 'entrada', 'ouvir'], desligado: false, guardado: 'nada' });

  // O relógio da sala: ao lado de "NO SQUAD" e, com um clique, o tempo de cada pessoa.
  assert.match(await dono.locator('#tempoLateralTexto').textContent(), /^\d+:\d{2}$/);
  await dono.locator('#tempoLateralBtn').click();
  await dono.locator('#tempoSalaMenu:not(.hidden)').waitFor();
  assert.match(await dono.locator('#tempoSalaTitulo').textContent(), /^Sala aberta há /);
  assert.match(await dono.locator('#tempoSalaLista').textContent(), /Dono \(você\)/);
  assert.match(await dono.locator('#sessionClock').textContent(), /^Você está há \d+:\d{2}$/);
  await dono.keyboard.press('Escape');
  assert.equal(await dono.locator('#tempoSalaMenu.hidden').count(), 1);

  await convidado.locator('#chatToggle').click();
  assert.ok(await convidado.locator('#chatInput').evaluate(el => el.getBoundingClientRect().height < 80));
  await convidado.locator('#chatInput').click();
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');
  await convidado.evaluate(() => window.NexoMusica.abrir());
  assert.ok(await convidado.locator('#musicaInput').evaluate(el => el.getBoundingClientRect().height < 80));
  await convidado.locator('#musicaInput').click();
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'musicaInput');
  // Reagir, editar, excluir e fixar passam por um menu ancorado: a barra que flutua sobre a
  // mensagem tem três botões (reagir, responder e "mais"), e não os nove de antes, que
  // cobriam o nome e a citação da própria mensagem que se queria ler.
  await convidado.evaluate(() => window.abrirChat());
  await convidado.locator('[data-chat-action="abrir-reacoes"]').first().click();
  await convidado.locator('#chatMsgMenu [data-menu-action="reagir"][data-emoji="👍"]').click();
  await dono.waitForFunction(() => document.querySelector('.msg-reactions')?.textContent.includes('👍 1'));
  assert.equal(await convidado.locator('#chatMsgMenu.hidden').count(), 1);
  await convidado.locator('[data-chat-action="responder"]').first().click();
  await convidado.locator('#chatInput').fill('Recebido!');
  await convidado.locator('#chatSend').click();
  await dono.waitForFunction(() => document.querySelector('.msg-reply')?.textContent.includes('Dono'));
  convidado.once('dialog', dialogo => dialogo.accept());
  const recebida = convidado.locator('.msg').filter({ hasText: 'Recebido!' });
  await recebida.locator('[data-chat-action="abrir-mais"]').click();
  await convidado.locator('#chatMsgMenu [data-menu-action="excluir"]').click();
  await dono.waitForFunction(() => ![...document.querySelectorAll('.msg-texto')].some(e => e.textContent.includes('Recebido!')));
  await dono.locator('.msg').hover();
  await dono.locator('[data-chat-action="abrir-mais"]').click();
  await dono.locator('#chatMsgMenu [data-menu-action="editar"]').click();
  await dono.locator('#chatInput').fill('Mensagem editada');
  await dono.locator('#chatSend').click();
  await convidado.waitForFunction(() => document.querySelector('.msg-texto')?.textContent.includes('Mensagem editada'));
  await dono.locator('.msg').hover();
  await dono.locator('[data-chat-action="abrir-mais"]').click();
  await dono.locator('#chatMsgMenu [data-menu-action="fixar"]').click();
  await convidado.waitForFunction(() => !document.getElementById('chatPinnedBar').hidden);

  // Com MAIS DE UMA fixada, quem clica no alfinete quer escolher. A versão anterior
  // percorria a lista às cegas -- um item por clique, sem nunca dizer quantos eram.
  await dono.locator('#chatInput').fill('Outra para fixar');
  await dono.locator('#chatSend').click();
  await dono.locator('.msg').filter({ hasText: 'Outra para fixar' }).hover();
  await dono.locator('.msg').filter({ hasText: 'Outra para fixar' }).locator('[data-chat-action="abrir-mais"]').click();
  await dono.locator('#chatMsgMenu [data-menu-action="fixar"]').click();
  await dono.waitForFunction(() => Number(document.getElementById('chatPinsCount').textContent) === 2);
  await dono.locator('#chatPinsBtn').click();
  await dono.locator('#chatPinsList:not(.hidden)').waitFor();
  assert.equal(await dono.locator('#chatPinsList .pin-item').count(), 2);
  await dono.locator('#chatPinsList .pin-ir').first().click();
  assert.equal(await dono.locator('#chatPinsList.hidden').count(), 1);
  // Soltar o alfinete pela própria lista: caçar a mensagem no meio da conversa só para
  // desafixá-la é o caminho longo, e é dali que se vê o conjunto.
  await dono.locator('#chatPinsBtn').click();
  await dono.locator('#chatPinsList .pin-soltar').last().click();
  await dono.waitForFunction(() => Number(document.getElementById('chatPinsCount').textContent) === 1);
  // Uma fixada só não vira lista de um item: o clique leva direto até ela.
  assert.equal(await dono.locator('#chatPinsList.hidden').count(), 1);
  // Os ícones são DESENHADOS. "☺", "↩" e "⋯" são caracteres, e cada fonte os entrega num
  // tamanho e numa altura de linha diferentes: num botão de 27px saíam minúsculos e tortos.
  assert.equal(await dono.locator('[data-chat-action="abrir-reacoes"] svg').first().count(), 1);
  assert.equal(await dono.locator('[data-chat-action="abrir-reacoes"]').first().evaluate(el => el.textContent.trim()), '');

  await convidado.locator('#chatClose').click();
  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('#presenceBtn').click();
  await convidado.locator('[data-presence="hand"]').click();
  assert.equal(await convidado.evaluate(() => presencaLocal), 'hand');
  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('#presenceBtn').click();
  await convidado.locator('[data-reaction="👏"]').click();
  await dono.waitForFunction(() => document.querySelector('.room-reaction')?.getAttribute('aria-label') === 'Convidado reagiu com 👏');
  // A reação sai em duas camadas porque a subida e a deriva lateral precisam de curvas de
  // tempo diferentes -- com uma só, todas sobem no mesmo trilho, na mesma hora.
  assert.equal(await dono.locator('.room-reaction .room-reaction-emoji').count(), 1);
  await dono.waitForFunction(() => !document.querySelector('.room-reaction'), null, { timeout: 6000 });

  // A presença de OUTRA pessoa não pode apagar a MINHA marcação: a versão anterior
  // desmarcava os cinco botões sempre que qualquer presença chegava pela sinalização, e o
  // status escolhido sumia da lista por conta de alguém do outro lado pedir a palavra.
  await dono.evaluate(() => socket.emit('sinal-presenca', { presenca: 'brb' }));
  await convidado.waitForFunction(() => [...presencasPorIdentidade.values()].includes('brb'), null, { timeout: 5000 });
  assert.equal(await convidado.locator('#presenceMenu [data-presence="hand"].ativo').count(), 1);
  // O menu nasce ancorado no botão que o abriu, e não a uma distância fixa da quina da tela:
  // com a barra lateral recolhida ele boiava sozinho no meio da página.
  assert.ok(await dono.evaluate(() => {
    presenceBtn.click();
    const menu = presenceMenu.getBoundingClientRect();
    const botao = presenceBtn.getBoundingClientRect();
    presenceBtn.click();
    return Math.abs(menu.left - botao.left) < 2 && menu.bottom <= botao.top && menu.top > 0;
  }));
  // O menu de status é um popover, não um modal. Enquanto ele carregava `role="dialog"`,
  // room-ui.js o tratava como tal e marcava a sala inteira como `inert` -- e `inert` NÃO
  // move o foco de onde ele está: quem tinha o cursor no campo do chat o via piscando num
  // campo que não aceitava mais nenhuma tecla. Era o "não consigo editar" intermitente.
  assert.equal(await dono.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some(d => d.id === 'presenceMenu')), false);
  assert.deepEqual(await dono.evaluate(async () => {
    const app = document.querySelector('.app');
    chatInput.focus();
    presenceBtn.click();
    await new Promise(r => requestAnimationFrame(r));
    const comMenuAberto = app.inert;
    presenceBtn.click();
    await new Promise(r => requestAnimationFrame(r));
    return { comMenuAberto, depois: app.inert };
  }), { comMenuAberto: false, depois: false });
  // Editar leva o cursor para o FIM do texto: no começo, a primeira tecla parece sobrescrever
  // o que já estava lá.
  await dono.locator('.msg').first().hover();
  await dono.locator('[data-chat-action="abrir-mais"]').first().click();
  await dono.locator('#chatMsgMenu [data-menu-action="editar"]').click();
  assert.deepEqual(await dono.evaluate(() => ({
    foco: document.activeElement?.id,
    cursorNoFim: chatInput.selectionStart === chatInput.value.length && chatInput.value.length > 0
  })), { foco: 'chatInput', cursorNoFim: true });
  await dono.locator('#chatContextClose').click();
  await dono.locator('#chatInput').fill('');

  await convidado.locator('#sidebarToggle').click();
  await convidado.locator('[data-action="devices"]').click();
  await convidado.locator('#abaQualidade').click();
  await convidado.locator('#dataSaver').check();
  assert.equal(await convidado.locator('.app.economia-dados').count(), 1);
  assert.equal(await convidado.locator('#videoQuality').isEnabled(), true);
  await convidado.locator('#videoQuality').selectOption('high');
  await convidado.locator('#abaAparelhos').click();
  await convidado.locator('#pushToTalk').check();
  assert.equal(await convidado.evaluate(() => pushToTalkAtivo), true);
  assert.ok(await convidado.evaluate(() => pushToTalk.getBoundingClientRect().top < outDevice.getBoundingClientRect().top));
  await convidado.locator('#devicesClose').click();
  await convidado.evaluate(() => window.fecharChat());
  await convidado.locator('#deafenBtn').click();
  await convidado.evaluate(() => window.abrirChat());
  await convidado.locator('#chatInput').click();
  await convidado.locator('#chatInput').pressSequentially('chat continua com foco');
  await convidado.waitForTimeout(1100);
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');
  assert.equal(await convidado.locator('#chatInput').inputValue(), 'chat continua com foco');
  await convidado.locator('#chatInput').fill('');
  await convidado.evaluate(() => deafenBtn.click());

  // Reproduz a corrida entre o MutationObserver que fecha um modal e a pessoa
  // tocando no compositor logo em seguida. O retorno tardio não pode roubar o foco.
  await convidado.evaluate(() => {
    devicesPanel.classList.remove('hidden');
  });
  await convidado.locator('#devicesPanel:not(.hidden)').waitFor();
  await convidado.evaluate(() => {
    devicesPanel.classList.add('hidden');
    chatInput.focus();
  });
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'chatInput');

  // Quem ocupa a coluna aqui é o chat (o `abrirChat` lá de cima), e no celular ele é gaveta por
  // cima da barra de controles: quem a fecha é `fecharChat`. `NexoMusica.fechar()` fecha só a
  // música, que não estava aberta -- e passava porque `sem-chat` escondia a coluna em toda
  // largura, até o deslize das colunas deixá-lo só para a tela larga (2.8 de docs/interface.md).
  await convidado.evaluate(() => window.fecharChat());
  await convidado.locator('#soundboardBtn').click();
  await convidado.locator('[data-close="soundboardPanel"]').click();
  await convidado.evaluate(() => window.NexoMusica.abrir());
  await convidado.locator('#musicaInput').click();
  await convidado.locator('#musicaInput').pressSequentially('pedido continua com foco');
  await convidado.waitForTimeout(1100);
  assert.equal(await convidado.evaluate(() => document.activeElement?.id), 'musicaInput');
  assert.equal(await convidado.locator('#musicaInput').inputValue(), 'pedido continua com foco');
  await convidado.locator('#musicaInput').fill('');
  // Ensurdecer tem de sobreviver à próxima atualização de mídia da sala. A primeira versão
  // varria o DOM apagando `muted` elemento a elemento, e `definirAudioDaVoz` -- que roda toda
  // vez que alguém liga a câmera ou o microfone -- reescrevia tudo de volta: o som voltava
  // sozinho, sem ninguém ter tocado no botão, e a pessoa só descobria sendo ouvida.
  assert.deepEqual(await convidado.evaluate(() => {
    const audio = tiles.get('self').peerAudio;
    deafenBtn.click();
    const durante = audio.muted;
    definirAudioDaVoz('self', { lembrar: false });
    const depoisDeAtualizarAMidia = audio.muted;
    deafenBtn.click();
    return { durante, depoisDeAtualizarAMidia, depois: audio.muted };
  }), { durante: true, depoisDeAtualizarAMidia: true, depois: false });
  // E o caminho inverso: quem foi calado individualmente continua calado quando o
  // ensurdecimento sai. O instantâneo por elemento apagava justamente essa escolha.
  assert.deepEqual(await convidado.evaluate(() => {
    const refs = tiles.get('self');
    refs.localMute = true;
    definirAudioDaVoz('self', { lembrar: false });
    deafenBtn.click(); deafenBtn.click();
    const continuaCalado = refs.peerAudio.muted;
    refs.localMute = false;
    definirAudioDaVoz('self', { lembrar: false });
    return { continuaCalado, voltaAoNormal: refs.peerAudio.muted };
  }), { continuaCalado: true, voltaAoNormal: false });
  assert.notEqual(await convidado.locator('#deafenBtn').evaluate(el => getComputedStyle(el, '::before').webkitMaskImage), 'none');
  // O rótulo dos controles é o nome fixo da coisa -- quem conta o estado é o ícone. Trocar o
  // texto por "Surdo" fazia a barra inteira mudar de largura a cada clique.
  assert.equal(await convidado.locator('#deafenBtn').evaluate(el => el.textContent.trim()), 'Ouvir');
  // `abrirDiagnostico` vive dentro de room-ui.js e nunca foi global: chamá-la direto de
  // sala.js lançava ReferenceError, e o botão da topbar não abria nada. O que se testa é o
  // handler, então o clique sai por `evaluate` -- neste ponto o canal de música está aberto
  // por cima da barra, e disputar ponteiro com ele não diria nada sobre o defeito.
  await convidado.evaluate(() => document.getElementById('connectionQualityBtn').click());
  await convidado.locator('#diagnosticsPanel:not(.hidden)').waitFor({ timeout: 5000 });
  // A latência existe SEM nenhuma faixa de mídia no ar. Ela vinha das estatísticas de uma
  // faixa, e quem entra só para ouvir não tem nenhuma -- ficava sem um único número sobre a
  // própria conexão justamente antes de decidir se ligava a câmera. Este teste roda sem
  // servidor de mídia, então é exatamente esse o cenário: se o número aparecer aqui, ele
  // aparece sempre.
  assert.equal(await convidado.evaluate(() => Object.values(publicacoesLocais).some(Boolean)), false);
  await convidado.waitForFunction(() => latenciaDaSinalizacao != null, null, { timeout: 12000 });
  assert.ok(await convidado.evaluate(() => Number.isFinite(latenciaDaSinalizacao) && latenciaDaSinalizacao >= 0));
  await convidado.waitForFunction(() => /\d+ ms/.test(document.querySelector('#connectionQualityBtn b')?.textContent || ''), null, { timeout: 8000 });
  assert.match(await convidado.evaluate(() => [...document.querySelectorAll('#diagnosticsCards .diag-cartao')][0].textContent), /Latência até o servidor\s*\d+ ms/);
  // O número não pode sobreviver à queda da conexão: um "24 ms" tranquilo na barra afirmaria
  // o contrário do que está acontecendo.
  assert.equal(await convidado.evaluate(async () => {
    socket.disconnect();
    await new Promise(r => setTimeout(r, 200));
    const vazio = latenciaDaSinalizacao === null && document.querySelector('#connectionQualityBtn b').hidden;
    socket.connect();
    return vazio;
  }), true);
  await convidado.waitForFunction(() => socket?.connected && latenciaDaSinalizacao != null, null, { timeout: 15000 });
  await convidado.evaluate(() => document.getElementById('diagnosticsPanel').classList.add('hidden'));
  assert.equal(await convidado.locator('#compactBtn svg').count(), 1);
  await convidado.evaluate(() => document.getElementById('compactBtn').click());
  assert.equal(await convidado.locator('.app.compacto-local').count(), 1);
  await convidado.evaluate(() => document.getElementById('compactBtn').click());

  await dono.locator('#moderarSalaBtn').click();
  await dono.locator('#roomLocked').check();
  await dono.locator('#allowScreen').uncheck();
  await convidado.waitForFunction(() => document.getElementById('screenBtn').disabled);

  await dono.evaluate(() => { peers.set('pessoa-falsa', { id: 'pessoa-falsa', name: 'Pessoa', state: {}, pc: { connectionState: 'connected' } }); abrirModeracao('pessoa-falsa'); });
  assert.equal(await dono.locator('#roomSecurity').isHidden(), true);
  await dono.locator('#moderarPanel [data-close]').click();
  await dono.locator('#moderarSalaBtn').click();
  assert.equal(await dono.locator('#roomSecurity').isVisible(), true);
  await dono.locator('#moderarPanel [data-close]').click();

  // A fila de entrada é assunto de quem modera: quem só está na sala não pode receber o nome
  // de alguém que ainda está do lado de fora e pode acabar recusado. O cliente já descartava
  // o evento, mas ele chegava -- e o que não se envia é o que não vaza.
  await convidado.evaluate(() => { window.vazouPedido = false; socket.on('pedido-entrada', () => { window.vazouPedido = true; }); });

  const desistente = await contextoB.newPage();
  await desistente.goto(`${origem}/${sala}/sala`);
  await desistente.locator('#nameInput').fill('Desistente');
  await desistente.locator('#nameConfirmBtn').click();
  await desistente.locator('#waitingPanel:not(.hidden)').waitFor({ timeout: 10000 });
  await dono.waitForFunction(() => !document.getElementById('joinRequestNotice').hidden && [...document.querySelectorAll('.join-request')].some(el => el.textContent.includes('Desistente')));
  // O bipe antigo do pedido tinha contexto de áudio próprio; agora ele é um aviso como os outros.
  assert.ok((await dono.evaluate(() => sonsPedidos)).includes('pedido'), 'quem modera ouve alguém bater na porta');
  assert.ok(await dono.evaluate(() => {
    const aviso = joinRequestNotice.getBoundingClientRect();
    const botao = joinRequestNoticeOpen.getBoundingClientRect();
    return aviso.right - botao.right < 16;
  }));
  assert.equal(await convidado.evaluate(() => window.vazouPedido), false);
  await dono.waitForFunction(() => document.getElementById('joinRequestNotice').hidden, null, { timeout: 9000 });
  assert.equal(await dono.locator('#joinRequestCount').isVisible(), true);
  await desistente.locator('#waitingCancel').click();
  await dono.waitForFunction(() => ![...document.querySelectorAll('.join-request')].some(el => el.textContent.includes('Desistente')) && document.getElementById('joinRequestNotice').hidden);

  const aguardando = await contextoB.newPage();
  await aguardando.goto(`${origem}/${sala}/sala`);
  await aguardando.locator('#nameInput').fill('Pessoa nova');
  await aguardando.locator('#nameConfirmBtn').click();
  await aguardando.locator('#waitingPanel:not(.hidden)').waitFor({ timeout: 10000 });
  await dono.waitForFunction(() => !document.getElementById('joinRequestNotice').hidden);
  await dono.locator('#joinRequestNoticeOpen').click();
  await dono.locator('.join-request').filter({ hasText: 'Pessoa nova' }).locator('button', { hasText: 'Aceitar' }).click();
  await aguardando.waitForFunction(() => tiles.has('self'), null, { timeout: 15000 });

  console.log('PASS: chat rico, presença, economia, compacto, permissões e aprovação de entrada');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
  if (servidor && servidor.exitCode === null) servidor.kill();
});
