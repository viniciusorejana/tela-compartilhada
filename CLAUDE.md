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
npm test              # unitários (inclui amigos, cartão e mensagens diretas: tests/amigos.test.js; e os emojis, a lista do seletor e as reações com qualquer emoji: tests/emojis.test.js; e o servidor padrão que os aplicativos trazem, vindo do .env.prod: tests/servidor-padrao.test.js)
npm run test:browser  # Playwright: sala, mídia, ICE
npm run test:painel   # painel de telemetria
npm run test:soundboard
npm run test:download
npm run test:fila     # fila de música, perfil na sala, aviso de atualização
npm run test:inicio   # a busca do início (campo com sugestões), os balões que aguentam o teclado do celular, e a versão nova do app fora da sala
npm run test:camada   # o início e a conta por cima da sala, sem sair da chamada: a chamada de pé por baixo, a barra, atalhos, Esc, Ctrl K, o "voltar", aviso único, trocar de sala
npm run test:carregando # o carregamento do Nexo: a tela cheia (nunca acende numa página rápida; acende e anda numa lenta; o recado entre a página que sai e a que chega; "Saindo da sala"), os três graus (só a marca, o título, a completa; a espera curta sai depressa), as faíscas e o nível, menos movimento, a espera longa que nunca prende, a camada sem tela cheia, o tema claro e o celular, o `<html>` com o CSS e o `tema.js` atrasados (o canvas nunca branco), a tela que nasce já acesa dentro dos aplicativos, e a roda, o esqueleto e o botão ocupado
npm run test:splash   # a splash do aplicativo de mesa no Electron de verdade: nasce antes da janela principal, dura o mínimo e a sala toma o lugar dela; servidor lento, fora do ar e mudo (aos 25 s, a tela de endereço); a primeira abertura; sem splash quando o sistema abre o app minimizado; a página da splash isolada e sem rede
npm run test:bandeja  # a bandeja do sistema do aplicativo de mesa no Electron de verdade (ícone e janela trocados por registros): fechar a janela esconde o Nexo sem encerrá-lo (e o Windows avisa uma vez); o clique, o "Abrir o Nexo" e abrir o Nexo de novo trazem a janela; "Sair do Nexo" e app.quit() (menu, atualização) encerram de verdade; com a chave do menu desligada, fechar encerra como antes
npm run test:agrupamento # o chat da sala junta as mensagens seguidas da mesma pessoa (só a primeira com avatar, nome e hora); 5 minutos de pausa, outra pessoa, resposta ou o divisor de "Novas mensagens" abrem grupo novo; o vão entre grupos é maior que o de dentro; a hora aparece na coluna do avatar ao passar o ponteiro; editar, reagir e apagar refazem o agrupamento; o histórico chega agrupado
npm run test:chassi   # a moldura única do início e da sala: trilho, lateral, linha de cima, "eu" e coluna da direita com a mesma posição e tamanho nas duas páginas (e o "eu" pixel por pixel, o título de cima e os rótulos da lateral no mesmo ponto); entrar por um clique sem o portão; o trilho dentro da chamada; a largura do chat (lembrada, com o palco com chão) com o trilho; recolher a barra; a troca de página animada
npm run test:foto     # a foto de perfil ampliada (cartão do início, prévia do editor, conta, "Meu perfil", configurações, a camada; Esc, teclado, sem foto, celular; o X do visor medido nas três páginas) e trocada no editor do cartão (início e painel da sala); sem título repetido em "Personalizar perfil" e "Conquistas"
npm run test:status   # o status da conta DENTRO da sala (o ponto na lista e no "eu", o menu "Seu status", "Volto já", o cartão), o mesmo menu no "eu" do início (cada status com o seu ponto, o escolhido marcado) e "não incomodar" de verdade: sem som do chat, sem aviso do sistema da menção, sem aviso de mensagem no canto; convites passam (com mídia)
npm run test:cor      # as cores exatas do cartão: o seletor de cor (arrastar, digitar, prontas, teclado), trocar de lugar, sortear, as amostras de banner/fundo/borda/moldura/nome acompanhando na hora, por cima de um painel da sala, a folha do celular, a janela baixa
npm run test:emojis   # o seletor de emojis e onde ele entrou: a frase do status, as reações de mensagem e da plateia, o chat, a conversa direta e os campos do perfil (e não o canal de música); busca, tom de pele, usados por último, teclado, celular
npm run test:volume   # volume por pessoa até 200% (com servidor de mídia), o número digitado, e a folha de volume no celular
npm run test:layout   # nada se sobrepõe nem rola para o lado, de 320 a 2560 px, em cada painel da sala
npm run test:espectadores  # quem está vendo a tela, som de assistir, sugestão de @
npm run test:aparencia     # tema claro/escuro, cores exatas do nível completo, o que a sala lembra, reações com menos movimento
npm run test:novidades     # apresentação da primeira vez, trava, "lido" pela conta, edição nova
npm run test:estudio       # Estúdio: perfil pela plateia e pelo chat, foto grande, link do OBS, selo, rostos (e o rosto de cada um), ensurdecida, permissão
npm run test:webcodecs     # tela por WebCodecs pela faixa de dados: caminho, perda, camadas, sala mista, chave do painel
npm run test:webcodecs:placa  # a placa de verdade pelo RTP: combinações, câmera, aba parada (Chrome instalado; pula sem placa)
npm run test:electron      # o aplicativo de mesa de verdade: seletor de tela, origem presa, atualização do portátil e a sozinha do instalado
npm run test:android       # o lado da sala do app Android: a chamada ligando o serviço, os botões da notificação, o APK novo, as notificações de amigos, o atualizador
npm run test:redimensionar # a largura do chat (alça, setas, duplo clique, lembrada no F5; coluna e gaveta; sem alça no celular)
npm run test:conversa      # reações na mensagem direta (as cinco rápidas, o "+", o outro vendo na hora) e o tamanho do painel de mensagens, pelo canto
npm run test:cartao-sala   # o cartão de perfil aberto na sala: o de cima sempre inteiro; o tempo na sala, a explicação do código e o "Levar para o OBS" nascem recolhidos, o "Ver mais" expande, e a escolha é lembrada
npm run test:servidor      # "Trocar de servidor" nas configurações, só dentro dos dois aplicativos (pontes simuladas); o lado nativo é o electron.cjs
npm run test:atividade     # o aviso visual de tela e música quando o palco não está à vista: balão, ponto no título, notificação sem som; "não incomodar" cala só a do sistema
npm run test:audio-tela    # o som da tela não morre calado: o agente cai, o socket cai, o agente recusa, a tela sobe antes do agente (agente falso, som medido por quem assiste)
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
| Lançar versões novas dos aplicativos (decidir, subir o número, gerar Windows/Android aqui e Linux na VPS, mandar, conferir; GitHub e VPS em dia) | `npm run lancar` (`lancar:plano` só mostra): `deploy/lancamento/lancar.cjs`, as decisões em `versoes.cjs` (`tests/lancamento.test.js`), o que roda na máquina em `deploy/lancamento/remoto/`; a máquina e o ramo em `deploy/lancamento/config.json` (fora do Git; modelo `config.exemplo.json`); cada build anota versão, commit e servidor por `app/escrever-versao.js` (`anotar`, `caminhosDoBuild`). Tudo em `docs/lancar-aplicativos.md` (o `docs/lancamento.md` é outro assunto: custo e preço) |
| Aplicativo Android (WebView, chamada em segundo plano) | `android/` (`MainActivity`, `ChamadaService`); na sala, `public/app-android.js` e os ganchos em `sala.js`; o APK por `scripts/empacotar-android.cjs`; tudo em `docs/android.md` |
| Atualização do Android (baixar, conferir a assinatura, instalar) e "Nexo X disponível" | `Atualizador.java` + `AtualizacaoRecebedor.java`; a notificação na rodada do `AvisosJob` (`conferirVersao`); na página, o mesmo `public/atualizacao-app.js` do aplicativo de mesa (o "motor" do Android vem de `app-android.js`, só do APK 1.1.0 em diante) |
| O aviso de versão nova fora da sala (PC e Android) | `public/atualizacao-app.js` também no início (o botão `#atualizarAppBtn` no topo) e na apresentação (sem o botão, o aviso vem no canto) |
| Notificações de amigos no Android (mensagem, convite, pedido, aceito) | `Avisos.java` + `AvisosJob.java` (a cada 15 min, com o app congelado); a página pede pelo fim de `public/app-android.js` e recebe o toque em `inicio.js`/`social-sala.js` (`aviso-tocado`); o servidor responde em `/api/social/avisos` (`avisosPara`, `social.js`) |
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
| A moldura única do início e da sala: larguras, linha de cima de 56 px, "eu" de 64 px (a troca de página não move nenhuma borda) | os tokens `--chassi-*` em `public/tema.css` (2.10 de `docs/interface.md`); mudou um número, mudam as duas páginas (`inicio.css`, `sala.css`); o desenho e a prova em `docs/plano-continuidade.md` e `npm run test:chassi` |
| O trilho das salas (a coluna escura da esquerda: marca, recentes, novidades), igual no início e na sala | `public/trilho.{js,css}` (`NexoTrilho.pintar`); no início o monta `inicio.js` (`pintarTrilho`), na sala `public/trilho-sala.js` (só com conta; o trilho mora dentro do `.room-sidebar`, e `--col-lateral` é trilho + lateral); a sala de agora vem primeiro com o anel verde, e clicar noutra pergunta antes (`NexoInicioNaSala.pedirEntrada`) |
| O "eu" (a faixa de baixo da lateral: avatar, nome, estado, status e engrenagem), a MESMA peça no início e na sala | `public/eu.css` (`.nx-eu`, `.nx-eu-perfil`, `-avatar`, `-textos`, `-acao`; o ponto do estado e o anel da cor do fundo); no início `.ini-eu` (`inicio.html`; `#euPerfilBtn` vai ao perfil, `#euBtn` é o status), na sala `.self-profile` (`sala.html`, pintado por `renderRoom` em `room-ui.js`); as classes de cada página continuam para o JavaScript. Também `--chassi-topo-lado` e `--chassi-calha` (tema.css): o título de cima e o rótulo de seção da lateral começam no mesmo ponto. Tudo em `docs/interface.md` 4.20; a prova, pixel por pixel, em `npm run test:chassi` |
| Entrar numa sala sem o portão (quem clicou em "Entrar") e a dica de "tem conta" antes da primeira pintura | `public/chassi.js`, síncrono no `<head>`: `NexoChassi.marcarEntrada/consumirEntrada` (recado no `sessionStorage`, 15 s, uma vez) lido em `sala.js` (`NexoConta.pronto`); `html.entrando-direto` esconde `#nameGate` (`sala.css`); `html.com-conta` mostra o trilho já no primeiro quadro. Tudo em `docs/interface.md` 5.3 |
| O carregamento do Nexo: a tela cheia da troca de página e da abertura, progressiva em três graus (nasce só a marca com o anel; depois o título; depois a barra de XP, as dicas e as faíscas que sobem o nível: `data-nivel`, e o relógio atravessa a troca de página pelo recado), a roda, o esqueleto, a barra, o botão ocupado | `public/carregando.{css,js}` (`NexoCarregando`: `concluir`, `etapa`, `navegando`, `esqueleto`; síncrono no `<head>` de toda página, depois do `tema.js`; as páginas que esperam dados marcam `<html data-carregando="manual">` e chamam `concluir()`: `sala.js`, `inicio.js`, `conta.js`); dentro dos aplicativos a página nasce com ela já acesa (`emAplicativo`), porque a splash (linha abaixo) acabou de cobrir a abertura. Tudo em `docs/interface.md` 4.19 |
| A splash dos aplicativos: o que aparece na hora em que abrem (a marca na roda do Nexo no fundo escuro), antes da tela de carregamento da página | aplicativo de mesa (Windows e Linux): `app/splash.html` numa janelinha sem moldura (`criarSplash`, `revelarJanela`, `app/main.js`: a janela principal nasce escondida e a splash sai quando ela pinta, no mínimo 1,1 s depois de abrir; aos 25 s sem servidor vai para a tela de endereço; `NEXO_SEM_SPLASH` e `NEXO_SPLASH_MAXIMO_MS` são dos testes); a do portátil do Windows, enquanto ele se desempacota, é `app/build/splash.bmp`, feito de `splash.html` por `npm run splash:gerar` (`portable.splashImage`); Android: `res/drawable/splash_icone.xml` + `splash_animado.xml`, `Tema.Nexo.Abertura` e `segurarASplash` na `MainActivity` (até a página ter conteúdo à vista, ou 4 s). Tudo em `docs/interface.md` 4.21 e `docs/android.md` ("A splash"); a prova do Electron em `npm run test:splash`; a do Android, só num aparelho |
| O fundo do `<html>` antes de qualquer arquivo (o canvas nunca branco entre duas páginas) | um trechinho inline no `<head>` de toda página (`nexoFundo` + `html { background: var(--bg, #191a24) }`); quem guarda a cor é `tema.js` (`aplicar`); `docs/interface.md` 3 |
| A troca de página animada (início ⇄ sala) | `public/chassi.css` (`@view-transition`, os `view-transition-name`); as regras de menos movimento dos `::view-transition-*` e a rejeição "Transition was skipped" calada em `tema.css` e `tema.js` (toda página os carrega); `docs/interface.md` 2.8 |
| Amigos: pedir, aceitar, apelidar (só para quem deu), bloquear | regra em `contas/amigos.js`, SQL em `contas/banco.js` (migração `0004`), rotas `/api/conta/amigos*` em `contas/rotas.js` |
| Presença, mensagens diretas (só na memória, somem em 3 dias) e convites | `social.js` (namespace `/social`, pelo cookie da conta); na página, `public/social.js` (o cliente) + `conversa.js` (a conversa) + `social.css` |
| Imagem na mensagem direta | só na memória, com teto (20 por conversa, 64 MB no servidor), em `social.js`; servida por `/api/social/imagem/:id` (`server.js`) só para os dois da conversa; reduzida antes de ir por `NexoImagem.prepararParaConversa` (`public/imagem-envio.js`) |
| A personalização do cartão fora dele (borda, nome, moldura, fundo na lista, plateia, chat, foto grande, conversa, conta) | `public/cartao.js` (`decorarAvatar`, `estilizarNome`, `moldurar`, `vestirFundo`); na sala, `pintarAvatar` já aplica a borda e `vestirQuadradinho` (`sala.js`) veste a plateia |
| O cartão de perfil personalizável (banner, fundo, borda, moldura, efeito, nome, bio, bolha, status) e as conquistas | catálogo e regra em `public/vitrine.js` (página e servidor); desenho em `public/cartao.{js,css}`; o editor em `public/editor-cartao.{js,css}`, o mesmo no início e num painel da sala (`social-sala.js`, `abrirEditor`); o que a sala recebe é `perfilNaSala` (`server.js`), com a vitrine efetiva |
| Ver o início e a conta SEM sair da chamada (a marca do Nexo, Ctrl K, "Senha e conta") | a camada: `public/inicio-na-sala.{js,css}` (a sala: abrir/fechar, a barra com microfone/ouvir/sair, o histórico, a pergunta de trocar de sala; `#camadaPanel` e `#camadaSairPanel` em `sala.html`) + `public/camada.js` (o lado da página de dentro: `inicio.js` e `conta.js` mudam de comportamento quando `NexoCamada.embutida`). É um `<iframe>` da própria origem, `?camada=<sala>`; a ponte Android não carrega no quadro (`app-android.js`). Tudo em `docs/interface.md` 5.2 |
| "Criar conta grátis" de dentro da chamada (criar conta muda quem entrou na sala; "Senha e conta" de quem já tem conta é a camada) | um aviso (`irParaContaPanel`; `perfil-sala.js` intercepta todo link para `/conta`) e a saída por `sairDaSala(destino)` (`sala.js`) para `/conta?voltar=` na mesma janela: no aplicativo, outra aba é o navegador |
| Amigos dentro da sala (cartão, convidar, mensagens, avisos) | `public/social-sala.js`; o cartão de perfil é `abrirPerfil` (`sala.js`) |
| Digitar o valor de qualquer régua (clicar no número ao lado) | `public/valor-digitado.js`, na sala e na inicial; o número é `.volume-valor`, `<output for>` ou `[data-valor-de]`, e a régua tem passo 1 para o valor digitado valer exato |
| Foto de perfil e imagens do Estúdio | `contas/imagens.js` + migração `0002`; toda página pinta avatar por `NexoPerfil.pintar` (`public/perfil.js`); preparo no navegador em `public/imagem-envio.js`; a foto grande é o visor de `public/foto-grande.js` (`NexoFoto.abrir`/`ampliavel`; CSS no fim de `cartao.css`, com o X de base própria: a conta não carrega `social.css`), e abre do avatar de todo cartão (`NexoCartao.montar` liga sozinho: início, prévia do editor, sala), da página da conta, do "Meu perfil" e das configurações; a foto se troca na conta, no "Meu perfil", nas configurações e no editor do cartão (o grupo "Foto de perfil", `editor-cartao.js`, `pintarFoto`) |
| O status da conta (disponível, ausente, não incomodar, invisível) dentro da sala, e o que "não incomodar" cala | o servidor manda `perfil.status` no perfil de cada pessoa (`perfilNaSala`, `server.js`; muda por `aplicarPerfilNasSalas`/`peer-perfil`); na sala, `statusDaPessoa` e `pintarStatusNoAvatar` (`sala.js`) desenham o ponto na lista e no "eu" (`room-ui.js`) e no cartão; o menu "Seu status" é `#presenceMenu` (`sala.html`) + `definirStatus` (`social-sala.js`) por `NexoSocial.definirStatus`/`naoIncomodar` (`public/social.js`); cala o som do chat em `sons.js`, o aviso do sistema da menção em `sala.js`, o aviso no canto em `social-sala.js`/`inicio.js` e a notificação do Android em `app-android.js` + `Avisos.java`. Tudo em `docs/amigos-e-perfil.md` ("A presença") |
| Painelzinhos ancorados e os seletores de cor e de emojis | a base é `public/popover.{js,css}` (`NexoPopover.abrir`: ancorado, Esc, clicar fora, folha no celular; `role="group"`, nunca dialog); o de cor, `public/seletor-cor.{js,css}` (`NexoCor`), aberto pelas gemas do editor do cartão; o de emojis, `public/emojis.{js,css}` (`NexoEmojis.abrir`/`botaoDeCampo`/`inserir`) com a lista em `public/emojis.json`, gerada por `npm run emojis:gerar` (`scripts/gerar-emojis.cjs`, do Unicode e do CLDR); a regra "reação é um emoji inteiro" é `ehUmEmoji` em `public/vitrine.js`, aplicada em `server.js` (`chat-acao`, `sinal-presenca`). Entrou na frase do status e nos campos do perfil (`editor-cartao.js`), no chat da sala (`room-ui.js`), nas reações de mensagem e da plateia (`sala.js`) e na conversa direta (`conversa.js`) — e não no canal de música. Tudo em `docs/interface.md` 4.17 |
| O rosto que cada conta escolhe para o Estúdio dos outros | `perfil.rosto` (migração `0003`, `contas/banco.js` `trocarRosto`, rotas `/api/conta/rosto/:estado`); quem monta a cena escolhe a origem por pessoa (`usar`: pessoa, minhas, nenhuma), com a mesma regra em `estudio.js` e `public/reativo.js` (`origemDasImagens`) |
| Abrir o perfil de alguém | `abrirPerfil` (`sala.js`): a lista, o nome embaixo do quadradinho, o quadradinho sem câmera (mesmo compartilhando a tela, que tem o quadradinho dela), e o autor no chat (`abrirPerfilDoAutor`, que abre também para quem já saiu) |
| O som do sistema na tela compartilhada não pode morrer calado | o bloco "O som do sistema não pode morrer calado" de `public/sala.js` (`vigiarOSomDoAgente`: o reprodutor conta o que recebeu e, se nada chega, a captura é pedida de novo com espera crescente; `acrescentarSomDoSistemaAoVivo`: a tela subiu antes do agente e o som entra depois; `esperarOAgenteQueEstaChegando`); `pcm-worklet.js` entrega `recebidos`; no servidor, o `disconnect` só manda o agente parar se aquele socket ainda é o dono do token. Tudo em `docs/audio-da-tela.md` |
| Largura do chat e tamanho da janela de mensagens, escolhidos por quem usa | `public/redimensionar.js` (`NexoRedimensionar.ligar`: um eixo é `role="separator"`, dois eixos é um botão; ponteiro, setas, Home/End, duplo clique volta ao normal); as alças `#chatAlca`/`#musicaAlca`/`#mensagensAlca` em `sala.html`; a largura do chat em `sala.js` (`chatLargura`, `--col-chat-aberto`/`--chat-gaveta`) e o canto das mensagens em `social-sala.js` (`mensagensTamanho`) |
| Reagir a uma mensagem direta | `dm-reagir`/`dm-reacoes` em `social.js` (só amigos, emoji inteiro por `ehUmEmoji`, 20 distintos por mensagem; reagir não acende a notificação); a tela em `public/conversa.js` (`abrirReacoes`, `pintarReacoes`) e `public/social.js` (`reagir`) |
| O que há embaixo do cartão de perfil na sala, minimizado (o tempo na sala, a explicação do código, o "Levar para o OBS"); o cartão de cima fica sempre inteiro | `pintarPerfilMinimizado` (`sala.js`), preferência `perfilMinimizado` (nasce minimizado), o botão `#perfilMais`, o bloco `#perfilDetalhes` em `sala.html` e `.perfil-card.minimizado` em `sala.css` |
| O servidor do Nexo nos aplicativos (pré-preenchido e "Trocar de servidor") | o padrão é a variável `NEXO_SERVIDOR_PADRAO` do `.env.prod`, gravada em `app/servidor-padrao.json` (gerado, fora do Git) por `scripts/servidor-padrao.cjs` ao empacotar (`npm run servidor:padrao`; os `empacotar*` e o `android:empacotar` já rodam) e lida pelo `app/main.js` (`servidorPadrao()`) e pelo Gradle (`BuildConfig.SERVIDOR_PADRAO`); a tela de endereço (`app/endereco.html`, `android/.../assets/endereco.html`) já vem preenchida; o botão nas configurações é `public/servidor-app.js` (bloco `#appServidor` em `sala.html`), que no Android usa `NexoAndroid.trocarServidor` (APK 1.2.0 em diante) |
| Aviso visual de atividade na sala (tela, música) fora do palco | `public/atividade.js` (`NexoAtividade.anunciar/encerrar`): balão com "Assistir", ponto no título da aba e notificação do sistema sem som, só quando o palco não está à vista; ligado em `avisarTela` (`sala.js`) e `public/musica.js`; as preferências em "Sons" nas configurações (`avisosVisuais`) |
| Ensurdecido à vista da sala (e do OBS) | o som é cortado só em `sala.js` (`alternarEnsurdecimento`); o aviso vai pelo evento `ensurdecer` e volta junto com a presença (`presenca-atualizada`, `server.js`), chega em `guardarPresenca` e vira o fone cortado no quadradinho e na lista |
| A bandeja do sistema do aplicativo de mesa (fechar a janela deixa o Nexo escondido ao lado do relógio; "Sair do Nexo" no ícone encerra de verdade) | `app/main.js`, a seção "a bandeja do sistema": `criarBandeja`, `mostrarJanela`, `avisarDaBandeja` e o `close` da janela, que só esconde enquanto `saindo` (posto no `before-quit`) é falso; só Windows e Linux, e sem o ícone fechar encerra como antes; a escolha "Fechar a janela deixa o Nexo na bandeja" (menu, Alt) é `fecharParaBandeja` no `config.json`, e `avisouDaBandeja` lembra o balão do Windows (uma vez). Quem atualiza ou sai por `app.quit()` não fica preso nela. Prova: `npm run test:bandeja` |
| Mensagens seguidas da mesma pessoa no chat da sala (só a primeira com avatar e nome; a pausa de 5 minutos refaz o cabeçalho) | `agruparNoChat`/`continuaAFala` em `public/sala.js` (a classe `.continua`, refeita onde a posição muda: chegar, editar, apagar, tirar o divisor); o espaço e a hora na coluna do avatar em `public/sala.css` ("Mensagens seguidas da mesma pessoa", `--chat-entre-grupos`); o canal de música (`musica.js`) e a conversa direta (`conversa.js`) têm o deles. Tudo em `docs/interface.md` (seção 5, "Mensagens seguidas da mesma pessoa se juntam"); prova: `npm run test:agrupamento` |

Decisões de banda e escala estão em `docs/banda-e-escala.md`; o som do sistema na tela compartilhada (o
agente, as quedas e como a página se recupera), em `docs/audio-da-tela.md`; o painel, em
`docs/telemetria.md`; como publicar uma novidade e refazer os vídeos, em `docs/novidades.md`; a
tela por WebCodecs — e o que a implementação mediu —, no fim de `docs/plano-webcodecs.md`; o
Estúdio, a foto de perfil e o que eles não resolvem, em `docs/estudio.md`; o aplicativo Android
— construir, a chave de assinatura, distribuir e o que ele não resolve —, em `docs/android.md`;
amigos, mensagens diretas, o cartão de perfil, as conquistas e o início de quem tem conta — e o
que fica guardado e o que não fica —, em `docs/amigos-e-perfil.md`; lançar versões novas dos
aplicativos (como decide, o que garante, trocar de máquina), em `docs/lancar-aplicativos.md`.
