# Plano — a tela por WebCodecs sobre faixas de dados do LiveKit

Branch: `nexo-webcodecs`, a partir de `fase-1-contas`. **Implementado** (27/09/2026): o que a
implementação decidiu, o que mediu e o que ainda falta validar está em
["O que a implementação decidiu"](#o-que-a-implementação-decidiu), no fim. O resto do documento
continua sendo o porquê.

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
| A pessoa escolheu "Forçar WebCodecs" | O caminho novo, com hardware ou sem |

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

Em **Dispositivos → Qualidade → Codec e codificação da tela**, o campo "Codificação da tela"
(nomes como ficaram na implementação; a explicação embaixo do seletor muda com a opção):

| Opção | Comportamento |
| --- | --- |
| **Automática · WebCodecs quando der** (padrão) | WebCodecs quando há hardware, servidor 1.13.7 ou mais novo e a sala inteira suporta |
| **Forçar WebCodecs · até no processador** | Tenta mesmo sem hardware e com servidor anterior. Para diagnóstico e para o modo software |
| **Só WebRTC · sem WebCodecs** | Nunca usa, nem para receber. É o botão de pânico |

Guardado em `localStorage`, como os outros perfis. No Diagnóstico, o WebCodecs não tem cartão
próprio: escreve no mesmo "Enviando sua tela" e no mesmo "Recebendo a tela de…" do WebRTC,
com "Transmissão" na primeira linha e "Onde codifica" logo abaixo. O **porquê** de cada
escolha fica no relatório técnico.

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
- o interruptor "Só WebRTC" realmente impede o caminho novo;
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

---

## O que a implementação decidiu

Implementado em 27/09/2026, na branch `nexo-webcodecs`. O portão da etapa 0 foi atravessado
por decisão explícita — implementar primeiro e medir com o código na mão —, e por isso as
medições que dependem de rede real e de jogo real continuam abertas (ver "O que falta medir").

### Onde mora

| Peça | Arquivo |
| --- | --- |
| Envelope do quadro e mensagens de controle | `public/tela-quadro.js` |
| Decisões puras: caminho, adaptação, camada do espectador, nível do H.264 | `public/tela-decisoes.js` |
| Captura → `VideoEncoder`, uma instância por camada | `public/tela-codificador.js` |
| `VideoDecoder` → `MediaStream`, com reordenação e reenvio | `public/tela-decodificador.js` |
| O orquestrador: capacidade, caminho, faixas, espectadores, relógio | `public/tela-webcodecs.js` |
| Integração (a superfície `peers` não mudou) | `public/room-transport.js` |
| Interruptor, medição do envio, parâmetros do perfil | `public/sala.js`, `sala.html` |
| Cartão no Diagnóstico | `public/room-ui.js` |
| Chave do servidor (botão de pânico) | `chave-webcodecs.js`, `/painel/api/midia`, seção "Mídia" do painel |
| Testes | `tests/tela-webcodecs.test.js` (`npm test`), `tests/webcodecs-browser.cjs` (`npm run test:webcodecs`, sem placa) e `tests/webcodecs-placa.cjs` (`npm run test:webcodecs:placa`, Chrome instalado e placa de vídeo de verdade) |

### Onde a implementação diverge do plano, e por quê

| O plano dizia | O que foi feito | Por quê |
| --- | --- | --- |
| Tudo ou nada: publicar pelos dois caminhos custaria o software de qualquer jeito | A publicação RTP da tela **continua sempre no ar**, e a imagem vai pela faixa de dados | Quem assiste pela faixa de dados não assina o RTP, e o dynacast desliga todas as camadas dele — nada é codificado ali. Em troca, "fulano compartilha", o Assistir, os espectadores e a conferência do plano no servidor ficam intactos, e a queda para o caminho de hoje é só reassinar |
| O canal `_data_track` descarta com o portão de ~100 ms | **Não descarta**: na 2.22.3 ele faz contrapressão (`bufferFullBehavior: 'wait'`) | O portão virou nosso: o quadro é pulado ANTES de codificar quando o buffer passa de ~100 ms da taxa. É o único descarte que não quebra a cadeia de referências |
| Capacidade anunciada (implícito: atributos) | Mensagem `cap` pelo canal confiável, com pergunta e resposta | O token não concede `canUpdateOwnMetadata`, e concedê-lo deixaria qualquer cliente trocar o próprio nome. E a mensagem que o recém-chegado manda ao entrar chega aos outros **sem remetente** (a sala ainda não o conhece): quem já está pergunta, e ele responde |
| Retransmissão some; o PLI talvez baste | **Reenvio por quadro** (o NACK que se perdeu), antes do quadro-chave | Sem ele, 8% de perda de pacotes congelava a imagem por segundos: cada pacote perdido virava um quadro-chave, e o quadro-chave, com vários pacotes, é o que mais se perde. Quem envia guarda ~3 s por camada; quem assiste pede o buraco e espera 1,5 ida e volta |
| `availableOutgoingBitrate` como um dos quatro sinais | Só no Diagnóstico | Ele é o controle de congestionamento do RTP, que não vê o SCTP. Medido: 300 kbps estimados com a tela saindo a 1,2 Mbps pela faixa de dados. Como teto, derrubaria a tela ao tamanho do microfone. Os sinais que decidem são o portão de envio, a perda relatada (mediana de quem assiste a camada) e a fila do codificador |
| Uma faixa com id de camada, ou duas faixas | **Duas faixas**, `nexo-tela:alta` e `nexo-tela:baixa` | O servidor roteia por assinatura: quem está na camada leve não paga pela cheia. Cada camada só é codificada enquanto alguém a assiste |
| Testes com VP8, porque o Chromium do Playwright pode não ter H.264 | Os testes rodam em **H.264** | O Chromium do Playwright tem H.264 no WebCodecs, em software (`prefer-hardware` recusado). Isso ainda exercita o "Automático sem placa fica no caminho de hoje" |
| Desligamento remoto numa chave do `sala-config` | Chave no `sala-config` **e** aviso pelo socket, mudada pelo painel (ou fixada por `NEXO_WEBCODECS=0/1`) | Sem o aviso, quem já estava na sala só saberia na próxima reconexão |

### O defeito do servidor 1.13.6, e o que ele mudou

Reproduzido aqui: na 1.13.6, **assinar uma faixa de dados no instante em que ela é removida
trava a sinalização de quem assinou** — dali em diante nenhum pedido daquela pessoa é atendido,
nem a volta para o RTP, e a tela fica preta até ela recarregar. O registro do servidor mostra os
pedidos chegando (`received signal request`) e nenhum mais sendo tratado. A 1.13.7 corrige
("Fix/reconcile data track subscription deadlock", livekit#4843).

Três consequências, todas no código:

1. **O automático exige o servidor 1.13.7 ou mais novo** (`sala.serverInfo.version`). Na 1.13.6,
   só o "Forçar WebCodecs" usa o caminho novo — e o relatório do Diagnóstico diz por quê.
2. **Quem transmite avisa antes de tirar as faixas** (`fim`) e espera 300 ms: quem assiste solta
   a assinatura antes da remoção, e não durante.
3. **Quem assiste nunca recua de camada quando uma delas some** — as camadas saem juntas, e a
   outra é a próxima a sumir. Era exatamente o recuo para a camada de 360p, no meio da remoção,
   que disparava o travamento.

`NEXO_NIVEL_SFU=debug` (com `NEXO_LOG_SFU=arquivo`) foi o que mostrou isso, e ficou.

### A placa de vídeo de verdade: o que o primeiro teste em casa revelou

O primeiro teste manual, com o servidor na 1.13.7 e a NVENC desta máquina, caiu para o caminho
de hoje com "o codificador recusou a configuração da imagem cheia". O Chromium do Playwright não
tem placa, então nenhum teste automático podia ter visto. Perguntando ao Chrome 153 instalado (e
ao Electron 44 do aplicativo, que se comporta igual):

| Com `prefer-hardware` | Taxa declarada | Sem declarar a taxa |
| --- | --- | --- |
| 720p30, 720p60, 1080p30, 1080p60, 1440p30, 4K30 | aceita | aceita |
| **1440p60, 4K60** | **recusa** | aceita, e codifica de verdade |

O codificador do Windows usado pelo Chrome publica uma tabela conservadora (acima de 1080p, no
máximo 30 quadros). A NVENC faz 1440p60 com folga: sem a taxa declarada, codificou 233 de 240
quadros a 10 ms cada, com o bitrate obedecendo (6,4 Mbps para 6 pedidos) — o Chrome usa os
carimbos de tempo dos quadros. Em software, a mesma cena estourava o bitrate (7,5 Mbps).

O que mudou por causa disso:

1. **A taxa só é declarada quando a placa aceita**; quando não, a mesma configuração vai sem ela.
   A camada lembra a escolha ao configurar e ao reconfigurar.
2. **Escada ainda na placa** (`degrausDaPlaca`): se nem assim ela aceitar — gráfico integrado,
   notebook —, desce um degrau na placa em vez de cair para o processador no tamanho cheio. Em
   movimento cede a resolução (1440p60 → 1080p60 → 720p60); em nitidez, os quadros (1440p60 →
   1440p30). O motivo diz qual degrau subiu e por quê.
3. **Trocar a qualidade no meio da transmissão refaz a escolha.** Antes, de 1080p30 para 1440p60
   ao vivo reaproveitava a escolha antiga, declarava a taxa e caía no mesmo defeito.
4. **O aquecimento do codificador não é aperto.** Na placa, os primeiros instantes depois de
   configurar enchem a fila; isso contava como "codificador não acompanha", a imagem encolhia,
   o encolhimento reconfigurava, e o codificador aquecia de novo — 1080p virou 864p sem aperto
   nenhum. Agora os sinais ficam desligados por 3 s depois de ligar ou redimensionar, e aperto
   exige mais de 10% dos quadros pulados em **duas janelas seguidas**, nunca um pulo isolado —
   um quadro-chave, ou uma troca de cena, fecha o portão por um instante e não é a rede (ver
   "Trocas de cena", abaixo).
5. **A fila do codificador tolera três quadros em voo**, e não dois: a placa trabalha em linha de
   montagem, e com o limite em dois perdia ~5 de cada 60 quadros sem estar apertada.
6. A sondagem de "tem placa?" aceita 720p30 como prova, para a escada ter chance em placas que
   não vão até 1080p.

### O portão do servidor, e o ritmador

O registro do servidor no primeiro teste em rede de verdade veio cheio de
`could not send data track message … data dropped due to high buffered amount`. Lendo o código
da 1.13.7 (`DataChannelWriterUnreliable`, em `pkg/sfu/datachannel`): cada **espectador** tem um
portão próprio no canal das faixas de dados, e o servidor descarta o pacote quando o buffer
daquela pessoa passa de **100 ms do bitrate medido e de 8 KB**. A conta bate com o registro
(5,45 Mbps × 100 ms ÷ 8 = 68 111 bytes).

É o "portão de ~100 ms" que este plano atribuía à biblioteca do navegador — ele existe, mas no
servidor, por espectador. E morde em dois momentos:

- **no começo de cada assinatura**, quando o bitrate medido ainda é quase zero e o limite fica
  no piso de 8 KB: o primeiro quadro-chave, com dezenas de KB mandados de uma vez, é cortado —
  e o seguinte também, até a medição subir. Era isso que fazia a primeira imagem demorar;
- **em quadro-chave grande em regime**: 91 KB no buffer contra um limite de 88 KB.

Em loopback nada disso aparece (a mesma máquina escoa o buffer na hora: zero descartes
medidos), e é por isso que nenhum teste automático viu.

O remédio é o que o WebRTC faz por dentro: **ritmar**. A biblioteca fatia o quadro em pacotes de
16 KB e manda todos no mesmo instante, sem jeito de espaçá-los; então o fatiamento passou a ser
nosso (`tela-quadro.js`):

- **pedaços de até 7,2 KB**, abaixo do piso de 8 KB — cada um vai como um quadro de um pacote só;
- **um balde de fichas** a 1,5 × o bitrate da transmissão (piso de 3,2 Mbps), que parado guarda
  um pedaço: o primeiro pedaço de cada quadro sai sozinho, e o intervalo até o seguinte é o
  tempo que o buffer de cada espectador tem para escoar;
- no **relógio do Worker**, porque a aba de quem joga fica em segundo plano e o relógio da
  página seria estrangulado;
- o **reenvio fura a fila** (quem pediu está com a imagem parada).

No registro seguinte, numa sala de verdade, as linhas `data dropped due to high buffered amount`
sumiram.

### Trocas de cena: alt+tab, janela arrastada, minimizar

Com a tela inteira compartilhada, trocar de janela, dar alt+tab, minimizar ou arrastar
aplicativos depressa fazia os quadros e a nitidez despencarem, com travadas de instantes. Uma
tela sintética na placa (1080p60, 4 s de calma e 3 s trocando de janela a cada 300 ms)
reproduziu:

| | Palco, pior segundo | Atraso, pior | Imagem | Orçamento |
| --- | --- | --- | --- | --- |
| Antes | **5 quadros** | 470 ms | 1080p → 864p → 720p | 5,6 → 1,3 Mbps |
| Depois | 50 quadros | 85 ms | 1080p o tempo todo | 5,6 Mbps o tempo todo |

A troca de cena é um quadro enorme (a placa, pedida a 5,6 Mbps, entrega 8–10 Mbps enquanto a
cena muda). Três coisas se somavam:

1. **O ritmador perdia vazão.** O relógio do Worker acorda ~1 ms depois do pedido (medido: 4 ms
   viram 4,9), e com o balde de um pedaço só esse atraso era jogado fora a cada pedaço — a
   15 Mbps, um quinto a menos do que a taxa dizia. Agora o balde, com fila, guarda até **dois**
   pedaços: é o que o portão do servidor deixa passar, porque ele olha o buffer *antes* de
   escrever (o segundo encontra 7,2 KB, abaixo de 8 KB). O terceiro seria cortado no começo de
   uma assinatura.
2. **O ritmo de regime segurava o quadro grande**, a fila passava do limite e o portão pulava os
   quadros seguintes — justamente os da cena nova. Agora o ritmador **acelera para esvaziar a
   fila em ~150 ms**, até 4 × o bitrate, e só pula quadro quando nem assim a fila escoa em um
   quarto de segundo.
3. **A adaptação lia os pulos como rede ruim**, cortava o orçamento e encolhia a imagem, que só
   voltava depois de 10 s de folga — e a troca de cena seguinte cortava de novo. Agora o portão
   diz por que fechou (`fila` do ritmador ou `rede`, o canal que não escoa), e aperto exige mais
   de 10% dos quadros pulados em duas janelas seguidas.

O custo é o atraso de quem assiste subir enquanto a cena muda sem parar (até 85 ms trocando de
janela a cada 300 ms; ~130 ms numa cena totalmente nova a cada quadro, por 3 s) e voltar a
~8 ms na calma. O ritmo mais alto também chega mais depressa ao servidor: **quem assiste com
menos de ~4 × o bitrate de descida pode ver descarte no portão dele durante a rajada**, e o
registro do servidor é onde isso aparece. A camada de 360p é a saída para essa pessoa.

`npm run test:webcodecs:placa` é o teste que teria pegado: usa o Chrome instalado, o
**Automático**, e confere as seis combinações (720p/1080p/1440p × 30/60) saindo pela placa no
tamanho e na taxa pedidos, mais a troca de 1080p30 para 1440p60 ao vivo. Resultado nesta máquina:

| Pedido | Saiu | Por quadro na placa |
| --- | --- | --- |
| 720p30 / 720p60 | 1280×720, taxa declarada | 2,7 / 3,0 ms |
| 1080p30 / 1080p60 | 1920×1080, taxa declarada | 5,8 / 6,4 ms |
| 1440p30 | 2560×1440, taxa declarada | 10,1 ms |
| 1440p60 | 2560×1440, **taxa não declarada** | 10,2 ms |

Nenhum quadro pulado pelo codificador nem pela rede; os 47–54 de 60 medidos são o canvas
sintético do teste, que não entrega 60 exatos. Ele pula (e diz por quê) numa máquina sem o
Chrome, sem codificação de H.264 pela placa, ou com servidor anterior à 1.13.7.

### O que foi medido

Em loopback, na mesma máquina, com o Chromium do Playwright (software):

| Medida | Resultado |
| --- | --- |
| **0.2** — o servidor 1.13.6 aceita publicar e assinar faixa de dados? | Sim. Quadros de 1 KB, 50 KB e 200 KB chegam inteiros |
| **0.1** — quanto a faixa sustenta (loopback) | 2, 4, 8 e 16 Mbps a 30 quadros/s, sem perda; atraso p50 de 1 a 4 ms |
| Atraso de ponta a ponta (relógios acertados por ping/pong) | ~5 ms |
| **0.3** sintética — perda de pacotes simulada no receptor | 1%, 5% e 10%: palco parado de 0% a ~3% do tempo na maioria das execuções (uma execução a 5% deu 14%); quase todo buraco recuperado por reenvio, sem quadro-chave |
| `configure()` só para mudar o bitrate exige quadro-chave? | **Não**, no codificador de software do Chrome: 3 reconfigurações, 0 quadros-chave espontâneos. Na placa de vídeo, conferir no Diagnóstico ("reconfigurações só de bitrate … com chave espontânea") |
| Banda curta simulada (portão recusando metade) | 720p encolheu para 1024×576, quadros pedidos mantidos em 30 |

### O que falta medir — e é seu

| # | O quê | Como |
| --- | --- | --- |
| **0.4** | Quanto o jogo ganha: FPS e processador com 0, 1 e 3 espectadores, nos dois caminhos | O portão de valor do plano. Interruptor em "Só WebRTC" contra "Automática", mesma cena |
| **0.1** real | A faixa de dados pelo túnel e na LAN | O Diagnóstico mostra buffer, atraso e perda por camada |
| **0.3** real | Perda de verdade (4G ruim, Wi-Fi cheio) | E, sem rede ruim à mão, `transporte.telaWebCodecs.simularPerda(0.05)` no console de quem assiste |
| Placa de vídeo | ~~Que `prefer-hardware` sai mesmo na NVENC~~ — **medido**: as seis combinações saem pela placa no Chrome (`npm run test:webcodecs:placa`), e o Electron do aplicativo se comporta igual. Falta o mesmo numa placa AMD ou Intel | Diagnóstico → "Onde codifica: na placa de vídeo" |
| iPhone | Recebe pelo `canvas.captureStream()`, e a bateria | O teste que decide, na ordem do plano |
| Servidor | ~~Trocar para a 1.13.7~~ — **é o padrão** desde a primeira sala de verdade transmitindo por ela, com os hashes de Linux x64 e ARM64 conferidos no checksums.txt do release e na API do GitHub | `npm run build:sfu` — no Linux, falta rodar uma vez para ver o binário descer e abrir |
| Ritmador | ~~Que o portão do servidor deixou de descartar~~ — **sumiu** do registro seguinte. Falta conferir de novo com a aceleração nas trocas de cena | O registro do servidor numa rede de verdade, trocando de janela depressa, sem as linhas `data dropped due to high buffered amount` |

### Limites conhecidos

- **A codificação roda na thread principal da página.** Ler quadros e empacotar é barato, mas é
  a mesma thread da interface. Mover captura e codificação para um Worker é a otimização natural,
  com medição que a justifique.
- **O teto do plano continua sendo conferido pelo que o cliente declara.** O caminho novo usa o
  mesmo perfil já limitado pelo plano, mas um cliente modificado passaria dele como passaria no
  RTP (`plano-contas.md`).
- **"Forçar WebCodecs" na 1.13.6** continua exposto ao travamento em corridas raras (alguém começar a
  assistir no exato instante em que a transmissão sai do caminho novo). É diagnóstico, não padrão
  — e a 1.13.6 deixou de ser o padrão.
- **Nenhuma versão anterior à 1.13.x serve**: é nela que o servidor passou a ter faixas de dados.
- **A resolução nunca passa da fonte.** Com um monitor de 1080p, 1440p escolhido sobe em 1080p:
  esticar gastaria banda e codificação em pixels inventados, com a mesma nitidez. O painel de
  medição diz isso, e aponta a saída de verdade (monitor maior, ou DSR/VSR).
- **A camada de 360p pode cair no processador** mesmo com placa: as placas de consumo limitam as
  codificações simultâneas, e 360p a 15 quadros custa pouco.
