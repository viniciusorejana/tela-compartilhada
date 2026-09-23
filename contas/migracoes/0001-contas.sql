-- Migração 1: a conta, o perfil, as sessões e o lugar do Discord.
--
-- Escrita para os dois bancos: tabelas STRICT (o SQLite recusa tipo errado na hora, como o
-- Postgres recusaria na importação), datas em epoch ms vindas do código, ids gerados no
-- código e nenhum `datetime('now')`. Ver docs/plano-contas.md, seção 1.

CREATE TABLE conta (
  id               TEXT PRIMARY KEY,                    -- uuid; nunca sai do servidor
  codigo           TEXT NOT NULL UNIQUE,                -- 'K7M2PQ4X'; imutável; exibido 'K7M2-PQ4X'
  usuario          TEXT NOT NULL UNIQUE,                -- para entrar; já normalizado no código
  apelido          TEXT NOT NULL,                       -- livre e repetível
  senha            TEXT,                                -- 'scrypt$N$r$p$sal$derivada'; NULL em conta só de OAuth
  recuperacao      TEXT,                                -- scrypt do código mostrado uma vez; de uso único
  email            TEXT,                                -- opcional até o pagamento
  email_chave      TEXT UNIQUE,                         -- normalizado; vários NULL convivem nos dois bancos
  email_confirmado INTEGER NOT NULL DEFAULT 0 CHECK (email_confirmado IN (0, 1)),
  plano            TEXT NOT NULL DEFAULT 'gratis' CHECK (plano IN ('gratis', 'premium')),
  plano_ate        INTEGER,                             -- epoch ms; NULL = sem prazo
  faixa_etaria     TEXT,                                -- lugar reservado ao ECA Digital; sem verificação ainda
  criada_em        INTEGER NOT NULL,
  vista_em         INTEGER NOT NULL,
  suspensa_ate     INTEGER                              -- moderação global, fora da sala
) STRICT;
CREATE INDEX conta_por_criacao ON conta(criada_em);

CREATE TABLE perfil (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  cor      TEXT,
  marca    TEXT,                                        -- de um conjunto fechado
  ajustes  TEXT NOT NULL DEFAULT '{}'                   -- JSON com teto de tamanho
) STRICT;

CREATE TABLE sessao (
  id        TEXT PRIMARY KEY,                           -- sha256 do token; o token não é guardado
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  criada_em INTEGER NOT NULL,
  ultima_em INTEGER NOT NULL,                           -- tocada no máximo a cada 5 min
  expira_em INTEGER NOT NULL,
  aparelho  TEXT
) STRICT;
CREATE INDEX sessao_por_conta ON sessao(conta_id);
CREATE INDEX sessao_por_prazo ON sessao(expira_em);

CREATE TABLE identidade_externa (                       -- vazia até o Discord entrar
  provedor   TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  conta_id   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  PRIMARY KEY (provedor, id_externo)
) STRICT;
