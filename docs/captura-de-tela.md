# Por que compartilhar UMA janela custa FPS no jogo

Relato que originou este documento: ao compartilhar uma janela específica, o **jogo** perde
quadros — não a transmissão — e aparece uma tarja amarela em volta da janela capturada.
Compartilhar a tela inteira não faz nem uma coisa nem outra.

As duas coisas têm a mesma origem, e ela não está no Nexo.

## Os dois caminhos de captura do Windows

| | Uma janela | Tela inteira |
| --- | --- | --- |
| Como o Windows entrega | Windows Graphics Capture: a janela é composta **outra vez**, num destino só para a captura | Lê o quadro que a placa de vídeo **já desenhou** para o monitor |
| Efeito no jogo | Um jogo em tela cheia perde o caminho direto até o monitor e passa a ser composto | Nenhum: o jogo continua desenhando como desenhava |
| Tarja amarela | Sim — é o indicador de captura do Windows | Não |

Para um jogo em tela cheia as duas entregam **exatamente a mesma imagem**. A captura de
janela, nesse caso, só cobra: não mostra nada que a tela inteira não mostre.

## A tarja amarela não dá para desligar

A tarja é desenhada pelo Windows, não pelo Nexo nem pelo navegador. Existe uma propriedade
para removê-la — [`GraphicsCaptureSession.IsBorderRequired`][border] — mas ela é **exclusiva
do Windows 11**: foi anunciada antes dele e depois travada por versão. No Windows 10,
atribuir `false` "funciona" e é silenciosamente ignorado. Mesmo no Windows 11 o aplicativo
precisa declarar a capacidade `graphicsCaptureWithoutBorder` e pedir consentimento.

Ou seja: nenhuma API da web, nenhuma opção do Chrome e nenhuma configuração do Electron
tiram a tarja no Windows 10. Só trocar de caminho de captura tira.

## O que o Nexo faz

- **O aplicativo abre em "Tela inteira".** Antes ele abria em "Janela ou aplicativo", que é
  o pior dos dois caminhos para quem joga. Foi essa escolha padrão que empurrou o problema.
- **Quem escolher a janela mesmo assim vê o porquê**, com um botão de troca ao lado. A
  opção continua existindo: para mostrar um documento sem expor o resto da tela ela é a
  certa, e ali o custo não importa.

## O que continua sem solução

Não existe forma mais barata de capturar **uma janela isolada** no Windows 10:

- O caminho antigo (GDI/`PrintWindow`) não desenha tarja, mas lê da CPU e costuma entregar
  preto em jogos Direct3D. É pior.
- Capturar a tela inteira e recortar a região da janela troca o custo de lugar (um redesenho
  por quadro), quebra quando outra janela passa por cima e quebra de novo quando a janela é
  movida. Para o caso que motivou tudo isto — jogo em tela cheia — o recorte não faria
  diferença nenhuma na imagem.

Na prática, quem quer mostrar só o jogo e nada mais: jogo em tela cheia num monitor,
compartilhe **aquele monitor**.

## Com WebCodecs, o recorte ficou barato (27/09/2026)

Medido no Electron 44 do aplicativo, Windows 10 19045, com uma janela comum desenhando a 60
quadros:

| Captura | Quadros entregues | A janela capturada desenhava |
| --- | --- | --- |
| Janela (WGC) | 60 | 60 antes, 60 durante |
| Tela inteira (DXGI) | 57,8 | 60 antes, 60 durante |

Ou seja: o WGC **não** corta a transmissão pela metade. O que cai pela metade com um jogo é o
próprio jogo: capturado como janela, ele perde o caminho direto até o monitor (*independent
flip*) e passa a ser composto; com vsync, um jogo composto que não fecha todo intervalo de
16,6 ms cai direto para 30. A transmissão só reflete o que o jogo desenha. Para confirmar numa
sessão real: o contador de FPS do próprio jogo cai junto; o "Fonte capturando" do Diagnóstico
acompanha.

O recorte da tela inteira foi descartado acima porque, no RTP, ele custava redesenhar cada
quadro. **No caminho novo, esse custo sumiu**: `new VideoFrame(quadro, { visibleRect })` recorta
sem copiar nada, e o codificador recebe só a região. Sobra o que não é custo de máquina:

- **o retângulo da janela**, que só o aplicativo pode saber (o navegador não enxerga janelas
  alheias). O agente nativo já recebe a janela escolhida (`--janela <hwnd>`) e devolve o
  processo; devolver também a região (`DwmGetWindowAttribute` com `DWMWA_EXTENDED_FRAME_BOUNDS`,
  em pixels físicos, como a captura DXGI) e acompanhar quando a janela se move é pouco código —
  mas exige recompilar o agente;
- **a privacidade**: o que passar por cima da janela (uma notificação, outro programa) aparece
  no recorte, porque é a tela que está sendo lida;
- **o monitor certo**: a janela num monitor, a captura no mesmo.

Para o jogo em tela cheia nada disso muda a imagem — já é o monitor inteiro. O recorte serve ao
jogo em janela, que é justamente o caso em que a captura de janela derruba o jogo.

## A tela inteira que cai para 30 e não volta (28/09/2026)

Relato: transmitindo a tela inteira a 60 pelo navegador, num momento a transmissão caiu para 30
quadros e não voltou mais; parar e compartilhar de novo trouxe os 60 de volta.

A causa está na captura do Chrome, abaixo do Nexo. No Windows 10 ele captura a tela pelo **DXGI**,
com a **GDI** de reserva (`FallbackDesktopCapturerWrapper`, no WebRTC; o WGC só entra para telas a
partir do Windows 11 24H2). Quando o DXGI devolve um erro **permanente** — monitor inválido depois
de uma reconfiguração de telas, quadro que não pôde ser preparado no tamanho novo —, a troca
para a GDI vale **até o fim daquela captura**. E o Chrome limita a captura a 50% de um núcleo
(`kDefaultMaximumCpuConsumptionPercentage`): o período vira o dobro do tempo da última captura.
Uma captura nova cria outro capturador, de novo pelo DXGI.

Medido nesta máquina, com o Chrome e a tela inteira (GDI forçada por
`--disable-features=DirectXCapturer`):

| Captura | Quadros por segundo | Quadros a menos de 24 ms do anterior |
| --- | --- | --- |
| DXGI, em movimento | 57,8 | 581 de 581 |
| DXGI, com pouca mudança | 58,1 | 583 de 584 |
| GDI, em movimento | 27,6 | **0** de 277 |
| GDI, com pouca mudança | 25,8 | **0** de 261 |

A média sozinha não separa a GDI de um vídeo a 30; o intervalo separa. O DXGI entrega na cadência
do monitor, e intervalos de ~17 ms aparecem assim que duas mudanças caem seguidas; a GDI nunca
entrega dois quadros a menos de ~30 ms. É essa a assinatura que o caminho novo procura
(`capturaPresa`, em `tela-decisoes.js`): mais de 20 quadros por segundo, até 40, e nenhum
intervalo curto em dez segundos, com 60 pedidos.

O remédio precisa de um clique — o navegador não abre o seletor de telas sem um gesto da pessoa —,
então a sala avisa uma vez por captura, com o botão **Capturar de novo**, que troca a faixa sem
tirar a tela do ar. A medição mostra "60 pedidos → 28 capturados → 28 codificados" e explica. O que
a assinatura não separa é conteúdo que roda a 30 de verdade (um jogo travado em 30) numa tela sem
mais nada mudando; por isso o aviso diz isso e não força nada.

A outra metade do relato também tinha um culpado dentro do Nexo, e ele foi corrigido junto: uma
falha do WebCodecs no meio da transmissão deixava a tela no WebRTC **até parar e compartilhar de
novo** — e o WebRTC codificando 1080p60 no processador também não entrega 60. Agora a falha tenta
de novo sozinha, em 10 s, 30 s, 90 s e depois a cada 5 min.

## Como confirmar na sua máquina

1. Compartilhe pela janela e anote o FPS do jogo. Pare, compartilhe o monitor inteiro com a
   mesma qualidade e o mesmo perfil, e compare.
2. A tarja aparece só no primeiro caso.
3. Em **Diagnóstico**, veja a linha `codificador=`. Se ela mostrar um codificador de
   software (`OpenH264`, `libvpx`) em vez do da placa de vídeo, existe uma segunda fonte de
   perda de FPS — a codificação — independente do caminho de captura. H.264 é o codec com
   mais chance de usar a placa.

[border]: https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired

---

# A outra metade do custo: quem codifica

Capturar é só o começo. Depois de capturado, cada quadro precisa ser **comprimido**, e isso
pode acontecer em dois lugares muito diferentes:

- **Na placa de vídeo** (NVENC, Quick Sync, AMF). Custo quase nulo para o resto da máquina.
- **No processador** (OpenH264, libvpx). Custo alto, e ele disputa exatamente o mesmo
  recurso que o jogo.

Se o Diagnóstico mostra `codificador=OpenH264` ou `libvpx`, é o processador que está
comprimindo — e essa é uma segunda fonte de queda de FPS, **independente** do caminho de
captura.

## O que foi medido nesta máquina

Numa RTX 3060 Ti com driver 32.0.16.1088, Windows 10 22H2:

| Pergunta | Resposta |
| --- | --- |
| `chrome://gpu` → Video Encode | **Hardware accelerated** |
| Capacidades listadas | `Encode h264 baseline/main/high`, até 1920x1080@121fps e 3840x2160@30fps |
| `mediaCapabilities.decodingInfo` (WebRTC, H.264 1080p) | `powerEfficient: true` — a placa **decodifica** |
| `mediaCapabilities.encodingInfo` (WebRTC, H.264 1080p) | `powerEfficient: false` |
| Idem para VP8, VP9, AV1, em 720p/1080p/1440p | `false` em todos |

Ou seja: a placa **tem** o codificador, o Chrome **lista** o codificador, o caminho de
decodificação **usa** a placa — e mesmo assim o WebRTC não oferece codificação por hardware
para nenhum codec.

Repare que a consulta acima é a mais simples possível: um codec e uma resolução, sem
simulcast e sem dica de conteúdo. Como ela já responde "não", **a escolha de simulcast, de
codec ou de prioridade feita no Nexo não é a causa** — não há ajuste nesta página que faça o
codificador da placa aparecer.

## Hipóteses testadas — e descartadas

Chrome 153, Windows 10 build 19045, RTX 3060 Ti. Cada linha foi medida, não deduzida.

| Hipótese | Como foi testada | Resultado |
| --- | --- | --- |
| Adaptadores de vídeo virtuais (Parsec, USB Mobile Monitor) atrapalham a escolha de adaptador | Desativados no Gerenciador de Dispositivos | **Sem efeito** |
| Driver de vídeo desatualizado | Atualizado de 32.0.16.1088 para 32.0.16.1692 | **Sem efeito** |
| Bloqueio da lista de GPU do Chrome | `--ignore-gpu-blocklist` | **Sem efeito** |
| Workaround `disable_d3d12_video_encoder` (por versão de Windows) | `#enable-d3d12-video-encoder = Enabled` **mais** `--disable-gpu-driver-bug-workarounds`, com o `chrome://gpu` confirmando o workaround como *não aplicado* | **Sem efeito** |
| Existe um interruptor de codificação por hardware para WebRTC | `#webrtc-hw-encoding` | Só ChromeOS e Android: o próprio Chrome responde "não está disponível na sua plataforma" |

Em todas as combinações, `encodingInfo` continuou respondendo `powerEfficient: false` para
H.264, VP8, VP9 e AV1, em 720p, 1080p e 1440p — enquanto `decodingInfo`, na mesma execução,
respondia `true`. A API funciona; a resposta é que não há codificador por hardware para
oferecer ao WebRTC.

**A conclusão prática:** não existe ajuste alcançável — nem pela página, nem pela linha de
comando do Chromium, nem por driver ou hardware virtual — que faça o WebRTC desta máquina
usar a NVENC. Um aplicativo Electron pode passar chaves ao Chromium (é o que o Discord faz),
mas uma chave só derruba um bloqueio; aqui não há bloqueio nesse nível para derrubar.

O que sobra como diferença não testada em relação a outros programas que codificam por
hardware nesta mesma máquina (OBS, o próprio Discord) é que eles **não usam o codificador do
navegador**: chamam a NVENC direto, por fora do WebRTC.

## O que o Nexo faz a respeito

Nada disso é ajustável pela página, então o que cabe é **dizer**: o Diagnóstico agora
responde, em português, se existe codificação por hardware para algum codec — em vez de
mostrar um nome de biblioteca e deixar a conclusão por conta de quem lê.

Vale lembrar que **assistir sob demanda** também ajuda aqui: enquanto ninguém pede sua tela,
o servidor de mídia desliga as camadas e o codificador fica ocioso. O custo de transmitir
passou a existir só quando alguém está de fato assistindo.

## O que ainda alcança a placa: WebCodecs

O WebRTC não alcança a NVENC nesta máquina, mas o **WebCodecs** alcança. Medido no mesmo
Chrome, mesmo perfil limpo:

| Codec | `VideoEncoder` com `prefer-hardware` |
| --- | --- |
| H.264 high, 1080p | aceito — 249 quadros/s |
| VP9, 1080p | **recusado** |
| AV1, 1080p | **recusado** |

A recusa é a prova. Se `prefer-hardware` estivesse apenas caindo para software em silêncio,
os três seriam aceitos. VP9 e AV1 serem recusados enquanto H.264 passa é exatamente o
perfil de uma NVENC de geração Ampere: ela codifica H.264 e HEVC, e não codifica VP9 nem
AV1. O Chrome está consultando a placa.

Ou seja: a capacidade existe e é alcançável de dentro do navegador — só não pela porta que
o `RTCPeerConnection` usa.

**A decodificação já está resolvida:** `decodingInfo` do WebRTC responde `powerEfficient:
true` para H.264, VP9 e AV1. Quem assiste já usa a placa. O problema é só de quem envia.

O que fazer com essa abertura está em [`plano-webcodecs.md`](plano-webcodecs.md): usar o
WebCodecs exige sair do `RTCPeerConnection`, e portanto um transporte próprio para a tela.

---

# O som da tela pelo agente: dois relógios e um chiado

Relato: depois de vários minutos compartilhando com som, a transmissão passava a chiar, todo
mundo ouvia, e mutar a tela fazia parar.

O agente captura no relógio do Windows e entrega PCM de 44,1 kHz em blocos de ~10 ms; a sala o
toca num `AudioContext`, que anda no relógio da saída do navegador. O reprodutor antigo guardava
10 a 20 ms e não corrigia a diferença entre os dois relógios: a folga acabava em minutos e o som
passava a picotar sem parar. Medido com o agente real e uma deriva de 300 ppm: **243 buracos em
dois minutos**. Cada engasgo da página, por onde o PCM passava, também virava buraco.

## O que mudou

- **`public/agente-local-worker.js`**: a conexão direta com o agente mora num Worker e entrega o
  PCM ao reprodutor por uma `MessagePort`, sem passar pelo fio principal. Se cair, é refeita
  (1, 2, 5, 10, 30 s, ou na hora em que o agente reanuncia a porta).
- **`public/pcm-worklet.js`**: o reprodutor novo. Testado em `tests/pcm-worklet.test.js`.

## Sincronia: por que a fila é medida pelo pior momento

O LiveKit agrupa `screen_share` e `screen_share_audio` no mesmo stream, e quem assiste
sincroniza som e imagem pelos carimbos de tempo. Só que o carimbo do áudio é dado quando ele
**entra** no WebRTC — depois do reprodutor. Todo milissegundo guardado na fila é som atrasado em
relação à imagem, e quem assiste não tem como descontar.

Por isso o reprodutor não mira uma fila média: ele mede o **pior momento** de uma janela de três
segundos e segura esse mínimo em 5 ms. A média fica em ~10 ms no caminho direto — igual ou
abaixo do reprodutor antigo — e só cresce quando a entrega exige (caminho pelo servidor, rede
oscilando). Cada buraco ensina até 20 ms a mais, e a folga volta a encolher sem buracos.

## Qualquer diferença de relógio

- A velocidade de leitura tem uma parte rápida, limitada a ±0,1% (inaudível), e uma integral
  que aprende a diferença real entre os relógios, até ±10%. Com a velocidade certa, o tom
  também fica certo: é o som tocado no ritmo do relógio de quem capturou.
- Uma diferença grosseira (≥ 0,5% — taxa de amostragem errada, não deriva de cristal) é medida
  direto pela chegada dos blocos, entre chegadas, em 30 s sem pausa da fonte, e corrigida de
  uma vez.
- A leitura fracionária usa um sinc de 16 pontos (Kaiser β = 6): o erro fica 72 dB abaixo do
  sinal de 1 a 15 kHz. Interpolação linear abafaria 2,4 dB a 10 kHz, oscilando com a posição.

Simulado por 5 min em cada cenário: sem deriva, ±100 a ±3000 ppm, −2%, +8,8%, entrega com 0 a
40 ms de atraso, rajadas de 80 ms pelo servidor, pausa de 5 s da fonte e saída a 48 kHz —
nenhum buraco depois do primeiro minuto.

## Diagnóstico

O reprodutor manda a própria contagem a cada dois segundos. O relatório de diagnóstico ganhou a
linha "Som da tela pelo agente" (caminho, fila, buracos, saltos e a diferença de relógio
aprendida), e o registro de segundo plano anota `audioAgente.*` quando algo piora.
