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
npm test              # unitários (inclui amigos, cartão e mensagens diretas: tests/amigos.test.js)
npm run test:browser  # Playwright: sala, mídia, ICE
npm run test:painel   # painel de telemetria
npm run test:soundboard
npm run test:download
npm run test:fila     # fila de música, perfil na sala, aviso de atualização
npm run test:volume   # volume por pessoa até 200% (com servidor de mídia), o número digitado, e a folha de volume no celular
npm run test:layout   # nada se sobrepõe nem rola para o lado, de 320 a 2560 px, em cada painel da sala
npm run test:espectadores  # quem está vendo a tela, som de assistir, sugestão de @
npm run test:aparencia     # tema claro/escuro, cores exatas do premium, o que a sala lembra, reações com menos movimento
npm run test:novidades     # apresentação da primeira vez, trava, "lido" pela conta, edição nova
npm run test:estudio       # Estúdio: perfil pela plateia e pelo chat, foto grande, link do OBS, selo, rostos (e o rosto de cada um), ensurdecida, permissão
npm run test:webcodecs     # tela por WebCodecs pela faixa de dados: caminho, perda, camadas, sala mista, chave do painel
npm run test:webcodecs:placa  # a placa de verdade pelo RTP: combinações, câmera, aba parada (Chrome instalado; pula sem placa)
npm run test:electron      # o aplicativo de mesa de verdade: seletor de tela, origem presa, atualização do portátil e a sozinha do instalado
npm run test:android       # o lado da sala do app Android: a chamada ligando o serviço, os botões da notificação, o APK novo
```

O Android em si (`android/`) compila com o Gradle do wrapper e um JDK 17 ou 21 (o 25 da máquina
não serve): `$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'; .\gradlew.bat assembleDebug lintDebug`,
dentro de `android/`. Não há emulador nesta máquina; o lado nativo se prova num aparelho
(docs/android.md, "Testes").

O Chromium do Playwright não tem placa de vídeo: tudo que depende de `prefer-hardware` só se
prova com `test:webcodecs:placa`, que usa o Chrome da máquina.

A tela falsa dos testes é um canvas, e o canvas não tem o limite da captura de verdade, que
entrega à página quadros de um conjunto pequeno de buffers: código que guarda quadros da
captura se prova com a câmera falsa do Chrome ou com uma aba capturada de verdade (ver o fim de
`tests/webcodecs-placa.cjs`).

## Interface: o padrão está em `docs/interface.md`

Antes de criar ou mudar uma tela, leia `docs/interface.md`: os tokens, as peças prontas (botões,
campos, painéis, menus, avisos, selos, avatares, ícones), a responsividade, a acessibilidade, os
sons, como o Nexo escreve, e a lista do que conferir antes de entregar. Mudou o padrão, muda o
documento junto.

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
| Bot de música: fila, repetir (faixa e fila), volume | `musica.js` (a regra do repetir é `proximaFaixa`); os comandos em `server.js` (`interpretarComandoDeMusica`, `musica-fila`); a tela em `public/musica.js` |
| Mesa de sons: um som por pessoa, parar o próprio som | `soundboard.js` (servidor) + `public/soundboard.js`; o parar é o evento `soundboard-parar` (`server.js`) |
| Instalador do aplicativo de mesa (NSIS, .deb) e a atualização sozinha | `build` em `app/package.json`; `app/atualizacao-automatica.js` (electron-updater pelo servidor escolhido), `app/iniciar-com-o-sistema.js`; a pasta `/downloads/atualizacoes` em `desktop-download.js`; na sala, `public/atualizacao-app.js` (o aviso e a seção "Aplicativo de mesa") |
| Downloads da página inicial (todos os sistemas e o APK) | `desktop-download.js` (`SISTEMAS`) + `public/download.js`; a versão de cada build em `app/dist/versao.json` |
| Aplicativo Android (WebView, chamada em segundo plano) | `android/` (`MainActivity`, `ChamadaService`); na sala, `public/app-android.js` e os ganchos em `sala.js`; o APK por `scripts/empacotar-android.cjs`; tudo em `docs/android.md` |
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
| O início de quem tem conta (`/` com sessão; a apresentação fica em `/sobre`) | `public/inicio.{html,css,js}`; a escolha da página é a rota `/` de `server.js`, antes do `static` |
| Amigos: pedir, aceitar, apelidar (só para quem deu), bloquear | regra em `contas/amigos.js`, SQL em `contas/banco.js` (migração `0004`), rotas `/api/conta/amigos*` em `contas/rotas.js` |
| Presença, mensagens diretas (só na memória, somem em 3 dias) e convites | `social.js` (namespace `/social`, pelo cookie da conta); na página, `public/social.js` (o cliente) + `conversa.js` (a conversa) + `social.css` |
| Imagem na mensagem direta | só na memória, com teto (20 por conversa, 64 MB no servidor), em `social.js`; servida por `/api/social/imagem/:id` (`server.js`) só para os dois da conversa; reduzida antes de ir por `NexoImagem.prepararParaConversa` (`public/imagem-envio.js`) |
| A personalização do cartão fora dele (borda, nome, moldura, fundo na lista, plateia, chat, foto grande, conversa, conta) | `public/cartao.js` (`decorarAvatar`, `estilizarNome`, `moldurar`, `vestirFundo`); na sala, `pintarAvatar` já aplica a borda e `vestirQuadradinho` (`sala.js`) veste a plateia |
| O cartão de perfil personalizável (banner, fundo, borda, moldura, efeito, nome, bio, bolha, status) e as conquistas | catálogo e regra em `public/vitrine.js` (página e servidor); desenho em `public/cartao.{js,css}`; o editor em `public/editor-cartao.{js,css}`, o mesmo no início e num painel da sala (`social-sala.js`, `abrirEditor`); o que a sala recebe é `perfilNaSala` (`server.js`), com a vitrine efetiva |
| "Senha e conta" e todo "Criar conta grátis" de dentro da chamada | um aviso (`irParaContaPanel`; `perfil-sala.js` intercepta todo link para `/conta`) e a saída por `sairDaSala(destino)` (`sala.js`) para `/conta?voltar=` na mesma janela: no aplicativo, outra aba é o navegador |
| Amigos dentro da sala (cartão, convidar, mensagens, avisos) | `public/social-sala.js`; o cartão de perfil é `abrirPerfil` (`sala.js`) |
| Digitar o valor de qualquer régua (clicar no número ao lado) | `public/valor-digitado.js`, na sala e na inicial; o número é `.volume-valor`, `<output for>` ou `[data-valor-de]`, e a régua tem passo 1 para o valor digitado valer exato |
| Foto de perfil e imagens do Estúdio | `contas/imagens.js` + migração `0002`; toda página pinta avatar por `NexoPerfil.pintar` (`public/perfil.js`); preparo no navegador em `public/imagem-envio.js`; a foto grande abre do cartão de perfil (`abrirFoto`, `sala.js`) |
| O rosto que cada conta escolhe para o Estúdio dos outros | `perfil.rosto` (migração `0003`, `contas/banco.js` `trocarRosto`, rotas `/api/conta/rosto/:estado`); quem monta a cena escolhe a origem por pessoa (`usar`: pessoa, minhas, nenhuma), com a mesma regra em `estudio.js` e `public/reativo.js` (`origemDasImagens`) |
| Abrir o perfil de alguém | `abrirPerfil` (`sala.js`): a lista, o nome embaixo do quadradinho, o quadradinho sem câmera (mesmo compartilhando a tela, que tem o quadradinho dela), e o autor no chat (`abrirPerfilDoAutor`, que abre também para quem já saiu) |
| Ensurdecido à vista da sala (e do OBS) | o som é cortado só em `sala.js` (`alternarEnsurdecimento`); o aviso vai pelo evento `ensurdecer` e volta junto com a presença (`presenca-atualizada`, `server.js`), chega em `guardarPresenca` e vira o fone cortado no quadradinho e na lista |

Decisões de banda e escala estão em `docs/banda-e-escala.md`; o painel, em
`docs/telemetria.md`; como publicar uma novidade e refazer os vídeos, em `docs/novidades.md`; a
tela por WebCodecs — e o que a implementação mediu —, no fim de `docs/plano-webcodecs.md`; o
Estúdio, a foto de perfil e o que eles não resolvem, em `docs/estudio.md`; o aplicativo Android
— construir, a chave de assinatura, distribuir e o que ele não resolve —, em `docs/android.md`;
amigos, mensagens diretas, o cartão de perfil, as conquistas e o início de quem tem conta — e o
que fica guardado e o que não fica —, em `docs/amigos-e-perfil.md`.
