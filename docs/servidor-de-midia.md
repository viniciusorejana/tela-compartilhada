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
hospeda**: quando é a tela do host no ar, as mesmas 16 Mbps saem, agora pelo processo do
servidor de mídia. O que muda é que o custo passa a ser sempre do host — um participante com
10 Mbps de upload, que antes não conseguia compartilhar tela para quatro pessoas, passa a enviar
4 Mbps e o resto sai da conexão de quem hospeda.

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

---

# Correções: fantasmas na sala e FPS da tela

## O servidor de mídia estava morrendo

O sintoma relatado — "quem fecha a aba continua na sala, e o FPS caiu" — tinha uma causa
comum por baixo: **o processo do servidor de mídia encerrava sozinho**, e o Node não o
recolocava no ar.

```
[mídia] listen udp 192.168.100.107:7882: bind: Only one usage of each socket address...
O servidor de mídia encerrou (código 0).
```

Duas coisas produziam isso, e as duas foram corrigidas.

**Endereços demais.** Um PC comum tem muito mais endereços do que parece: Radmin,
Teredo e — o pior — vários IPv6 temporários que o Windows cria por privacidade na mesma
placa. O servidor tentava abrir a porta de mídia em cada um; dois deles na mesma porta e o
`bind` falhava, encerrando o processo inteiro. Agora o Node descobre os endereços IPv4 reais
(`os.networkInterfaces()`, descartando faixas de túnel e VPN) e entrega uma lista fechada.
Uma VPN instalada amanhã fica de fora sozinha.

**A descoberta de IP ocupava a porta da mídia.** Com `use_external_ip`, o servidor pergunta
o próprio endereço a um STUN *pela mesma porta* que usaria para a mídia — e depois não
consegue mais abri-la. O Node passou a fazer essa pergunta antes, por uma porta qualquer
(um Binding Request de 20 bytes, sem dependência), e entrega o endereço pronto.

**E se cair mesmo assim**, agora volta: reinício supervisionado com espera crescente, até
oito tentativas, com o contador zerando depois de um minuto no ar. Uma queda deixava a sala
muda até alguém reiniciar o Node na mão — e ninguém está olhando o terminal no meio de uma
conversa.

## Quem sai sem avisar

Fechar a aba já avisava; perder a rede, não. O servidor de mídia guarda essa pessoa por muito
tempo esperando ela voltar — prudente para uma oscilação, ruim para a lista da sala, onde ela
ficava parada com a imagem congelada.

A correção usa **duas fontes independentes**, que é o certo aqui: a conexão de sinalização
percebe a queda em segundos e diz quem saiu (a identidade da mídia agora viaja junto do
evento de saída), enquanto o servidor de mídia continua sendo a fonte da imagem e da voz.
O heartbeat do Socket.IO foi apertado de 45 s para cerca de 25 s — apertar mais tiraria da
sala quem só passou por um túnel.

| Situação | Antes | Depois |
| --- | --- | --- |
| Fecha a aba | 3 s | **imediato** |
| Perde a rede, o notebook fecha | nunca saía | **~23 s** |

Enquanto isso, quem perdeu a conexão aparece marcado como "sem conexão" em vez de sumir de
repente ou fingir que está lá. Se a conexão com o servidor de mídia cair inteira, a lista é
esvaziada — antes todo mundo continuava aparecendo, congelado.

## O FPS da tela

A causa era uma escolha minha, feita sem perguntar: a tela ia com `contentHint = 'detail'` e
`degradationPreference = 'maintain-resolution'`. Os dois dizem a mesma coisa ao codificador
— *quando faltar recurso, derrube os quadros e segure a resolução*. Ótimo para ler código,
péssimo para tudo que se move, e era o padrão para todo mundo.

Medido com três navegadores reais contra um servidor real, mesma máquina:

| Cenário | Antes | Depois |
| --- | --- | --- |
| Um compartilhando | 15 fps a 1920×1080 | **30 fps** a 1280×720 |
| Três compartilhando | 9 fps a 1920×1080 | **30 fps** a 640×360 |

O padrão passou a ser **Equilíbrio**, e a escolha ficou com quem compartilha: **Nitidez**
(código, texto, planilhas), **Equilíbrio** ou **Fluidez** (jogos e vídeo, até 60 fps). A
câmera passou a priorizar fluidez sempre — ver a pessoa aos solavancos incomoda mais que
perder nitidez.

Ressalva sobre a medição: a fonte do teste é um canvas sintético, que também tem seu próprio
teto de quadros. A comparação entre antes e depois é válida porque só a configuração mudou;
os números absolutos não representam uma tela real.

**"É a minha internet ou o meu PC?"** é a primeira pergunta de quem vê a imagem travando, e
o navegador sabe responder. Esse dado deixou de ficar escondido num relatório e agora aparece
em Dispositivos, em português: se o processador não dá conta, se a conexão de subida não dá
conta, ou se nada está limitando — caso em que os quadros que saem são simplesmente os que a
fonte entrega.
