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
      plano: conta.plano, planoAte: conta.planoAte, email: conta.email, criadaEm: conta.criadaEm
    };
  }

  async function cadastrar({ usuario, apelido, senha, agente }) {
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

  // O código vale UMA vez. Usado, ele troca: um código que continuasse valendo seria uma
  // segunda senha permanente, anotada num papel qualquer.
  async function recuperar({ usuario, codigo, nova, agente }) {
    const chave = regras.normalizarUsuario(usuario).slice(0, 64);
    if (!permitido('*', 'entrar-global')) return falha(429, 'Muita gente tentando entrar agora. Aguarde um minuto.', null, 60);
    if (!chave || !permitido(`entrar:${chave}`, 'entrar-conta')) return falha(429, 'Muitas tentativas para este usuário. Aguarde alguns minutos.', null, 600);
    const conta = banco.contaPorUsuario(chave);
    const limpo = regras.normalizarCodigo(codigo);
    const { ok } = await senhas.conferir(limpo.length === regras.TAMANHO_DA_RECUPERACAO ? limpo : '', conta?.recuperacao);
    if (!ok) return falha(401, 'Usuário ou código de recuperação não conferem.');
    const problema = regras.problemaDaSenha(nova, { usuario: conta.usuario, apelido: conta.apelido });
    if (problema) return falha(400, regras.MENSAGENS_DA_SENHA[problema], 'nova');
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

  // Apagar pede a senha: é irreversível, e uma aba esquecida aberta num computador emprestado
  // não pode bastar para isso.
  async function apagar(conta, { senha }) {
    if (!permitido(conta.id, 'conta-escrever')) return falha(429, 'Muitas alterações seguidas. Aguarde alguns minutos.', null, 600);
    if (!(await exigirSenha(conta, senha))) return falha(401, 'A senha não confere.', 'senha');
    banco.apagarConta(conta.id);
    return { ok: true };
  }

  return {
    cadastrar, entrar, sessao, sair, trocarSenha, recuperar, novaRecuperacao, apagar, publica,
    banco, senhas, freio, suspensa, csrfDe,
    copiarAgora: () => tarefas ? tarefas.copiarAgora() : Promise.reject(new Error('Manutenção desligada.')),
    manutencao: () => tarefas?.estado() || null,
    async encerrar() { await tarefas?.encerrar(); banco.fechar(); }
  };
}

module.exports = { criarContas, resumirAparelho, csrfDe, VALIDADE_DA_SESSAO, TOQUE_MINIMO, SESSOES_POR_CONTA, FilaCheia };
