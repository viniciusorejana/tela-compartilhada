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
