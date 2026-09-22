# Contas, perfis e planos

Escrito em 20/09/2026 e revisado em 22/09/2026, depois das decisões abaixo. É o degrau 3 do
`docs/lancamento.md`, aberto inteiro: o que uma conta é, onde ela mora, o que ela sincroniza,
e o que separa quem não tem conta de quem tem conta grátis e de quem paga.

Uma frase orienta tudo o que vem abaixo: **cobra-se resolução — e, quando existir,
persistência —, porque são o que custa no servidor. Nunca se cobra por segurança nem por
quadros.** Segurança é o que impede a sala de virar um lugar ruim, e quadros são a máquina de
quem transmite, não a sua conta de banda.

## Decisões tomadas

| assunto | decisão |
|---|---|
| Banco | SQLite embutido, escrito para poder trocar um dia |
| E-mail | opcional no cadastro, por enquanto |
| Nomes | podem se repetir. Quem tem conta ganha um **código permanente e imutável**, que não é o nome — como no Discord |
| Banimento | tem de acertar a pessoa certa, sempre |
| Criar sala | só quem tem conta |
| Convite | o link vale enquanto a sala existir, e morre com ela |
| Premium | começa em **R$ 10/mês**; o valor se ajusta depois |
| Teto de resolução | conferido no servidor quando os planos entrarem, a partir do plano guardado na conta |
| Salas privadas | ficam como estão: tranca + aprovação |
| Salas e conversas persistentes | **não agora**; o terreno fica preparado |
| Senha e banco | sem atraso entre salas nem entre telas — medido, não prometido |

---

## O que já existe, e não precisa ser construído

Esta seção vem primeiro porque o plano do WebCodecs nasceu mandando construir três mecanismos
que o LiveKit instalado já tinha.

| o que uma conta precisa | já existe? | onde |
|---|---|---|
| Sessão com credencial secreta, prazo, teto e limpeza por ociosidade | **sim**, para a sala | `telemetria/sessoes.js` |
| Cookie `HttpOnly` + `SameSite=Strict` + CSRF em toda escrita | **sim**, para o painel | `telemetria/autenticacao.js` |
| Comparação de segredos em tempo constante | **sim** (`iguais`) | `telemetria/autenticacao.js` |
| Freio de força bruta por IP **e** global, com `Retry-After` | **sim** (`permitiuTentativa`) | `telemetria/autenticacao.js` |
| Chave por origem de rede sem guardar o IP (HMAC) | **sim** (`chaveDaOrigem`) | `telemetria/index.js:34` |
| Limite de taxa por sessão e por sala, com regras nomeadas | **sim** | `telemetria/abuso.js` |
| Token de mídia emitido pelo servidor, com permissões dentro | **sim** (`criarToken`) | `sfu.js:498` |
| O servidor enxergar a **resolução publicada** de cada faixa | **sim** — `width`/`height` chegam na webhook | `telemetria/livekit.js:78` e `:121` |
| Um gancho vivo por evento de mídia, já ligado à sessão | **sim** (`aoEvento`) | `telemetria/index.js:38` |
| Uma worker para tirar trabalho pesado do laço de eventos | **sim** | `telemetria/leitor-worker.js` |
| Sala trancada com fila de pedidos, aprovar e recusar | **sim** | `server.js`, `resolver-entrada` |
| Dono da sala, expulsar, banir, desbanir, transferir | **sim** | `moderacao.js` |
| Um alfabeto de códigos feito para ser ditado e digitado | **sim** (`ALFABETO`) | `telemetria/relatos.js` |
| Preferências lembradas entre visitas | **sim**, no navegador | `public/preferencias.js` |

**O que de fato não existe:** qualquer dado de pessoa que sobreviva a reiniciar o processo.
Hoje nada do usuário toca o disco — e isso é uma propriedade declarada da sala ("Nada de uma
sala fechada sobrevive", `server.js`), não um esquecimento. A conta é a primeira exceção
deliberada a essa regra, e continua sendo a única: o que persiste é a conta e o perfil, **não**
a conversa, não a sala, não quem estava nela.

### Uma armadilha para nomear agora

`telemetria/armazenamento.js` tem `criarGravador`, que grava JSONL com rotação. Ele é o jeito
certo de guardar telemetria e o jeito **errado** de guardar contas: ao encher, ele renomeia o
arquivo para `.anterior` e começa outro — perder registro antigo é o projeto dele. Contas não
usam `criarGravador`.

---

## 1. O banco: SQLite embutido, escrito para poder trocar

### Por que ele

`node:sqlite` vem **dentro do Node**: sem dependência, sem compilação nativa, sem processo a
mais. Nesta máquina é o SQLite 3.53.0, com `DatabaseSync` e `backup` disponíveis sem flag.

Para **um servidor**, ele não é a opção econômica, é a opção certa: é o motor de banco mais
implantado que existe, é ACID, e com WAL é seguro contra queda do processo. Uma consulta é
chamada de função, não ida e volta pela rede — **conferir uma sessão com 20.000 contas custou
16,7 µs** (medido; a tabela completa está na seção 2). É a consulta que roda a cada conexão, e
é justamente o tipo de carga que mais sofre quando o banco está do outro lado de um socket.

Os limites são dois, e só um importa. Um escritor por vez: as escritas aqui são cadastrar,
entrar, salvar perfil — irrelevante. **Uma máquina só:** dois processos de aplicação não
compartilham o arquivo com segurança. Este é o limite real, e é ele que define quando trocar.

### A pergunta que decide a hospedagem

**O meu processo mantém o mesmo disco entre reinícios e deploys?**

| hospedagem | mesmo disco? | SQLite serve? |
|---|---|---|
| VPS (Hetzner, Oracle, DigitalOcean) | sim | **sim** |
| Contêiner com volume montado | sim | sim |
| Render, Railway, Heroku (camadas gratuitas) | **não** — sistema de arquivos efêmero | **não**: perde tudo a cada deploy |

As plataformas onde ele quebra **já estavam descartadas** por três motivos mais fortes,
documentados no `docs/lancamento.md`: não roteiam UDP, a franquia de banda cobre umas duas
semanas do uso medido, e a instância hiberna. O caminho real é VPS, e nele o SQLite não custa
nada.

### O que o torna trocável

Quatro regras. Com elas, migrar para Postgres é um dia de trabalho; sem elas, é uma reescrita.

1. **Todo SQL mora em `contas/banco.js`.** O resto do servidor chama funções
   (`contaPorSessao`, `criarConta`), nunca escreve SQL. No dia da troca muda um arquivo, e até
   os marcadores (`?` aqui, `$1` no Postgres) são uma substituição dentro dele.
2. **SQL que os dois bancos entendem igual:**
   - Tabelas `STRICT`. Sem isso o SQLite aceita qualquer coisa em qualquer coluna — medido:
     uma coluna `INTEGER` guardou o texto `'texto'` sem reclamar. É exatamente a linha que o
     Postgres recusaria na importação, anos depois de ter sido gravada. Com `STRICT`, a
     recusa acontece na hora, no teste.
   - `INSERT ... ON CONFLICT (...) DO UPDATE/DO NOTHING`, nunca `INSERT OR REPLACE` nem
     `INSERT OR IGNORE`. A forma com `ON CONFLICT` existe nos dois (conferido aqui, junto com
     `RETURNING`).
   - Datas como epoch em milissegundos (`INTEGER` aqui, `BIGINT` lá). Nada de
     `datetime('now')` no SQL: o horário vem do código, que já recebe `agora` injetado em todo
     o projeto — e é isso que torna os testes de expiração possíveis.
   - Ids gerados no código (uuid), nunca `AUTOINCREMENT` nem `rowid`.
   - Nenhuma dependência de `LIKE` para comparar texto: ele ignora maiúsculas no SQLite e não
     no Postgres. Compara-se sempre com o valor já normalizado no código.
3. **Migrações numeradas**, em `PRAGMA user_version`, uma por arquivo. A mesma sequência vira
   as migrações do outro banco.
4. **Cópia fora da máquina desde o primeiro dia.** `backup()` diário, copiado para
   armazenamento barato (Storage Box, B2), e **Litestream** replicando o arquivo continuamente
   para o mesmo lugar — um binário à parte, sem mudar uma linha de código. É o que responde ao
   medo legítimo por trás de "SQLite é um arquivo num disco só".

### Quando trocar

**Quando dois processos de aplicação precisarem do mesmo dado.** Não é o número de linhas:
dimensionando uma sala persistente no estilo do Discord no alvo do Nexo (20 salas ativas, 500
mensagens por dia cada), dá ~3,6 milhões de linhas por ano, e a ordem do SQLite é de centenas
de milhões. Não é busca: FTS5 vem embutido. E pelo `docs/lancamento.md`, um VPS atende uns
3.000 ativos com o gargalo em Mbps, não em banco — ou seja, o banco não é a primeira coisa a
quebrar, e a troca vai ser vista chegando pela contagem de usuários, meses antes.

---

## 2. Sem atraso entre salas nem entre telas

### Onde um travamento do Node dói, e onde não dói

A imagem e o som que já estão passando vão por UDP direto ao servidor de mídia, que é outro
processo. **Um Node travado não congela a tela de quem já está transmitindo.**

Mas passam pelo Node o chat, a presença, a entrada na sala (`/api/sala-config`) e a
**sinalização do LiveKit**: `instalarProxy` encaminha o WebSocket `/rtc` por ele, e é por ali
que chegam "comecei a compartilhar", a troca de camada e a assinatura de uma tela nova. Meio
segundo de Node parado é meio segundo em que ninguém, em sala nenhuma, consegue começar a ver
uma tela, mandar mensagem ou entrar. É o "atraso entre salas" — e ele atravessa todas.

### O que foi medido

Node v24.16.0, esta máquina (12 núcleos), pool de threads padrão (4):

| cenário | laço de eventos | ler um arquivo no meio |
|---|---|---|
| ocioso | piso do relógio (ver abaixo) | 2,0 ms |
| 20 logins com `scryptSync` | **571 ms parado** | — |
| 20 logins com `scrypt` assíncrono, sem semáforo | livre | **167,5 ms** |
| 20 logins com `scrypt` assíncrono, **semáforo de 1** | livre | **0,2 ms** |

Um hash custa **27 ms** nesta máquina — menos que os ~100 ms estimados antes. O VPS terá
núcleos mais lentos que estes, então o problema lá é **maior**, não menor.

As três linhas de baixo contam a história inteira:

- **`scryptSync` para tudo.** 20 logins seguidos = 571 ms com todas as salas congeladas.
- **Assíncrono sozinho não basta.** O laço fica livre, mas o `scrypt` roda no pool de threads
  do libuv — 4 threads, compartilhadas com leitura de arquivo, resolução de DNS e compressão.
  Com o pool cheio de hashes, ler um arquivo levou 167,5 ms em vez de 2,0: é a própria página
  da sala demorando para ser servida (`express.static` lê do disco), e a telemetria esperando
  para gravar.
- **Com semáforo de 1, as duas coisas somem.** Laço livre, arquivo em 0,2 ms. O custo aparece
  só em quem está logando: o vigésimo login de uma rajada respondeu em 573 ms. Logins esperam
  na fila; salas, não.

### A regra, em três partes

1. **`crypto.scrypt` assíncrono, nunca `scryptSync`.** A versão síncrona é a que a
   documentação mostra primeiro e a que "funciona" no teste — por isso a regra vira teste
   (abaixo), e não comentário.
2. **Uma derivação por vez**, com fila de no máximo 16. Fila cheia responde 429 na hora, sem
   enfileirar mais. É o que deixa três das quatro threads livres para o resto.
3. **O freio de tentativas vem antes da fila** — por origem e global, no formato de
   `permitiuTentativa`. Uma enxurrada é recusada antes de ocupar lugar na fila.

A mesma regra vale para qualquer outra senha que venha a existir.

### SQLite na thread principal: medido, cabe

| operação | custo |
|---|---|
| conferir sessão (20.000 contas, busca + junção) | 16,7 µs |
| escrita isolada, em transação própria | 20,2 µs em média |
| pior escrita, com o checkpoint automático do WAL dentro dela | 5,55 ms |
| `backup()` de 92 MB | 401 ms, **com o laço inalterado** |

Leitura e escrita estão na casa dos microssegundos: ficar na thread principal é o certo, e a
API síncrona é a mais simples de ler. O que sobra é o **checkpoint** — ele é síncrono, roda
dentro de uma escrita qualquer, e o tempo dele depende do disco: 5,5 ms neste NVMe, e o disco
do VPS não é este. Então:

- **`wal_autocheckpoint = 0` na conexão principal**, e o checkpoint roda numa worker com
  conexão própria, em intervalo. É o mesmo desenho de `telemetria/leitor-worker.js`, que
  existe justamente para que leitura e agregação grandes não ocupem o laço que entrega chat e
  áudio. O backup vai para a mesma worker.
- **A sessão é "tocada" no máximo a cada 5 minutos**, e não a cada pedido. Gravar `ultima_em`
  em toda página aberta seria uma escrita por clique, e cada escrita aproxima o checkpoint.
- **Nenhuma varredura no caminho de um pedido.** Listagens são do painel, e paginadas.

### A prova: o laço de eventos no painel

`telemetria/recursos.js` mede processador, memória e rede, mas não o laço de eventos. Entram
dois números: o pior atraso e o p99 da janela (`monitorEventLoopDelay`), e a fração de tempo
ocupado (`performance.eventLoopUtilization`).

Com uma ressalva que esta medição revelou: **no Windows, o relógio tem granularidade de
~15,6 ms**, e esse é o piso do histograma — o laço ocioso mediu 15,5 ms. No servidor de casa,
qualquer valor até ~16 ms significa "nada"; no Linux do VPS, o piso é ~1 ms. Sem essa nota, a
primeira olhada no painel pareceria um problema que não existe.

E o teste que protege a decisão: uma rajada de 20 logins em `tests/contas.test.js`, afirmando
que o pior atraso do laço fica abaixo de 100 ms. Medido, o `scryptSync` daria 571; a versão
certa fica no piso. O teste confere a **propriedade**, não o texto — então pega também
qualquer outro travamento síncrono que alguém introduza depois.

---

## 3. Uma conta é apelido e senha. E-mail é opcional

Exigir e-mail no cadastro arrastaria junto um **remetente transacional** (confirmação e
recuperação): serviço externo, com cota e com reputação de domínio. Seria o único custo fixo
mensal do lançamento inteiro, para resolver um problema que ainda não existe.

- **Cadastro:** apelido + senha. Quinze segundos, sem sair da página.
- **Recuperação:** um **código de recuperação** mostrado uma vez, com botão de copiar e um
  aviso honesto: *perdeu a senha e o código, perdeu a conta*.
- **E-mail:** campo opcional no perfil.
- **No pagamento, o e-mail passa a ser obrigatório** — recibo, cobrança e disputa exigem
  contato. É quando ele serve para alguma coisa.

---

## 4. Nomes se repetem; o código é quem você é

O que antes era uma coisa só vira três:

| | exemplo | muda? | único? | quem vê |
|---|---|---|---|---|
| `conta.id` | uuid | nunca | sim | só o servidor |
| `conta.codigo` | `K7M2-PQ4X` | **nunca** | sim | quem abre o seu perfil |
| `apelido` | Ana | quando quiser | não | todo mundo |

**O código** tem 8 caracteres do alfabeto que já existe em `telemetria/relatos.js` — sem
0/O/1/I/L, porque, como diz o comentário de lá, ele "vai ser lido em voz alta e digitado à
mão". São 31⁸ ≈ 850 bilhões de combinações; colisão por acaso é irrelevante, e a restrição
`UNIQUE` com nova tentativa cobre o resto. O uuid não serve como código público porque são 36
caracteres que ninguém dita num canal de voz; o apelido não serve porque muda e se repete.

**Onde ele aparece:** no cartão de perfil, ao clicar na pessoa; e na lista **só quando duas
pessoas da mesma sala têm o mesmo nome** — "Ana · K7M2". Duas anônimas com o mesmo nome se
distinguem por um trecho do sufixo da sessão, que muda a cada entrada, porque elas não têm
identidade permanente para mostrar.

**A troca, dita uma vez:** um código permanente e público torna a pessoa reconhecível entre
salas. É isso que a decisão pediu — é o que faz "a Ana que eu conheço" ser encontrável entre
dez Anas —, e é por isso que ele aparece quando alguém procura, e não pintado na lista o tempo
todo.

### A identidade de mídia continua sorteada — por outro motivo agora

Com o código público, o argumento para manter `nome#sufixo` sorteado deixa de ser "esconder
dos outros participantes". Passa a ser: **o servidor de mídia e a telemetria nunca registram
uma conta.** A identidade de mídia vai para o token do LiveKit, para as webhooks, para os
arquivos de `native/medicao/` e para os relatos de diagnóstico. Se ela carregasse a conta, tudo
isso viraria um histórico de quem esteve onde. Sorteada por sessão, esses arquivos continuam
sendo o que são hoje: dado de operação. O servidor sabe a conta pela sessão
(`sessao.contaId`), e essa ligação não sai de lá.

---

## 5. O perfil sincroniza o que é da pessoa, não o que é do aparelho

Hoje as escolhas estão espalhadas por umas dez chaves de `localStorage` (`salaNome`,
`nexoQuality`, `nexoCodec`, `nexoPrioridade`, `nexoFps`, `nexoLadoCamera`,
`sala.pushToTalk`, as de dispositivo e o namespace `nexo.pref.*`), lidas e gravadas em pontos
diferentes de `sala.js`. **Antes de sincronizar qualquer coisa, isso precisa de um leitor
só** — arrumação que vale por si.

| escolha | sincroniza? | por quê |
|---|---|---|
| Apelido, cor, marca | **sim** | é o ponto de ter conta |
| Qualidade, codec, prioridade, quadros | **sim** | é o que dá trabalho refazer |
| Lado da câmera, push-to-talk | **sim** | barato |
| **Id de microfone, câmera e saída** | **não** | é identificador de *hardware*: o id da webcam do desktop não existe no celular, e a sala tentaria abrir um aparelho inexistente |
| **Volume por pessoa** | **não** | `preferencias.js` documenta que essa escolha nunca sai do navegador. Subi-la seria guardar em disco, ligada à conta, a lista de quem você silenciou |
| **Salas recentes** | **não**, no lançamento | é o dado mais sensível da lista: de onde você entrou e quando |
| Pareamento com o agente, diagnóstico | **não** | são da máquina |

A qualidade escolhida é **guardada mesmo quando o plano não a permite**, e aplicada com o teto
do plano. Quem assinou, escolheu 1440p e deixou vencer, continua com 1440p guardado e recebe
720p60; renovou, volta sozinho ao que tinha.

Gravação com atraso (~2 s depois da última mudança) e teto de tamanho no JSON de ajustes.
**Avatar enviado por arquivo fica para depois:** no lançamento o perfil é cor + inicial (ou uma
marca de um conjunto pronto). Aceitar imagem é armazenamento, rota de entrega e — o item caro
— moderação de imagem.

---

## 6. O teto do plano é conferido no servidor

Hoje a resolução é escolhida em `localStorage` (`sala.js:783`) e **não há conferência
nenhuma no servidor**. Enquanto não houver plano, tudo bem. No dia em que resolução for o que
se cobra, limite só no cliente é sugestão — e é nesse dia que isto entra (etapa D), com o teto
vindo de `conta.plano`, que está guardado.

O ponto de conferência **já existe e está ligado**: a webhook entrega `width`/`height` de
cada faixa, o observador já os guarda (`telemetria/livekit.js:78`), e `aoEvento` já liga o
evento à sessão (`telemetria/index.js:38`). Falta repassar os dois campos adiante.

Quando a publicação passa do teto:

1. **Folga de 10%.** A captura raramente entrega exatamente 720, e o escalonador automático
   mexe na resolução o tempo todo. Sem folga, a tela de quem está dentro do plano cairia.
2. **Avisa primeiro**, pelo socket, e dá ~5 s para o cliente republicar menor — é o que um
   cliente honesto e desatualizado precisa.
3. **Só então desliga a faixa**, com `MutePublishedTrack` (que entra na lista fechada de
   `sfu.js:574`). Desliga a tela, não a pessoa: voz, câmera e chat continuam.
4. **O teto vale para a tela.** A câmera já é capturada a 1280×720 (`sala.js:1466`).

No cliente, o seletor **mostra** o que o plano não libera, com cadeado e motivo. Uma opção
escondida é uma funcionalidade que ninguém sabe que existe; uma opção com cadeado é a oferta.

---

## 7. Discord como segundo caminho de entrada, depois

Vale a pena — o público está lá, o cadastro vira um clique, e vem apelido e avatar de brinde
—, mas exige domínio público com HTTPS e URL de retorno fixa (o degrau 1 pronto), e põe um
terceiro no caminho do login. A tabela `identidade_externa` já nasce no esquema: ligar o
Discord depois é preenchê-la e acrescentar duas rotas.

---

## Quem abre a sala, e quanto o link vale

### A regra

**Só uma conta abre uma sala.** Abrir é ser o primeiro a entrar num código que não está
aberto. Quem tem o link entra enquanto a sala estiver aberta — com conta ou sem. A sala fecha
quando fica vazia (depois da carência, abaixo), e **o link morre com ela**.

A versão anterior deste plano propunha um convite assinado, válido por 24 horas. A decisão de
que o link morre com a sala o tornou desnecessário: a própria sala aberta é o convite. Uma peça
a menos.

### O que acontece com quem chega por um link

| estado da sala | quem tem conta | quem não tem |
|---|---|---|
| aberta | entra | entra |
| não está aberta | abre e entra | **espera** |

A espera é uma tela: *"A sala ainda não foi aberta. Assim que alguém com conta entrar, você
entra junto."* A página pergunta de novo a cada cinco segundos — bem abaixo do limite que
`abuso.js` já impõe a pedidos de entrada — e desiste depois de dez minutos, dizendo para
conferir o link com quem convidou.

"Ainda não abriu" e "já fechou" levam à mesma tela, e não por descuido: sem persistência, o
servidor **não tem como saber** se um código fechado já esteve aberto — nada de uma sala
fechada é lembrado, inclusive que ela existiu. A mesma tela serve bem aos dois casos, e cobre
o mais comum deles: quem abriu o link antes de quem convidou.

### A carência: 60 segundos

Hoje, quando o último sai, tudo é apagado no mesmo instante (`sairDaSalaAtual`). Isso já tem
um custo — quem está sozinho e aperta F5 perde a conversa da sala —, e com "só conta abre
sala" ganharia outro: um anônimo sozinho na sala (quem tinha conta já saiu) que cai por dois
segundos não conseguiria voltar, porque voltar seria abrir.

Com 60 segundos de carência, a sala espera vazia antes de ser esquecida, e qualquer entrada
nesse intervalo cancela o fechamento. É memória, não disco: "nada fica guardado" continua
verdade, só passa a valer um minuto depois.

### O dono que volta

Hoje o F5 custa a sala: a desconexão tira o dono da fila (`moderacao.saiu`), o segundo vira
dono, e quem volta entra no fim. Com conta, o conserto é separar **ausente** de **saiu**:

- Saiu → fica ausente, e guarda o lugar por 60 s.
- Voltou dentro do prazo, com a mesma conta → retoma o lugar, e com ele a sala.
- Enquanto está ausente, os poderes ficam com o próximo presente — a sala nunca fica sem quem
  modere.

E a sucessão, agora que contas existem:

- **Sucessão automática** (o dono saiu de vez): a conta presente mais antiga; sem conta
  presente, o anônimo presente mais antigo. "Só conta abre sala" seria meia verdade se a sala
  passasse a um anônimo com uma conta ali dentro — e o anônimo continua na regra para que a
  sala nunca fique sem moderação.
- **Transferência explícita** é respeitada como foi feita, inclusive para quem não tem conta:
  foi uma escolha de quem era dono. E quem transferiu não retoma nada ao voltar.

### Preparado para persistir

Tudo isso mora num lugar só: um módulo de ciclo de vida da sala (`salas.js`: abrir, entrou,
saiu, fechar, com o relógio da carência). Hoje o fechamento é uma lista de **dez** limpezas em
`sairDaSalaAtual` — cada mapa novo por sala precisa ser lembrado ali, e esquecer um é um
vazamento que só aparece semanas depois. Com o módulo, "sala persistente" mais tarde é esse
módulo consultando o banco antes de esquecer: uma mudança num arquivo.

---

## Banimento que acerta a pessoa certa

### Como é hoje (conferido em `moderacao.js`)

O banimento é pelo nome normalizado, e o arquivo explica o motivo: a identidade muda com o F5,
o nome não. O limite que ele documenta é a troca de nome. O que ele **não** documenta — e que
nomes repetidos transformam em caso de todo dia — é a outra direção: **banir uma Ana barra
todas as Anas.** `banido()` compara `nomeDaIdentidade(identidade)`, e duas pessoas chamadas
Ana têm o mesmo nome normalizado.

| caminho | hoje |
|---|---|
| recarregar a página | pego — o nome é o mesmo |
| trocar o nome | escapa |
| outra pessoa com o mesmo nome | **barrada junto** |

### As regras novas

1. **Quem tem conta é banido pela conta.** F5, troca de apelido, outro navegador, outro
   aparelho: nada escapa, e nenhuma outra Ana é atingida.
2. **Quem não tem conta é banido pelo nome, e o banimento por nome só vale para anônimos.**
   Uma Ana com conta nunca é barrada pelo banimento de uma Ana anônima.
3. **Banir uma conta também barra o apelido dela para anônimos.** Sem isso, bastaria sair da
   conta e voltar anônimo com o mesmo nome.
4. **Quem é barrado por nome recebe a saída:** *"Esse nome foi barrado nesta sala. Se não é
   você quem foi removido, entre com a sua conta."* O dano colateral que sobra — um anônimo
   homônimo — vira um motivo para criar conta, com porta, em vez de parede.

### O que nenhuma lista de banidos fecha

| caminho | com conta |
|---|---|
| recarregar, trocar apelido, outro aparelho | pego |
| sair da conta e voltar anônimo com o mesmo nome | pego (regra 3) |
| voltar anônimo com outro nome | escapa |
| criar outra conta | escapa |

As duas últimas linhas são o mesmo ataque: uma identidade nova. **Nenhuma lista de banidos
fecha isso**, em produto nenhum — Discord incluído —, porque a lista diz quem *não* entra, e
uma identidade nova não está nela. O que fecha é inverter: dizer quem *entra*. E isso já
existe — a tranca com aprovação. Então:

- **Banir oferece, no mesmo gesto, "banir e trancar a sala".** Quem foi banido e volta com
  outro nome cai na fila de pedidos, e quem modera vê.
- **Criar conta tem teto por origem de rede** (três por dia, por exemplo), com a chave HMAC
  que já existe (`chaveDaOrigem`). É uma *taxa*, não um bloqueio: banir por origem continua
  recusado, pelo motivo que `moderacao.js` já dá — dois amigos na mesma casa saem pela mesma
  origem.

"Acertar a pessoa certa, sempre", dito com honestidade: **para contas, sempre, sem dano
colateral**; para anônimos, pelo nome, com saída para homônimos; para identidade nova, a
tranca.

**Quanto dura:** continua em 60 minutos e morre com a sala, porque salas não persistem. O
banimento permanente vem junto com elas, no mesmo lugar.

---

## O modelo de dados

### Agora: a migração 1

```sql
CREATE TABLE conta (
  id               TEXT PRIMARY KEY,           -- uuid; nunca sai do servidor
  codigo           TEXT NOT NULL UNIQUE,       -- 'K7M2PQ4X'; imutável; exibido 'K7M2-PQ4X'
  apelido          TEXT NOT NULL,              -- livre e repetível
  senha            TEXT,                       -- 'scrypt$N$r$p$sal$derivada'; NULL em conta só de OAuth
  recuperacao      TEXT,                       -- scrypt do código mostrado no cadastro
  email            TEXT,                       -- opcional até o pagamento
  email_chave      TEXT UNIQUE,                -- normalizado; vários NULL convivem nos dois bancos
  email_confirmado INTEGER NOT NULL DEFAULT 0,
  plano            TEXT NOT NULL DEFAULT 'gratis',   -- 'gratis' | 'premium'
  plano_ate        INTEGER,                    -- epoch ms; NULL = sem prazo
  criada_em        INTEGER NOT NULL,
  vista_em         INTEGER NOT NULL,
  suspensa_ate     INTEGER                     -- moderação global, fora da sala
) STRICT;

CREATE TABLE perfil (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  cor      TEXT,
  marca    TEXT,                               -- de um conjunto fechado
  ajustes  TEXT NOT NULL DEFAULT '{}'          -- JSON com teto de tamanho
) STRICT;

CREATE TABLE sessao (
  id        TEXT PRIMARY KEY,                  -- sha256 do token; o token não é guardado
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  criada_em INTEGER NOT NULL,
  ultima_em INTEGER NOT NULL,                  -- tocada no máximo a cada 5 min
  expira_em INTEGER NOT NULL,
  aparelho  TEXT
) STRICT;
CREATE INDEX sessao_por_conta ON sessao(conta_id);

CREATE TABLE identidade_externa (              -- vazia até o Discord entrar
  provedor   TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  conta_id   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  PRIMARY KEY (provedor, id_externo)
) STRICT;
```

Na abertura: `journal_mode = WAL` (leitura não espera escrita), `synchronous = NORMAL` (em
WAL, seguro contra queda do processo e sem `fsync` por transação), `foreign_keys = ON` (no
SQLite vem **desligado**, e é ele que faz o `ON DELETE CASCADE` funcionar — "apagar minha
conta" que deixa perfil e sessões para trás é defeito de LGPD) e `wal_autocheckpoint = 0`
(seção 2).

A coluna `senha` leva os parâmetros do `scrypt` dentro da própria string, para que trocá-los
depois não invalide as senhas antigas.

**Arquivo:** `native/contas/nexo.db`, com a proteção de pasta que a chave do painel já usa
(`protegerPasta`), fora do Git.

### Depois: salas e conversas — preparado, não criado

Estas tabelas **não** entram agora. Ficam escritas aqui para que a forma já esteja decidida e
o que se constrói hoje não a contrarie.

```sql
-- quando salas persistirem
CREATE TABLE sala (
  codigo    TEXT PRIMARY KEY,
  dono_id   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  criada_em INTEGER NOT NULL,
  usada_em  INTEGER NOT NULL,
  expira_em INTEGER                            -- NULL = a sala é sua e não expira
) STRICT;

CREATE TABLE sala_membro (
  codigo   TEXT NOT NULL REFERENCES sala(codigo) ON DELETE CASCADE,
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  papel    TEXT NOT NULL,                      -- o vocabulário de PERMISSOES: dono, moderador, convidado, bloqueado
  ate      INTEGER,                            -- papel temporário, como o banimento de hoje
  PRIMARY KEY (codigo, conta_id)
) STRICT;

-- quando conversas persistirem
CREATE TABLE mensagem (
  id          TEXT PRIMARY KEY,                -- o uuid que a mensagem já tem hoje
  sala        TEXT NOT NULL,
  autor_conta TEXT,                            -- só no servidor; NULL para anônimo
  autor_nome  TEXT NOT NULL,
  texto       TEXT,
  anexo       TEXT,                            -- caminho de arquivo, nunca a imagem
  em          INTEGER NOT NULL,
  resposta_a  TEXT,
  fixada      INTEGER NOT NULL DEFAULT 0
) STRICT;
```

O que já está preparado, e o que ainda mudaria:

- **`expira_em NULL` é onde o premium cresce**: uma sala que é sua e não expira. É cobrável
  pelo mesmo motivo da resolução — custa de forma permanente.
- **`mensagem` já tem a forma da mensagem em memória** de `server.js` (id em uuid, autor,
  texto, instante, resposta, fixada). Muda uma coisa: a imagem sai da linha. Hoje ela é um
  *data URL* dentro da mensagem; persistida assim, cada imagem incharia o banco. Vai para
  arquivo, e a linha guarda o caminho.
- **A decisão de produto que vem junto**, dita agora para não ser descoberta depois: no dia em
  que conversas persistirem, a promessa de que nada fica guardado — no código e na página
  inicial — deixa de ser verdade, e a LGPD passa a pedir prazo de retenção, exportação e
  apagamento de mensagens. Esse é o custo real da funcionalidade, maior que a tabela.

---

## Os três níveis

| | sem conta | conta grátis | premium — R$ 10/mês |
|---|:--:|:--:|:--:|
| Entrar por link, com a sala aberta | ✅ | ✅ | ✅ |
| Voz, câmera, chat, música, mesa de sons | ✅ | ✅ | ✅ |
| Compartilhar tela | 720p30 | 720p**60** | **1080p e 1440p** |
| **Abrir sala** | ❌ | ✅ | ✅ |
| Trancar, aprovar, expulsar, banir | só se herdar a sala | ✅ | ✅ |
| Código permanente | ❌ | ✅ | ✅ |
| Configuração segue a pessoa | ❌ | ✅ | ✅ |
| Cor e marca de perfil | ❌ | ✅ | ✅ |
| Continuar dono depois do F5 | ❌ | ✅ | ✅ |
| Banimento sem atingir homônimos | ❌ (por nome) | ✅ | ✅ |
| Selo de apoiador *(sugestão; custo zero)* | ❌ | ❌ | ✅ |

**Compartilhar tela continua livre para quem não tem conta.** A pessoa foi convidada
justamente para mostrar alguma coisa; limitar a *resolução* dela não quebra nada, e cria um
motivo concreto para criar conta.

**720p60 é de graça**: cabe em software (396 ms de 700 medidos), custa 2,50 Mbps contra 1,77
do 720p30, e é melhor que o plano gratuito do Discord, que para em 720p30.

**O premium no lançamento é resolução**, e é honesto dizer o que ela entrega: 1080p30 cabe em
software (350 de 700 ms), sem ressalva; 1080p60 e 1440p cedem resolução para proteger os
quadros, e isso já está escrito no seletor (degrau 4). Melhora quando a codificação por
hardware chegar — sem cobrar de novo.

**A conta, a R$ 10** (na conversão usada no `docs/lancamento.md`, ~R$ 6,40 por euro, e antes
das taxas do meio de pagamento): **~9 assinantes pagam o VPS de €14** que atende uns 2.000
ativos, e **~26 pagam os €40** que atendem uns 3.000.

---

## Salas privadas: ficam como estão

A tranca com aprovação já entrega a sala privada: fila de pedidos, aviso só para quem modera,
aprovar, recusar, cancelar o próprio pedido e retomada de quem já esteve dentro. Senha de sala
e sala reservada ficam para quando salas persistirem — a reservada porque é persistência por
definição, e a senha porque é o complemento natural de uma sala que existe sem o dono online.
Se um dia a senha fizer falta antes, ela cabe em meio dia, ao lado de `trancada`, sem depender
de conta.

---

## O plano, em etapas

Cada etapa é entregável sozinha e tem teste próprio. Estimativa em dias de trabalho
concentrado, não de calendário.

### Etapa A — banco, conta e sessão, sem atraso (3 dias)

- `contas/banco.js` — abertura, PRAGMAs, migração 1 com tabelas `STRICT`, e **todo** o SQL.
- `contas/manutencao.js` — worker com conexão própria: checkpoint em intervalo e backup diário.
- `contas/senha.js` — `scrypt` assíncrono, semáforo de 1, fila de 16, 429 com a fila cheia.
- `contas/index.js` e `contas/rotas.js` — cadastrar (com o código de recuperação), entrar,
  sair, `eu`, trocar senha, apagar. Cookie, CSRF e freio de tentativas no formato do painel.
- `abuso.js` — `'cadastrar'` (com teto diário por origem), `'entrar'`, `'conta-escrever'`.
- `recursos.js` — atraso e ocupação do laço de eventos no painel, com a nota do piso do
  Windows.
- Testes em `tests/contas.test.js`: senha, código único e imutável, sessão (prazo, revogação,
  toque espaçado), teto de tentativas, `STRICT` recusando tipo errado, e **a rajada de 20
  logins com o laço abaixo de 100 ms**.

Ao fim, dá para criar conta e entrar, e nada mais muda para ninguém.

### Etapa B — perfil (2 dias)

- Leitor único das preferências; `perfil.ajustes` com gravação atrasada; cor e marca; o
  apelido da conta vence o campo de nome da sala; "apagar minha conta" que apaga.
- Testes do que sincroniza e, principalmente, **do que não sincroniza** — id de dispositivo e
  volume por pessoa têm de ficar de fora, e um teste que afirme isso protege a decisão de ser
  desfeita sem querer.

### Etapa C — sala e moderação com conta (3 dias)

- `salas.js` — o ciclo de vida: só conta abre, carência de 60 s, tela de espera para quem
  chega antes. `sairDaSalaAtual` encolhe para uma chamada.
- `moderacao.js` — chave por conta ou por nome; ausente não é saiu; sucessão automática
  prefere conta; as quatro regras de banimento; "banir e trancar".
- Página inicial: "Criar minha sala" leva ao cadastro quando não há sessão, e o rodapé deixa
  de dizer "Sem cadastro" para quem cria.
- Lista da sala: o código só aparece quando dois nomes se repetem; cartão de perfil com o
  código.
- Testes: F5 do dono, homônimos, sair da conta e voltar anônimo, transferência respeitada, e um
  teste de navegador para quem chega antes de a sala abrir.

### Etapa D — os níveis (2 dias)

- `planos.js` — módulo puro com os limites de cada nível, testável sem navegador como
  `quality-utils.js` e `moderacao.js`.
- Cadeado no seletor; largura e altura repassadas em `aoEvento`; folga de 10%; avisar, esperar
  e só então desligar; `MutePublishedTrack` na lista de `sfu.js`.
- Testes: limites, folga, plano vencido guardando a escolha, e um caso de navegador em que a
  faixa acima do plano cai.

### Etapa E — pagamento (fora deste plano; o gancho está pronto)

`conta.plano` e `conta.plano_ate` são a superfície inteira. A webhook do provedor muda uma
coluna; tudo o mais já lê dali. É aqui que o e-mail passa a ser obrigatório.

**Soma:** ~10 a 12 dias de trabalho concentrado até o fim da etapa D.

---

## O que muda em arquivos que já existem

| arquivo | mudança |
|---|---|
| `server.js` | `/api/sala-config` e `join-room` perguntam ao ciclo de vida se a sala está aberta e quem pode abri-la; `sairDaSalaAtual` encolhe para uma chamada |
| `moderacao.js` | chave por conta ou por nome; ausente ≠ saiu; sucessão que prefere conta; as regras de banimento |
| `telemetria/index.js` | `aoEvento` repassa largura e altura; a sessão carrega `contaId` e `plano` |
| `telemetria/sessoes.js` | `emitir` aceita a conta da sessão autenticada |
| `telemetria/abuso.js` | três regras novas |
| `telemetria/recursos.js` | atraso e ocupação do laço de eventos |
| `sfu.js` | `MutePublishedTrack` na lista fechada de `consultar` |
| `public/sala.js` | leitor único de preferências; cadeado no seletor; tela de espera; o código quando nomes se repetem |
| `public/home.js`, `index.html` | criar sala leva ao cadastro; o texto do rodapé |
| `painel/` | contas, cadastros por dia, planos, suspender conta, laço de eventos |
| `README.md` | contas, backup e restauração, e o piso de 15,6 ms do Windows |

Nada aqui é reescrita — é o sinal de que o desenho encaixa no que já existe.

---

## Riscos

**1. Perder o banco é perder as contas.** É o primeiro dado insubstituível do projeto. Backup
e Litestream no dia um, e uma restauração testada: backup que nunca foi restaurado é
esperança, não backup.

**2. LGPD deixa de ser abstrato.** Com senha há dado pessoal e há um controlador, que é você.
O mínimo: uma página de privacidade dizendo o que se guarda e por quanto tempo, "apagar minha
conta" que apaga, e nenhum e-mail em log.

**3. Recuperação sem e-mail tem uma ponta solta.** Perdeu senha e código, perdeu a conta. Isso
vai escrito na tela de cadastro, em português claro, e não num termo.

**4. O grupo que já usa vai sentir no dia em que subir.** Hoje qualquer um abre sala. Vale
avisar antes, e uma janela em que abrir sala continua livre enquanto as contas são criadas.

**5. Um arquivo, uma máquina.** Aceito de olhos abertos; o gatilho de troca está escrito na
seção 1.

---

## O que não construir

- **Persistência de salas e conversas** — preparada acima, não construída.
- **Avatar enviado por arquivo**, até haver como moderar imagem.
- **E-mail transacional**, até o pagamento precisar dele.
- **Cargos elaborados.** `PERMISSOES` já é um mapa e cresce; os papéis de `sala_membro`
  bastam até alguém pedir o próximo com um caso real.
- **Servidores com vários canais**, no estilo do Discord. Contas não mudam esse cálculo —
  mudam só a tentação, porque agora parece perto.
- **Banimento por origem de rede.** Recusado em `moderacao.js`, e o motivo continua valendo.
- **2FA no lançamento.** Faz sentido quando uma conta valer dinheiro.
