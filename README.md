# Tela Compartilhada — Compartilhamento de tela ao vivo (com áudio)

Servidor Node.js simples que permite compartilhar sua tela em tempo real (com áudio)
para qualquer pessoa acessando o mesmo servidor, usando WebRTC + Socket.io.

## Como instalar e rodar

1. Instale o Node.js (v18 ou superior) se ainda não tiver: https://nodejs.org
2. Abra o terminal dentro desta pasta e rode:

```bash
npm install
npm start
```

No Windows, `npm start` também compila automaticamente o helper nativo. É
necessário ter o Visual Studio Build Tools com C++ e Windows SDK instalados.
O recurso de captura por aplicativo exige Windows 10 build 20348 ou superior
(ou Windows 11). No Windows 10 comum, como o build 19045, a API de loopback
por processo não está disponível; nesse caso use Windows 11, VB-CABLE/OBS ou
um driver de áudio virtual.

3. O terminal vai mostrar algo como:

```
Servidor rodando em http://localhost:3000
  -> Compartilhar tela: http://localhost:3000/compartilhar
  -> Assistir ao vivo:  http://localhost:3000/ao-vivo
```

Para publicar na internet, use a porta externa encaminhada para a maquina que
roda o Node e informe a URL publica ao iniciar. No PowerShell:

```powershell
$env:PUBLIC_URL="https://SEU-DOMINIO/" # ou http://SEU-IP-PUBLICO:3000
$env:PORT="3000"
npm start
```

No roteador, encaminhe a porta TCP 3000 (e UDP 3000, se disponível) para o IP
local dessa maquina e permita o Node.js no Firewall do Windows. Acesse a pagina
de compartilhamento pela URL publica, nao por `localhost`.

## Como usar

- **Quem vai transmitir**: acesse `/compartilhar`, clique em
  "Iniciar compartilhamento", escolha a tela/janela/aba e **marque a opção
  "Compartilhar áudio"** na janela de seleção do navegador (essa opção varia
  de navegador para navegador).
- **Quem vai assistir**: acesse `/ao-vivo` (pode ser em outro
  computador na mesma rede, usando o IP da máquina que roda o servidor, ex:
  `http://192.168.0.10:3000/ao-vivo`).
- Vários espectadores podem assistir ao mesmo tempo.
- Qualquer espectador pode clicar em **Compartilhar minha tela** e transmitir
  pelo próprio navegador. Não precisa instalar Node.js nem iniciar servidor.
  Para compartilhar de outro computador, use o link público com HTTPS e
  permita tela/áudio no diálogo do navegador.
- Durante a transmissão, use **Atualizar captura** para trocar a tela, janela ou
  política de áudio. A troca é aplicada aos espectadores sem reiniciar o
  servidor. A opção **Permitir atualização** pode ser desmarcada para bloquear
  esse controle durante a transmissão.

## Observações importantes

- **Compartilhamento de áudio**: no Chrome/Edge (Windows), escolha uma **janela**
  para tentar capturar o áudio daquela aplicação, ou uma aba/tela e habilite a
  opção de áudio no seletor. O navegador e o sistema operacional decidem quais
  fontes aparecem; a API `getDisplayMedia` não permite selecionar ou capturar
  silenciosamente um aplicativo específico por código. No
  macOS, o Chrome só compartilha áudio de **abas** (não da tela inteira), por
  limitação do próprio sistema operacional. No Firefox o suporte é mais limitado.
- **Áudio por aplicativo**: na página de compartilhamento, clique em **Atualizar
  aplicativos**, escolha uma política e selecione os processos desejados. Em
  **Somente aplicativos selecionados**, é possível selecionar vários processos
  com Ctrl; eles serão mixados. Em **Todo o sistema, exceto um aplicativo**, o
  áudio do processo escolhido e seus subprocessos será bloqueado.
- **HTTPS**: navegadores exigem contexto seguro para `getDisplayMedia`. Para
  compartilhar a tela usando IP publico, use HTTPS com um dominio/certificado;
  `localhost` e permitido sem HTTPS, mas um IP publico em HTTP pode bloquear a
  captura. Se a pagina mostrar `Captura bloqueada`, esse e o motivo. Uma forma
  simples e usar um proxy HTTPS como Caddy ou Nginx na frente do Node.
- **Rede local x internet**: para uso entre redes diferentes, configure um
  servidor **TURN** (Coturn ou um provedor). O servidor ja aceita:

```powershell
$env:TURN_URLS="turn:turn.seudominio.com:3478,turns:turn.seudominio.com:5349"
$env:TURN_USERNAME="usuario"
$env:TURN_CREDENTIAL="senha-ou-credencial"
npm start
```

  O cliente recebe essa configuracao automaticamente em `/api/rtc-config`.
- O vídeo/áudio **não passa pelo servidor** — ele só ajuda os dois lados a se
  encontrarem (sinalização). O streaming em si é direto entre os navegadores
  (peer-to-peer), então a qualidade depende da conexão entre as duas pontas.
- Atualmente só suporta **uma transmissão por vez** (um transmissor). Se quiser
  suportar múltiplos transmissores simultâneos, dá pra evoluir facilmente.

## Se o delay ficar crescendo (tipo câmera lenta)

Isso é sinal de que o **decodificador do lado que assiste não está dando conta**
(não é problema de rede). Como o navegador prefere não travar a imagem, ele vai
empilhando quadros num buffer que só cresce, e a transmissão "atrasa" cada vez
mais. É bem comum em navegadores de Smart TV, que costumam ter pouco poder de
processamento e, na maioria das vezes, só decodificam **H.264 por hardware**
(VP8/VP9, que muitos navegadores escolhem por padrão, acabam sendo decodificados
por software — bem mais pesado).

Já ajustei o código para:

- **Forçar H.264 como codec preferido** (função `preferCodec` no
  `compartilhar.html`) — se a TV tiver decodificação por hardware pra H.264
  (a grande maioria tem), isso sozinho já deve resolver.
- **Reduzir a captura para 1280x720 @ 30fps** e o teto de bitrate para 3 Mbps —
  bem mais tranquilo para um chip fraco decodificar em tempo real.

Se mesmo assim o delay continuar crescendo, o próximo passo é baixar ainda mais:

```js
// em compartilhar.html
width: { ideal: 960, max: 960 },
height: { ideal: 540, max: 540 },
frameRate: { ideal: 24, max: 24 }
// ...
params.encodings[0].maxBitrate = 1_500_000; // 1.5 Mbps
```

Regra prática: se o delay **estabiliza** num valor (mesmo que perceptível, tipo
meio segundo) e não continua subindo, é rede/latência normal — não tem muito o
que fazer além de cabo/Wi-Fi melhor. Se o delay **continua crescendo sem parar**,
é decodificador não dando conta — a solução é sempre reduzir resolução/fps/bitrate,
nunca aumentar.

## Melhorando a performance (menos lag e áudio mais limpo)

Já apliquei no código estes ajustes:

- **Áudio sem processamento de microfone**: `echoCancellation`, `noiseSuppression`
  e `autoGainControl` desligados — eram eles que "comprimiam"/distorciam o áudio
  da tela. Também subi para 48kHz/estéreo e o teto de bitrate do Opus para 256kbps.
- **Prioridade de fluidez em vez de nitidez**: `track.contentHint = 'motion'` e
  `degradationPreference = 'maintain-framerate'` — por padrão o WebRTC, ao notar
  qualquer variação de rede, prefere baixar a resolução a perder quadros; isso
  inverte essa prioridade, ideal para telas com bastante movimento.
- **Bitrate de vídeo mais alto** (teto de 8 Mbps): o WebRTC por padrão assume uma
  rede mais fraca do que uma rede local costuma ter, então sem esse ajuste ele
  se segura sozinho mesmo com banda de sobra.

Outras coisas que ajudam bastante e dependem do seu ambiente, não do código:

- **Cabo em vez de Wi-Fi** — se der pra ligar por cabo de rede o computador que
  transmite (e, se possível, o dispositivo que recebe na TV), o ganho de
  estabilidade costuma ser maior que qualquer ajuste de software.
- **Wi-Fi 5GHz em vez de 2.4GHz**, se cabo não for opção — menos interferência.
- **Feche outros apps consumindo CPU/GPU** durante a transmissão: encoding de
  vídeo em tempo real consome processamento, e se a CPU/GPU está no limite o
  próprio encoder derruba quadros antes mesmo de chegar na rede.
- **Ajuste o teto de bitrate** (`maxBitrate` no `compartilhar.html`) para baixo
  (ex: `4_000_000`) se sua rede não aguentar 8 Mbps estáveis — bitrate acima do
  que a rede aguenta gera mais engasgo, não menos.
- **Se o dispositivo que assiste na TV for fraco** (ex: um Smart TV com navegador
  limitado, ou um Chromecast antigo), o gargalo pode estar na decodificação, não
  na rede — nesse caso, reduzir a resolução de captura (`width`/`height` no
  `compartilhar.html`) ajuda mais que qualquer bitrate.

## Estrutura do projeto

```
tela-compartilhada/
├── package.json
├── server.js              # servidor Express + Socket.io (sinalização)
└── public/
    ├── compartilhar.html  # página de quem transmite a tela
    └── ao-vivo.html       # página de quem assiste
```
