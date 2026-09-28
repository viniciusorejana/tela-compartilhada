import { observar, lerEstado } from './estado.js';

const nomes = { screen: 'Tela', camera: 'Câmera', micAudio: 'Voz', screenAudio: 'Som da tela', musica: 'Música do bot', soundboard: 'Soundboard', chat: 'Chat', outros: 'Outros', vozMista: 'Voz + música · legado' };
const numero = (n, casas = 1) => Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: casas }) : '—';
const bytes = n => !Number.isFinite(n) ? '—' : n >= 1e12 ? `${numero(n / 1e12, 2)} TB` : n >= 1e9 ? `${numero(n / 1e9, 2)} GB` : n >= 1e6 ? `${numero(n / 1e6, 1)} MB` : n >= 1e3 ? `${numero(n / 1e3, 1)} kB` : `${numero(n, 0)} B`;
const duracao = n => !Number.isFinite(n) ? '—' : n >= 3600 ? `${numero(n / 3600, 1)} h` : `${numero(n / 60, 1)} min`;
const moeda = n => Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '—';
const quando = n => n ? new Date(n).toLocaleString('pt-BR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const e = (tag, atributos = {}, ...filhos) => {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) no.setAttribute(chave, valor);
  for (const filho of filhos.flat(Infinity)) if (filho !== null && filho !== undefined) no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  return no;
};
const svg = (tag, atributos = {}, texto) => {
  const no = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [chave, valor] of Object.entries(atributos)) no.setAttribute(chave, valor);
  if (texto !== undefined) no.textContent = texto;
  return no;
};
const titulo = (nome, descricao) => [e('h3', {}, nome), e('p', { class: 'nota' }, descricao)];
const vazio = (nome, descricao) => e('div', { class: 'vazio' }, e('strong', {}, nome), e('p', {}, descricao));
const metrica = (nome, valor) => e('div', { class: 'metrica' }, e('strong', {}, valor), e('span', {}, nome));
function tabela(caption, colunas, linhas, dobrada = false) {
  const tab = e('table', {}, e('caption', {}, caption), e('thead', {}, e('tr', {}, colunas.map(c => e('th', { scope: 'col' }, c)))), e('tbody', {}, linhas.map(l => e('tr', {}, l.map(v => e('td', {}, v))))));
  const recipiente = e('div', { class: 'tabela', tabindex: '0', 'aria-label': caption }, tab);
  return dobrada ? e('details', {}, e('summary', {}, 'Ver dados em tabela'), recipiente) : recipiente;
}
function barras(nome, linhas, formatar = bytes) {
  const altura = Math.max(70, linhas.length * 35 + 8);
  const desenho = svg('svg', { viewBox: `0 0 430 ${altura}`, role: 'img', 'aria-label': nome, class: 'svg-grafico' });
  desenho.append(svg('title', {}, `${nome}. Os mesmos valores estão na tabela abaixo.`));
  const maior = Math.max(1, ...linhas.map(l => l.valor || 0));
  linhas.forEach((l, i) => {
    const y = i * 35 + 7;
    desenho.append(svg('text', { x: 0, y: y + 13 }, l.nome.length > 22 ? `${l.nome.slice(0, 20)}…` : l.nome), svg('rect', { class: 'fundo', x: 146, y, width: 200, height: 19, rx: 4 }), svg('rect', { class: 'barra', x: 146, y, width: (l.valor || 0) / maior * 200, height: 19, rx: 4 }), svg('text', { x: 430, y: y + 13, 'text-anchor': 'end', class: 'valor' }, formatar(l.valor)));
  });
  return [desenho, tabela(nome, ['Categoria', 'Valor'], linhas.map(l => [l.nome, formatar(l.valor)]), true)];
}
function serie(nome, linhas, campo, formatar) {
  if (!linhas.length) return vazio('Ainda não há uma série', 'As primeiras janelas aparecem depois de um minuto.');
  // O resumo gráfico tem teto, e a tabela descreve exatamente os grupos desenhados.
  const passo = Math.max(1, Math.ceil(linhas.length / 96));
  const grupos = [];
  for (let i = 0; i < linhas.length; i += passo) {
    const fatia = linhas.slice(i, i + passo);
    grupos.push({ t: fatia[0].t, ate: fatia.at(-1).t, valor: campo === 'bytes' ? fatia.reduce((s, l) => s + l[campo], 0) : Math.max(...fatia.map(l => l[campo] || 0)) });
  }
  const maior = Math.max(1, ...grupos.map(l => l.valor)), a = grupos[0].t, b = grupos.at(-1).t;
  const desenho = svg('svg', { viewBox: '0 0 620 240', role: 'img', 'aria-label': nome, class: 'svg-grafico' });
  desenho.append(svg('title', {}, `${nome}. ${passo > 1 ? `Agrupado em até ${passo} janelas por barra. ` : ''}Consulte a tabela para todos os valores desenhados.`));
  for (let i = 0; i <= 3; i++) {
    const y = 25 + i * 55;
    desenho.append(svg('line', { x1: 70, x2: 610, y1: y, y2: y, class: 'guia' }), svg('text', { x: 62, y: y + 4, 'text-anchor': 'end' }, formatar(maior * (1 - i / 3))));
  }
  const largura = Math.max(2, Math.min(24, 490 / grupos.length));
  grupos.forEach(l => {
    const x = 78 + (b === a ? .5 : (l.t - a) / (b - a)) * 510;
    const h = l.valor / maior * 165;
    desenho.append(svg('rect', { x, y: 190 - h, width: largura, height: Math.max(1, h), rx: 2, class: 'barra' }));
  });
  desenho.append(svg('text', { x: 72, y: 222 }, quando(a)), svg('text', { x: 612, y: 222, 'text-anchor': 'end' }, quando(b)));
  return [desenho, tabela(nome, ['De', 'Até', campo === 'bytes' ? 'Bytes' : campo === 'quantidade' ? 'Pico de telas' : 'Pico de salas'], grupos.map(l => [quando(l.t), quando(l.ate), formatar(l.valor)]), true)];
}

class Componente extends HTMLElement {
  connectedCallback() {
    this.soltar = observar(estado => { this.estado = estado; this.pintar(); });
    this.addEventListener('focusout', () => queueMicrotask(() => this.pintar()));
  }
  disconnectedCallback() { this.soltar?.(); }
  pintar() {
    // Atualizar um gráfico não deve retirar o foco de quem está lendo sua tabela.
    if (this.contains(document.activeElement)) return;
    const abertos = [...this.querySelectorAll('details')].map(d => d.open);
    this.replaceChildren(...this.desenhar(this.estado).flat(Infinity).filter(n => n != null));
    this.querySelectorAll('details').forEach((d, i) => { d.open = abertos[i] || false; });
  }
}
function componente(nome, desenhar) { customElements.define(nome, class extends Componente { desenhar(estado) { return desenhar(estado); } }); }

componente('nexo-resumo', ({ contabilidade: c }) => {
  const valores = [
    ['Saída no período', c?.vazio ? '—' : bytes(c?.total), 'Bytes de aplicação · mídia + HTTP'],
    ['Banda média', c ? `${numero(c.mediaMbps, 2)} Mbps` : '—', c?.coberturaConhecida ? 'Inclui a ociosidade observada' : 'Sobre as janelas com dados'],
    ['Pico da mídia e aplicação', c ? `${numero(c.picoMbps, 2)} Mbps` : '—', 'Média por janela de até 60 segundos'],
    ['Pico observado da rede', c ? `${numero(c.picoRedeMbps, 2)} Mbps` : '—', 'Maior interface · intervalos de 15 s']
  ];
  return [e('div', { class: 'indicadores' }, valores.map(([nome, valor, nota]) => e('div', { class: 'indicador' }, e('span', { class: 'nome' }, nome), e('strong', {}, valor), e('small', {}, nota)))), c?.vazio ? e('p', { class: 'aviso' }, 'A coleta já está pronta. Entre em uma sala e use mídia ou chat: os primeiros dados chegam em cerca de um minuto. Ausência de relatório não significa consumo zero.') : e('p', { class: 'nota' }, `Contabilidade de mídia autodeclarada. HTTP e chat medidos no Node. Não inclui todo o overhead da rede. Entrada HTTP no período: ${bytes(c?.entrada)}.`)];
});
componente('nexo-fontes', ({ contabilidade: c }) => [
  ...titulo('O custo de cada funcionalidade', 'Saída agregada, sem histórico por pessoa.'),
  ...barras('Saída por funcionalidade', Object.entries(nomes).filter(([f]) => f !== 'vozMista' || c?.legado).map(([f, nome]) => ({ nome, valor: c?.fontes[f] || 0 }))),
  e('p', { class: 'nota' }, c?.legado ? 'O histórico legado mistura voz e música. A separação do bot só existe nas amostras novas.' : 'Música do bot separada da voz. Reproduções da soundboard em cache não geram novo download.')
]);
componente('nexo-serie', ({ contabilidade: c }) => [...titulo('Como a banda se distribui', 'Saída por hora. Lacunas de coleta não são preenchidas com zeros.'), serie('Série temporal de saída', c?.serie || [], 'bytes', bytes)]);
componente('nexo-ranking', ({ contabilidade: c }) => [...titulo('Salas por consumo', 'Todas as funcionalidades do período selecionado.'), c?.salas.length ? tabela('Ranking de salas', ['Sala', 'Saída', 'Média', 'Pico de janela'], c.salas.slice(0, 50).map(s => [s.sala === 'servidor' ? 'Servidor · arquivos e downloads' : s.sala, bytes(s.total), `${numero(s.mediaMbps, 2)} Mbps`, `${numero(s.picoMbps, 2)} Mbps`])) : vazio('O ranking começa com o uso', 'As salas aparecerão aqui depois da primeira janela medida.')]);

class Projecao extends HTMLElement {
  connectedCallback() {
    this.campos = {};
    let salvo = {}; try { salvo = JSON.parse(localStorage.getItem('nexoCenarioBanda') || '{}'); } catch (_) {}
    const formulario = e('div', { class: 'formulario' });
    for (const [chave, nome, padrao, passo] of [['gb', 'Preço por GB (US$)', .09, .01], ['base', 'Preço-base incluso (US$)', '', 1], ['franquia', 'Franquia mensal (GB)', '', 100], ['excedente', 'Excedente por GB (US$)', '', .01]]) {
      const campo = e('input', { id: `cenario-${chave}`, type: 'number', min: '0', max: '1000000000', step: String(passo), inputmode: 'decimal' }); campo.value = salvo[chave] ?? padrao;
      this.campos[chave] = campo; formulario.append(e('label', { class: 'campo', for: campo.id }, nome, campo));
      campo.addEventListener('input', () => { const valores = Object.fromEntries(Object.entries(this.campos).map(([k, c]) => [k, c.value])); try { localStorage.setItem('nexoCenarioBanda', JSON.stringify(valores)); } catch (_) {} this.atualizar(); });
    }
    const modo = e('select', { id: 'cenario-modo' }, e('option', { value: 'observado' }, 'Ritmo observado de calendário'), e('option', { value: 'horas' }, 'Simular horas de uso por dia'));
    this.modo = modo; modo.addEventListener('change', () => this.atualizar());
    const horas = e('input', { id: 'cenario-horas', type: 'number', min: '0', max: '24', step: '0.5', value: '4' }); this.horas = horas; horas.addEventListener('input', () => this.atualizar());
    formulario.append(e('label', { class: 'campo', for: modo.id }, 'Base da projeção', modo), e('label', { class: 'campo', for: horas.id }, 'Horas por dia no cenário', horas));
    this.aviso = e('p', { class: 'nota' }); this.resultado = e('div', { class: 'resultados' });
    this.replaceChildren(...titulo('Um mês nesse ritmo', 'Cenários editáveis. Valores em dólares e GB decimais; não são cotações de provedores.'), formulario, this.aviso, this.resultado);
    this.soltar = observar(({ contabilidade }) => { this.dados = contabilidade; this.atualizar(); });
  }
  disconnectedCallback() { this.soltar?.(); }
  atualizar() {
    const c = this.dados;
    const valor = chave => { const v = this.campos[chave].value; return v !== '' && Number(v) >= 0 && Number(v) <= 1e9 ? Number(v) : null; };
    const simular = this.modo.value === 'horas'; this.horas.disabled = !simular;
    const quantidade = simular ? c?.segundosComDados >= 1800 && Number(this.horas.value) >= 0 && Number(this.horas.value) <= 24 ? c.total / c.segundosComDados * Number(this.horas.value) * 3600 * 30 : null : c?.projecao.bytesMensais ?? null;
    this.aviso.textContent = quantidade === null ? 'Amostra insuficiente. A projeção observada exige ao menos 24 h de cobertura; o cenário de uso exige 30 min com dados.' : `${simular ? 'Cenário hipotético de uso' : c.projecao.confianca === 'preliminar' ? 'Projeção preliminar: ainda não há uma semana completa' : 'Projeção baseada no período observado'} · ${bytes(quantidade)} em 30 dias. A coleta de mídia pode estar incompleta.`;
    const porGb = quantidade !== null && valor('gb') !== null ? quantidade / 1e9 * valor('gb') : null;
    const excedeu = quantidade !== null && valor('franquia') !== null ? Math.max(0, quantidade / 1e9 - valor('franquia')) : null;
    const incluido = quantidade !== null && valor('base') !== null && excedeu !== null && (!excedeu || valor('excedente') !== null) ? valor('base') + excedeu * (valor('excedente') || 0) : null;
    this.resultado.replaceChildren(e('div', { class: 'resultado' }, e('span', {}, 'COBRADO POR GB'), e('strong', {}, moeda(porGb)), e('small', {}, 'Tráfego de saída; some o preço do servidor.')), e('div', { class: 'resultado' }, e('span', {}, 'TRÁFEGO INCLUSO'), e('strong', {}, moeda(incluido)), e('small', {}, incluido === null ? 'Preencha preço-base, franquia e excedente.' : excedeu > 0 ? `${numero(excedeu, 1)} GB além da franquia.` : 'Dentro da franquia informada.')));
  }
}
customElements.define('nexo-projecao', Projecao);

componente('nexo-horarios', ({ contabilidade: c }) => [
  ...titulo('Quando a sala exige mais', `Média por hora e dia da semana com cobertura conhecida · ${c?.fuso || 'fuso do servidor'}.`),
  !c?.coberturaConhecida ? vazio('O horário precisa de contexto', 'O histórico antigo não distingue ociosidade de falta de coleta. As médias passam a existir com o coletor novo.') : e('div', { class: 'colunas' },
    e('div', {}, e('h4', {}, 'Hora do dia'), ...barras('Banda média por hora do dia', c.horas.map(h => ({ nome: `${String(h.hora).padStart(2, '0')}h`, valor: h.segundos ? h.bytes * 8 / h.segundos / 1e6 : null })), v => Number.isFinite(v) ? `${numero(v, 2)} Mbps` : 'Sem coleta')),
    e('div', {}, e('h4', {}, 'Dia da semana'), ...barras('Banda média por dia da semana', c.semana.map(d => ({ nome: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][d.dia], valor: d.segundos ? d.bytes * 8 / d.segundos / 1e6 : null })), v => Number.isFinite(v) ? `${numero(v, 2)} Mbps` : 'Sem coleta'), e('p', { class: 'nota' }, 'Um dia pouco observado tem menos evidência. Consulte a cobertura antes de dimensionar a porta.')))
]);
componente('nexo-alertas', ({ atual: a }) => [
  ...titulo('Limites atingidos', 'Alertas mantidos por até 7 dias. Nomes livres identificam sessões, não comprovam identidade pessoal.'),
  !a ? vazio('Conectando ao servidor', 'Aguardando o estado dos contadores.') : a.alertas.length ? tabela('Alertas de limites', ['Quando', 'Quem / sala', 'Regra', 'Quantidade / teto', 'Ação'], a.alertas.map(x => [quando(x.t), `${x.nome} · ${x.sala || 'sem sala'}`, x.regra, `${numero(x.quantidade, 0)} / ${numero(x.teto, 0)} em ${numero(x.segundos, 0)} s`, e('span', { class: `etiqueta ${x.acao}` }, x.acao)])) : e('div', { class: 'saudavel' }, e('span', { class: 'simbolo', 'aria-hidden': 'true' }, '✓'), e('div', {}, e('strong', {}, 'Nenhum limite atingido'), e('p', {}, 'Os contadores estão ativos. O uso normal permanece anônimo no histórico.'))),
  a?.coleta.alertas.falha ? e('p', { class: 'aviso' }, a.coleta.alertas.falha) : null
]);
componente('nexo-eventos', ({ atual: a }) => [
  ...titulo('Atividade de eventos', 'Tentativas recebidas e recusadas nos últimos 60 s. Emissores identificados por pseudônimo temporário.'),
  tabela('Eventos Socket.IO recebidos pelo servidor', ['Tipo', 'Tentativas/min', 'Recusadas'], (a?.abuso.taxasSocket || []).map(t => [t.tipo, numero(t.tentativas, 0), numero(t.recusadas, 0)])),
  e('h4', {}, 'Maiores emissores agora'), tabela('Emissores temporários', ['Sessão temporária', 'Eventos/min'], (a?.abuso.emissores || []).map(p => [p.sessao, numero(p.eventos, 0)])),
  e('details', {}, e('summary', {}, 'Contadores de proteção por operação'), tabela('Verificações de limites, incluindo HTTP e bytes', ['Regra', 'Verificações/min', 'Recusadas'], (a?.abuso.taxas || []).filter(t => t.tipo !== 'total').map(t => [t.tipo, numero(t.tentativas, 0), numero(t.recusadas, 0)]))),
  a?.abuso.saturacoes || a?.origens.saturacoes ? e('p', { class: 'aviso' }, 'Capacidade de contadores atingida. A proteção global permanece ativa.') : null
]);
componente('nexo-saude', ({ atual: a, contabilidade: c }) => {
  const s = a?.sfu;
  return [...titulo('Encaminhamento de mídia', 'Métricas locais do SFU. Pacotes não são convertidos em bytes.'),
    !s?.disponivel ? vazio('Métricas indisponíveis', 'O painel continua funcionando. Verifique se o SFU está ativo e a coleta está acessível.') : e('div', { class: 'metricas' }, metrica('Pacotes de saída / s', numero(s.pacotesSaidaSegundo)), metrica('Descartados / s', numero(s.descartadosSegundo)), metrica('Latência de encaminhamento · ms', numero(s.latencia, 3)), metrica('Jitter de encaminhamento · ms', numero(s.jitter, 3)), metrica('Salas no SFU', numero(s.salas, 0)), metrica('Participantes, incluindo bots', numero(s.participantes, 0))),
    e('p', { class: 'nota' }, 'Latência e jitter mostram as médias móveis do LiveKit, convertidas de nanossegundos para milissegundos. Zero pode indicar ausência de encaminhamento. Contadores reiniciados aguardam a próxima coleta.'),
    e('h4', {}, 'Publicações e churn · janela corrente'), e('div', { class: 'metricas' }, metrica('Publicações', numero(a?.eventosSfu.publicacoes, 0)), metrica('Republicações', numero(a?.eventosSfu.republicacoes, 0)), metrica('Entradas / saídas', `${numero(a?.eventosSfu.entradas, 0)} / ${numero(a?.eventosSfu.saidas, 0)}`)),
    e('p', { class: 'nota' }, 'Contados por notificações assinadas. A primeira publicação é separada das republicações. Mute sem republicação não representa churn de faixa.'),
    e('details', {}, e('summary', {}, 'Churn no período selecionado'), tabela('Eventos SFU agregados no histórico', ['Publicações', 'Republicações', 'Entradas', 'Saídas'], [[c?.eventosSfu.publicacoes, c?.eventosSfu.republicacoes, c?.eventosSfu.entradas, c?.eventosSfu.saidas].map(v => numero(v, 0))]))];
});
componente('nexo-limites', ({ atual: a }) => [e('details', {}, e('summary', {}, 'Consultar os limites em vigor'), tabela('Tetos do servidor', ['Operação', 'Sessão / min', 'Sala / min', 'Resposta'], Object.entries(a?.limites || {}).map(([nome, r]) => [nome, r.sessao === null ? 'Liberado para limpeza' : numero(r.sessao, 0), r.sala ? numero(r.sala, 0) : '—', r.observar ? 'Observar e alertar' : 'Recusar excesso'])))]);
componente('nexo-uso', ({ contabilidade: c, atual: a }) => [
  ...titulo('O tamanho das conversas', 'Distribuição por tempo de sala, sem contar bots. Duração e permanência são das sessões de sinalização concluídas.'),
  e('div', { class: 'metricas' }, metrica('Salas ativas agora', numero(a?.salas.length, 0)), metrica('Duração média de sala', duracao(c?.uso.duracaoMedia)), metrica('Permanência média', duracao(c?.uso.permanenciaMedia))),
  e('div', { class: 'colunas' }, e('div', {}, e('h4', {}, 'Tempo em cada tamanho'), ...barras('Tempo acumulado por tamanho de sala', Object.entries(c?.uso.distribuicao || { '1': 0, '2': 0, '3–6': 0, '7–15': 0, '16+': 0 }).map(([nome, valor]) => ({ nome: `${nome} pessoa${nome === '1' ? '' : 's'}`, valor })), duracao)), e('div', {}, e('h4', {}, 'Salas simultâneas'), serie('Histórico de simultaneidade de salas', c?.uso.serie || [], 'pico', v => numero(v, 0)))),
  e('p', { class: 'nota' }, 'Salas e sessões ainda abertas não entram na média de duração. Uma queda de conexão encerra a sessão de sinalização; não comprova que a pessoa deixou de assistir.'),
  // O teto de pessoas começou em números de partida. É esta linha que diz se eles estão certos.
  e('h4', {}, `Teto de pessoas · ${numero(a?.teto?.base, 0)} por sala, ${numero(a?.teto?.comAssinante, 0)} com alguém premium`),
  e('div', { class: 'metricas' },
    metrica('Salas no teto base agora', numero(a?.teto?.salasNoTetoBase, 0)),
    metrica('Pico de salas no teto · período', numero(c?.teto?.picoSalasNoTeto, 0)),
    metrica('Entradas recusadas por lotação · período', numero(c?.teto?.recusasPorLotacao, 0))),
  e('p', { class: 'nota' }, 'Uma sala de 50 assistindo em tela cheia a uma tela em 1440p são uns 300 Mbps numa sala só. Muitas salas encostando no teto base pedem um número maior; recusas frequentes, também.')
]);
componente('nexo-salas', ({ atual: a, contabilidade: c }) => [
  ...titulo('Publicando agora', 'Vista operacional atual. Nomes e estados desta lista não são persistidos no histórico de uso.'),
  a?.salas.length ? e('div', { class: 'lista-salas' }, a.salas.map(s => e('div', { class: 'sala' }, e('strong', {}, s.sala), e('p', {}, `${s.pessoas} pessoa${s.pessoas === 1 ? '' : 's'} no chat`)))) : vazio('As salas aparecem quando alguém entra', 'A coleta continua acompanhando a ociosidade.'),
  tabela('Faixas confirmadas pelo SFU', ['Sala', 'Participante', 'Tipo', 'Faixas publicadas'], (a?.sfu.participantesAtuais || []).map(p => [p.sala, p.nome || 'Sem nome', p.bot ? 'Bot' : 'Pessoa', p.faixas.map(f => `${({ camera: 'Câmera', microphone: 'Voz', screen_share: 'Tela', screen_share_audio: 'Som da tela' })[f.fonte] || f.fonte}${f.altura ? ` · ${f.largura}×${f.altura}${f.altura >= 1440 ? ' · 1440p+' : ''}` : ''}${f.muda ? ' · muda' : ''}`).join('; ') || 'Sem faixa'])),
  e('details', {}, e('summary', {}, 'Ver presença e estado declarados no chat'), tabela('Estado informado pelos navegadores', ['Sala', 'Nome', 'Câmera', 'Tela', 'Microfone'], (a?.salas || []).flatMap(s => s.membros.map(m => [s.sala, m.nome, m.estadoDeclarado.camera ? 'Ligada' : 'Desligada', m.estadoDeclarado.screen ? 'Ligada' : 'Desligada', m.estadoDeclarado.micMuted ? 'Mudo' : 'Ativo'])))),
  e('details', {}, e('summary', {}, 'Telas em 1440p no período'), serie('Telas publicadas em 1440p ou mais', c?.telas1440 || [], 'quantidade', v => numero(v, 0)), e('p', { class: 'nota' }, 'Maior quantidade observada em cada janela, sem nomes. A publicação informa o perfil; não prova qual camada foi recebida. Compartilhamentos breves entre coletas podem não aparecer.')),
  e('p', { class: 'nota' }, `Última reconciliação com o SFU: ${quando(a?.sfu.reconciliadoEm)}. A resolução é a informada na publicação. 1440p é do premium: uma tela acima do plano de quem transmite recebe um aviso e, sem ajuste em poucos segundos, é desligada -- só a tela, não a pessoa.`)
]);
// ---------- O que as pessoas relataram ----------
//
// Este componente busca por conta própria, e é o único do painel que faz isso. O motivo é
// custo: o resumo ao vivo viaja a cada dez segundos para cada painel aberto, e carregar até
// cem relatórios técnicos dentro dele multiplicaria por dez o preço de manter a aba na tela
// -- para um dado que ninguém precisa ver segundo a segundo.
//
// Todo texto entra por `e()`, que cria nós de texto. O relato vem de quem quiser escrever
// nele, e nada aqui vira HTML.
class Relatos extends HTMLElement {
  connectedCallback() {
    this.dados = null;
    this.falhou = '';
    // Qual lista este elemento mostra. "Não está funcionando" e "seria bom se" pedem coisas
    // opostas de quem recebe -- o primeiro é urgente e traz diagnóstico; o segundo é para ler
    // com calma. Misturá-los faria a sugestão atrapalhar o problema e o problema enterrar a
    // sugestão. Uma busca só serve as duas, porque a rota devolve as duas.
    this.lista = this.getAttribute('lista') === 'sugestoes' ? 'sugestoes' : 'relatos';
    this.pintar();
    this.buscar();
  }
  async buscar() {
    this.carregando = true;
    this.pintar();
    try {
      const resposta = await fetch('/painel/api/relatos');
      if (resposta.status === 401) { location.assign('/painel/entrar'); return; }
      if (!resposta.ok) throw new Error();
      this.dados = await resposta.json();
      this.falhou = '';
    } catch (_) {
      this.falhou = 'Não foi possível ler os relatos. Os anteriores continuam gravados no servidor.';
    } finally {
      this.carregando = false;
      this.pintar();
    }
  }
  pintar() {
    // Mesma disciplina dos outros: redesenhar não pode tirar o foco de quem está lendo.
    if (this.contains(document.activeElement)) return;
    const abertos = [...this.querySelectorAll('details')].map(d => d.open);
    this.replaceChildren(...this.desenhar().flat(Infinity).filter(n => n != null));
    this.querySelectorAll('details').forEach((d, i) => { d.open = abertos[i] || false; });
  }
  desenhar() {
    const atualizar = e('button', { class: 'discreto', type: 'button' }, this.carregando ? 'Atualizando…' : 'Atualizar');
    atualizar.addEventListener('click', () => this.buscar());
    if (this.carregando) atualizar.setAttribute('disabled', '');
    const ehSugestao = this.lista === 'sugestoes';
    const cabeca = [
      ...titulo(
        ehSugestao ? 'O que as pessoas pediram' : 'O que as pessoas relataram',
        ehSugestao
          ? 'Enviado pelo botão de sugestões, na barra lateral da sala. Sem relatório técnico: uma sugestão não tem diagnóstico.'
          : 'Enviado pelo botão do Diagnóstico, dentro da sala. Sem IPs; a sala e o nome vêm da sessão.'),
      atualizar
    ];
    if (this.falhou) return [...cabeca, e('p', { class: 'aviso' }, this.falhou)];
    const lista = this.dados?.[this.lista] || [];
    if (!lista.length) {
      return [...cabeca, vazio(ehSugestao ? 'Nenhuma sugestão ainda' : 'Nenhum relato ainda',
        this.dados?.ausente
          ? 'O arquivo aparece no primeiro envio. Ausência não é prova de que está tudo bem — pode ser que ninguém tenha encontrado o botão.'
          : 'Ausência não é prova de que está tudo bem: pode ser que ninguém tenha encontrado o botão.')];
    }
    return [
      ...cabeca,
      e('div', { class: 'lista-relatos' }, lista.map(r => e('article', { class: 'relato-item' },
        e('header', {},
          e('code', {}, r.protocolo || '—'),
          e('span', {}, quando(Date.parse(r.t))),
          e('span', {}, r.sala ? `sala ${r.sala}` : 'sem sala'),
          e('span', {}, r.nome || 'sem nome')),
        e('p', { class: 'relato-mensagem' }, r.mensagem || '(sem descrição)'),
        r.navegador ? e('p', { class: 'nota' }, r.navegador) : null,
        r.relatorio ? e('details', {}, e('summary', {}, 'Relatório técnico'), e('pre', {}, r.relatorio)) : null))),
      e('p', { class: 'nota' }, `${lista.length} nesta lista, de ${numero(this.dados.total, 0)} envio(s) guardado(s) no total.`
        + ' O arquivo gira quando enche, como o resto da telemetria — o mais antigo é o primeiro a sair.')
    ];
  }
}
customElements.define('nexo-relatos', Relatos);

// ---------- Contas e planos ----------
//
// Busca própria, como os relatos: é uma lista paginada de quem abriu a seção, e não algo que
// viaja a cada dez segundos para cada painel aberto. O premium marcado aqui é o atalho do
// roteiro para receber de apoiadores por PIX antes de a integração de pagamento existir.
const dataCurta = n => n ? new Date(n).toLocaleDateString('pt-BR') : '—';
const descreverPlano = c => c.nivel === 'premium' ? `premium${c.planoAte ? ` até ${dataCurta(c.planoAte)}` : ' sem prazo'}`
  : c.plano === 'premium' ? `premium vencido em ${dataCurta(c.planoAte)}` : 'grátis';
class Contas extends HTMLElement {
  connectedCallback() {
    this.dados = null; this.falhou = ''; this.aviso = ''; this.busca = ''; this.paginas = [''];
    this.escolhida = null;
    this.buscar();
  }
  async buscar(antes = '') {
    this.carregando = true; this.pintar();
    try {
      const resposta = await fetch(`/painel/api/contas?busca=${encodeURIComponent(this.busca)}&antes=${encodeURIComponent(antes)}`);
      if (resposta.status === 401) { location.assign('/painel/entrar'); return; }
      if (!resposta.ok) throw new Error();
      this.dados = await resposta.json(); this.falhou = '';
      if (this.escolhida) this.escolhida = this.dados.contas.find(c => c.codigo === this.escolhida.codigo) || null;
    } catch (_) { this.falhou = 'Não foi possível ler as contas.'; }
    finally { this.carregando = false; this.pintar(); }
  }
  async agir(corpo) {
    const conta = this.escolhida;
    if (!conta) return;
    try {
      const resposta = await fetch(`/painel/api/contas/${encodeURIComponent(conta.codigo)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': lerEstado().csrf || '' }, body: JSON.stringify(corpo)
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível alterar a conta.');
      this.escolhida = dados.conta;
      this.aviso = `${dados.conta.apelido} (@${dados.conta.usuario}): ${descreverPlano(dados.conta)}${dados.conta.suspensaAte && dados.conta.suspensaAte > Date.now() ? `, suspensa até ${dataCurta(dados.conta.suspensaAte)}` : ''}.`;
      await this.buscar(this.paginas.at(-1));
    } catch (erro) { this.aviso = erro.message; this.pintar(); }
  }
  pintar() {
    const abertos = [...this.querySelectorAll('details')].map(d => d.open);
    this.replaceChildren(...this.desenhar().flat(Infinity).filter(n => n != null));
    this.querySelectorAll('details').forEach((d, i) => { d.open = abertos[i] || false; });
  }
  desenhar() {
    const cabeca = titulo('Quem tem conta', 'Contas guardadas no banco desta máquina. Nada de senha, sessão ou id interno aparece aqui; a conta é achada pelo código.');
    if (this.falhou) return [...cabeca, e('p', { class: 'aviso' }, this.falhou)];
    const d = this.dados;
    if (d?.ausente) return [...cabeca, vazio('Contas desligadas', 'Este servidor subiu sem o banco de contas.')];
    const numeros = d?.contagens;
    const campo = e('input', { type: 'search', placeholder: 'Usuário ou código (K7M2-PQ4X)', 'aria-label': 'Buscar conta por usuário ou código' });
    campo.value = this.busca;
    const buscar = e('button', { type: 'submit' }, 'Buscar');
    const formulario = e('form', { class: 'busca-contas', role: 'search' }, campo, buscar);
    formulario.addEventListener('submit', evento => { evento.preventDefault(); this.busca = campo.value.trim(); this.paginas = ['']; this.buscar(); });
    const linhas = (d?.contas || []).map(c => {
      const tr = e('tr', { class: `linha-conta${this.escolhida?.codigo === c.codigo ? ' escolhida' : ''}`, tabindex: '0' },
        [c.apelido, `@${c.usuario}`, c.codigo, descreverPlano(c) + (c.suspensaAte && c.suspensaAte > Date.now() ? ' · suspensa' : ''), dataCurta(c.criadaEm), dataCurta(c.vistaEm)].map(v => e('td', {}, v)));
      const escolher = () => { this.escolhida = c; this.aviso = ''; this.pintar(); };
      tr.addEventListener('click', escolher);
      tr.addEventListener('keydown', evento => { if (evento.key === 'Enter') escolher(); });
      return tr;
    });
    const tabelaDeContas = linhas.length
      ? e('div', { class: 'tabela', tabindex: '0', 'aria-label': 'Contas' }, e('table', {}, e('caption', {}, this.busca ? 'Resultado da busca' : 'Mais recentes primeiro. Clique numa conta para mudar o plano.'),
        e('thead', {}, e('tr', {}, ['Apelido', 'Usuário', 'Código', 'Plano', 'Criada', 'Vista'].map(n => e('th', { scope: 'col' }, n)))), e('tbody', {}, linhas)))
      : vazio(this.busca ? 'Nenhuma conta com esse usuário ou código' : 'Nenhuma conta ainda', 'As contas aparecem aqui assim que alguém se cadastrar em /conta.');
    const paginacao = [];
    if (!this.busca && this.paginas.length > 1) {
      const voltar = e('button', { type: 'button', class: 'discreto' }, '← Mais recentes');
      voltar.addEventListener('click', () => { this.paginas.pop(); this.buscar(this.paginas.at(-1)); });
      paginacao.push(voltar);
    }
    if (!this.busca && d?.proxima) {
      const seguir = e('button', { type: 'button', class: 'discreto' }, 'Mais antigas →');
      seguir.addEventListener('click', () => { this.paginas.push(d.proxima); this.buscar(d.proxima); });
      paginacao.push(seguir);
    }
    return [
      ...cabeca,
      e('div', { class: 'metricas' }, metrica('Contas', numero(numeros?.total, 0)), metrica('Premium ativos', numero(numeros?.premium, 0)), metrica('Suspensas agora', numero(numeros?.suspensas, 0))),
      // Com poucos dias o gráfico teria duas barras esticadas até a largura inteira; o
      // contêiner o mantém do tamanho de uma lista curta.
      d?.cadastrosPorDia?.length ? e('div', { class: 'grafico-compacto' }, barras('Cadastros por dia · últimos 30 dias', d.cadastrosPorDia.slice(-14).map(x => ({ nome: x.dia.split('-').reverse().slice(0, 2).join('/'), valor: x.total })), v => numero(v, 0))) : null,
      formulario, this.aviso ? e('p', { class: 'nota', role: 'status' }, this.aviso) : null,
      this.escolhida ? this.desenharAcoes(this.escolhida) : null,
      tabelaDeContas, paginacao.length ? e('div', { class: 'busca-contas' }, paginacao) : null,
      e('p', { class: 'nota' }, 'Premium à mão é o atalho para quem pagar por PIX direto, antes de a integração de pagamento existir. O prazo vence sozinho: vencido, a conta volta a transmitir como grátis, e a qualidade que a pessoa escolheu continua guardada para quando renovar.')
    ];
  }
  desenharAcoes(conta) {
    const dias = e('input', { type: 'number', min: '1', max: '3650', value: '30', 'aria-label': 'Dias' });
    const botao = (rotulo, classe, acao) => { const b = e('button', { type: 'button', class: classe }, rotulo); b.addEventListener('click', acao); return b; };
    const suspensa = conta.suspensaAte && conta.suspensaAte > Date.now();
    return e('div', { class: 'acoes-conta' },
      e('strong', {}, `${conta.apelido} · @${conta.usuario} · ${conta.codigo}`),
      e('div', { class: 'botoes' },
        dias, e('span', { class: 'nota' }, 'dias'),
        botao('Premium por estes dias', '', () => this.agir({ acao: 'premium', dias: Number(dias.value) })),
        botao('Premium sem prazo', 'secundario', () => this.agir({ acao: 'premium' })),
        conta.plano === 'premium' ? botao('Voltar ao grátis', 'secundario', () => this.agir({ acao: 'gratis' })) : null,
        suspensa ? botao('Reativar', 'secundario', () => this.agir({ acao: 'reativar' }))
          : botao('Suspender por estes dias', 'perigo', () => { if (confirm(`Suspender ${conta.apelido}? A conta sai de todos os aparelhos agora.`)) this.agir({ acao: 'suspender', dias: Number(dias.value) }); })));
  }
}
customElements.define('nexo-contas', Contas);

// ---------- A tela por WebCodecs ----------
//
// O botão de pânico do caminho novo. Desligar aqui vale para todo mundo em segundos: quem já
// está numa sala recebe o aviso pelo socket, e quem entra recebe junto com a credencial. Cada
// aparelho continua decidindo sozinho se USA o caminho novo -- esta chave só pode proibir.
const origemDaChave = { ambiente: 'fixada pela variável NEXO_WEBCODECS', painel: 'escolhida aqui no painel', padrao: 'padrão, nada escolhido' };
class Midia extends HTMLElement {
  connectedCallback() { this.dados = null; this.falhou = ''; this.aviso = ''; this.ler(); }
  async ler() {
    try {
      const resposta = await fetch('/painel/api/midia');
      if (resposta.status === 401) { location.assign('/painel/entrar'); return; }
      if (!resposta.ok) throw new Error();
      this.dados = await resposta.json(); this.falhou = '';
    } catch (_) { this.falhou = 'Não foi possível ler a chave de mídia.'; }
    this.pintar();
  }
  async trocar(ligado) {
    try {
      const resposta = await fetch('/painel/api/midia', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': lerEstado().csrf || '' }, body: JSON.stringify({ webcodecs: ligado })
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível mudar a chave.');
      this.dados = dados;
      this.aviso = ligado ? 'Caminho novo liberado. Cada aparelho volta a decidir sozinho se o usa.' : 'Caminho novo desligado para todo mundo. As telas voltam ao caminho de sempre em segundos.';
    } catch (erro) { this.aviso = erro.message; }
    this.pintar();
  }
  pintar() {
    const cabeca = titulo('Tela pela placa de vídeo (WebCodecs)', 'O caminho novo da tela: codificada pela placa de quem transmite e enviada por faixa de dados. Aqui fica a chave que o desliga para todo mundo.');
    if (this.falhou) { this.replaceChildren(...cabeca, e('p', { class: 'aviso' }, this.falhou)); return; }
    if (this.dados?.ausente) { this.replaceChildren(...cabeca, vazio('Chave indisponível', 'Este servidor subiu sem a chave de mídia.')); return; }
    const w = this.dados?.webcodecs;
    const botao = e('button', { type: 'button', class: w?.ligado ? 'perigo' : '' }, w?.ligado ? 'Desligar para todo mundo' : 'Liberar de novo');
    botao.addEventListener('click', () => {
      if (w?.ligado && !confirm('Desligar a tela por WebCodecs em todas as salas? Quem estiver transmitindo por ela volta ao caminho de sempre em segundos.')) return;
      this.trocar(!w?.ligado);
    });
    if (w?.origem === 'ambiente') botao.setAttribute('disabled', '');
    // `replaceChildren` escreve "null" na página para um filho vazio: os ausentes saem antes.
    this.replaceChildren(...[...cabeca,
      e('div', { class: 'metricas' }, metrica('Caminho novo', w ? (w.ligado ? 'liberado' : 'desligado') : '—'), metrica('Origem da chave', w ? origemDaChave[w.origem] || w.origem : '—'), metrica('Mudou em', quando(w?.em))),
      e('div', { class: 'botoes' }, botao),
      this.aviso ? e('p', { class: 'nota', role: 'status' }, this.aviso) : null,
      e('p', { class: 'nota' }, 'Liberado não liga nada à força: no automático, cada aparelho só usa o caminho novo com placa de vídeo, servidor de mídia 1.13.7 ou mais novo e a sala inteira recebendo. Desligado, ninguém usa, nem quem escolheu "Sempre ligada".')
    ].filter(Boolean));
  }
}
customElements.define('nexo-midia', Midia);

componente('nexo-recursos', ({ atual: a, contabilidade: c }) => {
  const r = a?.recursos, s = a?.sfu;
  return [...titulo('A máquina por trás da sala', 'CPU de cada processo: 100% representa um núcleo. RAM inclui os buffers do processo.'),
    tabela('Recursos dos processos', ['Processo', 'CPU', 'Memória', 'Uptime'], [['Node.js', r?.node?.cpu !== null ? `${numero(r?.node?.cpu)}%` : 'Aguardando intervalo', bytes(r?.node?.memoria), duracao(r?.node?.uptime)], ['LiveKit SFU', r?.sfu ? `${numero(r.sfu.cpu)}%` : 'Indisponível', bytes(r?.sfu?.memoria), duracao(s?.uptime)]]),
    // O laço de eventos é por onde passam chat, entrada e sinalização da mídia de TODAS as
    // salas. Um número alto aqui é gente que não consegue começar a ver uma tela.
    e('h4', {}, 'Laço de eventos do Node · últimos 15 s'),
    e('div', { class: 'metricas' },
      metrica('Pior atraso', r?.laco?.piorMs != null ? `${numero(r.laco.piorMs)} ms` : '—'),
      metrica('Atraso p99', r?.laco?.p99Ms != null ? `${numero(r.laco.p99Ms)} ms` : '—'),
      metrica('Tempo ocupado', r?.laco ? `${numero(r.laco.ocupacao * 100)}%` : '—'),
      metrica('Pior atraso no período', c?.picoLacoMs != null ? `${numero(c.picoLacoMs)} ms` : '—')),
    e('p', { class: 'nota' }, `O relógio desta máquina não mede menos que ${numero(r?.laco?.pisoMs ?? 15.6)} ms: um atraso até aí significa "nada".`
      + ' No Windows o piso é ~15,6 ms e o laço ocioso mede 15,5; no Linux do VPS, ~1 ms. Acima de 100 ms, alguma coisa síncrona está segurando as salas.'),
    e('div', { class: 'metricas' }, metrica('Disco em native/', `${bytes(r?.disco?.bytes)}${r?.disco?.parcial ? ' · parcial' : ''}`), metrica('Soundboard em RAM', bytes(a?.soundboard.contabilizado)), metrica('Reinícios do SFU neste Node', numero(s?.reinicios, 0)), metrica('Tentativas consecutivas', numero(s?.tentativasSeguidas, 0))),
    e('p', { class: 'nota' }, `Disco conferido em ${quando(r?.disco?.em)}. Sons são temporários em RAM; músicas são transmitidas por pipelines. CPU de ferramentas auxiliares não está atribuída aos dois processos acima.`),
    tabela('Saída por interface de rede', ['Interface', 'Saída média no intervalo'], (r?.redes || []).map(n => [n.nome, `${numero(n.saidaMbps, 2)} Mbps`])),
    e('p', { class: 'nota' }, 'A rede inclui outros programas. Interfaces virtuais podem contar o mesmo tráfego; o pico usa a maior interface observada, sem somá-las.'),
    a?.coleta.banda.falha || a?.coleta.uso.falha || a?.coleta.banda.descartados || a?.coleta.uso.descartados ? e('p', { class: 'aviso' }, 'Houve perda de telemetria ou falha de gravação. A mídia continua; o histórico pode estar incompleto.') : null];
});
