# O som da tela compartilhada

Quem compartilha a tela com o som do sistema (pelo aplicativo de mesa, ou pelo navegador com o agente
instalado) depende de uma cadeia: o **agente** (`AgenteAudio.exe`, um programa à parte), a **sinalização**
(o socket da sala), o **servidor**, a **conexão direta** do agente com a página (`agente-local-worker.js`) e o
**reprodutor** (`pcm-worklet.js`), que vira o PCM numa faixa de áudio publicada junto com a tela.

## O que acontecia

Dois sintomas, relatados por quem transmite e por quem assiste:

1. **A tela subia sem som e sem o controle de volume.** A faixa de som nem existia: o plano de áudio
   (`planoDeAudio`) é decidido no clique, e no aplicativo de mesa o agente só toca a sala depois de a página
   pedir que o processo principal o levante. Compartilhar logo depois de abrir a sala achava `agenteConectado`
   ainda falso e subia sem som, calado.
2. **A tela subia com o controle de volume e sem som nenhum.** A faixa existia (por isso o controle), mas o
   agente tinha parado de capturar:
   - o agente **para de capturar quando a conexão dele com o servidor cai**, e fica esperando ordens;
   - o servidor mandava o agente parar quando o socket da **página** caía (`disconnect`), inclusive quando a
     página já tinha reconectado: o `disconnect` do socket antigo chega depois do tempo de espera do ping;
   - o agente podia recusar o `iniciar` (`falha ao iniciar a captura`), e a recusa era só uma frase na barra de
     status que o próximo aviso apagava.

Em todos os casos a transmissão seguia no ar e só parar e compartilhar de novo (o que refaz o `iniciar`)
consertava. É o que as pessoas descreviam.

## O que foi feito

* **Insistência** (`vigiarOSomDoAgente`, `public/sala.js`). O reprodutor conta quantos quadros recebeu
  (`recebidos`, em `pcm-worklet.js`) e manda a contagem a cada dois segundos. Se nada chega, a página pede a
  captura de novo ao agente, esperando 5, 10 e depois 30 s entre os pedidos. É seguro repetir: o agente refaz a
  captura que já tinha. Uma recusa do agente adianta o pedido seguinte e, se o som nunca chegou, aparece um
  aviso que fica na tela até o som chegar.
* **A volta de uma queda.** O agente que reconecta (`agente-status`) e o socket da página que reconecta
  (depois de `registrar-agente`) pedem a captura de novo na hora.
* **O encontro tardio** (`acrescentarSomDoSistemaAoVivo`). Se a tela subiu antes de o agente conectar, o som
  entra na transmissão que já está no ar quando ele conectar: a faixa é criada e publicada no meio da
  transmissão, e o controle de volume aparece para quem assiste.
* **A espera curta** (`esperarOAgenteQueEstaChegando`). No aplicativo de mesa, a captura espera até 1,5 s pelo
  agente antes de decidir o plano. É curto de propósito: o navegador só deixa pedir a tela logo depois do clique.
* **O agente que morreu.** Se o agente cai com a tela no ar, o aplicativo pede ao processo principal que o
  levante de novo (ele só sobe outro se o antigo morreu de verdade).
* **O contexto de áudio suspenso.** Um `AudioContext` suspenso não processa nada: a faixa existe e não sai som.
  Ele é religado sozinho (`onstatechange`) e o motivo vai para o diagnóstico.
* **No servidor** (`server.js`, `disconnect`): o agente só é mandado parar se aquele socket ainda é o dono do
  token. O socket novo, já registrado, manda no agente.

## Como se prova

`npm run test:audio-tela`. Um agente falso (WebSocket em Node, que só captura depois de `iniciar` e para ao
cair) manda um seno de 1 kHz, e quem assiste mede o som que chega na faixa. Os cenários são os dois sintomas:
agente que cai, socket que cai, agente que recusa, tela que sobe antes do agente, e agente que chega durante a
espera. Sem as funções novas, quatro deles falham exatamente como o relato (`tem: true, rms: 0` e
`tem: false`).

## O que isto não resolve

* O agente de verdade só se prova numa máquina com Windows e um programa tocando: o teste usa um agente falso.
  O que ele garante é a página e o servidor reagirem a cada queda; a captura em si (WASAPI) é do agente.
* O som que **nunca** chega porque nada está tocando também não chega pelo agente (o Windows não entrega
  pacotes de um dispositivo ocioso em alguns casos). A página repete o pedido a cada 30 s nesse caso, o que é
  inofensivo, e não mostra aviso nenhum se o som já chegou alguma vez.
* No navegador sem o agente, a captura do som do sistema continua sendo a do próprio navegador: marcar a caixa
  "Compartilhar áudio do sistema" na janela dele é o que decide, e o Nexo não tem como saber se foi marcada.
