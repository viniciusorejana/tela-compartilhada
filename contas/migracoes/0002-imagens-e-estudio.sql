-- Migração 2: imagens de perfil e o Estúdio.
--
-- A imagem mora no banco, e não num arquivo ao lado: ela é da conta, e "apagar minha conta"
-- tem de levá-la junto pelo mesmo CASCADE que já leva perfil e sessões -- um arquivo solto na
-- pasta seria a imagem que sobrevive à conta. O tamanho é pequeno e tem teto (contas/imagens.js),
-- e a cópia diária do banco passa a levar as imagens sem ninguém lembrar delas.

CREATE TABLE imagem (
  id        TEXT PRIMARY KEY,                           -- sorteado; é ele que vai no endereço
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  uso       TEXT NOT NULL CHECK (uso IN ('avatar', 'estudio')),
  tipo      TEXT NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  tamanho   INTEGER NOT NULL,
  bytes     BLOB NOT NULL,
  criada_em INTEGER NOT NULL
) STRICT;
CREATE INDEX imagem_por_conta ON imagem(conta_id, uso);

-- O avatar é uma imagem da própria conta; NULL volta à cor e à marca.
ALTER TABLE perfil ADD COLUMN avatar TEXT;

-- O Estúdio de cada conta: a configuração dos rostos que reagem à voz, e a geração dos links.
-- Revogar é somar um: todo link da geração anterior deixa de valer (estudio.js).
CREATE TABLE estudio (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  geracao  INTEGER NOT NULL DEFAULT 0,
  config   TEXT NOT NULL DEFAULT '{}'
) STRICT;
