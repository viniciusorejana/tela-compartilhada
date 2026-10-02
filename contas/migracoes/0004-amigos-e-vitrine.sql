-- Migração 4: amigos, o cartão de perfil personalizável e as conquistas.
--
-- Tudo aqui é da CONTA e vai embora com ela pelo CASCADE: "apagar minha conta" leva amizades,
-- apelidos, bloqueios e contadores sem ninguém lembrar de cada tabela. Mensagens diretas NÃO
-- moram aqui: elas ficam na memória do servidor e somem três dias depois da última mensagem
-- (social.js e docs/amigos-e-perfil.md).

-- O cartão de perfil (public/vitrine.js, forma fechada) e o status escolhido.
ALTER TABLE perfil ADD COLUMN vitrine TEXT NOT NULL DEFAULT '{}';
ALTER TABLE perfil ADD COLUMN social TEXT NOT NULL DEFAULT '{}';

-- Os usos novos de imagem: o banner e o fundo do cartão. O SQLite não muda um CHECK de uma coluna
-- existente, então a tabela é refeita com os mesmos dados, como na migração 3.
CREATE TABLE imagem_nova (
  id        TEXT PRIMARY KEY,
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  uso       TEXT NOT NULL CHECK (uso IN ('avatar', 'estudio', 'rosto', 'banner', 'fundo')),
  tipo      TEXT NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  tamanho   INTEGER NOT NULL,
  bytes     BLOB NOT NULL,
  criada_em INTEGER NOT NULL
) STRICT;
INSERT INTO imagem_nova (id, conta_id, uso, tipo, tamanho, bytes, criada_em)
  SELECT id, conta_id, uso, tipo, tamanho, bytes, criada_em FROM imagem;
DROP TABLE imagem;
ALTER TABLE imagem_nova RENAME TO imagem;
CREATE INDEX imagem_por_conta ON imagem(conta_id, uso);

-- Uma linha por par, com quem pediu em `de_conta`. Amizade é simétrica; quem consulta procura
-- dos dois lados (contas/banco.js). Pendente é pedido; aceita é amizade.
CREATE TABLE amizade (
  de_conta   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  para_conta TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  estado     TEXT NOT NULL CHECK (estado IN ('pendente', 'aceita')),
  criada_em  INTEGER NOT NULL,
  aceita_em  INTEGER,
  PRIMARY KEY (de_conta, para_conta),
  CHECK (de_conta <> para_conta)
) STRICT;
CREATE INDEX amizade_para ON amizade(para_conta);

-- O apelido que uma pessoa dá a um amigo. Só ela vê.
CREATE TABLE apelido_de_amigo (
  dono    TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  amigo   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  apelido TEXT NOT NULL,
  PRIMARY KEY (dono, amigo)
) STRICT;

-- Quem bloqueou quem. O bloqueado não fica sabendo.
CREATE TABLE bloqueio (
  dono      TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  alvo      TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (dono, alvo),
  CHECK (dono <> alvo)
) STRICT;
CREATE INDEX bloqueio_alvo ON bloqueio(alvo);

-- Os contadores das conquistas: somas, e nada mais. Não guardam sala, nem com quem, nem quando.
CREATE TABLE contador (
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  nome     TEXT NOT NULL CHECK (nome IN ('salas', 'telas', 'mensagens', 'minutos')),
  valor    INTEGER NOT NULL DEFAULT 0 CHECK (valor >= 0),
  PRIMARY KEY (conta_id, nome)
) STRICT;

-- As conquistas ganhas que dependem de algo que pode voltar atrás (os amigos): ganhou, fica.
CREATE TABLE conquista (
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  ganha_em  INTEGER NOT NULL,
  PRIMARY KEY (conta_id, id)
) STRICT;
