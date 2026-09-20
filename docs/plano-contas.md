# Contas, perfis e planos

Escrito em 20/09/2026. Este é o degrau 3 do `docs/lancamento.md`, aberto inteiro: o que uma
conta é, onde ela mora, o que ela sincroniza, e o que separa quem não tem conta de quem tem
conta grátis e de quem paga. Fecha com salas privadas, que foi a pergunta que abriu a
conversa e que tem uma resposta menos óbvia do que parece.

Uma frase orienta tudo o que vem abaixo: **cobra-se persistência e resolução, porque são as
duas coisas que custam no servidor. Nunca se cobra por segurança nem por quadros.**
Segurança é o que impede a sala de virar um lugar ruim, e quadros são a máquina de quem
transmite, não a sua conta de banda.

---

## O que já existe, e não precisa ser construído

Esta seção existe porque o plano anterior — o do WebCodecs — nasceu mandando construir três
mecanismos que o LiveKit instalado já tinha. O levantamento vem primeiro agora.

| o que uma conta precisa | já existe? | onde |
|---|---|---|
| Sessão com credencial secreta, prazo, teto e limpeza por ociosidade | **sim**, para a sala | `telemetria/sessoes.js` |
| Cookie `HttpOnly` + `SameSite=Strict` + CSRF em toda escrita | **sim**, para o painel | `telemetria/autenticacao.js` |
| Comparação de segredos em tempo constante | **sim** (`iguais`) | `telemetria/autenticacao.js` |
| Freio de força bruta por IP **e** global, com `Retry-After` | **sim** (`permitiuTentativa`) | `telemetria/autenticacao.js` |
| Limite de taxa por sessão e por sala, com regras nomeadas | **sim** | `telemetria/abuso.js` |
| Token de mídia emitido pelo servidor, com permissões dentro | **sim** (`criarToken`) | `sfu.js:498` |
| O servidor enxergar a **resolução publicada** de cada faixa | **sim** — `width`/`height` chegam na webhook | `telemetria/livekit.js:78` e `:121` |
| Um gancho vivo por evento de mídia, já ligado à sessão | **sim** (`aoEvento`) | `telemetria/index.js:38` |
| Sala trancada com fila de pedidos, aprovar e recusar | **sim** | `server.js:130-200`, `resolver-entrada` |
| Dono da sala, expulsar, banir, desbanir, transferir | **sim** | `moderacao.js` |
| Preferências lembradas entre visitas | **sim**, no navegador | `public/preferencias.js` |
| Painel privado onde o mantenedor lê listas | **sim** | `painel/` + `telemetria/relatos.js` |

**O que de fato não existe:** qualquer dado de pessoa que sobreviva a reiniciar o processo.
Hoje nada do usuário toca o disco — e isso é uma propriedade declarada da sala ("Nada de uma
sala fechada sobrevive", `server.js`), não um esquecimento. Uma conta é a primeira exceção
deliberada a essa regra, e o plano precisa tratá-la como exceção: o que persiste é a conta e
o perfil, **não** a conversa, não a sala, não quem estava nela.

### Uma armadilha para nomear agora

`telemetria/armazenamento.js` tem `criarGravador`, que grava JSONL com rotação. Ele é o jeito
certo de guardar telemetria e o jeito **errado** de guardar contas: ao encher, ele renomeia o
arquivo para `.anterior` e começa outro — perder registro antigo é o projeto dele. Uma conta
que some porque a telemetria girou é o pior defeito possível neste sistema. Contas não usam
`criarGravador`.

---

## As oito decisões

### 1. Os dados moram em SQLite, dentro do próprio processo

`node:sqlite` é **embutido no Node**, sem dependência, sem compilação nativa, sem servidor
separado. Confirmado nesta máquina (Node v24.16.0): `DatabaseSync`, `StatementSync` e
`backup` estão disponíveis sem flag.

Isso contraria o que o `docs/lancamento.md` tinha escrito ("Postgres no mesmo VPS"), e a
mudança é deliberada:

| | Postgres | SQLite embutido |
|---|---|---|
| Processos para manter de pé | 2 | 1 |
| Dependências novas no `package.json` | 1 (driver) | **0** |
| Backup | `pg_dump` + agendamento | `backup()` da própria API |
| Custo | um contêiner a mais no VPS | zero |
| Escala que aguenta | muito além do necessário | milhares de contas, folgado |
| Separar servidor de contas do de mídia | dá | **não dá sem migrar** |

A última linha é o preço, e é aceitável: no ritmo medido, um VPS de €14 atende ~2000 pessoas
ativas, e o gargalo é Mbps no pico, não consulta ao banco. Para o preço não virar prisão,
**todo SQL fica dentro de um módulo só** (`contas/banco.js`). No dia em que Postgres fizer
sentido, troca-se um arquivo, e não trinta chamadas espalhadas.

Três ajustes na abertura, e cada um tem motivo:

- `PRAGMA journal_mode = WAL` — leitura não espera escrita. Sem isso, salvar um perfil
  bloqueia quem está entrando.
- `PRAGMA synchronous = NORMAL` — em WAL, continua seguro contra queda do processo, e evita
  um `fsync` por transação.
- `PRAGMA foreign_keys = ON` — no SQLite ele vem **desligado**, e é ele que faz
  `ON DELETE CASCADE` funcionar. "Apagar minha conta" que deixa perfil e sessões para trás é
  um defeito de LGPD, não um detalhe.

Versão do esquema em `PRAGMA user_version`, migrações numeradas e aplicadas na subida. É o
mecanismo mais simples que existe e não precisa de biblioteca.

### 2. Uma conta é apelido e senha. E-mail é opcional

Esta é a decisão que mais encurta o caminho até o lançamento.

Exigir e-mail no cadastro arrasta junto um **remetente transacional** (confirmação e
recuperação), que é serviço externo, com cota, com reputação de domínio e com custo quando
cresce. É a única peça deste plano inteiro que teria mensalidade — e ela entraria para
resolver um problema que ainda não existe.

Então:

- **Cadastro:** apelido + senha. Quinze segundos, sem sair da página, sem caixa de entrada.
- **Recuperação:** um **código de recuperação** mostrado uma vez, na hora do cadastro, com um
  botão de copiar e um aviso honesto: *perdeu a senha e o código, perdeu a conta*.
- **E-mail:** um campo no perfil, opcional, para quem quiser recuperação sem depender do
  código. Vazio por padrão.
- **No momento do pagamento, o e-mail passa a ser obrigatório** — recibo, cobrança e disputa
  exigem contato. É a hora certa de pedir, porque aí ele serve para alguma coisa.

Assim o remetente de e-mail entra junto com o pagamento (degrau 5), não antes, e o
lançamento não carrega custo fixo nenhum.

O apelido é único, por uma razão de produto: *"o nome é seu"* é metade do valor de criar
conta numa plataforma onde hoje duas pessoas podem se chamar Ana na mesma sala. A unicidade
é conferida sobre o apelido **normalizado** (minúsculas, acentos removidos, espaços
colapsados) — senão "Ana" e "ana " são duas contas que ninguém distingue na lista.

### 3. Senha com `scrypt`, do próprio Node — e **assíncrono**

`bcrypt` e `argon2` são módulos nativos: exigem compilar na instalação, e acabamos de gastar
uma sessão inteira consertando build em Linux. `crypto.scrypt` é embutido, é o que a própria
documentação do Node recomenda para senha, e não tem custo de portabilidade.

Guardado como uma string só, com os parâmetros dentro, para que trocá-los depois não invalide
as senhas antigas:

```
scrypt$16384$8$1$<sal em base64url>$<derivada em base64url>
```

**O detalhe que não pode passar batido:** `scryptSync` **não** pode ser usado. Ele custa ~100
ms de propósito, e o Node é uma thread só — a mesma que entrega o chat, a presença e a
sinalização de toda sala aberta. Um `scryptSync` no login congela todas elas por 100 ms, e
dez tentativas seguidas de um robô congelam por um segundo. Usa-se `crypto.scrypt`
assíncrono, que roda no pool de threads e não toca no laço de eventos.

A mesma regra vale para a senha de sala, mais adiante.

### 4. A sessão é uma linha no banco, não um cookie assinado

Duas formas de manter alguém logado: cookie assinado (sem estado no servidor) ou sessão
guardada. A segunda ganha aqui por um motivo concreto: **revogação**. "Sair de todos os
aparelhos", suspender uma conta que está abusando, e derrubar sessões quando a senha muda —
nada disso funciona com cookie assinado sem inventar uma lista de revogados, que é a mesma
tabela com outro nome.

O que se guarda é o **hash** do token, nunca o token — exatamente como `sessoes.js` e
`autenticacao.js` já fazem. Vazamento do banco não vira sessão ativa de ninguém.

O cookie copia os atributos do painel, que já estão certos: `HttpOnly`, `SameSite=Strict`,
`Secure` quando a origem é segura, e `Max-Age` longo (30 dias, renovado no uso). `Path=/`,
porque a conta vale no site inteiro, e não só em `/painel`.

Toda escrita autenticada confere origem **e** um cabeçalho CSRF, como `exigir` já faz.

### 5. A conta é do servidor. A identidade dentro da sala continua efêmera

Esta é a decisão de privacidade do plano, e é fácil errar.

A tentação é fazer a identidade de mídia virar algo estável — `ana#conta-4f2c` — e resolver
de uma vez o dono da sala, o banimento e a lista. O preço disso é um **identificador que
segue a pessoa por todas as salas, visível para todo mundo que estiver nelas**. Qualquer
participante passaria a poder cruzar presenças: "esse é o mesmo que estava naquela outra
sala". Isso é rastreamento, e não é o que se compra ao criar conta.

Então fica assim:

- O que os outros veem continua sendo `nome#sufixo sorteado`, novo a cada entrada. Nada muda
  para quem está na sala.
- O **servidor** passa a saber, na sessão, um `contaId`. Ele nunca sai para a sala.
- `moderacao.js` passa a chavear por `contaId` **quando houver**, e a cair no nome
  normalizado quando não houver (que é o comportamento de hoje).

Isso conserta de graça duas fraquezas conhecidas e documentadas:

| hoje | com conta |
|---|---|
| Recarregar a página troca a identidade, e o dono perdia o selo | o dono continua dono |
| Banimento foi para o **nome** porque a identidade não sobrevivia ao F5 | banimento de quem tem conta passa a ser da conta, e trocar de apelido não escapa |

Quem não tem conta continua exatamente como está. O banimento por nome permanece, porque
continua sendo tudo o que existe para um anônimo.

### 6. O perfil sincroniza o que é da pessoa, não o que é do aparelho

Hoje as escolhas estão espalhadas por umas dez chaves de `localStorage` (`salaNome`,
`nexoQuality`, `nexoCodec`, `nexoPrioridade`, `nexoFps`, `nexoLadoCamera`,
`sala.pushToTalk`, as de dispositivo, e o namespace `nexo.pref.*` de `preferencias.js`), lidas
e gravadas em pontos diferentes de `sala.js`. **Antes de sincronizar qualquer coisa, isso
precisa de um leitor só.** É trabalho de arrumação que vale por si: hoje não existe um lugar
onde se possa perguntar "o que esta pessoa escolheu".

E nem tudo deve subir:

| escolha | sincroniza? | por quê |
|---|---|---|
| Apelido | **sim** | é o ponto principal de ter conta |
| Cor e marca do perfil | **sim** | é o que a comunidade pede |
| Qualidade, codec, prioridade, quadros | **sim** | é a configuração que dá trabalho refazer |
| Lado da câmera, push-to-talk | **sim** | barato e some junto com o resto hoje |
| **Id de microfone, câmera e saída** | **não** | é identificador de *hardware*. O id da webcam do desktop não existe no celular, e sincronizá-lo faria a sala tentar abrir um aparelho inexistente |
| **Volume por pessoa** (`preferencias.js`) | **não** | abaixar o volume de alguém é uma decisão privada, e `preferencias.js` já documenta que ela nunca sai do navegador. Subir isso para o servidor seria guardar, em disco e associado à sua conta, uma lista de quem você silenciou |
| **Salas recentes** | **não** no lançamento | é o dado mais sensível da lista: de onde você entrou e quando. Se um dia subir, sobe como opção desligada por padrão |
| Pareamento com o agente de áudio, diagnóstico | **não** | são da máquina, não da pessoa |

Gravação com atraso (uns 2 s depois da última mudança) e teto de tamanho no JSON de ajustes.
Um seletor que grava a cada clique vira uma escrita por clique.

**Avatar enviado por arquivo fica para depois.** No lançamento o perfil é cor + inicial (ou
uma marca de um conjunto pequeno já pronto). Aceitar imagem significa armazenamento, rota de
entrega, e — o item caro — **moderação de imagem**: alguém vai subir algo terrível, e no dia
em que isso acontecer é preciso ter como ver e remover. Cor e inicial entregam 80% do que se
pede ("o perfil é meu") com 0% desse problema.

### 7. O limite do plano é decidido no servidor. O cliente só é educado

Hoje a resolução é escolhida em `localStorage` (`sala.js:783`) e aplicada como restrição de
captura. **Não há conferência nenhuma no servidor** — um cliente modificado publica o que
quiser. Enquanto não houver plano, isso não é um problema; no dia em que resolução for o que
se cobra, um limite só no cliente é uma sugestão.

O ponto de conferência **já existe e está ligado**: a webhook do LiveKit entrega
`width`/`height` de cada faixa publicada, o observador já os guarda
(`telemetria/livekit.js:78`), e `aoEvento` já liga o evento à sessão
(`telemetria/index.js:38`). Falta uma coisa só: `aoEvento` hoje não repassa largura e altura
adiante. É uma linha.

O que fazer quando a publicação excede o teto importa tanto quanto conferir:

1. **Folga de 10%.** A captura raramente entrega exatamente 720, e o escalonador automático
   mexe na resolução do degrau de cima o tempo todo. Um teto sem folga desligaria a tela de
   quem está dentro do plano.
2. **Avisa primeiro.** Um evento pelo socket dizendo o que aconteceu e o que fazer, e ~5
   segundos para o cliente republicar menor. É o que um cliente honesto que ficou
   desatualizado precisa.
3. **Só então desliga a faixa** — `MutePublishedTrack`, que precisa entrar na lista fechada de
   `sfu.js:574` (hoje só `ListRooms`, `ListParticipants` e `RemoveParticipant`). Desliga a
   tela, não a pessoa: voz, câmera e chat continuam. Expulsar alguém por causa de resolução
   seria desproporcional.
4. **O teto vale para a tela**, que é onde está o custo. A câmera já é capturada a 1280×720 em
   `sala.js:1466`, abaixo de qualquer teto aqui.

E o cliente, mesmo sem poder ser a autoridade, tem trabalho a fazer: o seletor de qualidade
**mostra** as opções que o plano não libera, com cadeado e motivo, em vez de escondê-las. Uma
opção escondida é uma funcionalidade que ninguém sabe que existe; uma opção com cadeado é a
própria oferta.

### 8. Discord como segundo caminho de entrada, não o primeiro

Vale a pena, e não no primeiro dia:

- **A favor:** o público está lá, o cadastro vira um clique, e vem apelido e avatar de
  brinde — resolve metade do perfil sem construir nada.
- **Contra, agora:** exige domínio público com HTTPS e URL de retorno fixa (ou seja, exige o
  degrau 1 concluído), exige registrar um aplicativo, e acrescenta um terceiro no caminho de
  login. Se o Discord estiver fora do ar, ninguém que dependa dele entra.

Por isso a tabela `identidade_externa` já nasce no esquema, com chave `(provedor, id_externo)`.
Ligar o Discord depois é preencher essa tabela e acrescentar duas rotas — não é remexer no
modelo. Google entra pelo mesmo caminho, se algum dia fizer sentido.

---

## O modelo de dados

```sql
-- Migração 1
CREATE TABLE conta (
  id               TEXT PRIMARY KEY,           -- uuid; nunca sai para dentro da sala
  apelido          TEXT NOT NULL,              -- como a pessoa escreveu: "Ana Clara"
  apelido_chave    TEXT NOT NULL UNIQUE,       -- normalizado; é o que garante unicidade
  senha            TEXT,                       -- scrypt$...; NULL em conta só de OAuth
  recuperacao      TEXT,                       -- scrypt do código mostrado no cadastro
  email            TEXT,                       -- opcional até o pagamento
  email_chave      TEXT UNIQUE,
  email_confirmado INTEGER NOT NULL DEFAULT 0,
  plano            TEXT NOT NULL DEFAULT 'gratis',   -- 'gratis' | 'premium'
  plano_ate        INTEGER,                    -- epoch ms; NULL = sem prazo
  criada_em        INTEGER NOT NULL,
  vista_em         INTEGER NOT NULL,
  suspensa_ate     INTEGER                     -- moderação global, fora da sala
);

CREATE TABLE perfil (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  cor      TEXT,
  marca    TEXT,                               -- de um conjunto fechado; sem upload por ora
  ajustes  TEXT NOT NULL DEFAULT '{}'          -- JSON com teto de tamanho (ver decisão 6)
);

CREATE TABLE sessao (
  id        TEXT PRIMARY KEY,                  -- sha256 do token; o token não é guardado
  conta_id  TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  criada_em INTEGER NOT NULL,
  ultima_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  aparelho  TEXT                               -- "Chrome no Windows", para a tela de aparelhos
);
CREATE INDEX sessao_por_conta ON sessao(conta_id);

CREATE TABLE identidade_externa (              -- vazia até o Discord entrar
  provedor   TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  conta_id   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  PRIMARY KEY (provedor, id_externo)
);

-- Migração 2, junto com salas privadas
CREATE TABLE sala_reservada (
  codigo    TEXT PRIMARY KEY,                  -- o mesmo formato de hoje: [a-z0-9_-]{4,32}
  dono_id   TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  entrada   TEXT NOT NULL DEFAULT 'livre',     -- 'livre' | 'senha' | 'lista'
  senha     TEXT,                              -- scrypt; NULL quando entrada != 'senha'
  criada_em INTEGER NOT NULL,
  usada_em  INTEGER NOT NULL                   -- para recuperar código abandonado
);

CREATE TABLE sala_permitido (
  codigo   TEXT NOT NULL REFERENCES sala_reservada(codigo) ON DELETE CASCADE,
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  papel    TEXT NOT NULL DEFAULT 'convidado',  -- 'convidado' | 'moderador' | 'bloqueado'
  PRIMARY KEY (codigo, conta_id)
);
```

`papel` em `sala_permitido` é o mesmo vocabulário de `PERMISSOES` em `moderacao.js`, que já
nasceu como mapa de papéis justamente para crescer. `'bloqueado'` é o banimento permanente:
o de hoje dura 60 minutos e morre com a sala, e numa sala reservada isso não basta.

**Arquivo:** `native/contas/nexo.db`, na mesma pasta privada onde a chave do painel já mora,
com a mesma proteção de ACL (`protegerPasta`, em `telemetria/autenticacao.js`) — o caminho
está no `.gitignore` e não viaja para lugar nenhum.

**Backup desde o primeiro dia, não depois.** `backup()` está na API embutida: uma cópia
quente por dia para outro caminho, e o arquivo diário copiado para fora da máquina (Storage
Box, B2 — centavos). E a restauração precisa ser testada uma vez, porque backup que nunca foi
restaurado é esperança, não backup.

---

## Os três níveis

### O que cada um tem

| | sem conta | conta grátis | premium |
|---|:--:|:--:|:--:|
| Entrar por convite | ✅ | ✅ | ✅ |
| Voz, câmera, chat, música, mesa de sons | ✅ | ✅ | ✅ |
| Compartilhar tela | ✅ 720p30 | ✅ 720p**60** | ✅ 1080p e 1440p |
| **Abrir uma sala nova** | ❌ | ✅ | ✅ |
| Trancar a sala e aprovar quem bate | ✅ (dono) | ✅ | ✅ |
| **Senha na sala** | ✅ (dono) | ✅ | ✅ |
| Moderar: expulsar, banir por 60 min, transferir | ✅ (dono) | ✅ | ✅ |
| O apelido é seu, ninguém mais usa | ❌ | ✅ | ✅ |
| Configuração segue você em qualquer aparelho | ❌ | ✅ | ✅ |
| Cor e marca de perfil | ❌ | ✅ | ✅ |
| Ser dono mesmo depois de recarregar a página | ❌ | ✅ | ✅ |
| **Reservar o código da sala** | ❌ | ❌ | ✅ |
| **Lista de permitidos que sobrevive à sala fechar** | ❌ | ❌ | ✅ |
| **Bloqueio permanente na sua sala** | ❌ | ❌ | ✅ |

Três coisas nesta tabela merecem defesa explícita:

**Compartilhar tela continua livre para quem não tem conta.** Bloquear isso seria o erro mais
caro da lista: a pessoa foi convidada justamente para mostrar alguma coisa. Limitar a
*resolução* dela não quebra nada — funciona, e passa a existir um motivo concreto para criar
conta.

**720p60 é de graça.** Cabe em software (396 ms de 700 medidos), custa 2,50 Mbps contra 1,77
do 720p30, e é melhor que o plano gratuito do Discord, que para em 720p30. É diferencial
real e é honesto, porque a máquina aguenta.

**Senha de sala é grátis para todos, inclusive anônimos.** É a regra da primeira frase deste
documento: quem já é dono de uma sala pode protegê-la. Cobrar por isso seria cobrar para a
sala não ser invadida.

### Onde cada limite é conferido de verdade

| limite | quem decide hoje | onde passa a ser conferido | o que acontece |
|---|---|---|---|
| Resolução da tela | `localStorage` (`sala.js:783`) | `aoEvento` de `track_published` (`telemetria/index.js:38`), com largura/altura repassadas de `telemetria/livekit.js:78` | avisa, espera ~5 s, desliga a faixa |
| Abrir sala vazia | ninguém | `/api/sala-config` e `join-room`, no mesmo ponto onde o banimento já é conferido | recusa com `motivo: 'precisa-de-conta'` |
| Código reservado | ninguém | `sala_reservada` | o código não é de mais ninguém |
| Entrada por senha ou lista | ninguém | `/api/sala-config`, antes de emitir o token | sem token, sem mídia |
| Apelido | `localStorage.salaNome` | `conta.apelido` quando há sessão | o nome da conta vence o campo |

A linha de cima é a mais importante do documento: `/api/sala-config` é **o** portão. Foi ele
que revelou o furo do banimento (quem era recusado só no `join-room` entrava na mídia mesmo
assim, aparecendo como par sem nome). Todo limite novo se confere ali, pelo mesmo motivo.

### O problema do convite, e como ele se resolve

"Abrir sala nova exige conta" tem um efeito colateral que estraga exatamente o fluxo que
sustenta o produto:

> A Ana cria a sala e manda o link. O João abre o link às 20h, quando a Ana ainda não entrou.
> A sala está vazia. Pelo critério acima, o João estaria "abrindo uma sala nova" — e é
> recusado, sem entender por quê, num link que um amigo mandou.

Isso não é hipótese: a sala some inteira quando esvazia (`sairDaSalaAtual`), então "vazia" é
o estado normal de qualquer sala fora do horário. Duas peças resolvem:

1. **Um convite assinado.** Quem abre a sala pede um link de convite: a URL de sempre, com um
   token curto assinado com HMAC pelo servidor, carregando o código da sala e um prazo (24 h
   é razoável). Quem chega com um convite válido pode abrir aquela sala específica mesmo sem
   conta e mesmo vazia. Não é conta, não guarda nada, não vale para outra sala, e vence
   sozinho. Vai no **fragmento** da URL (`#c=...`) e sobe num cabeçalho — assim não entra em
   log de servidor nem em `Referer` para terceiros.
2. **Um minuto de carência** antes de a sala ser esquecida quando o último sai. Resolve o caso
   comum — a queda de conexão de quem estava sozinho — sem tocar em convite nenhum.

Com as duas, "um link é tudo que separa vocês" continua verdade, que é a promessa que está
escrita na página inicial. Sem elas, "abrir sala exige conta" custa mais em desistência do
que rende em cadastro.

### O que muda na página inicial

O rodapé do cartão de entrada diz hoje **"Sem cadastro. Entre e fique à vontade."** Isso
deixa de ser verdade para quem cria sala, e uma promessa quebrada logo na porta é pior do que
a limitação em si. O texto passa a separar as duas coisas: entrar por convite continua sem
cadastro, criar a sua leva dez segundos. E o botão "Criar minha sala" leva ao cadastro quando
não há sessão — não a um erro.

---

## Salas privadas: são duas funcionalidades, e só uma é barata

A pergunta original — "salas privadas, com senha ou lista, talvez premium" — junta duas
coisas com custos muito diferentes. Separá-las é a parte útil da resposta.

### Antes de tudo: metade disso já existe

`configuracaoDaSala` já tem `trancada`, e com ela vem fila de pedidos, aviso só para quem
modera, aprovar, recusar, cancelar o próprio pedido, e retomada de quem já esteve dentro
(`identidadesConhecidasPorSala`). Ou seja: **a sala privada por aprovação já está pronta e
funcionando**. O que falta é o que dispensa o dono de estar acordado para aprovar.

### (a) Senha da sala — barata, efêmera, grátis

O dono define uma senha enquanto a sala existe. Ela mora ao lado de `trancada`, no mesmo
`configuracaoPorSala`, e morre com a sala como todo o resto.

- Quem entra com a senha certa não precisa de aprovação.
- Quem erra cai na fila de pedidos de hoje — a senha **acrescenta** um caminho, não substitui.
- Guardada com `scrypt` assíncrono, mesmo vivendo só em memória: a sala manda esse objeto
  para o cliente em `join-room` (`configuracao` vai inteiro no retorno), e uma senha em texto
  plano ali seria entregue a todo mundo que já está dentro. **Este é um detalhe fácil de
  errar e caro de descobrir depois.**
- Regra em `abuso.js` para as tentativas, no mesmo formato de `resolver-entrada`.

**Uma tarde de trabalho, e não depende de contas.** Pode ir antes de tudo o mais deste
documento.

### (b) Sala reservada — cara, persistente, premium

"Quero que `squad-da-noite` seja sempre meu, com a mesma lista de gente, mesmo quando não tem
ninguém dentro."

O custo aqui não é a lista, é o que a lista implica: **a sala passa a existir com ninguém
dentro**. Isso contraria a propriedade que a sala tem hoje, em que absolutamente nada
sobrevive ao último a sair. Uma vez que salas persistem, vêm as perguntas que só persistência
faz:

- Quem é dono quando o dono apaga a conta? (`ON DELETE CASCADE` no esquema: a reserva cai, a
  sala volta a ser efêmera e o código fica livre. É a resposta menos surpreendente.)
- O que acontece com um código reservado e nunca mais usado? (`usada_em` existe para isso:
  depois de meses sem uso, avisa e libera. Senão, os códigos bons acabam.)
- Quem responde pelo que acontece lá dentro? (o dono tem conta, e é justamente por isso que
  "abrir sala exige conta" e a moderação andam juntas.)

Por isso ela é a funcionalidade paga: é a única da lista que consome recurso permanente e a
única que cria obrigação permanente.

O que ela libera, concretamente: o código é seu; a lista de permitidos e de bloqueados
sobrevive; os papéis (`convidado`, `moderador`, `bloqueado`) passam a ser da sala e não da
sessão.

**O que ela não libera, de propósito:** histórico de conversa, sons ou gravação. Sala
reservada é o *nome* e a *lista* que persistem — **não** o conteúdo. Quem quiser mudar isso
depois que decida com os olhos abertos: é a diferença entre guardar quem pode entrar e
guardar o que foi dito, e a segunda muda o que este produto é (e o que o `docs/lancamento.md`
já recomendou não construir).

---

## O plano, em etapas

Cada etapa é entregável sozinha e tem teste próprio. A estimativa é de dias de trabalho
concentrado, não de calendário.

### Etapa 0 — senha de sala (meio dia, independente)

Não precisa de banco nem de conta. Entra quando quiser, inclusive antes das outras, e já
responde metade da pergunta sobre salas privadas.

### Etapa A — o banco e a conta que ainda não faz nada (2–3 dias)

- `contas/banco.js` — abertura, PRAGMAs, migrações por `user_version`, e **todo** o SQL. É o
  único arquivo que sabe que existe SQLite.
- `contas/index.js` — criar, entrar, sair, trocar senha, apagar. `scrypt` assíncrono.
- `contas/rotas.js` — `POST /api/conta`, `POST /api/conta/sessao`, `DELETE /api/conta/sessao`,
  `GET /api/conta/eu`. Cookie, CSRF e freio de tentativas no formato de
  `telemetria/autenticacao.js`.
- Regras novas em `abuso.js`: `'cadastrar'`, `'entrar'`, `'conta-escrever'`.
- Telas: cadastro, entrada e "sua conta" — pequenas, no estilo da entrada do painel.
- Testes: `tests/contas.test.js` (unidade, sem navegador: hash, unicidade de apelido,
  expiração, revogação, teto de tentativas) e um caminho no teste de navegador.

Ao fim desta etapa dá para criar conta e entrar. Nada mais muda — e isso é bom: sobe sozinha,
sem alterar a experiência de ninguém.

### Etapa B — perfil e sincronização (2–3 dias)

- Juntar as chaves espalhadas de `localStorage` num leitor só (arrumação que vale por si).
- `perfil.ajustes` com gravação atrasada e teto de tamanho.
- Cor e marca; o apelido da conta vence o campo de nome na sala.
- "Apagar minha conta", que apaga de verdade — é aqui que `foreign_keys = ON` se paga.
- Testes: o que sincroniza e, principalmente, **o que não sincroniza** (id de dispositivo e
  volume por pessoa têm de ficar de fora, e um teste que afirme isso protege a decisão de
  ser desfeita sem querer daqui a seis meses).

### Etapa C — os níveis (2–3 dias)

- `planos.js` — módulo puro: `LIMITES = { anonimo, gratis, premium }`, com teto de altura,
  quadros e o que mais entrar. Puro para poder ser testado sem navegador, como
  `quality-utils.js` e `moderacao.js`.
- Cliente: cadeado e motivo no seletor de qualidade, em vez de opção escondida.
- Servidor: largura/altura repassadas em `aoEvento`; conferência com folga de 10%; aviso pelo
  socket; `MutePublishedTrack` acrescentado à lista de `sfu.js:574` como último recurso.
- "Abrir sala nova exige conta", com **convite assinado** e carência de um minuto.
- `moderacao.js` passa a chavear por `contaId` quando houver.
- Página inicial: o texto de "sem cadastro" e o botão de criar.
- Testes: `tests/planos.test.js` (limites, folga, herança de plano vencido) e um caso de
  navegador em que um cliente pede resolução acima do plano e a faixa cai.

### Etapa D — salas reservadas (3–4 dias)

- Migração 2, rotas de reserva e de lista, tela de "minhas salas".
- Papéis vindos de `sala_permitido` alimentando `moderacao.js`.
- Liberação de código abandonado.
- Testes: reserva, lista, bloqueio permanente, e o que acontece quando o dono apaga a conta.

### Etapa E — pagamento (fora deste plano, mas o gancho já está pronto)

`conta.plano` e `conta.plano_ate` são a superfície inteira. A webhook do provedor muda uma
coluna; tudo o mais já lê dali. E é aqui que o e-mail passa a ser obrigatório.

**Soma:** ~10 a 13 dias de trabalho concentrado até o fim da etapa D.

---

## O que muda em arquivos que já existem

| arquivo | mudança |
|---|---|
| `server.js` | `/api/sala-config` confere conta, convite, senha de sala e reserva — junto do banimento, que já está lá. `join-room` repassa `plano` e `contaId` |
| `telemetria/index.js` | `aoEvento` repassa largura e altura; a sessão passa a carregar `contaId` e `plano` |
| `telemetria/livekit.js` | já coleta `width`/`height`; só precisa entregá-los ao `aoEvento` |
| `telemetria/sessoes.js` | `emitir` aceita a conta da sessão autenticada |
| `telemetria/abuso.js` | três regras novas |
| `sfu.js` | `MutePublishedTrack` na lista fechada de `consultar` |
| `moderacao.js` | chaveia por `contaId` quando houver; `PERMISSOES` ganha `moderador` |
| `public/sala.js` | leitor único de preferências; cadeado no seletor; reação ao aviso de limite |
| `public/home.js`, `index.html` | texto do rodapé, botão de criar, entrada da conta |
| `painel/` | contas ativas, cadastros por dia, distribuição de planos, suspender conta — no mesmo padrão do componente `Relatos` |
| `README.md` | a seção de contas, o backup e a restauração |

Nada aqui é reescrita. É o sinal de que o desenho está encaixando no que já existe, em vez de
competir com ele.

---

## Riscos, e o que decidir antes de começar

**1. Perder o banco é perder as contas.** É o primeiro dado insubstituível que este projeto
passa a ter — telemetria se perde sem drama, conta não. Backup no dia um, e uma restauração
testada. Não é etapa D.

**2. LGPD deixa de ser abstrato.** No instante em que existir senha (e mais ainda com
e-mail), há dado pessoal e há um controlador, que é você. O mínimo: uma página de privacidade
dizendo o que se guarda e por quanto tempo, "apagar minha conta" que apaga mesmo, e nenhum
e-mail em log. O esquema já foi desenhado para isso (`ON DELETE CASCADE`), e é por isso que
`foreign_keys = ON` está na decisão 1 e não numa nota de rodapé.

**3. Recuperação sem e-mail tem uma ponta solta.** Perdeu a senha e o código, perdeu a conta.
Isso precisa estar escrito na tela de cadastro, em português claro, não num termo. É uma
troca consciente: zero custo fixo em troca de uma porta a menos.

**4. O grupo que já usa vai sentir no dia em que subir.** Hoje qualquer um abre qualquer
sala. Vale avisar antes, e vale uma janela em que abrir sala continua livre enquanto as
contas são criadas.

**5. `scryptSync` congela todas as salas.** Repetido de propósito: é o defeito mais provável
desta implementação inteira, porque a versão síncrona é a que a documentação mostra primeiro
e a que "funciona" no teste.

**6. Um arquivo, uma máquina.** SQLite não separa o servidor de contas do de mídia. No ritmo
medido isso não chega perto de ser o gargalo — mas é o motivo de todo o SQL ficar num arquivo
só.

### As três perguntas que decidem o resto

- **Criar sala vai mesmo exigir conta?** É a decisão de produto com mais consequência aqui, e
  tudo na etapa C depende dela. A recomendação é sim, *com* o convite assinado. Sem o
  convite, a recomendação muda para não.
- **Apelido único ou nomes repetidos?** Único dá metade do valor de ter conta, e custa uma
  coluna. Repetido evita uma frustração no cadastro ("esse nome já é de alguém"). A
  recomendação é único, com sugestão automática quando estiver tomado.
- **Premium começa com quanto?** A conclusão de custo do `docs/lancamento.md` é que cerca de
  17 assinantes a R$ 15 pagam os €40/mês que atendem uns 3.000 usuários ativos. O plano não
  precisa começar caro; precisa começar existindo.

---

## O que não construir

- **Avatar enviado por arquivo**, até haver como moderar imagem.
- **E-mail transacional**, até o pagamento precisar dele.
- **Cargos e permissões elaborados.** `PERMISSOES` em `moderacao.js` já é um mapa e já cresce;
  três papéis bastam até alguém pedir o quarto com um caso de uso real.
- **Servidores com vários canais**, no estilo do Discord. Já foi recomendado não no
  `docs/lancamento.md`, e contas não mudam esse cálculo — mudam só a tentação, porque agora
  parece perto.
- **Histórico persistente de conversa.** Salas reservadas guardam *quem pode entrar*, não *o
  que foi dito*. São produtos diferentes.
- **2FA no lançamento.** Faz sentido no dia em que uma conta valer dinheiro; hoje ela vale
  uma resolução a mais.
