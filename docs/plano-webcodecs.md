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
| A placa pelo RTP, o caminho do Automático (ver "A placa pelo RTP") | `public/tela-placa-rtp.js` + `tela-placa-rtp-trabalhador.js` |
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

### Falhas que não são para sempre, e a captura presa em 30

Uma transmissão a 60 que caiu para 30 no meio e só voltou parando e compartilhando de novo tinha
dois caminhos para acontecer, e os dois foram fechados:

- **Uma falha do WebCodecs valia para a transmissão inteira.** O codificador que se perdeu numa
  troca de resolução, a placa ocupada por um instante: a tela ia para o WebRTC e ficava lá — e o
  WebRTC codificando 1080p60 no processador não entrega 60. Agora a falha agenda uma nova
  tentativa (`esperaAteTentarDeNovo`: 10 s, 30 s, 90 s, depois a cada 5 min; a contagem zera
  depois de 2 min no ar), e o motivo diz quando. Vale também para quem assiste: a falha ao
  decodificar, que tirava o aparelho do WebCodecs até recarregar, tenta de novo com a mesma
  espera.
- **A captura do Windows presa na GDI** (`docs/captura-de-tela.md`): depois de um erro permanente
  do DXGI, o Chrome captura pela GDI até o fim — 28 quadros medidos aqui. O caminho novo reconhece
  a assinatura pelo intervalo entre quadros (`capturaPresa`), mostra o fluxo "pedidos →
  capturados → codificados" na medição e avisa uma vez por captura, com o botão que captura de
  novo.

### O primeiro servidor de verdade: a VPS pequena

Até aqui, toda medição tinha o servidor de mídia na mesma máquina de quem transmite. O primeiro
teste numa VPS da Oracle (~25 ms de ida e volta) mostrou o que o loopback escondia: quem
assistia caía para 360p quase o tempo todo, a imagem travava, e às vezes congelava de vez. Pelo
WebRTC, na mesma VPS, nada disso.

Reproduzido daqui contra a VPS, com duas a quatro instâncias do Chrome (uma transmitindo uma tela
sintética pela placa, as outras assistindo no palco) e, para testar cada correção sem publicar
nada lá, os arquivos do cliente servidos daqui pelo Playwright (`page.route`).

**A causa de fundo é o processador do servidor.** A faixa de dados passa pelo SCTP do servidor
(pion), com confirmação, fila e temporizador por pacote e por espectador; o RTP é só repassado.
No servidor local, mesma carga (1440p60, três espectadores):

| | livekit-server |
| --- | --- |
| Faixa de dados (WebCodecs) | **28,6%** de um núcleo |
| RTP (WebRTC) | **5,5%** de um núcleo |

Mesmo descontando que o RTP mandou menos bits (o processador de quem transmitia não sustentou
1440p60 e ele desceu para 720p), são umas quatro vezes mais processador por megabit. Pedaços de 14
KB em vez de 7,2 KB baixam só 15–20% (menos mensagens, os mesmos bytes), e não foram adotados: o
piso de 8 KB do portão voltaria a cortar o primeiro quadro-chave de cada assinatura. Na VPS, uma
requisição trivial ao Node da mesma máquina levava 22 ms ociosa, 23–34 ms com a tela pelo RTP e
**40–90 ms, com picos de 291 ms**, pela faixa de dados — e o RTT de ICE subia de 20 para 70 ms.

**O que transformava um engasgo em colapso** era nosso, e foi corrigido:

1. **Tempestade de reenvio.** Cada buraco pedia reenvio, o reenvio ia para todos os espectadores
   e furava a fila, os quadros seguintes atrasavam e viravam buracos também: 80 quadros reenviados
   num segundo, 325 KB parados no ritmador, 600 ms de atraso. Agora o reenvio tem orçamento (um
   quarto do bitrate da camada por segundo), só de quadros com menos de 500 ms, e nada com a fila
   já passando de 150 ms.
2. **Um segundo ruim rebaixava por 20 s.** Mais de 8% de perda numa janela punha quem assiste em
   360p por 20 s — e a sala inteira ficava na camada leve com a rede já boa de novo. Agora são
   duas janelas seguidas, 8 s na primeira vez, dobrando se voltar a apertar logo depois (até
   32 s). A perda que corta o orçamento de quem transmite também passou a exigir duas janelas.
3. **A volta para a camada cheia pedia o quadro-chave da camada errada** (a de 360p), e a troca
   esperava o quadro-chave periódico da cheia: 15 s presos em 360p depois de o rebaixamento acabar.

**E o caminho novo passou a saber desistir** (`caminhoFalhando`, tela-decisoes.js). Quem
transmite confere o relato de cada espectador a cada segundo: janela *parada* quando saíram
quadros e nada chegou, *ruim* com atraso acima de 350 ms, perda acima de 10% depois do reenvio ou
a pessoa rebaixada pela conexão. Três janelas paradas de uma pessoa, ou quatro ruins em oito da
maioria, levam a tela ao RTP, com a espera de sempre até a nova tentativa. Uma pessoa só com a rede
ruim não troca o caminho da sala: ela desce sozinha para a camada leve.

**E a imagem congelada de vez tem saída.** Às vezes o servidor deixava de entregar a faixa a quem
assistia, às vezes junto com todas as mensagens, e não voltava — com dois espectadores, os dois no
mesmo segundo, o que aponta para o servidor sufocado, e não para a rede de cada um (a causa exata
fica dentro do SCTP do servidor; a simulação do portão, com a conta de bitrate da 1.13.7, se
recupera sozinha). Quem assiste sem pedaço nenhum por 2,5 s manda um ping a quem transmite; sem
resposta em mais 2,5 s, a tela volta pelo RTP. Tela parada é legítima (a captura só entrega
quadro quando algo muda), por isso a falta de pedaços só pergunta.

Contra a VPS, três espectadores a 1440p60, antes e depois:

| | Antes | Depois |
| --- | --- | --- |
| Camada de quem assiste | todos em 360p por 20 s ou mais | 1440p o tempo todo |
| Palco | 9–15 quadros por segundo nos colapsos | ~55 de 60 |
| Atraso | até 614 ms | ~50 ms |
| Reenvios | 80 num segundo | 10 em 75 s |
| Pior 100 ms da subida | 21–26 Mbps (tela de 6) | 16,7 no pico, 9,9 na mediana |

Num teste bem mais duro (tela inteira mudando a cada segundo, 150 s), a VPS engasgou uma vez: dois
espectadores caíram para 360p, o caminho novo desistiu em 5 s, a tela seguiu pelo RTP e voltou
sozinha ao WebCodecs 10 s depois, em 1440p até o fim.

**A subida de quem transmite** (a pergunta dos engasgos no Discord): em regime, o pior intervalo de
100 ms de cada segundo fica perto do RTP (mediana de 9,9 contra 9,3 Mbps, para 6 Mbps de tela). O
que passava de 20 Mbps eram as tempestades — quadros-chave e reenvios em série —, e com elas a
fila do roteador de casa, que é onde a voz de outro programa engasga. Sem tempestade, sem esse
pico.

`npm run test:webcodecs` prova as duas saídas: a faixa que para de chegar (o relato leva ao RTP) e
quem transmite travado (quem assiste pergunta, não tem resposta, vai ao RTP e volta depois).

### Teste de carga: quanto cada máquina aguenta (28/09/2026)

Depois da VPS, a pergunta passou a ser de capacidade. Medido no Ryzen 5 5600X, com os clientes
entrando pelo endereço público (Caddy + sslip.io). Quem transmite: tela sintética em 1440p60 pela
NVENC, a 6 Mbps. Quem assiste: um espectador de verdade por sala, e o resto "leves" — a página
inteira do Nexo com o `VideoDecoder` trocado por um falso, o que para o servidor não muda nada. Para
imitar uma VPS pequena, o servidor de mídia ficou preso a um fio lógico, com prioridade alta e
`GOMAXPROCS=1`; o que se mediu foi o processador desse processo.

| Espectadores em 1440p60 | WebCodecs: p95 do fio | WebRTC: p95 do fio |
| --- | --- | --- |
| 6 | 24% | — |
| 10–11 | 41% | 15% |
| 18 | 70% (a folga segura) | — |
| 22 | 86%, ainda limpo (atraso p95 38 ms) | — |
| 26 | **quebra**: atraso p95 584 ms, metade na camada leve, a tela vai ao RTP | — |

Na margem, 0,59% de um fio por Mbps pela faixa de dados e 0,11% pelo RTP: **~5×**. (O RTP desceu
para 720p–960p: o Chrome codifica a tela no processador de quem transmite e não sustenta 1440p60.)
Outras medidas do mesmo servidor:

- **Várias salas**: 18 espectadores numa sala custaram 26% de um fio; os mesmos 18 em três salas,
  38%. Cada transmissão a mais sai por ~6% de um fio.
- **Voz**: 11 microfones abertos ao mesmo tempo, ~10%.
- **Solto nos 12 fios**, o mesmo trabalho custa o dobro de processador por Mbps (espalhar goroutines
  por núcleos que o resto da máquina usa); `GOMAXPROCS=4` só tira 10–17% disso.
- **`GOGC=400`**: −10% de processador, memória de 165 para 345 MB. Virou o padrão do `sfu.js`, com
  `GOMEMLIMIT` de um quarto da memória da máquina.
- Node do Nexo e Caddy: no máximo 2% e 1% de um fio. Não são gargalo.

Convertendo por Geekbench 6 (pontos de vários núcleos ÷ 771 por fio do Ryzen × 0,6, fator
calibrado para dar os 2–3 espectadores que a Micro de fato aguentou): Ampere de 2 OCPU ~25
espectadores em 1440p60 pelo WebCodecs; uma VPS de 2 vCPU EPYC recente (Hostinger KVM 2) ~50.

**A thread principal**, com a fonte fora da página (a câmera falsa do Chrome em 1080p60, como uma
captura de tela de verdade) e a medida sem depender dela: com as páginas livres, o desvio entre
quadros no palco foi de 4,6 ms no WebCodecs e 6,2 ms no RTP. Com a página ocupada 40% do tempo, em
quem assiste ou em quem transmite, o WebCodecs foi a 17,6–17,9 ms, com 6–9 buracos acima de 50 ms
por segundo; o RTP não mudou. Todo o caminho da tela passa pela thread da página; no RTP, nada passa.

**E a saída que muda a conta**: codificar pelo WebCodecs e transportar pelo RTP. Numa sonda (duas
conexões na mesma página, sem servidor), uma encoded transform trocou o conteúdo de cada quadro de
uma faixa de vídeo comum pelo quadro da NVENC em 2560×1440; o codificador do WebRTC só trabalhou
numa cópia de 320×180 (`scaleResolutionDownBy: 8`), e o outro lado decodificou a 44–56 fps num
`<video>` comum. O servidor pagaria o preço do RTP, e quem assiste decodificaria fora da página.

### A placa pelo RTP: o caminho do Automático (28/09/2026)

A sonda virou o caminho padrão. No **Automático**, com placa de vídeo e navegador que troca o
conteúdo dos quadros do RTP (Chrome, Edge, o aplicativo), a tela é codificada pela placa e sai
por uma publicação RTP comum. O **Forçar WebCodecs** continua levando à faixa de dados. Quem
assiste não precisa de nada: recebe RTP, em qualquer navegador, e decodifica fora da página.

| Peça | Arquivo |
| --- | --- |
| Decisões puras: usar ou não, miniaturas, casamento com a captura, troca de cena, orçamento | `public/tela-decisoes.js` |
| O controlador na página: codificadores, embrulho do `addTransceiver`, estatísticas, falha | `public/tela-placa-rtp.js` |
| O Worker: lê a captura, codifica na placa e é a `RTCRtpScriptTransform` do remetente | `public/tela-placa-rtp-trabalhador.js` |
| Onde a escolha é feita e a publicação é armada | `aplicarPublicacao` em `public/sala.js` |

**Como funciona.** A tela é publicada como sempre (H.264, simulcast `q` e `h`), mas com
miniaturas: a camada cheia a 1/8 do tamanho, a leve a 1/32. O codificador do WebRTC trabalha só
nelas, e é o quadro **dele** que o RTP empacota, com o carimbo, o número e os pedidos de
quadro-chave dele. Uma encoded transform, no Worker, troca o conteúdo de cada quadro pelo quadro
que a placa codificou a partir da captura cheia. O servidor de mídia vê RTP comum.

O que precisou ser descoberto no caminho:

- **A transform tem de nascer com o transceptor.** Posta depois que o envio começou, o Chrome a
  ignora (104 quadros enviados, 0 trocados). Ela é armada embrulhando
  `RTCPeerConnection.prototype.addTransceiver` para a faixa da tela.
- **Os metadados do quadro não trazem o rid nem a hora da captura.** A camada vem do SSRC (pelas
  estatísticas `outbound-rtp`, a cada 250 ms) e, antes disso, pela largura da miniatura. O quadro
  da captura é escolhido pela ordem, com o carimbo do RTP só desempatando vizinhos, e cada SSRC
  começa o carimbo dele num valor sorteado.
- **Quadro-chave só a pedido.** O OpenH264 das miniaturas faz quadro-chave sozinho a cada troca
  de cena; seguir esses quadros produzia chaves demais. A placa faz chave quando chega um PLI ou
  FIR (as estatísticas de envio) e quando a cena muda (o WebRTC decidiu fazer chave, ou a
  miniatura cresceu mais de 4× a média). Na troca de cena, porque o quadro comum da placa sai
  **maior** que a chave da mesma cena (~300 KB contra ~120 KB em 1440p) e levava ~160 ms para
  sair. Pular quadros depois do grande piorou (o CBR acumula orçamento), bitrate `variable`
  estourou (10–14 Mbps pedidos 6) e detectar cena por pixels no Worker custava ~10 ms por quadro.
- **O orçamento segue o controle de congestionamento do WebRTC** (`targetBitrate` de cada
  camada), com 15% de folga e no mínimo 1 s entre reconfigurações.
- **Só se codifica o que o WebRTC vai mandar**: a camada pausada pelo servidor não custa nada à
  placa, e a cadeia de referências nunca tem um buraco.
- **A publicação só é dada por concluída depois do primeiro quadro trocado.** O servidor só cria a
  faixa quando a mídia chega; trocar de qualidade nesse intervalo deixava uma publicação pendente
  sem mídia, e a seguinte, com o mesmo id de faixa, ficava na fila atrás dela para sempre (a tela
  sumia). Por isso os codificadores também aquecem antes de publicar: a placa abrindo a sessão
  atrasava o primeiro quadro.
- **Falhou, volta ao WebRTC** sem republicar: a transform passa os quadros do próprio WebRTC
  adiante, as escalas originais voltam, e a placa é tentada de novo com a espera de sempre
  (`esperaAteTentarDeNovo`).

**A captura tem poucos buffers.** A primeira versão guardava no Worker os últimos 20 quadros da
captura, para casar com os do WebRTC. Com o canvas dos testes, tudo passava. Com a câmera falsa
do Chrome, e com a captura de uma aba, chegavam 3 quadros ao Worker e mais nenhum; o WebRTC
seguia recebendo os dele. Uma cópia nova da faixa, lida na página, também não recebia nada, e
liberar os 3 quadros guardados fazia chegar exatamente mais 3. A captura entrega à página quadros
de um conjunto pequeno de buffers, e cada quadro guardado é um buffer a menos. Agora o Worker
guarda **só o mais novo**; quando o quadro do WebRTC chega antes do da captura, espera até 12 ms
por ele; e, sem imagem nova, o quadro do WebRTC leva a última imagem de novo, em vez de ser
descartado — ele podia ser justamente o quadro-chave que alguém pediu, e com a tela parada não
viria outro tão cedo.

Essa repetição, sozinha, esconderia a captura travada: guardando 20 quadros de novo, quem
assistia recebia 57 quadros por segundo **da mesma imagem**. Então três segundos seguidos sem
captura, com o WebRTC produzindo quadros em ritmo de vídeo (numa tela parada de verdade os dois
param juntos), levam a tela de volta ao WebRTC: "a captura parou de chegar à placa". Conferido
com o defeito de volta: em 3 s a tela saiu da placa, e quem assistia passou a receber 1080p
vivo. `npm run test:webcodecs:placa` agora transmite também pela câmera falsa (conferindo os
quadros que **chegam da captura**, e não só os que saem) e por uma aba parada capturada de
verdade, com alguém chegando depois — e falha com 20 quadros guardados.

**O servidor**, medido como no teste de carga (um fio do Ryzen, `GOMAXPROCS=1`, `GOGC=400`),
1440p60 pela placa:

| Espectadores | Placa pelo RTP: média (p95) do fio | Entregue |
| --- | --- | --- |
| 4 | 6,5% (11,9%) | 23,5 Mbps |
| 7 | 8,2% (13,3%) | 41,4 Mbps |
| 11 | 14,1% (21,2%) | 65,7 Mbps |
| 15 | 19,2% (27,1%) | 91,3 Mbps |

Pela faixa de dados, 10 espectadores com a mesma tela custaram 29,7% (p95 40,6%). Na margem,
0,19% de um fio por Mbps contra 0,50–0,59%: **de 2,5 a 3 vezes menos processador no servidor**.
Pela inclinação do p95, um fio chegaria aos 70% de folga perto de 45 espectadores em 1440p60,
contra 18 pela faixa de dados; acima de 15 não foi medido, porque quem assiste é que não
aguentou (abaixo). Onde a faixa de dados dava 2–3 espectadores (a Micro), a conta dá 5–7 — e a
Micro também é limitada a 50 Mbps de rede, ~7 espectadores de 6 Mbps.

Com 11 ou mais espectadores, os quadros de quem assiste caíram (26 fps, ~45 congelamentos por
minuto) com o servidor folgado em 14%. É a máquina do teste: todos os espectadores decodificam
de verdade na mesma placa de vídeo, e o `nvidia-smi` mostrou o decodificador em 90–100%. Numa
sala de verdade, cada pessoa decodifica na própria máquina.

**A thread da página.** O mesmo teste da thread principal (câmera falsa em 1080p60, página
ocupada 40% do tempo), agora nos três caminhos:

| Desvio entre quadros no palco | Livre | Quem assiste ocupado | Quem transmite ocupado |
| --- | --- | --- | --- |
| WebRTC puro | 6,4 ms | 6,7 ms | 7,3 ms, sem congelamento |
| Faixa de dados | 6,1 ms | 17,4 ms, 86 buracos > 50 ms | 17,6 ms, 85 buracos > 50 ms |
| Placa pelo RTP | 7,3 ms | 6,5 ms | 6,3 ms, sem congelamento |

Nada do caminho novo passa pela thread da página: a captura, a placa e a transform ficam no
Worker, e quem assiste decodifica no `<video>`.

**Quem transmite.** O Chrome inteiro de quem transmite (todos os processos), com a mesma tela
sintética em 1440p60 e uma pessoa assistindo:

| Caminho | Processador | O que chega a quem assiste |
| --- | --- | --- |
| Placa pelo RTP | 122% de um fio (10,1% da máquina) | 2560×1440, 57 fps |
| Faixa de dados | 113% de um fio (9,4%) | 2560×1440, 56 fps |
| WebRTC puro | 81% de um fio (6,8%) | **1706×960**, 56 fps |

A tela sintética é desenhada na própria página e pesa em todos. O caminho novo custa ~9 pontos
de um fio a mais que a faixa de dados — o WebRTC ainda lê a captura e codifica as miniaturas —, e
o WebRTC puro só gasta menos porque desistiu do tamanho: codificando no processador, não sustenta
1440p60.

### Na Micro de verdade (29/09/2026)

A placa pelo RTP publicada na Micro da Oracle (1/8 de OCPU com rajada, 2 vCPUs, 1 GB). Clientes
daqui (Chrome instalado, tela sintética pela NVENC, quem assiste decodificando de verdade), e o
servidor lido pela SSH a cada segundo, só leitura: o processador do `livekit-server`, o *steal*
(o tempo que o hipervisor segura a máquina, que é só uma fração de núcleo) e os bytes da placa
de rede.

| 1440p60, 6 Mbps | livekit-server: média (p95) de um núcleo | Steal | Saída da VPS | Quem assiste |
| --- | --- | --- | --- | --- |
| Placa pelo RTP, 1 espectador | 9% (12%) | 4,6% | 6,3 Mbps | 1440p, 56 fps |
| Placa pelo RTP, 3 | 17% (24%) | 7,7% | 19 Mbps | 1440p, 56 fps |
| Placa pelo RTP, 5 | 25% (43%) | 13,5% | 32 Mbps | 1440p, 56 fps |
| Placa pelo RTP, 7 | 35% (62%) | 21,8% | 44 Mbps | 1440p, 54 fps (pior 5%: 32) |
| Faixa de dados, 1 | 23% (32%) | 11% | 7 Mbps | 55 fps, atraso p95 164 ms |
| Faixa de dados, 3 | 52% (70%) | 34% | 21 Mbps | 46 fps (pior 5%: 12), 1.743 reenvios |
| Faixa de dados, 5 | 63% (90%) | 40% | 23 Mbps | **colapso**: 31 fps, pior 5% a 1 |

Em 1080p30 a 4 Mbps, para passar do teto de banda: 4 espectadores, 13%; 8, 22%; 12, 39% com a
saída em 52 Mbps; com 16 a saída **caiu** para 44 Mbps e quem assistia desceu a 23 fps. O teto da
Micro é a banda de saída, uns 50 Mbps sustentados (picos de 75), junto com o *steal*, que sobe com
a carga. E ela aguenta o tempo: dez minutos seguidos com 5 espectadores em 1440p60 ficaram em
23,5–26,8% de um núcleo, *steal* de 12–14% e 56–57 fps do primeiro ao último minuto.

**Na Micro, a placa pelo RTP aguenta ~7 espectadores em 1440p60, ou ~12 em 1080p30; pela faixa
de dados eram 2 ou 3.** Com 7 espectadores, o servidor gasta menos do que a faixa de dados gastava
com 3.

### Anunciada sem vídeo: o que um amigo viu na VPS

Um amigo compartilhou a tela: o Nexo mostrava que ele estava compartilhando, o som da tela
chegava, e ninguém via imagem. Com os outros, e com a mesma VPS, tudo funcionava. O registro do
servidor tinha o rastro do mesmo sintoma noutro momento: `supervisor error on publication ...
publish time out` -- a faixa anunciada e nenhum pacote de vídeo chegando em 30 s.

O som da tela prova que a rede dele (com CGNAT) entregava mídia ao servidor: o PCM do agente vira
uma faixa WebRTC comum na página de quem transmite, pela mesma conexão do vídeo. O defeito era do
vídeo, e o caminho novo tinha três jeitos de produzi-lo sem que nada acusasse:

1. **A transform engolindo tudo.** Se a captura não chega ao Worker (ou a placa não devolve os
   quadros), cada quadro do WebRTC é descartado. `anexar` esperava o primeiro quadro por 3 s e
   seguia em frente assim mesmo, e o vigia da captura parada só olhava a captura que parou
   *depois* de ter chegado. Agora `saidaDaCamada` confere, nas estatísticas do próprio remetente,
   se o WebRTC está codificando e nenhum byte sai; em 3 s a tela volta ao WebRTC. Vale para
   qualquer motivo, até o Worker travado, porque a conta é feita fora dele. Reproduzido com
   `telaPelaPlaca.simularFalha('captura')` antes de compartilhar: em 3 s, "a captura não chega à
   placa", quem assiste recebe 1080p pelo WebRTC, e a nova tentativa volta à placa sozinha.
2. **Quadro-chave sem SPS e PPS.** A NVENC manda os dois em toda chave, mas nada garante isso em
   outro codificador de placa, e o primeiro quadro-chave -- o do aquecimento -- é jogado fora. Sem
   eles, quem assiste recebe bytes e nunca forma imagem, e do lado de quem transmite tudo parece
   normal. O Worker guarda os últimos e completa a chave que vier sem eles
   (`parametrosDoH264`); o Diagnóstico conta quantas foram completadas.
3. **A placa não cabe na subida.** O WebRTC calcula os limites de cada camada pelo tamanho que
   ele codifica -- a miniatura -- e por isso nunca desliga nem encolhe a camada cheia por falta de
   banda. Com a subida limitada por `b=AS` (sem perda):

   | Subida | WebRTC destina à cheia | A placa mandava | Quem assistia | WebRTC puro, mesma subida |
   | --- | --- | --- | --- | --- |
   | 400 kbps | 60–100 kbps | 500–650 kbps | 1440p, 0–19 fps, 9 congelamentos em 25 s | 360p, 15 fps, liso |
   | 1,5 Mbps | ~440 kbps | 1,2–1,7 Mbps | 1440p, até 240 ms de atraso | 960p–1152p, 30 fps |
   | 8 Mbps | ~5 Mbps | 3–4 Mbps | 1440p, 56 fps | — |

   Com perda de verdade -- a operadora que policia UDP, o upload fraco --, esse excesso vira
   tempestade de quadros-chave, e pode não sobrar imagem nenhuma. Agora `placaNaoCabe` compara o
   que cada camada manda com o que o WebRTC destina a ela: 5 s seguidos acima de 1,5 vez (e 200
   kbps a mais), passados os primeiros 5 s da transmissão, e a tela volta ao WebRTC, que sabe
   descer. A nova tentativa só acontece com banda medida para metade do que a camada cheia pediu
   (`subidaComportaAPlaca`) -- às cegas, a tela ia e voltava com a imagem ruim a cada tentativa.

Qual dos três pegou o amigo não dá para saber daqui: o registro de cada pessoa fica no navegador
dela (Diagnóstico → copiar), e as linhas de INFO do servidor, que diriam o que chegou dele, ficam
escondidas por padrão (`NEXO_LOG_SFU`). O que o sintoma descarta: ICE e CGNAT em si (o som passou
pela mesma conexão).

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
| Placa pelo RTP | ~~Numa VPS de verdade~~ — **medido na Micro** ("Na Micro de verdade"). Falta: um jogo de verdade (congelamentos nas trocas de cena, o quadro grande da placa), uma placa AMD ou Intel (os parâmetros do H.264 completados?) e uma subida fraca **com perda** | Diagnóstico → "Tela pela placa, pelo RTP": "chaves completadas com SPS/PPS" acima de zero é o codificador que não manda os parâmetros; "imagem repetida" alta com a tela mexendo é captura que não chega ao Worker; "a placa não cabe na subida" é a rede de quem transmite |

### Limites conhecidos

- **A faixa de dados custa ao servidor umas cinco vezes o processador do RTP.** Desde a placa
  pelo RTP, isso vale só para o "Forçar WebCodecs" e para quem não tem o caminho novo. Na Micro
  da Oracle, dois ou três espectadores na camada cheia pela faixa de dados já deixam o servidor no
  limite (ver "O primeiro servidor de verdade" e "Teste de carga"); pelo RTP, a conta dá umas 2,5
  vezes mais. Para salas cheias, dê processador ao servidor: na Oracle, a Ampere (2 OCPU no
  grátis, `docs/oracle.md`), e não a Micro.
- **Pela faixa de dados, a codificação roda na thread principal da página**, e com a página
  ocupada a imagem ganha buracos (ver "A placa pelo RTP", a thread da página). A placa pelo RTP
  roda inteira num Worker.
- **A placa pelo RTP só existe onde há `RTCRtpScriptTransform`, `MediaStreamTrackProcessor` e
  fluxos transferíveis**: Chrome, Edge e o aplicativo. Em outro navegador, o Automático fica no
  WebRTC. Quem assiste, por ser RTP, pode estar em qualquer um.
- **Quem transmite pela placa pelo RTP gasta um pouco mais que pela faixa de dados** (~9 pontos de
  um fio, na medição): o WebRTC continua lendo a captura cheia para fazer as miniaturas.
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
