// Quem manda em cada sala, e o que isso permite.
//
// A sala do Nexo é efêmera por projeto: ela nasce quando alguém entra, e tudo o que existe
// dentro dela -- histórico do chat, sons, música -- morre quando a última pessoa sai. A
// moderação segue a mesma regra, e isso é decisão e não limitação temporária. Um dono que
// sobrevivesse à sala vazia seria, na prática, uma conta -- e conta é outro degrau, com
// cadastro, recuperação de acesso e tudo o que vem atrás.
//
// O que existe aqui: quem chega primeiro é o dono. Se o dono sai, o mais antigo entre os
// que ficaram assume, porque sala cheia sem ninguém para moderar é pior do que qualquer
// regra de sucessão que se possa discutir.
//
// ---------- Por que a chave é a IDENTIDADE, e não o socket ----------
//
// O socket cai. Rede móvel trocando de antena, aba em segundo plano, Wi-Fi oscilando: a
// pessoa não saiu de lugar nenhum e o socket dela reconectou com outro id. Se o dono fosse
// um socket, um engasgo de rede tiraria o dono da própria sala -- e daria a sala a outra
// pessoa. A identidade de mídia sobrevive a isso (é ela que a credencial da sessão retoma),
// então é ela que responde por quem manda.
//
// ---------- Por que o BANIMENTO é pelo nome, e não pela identidade ----------
//
// A identidade de mídia é `nome#<aleatório>`, e o sufixo aleatório é sorteado a cada
// credencial nova. A credencial vive apenas na memória da aba -- então **recarregar a página
// já produz outra identidade**. Um banimento por identidade seria derrotado por um F5, o que
// é pior do que não existir: quem moderou pensaria ter resolvido.
//
// Então a chave é o NOME, normalizado. Ele sobrevive ao F5, que é o caso real.
//
// ---------- O que este arquivo NÃO promete ----------
//
// Trocar o nome escapa do banimento. Isso não tem conserto sem conta, e fingir o contrário
// seria pior do que dizer: banir aqui serve para encerrar uma situação em andamento -- tirar
// quem está incomodando AGORA e impedir que ele volte no minuto seguinte --, não para manter
// alguém fora para sempre.
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

function criarModeracao({ agora = Date.now, maximoDeSalas = 512 } = {}) {
  // sala -> { ordem: [identidade], banidos: Map<identidade, { ate, nome }> }
  const salas = new Map();

  function estado(sala) {
    let item = salas.get(sala);
    if (!item) {
      if (salas.size >= maximoDeSalas) return null;
      item = { ordem: [], banidos: new Map() };
      salas.set(sala, item);
    }
    return item;
  }

  // Entrar é registrar a identidade no fim da fila. Uma identidade que já está na fila NÃO
  // volta para o fim: é o caso da reconexão, e reordenar ali entregaria a sala ao segundo a
  // chegar sempre que o dono tossisse.
  function entrou(sala, identidade) {
    if (!sala || !identidade) return;
    const item = estado(sala);
    if (!item) return;
    if (!item.ordem.includes(identidade)) item.ordem.push(identidade);
  }

  function saiu(sala, identidade) {
    const item = salas.get(sala);
    if (!item || !identidade) return;
    item.ordem = item.ordem.filter(i => i !== identidade);
    // A sala só é esquecida quando não sobra nada dela: sem gente E sem banimento vivo. Um
    // banimento precisa sobreviver à saída de quem baniu, ou expulsar seria inútil -- bastava
    // o dono sair um instante para o banido voltar.
    if (!item.ordem.length && !item.banidos.size) salas.delete(sala);
  }

  function limparBanidos(item) {
    const instante = agora();
    for (const [identidade, dados] of item.banidos) if (dados.ate <= instante) item.banidos.delete(identidade);
  }

  function dono(sala) {
    return salas.get(sala)?.ordem[0] || null;
  }

  function papel(sala, identidade) {
    if (!identidade) return 'participante';
    return dono(sala) === identidade ? 'dono' : 'participante';
  }

  function pode(sala, identidade, acao) {
    return PERMISSOES[papel(sala, identidade)].includes(acao);
  }

  // Devolve `{ ok }` ou `{ ok: false, motivo }`. O motivo é o que a sala mostra para quem
  // pediu, então ele precisa dizer a razão e não só negar.
  function decidir(sala, quemPede, alvo, acao) {
    if (!salas.has(sala)) return { ok: false, motivo: 'sala-desconhecida' };
    if (!pode(sala, quemPede, acao)) return { ok: false, motivo: 'sem-permissao' };
    if (!alvo) return { ok: false, motivo: 'alvo-desconhecido' };
    // O dono não se expulsa. Parece óbvio e não é: o mesmo caminho serve para "expulsar" e
    // para um clique acidental na própria linha da lista, e sem esta guarda a sala perderia
    // quem manda nela por um clique errado.
    if (alvo === quemPede) return { ok: false, motivo: 'nao-em-si-mesmo' };
    if (papel(sala, alvo) === 'dono') return { ok: false, motivo: 'alvo-e-dono' };
    return { ok: true };
  }

  function banir(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'banir');
    if (!decisao.ok) return decisao;
    const nome = nomeDaIdentidade(alvo);
    if (!nome) return { ok: false, motivo: 'alvo-desconhecido' };
    const item = salas.get(sala);
    limparBanidos(item);
    // O teto vale para nomes NOVOS. Renovar um banimento que já existe não aumenta o mapa, e
    // recusá-lo deixaria a sala cheia incapaz de re-banir justamente quem já incomodou uma
    // vez -- o caso em que a ação mais importa.
    if (!item.banidos.has(nome) && item.banidos.size >= MAXIMO_DE_BANIDOS) return { ok: false, motivo: 'banidos-demais' };
    item.banidos.set(nome, { ate: agora() + MINUTOS_DE_BANIMENTO * 60000 });
    return { ok: true, minutos: MINUTOS_DE_BANIMENTO };
  }

  // Expulsar exige que a pessoa esteja na sala; banir, não. A diferença não é pedantismo:
  // banir quem acabou de sair é o caso mais comum de todos -- a pessoa incomodou, saiu
  // sozinha, e quem ficou quer garantir que ela não volte no minuto seguinte. Já dizer "foi
  // removida" sobre quem nem estava lá é relatar uma ação que não aconteceu.
  function expulsar(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'expulsar');
    if (!decisao.ok) return decisao;
    if (!salas.get(sala).ordem.includes(alvo)) return { ok: false, motivo: 'alvo-fora-da-sala' };
    return { ok: true };
  }

  // Passar a sala para outra pessoa. Existe porque quem abriu a sala pode querer sair antes
  // dos outros, e a sucessão automática entregaria a sala a quem calhou de chegar em segundo.
  function transferir(sala, quemPede, alvo) {
    const decisao = decidir(sala, quemPede, alvo, 'transferir');
    if (!decisao.ok) return decisao;
    const item = salas.get(sala);
    if (!item.ordem.includes(alvo)) return { ok: false, motivo: 'alvo-fora-da-sala' };
    item.ordem = [alvo, ...item.ordem.filter(i => i !== alvo)];
    return { ok: true };
  }

  function banido(sala, identidade) {
    const item = salas.get(sala);
    if (!item || !identidade) return null;
    limparBanidos(item);
    const dados = item.banidos.get(nomeDaIdentidade(identidade));
    if (!dados) return null;
    return { minutos: Math.max(1, Math.ceil((dados.ate - agora()) / 60000)) };
  }

  function esquecer(sala) { salas.delete(sala); }

  function resumo() {
    return [...salas].map(([sala, item]) => ({ sala, dono: item.ordem[0] || null, pessoas: item.ordem.length, banidos: item.banidos.size }));
  }

  return { entrou, saiu, dono, papel, pode, expulsar, banir, transferir, banido, esquecer, resumo, PERMISSOES, MINUTOS_DE_BANIMENTO };
}

module.exports = { criarModeracao, nomeDaIdentidade, PERMISSOES, MINUTOS_DE_BANIMENTO, MAXIMO_DE_BANIDOS };
