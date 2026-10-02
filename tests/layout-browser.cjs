// Nada da sala se sobrepõe nem empurra a página para o lado, em nenhuma largura.
//
// Nasceu de um relato: com a janela estreita, o selo "SALA DE VOZ" passava por cima de
// "Moderação" e dos milissegundos. As regras da barra de cima olhavam a largura da JANELA, e a
// barra divide a janela com a lateral e o chat. Este teste varre larguras de celular a monitor
// largo, em vários estados (moderação e atualização à vista, chat fechado, lateral recolhida,
// cada seção das configurações, canal de música, cada painel da sala), e procura três defeitos:
//
//   - dois irmãos de uma linha flex/grid ocupando o mesmo lugar;
//   - um filho saindo pela lateral do pai sem que o pai role;
//   - dentro de um painel, um filho vazando por baixo de um pai que não rola -- o defeito do
//     Estúdio numa coluna só, em que as pessoas subiam por cima dos ajustes.
//
// O que é sobreposto de propósito fica de fora: posição absoluta, fixa ou grudada (`sticky`,
// como o rodapé do painel de configurações, que passa por cima do conteúdo que rola).
//
// Entra com conta, porque o Estúdio é de quem tem uma.
//
//   npm run test:layout
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3233;
const origem = `http://localhost:${porta}`;
const LARGURAS = [320, 360, 390, 430, 480, 540, 600, 640, 700, 761, 800, 860, 920, 1000, 1101, 1180, 1251, 1320, 1440, 1600, 1920, 2560];
const ESTADOS = ['normal', 'tudo', 'semchat', 'recolhida', 'focochat', 'config:perfil', 'config:estudio', 'config:aparelhos', 'config:qualidade', 'config:sons', 'config:aparencia', 'config:atalhos', 'musica',
  'estudio', 'estudio:ajuda', 'cartao', 'foto', 'meuperfil', 'moderacao', 'diagnostico', 'volume', 'sons', 'tela', 'convite', 'sugestao', 'novidades', 'novidades:conheca',
  'convidar-amigos', 'mensagens', 'editor-cartao', 'ir-para-conta'];
// Os painéis não mudam a cada 20 px: uma amostra das larguras basta, com os extremos.
const LARGURAS_DE_PAINEL = [320, 360, 600, 760, 900, 1000, 1300, 1600, 2560];
// O Estúdio também em janela baixa: é o painel mais alto da sala.
const ALTURAS_DO_ESTUDIO = [[700, 480], [1000, 560], [1366, 600], [1280, 720]];
let instancia, navegador;

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origem)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não iniciou.');
}

function detectar() {
  const visivel = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const nome = el => (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}`);
  const problemas = [];
  const raizes = ['.topbar', '.control-bar', '.room-sidebar', '#chatPanel', '#musicaPanel', '.palco-area', '.stage-controls', '.participants-heading', '.modal:not(.hidden) .modal-card', '.nx-nov-janela'];
  const vistos = new Set();
  for (const seletor of raizes) for (const raiz of document.querySelectorAll(seletor)) {
    if (!visivel(raiz)) continue;
    const pilha = [raiz];
    while (pilha.length) {
      const pai = pilha.pop();
      if (vistos.has(pai)) continue;
      vistos.add(pai);
      const cs = getComputedStyle(pai);
      const filhos = [...pai.children].filter(f => visivel(f) && !['absolute', 'fixed', 'sticky'].includes(getComputedStyle(f).position));
      // Pilhas de rostos se sobrepõem de propósito: cada carinha entra um pouco por baixo da outra.
      const pilhaDeRostos = pai.matches('.nx-rostos, .espectadores-rostos');
      if (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(cs.display) && !pilhaDeRostos) {
        for (let i = 0; i < filhos.length; i++) for (let j = i + 1; j < filhos.length; j++) {
          const a = filhos[i].getBoundingClientRect(), b = filhos[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2) problemas.push(`${nome(pai)}: ${nome(filhos[i])} sobre ${nome(filhos[j])} (${Math.round(w)}×${Math.round(h)})`);
        }
        const rp = pai.getBoundingClientRect();
        const noPainel = Boolean(pai.closest('.modal-card'));
        for (const f of filhos) {
          const rf = f.getBoundingClientRect();
          if ((rf.right > rp.right + 2 || rf.left < rp.left - 2) && !['auto', 'scroll'].includes(cs.overflowX)) {
            problemas.push(`${nome(pai)}: ${nome(f)} vaza ${Math.round(Math.max(rf.right - rp.right, rp.left - rf.left))}px`);
          }
          if (noPainel && rf.bottom > rp.bottom + 2 && ['visible', 'clip'].includes(cs.overflowY)) {
            problemas.push(`${nome(pai)}: ${nome(f)} vaza ${Math.round(rf.bottom - rp.bottom)}px por baixo`);
          }
        }
      }
      for (const f of pai.children) if (visivel(f)) pilha.push(f);
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) problemas.push(`a página rola para o lado (${document.documentElement.scrollWidth} > ${innerWidth})`);
  return [...new Set(problemas)];
}

async function prepararEstado(pagina, estado) {
  await pagina.evaluate(e => {
    const app = document.querySelector('.app');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    window.NexoNovidades?.fechar();
    app.classList.remove('barra-recolhida');
    if (app.classList.contains('foco-chat')) definirFocoChat(false);
    if (app.classList.contains('painel-musica')) document.getElementById('musicaClose').click();
    if (app.classList.contains('sem-chat') && e !== 'semchat') abrirChat();
    // O pior caso da barra de cima: atualização, moderação com pedidos, e um nome de sala longo.
    const tudo = e === 'tudo';
    document.getElementById('atualizarAppBtn').hidden = !tudo;
    document.getElementById('moderarSalaBtn').hidden = !tudo;
    document.getElementById('joinRequestCount').hidden = !tudo;
    document.getElementById('joinRequestCount').textContent = '3';
    document.getElementById('roomTitle').textContent = tudo ? 'squad-da-madrugada-longa' : 'layout-sala';
    if (e === 'semchat') fecharChat();
    if (e === 'recolhida') app.classList.add('barra-recolhida');
    if (e === 'focochat') definirFocoChat(true);
    if (e.startsWith('config:')) NexoConfig.abrir(e.slice(7));
    if (e === 'musica') document.querySelector('[data-action="musica"]').click();
    if (e.startsWith('estudio')) {
      NexoEstudio.abrir();
      const ajuda = e === 'estudio:ajuda';
      document.getElementById('estudioAjuda').hidden = !ajuda;
      document.getElementById('estudioBloqueio').hidden = !ajuda;
    }
    if (e === 'cartao') abrirPerfil('self');
    // A foto grande por cima do cartão, com um nome longo. A imagem é um quadrado desenhado aqui:
    // o que se confere é o visor, e não a foto.
    if (e === 'foto') {
      abrirPerfil('self');
      const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
      canvas.getContext('2d').fillRect(0, 0, 512, 512);
      fotoDoPerfil = { foto: canvas.toDataURL(), nome: 'Maria Eduarda dos Santos Albuquerque', codigo: 'K7M2-PQ4X' };
      abrirFoto();
    }
    if (e === 'meuperfil') NexoPerfilSala.abrir();
    if (e === 'moderacao') document.getElementById('moderarPanel').classList.remove('hidden');
    if (e === 'diagnostico') document.querySelector('[data-action="diagnostics"]').click();
    if (e === 'volume') NexoVolume.abrir('beatriz#teste', 'tela');
    if (e === 'sons') document.getElementById('soundboardBtn').click();
    if (e === 'tela') abrirPainelDeTela('start');
    if (e === 'convite') document.getElementById('invitePanel').classList.remove('hidden');
    if (e === 'sugestao') document.getElementById('sugestaoPanel').classList.remove('hidden');
    // Amigos na sala (social-sala.js): o painel de convidar e as mensagens diretas.
    if (e === 'convidar-amigos') NexoSalaSocial.abrirConvite();
    if (e === 'mensagens') NexoSalaSocial.abrirMensagens();
    // O cartão completo, num painel da sala, e o aviso antes de sair para a página da conta.
    if (e === 'editor-cartao') NexoSalaSocial.abrirEditor();
    if (e === 'ir-para-conta') NexoPerfilSala.confirmarIrParaConta();
    if (e.startsWith('novidades')) NexoNovidades.abrir({ aba: e === 'novidades' ? 'novidades' : 'conheca' });
  }, estado);
  // O Estúdio pede a sala ao servidor ao abrir: o desenho só vale depois da resposta.
  if (estado.startsWith('estudio')) await pagina.waitForFunction(() => document.querySelectorAll('#estudioLista .estudio-pessoa').length >= 2, null, { timeout: 5000 });
  // O editor pede a vitrine ao servidor na primeira vez: o desenho só vale com a prévia na tela.
  if (estado === 'editor-cartao') await pagina.waitForSelector('#editorCartaoSala .ed-previa-cartao .nx-cartao', { timeout: 5000 });
}

// Uma segunda pessoa, com nome longo e som de tela, para o quadradinho dela, a pílula de volume
// do toque e a folha de volume terem o que mostrar. Sem servidor de mídia, ela é só o par na
// memória -- é o bastante para o desenho, que é o que este teste confere.
async function criarSegundaPessoa(pagina) {
  await pagina.evaluate(() => {
    const id = 'beatriz#teste';
    peers.set(id, {
      id, name: 'Beatriz Souza de Almeida Lima', participante: null, ehBot: false,
      state: { camera: false, screen: true, screenAudio: true, micMuted: false, presenca: '' },
      remoteStreams: { camera: new MediaStream(), screen: new MediaStream(), micAudio: new MediaStream(), screenAudio: new MediaStream() },
      publicacoes: new Map(), ordem: { screen: 1, camera: 0 }, pc: { connectionState: 'connected' }, assistindo: false
    });
    criarTile(id, 'Beatriz Souza de Almeida Lima', peers.get(id).state);
    atualizarTile(id);
    atualizarContador();
  });
  // E uma pessoa guardada no Estúdio, com nome longo, para a lista ter duas linhas.
  await pagina.evaluate(async () => {
    await fetch('/api/conta/estudio', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': NexoConta.atual().csrf },
      body: JSON.stringify({ config: { pessoas: { 'n:maria eduarda dos santos': { rotulo: 'Maria Eduarda dos Santos', oculto: true } } } }) });
  });
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const { cookie } = await instancia.conta('fulano', { apelido: 'Fulano de Tal' });
  await contexto.addCookies([{ name: 'nexo_conta', value: cookie.split('=')[1], url: origem }]);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/layout-sala/sala`);
  await pagina.evaluate(() => window.NexoConta?.pronto);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  await criarSegundaPessoa(pagina);

  const achados = [];
  const conferir = async (estado, largura, altura) => {
    await pagina.setViewportSize({ width: largura, height: altura });
    await prepararEstado(pagina, estado);
    // As colunas deslizam quando a janela cruza um degrau de largura (sala.css): no meio do
    // deslize, o chat já tem a largura final e a coluna ainda não -- o que é o efeito, e não
    // defeito. O desenho que vale é o de depois.
    await pagina.waitForFunction(() => !document.querySelector('.app').getAnimations().length, null, { timeout: 2000 }).catch(() => {});
    await pagina.waitForTimeout(60);
    for (const problema of await pagina.evaluate(detectar)) achados.push(`[${estado} ${largura}×${altura}] ${problema}`);
  };
  for (const estado of ESTADOS) {
    const larguras = ['normal', 'tudo', 'semchat', 'recolhida', 'focochat'].includes(estado) ? LARGURAS : LARGURAS_DE_PAINEL;
    for (const largura of larguras) await conferir(estado, largura, 820);
  }
  for (const [largura, altura] of ALTURAS_DO_ESTUDIO) await conferir('estudio', largura, altura);

  // As páginas fora da sala: nenhuma rola para o lado. A pergunta é a de quem usa -- a roda na
  // horizontal move a página? --, e não a largura medida: a órbita decorativa da página inicial
  // passa da borda de propósito, cortada pela janela, e isso não é defeito.
  const fora = await contexto.newPage();
  // Com o cookie da conta, `/` é o início de quem tem conta (e as seções dele); `/sobre` é a
  // apresentação de sempre.
  for (const caminho of ['/', '/?secao=perfil', '/?secao=conquistas', '/?secao=adicionar', '/sobre', '/conta', '/pagina-que-nao-existe']) {
    for (const largura of LARGURAS) {
      await fora.setViewportSize({ width: largura, height: 820 });
      await fora.goto(`${origem}${caminho}`);
      await fora.mouse.move(largura / 2, 400);
      await fora.mouse.wheel(400, 0);
      await fora.waitForTimeout(80);
      const rolou = await fora.evaluate(() => window.scrollX);
      if (rolou) achados.push(`[${caminho} ${largura}px] a página rola ${rolou}px para o lado`);
    }
  }
  assert.deepEqual(achados, [], `sobreposições:\n${achados.join('\n')}`);
  console.log(`PASS: nada se sobrepõe nem empurra a página, em ${ESTADOS.length} estados e até ${LARGURAS.length} larguras, de 320 a 2560 px -- e a inicial, a conta e a "não encontrada" não rolam para o lado`);
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
