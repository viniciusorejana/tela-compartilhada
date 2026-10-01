-- Migração 3: o rosto de cada pessoa no Estúdio.
--
-- Cada conta pode escolher as próprias imagens para os rostos que reagem à voz -- parado,
-- falando, mudo e ensurdecido. Elas são da pessoa, e não de quem monta a cena: quem a leva para
-- o OBS vê essas imagens e decide se usa, se anexa outras ou se fica com a foto (estudio.js).
--
-- O SQLite não muda um CHECK de uma coluna existente: a tabela das imagens é refeita com o uso
-- novo, com os mesmos dados. Nenhuma outra tabela aponta para ela (o avatar é um id solto no
-- perfil), então trocá-la não toca em mais nada.
CREATE TABLE imagem_nova (
  id        TEXT PRIMARY KEY,
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  uso       TEXT NOT NULL CHECK (uso IN ('avatar', 'estudio', 'rosto')),
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

-- As imagens do rosto, por estado, em JSON: {"parado": id, "falando": id, ...}. Vazio é "sem
-- rosto próprio" -- vale a foto, como sempre.
ALTER TABLE perfil ADD COLUMN rosto TEXT NOT NULL DEFAULT '{}';
