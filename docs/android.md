# O Nexo para Android

Escrito em 02/10/2026. O aplicativo Android (`android/`) é a mesma sala do navegador numa
WebView, do jeito que o aplicativo de mesa é a mesma sala numa janela do Electron: a interface
não é copiada, a janela carrega o servidor que a pessoa escolheu. Uma interface só, um lugar
para manter.

O que ele acrescenta ao navegador do celular é uma coisa só, e é a que importa numa chamada:
**a voz continua com a tela apagada e com outro aplicativo na frente.**

| assunto | onde mora |
|---|---|
| A janela, a ponte, as permissões, os links | `android/app/src/main/java/com/telacompartilhada/nexo/MainActivity.java` |
| A chamada em segundo plano e a notificação | `ChamadaService.java`, na mesma pasta |
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
`app/dist` do servidor. O aviso de atualização abre o APK novo no navegador do celular, que baixa
e oferece instalar por cima.

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
- **iPhone.** Não há aplicativo para iOS; lá a sala é a do navegador.

## Testes

- `npm run test:android` — o lado da sala, com a ponte simulada como o aplicativo a põe na
  página e o user agent da WebView: a chamada ligando o serviço, o microfone e o ensurdecer indo
  e voltando pela notificação, "Sair da sala" pela notificação, o aviso do APK novo, e a vitrine
  sem a seção de downloads dentro do aplicativo.
- O lado nativo se prova num aparelho (o lint do Gradle roda junto do build). A lista do que
  conferir: entrar numa sala em `https://`, ligar o microfone, apagar a tela por um minuto
  falando e ouvindo; abrir outro aplicativo; desligar o microfone e sair pela notificação; girar
  a tela no meio da chamada; "Trocar de servidor" segurando o ícone.
