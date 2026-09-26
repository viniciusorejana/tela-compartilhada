// Nada da sala se sobrepõe nem empurra a página para o lado, em nenhuma largura.
//
// Nasceu de um relato: com a janela estreita, o selo "SALA DE VOZ" passava por cima de
// "Moderação" e dos milissegundos. As regras da barra de cima olhavam a largura da JANELA, e a
// barra divide a janela com a lateral e o chat. Este teste varre larguras de celular a monitor
// largo, em vários estados (moderação e atualização à vista, chat fechado, lateral recolhida,
// cada seção das configurações, canal de música), e procura dois defeitos:
//
//   - dois irmãos de uma linha flex/grid ocupando o mesmo lugar;
//   - um filho saindo pela lateral do pai sem que o pai role.
//
// O que é sobreposto de propósito fica de fora: posição absoluta, fixa ou grudada (`sticky`,
// como o rodapé do painel de configurações, que passa por cima do conteúdo que rola).
//
//   npm run test:layout
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const assert = require('node:assert/strict');

const porta = 3233;
const origem = `http://localhost:${porta}`;
const LARGURAS = [360, 390, 430, 480, 540, 600, 640, 700, 761, 800, 860, 920, 1000, 1101, 1180, 1251, 1320, 1440, 1600, 1920];
const ESTADOS = ['normal', 'tudo', 'semchat', 'recolhida', 'focochat', 'config:perfil', 'config:aparelhos', 'config:qualidade', 'config:sons', 'config:aparencia', 'config:atalhos', 'musica'];
// As configurações e o canal de música não mudam a cada 20 px: uma amostra das larguras basta.
const LARGURAS_DE_PAINEL = [360, 600, 900, 1300, 1600];
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
  const raizes = ['.topbar', '.control-bar', '.room-sidebar', '#chatPanel', '#musicaPanel', '.palco-area', '.stage-controls', '.participants-heading', '.modal:not(.hidden) .modal-card'];
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
      if (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(cs.display)) {
        for (let i = 0; i < filhos.length; i++) for (let j = i + 1; j < filhos.length; j++) {
          const a = filhos[i].getBoundingClientRect(), b = filhos[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2) problemas.push(`${nome(pai)}: ${nome(filhos[i])} sobre ${nome(filhos[j])} (${Math.round(w)}×${Math.round(h)})`);
        }
        const rp = pai.getBoundingClientRect();
        for (const f of filhos) {
          const rf = f.getBoundingClientRect();
          if ((rf.right > rp.right + 2 || rf.left < rp.left - 2) && !['auto', 'scroll'].includes(cs.overflowX)) {
            problemas.push(`${nome(pai)}: ${nome(f)} vaza ${Math.round(Math.max(rf.right - rp.right, rp.left - rf.left))}px`);
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
  }, estado);
}

(async () => {
  instancia = await iniciarServidor({ ambiente: { PORT: String(porta) } });
  await esperarServidor();
  navegador = await chromium.launch({ headless: true });
  const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  pagina.on('pageerror', erro => { throw erro; });
  await pagina.goto(`${origem}/layout-sala/sala`);
  await pagina.locator('#nameInput').fill('Fulano de Tal');
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });

  const achados = [];
  for (const estado of ESTADOS) {
    const larguras = estado.startsWith('config:') || estado === 'musica' ? LARGURAS_DE_PAINEL : LARGURAS;
    for (const largura of larguras) {
      await pagina.setViewportSize({ width: largura, height: 820 });
      await prepararEstado(pagina, estado);
      await pagina.waitForTimeout(60);
      for (const problema of await pagina.evaluate(detectar)) achados.push(`[${estado} ${largura}px] ${problema}`);
    }
  }
  assert.deepEqual(achados, [], `sobreposições:\n${achados.join('\n')}`);
  console.log(`PASS: nada se sobrepõe nem empurra a página, em ${ESTADOS.length} estados e até ${LARGURAS.length} larguras`);
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
}).finally(async () => {
  await navegador?.close().catch(() => {});
  await instancia?.encerrar().catch(() => {});
});
