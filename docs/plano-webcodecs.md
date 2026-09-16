# Plano — a tela por WebCodecs sobre faixas de dados do LiveKit

Branch proposta: `nexo-webcodecs`, a partir de `nexo-sfu`, fora de `codex/`.
Escrito para ser executado depois; nada aqui foi implementado.

## O que este plano precisa atender

Quatro exigências, e elas eliminam desenhos que pareciam razoáveis:

| Exigência | O que ela elimina |
| --- | --- |
| **Nada de serviço pago** — o servidor é o PC de casa | Qualquer SFU hospedado, qualquer transcodificação na nuvem |
| **Qualquer navegador, celular e o aplicativo** | Módulo nativo como caminho único; APIs de fabricante (NVENC, AMF, QSV) por dentro do nosso código |
| **Com e sem aceleração por hardware** | Um caminho que só funciona quando há placa — ele precisa ter modo software |
| **A interface continua a mesma** | Trocar `<video>` por `<canvas>` na sala inteira |

A segunda é a mais restritiva, e vale dizer por quê: as APIs dos fabricantes são
nativas, e nenhum navegador as expõe. O WebCodecs **é** a porta para elas — nesta
máquina, `prefer-hardware` é aceito para H.264 e recusado para VP9 e AV1, que é o perfil
exato de uma NVENC Ampere ([`captura-de-tela.md`](captura-de-tela.md)). Codificar por
hardware em qualquer placa, em qualquer sistema, sem código nativo, é o que o WebCodecs
já faz. O que falta não é o codificador: é o transporte.

---

## A descoberta que corta este plano pela metade

A versão anterior deste documento mandava construir a fragmentação, a remontagem, o
cabeçalho e o canal. **Quase tudo isso já existe no que está instalado.**

O `livekit-client` 2.22.3 exporta `LocalDataTrack`, `RemoteDataTrack`, `DataTrackPacket`
e `LocalParticipant.publishDataTrack()`. E o binário do servidor **1.13.6, o que já está
em `native/livekit/`**, carrega as strings do protocolo: `PublishDataTrackRequest`,
`DataTrackInfo`, `publish_data_track`, `_data_track`. Não é recurso de versão futura.

| O plano anterior mandava construir | Estado real |
| --- | --- |
| Fragmentar quadros grandes em pacotes de ~15 KB | **Existe.** `DataTrackPacketizer`, e `STREAM_CHUNK_SIZE_BYTES = 15000` |
| Cabeçalho com id do quadro, índice e total | **Existe.** `DataTrackPacketHeader`: versão, marcador (`Start`/`Inter`/`Final`/`Single`), `trackHandle`, `sequence`, `frameNumber`, `timestamp`, extensões |
| Timestamp de captura viajando no cabeçalho | **Existe.** `userTimestamp`, extensão de primeira classe do quadro |
| Remontagem do outro lado | **Existe.** `DataTrackDepacketizer`, com motivos de descarte nomeados (`Incomplete`, `BufferFull`) |
| Canal não confiável, sem ordem, para não travar a fila | **Existe.** O canal `_data_track` nasce com `ordered: false, maxRetransmits: 0` |
| Descartar quando o buffer cresce, em vez de acumular atraso | **Existe.** `LossyDataChannel` mantém o portão de descarte em ~100 ms de latência acumulada, com o limite reajustado a cada segundo pela taxa observada, e conta os descartes |
| Roteamento por assinatura, para quem não assiste não pagar | **Existe.** `RemoteDataTrack.subscribe()` fala com o SFU; sem assinatura, nada desce |
| Permissão no token | **Existe.** `canPublishData` já é concedido em [sfu.js:508](../sfu.js#L508) |

O que **continua sendo nosso** é o que nenhuma biblioteca poderia adivinhar:

- codificar e decodificar (`VideoEncoder` / `VideoDecoder`);
- o envelope de aplicação — se o quadro é chave, e a `decoderConfig` que o decodificador exige;
- a política de quadro-chave sob perda (o nosso PLI);
- a adaptação de banda;
- as faixas por espectador (o simulcast que se perde);
- a integração, os interruptores e a medição.

Isso é um projeto de tamanho muito diferente do que estava escrito aqui antes.

---

## Decisões de arquitetura

### 1. O transporte é a faixa de dados do LiveKit — não WebTransport, não WebSocket

Esta é a decisão que o resto do plano depende, e o argumento decisivo não é desempenho,
é **NAT**.

[`revisao-safari.md`](revisao-safari.md) documenta um diagnóstico colhido durante a falha:
`bytes=0`, `keyframes=0`, nenhum par de candidatos escolhido, `TURN configurado: não`.
Sem relay, a mídia não fecha em algumas redes — CGNAT em fibra residencial e rede móvel
são o caso comum no Brasil. A faixa de dados viaja na **mesma** conexão ICE/DTLS/SCTP que
o LiveKit já negociou, com o mesmo TURN e o mesmo túnel HTTPS. Ela não abre um problema de
conectividade novo: herda o que já foi resolvido.

| Alternativa | Por que não |
| --- | --- |
| **WebTransport** (HTTP/3) | Exige servidor QUIC próprio, certificado válido e outra porta furando o NAT. Some a cobertura de Safari, e some o TURN |
| **WebSocket** | TCP: retransmite tudo e bloqueia a fila. Um pacote perdido atrasa todos os seguintes, que é exatamente o oposto do que vídeo ao vivo precisa |
| **`publishData` avulso** | Funciona, mas obriga a reimplementar fragmentação, ordem e o portão de descarte — tudo que a faixa de dados já traz |

### 2. H.264, e só

| Motivo | Detalhe |
| --- | --- |
| É o que a placa codifica | A NVENC Ampere faz H.264 e HEVC; VP9 e AV1 são recusados |
| É o que o iPhone decodifica por hardware | VideoToolbox. Ele é o receptor que decide, e isso não é negociável |
| É o que tem decodificação por hardware em todo lugar | Intel, AMD, NVIDIA, Apple, Android |

Uma armadilha de teste, que precisa estar escrita antes de custar um dia: o **Chromium do
Playwright pode não ter H.264 no WebCodecs** (é um codec licenciado, e a compilação aberta
o omite mesmo quando o OpenH264 do WebRTC está presente). Os testes automatizados devem
provar o *caminho* com VP8 — sempre disponível — e o H.264 fica para a validação manual,
no Chrome de verdade. Confundir as duas coisas transformaria uma limitação de compilação
em "o plano não funciona".

### 3. Só a tela vai pelo caminho novo

| Fonte | Caminho | Motivo |
| --- | --- | --- |
| **Tela** | WebCodecs | É a fonte cara, e é onde desvio de dezenas de ms não incomoda |
| Câmera | WebRTC, sempre | Sincronia com a voz importa, e o custo é pequeno |
| Microfone e áudio da tela | WebRTC, sempre | Opus não usa placa de vídeo. Não há o que ganhar |

Restringir à tela elimina de uma vez o problema mais difícil da lista de perdas — a
sincronia entre áudio e vídeo — porque som de jogo tolera o que uma voz falando não
toleraria.

### 4. Funciona sem hardware, mas sem hardware não é o padrão

A exigência de "poder não usar aceleração" é atendida, e ela merece uma ressalva honesta:
**sem hardware, o WebCodecs usa o mesmo OpenH264 que o WebRTC usa.** O custo de
codificação é o mesmo, e o RTP é perdido. Ligar o caminho novo por padrão numa máquina sem
placa seria entregar uma regressão silenciosa.

Então a decisão automática é:

| Situação | Caminho padrão |
| --- | --- |
| `VideoEncoder.isConfigSupported` aceita H.264 com `prefer-hardware` | O caminho novo |
| Não aceita, ou a sala tem alguém sem `VideoDecoder` | O caminho de hoje |
| A pessoa escolheu "Sempre ligada" | O caminho novo, com hardware ou sem |

Há **um** ganho real sem hardware, e ele é grande o bastante para o modo software não ser
só diagnóstico: com WebCodecs o laço de codificação é nosso. Hoje, quando o codificador
satura, o libwebrtc derruba quadros na entrada — foi isso que apareceu em campo com as
camadas em `limitado por=none` e os quadros caindo de 44 para 24. Com o laço na mão, a
escolha passa a ser nossa: **baixar a resolução e manter os quadros**, que é literalmente
"fluidez sempre máxima, para não sofrermos de lag em nenhum cenário".

### 5. Tudo ou nada por transmissão

Se qualquer espectador não tiver `VideoDecoder`, a transmissão inteira usa o caminho de
hoje. Publicar os dois ao mesmo tempo custaria a codificação por software de qualquer
jeito — o ganho evaporaria. A decisão é reavaliada quando alguém entra ou sai, e a
interface diz qual caminho está no ar **e por quê**; sem isso o interruptor vira
superstição.

### 6. A interface não muda, e isso é por construção

Cada `VideoFrame` decodificado volta a ser um `MediaStream`:

- onde houver `VideoTrackGenerator` (Chrome/Edge/Electron): usá-lo direto;
- onde não houver (Safari, Firefox): `canvas.captureStream()`.

`room-transport.js` já entrega `MediaStream` em `par.remoteStreams[fonte]`
([room-transport.js:732](../public/room-transport.js#L732)), e a interface consome isso em
três lugares só — o palco, o card do modo múltiplo e o quadradinho. Nenhum `<video>`,
nenhum CSS, nenhum zoom, nenhuma tela cheia e nenhum tema muda.

O `captureStream` custa uma cópia por quadro, e custa no aparelho mais fraco. Se a medição
mostrar que ele pesa no iPhone, a saída é desenhar num `<canvas>` ali — mas isso é
otimização com evidência, não ponto de partida.

---

## Etapa 0 — as medições que decidem, antes de qualquer linha

A pergunta de hardware **já está respondida**: o WebCodecs alcança a placa, e o WebRTC do
Electron não ([`captura-de-tela.md`](captura-de-tela.md) e a medição de 16/09/2026 com
Electron 44.2.0, em que 1080p60 custou 11,7 ms por quadro e não cabe numa thread). As
perguntas que restam são de **transporte** e de **valor**, e nenhuma custa mais de um dia.

| # | Pergunta | Como responder | Se a resposta for ruim |
| --- | --- | --- | --- |
| **0.1** | **Quanto a faixa de dados sustenta?** | Publicar carga sintética de 2, 4 e 8 Mbps; ler `dropCount` do canal lossy, `bufferedAmount` e o atraso pelo `userTimestamp`. Em LAN **e** pelo túnel | O SCTP é o risco central deste plano. Se ele não sustentar 4 Mbps com atraso estável, o caminho novo fica limitado a 720p — ou morre |
| **0.2** | **O SFU 1.13.6 aceita publicar e assinar?** | Duas abas, `publishDataTrack` + `subscribe`, um quadro de ida e volta | Validar a 1.13.7 (já declarada em `baixar-livekit.cjs`). Se nenhuma aceitar, o plano espera o servidor |
| **0.3** | **Quantos quadros sobrevivem à perda?** | Perda induzida de 1%, 5%, 10%. Um quadro-chave de 1080p passa de 200 KB, ou ~14 fragmentos: perder **um** descarta o quadro inteiro | Define a política de quadro-chave, e diz se precisamos de redundância nossa. Com 1% de perda por pacote, ~13% dos quadros-chave se perdem |
| **0.4** | **Quanto o jogo ganha, hoje?** | FPS do jogo e processador com ninguém assistindo, com um espectador e com três | **É o portão de valor.** Duas coisas mudaram desde o relato original — a captura passou a ser de tela inteira, e a tela só é codificada quando alguém assiste. Se a perda já for pequena, este projeto é caro demais para o que entrega |

**0.1 e 0.3 são específicas deste desenho e não têm precedente no projeto.** Elas são a
razão de a etapa 0 existir: as duas podem ser respondidas com um script de meia página, e
qualquer uma delas pode encerrar o assunto antes de existir código para manter.

---

## Componentes a construir

### 1. `public/tela-codificador.js`

Captura → `VideoFrame` → `VideoEncoder`. Dois caminhos de aquisição, porque um deles é só
do Chrome:

| Caminho | Onde | Custo |
| --- | --- | --- |
| `MediaStreamTrackProcessor` | Chrome, Edge, Electron | Sem cópia. É o caminho bom |
| `<video>` + `requestVideoFrameCallback` + `new VideoFrame(video)` | Safari, Firefox | Uma cópia por quadro |

Configuração: `latencyMode: 'realtime'`, `avc: { format: 'annexb' }`,
`hardwareAcceleration: 'prefer-hardware'` (ou `'no-preference'` no modo software).

Uma verificação que decide o desenho da adaptação de banda: **`configure()` pode ser
chamado de novo só para mudar o bitrate, ou exige recriar o codificador?** Se exigir,
cada ajuste custa um quadro-chave, e a adaptação precisa ser bem mais parcimoniosa.

### 2. `public/tela-quadro.js` — o envelope de aplicação

O LiveKit resolve a fragmentação. O que ele não tem como saber é o que o decodificador
precisa:

- **se o quadro é chave** — sem isso o receptor não sabe onde pode começar;
- **a `decoderConfig`** (o `description`/avcC), que acompanha **todo** quadro-chave e não
  só o primeiro. Sem isso, quem chega no meio da transmissão nunca decodifica — e quem
  chega no meio é o caso normal de uma sala;
- **a resolução do quadro**, que muda quando a adaptação baixa a imagem;
- **o id da camada**, para a etapa das faixas por espectador.

O timestamp de captura **não** entra aqui: ele vai no `userTimestamp` do LiveKit, que
existe exatamente para isso.

### 3. `public/tela-decodificador.js`

Quadros → `VideoDecoder` → `MediaStream`.

Uma armadilha que só aparece lendo a biblioteca: **`maxPartialFrames` vale 1 por padrão.**
Com um canal sem ordem, um quadro que comece a chegar antes do anterior terminar
**descarta o anterior**. Precisa subir, e o valor certo sai da medição 0.1.

Mais: jitter buffer curto, `prefer-hardware` na decodificação, e a saída como `MediaStream`
pelos dois meios já descritos.

### 4. O nosso PLI — quadro-chave sob demanda

Quem detecta buraco pede quadro-chave; quem envia atende com
`encode(frame, { keyFrame: true })`, com limite de frequência.

O pedido vai por `publishData` **confiável** — é uma mensagem de algumas dezenas de bytes,
e perdê-la deixaria a imagem parada esperando um quadro que ninguém mais vai pedir. É o
caso em que a confiabilidade não custa atraso de imagem.

### 5. Adaptação de banda

A peça mais delicada, porque sem ela a transmissão afoga a própria conexão — e a
sinalização viaja no mesmo transporte, então afogar não dá imagem ruim: dá queda da sala.

Quatro sinais, e nenhum deles sozinho:

| Sinal | O que ele diz |
| --- | --- |
| `dropCount` do canal lossy | O portão de ~100 ms está descartando. É o sinal mais direto de que não cabe |
| `bufferedAmount` | O SCTP não está escoando o que entregamos |
| `availableOutgoingBitrate` do `candidate-pair` | A estimativa do próprio WebRTC, que **continua existindo** porque a câmera e o áudio seguem no RTP. Legível pelo `getStats()` de qualquer sender |
| O relato do espectador | Quadros recebidos, quadros descartados, atraso pelo `userTimestamp` |

A regra de reação segue a prioridade do projeto: **a resolução cede antes dos quadros.**

### 6. Faixas por espectador — o simulcast que se perde

Duas instâncias de `VideoEncoder` em resoluções diferentes, e a cada espectador a faixa
que a conexão dele aguenta. Duas faixas de dados publicadas, ou uma faixa com o id de
camada no envelope — a medição 0.1 decide qual, porque a segunda economiza assinatura e a
primeira economiza banda de quem só quer a pequena.

**Só entra depois que a faixa única estiver estável.** É a parte mais fácil de adiar e a
mais fácil de errar. Codificar duas vezes é barato em hardware e caro em software — mais
um motivo para esta etapa vir por último.

### 7. Integração em `room-transport.js`

A superfície `peers` **não muda**. `remoteStreams.screen` ganha uma segunda origem
possível, e é a mesma disciplina que fez a migração para SFU não tocar na interface.

Um detalhe de contabilidade que não pode passar: **`medirRecebimento()` soma
`inbound-rtp` por faixa** ([room-transport.js:482](../public/room-transport.js#L482)). A
tela que vem por faixa de dados não tem `inbound-rtp`, então ela sairia do relatório de
banda — e a tela é a fonte central da medição. Os bytes precisam ser contados no
depacketizer e entrar na mesma soma, com o mesmo cuidado de delta que já existe ali.

### 8. Os interruptores

Em **Dispositivos → Qualidade**, um campo novo:

| Opção | Comportamento |
| --- | --- |
| **Automático** (padrão) | Caminho novo quando há hardware e a sala inteira suporta |
| **Sempre ligada** | Tenta mesmo sem hardware. Para diagnóstico e para o modo software |
| **Desligada** | Só o caminho de hoje. É o botão de pânico |

Guardado em `localStorage`, como os outros perfis. O Diagnóstico ganha uma linha dizendo
qual caminho está no ar e, quando não é o acelerado, **por quê**.

E precisa existir **desligamento remoto**: uma chave em `/api/sala-config` que desabilita o
caminho novo para todo mundo sem ninguém atualizar nada. Uma reescrita de transporte sem
botão de desligar é irresponsável.

---

## A matriz real de compatibilidade

| Plataforma | Enviar tela | Receber tela | Observação |
| --- | --- | --- | --- |
| **Chrome/Edge Windows** | Sim, hardware medido | Sim | O caso central |
| **Electron (o aplicativo)** | Sim — mesmo Chromium, mesma API | Sim | O WebRTC dele não alcança a placa; o WebCodecs deve alcançar. **Medir, não supor** |
| **Chrome Linux** | Sim, hardware incerto | Sim | A aceleração por VA-API fica atrás de flags em várias distribuições. Cai para software sem avisar — e é por isso que a sondagem por máquina existe |
| **Safari macOS** | Sim, pelo caminho do `<video>` | Sim | VideoToolbox. `MediaStreamTrackProcessor` não existe ali |
| **Safari iOS / iPhone** | Não — nenhum navegador móvel tem `getDisplayMedia` | **Sim, e isto decide o plano** | WebCodecs desde 16.4. Recebe por `canvas.captureStream()` |
| **Firefox** | Sim, pelo caminho do `<video>` | Sim, hardware incerto | WebCodecs é recente ali |
| **Android** | Não (sem `getDisplayMedia`) | Sim | |

O celular nunca envia tela, então a restrição de envio não tira nada de ninguém. E
`prefer-hardware` é uma **preferência**, não garantia: a sondagem por máquina que o
Diagnóstico já faz é o que transforma isso em decisão em vez de suposição.

---

## O que se perde ao sair do RTP, e o que cobre cada perda

Esta é a tabela mais importante do documento, e ela ficou bem melhor do que na versão
anterior — porque metade das linhas agora tem cobertura pronta.

| O WebRTC dá hoje | No caminho novo |
| --- | --- |
| Pacing e fragmentação | **Coberto pela faixa de dados** (packetizer, chunks de 15 KB) |
| Descartar em vez de acumular atraso | **Coberto**: o portão de ~100 ms do canal lossy |
| Roteamento por assinante no servidor | **Coberto**: `subscribe()` pelo SFU. Quem não assiste não paga |
| Furar NAT, TURN, DTLS | **Coberto**: é a mesma conexão |
| Retransmissão (NACK/RTX) e FEC | **Some.** Um fragmento perdido mata o quadro. Coberto em parte pelo nosso PLI; a medição 0.3 diz se basta |
| Controle de congestionamento (transport-cc/GCC) | **Some para a tela.** Reconstruído com os quatro sinais da etapa 5. Continua existindo para câmera e áudio |
| Jitter buffer | **Some.** Precisamos de um, curto, ou a imagem treme |
| Simulcast por espectador | **Some.** Volta na etapa 6, como trabalho nosso |
| Sincronia com o áudio | **Some — e não importa**, porque só a tela vai por aqui |

A perda que sobra com peso real é a primeira da segunda metade: **sem retransmissão, um
pacote perdido custa um quadro inteiro.** É isso que a medição 0.3 mede, e é o número que
decide se este desenho serve para uma rede de verdade.

---

## Ordem de execução

Cada etapa é um commit, e cada uma tem entregável que se verifica sozinho.

| Etapa | Entregável verificável |
| --- | --- |
| **0** | Respostas a 0.1–0.4. **Portão: sem elas, não se começa** |
| 1 | Codificar e decodificar na mesma aba, sem rede. Prova que o hardware entra |
| 2 | Uma faixa de dados publicada e assinada entre duas abas, quadro único, sem adaptação |
| 3 | O envelope de aplicação: quadro-chave reconhecido, `decoderConfig` em todo keyframe, quem chega no meio decodifica |
| 4 | Quadro-chave sob demanda e recuperação de buraco |
| 5 | Adaptação de banda pelos quatro sinais, com a resolução cedendo antes dos quadros |
| 6 | Integração em `room-transport.js` — interface sem uma linha alterada — e a tela de volta ao relatório de banda |
| 7 | Detecção de capacidade, tudo-ou-nada por sala, queda automática para o caminho de hoje |
| 8 | Interruptor por usuário e desligamento remoto |
| 9 | Faixas por espectador (o simulcast de volta) |
| 10 | Medições comparativas e a suíte verde |

Até a etapa 6 o caminho de hoje continua sendo o único em uso de verdade. **Dá para parar
em qualquer ponto sem deixar a sala pior**, e isso é deliberado: é o que torna o projeto
abandonável sem prejuízo.

---

## Como provar que nada piorou

Nenhuma etapa é aceita "porque parece melhor". O que precisa ser medido, com o caminho de
hoje e o novo, na mesma cena e na mesma rede:

| Medida | Como |
| --- | --- |
| **Atraso de ponta a ponta** | O `userTimestamp` chega no quadro; o receptor calcula. É a medida que mais pode piorar |
| **FPS do jogo** de quem transmite | O número que motivou tudo |
| **Processador** de quem transmite | Idem |
| **Estabilidade de quadros** de quem assiste | Recebidos e descartados |
| **Comportamento sob perda** | 1%, 5%, 10%. É onde o caminho novo tende a ser pior |
| **Recuperação** | Tempo até a imagem voltar depois de um buraco |
| **Bateria do iPhone** | O `captureStream` custa uma cópia por quadro no aparelho mais fraco |

Testes a acrescentar em `tests/browser.cjs` — com **VP8**, pela razão de compilação já
explicada:

- ida e volta de um quadro codificado por faixa de dados entre dois contextos;
- quem entra no meio recebe `decoderConfig` no quadro-chave seguinte e decodifica;
- sala mista (um sem `VideoDecoder`) força todo mundo ao caminho de hoje;
- falha do `VideoEncoder` no meio da transmissão cai de volta sem a imagem sumir;
- o interruptor "Desligada" realmente impede o caminho novo;
- a tela por faixa de dados aparece no relatório de banda;
- a interface é a mesma nos dois caminhos: mesmos `<video>`, mesmo palco, mesmo tema.

**Validação manual obrigatória, na ordem que expõe problema mais cedo:** duas abas locais
→ duas máquinas na LAN → pelo túnel, de outra rede → **o iPhone**, que é o teste que
decide → celular em 4G ruim junto de um desktop bom.

---

## Riscos, e quando desistir

| Risco | Critério de desistência |
| --- | --- |
| **O SCTP não sustenta a banda** | Se a medição 0.1 não entregar 4 Mbps com atraso estável pelo túnel, o caminho novo fica em 720p ou não existe. **É o risco número um** |
| **Perda derruba quadros inteiros** | Se 5% de perda derrubar a imagem por mais tempo que hoje, e o PLI não cobrir, o caminho fica desligado por padrão |
| Atraso maior que o de hoje | Se a etapa 10 mostrar atraso pior sem conserto claro, idem |
| Sala mista é o caso comum | Se quase toda sessão tiver alguém sem suporte, o ganho é raro demais para justificar a manutenção |
| Complexidade | Dois transportes é o dobro de superfície para defeitos. Se a etapa 7 não ficar confiável, não seguir para a 9 |
| O ganho já não existe | Se 0.4 mostrar perda pequena de FPS hoje, **parar antes da etapa 1** |

## O que este plano não cobre

- **Áudio**: continua inteiramente no WebRTC. Não há ganho de hardware em Opus.
- **Câmera**: idem. O custo é pequeno e a sincronia com a voz importa.
- **Módulo nativo e APIs de fabricante** (NVENC, AMF, QSV, VA-API): fora de escopo **por
  decisão**, não por falta de tempo. Elas não alcançam o navegador, e o WebCodecs já
  entrega o mesmo acesso ao hardware nos dois ambientes. Elas voltariam à mesa num único
  caso: se o WebCodecs **também** não alcançasse a placa nas máquinas que importam.
- **Gravação** e qualquer coisa que exija o servidor entender os bytes: incompatível com
  este desenho por construção. O SFU encaminha a faixa de dados sem lê-la.
- **HEVC e AV1 por hardware**: a NVENC desta máquina faz H.264 e HEVC; o AV1 só a partir
  da geração Ada. Ficamos em H.264, que é também o único que o iPhone decodifica por
  hardware.
- **Carga real**: cinco pessoas em 1440p por horas continua sem cobertura, aqui como no
  plano do SFU.

---

## A alternativa que custa cem vezes menos já está no ar

Havia uma hipótese aberta: a escada declarada em `camadasDaTela` fixa
`scaleResolutionDownBy`, e isso pode estar impedindo o adaptador de resolução do libwebrtc
de agir — o que explicaria `limitado por=none` com os quadros caindo.

**Ela foi implementada, e não como destravamento do adaptador do navegador: a escala passou
a ser nossa.** Sob custo de codificação a camada de cima encolhe um degrau e volta quando
sobra folga, com o degrau de 360p intacto. Os detalhes estão em
[`banda-e-escala.md`](banda-e-escala.md), na seção "A imagem encolhe em vez de os quadros
serem perdidos".

Isso entrega o efeito prático que motivou este plano — **nunca travar** — sem transporte
novo, sem segundo caminho para manter e sem risco para o iPhone. O que ele **não** entrega é
a placa de vídeo: a codificação continua no processador, disputando com o jogo.

E por isso ele muda o peso da pergunta **0.4**, sem responder por ela. Medir agora, com a
escala no ar, é o que diz se ainda existe problema para este plano resolver.
