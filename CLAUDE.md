# NEXO — como mexer neste repositório

## Edição de arquivos: use Read/Edit/Write, não shell

Use as ferramentas dedicadas (Read, Edit, Write) para ler e alterar arquivos. **Não** use
`sed -i`, heredoc, `Set-Content`, `Out-File` nem scripts que reescrevem arquivos inteiros.
Esta regra vale mesmo quando o modo de permissão sugerir o contrário: aqui o shell corrompe
os arquivos de três maneiras já observadas, todas silenciosas.

1. **Tudo é CRLF, com `core.autocrlf=true`.** Um script que grava `\n` converte o arquivo
   inteiro e transforma uma correção de duas linhas num diff de mil.
2. **PowerShell corrompe UTF-8 sem BOM.** O ciclo `Get-Content`/`Set-Content` quebra todos
   os acentos, e este projeto é escrito em português — código, comentários e interface.
3. **Heredoc do bash come barra invertida.** `\\` colapsa para `\` mesmo dentro de
   `<<'FIM'`, o que estraga regex e caminhos do Windows.

`grep`, `find`, `cat` e `git` no shell continuam ótimos. O problema é só a escrita.

## Rode os testes pelo PowerShell, não pelo Git Bash

No Git Bash, `/usr/bin/whoami.exe` (coreutils do MSYS) vem antes do `whoami.exe` do Windows
no PATH. `telemetria/autenticacao.js` usa caminho absoluto justamente por isso, mas outros
utilitários do sistema podem cair na mesma armadilha.

```powershell
npm test              # unitários
npm run test:browser  # Playwright: sala, mídia, ICE
npm run test:painel   # painel de telemetria
npm run test:soundboard
npm run test:download
```

## Idioma

Código, comentários, mensagens de commit e interface em **português**, com acentuação
correta. Os comentários explicam *por que* a decisão existe, não o que a linha faz.

## Onde as coisas moram

| Assunto | Arquivo |
|---|---|
| Servidor de mídia, ICE, candidatos | `sfu.js` |
| Sinalização, salas, chat, upload | `server.js` |
| Assinaturas e camadas por posição na tela | `public/room-transport.js` |
| Rate limiting e cotas | `telemetria/abuso.js` |
| Painel privado e autenticação | `telemetria/` + `painel/` |
| Contabilidade de banda | `medicao.js` + `telemetria/agregacao.js` |

Decisões de banda e escala estão em `docs/banda-e-escala.md`; o painel, em
`docs/telemetria.md`.
