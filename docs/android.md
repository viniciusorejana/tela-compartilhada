# O Nexo para Android

Escrito em 02/10/2026. O aplicativo Android (`android/`) é a mesma sala do navegador numa
WebView, do jeito que o aplicativo de mesa é a mesma sala numa janela do Electron: a interface
não é copiada, a janela carrega o servidor que a pessoa escolheu. Uma interface só, um lugar
para manter.

O que ele acrescenta ao navegador do celular é o que importa numa chamada — **a voz continua
com a tela apagada e com outro aplicativo na frente** — e, desde a 1.1.0, **notificações de
amigos**: mensagem direta, convite para sala, pedido de amizade e pedido aceito.

| assunto | onde mora |
|---|---|
| A janela, a ponte, as permissões, os links | `android/app/src/main/java/com/telacompartilhada/nexo/MainActivity.java` |
| A chamada em segundo plano e a notificação | `ChamadaService.java`, na mesma pasta |
| As notificações de amigos (montar, não repetir, limpar) | `Avisos.java`, na mesma pasta; do lado da página, o fim de `public/app-android.js` |
| A pergunta ao servidor com o aplicativo congelado | `AvisosJob.java`; no servidor, `/api/social/avisos` (`server.js`) e `avisosPara` (`social.js`) |
| A atualização (baixar, conferir a assinatura, instalar) | `Atualizador.java` + `AtualizacaoRecebedor.java`; na página, `public/atualizacao-app.js` (ver "A atualização") |
| A tela de endereço (antes de qualquer servidor) | `android/app/src/main/assets/endereco.html` |
| A ponte do lado da sala | `public/app-android.js`; os ganchos em `sala.js` (`atualizarModoSegundoPlano`, `encerrarMidiasDaSala`) |
| A versão do aplicativo | `versionCode` e `versionName` em `android/app/build.gradle` |
| Empacotar e pôr no servidor | `scripts/empacotar-android.cjs` (`npm run android:empacotar`) |

---

## Por que um aplicativo, e por que assim

No navegador do celular a sala já funciona, mas o Android trata o Chrome como qualquer
aplicativo que saiu da tela: alguns segundos depois ele corta o microfone (desde o Android 9,
aplicativo em segundo plano grava silêncio) e logo congela a aba. O `sala.js` já faz o que dá
para fazer de dentro da página — o áudio de fundo, a Media Session, a trava de tela —, e o
próprio comentário de lá diz o limite: "nada aqui é garantia". O que o Android deixa fazer é
**declarar a chamada**: um serviço em primeiro plano, do tipo microfone e reprodução, com uma
notificação à vista enquanto ele dura. Isso só um aplicativo faz.

As alternativas, e por que não:

- **PWA ou TWA** rodam dentro do Chrome, e herdam o mesmo limite — e a TWA ainda exige um
  domínio fixo verificado, quando cada Nexo é hospedado num endereço diferente.
- **Capacitor ou Cordova** trazem um servidor local e uma ponte que só vale para a origem
  escolhida *na hora do build* (`server.url`). Aqui a origem é escolhida pela pessoa, como no
  aplicativo de mesa; seria contornar o framework em vez de usá-lo.
- **WebView nativa, em Java**, com duas dependências pequenas (`androidx.core` para a
  notificação e o serviço em todas as versões, `androidx.webkit` para a ponte presa a uma
  origem). O APK assinado tem cerca de 2 MB.

## Como a chamada sobrevive

```
sala.js ── atualizarModoSegundoPlano() ──► app-android.js ── nexoAndroid.postMessage ──► MainActivity
                                                                                            │
   alternarMicPorGesto() / sairDaSala() ◄── "alternar-microfone" / "sair" ◄── ChamadaService (notificação)
```

1. A sala já tinha um lugar que responde "estou numa chamada?" (`precisaDeSegundoPlano`, em
   `sala.js`), chamado a cada mudança de microfone, câmera, tela e conexão. É ali que ela conta ao
   aplicativo: ativa ou não, a sala, o microfone e o ensurdecer. Só vai quando muda.
2. O aplicativo liga o `ChamadaService`: serviço em primeiro plano do tipo **microfone** (se a
   permissão já foi dada) e **reprodução** (sempre — quem só ouve também quer ouvir com a tela
   apagada), uma trava de processador e uma trava de Wi-Fi, e a notificação "Na sala #squad ·
   Microfone desligado", com **Ligar/Desligar microfone** e **Sair da sala**.
3. Os botões da notificação voltam pelo mesmo caminho e viram, na página, o mesmo clique do botão
   Microfone e do botão Sair. É lá que o microfone e a saída são de verdade.
4. Sair da sala (pelo botão, pela notificação ou trocando de página) desliga o serviço. Uma página
   nova que não confirma a chamada em 30 segundos também o desliga — é o caso de uma navegação
   para fora da sala que não passou por `sairDaSala`.

O que mais segura a chamada:

- **A atividade não é recriada** ao girar a tela, trocar o tema ou o tamanho da letra
  (`configChanges` no manifesto). Recriar destruiria a WebView, e a chamada com ela.
- **A WebView não é pausada** ao sair da tela (nada de `onPause`/`pauseTimers`): pausá-la
  congelaria os temporizadores da página, e com eles a conexão da sala.
- **O processo da página fica importante** com o aplicativo fora da tela
  (`setRendererPriorityPolicy`), e se ele morrer mesmo assim a atividade renasce em vez de o
  aplicativo inteiro cair (`onRenderProcessGone`).
- **Voltar, numa chamada, guarda o Nexo** como o botão de início. Um gesto de voltar no lugar
  errado não pode derrubar a conversa de todo mundo; sair é o botão Sair.

## As notificações de amigos

```
social.js (socket /social) ──► app-android.js ── "aviso" ──► MainActivity ──► Avisos ──► gaveta
                                                                                  ▲
/api/social/avisos ◄── AvisosJob (a cada 15 min, com o aplicativo congelado) ─────┘
```

Dois caminhos, porque o Android congela o aplicativo que sai da tela (fora de uma chamada) em
poucos segundos — e o socket de amigos cai junto:

1. **Na hora, pela página.** A página já recebe tudo pelo socket de amigos. Com o Nexo fora da
   tela (`visibilityState` escondido), ela pede ao aplicativo uma notificação em vez do aviso no
   canto. Vale com o Nexo recém-saído da tela e durante uma chamada inteira (o `ChamadaService`
   impede o congelamento). Quando a página volta do congelamento, as não lidas do resumo do
   socket também viram notificação.
2. **A cada 15 minutos, pelo aplicativo.** Um trabalho do `JobScheduler` (sem dependência nova)
   pergunta ao servidor, com o cookie da conta guardado pela WebView e só para a origem escolhida,
   o que chegou: as conversas com mensagem não lida (as últimas cinco, texto cortado em 200
   caracteres) e os pedidos de amizade esperando. 15 minutos é o mínimo do Android, e no modo
   de economia ele ainda junta as rodadas. O trabalho fica ligado enquanto há um servidor
   escolhido (ele também confere a versão do APK, ver "A atualização"); a parte dos amigos liga
   quando a conta conecta na página e para quando a sessão termina (a resposta 401), levando as
   notificações da conta junto.

Os dois passam por `Avisos.java`, que guarda o que já avisou (o horário da última mensagem de
cada conversa, os códigos dos pedidos) para nunca avisar a mesma coisa duas vezes. Ler a
conversa — aqui, no computador ou noutra aba — tira a notificação dela; um pedido respondido
também sai. "Não incomodar" segura as mensagens, como no aviso do canto; convites e amizade
passam, porque pedem uma decisão. Com o Nexo à vista, nada vai para a gaveta.

Tocar na notificação traz o Nexo para a frente. Com a página viva, ela recebe o toque
(`aviso-tocado`) e abre a conversa sem recarregar — no início ou no painel de mensagens da sala,
sem derrubar a chamada. "Entrar na sala" de um convite sai da chamada pelo `sairDaSala`, como o
aviso do canto. Com a página morta, a atividade abre `/?conversa=CÓDIGO` ou `/?secao=pedidos`
(nunca "aceitar" por endereço: aceitar é com a página perguntando).

Os canais são três — **Mensagens diretas**, **Convites para salas** (os dois com som) e
**Amigos** —, e a pessoa liga e desliga cada um nas configurações do Android. A licença de
notificar (Android 13+) é pedida uma vez, na primeira chamada ou quando a conta conecta.

## Segurança

As mesmas regras do aplicativo de mesa (`app/main.js`), porque o problema é o mesmo: a sala é
conteúdo remoto.

- **A ponte só existe na origem escolhida.** `nexoAndroid` é posta por
  `WebViewCompat.addWebMessageListener` com a origem digitada na tela de endereço — nunca pedida
  por uma página. Trocar de servidor desfaz a ponte antiga antes. A tela de endereço tem a ponte
  dela (`nexoEndereco`), presa à origem dos assets, e é a única que troca o servidor.
- **Microfone e câmera só para a origem da sala**, e só o que o Android deu: microfone sem
  câmera é uma resposta válida.
- **Todo outro destino abre no navegador do celular**, como os links do chat abrem no navegador
  no aplicativo de mesa. `window.open` e `target=_blank` também.
- **Sem backup** (`allowBackup="false"` e `sem_backup.xml`): a sessão da conta mora nos cookies
  da WebView, e um backup a levaria para outro aparelho.
- **http é permitido**, porque muito Nexo é um computador da casa em `http://192.168…`. A sala
  abre e o chat e a música funcionam; **microfone e câmera, não** — o Android só os libera em
  https. A tela de endereço diz isso, e completa o que se digita com `https://`.

## Construir

Precisa do Android SDK (plataforma 36 e build-tools; o Android Studio instala) e de um **JDK 17
ou 21** — testado com o 21. O Gradle vem pelo wrapper (`android/gradlew`), na versão 9.1, com o
Android Gradle Plugin 9.0.

```powershell
cd android
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

O APK de depuração é assinado com a chave de depuração da máquina: serve para testar, e não
para distribuir — um APK de distribuição não instala por cima dele, nem ele por cima de um de
distribuição.

### A chave

O Android só instala uma versão nova **por cima** da antiga se as duas tiverem a mesma
assinatura. Perder a chave é obrigar todo mundo a desinstalar e instalar de novo (e perder o
endereço salvo e a sessão). Por isso ela fica fora do Git (`.gitignore`: `*.jks`,
`android/keystore.properties`) e precisa de cópia guardada em outro lugar.

Criar, uma vez:

```powershell
keytool -genkeypair -keystore nexo.jks -alias nexo -keyalg RSA -keysize 2048 -validity 10000
```

E apontar para ela num `android/keystore.properties` (caminho relativo à pasta `android/`):

```properties
storeFile=../../chaves/nexo.jks
storePassword=…
keyAlias=nexo
keyPassword=…
```

Ou, numa máquina de build, pelas variáveis `NEXO_ANDROID_KEYSTORE`,
`NEXO_ANDROID_KEYSTORE_SENHA`, `NEXO_ANDROID_CHAVE` e `NEXO_ANDROID_CHAVE_SENHA`.

### Empacotar e distribuir

```powershell
npm run android:empacotar
```

Apaga as saídas antigas, roda `assembleRelease`, confere que o APK saiu **assinado** (sem a
chave ele recusa, em vez de distribuir algo que ninguém consegue instalar), copia para
`app/dist/Nexo.apk` e anota a versão em `app/dist/versao.json`, na linha `android`. Dali o
servidor o entrega em `/downloads/Nexo.apk` (`desktop-download.js`, com o tipo que faz o Android
oferecer instalar), a página inicial o mostra — como botão principal para quem a abre num
Android — e o aplicativo aberto compara a versão para avisar que há uma mais nova.

Para lançar uma versão: suba `versionCode` (sempre) e `versionName` em
`android/app/build.gradle`, rode o `android:empacotar` e ponha o `Nexo.apk` e o `versao.json` no
`app/dist` do servidor. Daí em diante, quem tem o Nexo fica sabendo e atualiza sem sair dele
(a seção abaixo).

### A atualização

| assunto | onde mora |
|---|---|
| Baixar, conferir, instalar | `Atualizador.java` |
| A resposta do instalador e o "a versão nova entrou" | `AtualizacaoRecebedor.java` |
| "Nexo X disponível" na gaveta | `AvisosJob.java` (`conferirVersao`) + `Avisos.java` |
| O botão "Atualizar", o progresso e o "Instalar" | `public/atualizacao-app.js` (o mesmo do aplicativo de mesa), pela ponte de `public/app-android.js` |

Três caminhos levam à versão nova, e todos param no mesmo lugar:

1. **O botão "Atualizar"** no topo da sala e do início, com o cartão "Nexo 1.2.0 disponível".
   Na apresentação (o que o aplicativo abre sem conta), o mesmo aviso vem no canto.
2. **A notificação "Nexo 1.2.0 disponível"**, uma vez por versão, da rodada de 15 minutos do
   `AvisosJob` — com ou sem conta. Ela não aparece com o Nexo à vista: ali o botão já diz.
3. **"Procurar"** não existe aqui: a página confere sozinha ao abrir.

Depois de "Atualizar agora":

1. **Baixar** pelo `DownloadManager` do Android — e não por uma linha nossa: ele continua com o
   Nexo congelado fora da tela, mostra o progresso na gaveta e retoma depois de uma queda. O
   arquivo vai para a pasta do próprio Nexo (sem permissão de armazenamento), e só sai da origem
   escolhida, e só um `.apk`. A página acompanha com a barra no canto, como no aplicativo de mesa.
2. **Conferir** o arquivo antes de oferecer: é o Nexo (o mesmo pacote), é mais novo (o
   `versionCode`, e não só o nome da versão) e foi assinado com **a mesma chave**. Chave
   diferente não instala por cima — e o aviso diz isso com essas palavras, em vez do "o pacote
   parece inválido" do Android.
3. **Instalar** pelo `PackageInstaller`, sempre com o toque da pessoa em "Instalar agora" (no
   aviso do canto, no botão do topo, ou na notificação "Nexo 1.2.0 pronto para instalar", se o
   download terminou com o Nexo fora da tela). Instalar fecha o Nexo, e numa chamada a conversa
   cai: por isso nunca acontece sozinho. Na primeira vez, o Android abre a tela "Permitir desta
   fonte"; ao voltar com ela ligada, a instalação continua sozinha. Depois vem a confirmação do
   próprio Android — do 12 em diante, às vezes nem ela.
4. O Android fecha o Nexo para trocá-lo e não o abre de novo; a notificação **"Nexo atualizado
   para a 1.2.0"** é o caminho de volta, a um toque. O `.apk` baixado é apagado.

O atualizador nasceu na **1.1.0**. Quem ainda está na 1.0.0 vê o aviso antigo, que abre o APK
no navegador do celular (`app-android.js` só oferece o atualizador para quem tem o lado nativo
dele): essa última atualização é à mão, e as seguintes já não.

O que ele não resolve:

- **Uma chave nova.** Se a chave de assinatura se perder (ver "A chave"), nenhuma atualização
  instala por cima, nem por aqui: é desinstalar e instalar de novo.
- **Versão que volta.** Um APK com `versionCode` menor ou igual ao instalado é recusado, mesmo
  com o `versionName` maior: suba os dois.

## O que ele não resolve

- **Compartilhar a tela.** A WebView do Android não tem `getDisplayMedia`; a sala já desliga o
  botão e diz por quê ("comum em celulares"). Ver telas, sim.
- **Câmera em segundo plano.** O serviço segura o microfone e o som; a câmera para quando o Nexo
  sai da tela, como em todo aplicativo de chamada.
- **Fabricantes que matam serviços.** Alguns (Xiaomi, Huawei, Samsung com economia agressiva)
  encerram até serviço em primeiro plano. Se a chamada cai com a tela apagada num desses, a saída
  é tirar o Nexo da otimização de bateria nas configurações do celular.
- **Começar a chamada com o Nexo fora da tela.** O Android 12+ não deixa ligar o serviço de
  segundo plano; ele liga quando a pessoa entra na sala com o Nexo aberto, que é o caso normal.
- **Notificação instantânea com o aplicativo fechado.** Fora de uma chamada, com o Nexo congelado,
  a mensagem chega na próxima rodada do `AvisosJob` — até 15 minutos, mais no modo de economia.
  Instantâneo exigiria um serviço de push (o do Google pede um projeto do Firebase por servidor,
  e cada Nexo é um servidor diferente) ou uma conexão aberta o tempo todo, com uma notificação
  fixa e a bateria indo junto. Responder direto da notificação também fica de fora: a mensagem
  direta só sai pelo socket, que a página congelada não tem.
- **Mensagem de antes de reiniciar o servidor.** As conversas moram só na memória: um servidor
  reiniciado não tem o que avisar.
- **iPhone.** Não há aplicativo para iOS; lá a sala é a do navegador.

## Testes

- `npm run test:android` — o lado da sala, com a ponte simulada como o aplicativo a põe na
  página e o user agent da WebView: a chamada ligando o serviço, o microfone e o ensurdecer indo
  e voltando pela notificação, "Sair da sala" pela notificação, o aviso do APK novo, a vitrine
  sem a seção de downloads dentro do aplicativo, e as notificações de amigos do lado da página:
  mensagem, convite e pedido viram aviso só com o Nexo fora da tela, tocar abre a conversa (ou
  aceita o pedido) sem recarregar, o que foi lido sai da gaveta, e `/?conversa=` abre direto. E
  o atualizador do APK 1.1.0, no início: o pedido de atualizar com a versão e o endereço, o
  progresso, "Instalar agora", a permissão, a falha com o motivo do aplicativo, e a notificação
  "disponível" tocada com a página aberta.
- `npm run test:inicio` — o mesmo botão "Atualizar" no início para o aplicativo de mesa, e o
  aviso no canto da apresentação (o aplicativo sem conta), com "Depois" valendo.
- `npm test` (`tests/amigos.test.js`) — o `/api/social/avisos`: as não lidas só de amigos, o
  texto cortado, o convite, os pedidos, e nada depois de lido.
- O lado nativo se prova num aparelho (o lint do Gradle roda junto do build). A lista do que
  conferir: entrar numa sala em `https://`, ligar o microfone, apagar a tela por um minuto
  falando e ouvindo; abrir outro aplicativo; desligar o microfone e sair pela notificação; girar
  a tela no meio da chamada; "Trocar de servidor" segurando o ícone. As notificações: com o Nexo
  em segundo plano, receber mensagem, convite e pedido de outra conta; tocar em cada uma; ler a
  conversa no computador e ver a notificação sumir na rodada seguinte; fechar o Nexo de vez e
  esperar a rodada do `AvisosJob` (`adb shell cmd jobscheduler run -f com.telacompartilhada.nexo
  7301` a força na hora). A atualização: com a 1.1.0 instalada, empacotar uma 1.1.1
  (`versionCode` 3) com a mesma chave e pôr no servidor; ver o botão no início, a notificação
  "disponível" (com o job forçado e o Nexo fora da tela), o download na gaveta, a tela "Permitir
  desta fonte" na primeira vez, a confirmação, e a notificação "Nexo atualizado". E a recusa:
  um APK de depuração no servidor (outra chave) tem de parar em "assinada com outra chave".
