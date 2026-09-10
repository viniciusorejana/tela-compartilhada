# Plano — transporte de vídeo por WebCodecs

Branch proposta: `nexo-webcodecs`, a partir de `nexo-sfu`, fora de `codex/`.
Escrito para ser executado depois; nada aqui foi implementado.

## Por que este projeto existe

Nesta máquina o WebRTC do Chrome **não** entrega a codificação à NVENC, e o WebCodecs
entrega. As duas afirmações foram medidas ([`captura-de-tela.md`](captura-de-tela.md)); a
segunda é a que abre este caminho. Codificar 1080p em software disputa processador com o
jogo de quem transmite, e é essa disputa que o projeto ataca.

**A decodificação já usa a placa** no WebRTC (`decodingInfo` responde `true` para H.264, VP9
e AV1). Metade do problema não existe. Este plano trata só de quem **envia**.

---

## Etapa 0 — três perguntas que podem cancelar o projeto

Nenhuma linha da reescrita deve ser escrita antes destas respostas. Todas são baratas, e
qualquer uma delas pode tornar o resto desnecessário.

| # | Pergunta | Como responder | Se a resposta for "sim" |
| --- | --- | --- | --- |
| 0.1 | O Chromium do **Electron** entrega hardware ao WebRTC? | `npm i -D electron`, abrir o Diagnóstico dentro do aplicativo | Projeto cancelado: basta usar o aplicativo. O Electron traz outra compilação do Chromium, e isso nunca foi testado |
| 0.2 | Outra máquina do grupo tem hardware no WebRTC? | Pedir a um amigo o Diagnóstico | O defeito é local, e o custo da reescrita passa a ser desproporcional |
| 0.3 | O Windows 11 24H2 resolve? | O workaround do Chrome é literalmente "versões anteriores a 11 24H2" | Atualizar o sistema é ordens de grandeza mais barato |

Há ainda uma pergunta de valor, e ela é a mais importante das quatro:

**0.4 — a codificação por software ainda custa FPS no jogo, hoje?** Duas coisas mudaram
desde o relato original: a captura passou a ser de tela inteira, e a tela só é codificada
quando alguém está assistindo. Medir antes de reescrever: FPS do jogo e uso de processador
com ninguém assistindo, com um espectador e com três. Se a perda já for pequena, este
projeto é caro demais para o que entrega.

---

## O que se perde ao sair do RTP

Isto é o coração do risco. O `RTCPeerConnection` não é "um encanamento": é uma pilha de
mecanismos que foram construídos ao longo de vinte anos, e sair dela significa reconstruí-los.

| O que o WebRTC dá hoje | O que acontece no caminho novo |
| --- | --- |
| Controle de congestionamento (transport-cc/GCC) | Some. Precisamos estimar banda e reconfigurar o codificador |
| Retransmissão de perdas (NACK/RTX) e FEC | Some. Um pacote perdido vira artefato até o próximo keyframe |
| Jitter buffer | Some. Precisamos de um, ou a imagem treme |
| Pacing dos pacotes | Some. Um keyframe de 300 KB despejado de uma vez causa perda |
| Simulcast e escolha de camada por espectador no SFU | Some. O servidor de mídia vira relé burro: não entende os bytes, não pode descartar camada |
| Sincronia com o áudio | Some. Vídeo e áudio passam a ter relógios separados |

**A consequência mais séria é a penúltima.** Hoje quem está em 4G ruim recebe a camada
baixa sem derrubar a imagem dos outros — foi o ganho que motivou a migração para SFU. Um
transporte por canal de dados perde isso por construção, porque o servidor não sabe o que
está encaminhando.

Existe conserto (ver "faixas por destinatário", adiante), mas ele é trabalho nosso, não
presente do LiveKit.

---

## Desenho proposto

### Princípio: um caminho novo estreito, e o antigo intacto ao lado

O caminho WebRTC de hoje **não é removido nem alterado**. O caminho novo é uma alternativa
que só entra em cena quando todas as condições são favoráveis, e que cai de volta sozinho.

```
                    ┌─ hardware disponível? ─ não ─┐
capturar a tela ────┤                              ├──> caminho de hoje (WebRTC/SFU)
                    └─ sim ──> WebCodecs ──> canal de dados ──> WebCodecs ──> MediaStream
```

### Escopo, e por que ele é estreito

| Fonte | Caminho | Motivo |
| --- | --- | --- |
| **Tela** | WebCodecs, quando possível | É a fonte cara, e é onde a sincronia labial não importa |
| Câmera | WebRTC, sempre | Sincronia com a voz importa, e o custo é pequeno |
| Microfone e áudio de tela | WebRTC, sempre | Opus não usa placa de vídeo; não há o que ganhar |

Restringir à tela elimina de uma vez o problema mais difícil da lista acima — a sincronia
entre áudio e vídeo — porque o áudio de jogo tolera dezenas de milissegundos de desvio que
uma voz falando não toleraria.

### Quem manda e quem recebe

| Papel | Requisito | Quem atende |
| --- | --- | --- |
| **Enviar** | `MediaStreamTrackProcessor` + `VideoEncoder` com hardware | Chrome/Edge no desktop. Só |
| **Receber** | `VideoDecoder` | Chrome, Edge, Safari 16.4+, Firefox recente |

O celular nunca envia tela (nenhum navegador móvel implementa `getDisplayMedia`), então a
restrição de envio não tira nada de ninguém.

**O iPhone continua assistindo.** É o ponto que não pode ser negociado, e ele se resolve na
renderização: em vez de desenhar num `<canvas>` (que mudaria toda a interface), cada
`VideoFrame` decodificado vira um `MediaStream`:

- Onde houver `VideoTrackGenerator` (Chrome): usá-lo direto.
- Onde não houver (Safari): `canvas.captureStream()`.

Os dois devolvem um `MediaStream`. Como `room-transport.js` já entrega `MediaStream` para a
interface, **nada na interface muda** — nem os `<video>`, nem o CSS, nem o palco, nem a tela
cheia, nem o zoom, nem o tema. Era esta a exigência de manter "a mesma carinha", e ela é
atendida por construção, não por disciplina.

### Se alguém na sala não puder receber

Regra: **tudo ou nada por transmissão.** Se qualquer espectador não tiver `VideoDecoder`, a
transmissão inteira usa o caminho de hoje. Publicar as duas coisas ao mesmo tempo custaria a
codificação por software de qualquer jeito — ou seja, o ganho evaporaria.

A decisão é reavaliada quando alguém entra ou sai, e a interface diz qual caminho está no ar
e por quê ("aceleração desligada: um participante não a suporta").

---

## Componentes a construir

### 1. `public/webcodecs-envio.js`
Captura → `VideoFrame` → `VideoEncoder`. Configuração: `latencyMode: 'realtime'`,
`hardwareAcceleration: 'prefer-hardware'`, H.264 (o único que a NVENC Ampere codifica).
Verificar se `configure()` pode ser chamado de novo só para mudar bitrate, ou se exige
recriar o codificador — isso decide como a adaptação de banda é feita.

### 2. `public/webcodecs-pacote.js` — fragmentação
Um keyframe de 1080p passa de 200 KB; o pacote de dados do LiveKit vive na casa dos 15 KB.
Cabeçalho por fragmento: id do quadro, índice, total, se é keyframe, timestamp de captura,
e a `decoderConfig` (o `description`/avcC que o decodificador exige) junto de **todo**
keyframe — sem isso quem chega no meio nunca decodifica.

### 3. Perda e keyframes — o nosso PLI
Canal `lossy` (não confiável): o confiável causaria bloqueio de fila e picos de atraso, que
é exatamente o que não podemos ter. Quem detecta buraco pede keyframe por mensagem de dados;
quem envia atende com `encode(frame, { keyFrame: true })`, com limite de frequência.

### 4. Controle de banda
O canal de dados divide o transporte com o áudio, então o `availableOutgoingBitrate` do
`RTCPeerConnection` publicador **continua existindo** e é o sinal de congestionamento. Ler
por `getStats()` e realimentar o bitrate do codificador. É a peça mais delicada do projeto:
sem ela, a transmissão afoga a própria conexão.

### 5. Faixas por destinatário — o simulcast que perdemos
`publishData` aceita `destinationIdentities`. Codificar duas resoluções em duas instâncias
de `VideoEncoder` (barato em hardware, caro em software — mais um motivo para o caminho só
existir com hardware) e mandar a cada espectador a faixa que a conexão dele aguenta, com o
próprio espectador reportando sua capacidade.

**Só entra depois que o caminho de faixa única estiver estável.** É a parte mais fácil de
adiar e a mais fácil de errar.

### 6. `public/webcodecs-recepcao.js`
Remontagem, jitter buffer curto, `VideoDecoder` (`prefer-hardware`), e a saída como
`MediaStream` pelos dois meios descritos acima.

### 7. Integração em `room-transport.js`
A superfície `peers` **não muda**. A tela de alguém continua chegando como
`remoteStreams.screen`. O módulo novo é mais uma origem possível para esse mesmo campo — a
mesma disciplina que fez a migração para SFU não tocar na interface.

---

## O interruptor por usuário

Em **Dispositivos → Qualidade**, um campo novo:

| Opção | Comportamento |
| --- | --- |
| **Automático** (padrão) | Usa aceleração quando há hardware e a sala inteira suporta |
| **Sempre ligada** | Tenta mesmo sem confirmação de hardware. Para diagnóstico |
| **Desligada** | Só o caminho de hoje. É o botão de pânico |

Guardado em `localStorage`, como os outros perfis. O Diagnóstico ganha uma linha dizendo
qual caminho está no ar e, quando não é o acelerado, **por quê** — sem isso o interruptor
vira superstição.

Precisa existir também um **desligamento remoto**: uma chave servida por `/api/sala-config`
que desabilita o caminho novo para todo mundo sem exigir que ninguém atualize nada. Uma
reescrita de transporte sem botão de desligar é irresponsável.

---

## O módulo nativo é necessário?

**Não, e não deve ser construído.**

O módulo nativo (o que o Discord faz) resolveria um problema que aqui não existe: alcançar o
codificador da placa. O WebCodecs já alcança. Construí-lo significaria um componente C++ por
plataforma, um transporte próprio, e um caminho que **só funciona dentro do aplicativo** —
enquanto a maioria das pessoas, e todo iPhone, entra pelo navegador.

Ele volta à mesa em um único caso: se a Etapa 0 mostrar que o WebCodecs **também** não
alcança o hardware nas máquinas que importam. Aí o problema muda de natureza, e este plano
inteiro deixa de valer.

---

## Como provar que nada piorou

Nenhuma etapa é aceita "porque parece melhor". O que precisa ser medido, com o caminho de
hoje e o novo, na mesma cena e na mesma rede:

| Medida | Como |
| --- | --- |
| **Atraso de ponta a ponta** | Timestamp de captura viaja no cabeçalho; o receptor calcula. É a medida que mais pode piorar |
| **FPS do jogo** de quem transmite | O número que motivou tudo |
| **Processador** de quem transmite | Idem |
| **Estabilidade de quadros** de quem assiste | Quadros por segundo e descartados |
| **Comportamento sob perda** | Perda induzida de 1%, 5%, 10%. É onde o caminho novo tende a ser pior |
| **Recuperação** | Tempo até a imagem voltar depois de um buraco |

Testes de navegador a acrescentar em `tests/browser.cjs`:

- Sala mista (um sem `VideoDecoder`) força todo mundo ao caminho de hoje.
- Falha do `VideoEncoder` no meio da transmissão cai de volta sem a imagem sumir.
- Quem chega no meio recebe keyframe e decodifica.
- O interruptor "Desligada" realmente impede o caminho novo.
- A interface é a mesma nos dois caminhos: mesmos `<video>`, mesmo palco, mesmo tema.

**Validação manual obrigatória, na ordem que expõe problema mais cedo:** duas abas locais →
duas máquinas na LAN → pelo túnel, de outra rede → **o iPhone**, que é o teste que decide →
celular em 4G ruim junto de um desktop bom.

---

## Ordem de execução

| Etapa | Entregável verificável |
| --- | --- |
| 0 | Respostas às quatro perguntas. **Portão: sem elas, não se começa** |
| 1 | Codificar e decodificar na mesma aba, sem rede. Prova que o hardware entra |
| 2 | Fragmentação e remontagem entre duas abas, faixa única, sem adaptação |
| 3 | Keyframe sob demanda e recuperação de perda |
| 4 | Controle de banda pelo `availableOutgoingBitrate` |
| 5 | Integração em `room-transport.js`, interface sem uma linha alterada |
| 6 | Detecção de capacidade, tudo-ou-nada por sala, queda automática |
| 7 | Interruptor por usuário e desligamento remoto |
| 8 | Faixas por destinatário (o simulcast de volta) |
| 9 | Medições comparativas e a suíte verde |

Cada etapa é um commit. Até a etapa 5 o caminho de hoje continua sendo o único em uso de
verdade — dá para parar em qualquer ponto sem deixar a sala pior.

---

## Riscos, e quando desistir

| Risco | Critério de desistência |
| --- | --- |
| Atraso maior que o de hoje | Se a etapa 9 mostrar atraso pior e não houver conserto claro, o caminho novo fica desligado por padrão |
| Comportamento ruim sob perda | Se 5% de perda derrubar a imagem por mais tempo que hoje, idem |
| Sala mista é o caso comum | Se quase toda sessão tiver alguém sem suporte, o ganho é raro demais para justificar a manutenção |
| Complexidade de manutenção | Dois transportes é o dobro de superfície para defeitos. Se a etapa 6 não ficar confiável, não seguir para a 8 |

## O que este plano não cobre

- **Áudio**: continua inteiramente no WebRTC. Não há ganho de hardware em Opus.
- **Gravação**, transcodificação no servidor, e qualquer coisa que exija o SFU entender os
  bytes: incompatível com este desenho por construção.
- **HEVC e AV1 por hardware**: a NVENC desta máquina faz H.264 e HEVC; o AV1 só a partir da
  geração Ada. Ficamos em H.264, que é também o único que o iPhone decodifica por hardware —
  conveniente, mas é coincidência, não projeto.
- **Carga real**: cinco pessoas em 1440p por horas continua sem cobertura, aqui como no
  plano do SFU.
