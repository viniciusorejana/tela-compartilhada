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
- Chegam ao vivo pelo socket `/social`, em qualquer aba onde a pessoa esteja logada (o início ou
  uma sala). Fora da conversa aberta, viram contagem de não lidas e um aviso no canto.
- **Convite para uma sala**: uma mensagem especial com o botão "Entrar". Sai do início (o menu do
  amigo → "Chamar para uma sala", numa sala recente ou numa nova) ou de dentro da sala ("Convidar
  amigos"). Quem recebe vê também um aviso no canto, onde estiver.
- Apagar uma mensagem própria apaga para os dois.
- Freios: `dm-enviar` (rajada de 8 em 3 s, 40 por minuto), `convidar` (10 por minuto).

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

## O que isto não resolve

- **Mensagens diretas não sobrevivem a reiniciar o servidor.** Decisão, não descuido (acima).
- **Sem notificação fora do Nexo.** Quem não está com nenhuma aba aberta vê a mensagem quando
  voltar (até 3 dias).
- **Um servidor só.** Presença e conversas moram na memória do processo; dois processos de
  aplicação precisariam de um lugar comum (o mesmo gatilho de troca do SQLite).
- **A imagem do banner e do fundo passa pela mesma moderação da foto**: "Tirar as imagens" no
  painel apaga todas as imagens da conta de uma vez.
