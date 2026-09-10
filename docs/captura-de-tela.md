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
