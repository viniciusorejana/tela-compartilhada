# Do ponto a ponto para o servidor de mídia

Branch: `nexo-sfu`. Revisão de mídia: `sfu-1`.

## Por que

A sala era uma malha: cada participante mantinha uma conexão com cada outro e enviava uma cópia
do próprio vídeo para cada um. Dois limites disso apareceram em campo.

**A conexão precisava furar o NAT dos dois lados.** É a causa do relatório colhido no Safari em
rede móvel: `ICE=checking`, `bytes=0`, nenhum par de candidatos selecionado. Basta um dos lados
ser NAT simétrico ou CGNAT — o normal em fibra residencial e em rede móvel no Brasil — para
todos os testes de conectividade falharem. TURN resolveria isso, mas retransmite bytes
cegamente: numa malha, quem transmite continua enviando N−1 cópias, agora todas pelo relay.

**O upload de quem transmite crescia com o grupo.** Com o perfil Alta e quatro espectadores são
cerca de 32 Mbps de upload, acima do que boa parte das conexões domésticas entrega.

Com um servidor de mídia, cada pessoa envia **uma** cópia para um endereço público e ele
distribui. Todo mundo faz conexão de saída, então o problema de NAT contra NAT deixa de existir.

## O que isso custa, dito claramente

O servidor roda na mesma máquina que já hospeda o Nexo. Ele **não reduz o upload de quem
hospeda**: quando é a tela do host no ar, as mesmas 32 Mbps saem, agora pelo processo do
servidor de mídia. O que muda é que o custo passa a ser sempre do host — um participante com
10 Mbps de upload, que antes não conseguia compartilhar tela para quatro pessoas, passa a enviar
8 Mbps e o resto sai da conexão de quem hospeda.

É uma troca deliberada, e é o que torna a sala utilizável para o grupo. O ganho que a malha
nunca daria é o simulcast: quem está numa rede ruim recebe a camada baixa sem derrubar a
qualidade dos outros.

## Arquitetura

```
Navegador ──HTTPS/WSS──> túnel ──> Node/Express
                                     ├── /rtc  (encaminhado) ──> servidor de mídia :7880
                                     ├── /api/sala-config     (token de acesso)
                                     ├── Socket.IO            (chat, agente de áudio)
                                     └── processo do servidor de mídia

Navegador ────────UDP 7882-7891 (mídia)────────> servidor de mídia
                  TCP 7881 (alternativa)
```

**A sinalização não abre porta.** O cliente conecta em `/rtc` na mesma origem que serviu a
página, e o Node encaminha para o processo local. A sinalização herda o HTTPS do túnel — sem
certificado, sem domínio próprio, sem porta extra. A 7880 escuta só em `127.0.0.1`.

O TURN embutido fica desligado: ele existe para servidores sem IP público, e a alternativa por
TCP na 7881 já cobre quem bloqueia UDP.

## O que sobreviveu, e por quê

A interface inteira. Um módulo novo, [`room-transport.js`](../public/room-transport.js), mantém
exatamente a mesma superfície que os quadradinhos, o palco, o modo múltiplo e o destaque sempre
consumiram — um `Map` de participantes com `state`, `remoteStreams` por fonte e `ordem`. A
diferença é que ele é alimentado por eventos do servidor de mídia em vez de por eventos de
conexões ponto a ponto.

Continuam intactos: captura de câmera e tela, virar câmera no celular, seleção de dispositivos,
RNNoise, o agente de áudio nativo e seu WebSocket, o chat pelo Socket.IO, a recuperação de
autoplay, o Electron e o download do agente.

O Socket.IO ficou — o agente de áudio depende dele, e o chat não tinha motivo para migrar. Mas
ele deixou de carregar mídia: uma oscilação da sinalização não derruba mais vídeo nem voz.

## O que saiu

Cerca de 700 linhas: a criação de pares, os repasses de `offer`/`answer`/`candidate` dos dois
lados, a fila de sinalização, o reatamento de ICE, o vigia de conexão travada, o modo de forçar
TURN, a identificação de faixas por MID e por id de stream, e a maquinaria de banda inteira
(medição por par, orçamento, histerese de resolução, limite de upload).

A identificação de faixas some porque o servidor de mídia carrega a fonte no próprio protocolo:
não há mais faixa ambígua para adivinhar. A maquinaria de banda some porque o simulcast faz o
mesmo trabalho, e por espectador — algo que a malha nunca conseguiu.

**Ficou** o seletor de perfil (720p/1080p/1440p), que controla a resolução de captura e o teto
de envio, e o seletor de codec, que virou uma opção de publicação. Sumiu o limite de upload:
com uma cópia só, ele perdeu o sentido no cliente.

## Defeitos encontrados durante a migração

| O que acontecia | Correção |
| --- | --- |
| O Socket.IO encerra qualquer *upgrade* que não seja dele um segundo depois. Isso derrubava a sinalização do servidor de mídia no meio da conversa. | `destroyUpgrade` desligado; upgrades sem dono são fechados por um handler explícito, registrado por último. |
| O encaminhamento não desligava o algoritmo de Nagle. Pacotes pequenos de ping/pong ficavam retidos e o cliente concluía que o servidor havia sumido. | `setNoDelay` nos dois lados, e o fechamento de um propaga para o outro. |
| Despublicar uma faixa **encerra** a captura por padrão. Trocar o perfil de qualidade — que despublica e publica de novo — matava a tela compartilhada. | O ciclo de vida das capturas é desta página: a remoção passa `stopOnUnpublish: false`. |
| Parar a tela remove vídeo e áudio juntos, e cada remoção dispara uma renegociação. Duas ao mesmo tempo estouravam o tempo limite. | Uma fila única para todas as fontes, em vez de uma por fonte. |
| Quem abrisse a sala nos segundos em que o servidor de mídia ainda descobria o próprio endereço ficava sem mídia até recarregar. | O servidor só se anuncia depois de responder, e a página espera enquanto o estado for "iniciando". |

## Validação

`npm test` cobre o token de acesso (uma sala só, com prazo, assinatura conferida contra o
cálculo do servidor, segredo ausente da resposta, identidades distintas para nomes iguais,
código de sala inválido recusado) e as regras de mídia que sobreviveram.

`npm run test:browser` roda dois Chromium reais contra um servidor de verdade com o servidor de
mídia no ar: espectador que chega depois, tela e câmera simultâneas com quadros realmente
decodificados, troca de codec ao vivo verificada pelo relatório do receptor, captura em 1080p
subindo uma vez repartida em camadas de simulcast, troca e reinício de tela, mídia nos dois
sentidos, áudio de tela publicado sem DTX nem RED, reconexão da mídia após a queda da
sinalização, virar câmera, chat e o agente de áudio.

**O que nada disso cobre:** um iPhone real, redes móveis, carga com cinco pessoas em 1440p,
consumo de banda sustentado, e o comportamento do roteador com dez portas UDP abertas por horas.
O teste que decide continua sendo o do aparelho que motivou tudo isto, na rede que falhava.

Uma limitação do ambiente de teste, registrada porque muda o que dá para afirmar: num Chromium
sem placa de vídeo, a estimativa de banda inicial não sobe até a camada alta do simulcast. Por
isso o teste afirma que a captura é 1080p e que ela sobe em várias camadas, e **não** que o
espectador decodifica 1080p — exigir isso contrariaria justamente o comportamento desejado.
