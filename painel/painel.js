import { atualizarEstado, lerEstado } from './estado.js';
import './componentes.js';

let csrf = '', controle = null, revisao = null, carregando = false;
const erro = document.getElementById('erro');
function problema(texto) { erro.hidden = !texto; erro.textContent = texto; }
async function carregar() {
  controle?.abort(); controle = new AbortController(); const atual = controle;
  carregando = true;
  try {
    const resposta = await fetch(`/painel/api/resumo?periodo=${lerEstado().periodo}`, { signal: atual.signal });
    if (resposta.status === 401) { location.assign('/painel/entrar'); return; }
    if (!resposta.ok) throw new Error();
    const dados = await resposta.json();
    if (atual !== controle) return;
    atualizarEstado(dados); revisao = dados.atual.revisao; problema('');
    const c = dados.contabilidade;
    document.getElementById('cobertura').textContent = c.primeiro ? `Histórico disponível a partir de ${new Date(c.primeiro).toLocaleString('pt-BR')} · ${c.fuso}` : 'As primeiras janelas aparecem após um minuto de coleta.';
  } catch (e) { if (e.name !== 'AbortError') problema('Não foi possível atualizar o histórico. Os últimos dados continuam visíveis.'); }
  finally { if (atual === controle) carregando = false; }
}
document.getElementById('periodo').addEventListener('change', evento => { atualizarEstado({ periodo: evento.target.value }); carregar(); });
document.getElementById('sair').addEventListener('click', async () => {
  try { const r = await fetch('/painel/sair', { method: 'POST', headers: { 'X-Nexo-CSRF': csrf } }); if (r.ok || r.status === 401) location.assign('/painel/entrar'); else problema('Não foi possível encerrar a sessão. Tente novamente.'); }
  catch (_) { problema('A conexão caiu. Tente sair novamente quando ela voltar.'); }
});
const sessao = await fetch('/painel/api/sessao');
if (!sessao.ok) location.assign('/painel/entrar');
else {
  csrf = (await sessao.json()).csrf;
  // As escritas do painel que moram em componentes (as contas) precisam do mesmo CSRF.
  atualizarEstado({ csrf });
  await carregar();
  const fluxo = new EventSource('/painel/api/eventos');
  fluxo.addEventListener('atualizacao', evento => {
    const atual = JSON.parse(evento.data); atualizarEstado({ atual });
    document.getElementById('conexao').textContent = `Ao vivo · ${new Date(atual.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById('ponto-conexao').classList.add('ativo');
    document.getElementById('numero-alertas').textContent = atual.alertas.length;
    if (revisao !== null && atual.revisao !== revisao && !carregando) carregar();
  });
  fluxo.addEventListener('encerrada', () => { fluxo.close(); location.assign('/painel/entrar'); });
  fluxo.onerror = () => { document.getElementById('conexao').textContent = 'Reconectando…'; document.getElementById('ponto-conexao').classList.remove('ativo'); };
  // O push não mantém uma sessão abandonada viva. Só interação humana renova a
  // inatividade, com no máximo um pedido por minuto e sem polling de métricas.
  let atividade = 0;
  for (const tipo of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(tipo, () => {
    if (Date.now() - atividade < 60000) return; atividade = Date.now();
    fetch('/painel/atividade', { method: 'POST', headers: { 'X-Nexo-CSRF': csrf } }).catch(() => {});
  }, { passive: true });
}
const secoes = new IntersectionObserver(entradas => {
  for (const entrada of entradas) if (entrada.isIntersecting) for (const link of document.querySelectorAll('nav a')) link.classList.toggle('selecionado', link.hash === `#${entrada.target.id}`);
}, { rootMargin: '-10% 0px -65% 0px' });
document.querySelectorAll('main>section').forEach(secao => secoes.observe(secao));
