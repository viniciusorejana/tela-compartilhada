# Lançar o Nexo: o que custa, o que cobrar, e em que ordem

Escrito em 17/09/2026, a partir de três dias de uso real medidos pelo próprio Nexo.
Nada aqui é projeção teórica: a base é `native/medicao/banda.jsonl` e `uso.jsonl`.

## O que o uso real diz

Dois dias "normais" de um grupo de amigos — terça 15 e quarta 16 de setembro de 2026:

| | terça 15 | quarta 16 |
|---|---:|---:|
| Saída total | **6,99 GB** | **6,95 GB** |
| Pico de janela (60 s) | 11,70 Mbps | 9,78 Mbps |
| Pico instantâneo de rede | 14,99 Mbps | 12,30 Mbps |
| Horas com alguém na sala | 5,1 h | 6,4 h |
| Horas em sala de 3–6 pessoas | 3,3 h | 3,4 h |
| Sessões concluídas | 40 | 47 |
| Permanência média | 8,7 min | 12,5 min |
| Tela, como fração do tráfego | **96,1%** | **88,1%** |

Os dois dias fecharam em 6,9 GB com 4 minutos de diferença entre si. Essa consistência é o
que dá confiança à projeção — não é uma amostra de um dia atípico.

O perfil horário mostra um uso concentrado: terça foi das 13h às 18h (com 2,08 GB só às 15h),
quarta das 12h às 18h mais uma ponta às 21h. **Fora dessas janelas, o servidor fica ocioso.**

### A métrica que serve para projetar

Dividindo o tráfego pelas pessoas-hora efetivas de cada dia:

| dia | pessoas-hora | GB por pessoa-hora |
|---|---:|---:|
| terça 15 | ~18,3 | 0,38 |
| quarta 16 | ~22,2 | 0,31 |

Adotado: **0,40 GB por pessoa-hora**, arredondado para cima como margem. Equivale a ~0,9
Mbps sustentados por pessoa presente.

**Esse número é 4,5 vezes melhor do que a projeção teórica** que está em
[`banda-e-escala.md`](banda-e-escala.md) ("1.000 usuários a 10 h/mês = ~38 TB"). A diferença
não é erro de conta: é o efeito medido de três decisões que já estão no ar — assistir sob
demanda, o dynacast desligando camadas que ninguém consome, e a grade usando o degrau de
360p. A projeção antiga assumia todo mundo recebendo a camada cheia o tempo todo.

**Ressalva honesta:** esse grupo já usa o Nexo com a cultura de "assistir sob demanda". Uma
comunidade aberta pode assistir mais telas simultaneamente. Os cenários abaixo usam 0,40 como
base e 0,80 como pessimista.

---

## Quanto custa hospedar

### O custo por resolução, que é o que decide os planos

O teto de envio sai dos pixels e da taxa ([`quality-utils.js`](../public/quality-utils.js)):

| perfil | teto de envio | custo relativo |
|---|---:|---:|
| 720p 30 | 1,77 Mbps | 0,44× |
| 720p 60 | 2,50 Mbps | 0,63× |
| **1080p 30** (base medida) | 3,98 Mbps | 1,00× |
| 1080p 60 | 5,63 Mbps | 1,41× |
| 1440p (30 ou 60) | 6,00 Mbps | 1,51× |

Aplicando essa razão aos 0,40 GB/pessoa-hora medidos (o grupo transmitia principalmente em
1080p): um usuário em **720p30 custa ~0,18 GB/pessoa-hora**; um em **1080p60, ~0,57**.

### Cenários

Mistura de lançamento: 90% no plano grátis (720p) e 10% pago (1080p/1440p), 10 h/mês cada.

| usuários ativos/mês | egress/mês | onde cabe |
|---:|---:|---|
| 100 | ~220 GB | qualquer VPS de €4–5 |
| 500 | ~1,1 TB | VPS de €5–14 |
| 2.000 | ~4,4 TB | VPS de €14 (4 vCPU, franquia de 20 TB) |
| 8.000 | ~17,5 TB | o mesmo VPS, perto do limite da franquia |
| 20.000 | ~44 TB | dedicado com porta 1 Gbps |

### O que cobrar por GB custaria

| provedor | ~4,4 TB/mês | ~20 TB/mês |
|---|---:|---:|
| **Hetzner / OVH** (franquia grande ou porta unmetered) | €5–14 | €14–45 |
| DigitalOcean / Vultr / Linode (excedente ~US$ 0,01/GB) | ~US$ 24 | ~US$ 175 |
| AWS / GCP / Azure (~US$ 0,09/GB) | ~US$ 400 | ~US$ 1.800 |

A regra do projeto continua valendo e é a decisão financeira mais importante que existe
aqui: **nunca pague egress por GB para mídia.** A diferença entre a primeira e a última
linha é de até 40×, e nenhuma otimização de código chega perto disso.

### O gargalo real não é GB, é Mbps no pico

Isto é o que a conta de franquia esconde. Uma sala de 4–5 pessoas picou em **15 Mbps**.

| usuários ativos/mês | simultâneos no pico (est.) | salas | banda de pico |
|---:|---:|---:|---:|
| 500 | ~40 | ~10 | ~150 Mbps |
| 2.000 | ~170 | ~42 | ~630 Mbps |
| 5.000 | ~420 | ~105 | ~1,6 Gbps |

A estimativa supõe o uso concentrado em ~4 h de pico, como os dados mostram. **Uma porta de
1 Gbps satura por volta de 2.500–3.000 usuários ativos**, e é aí que o custo muda de patamar
— não quando a franquia de GB acaba.

### Sair de casa é o primeiro passo, e não é opcional

Hospedar no PC de casa não escala por três motivos independentes, e nenhum deles é software:

1. **Upload residencial.** 15 Mbps de pico já são visíveis numa fibra doméstica; 150 Mbps
   (500 usuários) não existem em plano residencial brasileiro.
2. **CGNAT.** Sem endereço público alcançável, parte das pessoas simplesmente não conecta —
   é o `bytes=0` documentado em [`turn.md`](turn.md).
3. **Um VPS com IP público elimina o TURN.** Com endereço público no host, a alternativa por
   TCP do próprio servidor de mídia cobre quem bloqueia UDP, e o coturn deixa de ser
   necessário. Isso apaga um servidor inteiro do orçamento — e o TURN é o pior tipo de custo,
   porque relaya a mídia e portanto **dobra** o tráfego de quem depende dele.

Um VPS também faz desaparecer o candidato ICE duplicado que hoje polui o log
([`banda-e-escala.md`](banda-e-escala.md), "O candidato ICE duplicado").

### A conclusão de custo

**Hosting não é o risco deste projeto.** O lançamento cabe em €14/mês até uns 2.000 usuários
ativos, e em €40–50/mês até uns 3.000. A €40/mês, **cerca de 17 assinantes a R$ 15 pagam a
infraestrutura inteira.** O risco do projeto é tempo de desenvolvimento e retenção, não
fatura.

---

## Lançar com codificação por software?

**Sim. E a razão principal não é pressa — é que o problema afeta muito menos gente do que
parece.**

### A assimetria que decide

A codificação por hardware só afeta **quem envia**. A decodificação já usa a placa em todos
os navegadores relevantes (`decodingInfo` responde `powerEfficient: true`, medido em
[`captura-de-tela.md`](captura-de-tela.md)).

Numa sala de 5 pessoas com uma tela aberta, **uma** pessoa codifica e **quatro** decodificam.
A lacuna atinge ~20% das sessões-pessoa, e só quando essa pessoa está com a máquina apertada.

### O que mudou no dia 16/09

A escala automática ([`banda-e-escala.md`](banda-e-escala.md), "A imagem encolhe em vez de os
quadros serem perdidos") mudou a **natureza** do sintoma. Antes: a imagem travava — que é a
reclamação mortal. Agora: a resolução cede um degrau e os quadros continuam.

Isso importa para o lançamento porque travamento e resolução variável não são a mesma
categoria de problema. O primeiro faz a pessoa fechar o produto; o segundo é o que Discord,
Twitch e Meet fazem há dez anos.

### O que realmente cabe em software, medido

| perfil | custo de codificação | cabe em 700 ms/s? |
|---|---:|---|
| 720p 60 | ~396 ms/s (6,6 ms/quadro medido) | **sim** |
| 1080p 30 | ~350 ms/s | **sim** |
| 1080p 60 | ~702 ms/s (11,7 ms/quadro medido) | **não** |
| 1440p 60 | bem acima | não |

**Esta tabela é a estrutura de planos.** O único perfil que o software não alcança é
justamente o topo — e é exatamente ali que o WebCodecs entraria depois, como melhoria de um
plano que já existe.

### O que isso muda no preço: a promessa, não o valor

O erro a evitar é vender "1080p 60 fps" como número. A medição acima mostra que ele não é
alcançável em software nesta classe de máquina, e cobrar por algo que não se entrega é
problema de produto *e* de reputação.

A saída é cobrar pelo que o **servidor** controla, não pelo que a **máquina do usuário**
controla:

| | o que é | quem controla | serve para cobrar? |
|---|---|---|---|
| **Resolução** | orçamento de banda | o servidor — é o seu custo | **sim** |
| **Taxa de quadros** | capacidade de codificar | a máquina de quem transmite | **não** |

Cobrar por resolução é cobrar pelo próprio custo, o que é defensável em qualquer conversa
com a comunidade. Cobrar por fps é vender o que você não controla.

### A estrutura de planos que sai disso

| plano | o que libera | custo estimado por usuário-hora |
|---|---|---:|
| **Grátis** | 720p, **30 e 60 quadros**, salas, câmera, voz, chat, música | ~0,18 GB |
| **Pago** | 1080p e 1440p, 30 e 60 quadros | ~0,45–0,57 GB |

Três razões para dar **720p60 no plano grátis** em vez de 720p30:

1. **Ele cabe em software** — 396 ms de 700. É a única faixa alta que se pode prometer sem
   ressalva.
2. **Custa pouco a mais**: 2,50 contra 1,77 Mbps. A diferença entre 30 e 60 quadros é de
   ~1,4×, enquanto a diferença entre 720p e 1080p é de 2,25×.
3. **É melhor que o concorrente de referência.** O plano gratuito do Discord entrega 720p30;
   60 quadros ficam atrás do Nitro. Entregar 720p60 de graça é um diferencial real, e é
   honesto, porque a máquina aguenta.

O que a pessoa paga para ter é **resolução** — que é onde o seu custo está de fato.

### Quando o WebCodecs chega, o preço não muda

Ele melhora o plano pago sem cobrar de novo: o 1080p60 que hoje flutua para ~810p sob
pressão passa a ser 1080p60 de verdade. É a melhor coisa que pode acontecer para retenção de
assinante — e é um argumento de lançamento, não um débito escondido.

### E há um limite que o WebCodecs não resolve

Compartilhar **uma janela** capa em 44 quadros por causa do caminho de captura do Windows, e
rebaixa o jogo do *independent flip* para o caminho composto. Isso é do sistema operacional,
não da codificação. Nenhum encoder conserta — e é bom que esteja dito na documentação do
produto desde o primeiro dia, porque vai aparecer no suporte.

### O ativo de produto que já existe e vale usar no lançamento

O painel de Diagnóstico **diz de quem é o limite** — captura, processador, banda, ou o
codificador. Isso transforma "o Nexo é ruim" em "a minha máquina não codifica em hardware", e
é raro num produto de comunicação. Vale ser mostrado, não escondido.

---

## Plano de ação, em degraus

Cada degrau é entregável sozinho, e a ordem é por **bloqueio**, não por facilidade. O que já
foi feito de cada um, e a ordem atual junto com os planos de contas e do WebCodecs, está em
[`roteiro.md`](roteiro.md).

### Degrau 1 — sair de casa (bloqueia tudo, e é menor do que parece)

**O código já está pronto para isto.** Uma primeira versão deste documento listou aqui
trabalho que não existe; a verificação em `sfu.js` mostrou o contrário. O que já está
implementado:

| Já funciona | Onde |
|---|---|
| Descoberta do IP público por STUN, com três servidores | `ipPublicoDescoberto`, `sfu.js` |
| IP configurável, com precedência sobre a descoberta | `NEXO_IP_PUBLICO` |
| Reconhecer "o IP público é desta máquina" (VPS com IP direto) | `publicoEhDaMaquina` |
| Detectar nuvem pelo endereço de metadados, em ~400 ms | `estaNaNuvem` |
| Decidir `advertise_internal_ip` sozinho, com escape manual | `NEXO_ANUNCIAR_LAN` |
| `use_ice_lite` só quando ele é válido, atrás de variável | `NEXO_ICE_LITE` |
| **TURN embutido desligado** porque há IP público e fallback TCP | `turn: enabled: false` |
| Escuta e bind configuráveis | `SFU_IPS`, `SFU_BIND` |
| Porta e origem pública por ambiente, com `x-forwarded-host` | `PORT`, `PUBLIC_URL` |
| **LiveKit para Linux x64, com SHA-256 conferido** | `scripts/baixar-livekit.cjs` |

O que **de fato** falta, e é tudo pequeno:

1. **TLS.** `server.js` usa `http.createServer` e não termina TLS. Um proxy reverso resolve
   (Caddy faz isso em três linhas de configuração, com certificado automático).
2. ~~**`npm start` não roda em Linux.**~~ **Resolvido em 19/09/2026** (`540fc6c`): o `start`
   deixou de chamar `build:helper`, que é um script PowerShell, e passou a ser
   `npm run build:sfu && node server.js` — que roda igual no Linux.
3. **Os instaladores do aplicativo precisam chegar lá por fora.** Desde `3668834` o agente de
   áudio vai **dentro** do aplicativo de Windows, então o servidor não precisa mais dele. O que
   continua fora do Git (`app/dist/` está no `.gitignore`) são os próprios instaladores —
   `SalaCompartilhada.exe`, `Nexo.AppImage` e `Nexo.dmg`. Sem eles no `app/dist` do VPS, o
   servidor **roda**, e a página apenas não oferece o download.
4. **arm64 não é aceito.** `pacoteDestaMaquina()` recusa `process.arch !== 'x64'`. Só importa
   se o destino for ARM (ver "hospedagem gratuita", adiante).

Uma consequência de desenho que vale registrar: **hospedar remoto torna o `audio-helper`
irrelevante e o `audio-agent` essencial.** O helper lista e captura aplicativos da máquina
onde o **servidor** roda — o que só faz sentido no uso local, em que servidor e transmissor
são o mesmo computador. Remoto, quem captura áudio de aplicativo é o agente, na máquina da
pessoa — e é por isso que ele passou a viajar dentro do aplicativo. Então o item 3 acima não é
detalhe: sem os instaladores no servidor, ninguém tem áudio de aplicativo.

- **Teste que fecha o degrau:** alguém em 4G, alguém em Wi-Fi corporativo com UDP bloqueado,
  e um iPhone — os três recebendo tela.

Custo: ~€14/mês. Esforço: dias, e a maior parte é operacional, não código.

#### Hospedagem gratuita serve para o teste?

**Render, Railway, Heroku e semelhantes: não.** Três motivos estruturais, e nenhum deles se
contorna com código:

1. **UDP.** Essas plataformas roteiam HTTP (e TCP em alguns planos), não UDP arbitrário. A
   mídia do LiveKit é UDP; sobraria o fallback TCP, que funciona mas é o pior caminho
   possível para vídeo ao vivo — TCP retransmite tudo e bloqueia a fila, que é exatamente o
   que degrada imagem em movimento.
2. **Banda.** O uso medido é de 6,9 GB/dia. Uma franquia gratuita típica de ~100 GB/mês
   cobre **cerca de duas semanas** — e depois para ou cobra.
3. **Dormir por inatividade.** Instâncias gratuitas hibernam e levam dezenas de segundos para
   acordar. Numa sala de voz isso é fatal.

Some a isso que o `server.js` inicia o LiveKit como processo separado: cabe num contêiner, mas
não em 512 MB com CPU fracionada sob carga.

**A alternativa gratuita que de fato funciona é o Oracle Cloud Free Tier:** ARM Ampere com
IP público, portas UDP livres, sem hibernação, e uma franquia de egress de ordem de grandeza
muito maior que as demais. Duas ressalvas honestas: é **ARM**, então exige declarar o hash do
`linux_arm64` em `baixar-livekit.cjs` (mudança de poucas linhas, mais conferir o hash); e a
disponibilidade de capacidade ARM na Oracle é notoriamente irregular.

**Mas o caminho pragmático é outro:** um VPS de €4–5/mês elimina os três problemas de uma vez,
sem nenhuma alteração de código e sem depender de sorte de capacidade. Para um teste com
poucas pessoas, gastar menos que um café por mês compra previsibilidade — e é o mesmo caminho
que o lançamento vai usar, então nada do que for testado ali precisa ser refeito.

### Degrau 2 — receber os relatos de diagnóstico (1 dia)

Hoje o relatório é montado e **copiado para a área de transferência**
(`copyDiagnosticsBtn`, em `room-ui.js`), para a pessoa colar num chat. Isso funciona entre
amigos e não funciona com desconhecidos: ninguém vai copiar sessenta linhas e procurar onde
mandar.

A alteração é pequena porque **toda a infraestrutura já existe**:

| Precisa | O que reusa |
|---|---|
| Rota `POST /api/relato` | o padrão das rotas de `/api/telemetria` em `telemetria/index.js` |
| Cota e limite por pessoa | `criarAntiabuso`, em `telemetria/abuso.js` |
| Gravação em disco com teto | `criarGravador`, em `telemetria/armazenamento.js` |
| Leitura para exibir | `lerRegistros`, no mesmo arquivo |
| Autenticação e CSRF para ver | `telemetria/rotas.js`, já protegendo `/painel` |

O que é novo: um campo "o que aconteceu?" ao lado do botão de copiar, um botão **Enviar para o
desenvolvedor**, e uma seção no painel. Estimativa: ~200 a 250 linhas, um dia de trabalho.

Três decisões que fazem a diferença entre isto ser útil e ser ignorado:

- **Um clique, com uma frase.** O relatório técnico vai anexado; a pessoa só escreve o que
  tentou fazer. Sem formulário, sem login, sem e-mail obrigatório.
- **Dizer o que vai junto.** O relatório já exclui IPs, endereço da sala, mensagens e
  credenciais — isso está documentado e precisa estar **na tela**, não só na documentação.
  Pedir para enviar diagnóstico sem dizer o que ele contém é o tipo de coisa que queima
  confiança de graça.
- **Devolver um número de protocolo.** Sem ele a pessoa não tem como falar do próprio relato
  depois, e você não tem como ligar uma conversa a um registro.

O botão de copiar **fica**. Ele continua sendo o caminho de quem quer pedir ajuda num chat.

### Degrau 3 — contas e identidade

Hoje o link é o convite e não há identidade. É o que a comunidade pede e o que o pagamento
exige.

> **Este degrau está aberto inteiro em [`plano-contas.md`](plano-contas.md)**, com as
> decisões tomadas em 21/09/2026 — modelo de dados, etapas, os três níveis, banimento e
> salas. O que mudou em relação a esta seção: o banco é **SQLite embutido** (zero dependência,
> zero processo a mais), o **e-mail é opcional no cadastro** (ele arrastava junto o único
> custo fixo mensal do lançamento), os **nomes podem se repetir** e quem tem conta ganha um
> código permanente, e o **premium começa em R$ 10** — a conclusão de custo deste documento,
> feita a R$ 15, passa a ser ~26 assinantes para os €40/mês. O resto desta seção continua de
> pé.

- **Banco:** no mesmo VPS, sem serviço gerenciado — serviço gerenciado é o segundo lugar onde
  custo escapa, depois do egress. Backup diário para object storage barato (Hetzner Storage
  Box, Backblaze B2).
- Cadastro com senha, e OAuth do Discord depois (é onde o público já está).
- Perfil: nome de exibição, cor e marca. É o que os usuários pedem, é barato, e é o que faz o
  produto parecer cuidado.

#### O que o anônimo pode, e o que a conta desbloqueia

A pergunta certa não é "o que tirar de quem não tem conta", é **"o que a conta ganha"** — e a
diferença não é retórica, é de conversão.

| decisão | recomendado | por quê |
|---|---|---|
| **Criar sala** | exige conta | Quem cria sala está adotando o produto; é o momento natural de pedir cadastro. E **sala sem dono é sala sem moderação** — o requisito de produto e o de segurança coincidem aqui |
| **Entrar por convite** | livre | É o canal de aquisição. Quem entra é o convidado do amigo, e um cadastro na porta é onde ele desiste |
| **Compartilhar tela** | livre, em 720p30 | Bloquear isto quebra a experiência de quem foi convidado — e ele é justamente quem você quer converter. Ele vai compartilhar, gostar, e aí o cadastro tem motivo |
| **720p60** | exige conta (grátis) | Um degrau visível, sem tirar nada de ninguém |

**Bloquear compartilhar tela para anônimos seria o erro mais caro desta lista.** A pessoa foi
convidada para mostrar algo; se ela não pode, o produto falhou no primeiro uso e ela não volta
— e quem a convidou também sente. Já limitar a **resolução** dela não quebra nada: ela
compartilha, funciona, e existe um motivo concreto para criar conta.

### Degrau 4 — dizer em que estado o Nexo está

Isto é barato e evita a reclamação número um. Em dois lugares, não um:

**Na landing page**, uma seção honesta sobre codificação: que a compressão sai no processador
de quem transmite, que 720p60 e 1080p30 são alcançáveis, que 1080p60 e 1440p vão flutuar de
resolução para não travar, e que isso melhora quando a codificação por hardware chegar. Quem
lê isso e assina depois não vira reclamação — vira alguém que entendeu o produto.

**E no próprio seletor**, que é onde a decisão acontece. Cada opção de resolução já mostra o
teto de banda que ela custaria agora; falta mostrar que **1440p60 provavelmente não será
transmitido em 1440p** nesta máquina. Os dois dados para isso já existem e já estão medidos em
tempo real: a sondagem de codificação por hardware (`sondarCodificadores`, em `room-ui.js`) e
o custo por quadro da própria sessão. O aviso vai antes da escolha, não depois dela.

O painel já diz quando a imagem encolheu. O que falta é dizer **antes**.

### Degrau 5 — planos e pagamento

- Cobrar **por resolução**, pelas razões acima.
- **PIX é obrigatório** para público brasileiro. Mercado Pago, Asaas ou Pagar.me; Stripe para
  cartão internacional se houver público fora.
- O teto de resolução vira uma **permissão no token do LiveKit** — é onde ele já mora
  (`sfu.js`, `criarToken`), e validar no servidor é o único lugar que vale, porque qualquer
  limite só no cliente é sugestão.

**Sobre a assinatura vitalícia:** ela tem um problema estrutural que precisa ser dito. O
custo é **recorrente** (banda todo mês) e a receita é **única**. Um vitalício que usa o
produto por três anos consome banda por três anos. Isso funciona como **captação inicial
limitada** — "primeiros 200 apoiadores" — porque cria defensores do produto e financia o
degrau 1. Como oferta permanente, é uma dívida que cresce.

### Degrau 6 — moderação mínima, e o que NÃO construir

- **Sala com dono, expulsar e banir.** **Feito** (`bd73c01`, `e18dc5f`): dono, expulsar,
  banir por 60 minutos, desbanir e transferir. O que as contas mudam nisso está em
  [`plano-contas.md`](plano-contas.md).
- **Limite de pessoas por sala.** Hoje existe teto de 6 câmeras; o de pessoas, não. Uma sala
  de 15 em 1440p é ~90 Mbps sozinha.
- **Um caminho para relatar abuso**, que reusa a rota dos relatos do degrau 2.

#### Sobre virar um Discord: a recomendação é não

Salas persistentes com dono levam naturalmente à pergunta "e se cada sala tivesse vários
canais de voz e texto, com cargos e permissões?". A resposta recomendada é **não**, e o motivo
não é esforço — é posicionamento.

| construir | custo | o que entrega |
|---|---|---|
| Sala persistente com dono + expulsar/banir | dias | Resolve ~95% da moderação real de um grupo de amigos |
| Múltiplos canais, cargos, permissões, hierarquia | **meses** | Uma versão pior de algo que o Discord já dá de graça |

**O diferencial do Nexo não é organização social, é qualidade de compartilhamento de tela.** O
Discord reserva 1080p60 para o Nitro; o Nexo pode dar 720p60 de graça, com um diagnóstico que
diz de quem é o limite — e isso é defensável em qualquer comparação. Cargos e permissões não
são defensáveis contra o Discord: é o terreno dele.

A posição mais forte é **complementar, não substituto**: a turma se organiza no Discord e vem
para o Nexo assistir junto. Isso também é o caminho de aquisição mais barato que existe, porque
o convite circula exatamente onde as pessoas já estão.

Então o minimalismo fica — **1 sala = 1 call + 1 chat + 1 bot** — com uma adição, já feita: a
sala passa a ter dono. O link **continua** morrendo com a sala: em 21/09/2026 ficou decidido
não persistir salas por enquanto, com o terreno preparado (ver
[`plano-contas.md`](plano-contas.md)). Dois papéis, não um sistema de cargos:
**dono** e **participante**. Se a comunidade pedir mais, você já terá usuários para justificar
o custo — e aí a decisão é tomada com dados em vez de com suposição.

### Degrau 7 — WebCodecs

Depois do lançamento, e com as respostas da etapa 0 de
[`plano-webcodecs.md`](plano-webcodecs.md) em mão. O uso real vai dizer se ele é a próxima
prioridade ou se outra coisa é — e essa é a razão mais forte para ele vir depois: **você não
sabe ainda o que a comunidade vai reclamar mais.**

---

## Os riscos que eu vejo, e não são de custo

| risco | por quê | o que reduz |
|---|---|---|
| **Suporte de um só** | Cada usuário novo é uma pergunta possível, e você é uma pessoa | Diagnóstico autoexplicativo (já existe), FAQ sobre captura de janela e codificação |
| **Pico concentrado** | Os dados mostram uso das 12h às 18h. O custo é dimensionado pelo pico, não pela média | Nada a fazer além de dimensionar pelo pico — mas é bom saber que a média engana |
| **Um usuário abusivo** | Uma sala de 15 em 1440p é ~90 Mbps sozinha | Teto de sala, teto por conta, cota em `telemetria/abuso.js` |
| **Vitalício como oferta permanente** | Receita única, custo recorrente | Limitar a quantidade e o prazo |
| **Lançar e ninguém vir** | O risco mais comum, e o único que custo baixo não cobre | Lançar barato o suficiente para que isso não doa — o que €14/mês garante |
