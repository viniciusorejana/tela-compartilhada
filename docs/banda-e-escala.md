# Banda de saída: o que custa, e o que fazer quando crescer

Branch: `nexo-sfu`. Revisão de mídia: `sfu-1`.

## Por que este documento existe

O servidor de mídia resolveu o problema de **chegar** (ver [servidor-de-midia.md](servidor-de-midia.md)).
Ele criou outro, que só aparece quando a sala enche: quem hospeda paga a banda de todo mundo.

Enquanto a sala era uma malha, o custo era distribuído — mal distribuído, e era esse o defeito,
mas distribuído. Com o SFU o custo é de um só, e cresce de um jeito que não é óbvio: **ao
quadrado do tamanho da sala.** Numa sala de N pessoas todas publicando, saem N×(N−1) fluxos
daqui.

Uma consequência prática que só se descobre tarde: **a banda satura muito antes da CPU.** O
LiveKit não transcodifica, só encaminha — um servidor de quatro núcleos aguenta muito mais sala
do que a porta de rede permite. Dimensionar isto é aritmética de banda; CPU e memória são ruído
no orçamento.

## A aritmética

Sala de 15, todas as câmeras ligadas, uma tela aberta e assistida por 14. Antes das mudanças
de setembro/2026, com o perfil alto a 8 Mbps:

| fonte | conta | saída |
|---|---|---|
| tela | 14 espectadores × 8 Mbps | 112 Mbps |
| câmeras | 15 × 14 × 450 kbps | 94 Mbps |
| voz | 15 × 14 × ~50 kbps | 10 Mbps |
| | | **~217 Mbps** |

Aos 20, são ~342 Mbps — **uma porta de 1 Gbps comporta três salas.**

Repare na assimetria, que é a chave de tudo: **a tela cresce linearmente** (uma fonte × N
espectadores) e **a câmera cresce quadraticamente** (N fontes × N espectadores). Até umas oito
pessoas a tela domina a conta. Acima de dez, a câmera passa a ser o problema irredutível, e
nenhum ajuste de bitrate de tela conserta isso.

## O que já foi feito

**Só o palco recebe a camada cheia** (`camadaDesejada`, em `room-transport.js`). A tela seguia
uma regra própria: bastava ser pedida para descer no bitrate de captura inteiro, em qualquer
tamanho. No modo múltiplo, três telas em cards de algumas centenas de pixels custavam 24 Mbps.
Agora tela e câmera seguem a mesma regra, e como assistir sempre pina (`assistirTela`, em
`sala.js`), quem pede uma tela para ver grande recebe o que recebia antes.

**Os tetos de qualidade caíram pela metade** (`quality-utils.js`): 720p de 4 para 2 Mbps, 1080p
de 8 para 4, 1440p de 14 para 6. Os antigos eram números de gravação local, não de transmissão —
Discord e Meet entregam a mesma tarefa na faixa nova. O teto é orçamento, não meta: o
codificador gasta o que receber, e cada Mbps a mais é multiplicado pelo tamanho da sala.

**Três tamanhos, duas camadas na tela** (`camadaDesejada`). O palco recebe a camada cheia;
a grade e a plateia recebem a baixa. Mandar 640×360 para um quadradinho de duzentos pixels
era pagar três vezes pelo que ninguém consegue ver.

A tela já teve três camadas, e a do meio saiu. Ela era paga em processador por quem
compartilha: numa captura de 1920×810 a 30 quadros, a de cima custa 47 Mpx/s, a do meio 21
e a de baixa 2,6 — a do meio sozinha é 30% do trabalho, treze vezes o degrau barato. Sem
placa de vídeo que codifique H.264, isso sai do processador de quem transmite, e quando ele
não dá conta o codificador engasga. O sintoma é imagem congelando com **zero** perda de
pacote, **zero** quadro descartado e nada no log da rede: os quadros não se perderam, eles
não chegaram a existir. É o mesmo raciocínio que já tinha tirado a terceira camada da câmera
no celular. O degrau barato ficou: é ele que segura quem está com a rede ruim.

Em multi-view a tela dos outros passa a vir no degrau de baixo. Troca deliberada —
multi-view é para acompanhar de canto de olho; quem quer ler põe no palco.

**Teto de câmeras por atividade de voz** (`escolherCameras`). A câmera é a única fonte que
cresce ao quadrado: numa sala de vinte são 380 fluxos. No máximo seis descem ao mesmo tempo,
pelo critério do Discord — quem falou por último aparece, o resto vira avatar até abrir a boca.
Quem está no palco ou na grade entra de graça, porque foi escolha explícita de quem assiste.

**Aba escondida para de receber vídeo** (`definirAbaVisivel`). Depois de meio minuto em segundo
plano, só o som continua. A espera existe porque trocar de janela é corriqueiro, e sem ela um
alt+tab de cinco segundos custaria duas renegociações.

**Uma fonte, um lugar** (`estaEmDestaque`, em `sala.js`). O que está no palco ou na grade não
aparece de novo na plateia. Não economiza banda — é a mesma faixa pintada duas vezes —, mas
poupa composição no aparelho de quem assiste e tira a cópia do caminho do olho.

**O teto de bitrate acompanha o codec** (`tetoParaOCodec`). Ver a seção sobre codec.

**A sala passou a se medir** (`medicao.js`, `public/room-transport.js`, `scripts/relatorio-de-banda.cjs`).
Ver "Como medir", abaixo.

**O IP interno só é anunciado a quem pode alcançá-lo** (`escreverConfig`, em `sfu.js`). Ver a
seção sobre hospedagem.

### Uma armadilha que essas mudanças criaram

Assinatura e destaque agora se influenciam: trocar o palco pode liberar ou ocupar uma vaga de
câmera. Mas assinar dispara evento de faixa, que recalcula estado, que reavalia o destaque, que
volta a mexer no palco — um laço em que a sala persegue o próprio rastro antes de assentar.

Por isso `definirExibicao` aplica a CAMADA na hora (um pedido ao servidor, sem evento de volta)
e apenas AGENDA a reavaliação de assinaturas. Quem mexer nesse caminho precisa manter a
separação: mudança de layout não pode assinar faixa de forma síncrona.

## O teto virou conta, e a conta usa os pixels que existem

Os tetos por perfil eram três números escritos à mão, e o mesmo número servia para 30 e para
60 quadros. Isso cobrava dois preços diferentes pelo mesmo erro.

A 60 quadros em 1080p, os 4 Mbps cobriam o dobro dos quadros: **0,032 bit por pixel contra
0,064 a 30 quadros**. Metade do orçamento por pixel — e cena em movimento é exatamente onde
faltar bit aparece. Quem pedia 60 quadros para jogar recebia menos bits na cena que mais
precisava deles. Do outro lado, uma captura ultrawide de 1920×810 recebia o orçamento
inteiro de 1080p, pagando por 25% de pixels que não existem — multiplicado por espectador.

Agora o teto sai de `RoomQuality.tetoDeEnvio`, em `quality-utils.js`, a partir dos pixels que
a captura está **realmente** entregando (`getSettings`, limitado pelo perfil) e da taxa
escolhida:

| captura | antes | agora |
|---|---|---|
| 1080p a 30 | 4,00 Mbps | 3,98 Mbps |
| 1080p a 60 | 4,00 Mbps | 5,63 Mbps |
| 1440p a 30 | 6,00 Mbps | 6,00 Mbps (no teto) |
| 720p a 30 | 2,00 Mbps | 1,77 Mbps |
| 1920×810 a 30 | 4,00 Mbps | 2,99 Mbps |
| janela 1280×720 no perfil 1440p | 6,00 Mbps | 1,77 Mbps |

O caso central — 1080p a 30 — não mudou de propósito: é o que já foi visto funcionando em
sala. O que se corrigiu foram as outras combinações. A última linha é a maior economia e a
mais silenciosa: escolher o perfil máximo e compartilhar uma janela pequena custava o teto
inteiro.

Dobrar os quadros **não** dobra o custo, e tratar como se dobrasse seria o erro em sentido
contrário: quadros vizinhos se parecem, e é dessa semelhança que a compressão vive. A conta
usa meia potência — 60 quadros custam cerca de 1,4 vez o que custam 30. O teto absoluto de
6 Mbps não é limite de qualidade, é limite de conta.

Em 1440p esse teto reaparece como o problema antigo, agora por um motivo legítimo: 30 e 60
quadros batem os dois em 6 Mbps, então ali 60 quadros não ganham banda, **dividem a mesma** —
mais movimento, menos definição por quadro. A diferença em relação a antes é que a interface
diz isso, em vez de deixar a pessoa escolher "mais" acreditando que é melhor. Para 60 quadros
com imagem cheia, 1080p entrega mais que 1440p.

## O "Automático" era a pior opção, e era o padrão

Medido em 16/09/2026, mesmo jogo (PEAK), 720p com 60 quadros pedidos, variando **só** a
prioridade:

| prioridade | `contentHint` | ms/quadro | quadros entregues |
|---|---|---:|---:|
| Automático | *(vazio)* | 21,8 | **16** |
| Fluidez | `motion` | 6,6 | **57** |

Três vezes o custo por quadro, e um terço dos quadros. A causa é que o "Automático" não
decidia nada: a única diferença dele para "Fluidez" era deixar o `contentHint` **vazio**, e a
preferência de degradação era idêntica (`maintain-framerate` nos dois). Com o hint vazio, a
especificação de Content Hints manda o navegador favorecer detalhe e resolução em faixas de
captura de tela — ou seja, o modo que se anunciava como automático configurava o codificador
em modo texto para quem estava compartilhando jogo.

Ele saiu. Sobraram duas prioridades, que são escolhas de verdade porque pedem coisas opostas,
e o padrão passou a ser **Movimento**: travar estraga uma transmissão, e nitidez de texto
parado é uma preferência. Quem tinha "automatico" salvo herda o padrão novo.

A lição de teste: nenhuma verificação que olhasse só `degradationPreference` notaria a
diferença, porque ela era idêntica. O teste agora afirma a **pista**, e afirma que
`automatico` não voltou à lista de opções.

## Compartilhar uma janela custa quase metade dos quadros

Mesma sessão, mesma resolução e mesma prioridade (`motion`), variando só o que é capturado:

| captura | quadros capturados | quadros entregues |
|---|---:|---:|
| Janela do jogo | 44 | **30–32** |
| Tela inteira | 57 | **57** |

O Windows precisa desenhar a janela de novo só para a captura — é da mesma API que vem a
tarja amarela em volta — enquanto a tela inteira lê o quadro que a placa de vídeo já compôs.
**Não há como corrigir isso pela página:** o custo é do caminho de captura do sistema, e a
página não escolhe entre as implementações. O que cabe é dizer o número e deixar a tela
inteira a um clique, que é o que o aviso em `atualizarAvisoDeCaptura` faz.

No aplicativo isso não custa privacidade de áudio: o agente exclui a árvore do navegador do
som capturado, então a tela inteira sai sem eco igual à janela.

## Resolução e taxa de quadros são escolhas separadas

Elas eram uma só, escondida dentro do seletor de prioridade: `fluidez`
significava 60 quadros, e as outras duas prioridades 30. Isso tirava combinações legítimas
das pessoas — 1440p a 30 com os quadros protegidos, ou 60 quadros em texto com a resolução
cedendo primeiro, nenhuma das duas era possível — e fazia a interface mentir, porque o
rótulo "· 30 fps" era fixo no HTML e passava a ser falso no instante em que alguém escolhia
fluidez.

Hoje o painel tem três perguntas independentes: **resolução** (720p/1080p/1440p), **quadros
por segundo** (30/60) e **o que cede quando aperta** (automático/nitidez/fluidez, que agora
governa só `contentHint` e `degradationPreference`). As seis combinações existem.

Nenhum rótulo é escrito à mão: cada opção de resolução mostra o teto que ela custaria agora,
com esta fonte, esta taxa e este codec. Os que eram fixos prometiam "até 2 / 4 / 6 Mbps" e
deixaram de ser verdade no minuto em que o orçamento passou a acompanhar a captura.

Quem já tinha "Fluidez máxima" salvo herda 60 quadros na primeira carga (`nexoFps` ausente e
`nexoPrioridade` igual a `fluidez`). Sem essa linha, a separação teria tirado metade dos
quadros de quem usava o Nexo para jogar, em silêncio.

**O desconto por codec deixou de tocar o degrau barato.** `ORCAMENTO_POR_CODEC` (0,7 em VP9,
0,6 em AV1) incidia na escada inteira, e os 300 kbps do degrau de 360p viravam 180 em AV1.
Aquele degrau não é uma fração da captura: ele é o piso de rede, escolhido por caber em
quase qualquer lugar, e é o único que segura na sala quem está com a conexão ruim. Descontar
40% dele poupava 120 kbps num envio de megabits e enfraquecia a única garantia que não pode
falhar. O topo continua acompanhando o codec.

## VP9 e AV1 sobem quebrados com o servidor 1.13.6

Medido na auditoria de 15/09/2026: pedindo a tela no palco, **VP9 e AV1 entregavam 360p a
14 quadros** onde H.264 e VP8 entregavam 1080p a 30, com três congelamentos em oito segundos.
A causa não é o codec.

O cliente do servidor de mídia decide em duas etapas que discordam entre si. Ele avisa o
servidor primeiro — "recebe UMA faixa com as resoluções dentro" — e só depois injeta `L1T3`
nas opções de publicação; o cálculo dos fluxos, que roda por último, já vê o `L1T3` e monta
DUAS faixas independentes, de 360p e 1080p. O servidor então trata a faixa pequena como se
ela trouxesse a imagem inteira. Nos dados brutos da auditoria isso aparece cru: a camada de
1080p ficou em **0,25 quadro por segundo** — um quadro a cada quatro segundos — enquanto a de
360p gastava 718 kbps com um teto de 126.

A correção é declarar `scalabilityMode: 'L1T3'` desde o pedido (`ESCADA_SVC`, em `sala.js`),
e ela não depende de atualizar nada. As duas etapas passam a concordar:

- **Com a 1.13.6**, o cliente desliga o simulcast e sobe uma faixa SVC só: imagem inteira no
  palco, **sem** o degrau barato de 360p. A sala avisa quem escolheu (`AVISO_SEM_DEGRAU_BARATO`),
  e o aviso vem de medição — quantas camadas o navegador criou de fato — e não da versão que o
  servidor anuncia. Todo Safari e todo navegador no iOS sobem em camada única de qualquer
  maneira, com qualquer versão do outro lado.
- **Com a 1.13.7**, sobem as duas faixas de verdade e o degrau volta.

Por isso H.264 continua sendo o automático, e por isso a 1.13.7 está declarada mas não é o
padrão: `NEXO_LIVEKIT=1.13.7` a seleciona, com hash conferido, para quem for validar. O que
falta não é código — é ligar uma sala com gente de verdade e conferir que o degrau de 360p
aparece e não congela.

Uma advertência sobre a tabela de codecs daquela auditoria: **ela comparou orçamentos
diferentes.** H.264 e VP8 foram medidos com o teto cheio, e VP9 e AV1 presos em 60% de um
orçamento que já era menor — 1,68 e 1,44 Mbps contra 4. A causa era o fator de qualidade de
rede estar guardado numa variável única da página em vez de por remetente, o que também
deixava o codec de reserva sem ajuste nenhum. Corrigido; a comparação precisa ser refeita.

## "Por que o FPS cai depois de vários minutos?"

Essa pergunta tinha duas respostas possíveis e opostas, e o Nexo não media o suficiente para
escolher entre elas. Agora mede.

Quando os quadros caem, ou **a captura parou de entregar** — jogo em tela cheia exclusiva,
troca de modo do compositor do Windows, janela minimizada — ou **o codificador não
acompanha**. As duas aparecem como o mesmo número caindo se você olha só o lado do
codificador, que era tudo o que o painel mostrava. E elas pedem coisas opostas: na primeira,
mexer em resolução, taxa ou codec não resolve nada, porque não existe quadro para codificar.

O que faltava era o FPS da **fonte**, que o WebRTC expõe num objeto `media-source`. Com os
dois lado a lado a resposta é imediata:

| captura | codificado | conclusão |
|---|---|---|
| 60 | 60 | não está caindo onde se está olhando |
| **20** | 20 | a fonte parou de entregar — problema de captura |
| 60 | **20** | o codificador não dá conta — processador ou teto de bitrate |

Além disso o envio passou a ser amostrado a cada 15 segundos (`historicoDoEnvio`, em
`sala.js`), guardando quadros, captura, altura, banda, custo por quadro e motivo do limite.
`diagnosticoDaQueda()` compara o agora com o **melhor** momento da sessão — não com o
primeiro, porque os primeiros segundos são de acomodação e usá-los como referência acusaria
degradação em toda transmissão — e escreve a conclusão em português no painel.

Duas armadilhas que essa medição criou, e que custaram uma correção cada:

**Zero não é sempre defeito.** Sem ninguém assistindo, o servidor desliga as camadas
(dynacast) e o envio vai a zero — a maior economia que o Nexo faz. O painel mostrava isso
como `0 quadros / 0,0 Mbps` ao lado de um aviso laranja dizendo que o codificador não
acompanhava a fonte: transformava a economia em susto e acusava o codificador de falhar
justamente quando ele estava de folga. Hoje `emEspera` reconhece o caso e explica.

**E essas amostras não podem entrar no histórico.** Guardar zeros de tempo de espera faria a
comparação com o melhor momento anunciar "os quadros caíram de 30 para 0" em qualquer sessão
em que alguém fechasse a sua tela. `registrarAmostraDoEnvio` descarta amostras em espera.

## O que falta

Nada da lista original. O próximo passo é **medir**: `npm run banda`, depois de alguns dias de
uso real, diz quanto cada uma dessas mudanças rendeu de fato — e se o teto de seis câmeras é
generoso ou apertado para este grupo.

A medição de envio na própria sala agora soma **todas** as camadas e todos os codecs, e não só
a camada de maior altura. A diferença não é cosmética: numa publicação de duas camadas mais um
codec de reserva, o número antigo podia ser um terço do que a máquina estava subindo. Qualquer
conversa sobre economia partindo dele partia de um número errado — e é por isso que somar tudo
vem **antes** de calibrar orçamento por codec ou por conteúdo. O painel também mostra o tempo
de codificação por quadro de cada camada, que é o que separa "minha internet não dá conta" de
"meu processador não dá conta".

## Onde hospedar

Esta é a maior alavanca do produto inteiro, e não é técnica. Projetando 1.000 usuários ativos a
10 h/mês em salas de 5:

| provedor | ~38 TB/mês | ~12,6 TB/mês |
|---|---|---|
| AWS / GCP / Azure (~US$ 0,09/GB) | ~US$ 3.400/mês | ~US$ 1.130/mês |
| Vultr / DigitalOcean (excedente ~US$ 0,01/GB) | ~US$ 380/mês | ~US$ 130/mês |
| Hetzner / OVH dedicado, porta unmetered | ~€40/mês | ~€40/mês |

São ordens de grandeza e as cotações mudam, mas a forma da tabela não: **a diferença entre a
primeira e a última linha é de ~85x, e nenhuma otimização de código chega perto disso.** A regra
é curta — nunca pague egress por GB para mídia.

### O candidato ICE duplicado

O `escreverConfig`, em `sfu.js`, anuncia dois endereços quando a máquina está atrás de NAT: o da
LAN (`advertise_internal_ip`) e o público (`node_ip`). Os dois compartilham o mesmo listener TCP
na 7881, então o ICE vê dois pares válidos que são o mesmo fio, e alterna entre eles a cada
verificação de consentimento. No log aparece como `ice reconnected or switched pair` repetido
sem fim, sempre com o mesmo IP e a mesma porta remota.

**É cosmético** — nenhuma reconexão, nenhuma renegociação, os bytes seguem pelo mesmo socket. O
estrago é o log, que fica inutilizável.

Num VPS com IP público na própria interface (Hetzner, DigitalOcean, Vultr, Linode, OVH) o
problema some sozinho: o IP descoberto por STUN é o mesmo da interface, e sobra um candidato só.
Num VPS com NAT 1:1 (AWS, GCP, Azure, Oracle) ele continua — e fica pior, porque ali o endereço
interno não serve para ninguém, enquanto em casa pelo menos serve a quem está na mesma rede.

A regra que vale para todos os casos: **anuncie o IP interno só se alguém puder alcançá-lo.**

```
O IP público descoberto está entre os IPs das interfaces?
├─ SIM  → VPS com IP direto. Um candidato. use_ice_lite passa a valer.
└─ NÃO  → atrás de NAT. Casa ou VPS NAT 1:1?
          └─ 169.254.169.254 responde em ~300 ms?
             ├─ SIM → cloud → advertise_internal_ip: false
             └─ NÃO → casa → advertise_internal_ip: true
```

O metadata link-local é padrão em praticamente todo provedor e fora de cloud nem roteia, então a
sondagem falha em milissegundos em vez de esperar timeout.

## Codec: cinco armadilhas

O ganho teórico é real — VP9 e AV1 entregam a mesma qualidade percebida em 30–50% menos bits, e
o encode extra roda no cliente enquanto o bit economizado sai daqui, que é a transferência de
custo mais favorável que existe. Mas colher esse ganho é mais difícil do que parece.

1. **O teto não depende do codec.** O teto do perfil era o mesmo para H.264 e AV1, então trocar de
   codec nunca reduziu a conta: o codificador recebeu o mesmo orçamento e gastou tudo, entregando
   imagem melhor no mesmo bitrate. É a razão nº 1 de "testei VP9 e não vi diferença".
2. **VP9 e AV1 ignoram a escada.** Eles fazem SVC, não simulcast, e pedir as duas coisas ao
   mesmo tempo é pior do que pedir uma: o cliente avisa o servidor de um formato e monta
   outro, e o palco recebe a camada pequena. O mecanismo e a correção estão na seção sobre a
   1.13.6, acima — desde então a escada só existe de verdade em VP9/AV1 com a 1.13.7.
3. **H.264 com simulcast perde o encoder de hardware.** QSV e NVENC em geral não fazem simulcast
   nativo, e o Chrome cai para OpenH264 (software). Escolhe-se H.264 *para* usar a GPU e
   perde-se a GPU justamente por isso.
4. **O codec de reserva dobra o upload.** Publicando em VP9/AV1 com um cliente incompatível na
   sala, o LiveKit faz quem publica subir uma segunda faixa em H.264 (`backupCodecPolicy` no log
   do servidor). Os −40% do AV1 viram +100%. É a armadilha mais cara e a menos visível.
5. **AV1 em software não aguenta tela grande.** Hardware só em GPUs recentes; a sondagem em
   `room-ui.js` responde isso por máquina.

O caminho certo não é trocar o codec: é **amarrar o teto de bitrate ao codec ativo**, para que a
economia vá para a conta em vez de virar nitidez extra. É o que `ORCAMENTO_POR_CODEC` faz --
VP9 recebe 70% do orçamento de H.264 e AV1 recebe 60%.

O desconto vale só para o degrau de cima. Ele já valeu para a escada inteira, e era um erro:
o degrau de baixo é o piso de rede, não uma fração da captura. Os fatores em si continuam
sem validação visual -- são conservadores de propósito, e calibrá-los por conteúdo exige a
medição de upload total que só passou a existir agora.

**O padrão continua H.264, de propósito.** A armadilha 4 é a razão: basta um cliente
incompatível na sala para o codec de reserva dobrar o upload de quem publica, e aí os −30% do
VP9 viram +100%. Trocar o padrão é uma decisão para depois de medir com `npm run banda` numa
sala real, comparando o total com e sem -- não uma que se toma por raciocínio.

## Como medir

O servidor de mídia não responde a pergunta. O Prometheus dele (`prometheus_port`) conta
**pacotes**, não bytes, e não separa tela de câmera — serve para ver se algo está vivo. Quem sabe
o número certo é quem recebeu: cada navegador tem `bytesReceived` por faixa, e a soma de todos
eles é, por definição, o que saiu daqui.

Cada página relata o próprio pedaço uma vez por minuto (`medirRecebimento`, em
`room-transport.js`); o servidor soma por sala e grava em `native/medicao/banda.jsonl`. Não se
guarda quem recebeu o quê — a conta é da sala, não da pessoa.

```bash
npm run banda                    # tudo que houver
npm run banda -- --dias 7        # só a última semana
npm run banda -- --sala virus    # uma sala
```

O relatório quebra por fonte, mostra média e pico em Mbps, e projeta o mês. A projeção existe
para escolher categoria de hospedagem, não para fechar orçamento.
