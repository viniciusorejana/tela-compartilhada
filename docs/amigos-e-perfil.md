# Amigos, mensagens diretas, o cartão de perfil e o início de quem tem conta

Escrito em 01/10/2026, junto com a implementação. São quatro peças que andam juntas:

1. **O cartão de perfil personalizável**: banner, fundo, borda do avatar, moldura, efeito ao
   abrir, estilo do nome, bio, pronomes, bolha de pensamento, status e conquistas.
2. **Amigos**: pedir, aceitar, recusar, remover, apelidar (só para quem apelidou) e bloquear.
3. **Mensagens diretas e convites**: conversa um a um entre amigos e o convite para uma sala,
   que chega como mensagem e como aviso.
4. **O início de quem tem conta**: em vez da página de apresentação, quem está logado abre
   `/` numa tela com as salas recentes, os amigos, as conversas e o que os amigos estão fazendo.

| peça | arquivo |
|---|---|
| O catálogo de personalizações e conquistas, lido igual pela página e pelo servidor | `public/vitrine.js` |
| O desenho do cartão, dos avatares com borda e dos efeitos | `public/cartao.js` + `public/cartao.css` |
| O editor do cartão, o mesmo no início e num painel da sala (sem sair da chamada) | `public/editor-cartao.js` + `editor-cartao.css` |
| Amizades, apelidos, bloqueios e contadores (todo o SQL) | `contas/banco.js`, migração `0004` |
| A regra de amizade | `contas/amigos.js` |
| Presença, mensagens diretas e convites, ao vivo | `social.js` (namespace `/social`) |
| O cliente do `/social` e das rotas de amigos, para o início e para a sala | `public/social.js` |
| A conversa (lista e mensagens), a mesma peça no início e na sala | `public/conversa.js` + `public/social.css` |
| O início de quem tem conta | `public/inicio.html` + `inicio.css` + `inicio.js` |
| A sala: cartão novo, convidar amigos, avisos de mensagem, o painel do editor do cartão | `public/social-sala.js` |
| O início (e a conta) por cima da sala, sem sair da chamada | `public/inicio-na-sala.js` + `inicio-na-sala.css` (a sala) e `public/camada.js` (a página de dentro) |

---

## O que fica guardado, e o que não fica

A regra do Nexo continua: **conversa não toca o disco**. O que muda é que a conta passa a
guardar mais coisas que são *da pessoa*:

| dado | onde | por quanto tempo |
|---|---|---|
| A personalização do cartão (`vitrine`) e o status (`social`) | `perfil`, no banco | até a pessoa mudar ou apagar a conta |
| Amizades e pedidos | tabela `amizade` | até alguém desfazer, ou apagar a conta |
| O apelido que você dá a um amigo | tabela `apelido_de_amigo` | idem; só você vê |
| Quem você bloqueou | tabela `bloqueio` | idem |
| Contadores das conquistas (minutos em sala, salas abertas, mensagens, telas) | tabela `contador` | idem |
| **Mensagens diretas** | **memória do servidor** | **até 3 dias sem mensagem nova**, ou até o servidor reiniciar |
| **Imagens das mensagens diretas** | **memória do servidor** | o mesmo da conversa, e menos: até 20 por conversa e 64 MB no servidor (a mais antiga sai primeiro) |
| Em que sala cada amigo está agora | memória | enquanto ele estiver lá |
| Salas recentes | `localStorage` do navegador | neste aparelho |

### Por que a mensagem direta não vai para o banco

Guardar conversa em disco desfaz a promessa da página inicial e da conta ("conversas não são
guardadas em lugar nenhum") e traz junto o que a LGPD pede de quem guarda mensagem: prazo de
retenção, exportação e apagamento sob pedido (`docs/plano-contas.md`, "Depois: salas e
conversas"). O custo real é esse, e não a tabela.

Na memória, com teto, a conta é pequena: cada conversa guarda até **60 mensagens** de até
**1.000 caracteres**, e o servidor guarda até **20.000 conversas** (a mais parada sai primeiro).
No pior caso são ~1,2 GB teóricos; no uso real do alvo do Nexo (squads de 3 a 20 pessoas), umas
centenas de conversas de algumas dezenas de mensagens, ou seja, poucos megabytes. A conversa
some **3 dias depois da última mensagem**: é tempo de sobra para o amigo que estava offline ler,
e curto o bastante para nada virar arquivo.

Reiniciar o servidor apaga as conversas. A tela diz isso uma vez, no topo de toda conversa.

**As imagens** pesam mais que o texto, e têm teto próprio: a página as reduz antes de enviar (até
1280 px, cerca de 600 KB; o GIF vai como está quando cabe), e o servidor guarda as **20 mais novas
de cada conversa** e **64 MB no total**. Passou disso, a mais antiga sai primeiro, e a mensagem
dela passa a dizer "Esta imagem já saiu da memória do servidor". Elas não vão dentro da mensagem:
cada uma tem um endereço (`/api/social/imagem/:id`) que só os dois da conversa abrem, conferido
pela sessão da conta a cada pedido, com o tipo decidido pelos bytes (`contas/imagens.js`) e a
mesma entrega das imagens da conta (`nosniff`, uma CSP que não deixa nada rodar). Assim o histórico
continua leve e quem nunca rola até a imagem nunca a baixa.

### Por que as salas recentes continuam no navegador

O `plano-contas.md` decidiu que "salas recentes" não sobem para a conta: é o dado mais sensível
da lista, de onde você entrou e quando. A trilha do início lê o `localStorage`, como a página de
apresentação já lia; cada aparelho tem a sua.

### Em que sala o amigo está

É presença, não histórico: o servidor sabe porque a pessoa está lá agora, e esquece quando ela
sai. Só **amigos** veem, e cada pessoa pode desligar ("Mostrar aos amigos em que sala estou") ou
ficar **invisível**, que aparece como desconectada.

---

## Amigos

- Pedido pelo **nome de usuário** (`@ana`) ou pelo **código** (`K7M2-PQ4X`), ou pelo botão
  "Adicionar amigo" do cartão de alguém numa sala.
- Dois pedidos cruzados (A pede B e B pede A) viram amizade na hora.
- Quem recebeu aceita ou recusa; quem pediu pode cancelar. Recusar não avisa ninguém.
- **Apelido de amigo**: vale só para quem o deu, em todo aparelho (é do banco). Aparece no lugar
  do apelido da pessoa na lista de amigos, nas conversas e no cartão (com o apelido dela embaixo).
- **Bloquear** desfaz a amizade e os pedidos, e impede pedido, mensagem e convite de quem foi
  bloqueado. Quem foi bloqueado não fica sabendo: os pedidos dele recebem a mesma resposta de
  sempre, e as mensagens não saem (ele já não é amigo).
- Cada pessoa decide se aceita pedidos ("Receber pedidos de amizade").
- Tetos: 200 amigos, 50 pedidos enviados pendentes. Freio por conta para pedir (`amizade-pedir`).

A conta é identificada para fora pelo **código** — nunca pelo id interno, que não sai do servidor.

## Mensagens diretas e convites

- Só entre amigos. Texto de até 1.000 caracteres; links viram links; nada vira HTML.
- **Imagem**, com legenda ou sem: pelo botão ao lado do campo, colando ou arrastando para a
  conversa. Ela fica numa prévia acima do campo até ir, e na conversa abre grande num visor.
- Chegam ao vivo pelo socket `/social`, em qualquer aba onde a pessoa esteja logada (o início ou
  uma sala). Fora da conversa aberta, viram contagem de não lidas e um aviso no canto.
- **Convite para uma sala**: uma mensagem especial com o botão "Entrar". Sai do início (o menu do
  amigo → "Chamar para uma sala", numa sala recente ou numa nova) ou de dentro da sala ("Convidar
  amigos"). Quem recebe vê também um aviso no canto, onde estiver.
- Apagar uma mensagem própria apaga para os dois.
- Freios: `dm-enviar` (rajada de 8 em 3 s, 40 por minuto), `dm-imagem` (rajada de 4 em 10 s, 10
  por minuto), `convidar` (10 por minuto).

## A presença

| status | o que os amigos veem |
|---|---|
| Disponível | ponto verde |
| Ausente | ponto âmbar (lua) |
| Não incomodar | ponto vermelho; avisos de mensagem não aparecem no canto |
| Invisível | desconectado |

O status é escolhido no início ou na sala e segue a conta. Junto vem o **status personalizado**
(emoji e frase, com prazo: 30 min, 1 h, 4 h, hoje ou sem prazo) e a **bolha de pensamento**, uma
frase curta que flutua sobre o avatar no cartão por 24 horas.

"Conectado" quer dizer: com o início aberto, ou numa sala.

---

## O cartão de perfil

Tudo o que se escolhe mora em `perfil.vitrine`, com forma fechada (`public/vitrine.js`,
`limparVitrine`): o que não está no catálogo é descartado no servidor, venha de onde vier.

| parte | opções |
|---|---|
| Tema (duas cores do cartão) | 10 prontos; **cores exatas** (premium) |
| Banner | as cores do tema, 8 animados, ou uma imagem/GIF (premium) |
| Fundo do cartão | o tema, liso, os animados, ou uma imagem/GIF (premium) |
| Borda do avatar | 9, várias animadas |
| Moldura do cartão | 5 |
| Efeito ao abrir o cartão | 10 animações com transparência por cima do cartão |
| Estilo do nome | 4 |
| Sobre | bio (190), pronomes (40), bolha de pensamento (70) |
| Conquistas à mostra | até 5 das que a pessoa já tem |

### Onde a personalização aparece

Não só no cartão: para todo mundo ver o tempo todo, a pessoa aparece com o que escolheu em todo
lugar onde ela aparece (`public/cartao.js`: `decorarAvatar`, `estilizarNome`, `moldurar`,
`vestirFundo`), sempre com a vitrine **efetiva** — a que o servidor manda, sem o que ainda não vale.

| lugar | borda do avatar | estilo do nome | moldura | fundo do cartão |
|---|---|---|---|---|
| Na sala: a lista "No squad", o "eu" lá embaixo, o chat, o canal de música, as menções, o tempo na sala, a folha de volume | sim | sim | | |
| Na sala: o quadradinho da plateia | sim | sim | sim | sim, atrás do avatar (a câmera fica por cima) |
| Na sala: a foto grande | | sim | sim | sim |
| A conversa direta (no início e na sala), as listas de amigos e de conversas | sim | sim | | |
| A página da conta, no topo | sim | sim | sim | sim |

O chat, o canal de música e a conversa mostram a borda e o nome **parados**, animando quando o mouse passa pela
mensagem: são centenas de mensagens, e cada borda que gira é uma pintura por quadro. Fora da
sala, o que a pessoa vê de si mesma (as mensagens dela na conversa, o "eu" do início, a conta) é o
cartão efetivo que `/api/conta/eu` devolve em `cartao`, e o editor o atualiza ao salvar.

### Comum, conquista e premium

Cada peça do catálogo tem um `requer`: nada (comum), uma **conquista**, ou **premium**. É a parte
"de jogo": algumas peças se ganham usando o Nexo.

- Premium segue a regra de sempre (`NEXO_PLANOS`): com os planos desligados, todo mundo tem.
- A escolha fica **guardada** mesmo sem o requisito, como as cores exatas: quem deixou o premium
  vencer volta a ver o banner animado ao renovar. O que sai para os outros é a **vitrine
  efetiva** (`vitrineEfetiva`), sem o que não vale agora.

### As conquistas

Saem de contadores da conta (`contador`), da idade da conta, do plano e do número de amigos:

| conquista | quando |
|---|---|
| Chegou chegando | criou a conta |
| Primeira sala | abriu 1 sala |
| Anfitrião | abriu 25 salas |
| No palco | compartilhou a tela 1 vez |
| Diretor de cena | 50 telas |
| Bom de papo | 100 mensagens no chat das salas |
| Cronista | 1.000 mensagens |
| Maratona | 10 horas em salas |
| Morador do Nexo | 100 horas em salas |
| Turma formada | 3 amigos |
| Popular | 15 amigos |
| Pioneiro | conta criada até 31/12/2026 |
| Veterano | conta com 1 ano |
| Apoiador | premium agora |

Os contadores são somas, e nada mais: **não** guardam em que sala, com quem nem quando. Os
minutos entram quando a pessoa sai da sala; as mensagens e as telas são somadas na memória e
gravadas a cada 30 s, para nenhuma mensagem virar uma escrita no banco.

### Os efeitos e o movimento

Banners, fundos, bordas e molduras animados são CSS puro. O efeito ao abrir é um `<canvas>`
transparente por cima do cartão, por 2,4 s, que não recebe clique. Com **menos movimento** (do
sistema ou das configurações), as animações contínuas param no primeiro quadro e o efeito não
toca: o cartão aparece como ficaria parado.

---

## O início de quem tem conta

`/` decide no servidor: com sessão, entrega `inicio.html`; sem, a apresentação de sempre
(`index.html`), que continua em `/sobre` para quem tem conta. O aplicativo abre `/` e cai
direto no início.

| coluna | o quê |
|---|---|
| Trilha (72 px) | o Nexo, as salas recentes deste aparelho, criar sala, entrar por código, novidades |
| Lateral (264 px) | buscar, Amigos, Personalizar perfil, Conquistas, as conversas, e você (status, conta) |
| Centro | amigos (Disponíveis, Todos, Pedidos, Bloqueados, Adicionar), a conversa aberta, o editor do cartão, as conquistas |
| Agora no Nexo (340 px) | os amigos que estão em sala, agrupados por sala, com Entrar; abrir uma sala |

Abaixo de 1100 px a coluna da direita vira um bloco no topo dos amigos; abaixo de 760 px a trilha
e a lateral viram gaveta.

"Entrar" na sala de um amigo é ir ao link dela: se a sala estiver trancada, quem chega cai na fila
de pedidos, como qualquer um — o botão já diz "Pedir para entrar".

---

## O início dentro de uma chamada

Até 03/10/2026, ver os amigos, as mensagens ou as conquistas de dentro de uma sala pedia sair dela.
Agora a marca do Nexo na lateral da sala, **Ctrl K** e "Senha e conta" abrem o início (ou a conta)
**por cima da sala**, com a chamada de pé por baixo: a mesma conexão, o mesmo microfone, a mesma
presença para os outros. O desenho e as regras de tela estão em `docs/interface.md` (5.2); o que
interessa aqui é o que isso significa para os dados:

- **É a mesma página, num `<iframe>` da própria origem** (`/?camada=<sala>`). Ela abre o socket de
  amigos dela — uma conta já podia ter várias abas (até 8, `ABAS_POR_CONTA`), e o quadro conta como
  uma — e o fecha ao sair. Nada novo é guardado, e o servidor não mudou.
- **A presença não muda.** "Conectado" é estar numa sala ou com o início aberto; a camada não
  desfaz nem duplica isso: o amigo continua vendo "Na sala #…", e a camada mostra a sala da pessoa
  como "Na sua sala" nas listas.
- **A conversa aberta lá dentro marca como lida** o que chega, como no início. Fechada a camada, o
  quadro some, e nada fica lendo por baixo.
- **A ponte do aplicativo Android não é carregada no quadro** (`app-android.js` volta logo se estiver
  num quadro): o aplicativo injeta `nexoAndroid` em todo quadro da origem, mas só ouve o principal, e
  a página de dentro, com o mesmo socket de amigos da de cima, montaria notificações que ninguém
  recebe. O toque numa notificação de mensagem abre a conversa **na camada**, se ela estiver aberta
  (`docs/android.md` conta como o "voltar" do aparelho também a fecha).
- **Entrar numa sala de dentro da camada pergunta antes**, porque uma conta está numa sala só.
- **Sair da conta e apagar a conta** de dentro da camada tiram a pessoa da sala também; criar uma
  conta continua sendo fora dela.

## O que isto não resolve

- **Mensagens diretas não sobrevivem a reiniciar o servidor.** Decisão, não descuido (acima).
- **Sem notificação fora do Nexo.** Quem não está com nenhuma aba aberta vê a mensagem quando
  voltar (até 3 dias).
- **Um servidor só.** Presença e conversas moram na memória do processo; dois processos de
  aplicação precisariam de um lugar comum (o mesmo gatilho de troca do SQLite).
- **A imagem do banner e do fundo passa pela mesma moderação da foto**: "Tirar as imagens" no
  painel apaga todas as imagens da conta de uma vez.
