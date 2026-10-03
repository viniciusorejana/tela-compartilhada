const crypto = require('node:crypto');

const MiB = 1024 * 1024;
const MINUTO = 60000;
const DIA = 24 * 60 * MINUTO;
const REGRAS = Object.freeze({
  // ---------- Contas ----------
  //
  // O freio vem ANTES da fila de derivação de senha (contas/senha.js): uma enxurrada é
  // recusada aqui, sem ocupar lugar na fila de quem está tentando entrar de verdade.
  //
  // Criar conta tem teto diário por origem de rede. É uma TAXA, não um bloqueio: banir por
  // origem continua recusado (moderacao.js explica por quê), mas uma identidade nova a cada
  // minuto é o que tornaria qualquer banimento inútil. Atrás de um túnel sem
  // NEXO_PROXIES_CONFIAVEIS, todo mundo tem a mesma origem -- e o teto passa a ser do
  // servidor inteiro. Ver docs/telemetria.md.
  //
  // O teto conta CONTAS CRIADAS, não pedidos: contas.cadastrar pergunta por ele depois de
  // conferir usuário e senha. Contando pedidos, três erros de digitação trancavam a rede até
  // o dia seguinte -- medido. Os pedidos têm o balde deles, folgado, contra quem varre nomes.
  'cadastrar': { sessao: 3, longa: [3, DIA] },
  'cadastrar-tentativa': { sessao: 15, longa: [60, 60 * MINUTO] },
  'entrar': { sessao: 10, longa: [30, 15 * MINUTO] },
  // Só pedidos bem formados chegam aqui: código com o tamanho certo e senha nova aceitável.
  'recuperar': { sessao: 5, longa: [10, 60 * MINUTO] },
  // Por CONTA, além da origem. Sem isto, uma tentativa por IP a partir de mil IPs passaria
  // por baixo de todo limite por origem.
  'entrar-conta': { sessao: 5, longa: [10, 15 * MINUTO] },
  // A recuperação tem o balde dela: quem esqueceu a senha erra o login antes de lembrar do
  // código, e com um balde só esse erro trancava justamente a saída.
  'recuperar-conta': { sessao: 5, longa: [10, 15 * MINUTO] },
  // O servidor inteiro. É mais ou menos o que a fila de derivação atende sem crescer.
  'entrar-global': { sessao: 120 },
  'conta-escrever': { sessao: 20, longa: [120, 60 * MINUTO] },
  // Quem espera uma sala abrir pergunta a cada cinco segundos, e atrás de um túnel todo mundo
  // divide a mesma origem. Esperar não cria sessão nem estado, então o teto é folgado.
  'sala-espera': { sessao: 300 },
  // Os ajustes sobem sozinhos, dois segundos depois da última mudança. Têm balde próprio para
  // que mexer muito na qualidade nunca impeça ninguém de trocar a senha.
  'conta-ajustes': { sessao: 30, longa: [300, 60 * MINUTO] },
  // Avatar, rosto e imagens do Estúdio: cada envio é uma escrita no banco de até 6 MB (a foto,
  // quando é um GIF animado) ou 12 MB (uma imagem do Estúdio ou do rosto).
  'conta-imagem': { sessao: 20, longa: [120, 60 * MINUTO] },
  // O Estúdio salva sozinho, meio segundo depois de cada mudança -- arrastar um controle de
  // tamanho gera uma rajada, e o teto é o de uma pessoa mexendo, não o de um script.
  'conta-estudio': { sessao: 60, longa: [900, 60 * MINUTO] },
  // Achar alguém pelo código, no Estúdio. Gesto de mão, poucas vezes por sessão; o teto longo é
  // o que impede de varrer códigos para colher apelidos.
  'conta-busca': { sessao: 20, longa: [100, 60 * MINUTO] },
  // Cada fonte do OBS é uma página com a sua conexão, e uma cena com seis delas abre seis de
  // uma vez; o OBS as reabre a cada troca de cena com "atualizar ao ficar visível".
  'estudio-conexao': { sessao: 60 },
  // ---------- Amigos, cartão e mensagens diretas (contas/amigos.js, social.js) ----------
  // O socket de amigos abre uma vez por aba logada (o início e cada sala).
  'social-conexao': { sessao: 60 },
  // Pedir amizade é gesto de mão; o teto longo é o que impede de sair pedindo a todo código.
  'amizade-pedir': { sessao: 10, longa: [60, 60 * MINUTO] },
  'amizade-acao': { sessao: 40, longa: [400, 60 * MINUTO] },
  // O cartão é salvo por um botão, e não a cada clique; as imagens têm o balde de 'conta-imagem'.
  'conta-vitrine': { sessao: 30, longa: [400, 60 * MINUTO] },
  'conta-social': { sessao: 30, longa: [300, 60 * MINUTO] },
  // Abrir o cartão de alguém pelo código: é o que a lista de amigos e a sala fazem a cada clique
  // num nome, e o teto longo é o mesmo da busca do Estúdio -- não dá para varrer códigos.
  'perfil-ver': { sessao: 60, longa: [600, 60 * MINUTO] },
  // Mensagem direta: uma conversa animada manda várias seguidas; uma rajada de oito em três
  // segundos já é colar texto em laço.
  'dm-enviar': { sessao: 40, rajada: [8, 3000], longa: [600, 60 * MINUTO] },
  // A imagem na mensagem direta pesa na memória do servidor (social.js tem o teto dela): poucas
  // por minuto bastam para mostrar um print, e uma pasta inteira colada de uma vez não passa.
  'dm-imagem': { sessao: 10, rajada: [4, 10000], longa: [120, 60 * MINUTO] },
  'dm-acao': { sessao: 90 },
  'dm-digitando': { sessao: 40 },
  'convidar': { sessao: 10, longa: [80, 60 * MINUTO] },
  'social-total': { sessao: 300, rajada: [60, 5000] },
  // As imagens de perfil descem para cada pessoa da sala, uma vez por imagem (cache eterno).
  // Atrás de um túnel todo mundo divide a mesma origem, então o teto é folgado.
  'imagem': { sessao: 1200 },
  'estudio-link': { sessao: 30, sala: 120 },
  'estudio-permissao': { sessao: 12, sala: 120 },
  'soundboard-tocar': { sessao: 30, sala: 90, intervalo: 400 },
  // Parar só vale para o próprio som, que só existe depois de um "tocar": o teto acompanha o dele.
  'soundboard-parar': { sessao: 30, sala: 90 },
  'soundboard-upload': { sessao: 6, sala: 24 },
  'soundboard-bytes': { sessao: 12 * MiB, sala: 48 * MiB },
  'soundboard-download': { sessao: 90, sala: 900 },
  'soundboard-download-bytes': { sessao: 48 * MiB, sala: 512 * MiB },
  'soundboard-remover': { sessao: 30, sala: 90 },
  'soundboard-lista': { sessao: 30, sala: 300 },
  'musica-comando': { sessao: 20, sala: 60 },
  // Arrastar faixas é um gesto de muitos passos seguidos, mas cada um é barato: nenhum baixa
  // nada nem procura nada. O teto coletivo é o que impede uma pessoa de sequestrar a fila.
  'musica-fila': { sessao: 40, sala: 120 },
  'musica-busca': { sessao: 6, sala: 24 },
  'musica-estado': { sessao: 30, sala: 300 },
  'musica-saude': { sessao: 30, sala: 300 },
  'chat-message': { sessao: 40, sala: 240, rajada: [6, 2000] },
  'chat-imagem': { sessao: 4, sala: 40 },
  'chat-bytes': { sessao: 4 * MiB, sala: 20 * MiB },
  // Reagir, responder e fixar são baratos por unidade e naturalmente frequentes; o que eles
  // não podem é virar enxurrada. Sem regra própria caíam em 'outros', que não tem teto
  // COLETIVO -- e o teto coletivo é justamente o que protege a sala do dedo preso no botão.
  'chat-acao': { sessao: 45, sala: 220, rajada: [10, 2000] },
  // A reação que atravessa a sala é a única daqui que vira animação na tela de todo mundo,
  // então ela é a mais apertada: cabe comemorar, não cabe metralhar.
  'sinal-presenca': { sessao: 20, sala: 90, rajada: [5, 3000] },
  'sala-configurar': { sessao: 20, sala: 60 },
  'resolver-entrada': { sessao: 30, sala: 90 },
  // A medida de latência: uma ida e volta a cada cinco segundos, e o servidor só confirma o
  // recebimento. O teto é o dobro do ritmo esperado -- sobra para a volta de uma reconexão,
  // que mede de novo na hora, sem abrir espaço para quem quiser usar isto como metrônomo.
  'eco': { sessao: 26, sala: 400 },
  'join-room': { sessao: 6, sala: 120, longa: [20, 10 * MINUTO] },
  'leave-room': { sessao: Infinity },
  // Ensurdecer tem freio próprio, e não o da presença: lá as reações gastam a rajada, e um aviso
  // de ensurdecer descartado deixaria a sala vendo a pessoa ouvindo quando ela não ouve.
  'ensurdecer': { sessao: 30, sala: 600 },
  // A lista de telas que a página está vendo. Muda a cada Assistir e Parar, e o transporte a
  // manda de novo sozinho quando uma queda retoma uma tela; ninguém clica trinta vezes por
  // minuto, mas uma sala de vinte pessoas trocando de tela junto chega perto do coletivo.
  'assistindo': { sessao: 30, sala: 600 },
  // Moderar é deliberado e raro. O teto baixo aqui protege menos o servidor do que a própria
  // sala: um dono irritado clicando em expulsar dez vezes por segundo é o retrato de algo
  // que precisa de um segundo de pausa.
  'moderar': { sessao: 12, sala: 40 },
  'medicao-de-banda': { sessao: 3, sala: 1536 },
  'audio-start': { sessao: 12, sala: 60 },
  'audio-stop': { sessao: Infinity },
  'audio-escolha': { sessao: 12, sala: 60 },
  'audio-capabilities': { sessao: 30 },
  'registrar-agente': { sessao: 12 },
  'agente-aplicativos': { sessao: 30 },
  'agente-controle': { sessao: 120 },
  'agente-pacotes': { sessao: 12000 },
  'agente-bytes': { sessao: 32 * MiB },
  // Um relato é um gesto deliberado de quem está com problema, então o teto é baixo de
  // propósito: quem manda três num minuto está testando o campo, não relatando. E cada um
  // carrega até 16 KB de relatório técnico, o que faz deste o evento mais caro por unidade.
  'relato': { sessao: 3, sala: 12, longa: [10, 10 * MINUTO] },
  'sala-token': { sessao: 20, sala: 300 },
  'conexao': { sessao: 60 },
  'origem-token': { sessao: 120 },
  'origem-http': { sessao: 300 },
  'total': { sessao: 300, rajada: [60, 5000] },
  'publicacao': { sessao: 20, observar: true },
  'republicacao': { sessao: 4, longa: [12, 5 * MINUTO], observar: true },
  'transicao': { sessao: 12, observar: true },
  'churn-sfu': { sessao: 12, observar: true },
  'outros': { sessao: 30 }
});

// Doze fatias por janela limitam memória mesmo para uploads em milhares de pedaços.
// A fatia de borda permanece inteira: no pior caso espera-se alguns segundos a mais.
function somar(contador, quantidade, agora, periodo) {
  const passo = Math.max(100, Math.ceil(periodo / 12));
  const fatia = Math.floor(agora / passo);
  contador.partes = contador.partes.filter(p => p[0] >= fatia - 12);
  const ultima = contador.partes.at(-1);
  if (ultima?.[0] === fatia) ultima[1] += quantidade;
  else contador.partes.push([fatia, quantidade]);
  return contador.partes.reduce((s, p) => s + p[1], 0);
}

function criarAntiabuso({ agora = Date.now, aoAlertar = () => {}, maximo = 2048, maximoSalas = 512, regras = {} } = {}) {
  const sessoes = new Map(), salas = new Map(), taxas = new Map(), taxasSocket = new Map();
  const configuradas = Object.fromEntries(Object.entries(REGRAS).map(([k, v]) => [k, { ...v, ...regras[k] }]));
  let saturacoes = 0;
  let global = { partes: [] };
  // Um contador parado há dez minutos era esquecido -- o que zerava, sem ninguém ver, qualquer
  // janela mais longa que isso: o teto diário de cadastros voltava a três a cada dez minutos
  // de silêncio. Agora cada contador vive até a janela mais longa que ele carrega acabar.
  function limpar() {
    const instante = agora(), limite = instante - 10 * MINUTO;
    for (const mapa of [sessoes, salas]) for (const [chave, valor] of mapa) if (valor.ultimo < limite && (valor.ate || 0) <= instante) mapa.delete(chave);
  }
  function estado(mapa, chave, teto) {
    let item = mapa.get(chave);
    if (!item) {
      if (mapa.size >= teto) { limpar(); if (mapa.size >= teto) { saturacoes++; return null; } }
      item = { ultimo: agora(), baldes: new Map(), incidentes: new Map(), pseudonimo: crypto.randomBytes(3).toString('hex'), eventos: { partes: [] } };
      mapa.set(chave, item);
    }
    item.ultimo = agora(); return item;
  }
  function contar(item, chave, quantidade, periodo = MINUTO) {
    const contador = item.baldes.get(chave) || { partes: [] };
    item.baldes.set(chave, contador);
    item.ate = Math.max(item.ate || 0, agora() + periodo);
    return somar(contador, quantidade, agora(), periodo);
  }
  function alerta(item, regra, contexto, quantidade, teto, periodo, acao) {
    const anterior = item.incidentes.get(regra);
    // A escrita é uma fotografia agregada do incidente, no máximo uma por minuto.
    if (anterior && agora() - anterior.quando < MINUTO) return;
    const id = anterior && agora() - anterior.quando < 10 * MINUTO ? anterior.id : crypto.randomUUID();
    item.incidentes.set(regra, { quando: agora(), id });
    aoAlertar({ id, t: new Date(agora()).toISOString(), sessao: item.pseudonimo,
      nome: String(contexto.nome || 'Sessão sem nome').slice(0, 40), sala: String(contexto.sala || '').slice(0, 32),
      regra, quantidade, teto, segundos: periodo / 1000, acao });
  }
  function verificar(chave, tipo, contexto = {}, quantidade = 1) {
    tipo = Object.hasOwn(configuradas, tipo) ? tipo : 'outros';
    if (!Number.isFinite(quantidade) || quantidade <= 0) return { ok: false, motivo: 'quantidade-invalida', segundos: 60 };
    const regra = configuradas[tipo];
    const instante = agora();
    // Uma saída sempre precisa poder liberar os recursos que já ocupou.
    if (['leave-room', 'audio-stop'].includes(tipo)) return { ok: true };
    const item = estado(sessoes, String(chave).slice(0, 160), maximo);
    if (!item) return { ok: false, motivo: 'capacidade', segundos: 60 };
    const taxa = taxas.get(tipo) || { tentativas: { partes: [] }, recusadas: { partes: [] } };
    taxas.set(tipo, taxa);
    somar(taxa.tentativas, 1, instante, MINUTO);
    let estourou = null;
    const observar = regra.observar;
    const fonte = ['camera', 'screen', 'microphone', 'screen_share', 'screen_share_audio', 'micAudio', 'screenAudio'].includes(contexto.fonte) ? contexto.fonte : 'outra';
    const nomeRegra = tipo === 'republicacao' ? `${tipo}:${fonte}` : tipo;
    const total = contar(item, nomeRegra, quantidade);
    if (Number.isFinite(regra.sessao) && total > regra.sessao) estourou = [total, regra.sessao, MINUTO];
    for (const [sufixo, par] of [['rajada', regra.rajada], ['longa', regra.longa]]) {
      if (!par) continue;
      const valor = contar(item, `${nomeRegra}:${sufixo}`, quantidade, par[1]);
      if (valor > par[0]) estourou = [valor, par[0], par[1]];
    }
    if (regra.intervalo) {
      const ultimo = item.baldes.get('ultimo-som');
      if (ultimo !== undefined && instante - ultimo < regra.intervalo) estourou = [2, 1, regra.intervalo];
      if (!estourou) item.baldes.set('ultimo-som', instante);
    }
    if (regra.sala && contexto.sala) {
      const sala = estado(salas, String(contexto.sala).slice(0, 32), maximoSalas);
      if (!sala) return { ok: false, motivo: 'capacidade', segundos: 60 };
      const totalSala = contar(sala, tipo, quantidade);
      if (totalSala > regra.sala) {
        // Um teto coletivo não autoriza culpar o último participante que chegou.
        alerta(sala, `${tipo}:sala`, { sala: contexto.sala, nome: 'Limite coletivo da sala' }, totalSala, regra.sala, MINUTO, 'recusado');
        somar(taxa.recusadas, 1, instante, MINUTO);
        return { ok: false, motivo: 'limite-da-sala', segundos: 60 };
      }
    }
    if (estourou) {
      const acao = observar ? 'observado' : 'recusado';
      alerta(item, nomeRegra, contexto, ...estourou, acao);
      if (!observar) somar(taxa.recusadas, 1, instante, MINUTO);
      return { ok: Boolean(observar), excedeu: true, motivo: 'limite', segundos: Math.ceil(estourou[2] / 1000), extremo: tipo === 'total' && total > 900 };
    }
    return { ok: true };
  }
  function permitirGlobal() {
    return somar(global, 1, agora(), 1000) <= 2000;
  }
  function contarEvento(chave, tipo, recusado = false) {
    tipo = Object.hasOwn(REGRAS, tipo) ? tipo : 'outros';
    const item = estado(sessoes, String(chave).slice(0, 160), maximo);
    const taxa = taxasSocket.get(tipo) || { tentativas: { partes: [] }, recusadas: { partes: [] } };
    taxasSocket.set(tipo, taxa);
    somar(taxa[recusado ? 'recusadas' : 'tentativas'], 1, agora(), MINUTO);
    if (item && !recusado) somar(item.eventos, 1, agora(), MINUTO);
  }
  function resumo() {
    limpar();
    const totalRecente = c => somar(c, 0, agora(), MINUTO);
    return { saturacoes, sessoes: sessoes.size, salas: salas.size,
      taxasSocket: [...taxasSocket].map(([tipo, t]) => ({ tipo, tentativas: totalRecente(t.tentativas), recusadas: totalRecente(t.recusadas) })).sort((a, b) => b.tentativas - a.tentativas),
      taxas: [...taxas].map(([tipo, t]) => ({ tipo, tentativas: totalRecente(t.tentativas), recusadas: totalRecente(t.recusadas) })).sort((a, b) => b.tentativas - a.tentativas),
      emissores: [...sessoes.values()].map(s => ({ sessao: s.pseudonimo, eventos: totalRecente(s.eventos) })).filter(s => s.eventos).sort((a, b) => b.eventos - a.eventos).slice(0, 10) };
  }
  return { verificar, contarEvento, permitirGlobal, resumo, limpar, regras: configuradas };
}
// Os tetos ajustados por NEXO_LIMITES, ou `null` se a variável estiver ilegível -- quem chama
// decide se avisa. Mais de uma instância lê isto, e todas precisam ler igual.
function regrasDoAmbiente(texto = process.env.NEXO_LIMITES) {
  try {
    const regras = JSON.parse(texto || '{}');
    return regras && typeof regras === 'object' && !Array.isArray(regras) ? regras : null;
  } catch (_) { return null; }
}
module.exports = { criarAntiabuso, REGRAS, regrasDoAmbiente };
