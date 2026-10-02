// Amigos: pedir, aceitar, recusar, cancelar, desfazer, apelidar e bloquear.
//
// A regra mora aqui e o SQL em banco.js, como no resto das contas. Para fora, uma conta é sempre
// o CÓDIGO (público, 'K7M2-PQ4X'), nunca o id interno -- o id não sai do servidor
// (docs/plano-contas.md, seção 4).
//
// Decisões (docs/amigos-e-perfil.md):
//   - pedido pelo nome de usuário ou pelo código; dois pedidos cruzados viram amizade na hora;
//   - recusar não avisa ninguém, e quem foi bloqueado não fica sabendo: os pedidos dele recebem a
//     mesma resposta de sempre, e nada é criado;
//   - o apelido que alguém dá a um amigo vale só para quem deu, em todo aparelho;
//   - bloquear desfaz a amizade e os pedidos dos dois lados.
const regras = require('./regras');
const vitrineComum = require('../public/vitrine');

const AMIGOS_MAXIMOS = 200;
const PEDIDOS_MAXIMOS = 50;

// `aoMudar(contaIds, motivo)` avisa o servidor de que a lista dessas contas mudou -- o socket de
// amigos leva a novidade às abas delas (social.js).
function criarAmigos({ contas, agora = Date.now, aoMudar = () => {} }) {
  const banco = contas.banco;
  const falha = (status, error, segundos = null) => ({ ok: false, status, error, segundos });
  const NAO_ACHEI = 'Não achamos ninguém com esse nome de usuário ou código. Confira com a pessoa como está escrito.';

  const permitido = (contaId, tipo) => contas.permitidoParaAConta(contaId, tipo);
  const avisar = (ids, motivo) => { try { aoMudar(ids, motivo); } catch (erro) { console.error('Aviso de amigos:', erro?.message || erro); } };

  // O texto digitado pode ser um código (com ou sem traço, em qualquer caixa) ou um nome de
  // usuário (com ou sem @). O código é tentado primeiro quando o formato bate: um nome de usuário
  // de oito letras que por acaso pareça código ainda é achado logo depois.
  function acharConta(texto) {
    const bruto = String(texto ?? '').trim().slice(0, 64);
    if (!bruto) return null;
    const codigo = regras.normalizarCodigo(bruto);
    if (codigo.length === regras.TAMANHO_DO_CODIGO && !bruto.startsWith('@')) {
      const porCodigo = banco.contaPorCodigo(codigo);
      if (porCodigo) return porCodigo;
    }
    return banco.contaPorUsuario(regras.normalizarUsuario(bruto)) || null;
  }
  const porCodigo = codigo => banco.contaPorCodigo(regras.normalizarCodigo(codigo));
  const ativa = conta => Boolean(conta) && !contas.suspensa(conta);

  // O que a lista mostra de cada pessoa: o cartão público (o mesmo que qualquer um vê) e o
  // apelido que VOCÊ deu. A presença não vem daqui: ela é do momento (social.js).
  function pessoa(conta, perfilGuardado, extra = {}) {
    const guardado = perfilGuardado || banco.perfil(conta.id) || {};
    const cartao = contas.cartaoPublico(conta, guardado);
    return {
      codigo: regras.formatarCodigo(conta.codigo), apelido: conta.apelido,
      perfil: { conta: true, codigo: regras.formatarCodigo(conta.codigo), cor: guardado.cor || null, marca: guardado.marca || null, avatar: guardado.avatar || null },
      ...cartao, ...extra
    };
  }

  function lista(conta) {
    const amigos = [], recebidos = [], enviados = [];
    for (const a of banco.amizadesDe(conta.id)) {
      if (!ativa(a.conta)) continue;
      const item = pessoa(a.conta, { cor: a.perfil.cor, marca: a.perfil.marca, avatar: a.perfil.avatar, vitrine: a.perfil.vitrine, social: a.perfil.social }, {
        apelidoMeu: a.apelidoMeu, desde: a.aceitaEm || a.criadaEm
      });
      if (a.estado === 'aceita') amigos.push(item);
      else (a.pediu ? enviados : recebidos).push(item);
    }
    const porNome = (x, y) => (x.apelidoMeu || x.apelido).localeCompare(y.apelidoMeu || y.apelido, 'pt-BR', { sensitivity: 'base' });
    return {
      amigos: amigos.sort(porNome), recebidos: recebidos.sort((x, y) => y.desde - x.desde), enviados: enviados.sort((x, y) => y.desde - x.desde),
      bloqueados: banco.bloqueadosPor(conta.id).map(b => ({ codigo: regras.formatarCodigo(b.codigo), apelido: b.apelido, perfil: { conta: true, codigo: regras.formatarCodigo(b.codigo), ...b.perfil } }))
    };
  }

  // `de` pediu e `para` aceita: quem chama é sempre `para`, e quem volta na resposta é `de`.
  function aceitarEntre(de, para) {
    banco.aceitarAmizade(de.id, para.id, agora());
    contas.conferirConquistasDeAmigos(de.id);
    contas.conferirConquistasDeAmigos(para.id);
    avisar([de.id, para.id], 'aceita');
    return { ok: true, estado: 'amigos', pessoa: pessoa(de) };
  }

  function pedir(conta, texto) {
    if (!permitido(conta.id, 'amizade-pedir')) return falha(429, 'Pedidos demais em pouco tempo. Aguarde alguns minutos.', 600);
    const alvo = acharConta(texto);
    if (!ativa(alvo)) return falha(404, NAO_ACHEI);
    if (alvo.id === conta.id) return falha(400, 'Esse é você. Para adicionar alguém, use o nome de usuário ou o código dessa pessoa.');
    const bloqueio = banco.bloqueioEntre(conta.id, alvo.id);
    if (bloqueio === conta.id) return falha(409, 'Você bloqueou essa pessoa. Desbloqueie em Amigos → Bloqueados para pedir amizade.');
    // Bloqueado por ela: a mesma resposta de um pedido que saiu, e nada criado.
    if (bloqueio) return { ok: true, estado: 'enviado', pessoa: { codigo: regras.formatarCodigo(alvo.codigo), apelido: alvo.apelido } };
    const existente = banco.amizadeEntre(conta.id, alvo.id);
    if (existente?.estado === 'aceita') return falha(409, `Você e ${alvo.apelido} já são amigos.`);
    if (existente?.de === conta.id) return { ok: true, estado: 'enviado', pessoa: pessoa(alvo) };
    // Ela já tinha pedido: é amizade.
    if (existente?.de === alvo.id) return aceitarEntre(alvo, conta);
    if (vitrineComum.socialEfetivo(banco.perfil(alvo.id)?.social).pedidos === false) return falha(403, `${alvo.apelido} não está recebendo pedidos de amizade agora.`);
    if (banco.contarAmigos(conta.id) >= AMIGOS_MAXIMOS) return falha(409, `Você chegou ao limite de ${AMIGOS_MAXIMOS} amigos.`);
    if (banco.contarPedidosEnviados(conta.id) >= PEDIDOS_MAXIMOS) return falha(409, `Você tem ${PEDIDOS_MAXIMOS} pedidos esperando resposta. Cancele algum antes de pedir outro.`);
    banco.pedirAmizade(conta.id, alvo.id, agora());
    avisar([conta.id, alvo.id], 'pedido');
    return { ok: true, estado: 'enviado', pessoa: pessoa(alvo) };
  }

  function aceitar(conta, codigo) {
    if (!permitido(conta.id, 'amizade-acao')) return falha(429, 'Muitas mudanças seguidas. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    const existente = ativa(alvo) ? banco.amizadeEntre(conta.id, alvo.id) : null;
    if (!existente || existente.estado !== 'pendente' || existente.de !== alvo.id) return falha(404, 'Esse pedido não está mais esperando resposta.');
    if (banco.contarAmigos(conta.id) >= AMIGOS_MAXIMOS) return falha(409, `Você chegou ao limite de ${AMIGOS_MAXIMOS} amigos.`);
    return aceitarEntre(alvo, conta);
  }

  // Recusar um pedido, cancelar o que você mandou, ou desfazer uma amizade: as três apagam a
  // linha do par. Recusar e desfazer não avisam a outra pessoa -- a lista dela só muda.
  function desfazer(conta, codigo) {
    if (!permitido(conta.id, 'amizade-acao')) return falha(429, 'Muitas mudanças seguidas. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    if (!alvo || !banco.amizadeEntre(conta.id, alvo.id)) return falha(404, 'Essa pessoa já não está na sua lista.');
    banco.desfazerAmizade(conta.id, alvo.id);
    avisar([conta.id, alvo.id], 'desfeita');
    return { ok: true };
  }

  function apelidar(conta, codigo, apelido) {
    if (!permitido(conta.id, 'amizade-acao')) return falha(429, 'Muitas mudanças seguidas. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    if (!alvo || banco.amizadeEntre(conta.id, alvo.id)?.estado !== 'aceita') return falha(404, 'Só dá para dar apelido a quem é seu amigo.');
    const limpo = regras.limparApelido(apelido);
    banco.definirApelidoDeAmigo(conta.id, alvo.id, limpo || null);
    avisar([conta.id], 'apelido');
    return { ok: true, apelidoMeu: limpo || null };
  }

  function bloquear(conta, codigo) {
    if (!permitido(conta.id, 'amizade-acao')) return falha(429, 'Muitas mudanças seguidas. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    if (!alvo) return falha(404, NAO_ACHEI);
    if (alvo.id === conta.id) return falha(400, 'Não dá para bloquear a si mesmo.');
    banco.bloquear(conta.id, alvo.id, agora());
    avisar([conta.id, alvo.id], 'bloqueio');
    return { ok: true };
  }

  function desbloquear(conta, codigo) {
    if (!permitido(conta.id, 'amizade-acao')) return falha(429, 'Muitas mudanças seguidas. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    if (!alvo || !banco.desbloquear(conta.id, alvo.id)) return falha(404, 'Essa pessoa não está bloqueada.');
    avisar([conta.id], 'desbloqueio');
    return { ok: true };
  }

  // Abrir o cartão de alguém pelo código: o que qualquer um vê, mais o que a relação diz -- é
  // amigo, pediu, foi pedido, bloqueou. Quem bloqueou você vê o cartão como qualquer um.
  function cartao(conta, codigo) {
    if (!permitido(conta.id, 'perfil-ver')) return falha(429, 'Muitos perfis abertos em pouco tempo. Aguarde um minuto.', 60);
    const alvo = porCodigo(codigo);
    if (!ativa(alvo)) return falha(404, 'Essa conta não existe mais.');
    const relacao = relacaoEntre(conta, alvo);
    const apelidoMeu = relacao === 'amigos' ? banco.amizadesDe(conta.id).find(a => a.outro === alvo.id)?.apelidoMeu || null : null;
    return { ok: true, pessoa: pessoa(alvo, null, { relacao, apelidoMeu, eu: alvo.id === conta.id }) };
  }

  function relacaoEntre(conta, alvo) {
    if (alvo.id === conta.id) return 'eu';
    if (banco.bloqueioEntre(conta.id, alvo.id) === conta.id) return 'bloqueado';
    const a = banco.amizadeEntre(conta.id, alvo.id);
    if (!a) return 'nenhuma';
    if (a.estado === 'aceita') return 'amigos';
    return a.de === conta.id ? 'enviado' : 'recebido';
  }

  const saoAmigos = (a, b) => banco.amizadeEntre(a, b)?.estado === 'aceita';

  return { acharConta, lista, pedir, aceitar, desfazer, apelidar, bloquear, desbloquear, cartao, saoAmigos, relacaoEntre, AMIGOS_MAXIMOS, PEDIDOS_MAXIMOS };
}

module.exports = { criarAmigos, AMIGOS_MAXIMOS, PEDIDOS_MAXIMOS };
