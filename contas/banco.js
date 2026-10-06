// Todo o SQL do Nexo mora aqui, e só aqui.
//
// O resto do servidor chama funções (`contaPorSessao`, `criarConta`) e nunca escreve SQL. É o
// que torna o banco trocável: no dia em que dois processos precisarem do mesmo dado e o SQLite
// deixar de servir, muda este arquivo -- e até os marcadores (`?` aqui, `$1` no Postgres) são
// uma substituição dentro dele. O motivo de cada regra está em docs/plano-contas.md, seção 1.
//
// A conta é a primeira exceção deliberada a "nada do usuário toca o disco", e continua sendo a
// única: o que persiste é a conta e o perfil. Não a conversa, não a sala, não quem estava nela.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const PASTA = path.resolve(process.env.NEXO_PASTA_CONTAS || path.join(__dirname, '..', 'native', 'contas'));
const ARQUIVO = path.join(PASTA, 'nexo.db');
const PASTA_DAS_MIGRACOES = path.join(__dirname, 'migracoes');

// Uma migração por arquivo, numerada. A mesma sequência vira as migrações do outro banco.
function lerMigracoes(pasta = PASTA_DAS_MIGRACOES) {
  return fs.readdirSync(pasta)
    .filter(nome => /^\d{4}-[\w-]+\.sql$/.test(nome))
    .sort()
    .map(nome => ({ versao: Number(nome.slice(0, 4)), nome, sql: fs.readFileSync(path.join(pasta, nome), 'utf8') }));
}

function abrirConexao(arquivo, { principal }) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  // WAL: leitura não espera escrita. NORMAL: em WAL é seguro contra queda do processo, sem
  // fsync por transação. foreign_keys vem DESLIGADO no SQLite, e é ele que faz o ON DELETE
  // CASCADE existir -- "apagar minha conta" que deixasse perfil e sessões para trás seria
  // defeito de LGPD, não de código.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  // O checkpoint automático roda DENTRO de uma escrita qualquer, e o tempo dele depende do
  // disco: 5,5 ms neste NVMe, e o disco do VPS não é este. Na conexão principal ele fica
  // desligado; quem o faz é a worker de manutenção, com conexão própria (manutencao.js).
  if (principal) db.exec('PRAGMA wal_autocheckpoint = 0');
  return db;
}

function migrar(db, migracoes = lerMigracoes()) {
  const atual = db.prepare('PRAGMA user_version').get().user_version;
  for (const migracao of migracoes) {
    if (migracao.versao <= atual) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migracao.sql);
      db.exec(`PRAGMA user_version = ${migracao.versao}`);
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw new Error(`A migração ${migracao.nome} falhou: ${erro.message}`);
    }
  }
  return db.prepare('PRAGMA user_version').get().user_version;
}

// O nível maior do plano, como o banco o guarda: o CHECK da coluna `plano` (migração 0001, que não se
// reescreve) só aceita este texto. O código inteiro fala "completo" (public/planos.js), e a tradução
// acontece só aqui, na fronteira, nos dois sentidos -- trocar o valor guardado pediria uma migração que
// refizesse a tabela das contas, e um nome de coluna não vale esse risco.
const PLANO_COMPLETO_GUARDADO = 'premium';
const planoDoBanco = guardado => (guardado === PLANO_COMPLETO_GUARDADO ? 'completo' : guardado);
const planoParaOBanco = plano => (plano === 'completo' ? PLANO_COMPLETO_GUARDADO : plano);

// A linha do banco vira objeto do código aqui, uma vez. `plano_ate` e companhia não vazam
// para o resto do servidor com nome de coluna.
function conta(linha) {
  if (!linha) return null;
  return {
    id: linha.id, codigo: linha.codigo, usuario: linha.usuario, apelido: linha.apelido,
    senha: linha.senha ?? null, recuperacao: linha.recuperacao ?? null,
    email: linha.email ?? null, plano: planoDoBanco(linha.plano), planoAte: linha.plano_ate ?? null,
    faixaEtaria: linha.faixa_etaria ?? null,
    criadaEm: linha.criada_em, vistaEm: linha.vista_em, suspensaAte: linha.suspensa_ate ?? null
  };
}
const COLUNAS_DA_CONTA = 'c.id, c.codigo, c.usuario, c.apelido, c.senha, c.recuperacao, c.email, c.plano, c.plano_ate, c.faixa_etaria, c.criada_em, c.vista_em, c.suspensa_ate';

function lerAjustes(texto) {
  try {
    const valor = JSON.parse(texto || '{}');
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  } catch (_) { return {}; }
}

// A recusa por UNIQUE vira um motivo com nome. Sem isto quem chama teria de ler a mensagem do
// SQLite -- que é justamente o que não existe igual no Postgres.
function motivoDaUnicidade(erro) {
  const texto = String(erro?.message || '');
  if (!/UNIQUE constraint failed/i.test(texto)) return null;
  if (/conta\.usuario/.test(texto)) return 'usuario-em-uso';
  if (/conta\.codigo/.test(texto)) return 'codigo-em-uso';
  if (/conta\.email_chave/.test(texto)) return 'email-em-uso';
  return 'duplicado';
}

function abrirBanco({ arquivo = ARQUIVO } = {}) {
  const db = abrirConexao(arquivo, { principal: true });
  const versao = migrar(db);
  const sql = texto => db.prepare(texto);

  const q = {
    inserirConta: sql(`INSERT INTO conta (id, codigo, usuario, apelido, senha, recuperacao, criada_em, vista_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    inserirPerfil: sql('INSERT INTO perfil (conta_id) VALUES (?)'),
    contaPorId: sql(`SELECT ${COLUNAS_DA_CONTA} FROM conta c WHERE c.id = ?`),
    contaPorUsuario: sql(`SELECT ${COLUNAS_DA_CONTA} FROM conta c WHERE c.usuario = ?`),
    contaPorCodigo: sql(`SELECT ${COLUNAS_DA_CONTA} FROM conta c WHERE c.codigo = ?`),
    // A consulta que roda a cada conexão: 16,7 µs com 20.000 contas, medido. Chamada de
    // função, sem ida e volta por rede -- é por ela que o banco mora na mesma máquina.
    contaPorSessao: sql(`SELECT ${COLUNAS_DA_CONTA}, s.id AS sessao_id, s.criada_em AS sessao_criada_em,
        s.ultima_em AS sessao_ultima_em, s.expira_em AS sessao_expira_em
      FROM sessao s JOIN conta c ON c.id = s.conta_id WHERE s.id = ? AND s.expira_em > ?`),
    inserirSessao: sql('INSERT INTO sessao (id, conta_id, criada_em, ultima_em, expira_em, aparelho) VALUES (?, ?, ?, ?, ?, ?)'),
    tocarSessao: sql('UPDATE sessao SET ultima_em = ?, expira_em = ? WHERE id = ?'),
    marcarVista: sql('UPDATE conta SET vista_em = ? WHERE id = ?'),
    apagarSessao: sql('DELETE FROM sessao WHERE id = ?'),
    apagarOutrasSessoes: sql('DELETE FROM sessao WHERE conta_id = ? AND id <> ?'),
    sessoesDaConta: sql('SELECT id, criada_em, ultima_em, expira_em, aparelho FROM sessao WHERE conta_id = ? ORDER BY ultima_em DESC'),
    // Teto de sessões por conta: sem ele, um script logando em laço enche a tabela de uma
    // conta só. Sai quem foi usada há mais tempo.
    podarSessoes: sql(`DELETE FROM sessao WHERE conta_id = ? AND id NOT IN
      (SELECT id FROM sessao WHERE conta_id = ? ORDER BY ultima_em DESC LIMIT ?)`),
    trocarSenha: sql('UPDATE conta SET senha = ? WHERE id = ?'),
    trocarRecuperacao: sql('UPDATE conta SET recuperacao = ? WHERE id = ?'),
    trocarApelido: sql('UPDATE conta SET apelido = ? WHERE id = ?'),
    apagarConta: sql('DELETE FROM conta WHERE id = ?'),
    perfil: sql('SELECT cor, marca, avatar, rosto, ajustes, vitrine, social FROM perfil WHERE conta_id = ?'),
    salvarVitrine: sql('UPDATE perfil SET vitrine = ? WHERE conta_id = ?'),
    salvarSocial: sql('UPDATE perfil SET social = ? WHERE conta_id = ?'),
    // ---------- Amizades ----------
    // Uma linha por par, com quem pediu em `de_conta`: toda consulta olha os dois lados.
    amizadeEntre: sql(`SELECT de_conta, para_conta, estado, criada_em, aceita_em FROM amizade
      WHERE (de_conta = ? AND para_conta = ?) OR (de_conta = ? AND para_conta = ?)`),
    inserirPedido: sql("INSERT INTO amizade (de_conta, para_conta, estado, criada_em) VALUES (?, ?, 'pendente', ?)"),
    aceitarPedido: sql("UPDATE amizade SET estado = 'aceita', aceita_em = ? WHERE de_conta = ? AND para_conta = ? AND estado = 'pendente'"),
    apagarAmizade: sql('DELETE FROM amizade WHERE (de_conta = ? AND para_conta = ?) OR (de_conta = ? AND para_conta = ?)'),
    // A lista inteira de uma conta, com o que a tela precisa de cada outra pessoa numa ida só.
    // O id da outra conta vai junto, mas só para o servidor (presença); quem sai daqui é o código.
    amizadesDe: sql(`SELECT a.de_conta, a.estado, a.criada_em, a.aceita_em, c.id AS outro, c.codigo, c.apelido, c.plano, c.plano_ate,
        c.criada_em AS conta_criada_em, c.suspensa_ate, p.cor, p.marca, p.avatar, p.vitrine, p.social, ap.apelido AS apelido_meu
      FROM amizade a
      JOIN conta c ON c.id = CASE WHEN a.de_conta = ? THEN a.para_conta ELSE a.de_conta END
      JOIN perfil p ON p.conta_id = c.id
      LEFT JOIN apelido_de_amigo ap ON ap.dono = ? AND ap.amigo = c.id
      WHERE a.de_conta = ? OR a.para_conta = ?`),
    idsDosAmigos: sql(`SELECT CASE WHEN de_conta = ? THEN para_conta ELSE de_conta END AS id FROM amizade
      WHERE estado = 'aceita' AND (de_conta = ? OR para_conta = ?)`),
    contarAmigos: sql("SELECT COUNT(*) AS total FROM amizade WHERE estado = 'aceita' AND (de_conta = ? OR para_conta = ?)"),
    contarPedidosEnviados: sql("SELECT COUNT(*) AS total FROM amizade WHERE estado = 'pendente' AND de_conta = ?"),
    definirApelidoDeAmigo: sql(`INSERT INTO apelido_de_amigo (dono, amigo, apelido) VALUES (?, ?, ?)
      ON CONFLICT (dono, amigo) DO UPDATE SET apelido = excluded.apelido`),
    apagarApelidoDeAmigo: sql('DELETE FROM apelido_de_amigo WHERE dono = ? AND amigo = ?'),
    apagarApelidosDoPar: sql('DELETE FROM apelido_de_amigo WHERE (dono = ? AND amigo = ?) OR (dono = ? AND amigo = ?)'),
    bloquear: sql('INSERT INTO bloqueio (dono, alvo, criado_em) VALUES (?, ?, ?) ON CONFLICT (dono, alvo) DO NOTHING'),
    desbloquear: sql('DELETE FROM bloqueio WHERE dono = ? AND alvo = ?'),
    bloqueioEntre: sql('SELECT dono FROM bloqueio WHERE (dono = ? AND alvo = ?) OR (dono = ? AND alvo = ?)'),
    bloqueadosPor: sql(`SELECT b.criado_em, c.codigo, c.apelido, p.cor, p.marca, p.avatar FROM bloqueio b
      JOIN conta c ON c.id = b.alvo JOIN perfil p ON p.conta_id = c.id WHERE b.dono = ? ORDER BY b.criado_em DESC`),
    // ---------- Conquistas ----------
    somarContador: sql(`INSERT INTO contador (conta_id, nome, valor) VALUES (?, ?, ?)
      ON CONFLICT (conta_id, nome) DO UPDATE SET valor = valor + excluded.valor`),
    contadoresDe: sql('SELECT nome, valor FROM contador WHERE conta_id = ?'),
    guardarConquista: sql('INSERT INTO conquista (conta_id, id, ganha_em) VALUES (?, ?, ?) ON CONFLICT (conta_id, id) DO NOTHING'),
    conquistasGuardadas: sql('SELECT id, ganha_em FROM conquista WHERE conta_id = ?'),
    salvarAparencia: sql('UPDATE perfil SET cor = ?, marca = ? WHERE conta_id = ?'),
    salvarAjustes: sql('UPDATE perfil SET ajustes = ? WHERE conta_id = ?'),
    definirAvatar: sql('UPDATE perfil SET avatar = ? WHERE conta_id = ?'),
    definirRosto: sql('UPDATE perfil SET rosto = ? WHERE conta_id = ?'),
    inserirImagem: sql('INSERT INTO imagem (id, conta_id, uso, tipo, tamanho, bytes, criada_em) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    imagemPorId: sql('SELECT id, conta_id, uso, tipo, tamanho, bytes, criada_em FROM imagem WHERE id = ?'),
    // Sem os bytes: a lista serve para contar e para mostrar, e carregar megabytes para isso
    // seria ler o banco inteiro a cada abertura do Estúdio.
    imagensDaConta: sql('SELECT id, tipo, tamanho, criada_em FROM imagem WHERE conta_id = ? AND uso = ? ORDER BY criada_em'),
    apagarImagem: sql('DELETE FROM imagem WHERE id = ? AND conta_id = ?'),
    apagarImagensDaConta: sql('DELETE FROM imagem WHERE conta_id = ?'),
    garantirEstudio: sql('INSERT INTO estudio (conta_id) VALUES (?) ON CONFLICT (conta_id) DO NOTHING'),
    estudio: sql('SELECT geracao, config FROM estudio WHERE conta_id = ?'),
    salvarEstudio: sql('UPDATE estudio SET config = ? WHERE conta_id = ?'),
    revogarEstudio: sql('UPDATE estudio SET geracao = geracao + 1 WHERE conta_id = ?'),
    definirPlano: sql('UPDATE conta SET plano = ?, plano_ate = ? WHERE id = ?'),
    definirSuspensao: sql('UPDATE conta SET suspensa_ate = ? WHERE id = ?'),
    // O painel pagina pelo instante de criação, do mais novo para o mais antigo. O `id` no
    // desempate impede que duas contas criadas no mesmo milissegundo sumam entre páginas.
    listarContas: sql(`SELECT ${COLUNAS_DA_CONTA} FROM conta c
      WHERE (c.criada_em < ? OR (c.criada_em = ? AND c.id < ?)) ORDER BY c.criada_em DESC, c.id DESC LIMIT ?`),
    contarContas: sql('SELECT COUNT(*) AS total FROM conta'),
    contarCompletos: sql('SELECT COUNT(*) AS total FROM conta WHERE plano = ? AND (plano_ate IS NULL OR plano_ate > ?)'),
    contarSuspensas: sql('SELECT COUNT(*) AS total FROM conta WHERE suspensa_ate IS NOT NULL AND suspensa_ate > ?'),
    criadasDesde: sql('SELECT criada_em FROM conta WHERE criada_em >= ? ORDER BY criada_em')
  };

  function transacao(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const resultado = fn(); db.exec('COMMIT'); return resultado; }
    catch (erro) { db.exec('ROLLBACK'); throw erro; }
  }

  return {
    versao, arquivo,
    // Devolve `{ ok }` ou `{ ok: false, motivo }`. A colisão de código é tratada por quem
    // chama, sorteando outro: com 31⁸ combinações ela é rara, e a restrição UNIQUE é o que
    // a torna impossível de passar despercebida.
    criarConta({ id, codigo, usuario, apelido, senha, recuperacao, agora }) {
      try {
        transacao(() => {
          q.inserirConta.run(id, codigo, usuario, apelido, senha, recuperacao, agora, agora);
          q.inserirPerfil.run(id);
        });
        return { ok: true };
      } catch (erro) {
        const motivo = motivoDaUnicidade(erro);
        if (motivo) return { ok: false, motivo };
        throw erro;
      }
    },
    contaPorId: id => conta(q.contaPorId.get(id)),
    contaPorUsuario: usuario => conta(q.contaPorUsuario.get(usuario)),
    contaPorCodigo: codigo => conta(q.contaPorCodigo.get(codigo)),
    contaPorSessao(idDaSessao, agora) {
      const linha = q.contaPorSessao.get(idDaSessao, agora);
      if (!linha) return null;
      return { conta: conta(linha), sessao: { id: linha.sessao_id, criadaEm: linha.sessao_criada_em, ultimaEm: linha.sessao_ultima_em, expiraEm: linha.sessao_expira_em } };
    },
    criarSessao({ id, contaId, agora, expiraEm, aparelho, maximoPorConta }) {
      transacao(() => {
        q.inserirSessao.run(id, contaId, agora, agora, expiraEm, aparelho || null);
        q.podarSessoes.run(contaId, contaId, maximoPorConta);
      });
    },
    tocarSessao({ id, contaId, agora, expiraEm }) {
      transacao(() => { q.tocarSessao.run(agora, expiraEm, id); q.marcarVista.run(agora, contaId); });
    },
    apagarSessao: id => q.apagarSessao.run(id).changes,
    // `exceto` vazio apaga todas: nenhum id de sessão é a string vazia.
    apagarOutrasSessoes: (contaId, exceto = '') => q.apagarOutrasSessoes.run(contaId, exceto).changes,
    sessoesDaConta: contaId => q.sessoesDaConta.all(contaId).map(s => ({ criadaEm: s.criada_em, ultimaEm: s.ultima_em, expiraEm: s.expira_em, aparelho: s.aparelho ?? null })),
    trocarSenha: (contaId, senha) => q.trocarSenha.run(senha, contaId).changes,
    trocarRecuperacao: (contaId, recuperacao) => q.trocarRecuperacao.run(recuperacao, contaId).changes,
    trocarApelido: (contaId, apelido) => q.trocarApelido.run(apelido, contaId).changes,
    // O CASCADE leva perfil, sessões e identidades externas junto. É uma linha só de
    // propósito: "apagar minha conta" não pode depender de alguém lembrar cada tabela.
    apagarConta: contaId => q.apagarConta.run(contaId).changes,
    perfil(contaId) {
      const linha = q.perfil.get(contaId);
      return linha ? {
        cor: linha.cor ?? null, marca: linha.marca ?? null, avatar: linha.avatar ?? null, rosto: lerAjustes(linha.rosto), ajustes: lerAjustes(linha.ajustes),
        vitrine: lerAjustes(linha.vitrine), social: lerAjustes(linha.social)
      } : null;
    },
    // A vitrine guarda junto os ids das imagens dela (banner e fundo), e quem os escreve é só o
    // servidor: salvar o que a página mandou preserva os que já estão lá.
    salvarVitrine(contaId, vitrine) {
      return transacao(() => {
        const imagens = lerAjustes(q.perfil.get(contaId)?.vitrine).imagens || {};
        return q.salvarVitrine.run(JSON.stringify({ ...vitrine, imagens }), contaId).changes;
      });
    },
    salvarSocial: (contaId, social) => q.salvarSocial.run(JSON.stringify(social), contaId).changes,
    // Trocar a imagem do banner ou do fundo é como trocar o avatar: a nova entra, a anterior sai,
    // na mesma transação. `imagem` nulo tira a do campo.
    trocarImagemDaVitrine(contaId, campo, imagem) {
      return transacao(() => {
        const vitrine = lerAjustes(q.perfil.get(contaId)?.vitrine);
        const imagens = { ...(vitrine.imagens || {}) };
        const anterior = typeof imagens[campo] === 'string' ? imagens[campo] : null;
        if (imagem) { q.inserirImagem.run(imagem.id, contaId, campo, imagem.tipo, imagem.bytes.length, imagem.bytes, imagem.agora); imagens[campo] = imagem.id; }
        else delete imagens[campo];
        q.salvarVitrine.run(JSON.stringify({ ...vitrine, imagens }), contaId);
        if (anterior) q.apagarImagem.run(anterior, contaId);
        return imagens;
      });
    },

    // ---------- Amizades ----------
    amizadeEntre(a, b) {
      const linha = q.amizadeEntre.get(a, b, b, a);
      return linha ? { de: linha.de_conta, para: linha.para_conta, estado: linha.estado, criadaEm: linha.criada_em, aceitaEm: linha.aceita_em ?? null } : null;
    },
    pedirAmizade: (de, para, agora) => q.inserirPedido.run(de, para, agora).changes,
    aceitarAmizade: (de, para, agora) => q.aceitarPedido.run(agora, de, para).changes,
    // Desfazer leva junto os apelidos que um deu ao outro: apelido de quem não é mais amigo é um
    // dado que ninguém mais vê.
    desfazerAmizade(a, b) {
      return transacao(() => { q.apagarApelidosDoPar.run(a, b, b, a); return q.apagarAmizade.run(a, b, b, a).changes; });
    },
    amizadesDe(contaId) {
      return q.amizadesDe.all(contaId, contaId, contaId, contaId).map(l => ({
        outro: l.outro, pediu: l.de_conta === contaId, estado: l.estado, criadaEm: l.criada_em, aceitaEm: l.aceita_em ?? null,
        conta: { id: l.outro, codigo: l.codigo, apelido: l.apelido, plano: planoDoBanco(l.plano), planoAte: l.plano_ate ?? null, criadaEm: l.conta_criada_em, suspensaAte: l.suspensa_ate ?? null },
        perfil: { cor: l.cor ?? null, marca: l.marca ?? null, avatar: l.avatar ?? null, vitrine: lerAjustes(l.vitrine), social: lerAjustes(l.social) },
        apelidoMeu: l.apelido_meu ?? null
      }));
    },
    idsDosAmigos: contaId => q.idsDosAmigos.all(contaId, contaId, contaId).map(l => l.id),
    contarAmigos: contaId => q.contarAmigos.get(contaId, contaId).total,
    contarPedidosEnviados: contaId => q.contarPedidosEnviados.get(contaId).total,
    definirApelidoDeAmigo: (dono, amigo, apelido) => (apelido ? q.definirApelidoDeAmigo.run(dono, amigo, apelido) : q.apagarApelidoDeAmigo.run(dono, amigo)).changes,
    // Bloquear desfaz a amizade e os pedidos dos dois lados, na mesma transação.
    bloquear(dono, alvo, agora) {
      return transacao(() => { q.apagarApelidosDoPar.run(dono, alvo, alvo, dono); q.apagarAmizade.run(dono, alvo, alvo, dono); return q.bloquear.run(dono, alvo, agora).changes; });
    },
    desbloquear: (dono, alvo) => q.desbloquear.run(dono, alvo).changes,
    // Quem bloqueou, se alguém bloqueou: `null`, ou o id de quem bloqueou (um dos dois).
    bloqueioEntre: (a, b) => q.bloqueioEntre.get(a, b, b, a)?.dono ?? null,
    bloqueadosPor: dono => q.bloqueadosPor.all(dono).map(l => ({ codigo: l.codigo, apelido: l.apelido, perfil: { cor: l.cor ?? null, marca: l.marca ?? null, avatar: l.avatar ?? null }, criadoEm: l.criado_em })),

    // ---------- Conquistas ----------
    // Vários contadores de uma vez, numa transação: é o que o servidor grava a cada 30 s.
    somarContadores(somas) {
      return transacao(() => { for (const { contaId, nome, valor } of somas) q.somarContador.run(contaId, nome, valor); });
    },
    contadoresDe: contaId => Object.fromEntries(q.contadoresDe.all(contaId).map(l => [l.nome, l.valor])),
    guardarConquista: (contaId, id, agora) => q.guardarConquista.run(contaId, id, agora).changes,
    conquistasGuardadas: contaId => q.conquistasGuardadas.all(contaId).map(l => ({ id: l.id, ganhaEm: l.ganha_em })),
    // Uma imagem do rosto, por estado (parado, falando, mudo, ensurdecido), como o avatar: a nova
    // entra e a anterior daquele estado sai na mesma transação. `imagem` nulo tira a do estado.
    trocarRosto(contaId, estado, imagem) {
      return transacao(() => {
        const rosto = lerAjustes(q.perfil.get(contaId)?.rosto);
        const anterior = typeof rosto[estado] === 'string' ? rosto[estado] : null;
        if (imagem) { q.inserirImagem.run(imagem.id, contaId, 'rosto', imagem.tipo, imagem.bytes.length, imagem.bytes, imagem.agora); rosto[estado] = imagem.id; }
        else delete rosto[estado];
        q.definirRosto.run(JSON.stringify(rosto), contaId);
        if (anterior) q.apagarImagem.run(anterior, contaId);
        return rosto;
      });
    },
    // Trocar o avatar é uma imagem nova e a antiga apagada, na mesma transação: nunca sobra uma
    // imagem que ninguém mostra, nem um perfil apontando para uma que não existe mais.
    trocarAvatar(contaId, imagem) {
      return transacao(() => {
        const anterior = q.perfil.get(contaId)?.avatar ?? null;
        if (imagem) q.inserirImagem.run(imagem.id, contaId, 'avatar', imagem.tipo, imagem.bytes.length, imagem.bytes, imagem.agora);
        q.definirAvatar.run(imagem ? imagem.id : null, contaId);
        if (anterior) q.apagarImagem.run(anterior, contaId);
        return anterior;
      });
    },
    inserirImagem: ({ id, contaId, uso, tipo, bytes, agora }) => q.inserirImagem.run(id, contaId, uso, tipo, bytes.length, bytes, agora).changes,
    imagem(id) {
      const linha = q.imagemPorId.get(id);
      return linha ? { id: linha.id, contaId: linha.conta_id, uso: linha.uso, tipo: linha.tipo, tamanho: linha.tamanho, bytes: linha.bytes, criadaEm: linha.criada_em } : null;
    },
    imagensDaConta: (contaId, uso) => q.imagensDaConta.all(contaId, uso).map(l => ({ id: l.id, tipo: l.tipo, tamanho: l.tamanho, criadaEm: l.criada_em })),
    apagarImagem: (id, contaId) => q.apagarImagem.run(id, contaId).changes,
    // O atalho do painel para uma imagem imprópria: todas as da conta, e o avatar volta à cor --
    // e o rosto do Estúdio fica sem imagem própria.
    apagarImagensDaConta(contaId) {
      return transacao(() => {
        q.definirAvatar.run(null, contaId);
        q.definirRosto.run('{}', contaId);
        // O banner e o fundo do cartão vão junto: o cartão volta às cores do tema.
        const vitrine = lerAjustes(q.perfil.get(contaId)?.vitrine);
        if (vitrine.imagens) { delete vitrine.imagens; q.salvarVitrine.run(JSON.stringify(vitrine), contaId); }
        return q.apagarImagensDaConta.run(contaId).changes;
      });
    },
    estudio(contaId) {
      const linha = q.estudio.get(contaId);
      return linha ? { geracao: linha.geracao, config: lerAjustes(linha.config) } : { geracao: 0, config: {} };
    },
    salvarEstudio(contaId, config) {
      transacao(() => { q.garantirEstudio.run(contaId); q.salvarEstudio.run(JSON.stringify(config), contaId); });
    },
    revogarEstudio(contaId) {
      return transacao(() => { q.garantirEstudio.run(contaId); q.revogarEstudio.run(contaId); return q.estudio.get(contaId).geracao; });
    },
    salvarAparencia: (contaId, { cor, marca }) => q.salvarAparencia.run(cor ?? null, marca ?? null, contaId).changes,
    salvarAjustes: (contaId, ajustes) => q.salvarAjustes.run(JSON.stringify(ajustes), contaId).changes,
    definirPlano: (contaId, plano, ate) => q.definirPlano.run(planoParaOBanco(plano), ate ?? null, contaId).changes,
    definirSuspensao: (contaId, ate) => q.definirSuspensao.run(ate ?? null, contaId).changes,
    listarContas({ antesDe = null, limite = 25 } = {}) {
      const [criadaEm, id] = antesDe ? [antesDe.criadaEm, antesDe.id] : [Number.MAX_SAFE_INTEGER, ''];
      return q.listarContas.all(criadaEm, criadaEm, id || '￿', limite).map(conta);
    },
    contagens(agora, desde) {
      return {
        total: q.contarContas.get().total,
        completos: q.contarCompletos.get(PLANO_COMPLETO_GUARDADO, agora).total,
        suspensas: q.contarSuspensas.get(agora).total,
        criadas: q.criadasDesde.all(desde).map(l => l.criada_em)
      };
    },
    fechar() { if (db.isOpen) db.close(); }
  };
}

// A conexão da worker de manutenção: checkpoint, sessões vencidas e cópia. Fica aqui pelo
// mesmo motivo do resto -- é SQL, e SQL mora neste arquivo.
function abrirManutencao({ arquivo = ARQUIVO } = {}) {
  const db = abrirConexao(arquivo, { principal: false });
  const limpar = db.prepare('DELETE FROM sessao WHERE expira_em <= ?');
  return {
    // PASSIVE nunca espera nem bloqueia quem escreve: copia o que dá e volta. É o modo que
    // cabe ao lado de uma conexão principal atendendo gente.
    checkpoint: () => db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get(),
    limparSessoesVencidas: agora => limpar.run(agora).changes,
    conexao: db,
    fechar() { if (db.isOpen) db.close(); }
  };
}

module.exports = { abrirBanco, abrirManutencao, abrirConexao, migrar, lerMigracoes, PASTA, ARQUIVO };
