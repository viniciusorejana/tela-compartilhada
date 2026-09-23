// Quem manda em cada sala, e o que isso permite.
//
// A sala do Nexo é efêmera por projeto: ela nasce quando alguém entra, e tudo o que existe
// dentro dela -- histórico do chat, sons, música -- morre quando ela fecha (salas.js). A
// moderação segue a mesma regra: o banimento dura 60 minutos e morre com a sala, e o
// banimento permanente vem junto com as salas persistentes, no mesmo lugar.
//
// O que existe aqui: quem chega primeiro é o dono. Se o dono sai, alguém assume, porque sala
// cheia sem ninguém para moderar é pior do que qualquer regra de sucessão que se possa
// discutir.
//
// ---------- A chave de cada pessoa: a conta, ou a identidade ----------
//
// O socket cai -- rede móvel, aba em segundo plano, Wi-Fi oscilando --, e por isso ninguém é
// chaveado pelo socket. Quem NÃO tem conta é chaveado pela identidade de mídia, que sobrevive
// a essas oscilações (é ela que a credencial da sessão retoma). Quem TEM conta é chaveado pela
// conta, que sobrevive também ao F5, a outro navegador e a outro aparelho.
//
// ---------- Ausente não é "saiu" ----------
//
// Quem tem conta e sai fica AUSENTE por 60 segundos, guardando o lugar. Voltou dentro do
// prazo, com a mesma conta, retoma o lugar -- e com ele a sala, se era o dono. Era isso que o
// F5 custava: a desconexão tirava o dono da fila, o segundo virava dono, e quem voltava
// entrava no fim. Enquanto o dono está ausente, os poderes ficam com o próximo presente: a
// sala nunca fica sem quem modere.
//
// Quem não tem conta não tem como ser reconhecido na volta -- o F5 sorteia outra identidade
// --, então sair é sair.
//
// ---------- Sucessão ----------
//
// Quando o dono sai de vez, assume a conta presente mais antiga; sem conta presente, o
// anônimo presente mais antigo. "Só conta abre sala" (salas.js) seria meia verdade se a sala
// passasse a um anônimo com uma conta ali dentro. O anônimo continua na regra para que a sala
// nunca fique sem moderação.
//
// A TRANSFERÊNCIA explícita é respeitada como foi feita, inclusive para quem não tem conta:
// foi uma escolha de quem era dono. E quem transferiu não retoma nada ao voltar.
//
// ---------- Banimento que acerta a pessoa certa ----------
//
// Quatro regras (docs/plano-contas.md, "Banimento que acerta a pessoa certa"):
//
//   1. Quem tem conta é banido pela CONTA. F5, troca de apelido, outro aparelho: nada escapa,
//      e nenhuma outra pessoa com o mesmo nome é atingida.
//   2. Quem não tem conta é banido pelo NOME, e o banimento por nome só vale para anônimos.
//      Uma Ana com conta nunca é barrada pelo banimento de uma Ana anônima.
//   3. Banir uma conta também barra o apelido dela para anônimos. Sem isso, bastaria sair da
//      conta e voltar anônimo com o mesmo nome.
//   4. Quem é barrado por nome recebe a saída: entrar com a própria conta. O dano colateral que
//      sobra -- um anônimo homônimo -- vira motivo para criar conta, com porta em vez de parede.
//
// ---------- O que nenhuma lista de banidos fecha ----------
//
// Voltar com outro nome, ou com outra conta: é uma identidade nova, e a lista diz quem NÃO
// entra -- uma identidade nova não está nela. O que fecha isso é inverter, dizer quem ENTRA: a
// tranca com aprovação, que o dono liga no mesmo gesto de banir ("banir e trancar").
//
// A alternativa seria banir por origem de rede, e ela foi recusada de propósito: dois amigos
// na mesma casa saem pela mesma origem, e banir um tiraria o outro. Num produto cujo caso
// central é um grupo de amigos, esse falso positivo é pior do que a brecha que ele fecharia.

// O nome que a identidade carrega. `lastIndexOf` e não `split('#')`: o nome escolhido pode
// conter '#', e o sufixo é sempre o ÚLTIMO segmento -- partir no primeiro '#' cortaria o
// nome no lugar errado e faria duas pessoas diferentes compartilharem um banimento.
function nomeDaIdentidade(identidade) {
  const texto = String(identidade || '');
  const corte = texto.lastIndexOf('#');
  return (corte > 0 ? texto.slice(0, corte) : texto).trim().toLowerCase();
}
const normalizarNome = nome => String(nome || '').trim().toLowerCase();

// Um mapa por papel, e não `if (ehDono)` espalhado pelo código. A diferença aparece no
// próximo degrau: acrescentar "moderador" passa a ser uma linha aqui, em vez de uma busca
// por todos os lugares que perguntavam se alguém era dono.
const PERMISSOES = Object.freeze({
  dono: Object.freeze(['expulsar', 'banir', 'transferir']),
  participante: Object.freeze([])
});

// Quanto tempo um banimento vale. Ele morre com a sala de qualquer forma; este teto existe
// para o caso de a sala ficar viva por horas -- uma exaltação no meio de uma partida não
// deveria custar o resto da noite.
const MINUTOS_DE_BANIMENTO = 60;
// Teto de banidos por sala. Sem ele, uma sala longa acumularia identidades sem limite.
const MAXIMO_DE_BANIDOS = 64;
// Quanto tempo quem tem conta guarda o lugar depois de sair. O mesmo prazo da carência da
// sala vazia (salas.js): um F5 lento, uma troca de rede, cabem nele com folga.
const MS_DE_AUSENCIA = 60000;
// Quem passou pela sala há pouco, para que banir quem acabou de sair acerte a conta dela, e
// não só o nome. Com teto, porque uma sala longa vê muita gente passar.
const VISTOS_POR_SALA = 256;

function criarModeracao({ agora = Date.now, maximoDeSalas = 512, msDeAusencia = MS_DE_AUSENCIA } = {}) {
  // sala -> { membros: Map<chave, membro>, dono: chave|null, ordem: número, banidos, vistos }
  //   membro:  { chave, contaId, nome, identidades: Set, identidade, ordem, ausenteAte }
  //   banidos: Map<id, { conta, nome, exibir, ate }>
  const salas = new Map();

  function estado(sala) {
    let item = salas.get(sala);
    if (!item) {
      if (salas.size >= maximoDeSalas) return null;
      item = { membros: new Map(), dono: null, ordem: 0, banidos: new Map(), vistos: new Map() };
      salas.set(sala, item);
    }
    return item;
  }

  const presente = m => Boolean(m) && m.ausenteAte === null;

  // Quem ficou ausente além do prazo saiu de vez. Se era o dono, a sucessão acontece aqui,
  // e é definitiva: quem assumiu durante a ausência continua.
  function vencerAusencias(item) {
    const instante = agora();
    for (const [chave, m] of item.membros) {
      if (m.ausenteAte !== null && m.ausenteAte <= instante) item.membros.delete(chave);
    }
    if (item.dono !== null && !item.membros.has(item.dono)) item.dono = sucessor(item)?.chave ?? null;
  }

  function sucessor(item) {
    const presentes = [...item.membros.values()].filter(presente).sort((a, b) => a.ordem - b.ordem);
    return presentes.find(m => m.contaId) || presentes[0] || null;
  }

  // O dono de fato AGORA: o dono, se estiver presente; se estiver ausente, o próximo presente,
  // pela regra da sucessão -- sem tirar o lugar de quem pode voltar.
  function donoEfetivo(item) {
    vencerAusencias(item);
    const dono = item.membros.get(item.dono);
    return presente(dono) ? dono : sucessor(item);
  }

  function membroDaIdentidade(item, identidade) {
    if (!identidade) return null;
    for (const m of item.membros.values()) if (m.identidades.has(identidade)) return m;
    return null;
  }

  function lembrar(item, identidade, dados) {
    item.vistos.delete(identidade);
    item.vistos.set(identidade, dados);
    while (item.vistos.size > VISTOS_POR_SALA) item.vistos.delete(item.vistos.keys().next().value);
  }

  // Entrar registra a pessoa. Quem já está (a reconexão, o F5 de quem tem conta dentro do
  // prazo) NÃO volta para o fim: reordenar ali entregaria a sala ao segundo a chegar sempre
  // que o dono tossisse.
  function entrou(sala, identidade, { contaId = null, nome = null } = {}) {
    if (!sala || !identidade) return;
    const item = estado(sala);
    if (!item) return;
    vencerAusencias(item);
    const chave = contaId ? `conta:${contaId}` : `id:${identidade}`;
    const nomeNormal = normalizarNome(nome ?? nomeDaIdentidade(identidade));
    let m = item.membros.get(chave);
    if (!m) {
      m = { chave, contaId: contaId || null, nome: nomeNormal, exibir: String(nome ?? nomeDaIdentidade(identidade)).trim(), identidades: new Set(), identidade, ordem: ++item.ordem, ausenteAte: null };
      item.membros.set(chave, m);
    }
    m.identidades.add(identidade);
    m.identidade = identidade;
    m.nome = nomeNormal;
    m.ausenteAte = null;
    if (item.dono === null) item.dono = chave;
    lembrar(item, identidade, { contaId: m.contaId, nome: nomeNormal, exibir: m.exibir });
  }

  function saiu(sala, identidade) {
    const item = salas.get(sala);
    if (!item || !identidade) return;
    const m = membroDaIdentidade(item, identidade);
    if (!m) return;
    m.identidades.delete(identidade);
    // A mesma conta aberta em outra aba continua presente.
    if (m.identidades.size) { m.identidade = [...m.identidades].at(-1); return; }
    if (m.contaId) m.ausenteAte = agora() + msDeAusencia;
    else item.membros.delete(m.chave);
    vencerAusencias(item);
    esquecerSeVazia(sala, item);
  }

  // A sala é esquecida quando não sobra nada dela: sem gente, sem ausente guardando lugar e
  // sem banimento vivo. Um banimento precisa sobreviver à saída de quem baniu, ou expulsar
  // seria inútil -- bastava o dono sair um instante para o banido voltar.
  function esquecerSeVazia(sala, item) {
    limparBanidos(item);
    if (!item.membros.size && !item.banidos.size) salas.delete(sala);
  }

  function limparBanidos(item) {
    const instante = agora();
    for (const [id, dados] of item.banidos) if (dados.ate <= instante) item.banidos.delete(id);
  }

  function dono(sala) {
    const item = salas.get(sala);
    return item ? donoEfetivo(item)?.identidade || null : null;
  }

  function papel(sala, identidade) {
    const item = salas.get(sala);
    if (!identidade || !item) return 'participante';
    const efetivo = donoEfetivo(item);
    return efetivo && efetivo.identidades.has(identidade) ? 'dono' : 'participante';
  }

  function pode(sala, identidade, acao) {
    return PERMISSOES[papel(sala, identidade)].includes(acao);
  }

  // Devolve `{ ok }` ou `{ ok: false, motivo }`. O motivo é o que a sala mostra para quem
  // pediu, então ele precisa dizer a razão e não só negar.
  function decidir(sala, quemPede, alvo, acao) {
    const item = salas.get(sala);
    if (!item) return { ok: false, motivo: 'sala-desconhecida' };
    if (!pode(sala, quemPede, acao)) return { ok: false, motivo: 'sem-permissao' };
    if (!alvo) return { ok: false, motivo: 'alvo-desconhecido' };
    // O dono não se expulsa -- nem por outra aba da própria conta. O mesmo caminho serve para
    // "expulsar" e para um clique acidental na própria linha da lista.
    if (alvo === quemPede || membroDaIdentidade(item, quemPede)?.identidades.has(alvo)) return { ok: false, motivo: 'nao-em-si-mesmo' };
    if (papel(sala, alvo) === 'dono') return { ok: false, motivo: 'alvo-e-dono' };
    return { ok: true };
  }

  // Quem é o alvo, esteja ele presente, ausente ou só de passagem.
  function quemE(item, identidade) {
    const m = membroDaIdentidade(item, identidade);
    if (m) return { contaId: m.contaId, nome: m.nome, exibir: m.exibir };
    return item.vistos.get(identidade) || { contaId: null, nome: nomeDaIdentidade(identidade), exibir: nomeDaIdentidade(identidade) };
  }

  function banir(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'banir');
    if (!decisao.ok) return decisao;
    const item = salas.get(sala);
    const pessoa = quemE(item, alvo);
    if (!pessoa.nome && !pessoa.contaId) return { ok: false, motivo: 'alvo-desconhecido' };
    limparBanidos(item);
    // Regra 1: conta pela conta. Regra 3: o apelido dela vai junto, e vale para anônimos --
    // é o mesmo registro, lido pelos dois caminhos em `banido`.
    const id = pessoa.contaId ? `conta:${pessoa.contaId}` : `nome:${pessoa.nome}`;
    // O teto vale para registros NOVOS. Renovar um banimento que já existe não aumenta o mapa,
    // e recusá-lo deixaria a sala cheia incapaz de re-banir justamente quem já incomodou uma
    // vez -- o caso em que a ação mais importa.
    if (!item.banidos.has(id) && item.banidos.size >= MAXIMO_DE_BANIDOS) return { ok: false, motivo: 'banidos-demais' };
    item.banidos.set(id, { conta: pessoa.contaId, nome: pessoa.nome, exibir: pessoa.exibir || pessoa.nome, ate: agora() + MINUTOS_DE_BANIMENTO * 60000 });
    // Quem foi banido não guarda lugar nenhum: nem o de ausente, nem a sala, se era dela.
    const m = membroDaIdentidade(item, alvo) || (pessoa.contaId ? item.membros.get(`conta:${pessoa.contaId}`) : null);
    if (m) { item.membros.delete(m.chave); vencerAusencias(item); }
    return { ok: true, minutos: MINUTOS_DE_BANIMENTO, porConta: Boolean(pessoa.contaId) };
  }

  // Expulsar exige que a pessoa esteja na sala; banir, não. Banir quem acabou de sair é o
  // caso mais comum de todos. Já dizer "foi removida" sobre quem nem estava lá é relatar uma
  // ação que não aconteceu.
  function expulsar(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'expulsar');
    if (!decisao.ok) return decisao;
    const item = salas.get(sala);
    const m = membroDaIdentidade(item, alvo);
    if (!presente(m)) return { ok: false, motivo: 'alvo-fora-da-sala' };
    // Expulso não retoma o lugar pela ausência: a volta, se vier, é como quem chega agora.
    item.membros.delete(m.chave);
    return { ok: true };
  }

  // Passar a sala para outra pessoa. É respeitada como foi feita -- inclusive para quem não
  // tem conta --, e quem passou não retoma nada ao voltar.
  function transferir(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'transferir');
    if (!decisao.ok) return decisao;
    const item = salas.get(sala);
    const m = membroDaIdentidade(item, alvo);
    if (!presente(m)) return { ok: false, motivo: 'alvo-fora-da-sala' };
    item.dono = m.chave;
    return { ok: true };
  }

  // Desbanir existe porque errar é o caso comum. Aceita a chave do registro (a lista a
  // devolve) ou o nome, para quem só tem o nome na mão.
  function desbanir(sala, quemPede, chaveOuNome) {
    const item = salas.get(sala);
    if (!item) return { ok: false, motivo: 'sala-desconhecida' };
    if (!pode(sala, quemPede, 'banir')) return { ok: false, motivo: 'sem-permissao' };
    limparBanidos(item);
    const texto = String(chaveOuNome || '');
    const id = item.banidos.has(texto) ? texto : [...item.banidos].find(([, b]) => !b.conta && b.nome === normalizarNome(texto))?.[0];
    if (!id || !item.banidos.delete(id)) return { ok: false, motivo: 'nao-estava-banido' };
    esquecerSeVazia(sala, item);
    return { ok: true };
  }

  // A lista para quem pode agir sobre ela: quem foi removido, se tinha conta, e quanto falta
  // -- sem isso o dono não tem como saber quem removeu nem se ainda está valendo.
  function listarBanidos(sala) {
    const item = salas.get(sala);
    if (!item) return [];
    limparBanidos(item);
    return [...item.banidos].map(([chave, dados]) => ({
      chave, nome: dados.nome, exibir: dados.exibir, conta: Boolean(dados.conta),
      minutos: Math.max(1, Math.ceil((dados.ate - agora()) / 60000))
    }));
  }

  // `quem` é `{ contaId, nome }`, ou uma identidade de mídia (sem conta). Devolve o prazo e por
  // qual caminho a pessoa foi barrada -- `porNome` é o que faz a sala oferecer a saída da
  // regra 4 em vez de só uma parede.
  function banido(sala, quem) {
    const item = salas.get(sala);
    if (!item || !quem) return null;
    limparBanidos(item);
    const { contaId = null, nome = null } = typeof quem === 'string' ? { nome: nomeDaIdentidade(quem) } : quem;
    let dados = null, porNome = false;
    if (contaId) dados = item.banidos.get(`conta:${contaId}`) || null;
    else {
      const chave = normalizarNome(nome);
      dados = [...item.banidos.values()].find(b => chave && b.nome === chave) || null;
      porNome = Boolean(dados);
    }
    if (!dados) return null;
    return { minutos: Math.max(1, Math.ceil((dados.ate - agora()) / 60000)), porNome };
  }

  // A sala fechou (salas.js): quem estava e quem guardava lugar somem. Os banimentos vivos
  // ficam até o prazo, pela mesma razão de sempre -- senão bastava esvaziar a sala.
  function fechou(sala) {
    const item = salas.get(sala);
    if (!item) return;
    item.membros.clear();
    item.vistos.clear();
    item.dono = null;
    esquecerSeVazia(sala, item);
  }

  function esquecer(sala) { salas.delete(sala); }

  // Quem tem conta troca o apelido no meio da sala (o perfil ao vivo, em server.js). A pessoa
  // é a mesma -- a chave é a conta --, e só o nome mudou: sem isto, banir alguém depois da
  // troca bloquearia, para os anônimos, o apelido ANTIGO dela (regra 3).
  function renomear(sala, identidade, nome) {
    const item = salas.get(sala);
    const m = item && membroDaIdentidade(item, identidade);
    if (!m || !m.contaId) return false;
    m.nome = normalizarNome(nome);
    m.exibir = String(nome).trim();
    lembrar(item, identidade, { contaId: m.contaId, nome: m.nome, exibir: m.exibir });
    return true;
  }

  // Quem tem conta na sala, entre os presentes: é o que decide quem pode apagar sons da mesa
  // e editar mensagens antigas. A conta fica aqui, no servidor.
  function contaDe(sala, identidade) {
    const item = salas.get(sala);
    return item ? membroDaIdentidade(item, identidade)?.contaId || null : null;
  }

  function resumo() {
    return [...salas].map(([sala, item]) => ({
      sala, dono: donoEfetivo(item)?.identidade || null,
      pessoas: [...item.membros.values()].filter(presente).length,
      ausentes: [...item.membros.values()].filter(m => !presente(m)).length,
      banidos: item.banidos.size
    }));
  }

  return { entrou, saiu, dono, papel, pode, expulsar, banir, desbanir, listarBanidos, transferir, banido, fechou, esquecer, contaDe, renomear, resumo, PERMISSOES, MINUTOS_DE_BANIMENTO };
}

module.exports = { criarModeracao, nomeDaIdentidade, PERMISSOES, MINUTOS_DE_BANIMENTO, MAXIMO_DE_BANIDOS, MS_DE_AUSENCIA };
