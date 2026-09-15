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

**Três tamanhos, três camadas** (`camadaDesejada`). O palco recebe a camada cheia, o card da
grade a do meio, o quadradinho da plateia a baixa. Mandar 640×360 para um quadradinho de
duzentos pixels era pagar três vezes pelo que ninguém consegue ver.

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

## O que falta

Nada da lista original. O próximo passo é **medir**: `npm run banda`, depois de alguns dias de
uso real, diz quanto cada uma dessas mudanças rendeu de fato — e se o teto de seis câmeras é
generoso ou apertado para este grupo.

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

1. **O teto não depende do codec.** `perfil.bitrate` é o mesmo para H.264 e AV1, então trocar de
   codec nunca reduziu a conta: o codificador recebeu o mesmo orçamento e gastou tudo, entregando
   imagem melhor no mesmo bitrate. É a razão nº 1 de "testei VP9 e não vi diferença".
2. **VP9 e AV1 ignoram a escada.** No Chrome eles fazem SVC, não simulcast, e as camadas
   declaradas em `quality-utils.js` deixam de ser aplicadas — em silêncio.
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
VP9 recebe 70% do orçamento de H.264, AV1 recebe 60%, e a escada inteira encolhe junto, não só
o degrau de cima.

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
