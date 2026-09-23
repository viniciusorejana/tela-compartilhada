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

// A linha do banco vira objeto do código aqui, uma vez. `plano_ate` e companhia não vazam
// para o resto do servidor com nome de coluna.
function conta(linha) {
  if (!linha) return null;
  return {
    id: linha.id, codigo: linha.codigo, usuario: linha.usuario, apelido: linha.apelido,
    senha: linha.senha ?? null, recuperacao: linha.recuperacao ?? null,
    email: linha.email ?? null, plano: linha.plano, planoAte: linha.plano_ate ?? null,
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
    perfil: sql('SELECT cor, marca, ajustes FROM perfil WHERE conta_id = ?'),
    salvarAparencia: sql('UPDATE perfil SET cor = ?, marca = ? WHERE conta_id = ?'),
    salvarAjustes: sql('UPDATE perfil SET ajustes = ? WHERE conta_id = ?'),
    definirPlano: sql('UPDATE conta SET plano = ?, plano_ate = ? WHERE id = ?'),
    definirSuspensao: sql('UPDATE conta SET suspensa_ate = ? WHERE id = ?'),
    // O painel pagina pelo instante de criação, do mais novo para o mais antigo. O `id` no
    // desempate impede que duas contas criadas no mesmo milissegundo sumam entre páginas.
    listarContas: sql(`SELECT ${COLUNAS_DA_CONTA} FROM conta c
      WHERE (c.criada_em < ? OR (c.criada_em = ? AND c.id < ?)) ORDER BY c.criada_em DESC, c.id DESC LIMIT ?`),
    contarContas: sql('SELECT COUNT(*) AS total FROM conta'),
    contarPremium: sql("SELECT COUNT(*) AS total FROM conta WHERE plano = 'premium' AND (plano_ate IS NULL OR plano_ate > ?)"),
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
      return linha ? { cor: linha.cor ?? null, marca: linha.marca ?? null, ajustes: lerAjustes(linha.ajustes) } : null;
    },
    salvarAparencia: (contaId, { cor, marca }) => q.salvarAparencia.run(cor ?? null, marca ?? null, contaId).changes,
    salvarAjustes: (contaId, ajustes) => q.salvarAjustes.run(JSON.stringify(ajustes), contaId).changes,
    definirPlano: (contaId, plano, ate) => q.definirPlano.run(plano, ate ?? null, contaId).changes,
    definirSuspensao: (contaId, ate) => q.definirSuspensao.run(ate ?? null, contaId).changes,
    listarContas({ antesDe = null, limite = 25 } = {}) {
      const [criadaEm, id] = antesDe ? [antesDe.criadaEm, antesDe.id] : [Number.MAX_SAFE_INTEGER, ''];
      return q.listarContas.all(criadaEm, criadaEm, id || '￿', limite).map(conta);
    },
    contagens(agora, desde) {
      return {
        total: q.contarContas.get().total,
        premium: q.contarPremium.get(agora).total,
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
