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
npm run test:fila     # fila de música, perfil na sala, aviso de atualização
npm run test:volume   # volume por pessoa até 200% (com servidor de mídia), o número digitado, e a folha de volume no celular
npm run test:layout   # nada se sobrepõe nem rola para o lado, de 320 a 2560 px, em cada painel da sala
npm run test:espectadores  # quem está vendo a tela, som de assistir, sugestão de @
npm run test:aparencia     # tema claro/escuro, cores exatas do premium, o que a sala lembra
npm run test:novidades     # apresentação da primeira vez, trava, "lido" pela conta, edição nova
npm run test:estudio       # Estúdio: foto, link da câmera para o OBS, selo na sala, rostos que reagem, permissão
npm run test:webcodecs     # tela por WebCodecs pela faixa de dados: caminho, perda, camadas, sala mista, chave do painel
npm run test:webcodecs:placa  # a placa de verdade pelo RTP: combinações, câmera, aba parada (Chrome instalado; pula sem placa)
```

O Chromium do Playwright não tem placa de vídeo: tudo que depende de `prefer-hardware` só se
prova com `test:webcodecs:placa`, que usa o Chrome da máquina.

A tela falsa dos testes é um canvas, e o canvas não tem o limite da captura de verdade, que
entrega à página quadros de um conjunto pequeno de buffers: código que guarda quadros da
captura se prova com a câmera falsa do Chrome ou com uma aba capturada de verdade (ver o fim de
`tests/webcodecs-placa.cjs`).

## Cor no CSS: sempre pelos tokens

O Nexo tem tema claro, temas prontos e cores exatas escolhidas pela pessoa. Tudo isso só
funciona porque nenhuma cor de superfície, texto, borda sutil ou destaque está escrita direto
no CSS: elas vêm de `public/tema.css` (`--bg-fundo`…`--bg-5`, `--bg-cartao`, `--text`…`--apagado`,
`rgb(var(--tinta) / N%)` para sobreposições, `--accent*`, `--online`, `--danger`, `--aviso`,
`--rosa` e os `-texto` de cada um). Uma cor fixa fica igual nos dois temas e, no claro, some.

Cor fixa só para o que é igual nos dois temas: o que está sobre vídeo (o palco, o quadradinho e
a grade são `.contexto-escuro`, escuros sempre), preenchimento colorido com texto escuro, sombra
e ilustração. Para converter cores em lote: um Edit com `replace_all` por cor, sempre a de
8 dígitos antes da de 6 — `#a092ff` é o começo de `#a092ff40`.

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
| Tempo da sala e de cada pessoa (sobrevive ao F5) | `tempos.js` + `public/tempo-sala.js` |
| Avisos sonoros | `public/sons.js`; arquivos montados por `scripts/sons/compor.cjs` |
| Painel de configurações (perfil, sons, aparência, atalhos) | `public/configuracoes.js` + `sala.html` |
| Página de "não encontrada" | `public/404.html` + `nao-encontrada.{css,js}`; a rota é a última de `server.js` |
| Aviso no canto (download, atualização) | `public/toast.js`; o download do app em `app/main.js` |
| Tema claro/escuro, temas prontos, cores exatas | `public/tema.js` (no `<head>` de toda página) + tokens em `public/tema.css` |
| Quem está vendo cada tela | `espectadores.js` (servidor) + `public/espectadores.js` |
| Sugestão de `@` no chat | `public/mencoes.js` |
| Barra de cima por largura | container queries `topo` no fim de `public/sala.css` |
| Apresentação e novidades (o modal) | `public/novidades.js` + `novidades.css`; o texto de cada edição em `public/novidades-edicoes.js` |
| Vídeos de apresentação e de lançamento | `video/` (Remotion, dependências próprias); saem em `public/midia` por `npm run video:renderizar` |
| Tela pela placa, transportada pelo RTP (o Automático) | `public/tela-placa-rtp.js` + o Worker `tela-placa-rtp-trabalhador.js`; escolhida em `aplicarPublicacao` (`sala.js`) |
| Tela por WebCodecs pela faixa de dados (o "Forçar") | `public/tela-webcodecs.js` + `tela-{quadro,decisoes,codificador,decodificador}.js`; ligado em `room-transport.js`; chave do servidor em `chave-webcodecs.js` |
| Estúdio: links para o OBS e rostos que reagem à voz | regra em `estudio.js`, no ar em `estudio-ao-vivo.js` (namespace `/estudio`); `public/obs.js` (a fonte do OBS), `reativo.js` (os rostos), `estudio.js` + `estudio.css` (o painel do Estúdio, na sala, só com conta), `estudio-sala.js` (permissão, cartão de perfil, selo OBS, botão da barra); o controle do dono é `estudio` na configuração da sala |
| Volume por pessoa no toque (a pílula e a folha com a régua grande) | `public/volume-folha.js`; o volume em si continua em `sala.js` ("Volume, em um lugar so") |
| Digitar o valor de qualquer régua (clicar no número ao lado) | `public/valor-digitado.js`, na sala e na inicial; o número é `.volume-valor`, `<output for>` ou `[data-valor-de]`, e a régua tem passo 1 para o valor digitado valer exato |
| Foto de perfil e imagens do Estúdio | `contas/imagens.js` + migração `0002`; toda página pinta avatar por `NexoPerfil.pintar` (`public/perfil.js`); preparo no navegador em `public/imagem-envio.js` |

Decisões de banda e escala estão em `docs/banda-e-escala.md`; o painel, em
`docs/telemetria.md`; como publicar uma novidade e refazer os vídeos, em `docs/novidades.md`; a
tela por WebCodecs — e o que a implementação mediu —, no fim de `docs/plano-webcodecs.md`; o
Estúdio, a foto de perfil e o que eles não resolvem, em `docs/estudio.md`.
