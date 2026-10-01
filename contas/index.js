// O que uma conta faz: cadastrar, entrar, sair, trocar a senha, recuperar, apagar.
//
// HTTP fica em rotas.js; aqui fica a regra, testável sem servidor. Nada daqui escreve SQL
// (banco.js) nem deriva senha na mão (senha.js).
//
// Uma conta é usuário, apelido e senha. E-mail é opcional: exigi-lo no cadastro arrastaria
// junto um remetente transacional -- o único custo fixo mensal do lançamento inteiro, para um
// problema que ainda não existe. A recuperação é um código mostrado uma vez, e o aviso é
// honesto: perdeu a senha e o código, perdeu a conta.
const crypto = require('node:crypto');
const path = require('node:path');
const { abrirBanco, ARQUIVO } = require('./banco');
const { criarSenhas, FilaCheia } = require('./senha');
const regras = require('./regras');
const { criarAntiabuso, regrasDoAmbiente } = require('../telemetria/abuso');
const { protegerPasta } = require('../telemetria/autenticacao');
const perfilComum = require('../public/perfil');
const planos = require('../public/planos');
const imagens = require('./imagens');
const estudioComum = require('../estudio');

const MINUTO = 60000;
const DIA = 24 * 60 * MINUTO;
// 30 dias desde o último uso, e não desde o login: quem usa toda semana não é jogado para fora
// no meio de uma conversa por um prazo que ninguém lembra de ter aceitado.
const VALIDADE_DA_SESSAO = 30 * DIA;
// Gravar `ultima_em` a cada pedido seria uma escrita por clique -- e cada escrita aproxima o
// checkpoint. Cinco minutos de imprecisão no "visto por último" não custam nada a ninguém.
const TOQUE_MINIMO = 5 * MINUTO;
const SESSOES_POR_CONTA = 20;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hash = texto => crypto.createHash('sha256').update(texto).digest('hex');

// "Chrome · Windows", e não o agente inteiro. O agente do navegador identifica versão, build e
// às vezes o modelo do aparelho; para a pessoa reconhecer uma sessão na lista, isto basta --
// e o que não é guardado não vaza.
function resumirAparelho(agente) {
  const texto = String(agente || '');
  const navegador = /Edg\//.test(texto) ? 'Edge' : /OPR\//.test(texto) ? 'Opera' : /Firefox\//.test(texto) ? 'Firefox'
    : /Electron\//.test(texto) ? 'Aplicativo Nexo' : /Chrome\//.test(texto) ? 'Chrome' : /Safari\//.test(texto) ? 'Safari' : 'Navegador';
  const sistema = /Android/.test(texto) ? 'Android' : /iPhone|iPad|iPod/.test(texto) ? 'iOS' : /Windows/.test(texto) ? 'Windows'
    : /Mac OS X|Macintosh/.test(texto) ? 'macOS' : /Linux/.test(texto) ? 'Linux' : 'sistema desconhecido';
  return `${navegador} · ${sistema}`;
}

// O CSRF sai do próprio token da sessão, que vive num cookie HttpOnly: quem não tem o cookie
// não tem como calcular o CSRF, e quem tem não precisa de um segundo segredo guardado no
// servidor. Sobrevive a reiniciar o processo, o que um segredo sorteado na memória não faria.
const csrfDe = token => crypto.createHash('sha256').update(`nexo-csrf|${token}`).digest('base64url').slice(0, 32);

function criarContas({
  arquivo = ARQUIVO, agora = Date.now, senhas = criarSenhas(), aoAlertar = () => {}, regrasDeLimite = regrasDoAmbiente() || {},
  manutencao = true, proteger = arquivo !== ':memory:'
} = {}) {
  if (proteger) protegerPasta(path.dirname(arquivo));
  const banco = abrirBanco({ arquivo });
  const freio = criarAntiabuso({ agora, aoAlertar, regras: regrasDeLimite, maximo: 4096 });
  let tarefas = null;
  if (manutencao && arquivo !== ':memory:') {
    const { iniciarManutencao } = require('./manutencao');
    tarefas = iniciarManutencao({ arquivo, aoFalhar: erro => console.error(`Manutenção das contas: ${erro}`) });
  }

  const falha = (status, error, campo = null, segundos = null) => ({ ok: false, status, error, campo, segundos });
  const suspensa = conta => Boolean(conta?.suspensaAte && conta.suspensaAte > agora());
  const dataCurta = ms => new Date(ms).toLocaleDateString('pt-BR');

  // O nome de quem tentou não vai para o alerta: o alerta fica sete dias em disco, e "alguém
  // tentou entrar na conta X" é um dado sobre X que ninguém pediu para guardar.
  function permitido(chave, tipo) {
    return freio.permitirGlobal() && freio.verificar(chave, tipo, { nome: 'Tentativas de entrar numa conta' }).ok;
  }

  function abrirSessao(contaId, agente) {
    const token = crypto.randomBytes(32).toString('base64url');
    banco.criarSessao({ id: hash(token), contaId, agora: agora(), expiraEm: agora() + VALIDADE_DA_SESSAO, aparelho: resumirAparelho(agente), maximoPorConta: SESSOES_POR_CONTA });
    return token;
  }

  // O que a própria pessoa vê da própria conta. Nada de hash, nada de id interno.
  function publica(conta) {
    return {
      usuario: conta.usuario, apelido: conta.apelido, codigo: regras.formatarCodigo(conta.codigo),
      plano: conta.plano, planoAte: conta.planoAte, nivel: planos.nivelDaConta(conta, agora()),
      email: conta.email, criadaEm: conta.criadaEm
    };
  }

  // O nível que vale AGORA para esta conta. Lido do banco a cada pergunta: o painel pode ter
  // acabado de marcá-la como premium, e o prazo vence sozinho.
  const nivelDaConta = contaId => planos.nivelDaConta(contaId ? banco.contaPorId(contaId) : null, agora());

  // ---------- O painel ----------
  //
  // O que quem administra vê de cada conta: nada de hash, nada de sessão, nada de id interno --
  // a conta é achada pelo código, que é público de qualquer jeito.
  function paraOPainel(conta) {
    return {
      usuario: conta.usuario, apelido: conta.apelido, codigo: regras.formatarCodigo(conta.codigo),
      plano: conta.plano, planoAte: conta.planoAte, nivel: planos.nivelDaConta(conta, agora()),
      criadaEm: conta.criadaEm, vistaEm: conta.vistaEm, suspensaAte: conta.suspensaAte
    };
  }

  // Paginado, e só pelo painel: nenhuma varredura no caminho de um pedido de sala. A busca é
  // exata, pelo usuário ou pelo código -- sem `LIKE`, que não se comporta igual nos dois bancos.
  function listarParaOPainel({ busca = '', antes = '', porPagina = 25 } = {}) {
    const instante = agora();
    const numeros = banco.contagens(instante, instante - 30 * DIA);
    const porDia = new Map();
    for (const criada of numeros.criadas) {
      const dia = new Date(criada).toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) || 0) + 1);
    }
    let lista, proxima = null;
    if (String(busca).trim()) {
      const porUsuario = banco.contaPorUsuario(regras.normalizarUsuario(busca));
      const codigo = regras.normalizarCodigo(busca);
      const porCodigo = codigo.length === regras.TAMANHO_DO_CODIGO ? banco.contaPorCodigo(codigo) : null;
      lista = [...new Map([porUsuario, porCodigo].filter(Boolean).map(c => [c.id, c])).values()];
    } else {
      const ultima = antes ? banco.contaPorCodigo(regras.normalizarCodigo(antes)) : null;
      lista = banco.listarContas({ antesDe: ultima ? { criadaEm: ultima.criadaEm, id: ultima.id } : null, limite: porPagina + 1 });
      if (lista.length > porPagina) { lista = lista.slice(0, porPagina); proxima = regras.formatarCodigo(lista.at(-1).codigo); }
    }
    return {
      contagens: { total: numeros.total, premium: numeros.premium, suspensas: numeros.suspensas },
      cadastrosPorDia: [...porDia].map(([dia, total]) => ({ dia, total })),
      contas: lista.map(paraOPainel), proxima
    };
  }

  // O atalho da fase 3: marcar premium à mão, com prazo, para quem pagar por PIX direto. É
  // `plano` e `plano_ate` -- a mesma superfície que a webhook do pagamento vai mudar depois.
  function agirPeloPainel(codigo, { acao, dias } = {}) {
    const conta = banco.contaPorCodigo(regras.normalizarCodigo(codigo));
    if (!conta) return falha(404, 'Conta não encontrada.');
    const quantos = Number(dias);
    const prazo = Number.isFinite(quantos) && quantos > 0 && quantos <= 3650 ? agora() + Math.round(quantos) * DIA : null;
    if (acao === 'premium') banco.definirPlano(conta.id, 'premium', prazo);
    else if (acao === 'gratis') banco.definirPlano(conta.id, 'gratis', null);
    else if (acao === 'suspender') {
      if (!prazo) return falha(400, 'Diga por quantos dias a conta fica suspensa.');
      banco.definirSuspensao(conta.id, prazo);
      // Suspensa, a conta sai de todos os aparelhos agora -- e não na próxima vez que alguém
      // conferir o prazo.
      banco.apagarOutrasSessoes(conta.id, '');
    } else if (acao === 'reativar') banco.definirSuspensao(conta.id, null);
    // A moderação de imagem, no tamanho que ela tem hoje: quem administra vê uma imagem
    // imprópria e tira todas as da conta de uma vez -- o avatar volta à cor e à marca.
    else if (acao === 'remover-imagens') banco.apagarImagensDaConta(conta.id);
    else return falha(400, 'Ação desconhecida.');
    return { ok: true, contaId: conta.id, conta: paraOPainel(banco.contaPorId(conta.id)) };
  }

  // `permitirCriacao` é o teto diário da rede (rotas.js). Ele é perguntado só aqui embaixo, com
  // o pedido já conferido: uma senha curta ou um usuário ocupado não é conta criada, e antes
  // três erros de digitação trancavam o cadastro da rede inteira até o dia seguinte.
  async function cadastrar({ usuario, apelido, senha, agente, permitirCriacao = () => true }) {
    const chave = regras.normalizarUsuario(usuario);
    const problemaDoUsuario = regras.problemaDoUsuario(chave);
    if (problemaDoUsuario) return falha(400, regras.MENSAGENS_DO_USUARIO[problemaDoUsuario], 'usuario');
    // Sem apelido, o próprio usuário serve: ninguém é obrigado a inventar dois nomes.
    const nome = regras.limparApelido(apelido) || chave;
    const problemaDaSenha = regras.problemaDaSenha(senha, { usuario: chave, apelido: nome });
    if (problemaDaSenha) return falha(400, regras.MENSAGENS_DA_SENHA[problemaDaSenha], 'senha');
    // Um nome de usuário único é, por definição, consultável no cadastro -- é assim em todo
    // serviço que tem um. O que não pode virar consulta é o LOGIN, e lá a resposta é única.
    // Recusar antes de derivar poupa 110 ms de fila a um pedido que já sabemos que falha.
    if (banco.contaPorUsuario(chave)) return falha(409, 'Esse nome de usuário já tem dono. Escolha outro.', 'usuario');
    if (!permitirCriacao()) return falha(429, 'Muitas contas criadas a partir desta rede hoje. Tente amanhã.', null, 3600);

    const recuperacao = regras.gerarRecuperacao();
    const senhaGuardada = await senhas.derivar(senha);
    const recuperacaoGuardada = await senhas.derivar(recuperacao);
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const id = crypto.randomUUID();
      const criada = banco.criarConta({ id, codigo: regras.gerarCodigo(), usuario: chave, apelido: nome, senha: senhaGuardada, recuperacao: recuperacaoGuardada, agora: agora() });
      if (criada.ok) {
        const conta = banco.contaPorId(id);
        return { ok: true, conta, token: abrirSessao(id, agente), recuperacao: regras.formatarRecuperacao(recuperacao) };
      }
      // Dois cadastros com o mesmo usuário no mesmo instante: a UNIQUE decide quem chegou.
      if (criada.motivo === 'usuario-em-uso') return falha(409, 'Esse nome de usuário já tem dono. Escolha outro.', 'usuario');
      if (criada.motivo !== 'codigo-em-uso') break;
    }
    throw new Error('Não foi possível sortear um código de conta livre.');
  }

  // "Usuário não existe" e "senha errada" recebem a MESMA resposta, no mesmo tempo -- a
  // derivação de mentira em senha.js cuida do tempo. Sem isso o login viraria uma consulta de
  // quem tem conta.
  const NAO_CONFERE = 'Usuário ou senha não conferem.';

  async function entrar({ usuario, senha, agente }) {
    const chave = regras.normalizarUsuario(usuario).slice(0, 64);
    if (!permitido('*', 'entrar-global')) return falha(429, 'Muita gente tentando entrar agora. Aguarde um minuto.', null, 60);
    if (!chave || !permitido(`entrar:${chave}`, 'entrar-conta')) return falha(429, 'Muitas tentativas para este usuário. Aguarde alguns minutos.', null, 600);
    const texto = typeof senha === 'string' && senha.length <= regras.SENHA_MAXIMA ? senha : '';
    const conta = texto ? banco.contaPorUsuario(chave) : null;
    const { ok, desatualizada } = await senhas.conferir(texto, conta?.senha);
    if (!ok) return falha(401, NAO_CONFERE);
    // A suspensão só é dita a quem acertou a senha: dizê-la antes seria revelar a conta.
    if (suspensa(conta)) return falha(403, `Esta conta está suspensa até ${dataCurta(conta.suspensaAte)}.`);
    // Parâmetros antigos: a senha certa acabou de passar em claro por aqui, então é a hora de
    // derivá-la de novo com os atuais. Se a fila estiver cheia, fica para o próximo login.
    if (desatualizada) {
      try { banco.trocarSenha(conta.id, await senhas.derivar(texto)); } catch (erro) { if (!(erro instanceof FilaCheia)) throw erro; }
    }
    return { ok: true, conta, token: abrirSessao(conta.id, agente) };
  }

  // A consulta que roda em cada pedido de quem tem conta. Microssegundos, e escreve no máximo
  // a cada cinco minutos.
  function sessao(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const achada = banco.contaPorSessao(hash(token), agora());
    if (!achada || suspensa(achada.conta)) return null;
    let tocada = false;
    if (agora() - achada.sessao.ultimaEm >= TOQUE_MINIMO) {
      banco.tocarSessao({ id: achada.sessao.id, contaId: achada.conta.id, agora: agora(), expiraEm: agora() + VALIDADE_DA_SESSAO });
      tocada = true;
    }
    return { conta: achada.conta, sessaoId: achada.sessao.id, tocada, csrf: csrfDe(token) };
  }

  function sair(token) {
    if (typeof token === 'string' && TOKEN.test(token)) banco.apagarSessao(hash(token));
  }

  async function exigirSenha(conta, senha) {
    const texto = typeof senha === 'string' && senha.length <= regras.SENHA_MAXIMA ? senha : '';
    return (await senhas.conferir(texto, conta.senha)).ok;
  }

  // Trocar a senha encerra as OUTRAS sessões: é o gesto de quem desconfia que alguém mais a
  // conhece, e deixar esse alguém logado desfaria o motivo da troca.
  async function trocarSenha(conta, sessaoId, { atual, nova }) {
    if (!permitido(conta.id, 'conta-escrever')) return falha(429, 'Muitas alterações seguidas. Aguarde alguns minutos.', null, 600);
    if (!(await exigirSenha(conta, atual))) return falha(401, 'A senha atual não confere.', 'atual');
    const problema = regras.problemaDaSenha(nova, { usuario: conta.usuario, apelido: conta.apelido });
    if (problema) return falha(400, regras.MENSAGENS_DA_SENHA[problema], 'nova');
    banco.trocarSenha(conta.id, await senhas.derivar(nova));
    banco.apagarOutrasSessoes(conta.id, sessaoId);
    return { ok: true };
  }

  // O que dá para conferir sem abrir conta nenhuma: o formato do código e a senha nova contra
  // as regras gerais. Erro de digitação aqui não gasta tentativa -- nem da conta, nem da rede
  // (rotas.js pergunta isto antes do freio) --, e dizer "o código tem 19 caracteres" não revela
  // nada sobre quem tem conta.
  function problemaNaRecuperacao({ usuario, codigo, nova } = {}) {
    const chave = regras.normalizarUsuario(usuario).slice(0, 64);
    if (!chave) return falha(400, 'Digite o seu nome de usuário.', 'usuario');
    const lido = regras.lerRecuperacao(codigo);
    if (lido.problema) return falha(400, regras.mensagemDaRecuperacao(lido), 'codigo');
    const problema = regras.problemaDaSenha(nova, { usuario: chave });
    if (problema) return falha(400, regras.MENSAGENS_DA_SENHA[problema], 'nova');
    return null;
  }

  // Quem chega aqui já conferiu tudo o que a página mostra; o que sobra é a dúvida de verdade.
  const NAO_CONFERE_RECUPERACAO = 'Usuário ou código de recuperação não conferem. Confira o nome de usuário (o de entrar, não o apelido) e se este é o código mais recente: cada código vale uma vez, e gerar outro cancela o anterior.';

  // O código vale UMA vez. Usado, ele troca: um código que continuasse valendo seria uma
  // segunda senha permanente, anotada num papel qualquer.
  async function recuperar({ usuario, codigo, nova, agente }) {
    const problema = problemaNaRecuperacao({ usuario, codigo, nova });
    if (problema) return problema;
    const chave = regras.normalizarUsuario(usuario).slice(0, 64);
    if (!permitido('*', 'entrar-global')) return falha(429, 'Muita gente tentando entrar agora. Aguarde um minuto.', null, 60);
    // Balde próprio, e não o do login: quem esqueceu a senha erra o login algumas vezes antes de
    // lembrar do código, e isso não pode trancar justamente a saída.
    if (!permitido(`recuperar:${chave}`, 'recuperar-conta')) return falha(429, 'Muitas tentativas de recuperar esta conta. Aguarde alguns minutos.', null, 600);
    const conta = banco.contaPorUsuario(chave);
    const { ok } = await senhas.conferir(regras.lerRecuperacao(codigo).codigo, conta?.recuperacao);
    if (!ok) return falha(401, NAO_CONFERE_RECUPERACAO);
    // A regra que depende da conta -- a senha não pode ser o apelido -- só depois do código
    // certo: antes, ela diria a qualquer um qual é o apelido de quem tem aquele usuário.
    const pessoal = regras.problemaDaSenha(nova, { usuario: conta.usuario, apelido: conta.apelido });
    if (pessoal) return falha(400, regras.MENSAGENS_DA_SENHA[pessoal], 'nova');
    const recuperacao = regras.gerarRecuperacao();
    banco.trocarSenha(conta.id, await senhas.derivar(nova));
    banco.trocarRecuperacao(conta.id, await senhas.derivar(recuperacao));
    // Quem recupera a conta é quem perdeu o acesso a ela. Qualquer sessão aberta antes pode
    // ser justamente a de quem tomou a senha.
    banco.apagarOutrasSessoes(conta.id, '');
    if (suspensa(conta)) return { ok: true, suspensa: true, recuperacao: regras.formatarRecuperacao(recuperacao) };
    return { ok: true, conta, token: abrirSessao(conta.id, agente), recuperacao: regras.formatarRecuperacao(recuperacao) };
  }

  // Um código novo, para quem perdeu o papel mas ainda sabe a senha. O antigo deixa de valer.
  async function novaRecuperacao(conta, { senha }) {
    if (!permitido(conta.id, 'conta-escrever')) return falha(429, 'Muitas alterações seguidas. Aguarde alguns minutos.', null, 600);
    if (!(await exigirSenha(conta, senha))) return falha(401, 'A senha não confere.', 'senha');
    const recuperacao = regras.gerarRecuperacao();
    banco.trocarRecuperacao(conta.id, await senhas.derivar(recuperacao));
    return { ok: true, recuperacao: regras.formatarRecuperacao(recuperacao) };
  }

  // ---------- O perfil ----------
  //
  // O que a sala mostra de quem tem conta: apelido, cor e marca. Os ajustes são a outra metade
  // -- o que dá trabalho refazer em cada aparelho --, e a lista do que pode entrar neles é
  // FECHADA (public/perfil.js): o que não está nela é descartado aqui, venha de onde vier.
  function perfil(conta) {
    const guardado = banco.perfil(conta.id) || { cor: null, marca: null, avatar: null, rosto: {}, ajustes: {} };
    return {
      cor: perfilComum.corValida(guardado.cor), marca: perfilComum.marcaValida(guardado.marca),
      avatar: perfilComum.avatarValido(guardado.avatar), rosto: estudioComum.limparRosto(guardado.rosto),
      ajustes: perfilComum.limparAjustes(guardado.ajustes)
    };
  }

  function salvarPerfil(conta, { apelido, cor, marca } = {}) {
    if (!permitido(conta.id, 'conta-escrever')) return falha(429, 'Muitas alterações seguidas. Aguarde alguns minutos.', null, 600);
    // Tudo é conferido antes de qualquer escrita: um apelido bom com uma cor ruim não pode
    // salvar metade do pedido e recusar a outra metade.
    const nome = apelido === undefined ? null : regras.limparApelido(apelido);
    if (apelido !== undefined && !nome) return falha(400, 'O apelido não pode ficar vazio.', 'apelido');
    // `null` volta ao padrão (cor sorteada pelo nome, iniciais no lugar da marca); um nome fora
    // do conjunto é recusado, e não trocado em silêncio pelo padrão.
    const atual = banco.perfil(conta.id) || {};
    const novaCor = cor === undefined ? atual.cor : cor === null ? null : perfilComum.corValida(cor);
    const novaMarca = marca === undefined ? atual.marca : marca === null ? null : perfilComum.marcaValida(marca);
    if (cor && !novaCor) return falha(400, 'Essa cor não está entre as disponíveis.', 'cor');
    if (marca && !novaMarca) return falha(400, 'Essa marca não está entre as disponíveis.', 'marca');
    if (nome) banco.trocarApelido(conta.id, nome);
    banco.salvarAparencia(conta.id, { cor: novaCor, marca: novaMarca });
    const atualizada = banco.contaPorId(conta.id);
    return { ok: true, conta: atualizada, perfil: perfil(atualizada) };
  }

  // A escolha de qualidade é guardada mesmo quando o plano não a permite: quem assinou,
  // escolheu 1440p e deixou vencer continua com 1440p guardado, e recebe de volta ao renovar.
  // Quem aplica o teto é a sala, não este arquivo.
  function salvarAjustes(conta, brutos) {
    if (!permitido(conta.id, 'conta-ajustes')) return falha(429, 'Ajustes demais em pouco tempo. Eles continuam guardados neste navegador.', null, 60);
    const limpos = perfilComum.limparAjustes(brutos);
    if (Buffer.byteLength(JSON.stringify(limpos)) > perfilComum.BYTES_MAXIMOS_DOS_AJUSTES) return falha(413, 'Ajustes grandes demais.');
    banco.salvarAjustes(conta.id, limpos);
    return { ok: true, ajustes: limpos };
  }

  // ---------- As imagens ----------
  //
  // O id é sorteado a cada envio e é ele que vai no endereço: a imagem nunca muda depois de
  // guardada, então pode ficar em cache para sempre, e trocar o avatar é trocar o endereço.
  const novoIdDeImagem = () => crypto.randomBytes(16).toString('hex');
  const HORA = 60 * MINUTO;

  function salvarAvatar(conta, { bytes, tipo } = {}) {
    if (!permitido(conta.id, 'conta-imagem')) return falha(429, 'Imagens demais em pouco tempo. Aguarde alguns minutos.', null, 600);
    const conferida = imagens.conferirImagem(bytes, 'avatar', tipo);
    if (conferida.erro) return falha(conferida.status || 400, conferida.erro);
    banco.trocarAvatar(conta.id, { id: novoIdDeImagem(), tipo: conferida.tipo, bytes, agora: agora() });
    const atualizada = banco.contaPorId(conta.id);
    return { ok: true, conta: atualizada, perfil: perfil(atualizada) };
  }

  function apagarAvatar(conta) {
    if (!permitido(conta.id, 'conta-imagem')) return falha(429, 'Imagens demais em pouco tempo. Aguarde alguns minutos.', null, 600);
    banco.trocarAvatar(conta.id, null);
    const atualizada = banco.contaPorId(conta.id);
    return { ok: true, conta: atualizada, perfil: perfil(atualizada) };
  }

  // O rosto da pessoa no Estúdio dos outros (estudio.js, "pessoa"): uma imagem por estado, que
  // troca a anterior daquele estado. É do perfil, como a foto, e vai à sala junto com ele.
  function salvarRosto(conta, estado, { bytes, tipo } = {}) {
    if (!estudioComum.ESTADOS_DO_ROSTO.includes(estado)) return falha(404, 'Estado desconhecido.');
    if (!permitido(conta.id, 'conta-imagem')) return falha(429, 'Imagens demais em pouco tempo. Aguarde alguns minutos.', null, 600);
    const conferida = imagens.conferirImagem(bytes, 'rosto', tipo);
    if (conferida.erro) return falha(conferida.status || 400, conferida.erro);
    banco.trocarRosto(conta.id, estado, { id: novoIdDeImagem(), tipo: conferida.tipo, bytes, agora: agora() });
    const atualizada = banco.contaPorId(conta.id);
    return { ok: true, conta: atualizada, perfil: perfil(atualizada) };
  }

  function apagarRosto(conta, estado) {
    if (!estudioComum.ESTADOS_DO_ROSTO.includes(estado)) return falha(404, 'Estado desconhecido.');
    if (!permitido(conta.id, 'conta-imagem')) return falha(429, 'Imagens demais em pouco tempo. Aguarde alguns minutos.', null, 600);
    banco.trocarRosto(conta.id, estado, null);
    const atualizada = banco.contaPorId(conta.id);
    return { ok: true, conta: atualizada, perfil: perfil(atualizada) };
  }

  const imagem = id => (typeof id === 'string' && estudioComum.ID_DE_IMAGEM.test(id) ? banco.imagem(id) : null);

  // ---------- O Estúdio ----------
  //
  // A configuração dos rostos que reagem à voz e a geração dos links (estudio.js). As imagens
  // do Estúdio são enviadas uma a uma, antes de a configuração que as usa ser salva; as que
  // ficaram de fora por mais de uma hora -- trocadas, ou enviadas e abandonadas -- somem no
  // próximo salvamento. A hora de folga é para quem ainda está escolhendo.
  function estudio(conta) {
    const { geracao, config } = banco.estudio(conta.id);
    return { geracao, config: estudioComum.limparConfig(config), imagens: banco.imagensDaConta(conta.id, 'estudio') };
  }

  const geracaoDoEstudio = contaId => banco.estudio(contaId).geracao;
  const configDoEstudio = contaId => estudioComum.limparConfig(banco.estudio(contaId).config);

  function esquecerImagensSoltas(conta, config) {
    const usadas = estudioComum.imagensDaConfig(config);
    for (const img of banco.imagensDaConta(conta.id, 'estudio')) {
      if (!usadas.has(img.id) && agora() - img.criadaEm > HORA) banco.apagarImagem(img.id, conta.id);
    }
  }

  function salvarEstudio(conta, bruto) {
    if (!permitido(conta.id, 'conta-estudio')) return falha(429, 'Mudanças demais em pouco tempo. Aguarde um minuto.', null, 60);
    const config = estudioComum.limparConfig(bruto);
    // Só imagens desta conta, e do Estúdio: um id de outra pessoa colado aqui não vira a arte
    // de ninguém, e o avatar não entra por este caminho.
    const minhas = new Set(banco.imagensDaConta(conta.id, 'estudio').map(i => i.id));
    for (const pessoa of Object.values(config.pessoas)) {
      for (const estado of estudioComum.ESTADOS_DO_ROSTO) if (pessoa[estado] && !minhas.has(pessoa[estado])) pessoa[estado] = null;
    }
    if (Buffer.byteLength(JSON.stringify(config)) > estudioComum.BYTES_MAXIMOS_DA_CONFIGURACAO) return falha(413, 'Configuração grande demais.');
    banco.salvarEstudio(conta.id, config);
    esquecerImagensSoltas(conta, config);
    return { ok: true, config };
  }

  function adicionarImagemDoEstudio(conta, { bytes, tipo } = {}) {
    if (!permitido(conta.id, 'conta-imagem')) return falha(429, 'Imagens demais em pouco tempo. Aguarde alguns minutos.', null, 600);
    const conferida = imagens.conferirImagem(bytes, 'estudio', tipo);
    if (conferida.erro) return falha(conferida.status || 400, conferida.erro);
    esquecerImagensSoltas(conta, configDoEstudio(conta.id));
    const atuais = banco.imagensDaConta(conta.id, 'estudio');
    const limite = imagens.LIMITES.estudio;
    if (atuais.length >= limite.quantas) return falha(409, `O Estúdio guarda até ${limite.quantas} imagens. Apague alguma antes de enviar outra.`);
    if (atuais.reduce((soma, img) => soma + img.tamanho, 0) + bytes.length > limite.total) return falha(413, `As imagens do Estúdio somam no máximo ${Math.round(limite.total / 1024 / 1024)} MB. Apague alguma antes de enviar outra.`);
    const id = novoIdDeImagem();
    banco.inserirImagem({ id, contaId: conta.id, uso: 'estudio', tipo: conferida.tipo, bytes, agora: agora() });
    return { ok: true, imagem: { id, tipo: conferida.tipo, tamanho: bytes.length } };
  }

  // Apagar uma imagem tira ela de quem a usava: a configuração nunca fica apontando para nada.
  function apagarImagemDoEstudio(conta, id) {
    if (!permitido(conta.id, 'conta-estudio')) return falha(429, 'Mudanças demais em pouco tempo. Aguarde um minuto.', null, 60);
    const achada = imagem(id);
    if (!achada || achada.contaId !== conta.id || achada.uso !== 'estudio') return falha(404, 'Imagem não encontrada.');
    const config = configDoEstudio(conta.id);
    for (const pessoa of Object.values(config.pessoas)) {
      for (const estado of estudioComum.ESTADOS_DO_ROSTO) if (pessoa[estado] === id) pessoa[estado] = null;
    }
    banco.salvarEstudio(conta.id, estudioComum.limparConfig(config));
    banco.apagarImagem(id, conta.id);
    return { ok: true, config: configDoEstudio(conta.id) };
  }

  // Revogar pede a senha? Não: não destrói nada da pessoa, só desliga os links que ela deu. É o
  // botão de quem acabou de colar um link no lugar errado, e ele precisa ser rápido.
  function revogarEstudio(conta) {
    if (!permitido(conta.id, 'conta-estudio')) return falha(429, 'Mudanças demais em pouco tempo. Aguarde um minuto.', null, 60);
    return { ok: true, geracao: banco.revogarEstudio(conta.id) };
  }

  // "Baixar meus dados": o direito de acesso e de portabilidade (LGPD, art. 18). Tudo o que o
  // Nexo guarda ligado à pessoa, num formato que outro programa lê. Os hashes de senha e de
  // recuperação ficam de fora -- não servem a ninguém fora daqui, e são a única coisa desta
  // lista que, vazada, ajudaria alguém a atacar a conta.
  function dados(conta) {
    const atual = banco.contaPorId(conta.id);
    return {
      formato: 'nexo-dados-da-conta/1',
      geradoEm: new Date(agora()).toISOString(),
      conta: {
        usuario: atual.usuario, apelido: atual.apelido, codigo: regras.formatarCodigo(atual.codigo),
        email: atual.email, plano: atual.plano, planoAte: atual.planoAte ? new Date(atual.planoAte).toISOString() : null,
        criadaEm: new Date(atual.criadaEm).toISOString(), vistaEm: new Date(atual.vistaEm).toISOString(),
        senha: 'guardada só como scrypt; não incluída', codigoDeRecuperacao: 'guardado só como scrypt; não incluído'
      },
      perfil: perfil(atual),
      sessoes: banco.sessoesDaConta(conta.id).map(s => ({
        aparelho: s.aparelho, criadaEm: new Date(s.criadaEm).toISOString(), usadaEm: new Date(s.ultimaEm).toISOString(), expiraEm: new Date(s.expiraEm).toISOString()
      })),
      // As imagens vão como endereço, e não dentro do JSON: cada uma se baixa sozinha por ele.
      imagens: ['avatar', 'rosto', 'estudio'].flatMap(uso => banco.imagensDaConta(conta.id, uso).map(img => ({
        uso, tipo: img.tipo, bytes: img.tamanho, enviadaEm: new Date(img.criadaEm).toISOString(), endereco: `/api/imagem/${img.id}`
      }))),
      estudio: { configuracao: configDoEstudio(conta.id), geracaoDosLinks: geracaoDoEstudio(conta.id) },
      oQueNaoGuardamos: 'Conversas, sons, telas, voz, câmera e as salas em que você esteve não são guardados em lugar nenhum.'
    };
  }

  // Apagar pede a senha: é irreversível, e uma aba esquecida aberta num computador emprestado
  // não pode bastar para isso.
  async function apagar(conta, { senha }) {
    if (!permitido(conta.id, 'conta-escrever')) return falha(429, 'Muitas alterações seguidas. Aguarde alguns minutos.', null, 600);
    if (!(await exigirSenha(conta, senha))) return falha(401, 'A senha não confere.', 'senha');
    banco.apagarConta(conta.id);
    return { ok: true };
  }

  return {
    cadastrar, entrar, sessao, sair, trocarSenha, recuperar, problemaNaRecuperacao, novaRecuperacao, apagar, publica,
    perfil, salvarPerfil, salvarAjustes, dados, nivelDaConta, listarParaOPainel, agirPeloPainel,
    salvarAvatar, apagarAvatar, salvarRosto, apagarRosto, imagem, estudio, geracaoDoEstudio, configDoEstudio, salvarEstudio,
    adicionarImagemDoEstudio, apagarImagemDoEstudio, revogarEstudio,
    contaPorCodigo: codigo => banco.contaPorCodigo(regras.normalizarCodigo(codigo)),
    // O freio por conta, para quem precisa dele fora daqui (a busca de pessoa do Estúdio).
    permitidoParaAConta: (contaId, tipo) => permitido(contaId, tipo),
    contaPorId: id => banco.contaPorId(id),
    banco, senhas, freio, suspensa, csrfDe,
    copiarAgora: () => tarefas ? tarefas.copiarAgora() : Promise.reject(new Error('Manutenção desligada.')),
    manutencao: () => tarefas?.estado() || null,
    async encerrar() { await tarefas?.encerrar(); banco.fechar(); }
  };
}

module.exports = { criarContas, resumirAparelho, csrfDe, VALIDADE_DA_SESSAO, TOQUE_MINIMO, SESSOES_POR_CONTA, FilaCheia };
