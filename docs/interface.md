# A interface do Nexo: o padrão de UI/UX e de design

Escrito em 01/10/2026, a partir do que o código faz hoje. É a referência para qualquer tela
nova ou mudança visual: os números, as peças prontas, como elas se comportam em cada largura,
como o Nexo fala com quem usa, e o porquê de cada escolha. Quando o código e este documento
discordarem, o código vence — e este documento precisa ser corrigido junto.

A ideia geral, em uma frase: **um aplicativo de chamada no jeito do Discord — escuro, denso,
calmo —, que nunca grita, nunca esconde o que a pessoa precisa saber, e funciona igual de 320 px
a 2560 px**.

| assunto | onde mora |
|---|---|
| Os números (cor, letra, altura, raio, sombra, tempo) e as peças comuns a toda página | `public/tema.css` |
| Tema claro e escuro, temas prontos, cores exatas | `public/tema.js` (no `<head>` de toda página) |
| A sala inteira | `public/sala.css` |
| A página inicial; a da conta herda dela | `public/home.css`, `public/conta.css` |
| O modal da apresentação e das novidades (vale nas duas páginas) | `public/novidades.css` |
| O Estúdio; os rostos que reagem e a fonte do OBS | `public/estudio.css`, `reativo.css`, `obs.css` |
| A página de "não encontrada" | `public/nao-encontrada.css` |
| O início de quem tem conta (amigos, conversas, salas recentes) | `public/inicio.css` + `inicio.js` |
| O início e a conta por cima da sala, sem sair da chamada (a camada) | `public/inicio-na-sala.{js,css}` (a sala) + `public/camada.js` (a página de dentro) |
| O cartão de perfil personalizável (vitrine), o avatar com borda e status, os efeitos | `public/cartao.css` + `cartao.js`; o catálogo em `public/vitrine.js` |
| Amigos e conversa direta, as mesmas peças no início e na sala | `public/social.css`, `conversa.js`, `social.js` (+ `social-sala.js` na sala) |
| Avatar de qualquer pessoa, em qualquer página | `NexoPerfil.pintar` (`public/perfil.js`) |
| A foto de perfil ampliada (o visor e o avatar que abre) | `public/foto-grande.js` + o fim de `public/cartao.css` |
| Avisos no canto | `public/toast.js` |
| Sons | `public/sons.js` |

---

## 1. Princípios

1. **Calmo por padrão.** Nada pisca, nada pula, nada toca alto. O que aparece desliza 6 px e
   cresce 1,5%; os sons são baixos e nunca em rajada; avisos somem sozinhos. Um Nexo barulhento
   é um Nexo silenciado.
2. **O estado sempre à vista, sem pedir atenção.** O volume de cada pessoa aparece ao lado da
   régua, o microfone mudo é um ícone cortado, quem está no OBS tem um selo, quem ensurdeceu tem
   o fone cortado. Informação que só existia num `title` era informação que ninguém descobria.
3. **Denso, mas legível.** Letra pequena (o corpo é 13–14 px, a meta 11 px), mas com contraste
   medido: todo texto passa de 4,6:1, e o principal de 7:1.
4. **Um desenho por coisa.** O mesmo microfone, o mesmo fone cortado, a mesma régua, o mesmo
   cartão de painel em todo lugar. Quem aprende num canto reconhece no outro.
5. **Nunca rola para o lado, nunca se sobrepõe.** Em nenhuma largura. `npm run test:layout`
   confere isso em 32 estados, de 320 a 2560 px.
6. **Vídeo é sempre escuro.** O palco, o quadradinho e a grade ficam escuros mesmo no tema
   claro (`.contexto-escuro`), como no Discord: uma tela compartilhada cercada de branco ofusca.
7. **Ação clara, saída cinza.** O botão principal é violeta cheio; "Fechar" e "Cancelar" são
   sempre cinza. O botão mais chamativo de um painel nunca é o que não faz nada.
8. **Fala como gente, em português.** Frases curtas, o que aconteceu e o que fazer. Ver a
   seção 11.

---

## 2. Os números (tokens)

Nenhuma cor de superfície, texto, borda sutil ou destaque é escrita direto no CSS: tudo sai de
`tema.css` (regra também no `CLAUDE.md`). É o que deixa o tema claro, os temas prontos e as
cores exatas trocarem a sala inteira de uma vez.

### 2.1 Superfícies, da mais funda à mais alta

| token | uso |
|---|---|
| `--bg-fundo` | o poço: trilho do interruptor, fundo do vídeo e do palco |
| `--bg-0` | campo de digitar, barra de controles, rodapé da lateral |
| `--bg` | o fundo da página |
| `--bg-1` | painéis: lateral, chat, barra de cima, coluna de seções, menus, avisos |
| `--bg-2` | o cartão do modal |
| `--bg-cartao` | o quadradinho, a caixa de escrever, os cartões dentro de painel |
| `--bg-3`, `--bg-4`, `--bg-5` | botão secundário e os seus "passar o mouse" (`--bg-5` é a barra de rolagem) |

No claro, as três últimas ficam **mais escuras** que o cartão branco, de propósito: são cor de
botão e de passar o mouse, e precisam aparecer sobre ele.

### 2.2 Tinta e bordas

`--tinta` é branco no escuro e quase preto no claro. Toda sobreposição translúcida é
`rgb(var(--tinta) / N%)` — um passar de mouse de 3–6%, uma borda de 5–15% —, e por isso funciona
nos dois modos sem regra própria. As bordas prontas: `--line` (5%), `--line-2` (9%), `--line-3`
(15%).

Faixas que se repetem pelo código: **2–3%** fundo de bloco quieto; **3–6%** passar o mouse;
**7–9%** apertar ou selecionado discreto; **10–15%** borda visível.

### 2.3 Texto

| token | uso | contraste mínimo |
|---|---|---|
| `--text` | título, nome, o que se lê primeiro | 7:1 |
| `--text-2` | texto de corpo, rótulo de controle | 6:1 |
| `--text-3` | texto secundário, rótulo de campo | 5:1 |
| `--muted` | explicação, subtítulo de painel | 4,6:1 |
| `--faint` | meta: hora, contagem, dica | 4,6:1 |
| `--apagado` | desabilitado, placeholder, separador | — |

Os alvos são medidos contra a superfície menos favorável em que o texto aparece (o cartão no
escuro, o campo no claro), e `tema.js` leva cada nível até eles quando o tema é outro.

### 2.4 Destaque (violeta, por padrão)

| token | uso |
|---|---|
| `--accent` | borda, ícone, trilho de régua, interruptor ligado |
| `--accent-hi` | destaque sobre fundo escuro (link, nome em evidência) |
| `--accent-forte` | **preenchimento com texto branco** (botão principal, aba ativa): 4,6:1 |
| `--accent-forte-hi` | o mesmo, ao passar o mouse |
| `--accent-suave`, `--accent-suave-hi` | fundo translúcido de selecionado e do anel do campo |
| `--accent-texto` | texto na cor de destaque (≈10:1 no escuro) |
| `--anel-cor` | o anel de foco |

Botão cheio leva **sempre** `--accent-forte` com texto `#fff`. Texto colorido leva sempre
`--accent-texto`. A cor escolhida pela pessoa nunca é usada crua em texto.

### 2.5 Cores com significado

| família | quando | peças |
|---|---|---|
| `--online` (verde) | conectado, no ar, deu certo, falando | ponto de conexão, anel de quem fala, "Copiado", ponto "no ar" |
| `--danger` (vermelho) | desligado, perigo, erro | microfone mudo, fone cortado, "Sair", apagar, erro |
| `--aviso` (âmbar) | atenção, acima do normal, nível completo | volume acima de 100%, menção a você, selo do nível completo |
| `--rosa` | ao vivo | selo "LIVE", telas ao vivo |

Cada uma tem a versão `-texto` (para letra) e, quando precisa, `-suave` (fundo translúcido) e
`-forte` (preenchimento com texto branco).

**Texto escuro sobre preenchimento colorido** — as iniciais no avatar de cor, o selo rosa da tela
ao vivo, o número no quadrado da sala recente — é sempre `--sobre-cor`. É um só nos dois temas
porque a cor por baixo também não muda. **Contagem** (não lidas, pedidos de entrada, pedidos de
amizade) é `--danger-forte` com texto branco: 4,8:1 nos dois temas.

### 2.6 Letra

Uma família só: `"Segoe UI", system-ui, sans-serif`. Números alinhados usam
`font-variant-numeric: tabular-nums` (volume, tempo, contagem). Códigos (de conta, de
recuperação) usam `ui-monospace, Consolas, monospace` com `letter-spacing:.03–.06em`. As marcas
do perfil (★ ☾ ♞…) usam a fonte de símbolos do sistema, para não virarem emoji colorido.

| token | px | uso |
|---|---|---|
| `--fs-rotulo` | 10 | rótulo em CAIXA ALTA espaçado, selo; é o piso — só para isso |
| `--fs-meta` | 11 | hora, dica, contagem, legenda |
| `--fs-sm` | 12 | texto de painel, botão pequeno, item de lista |
| `--fs-md` | 13 | botão, título de item, texto de corpo de painel |
| `--fs-lg` | 15 | título de seção, nome em destaque |
| `--fs-xl` | 19 | número grande (o volume da folha) |
| `--fs-2xl` | 26 | — |

Títulos: modal `h2` 22 px, `letter-spacing:-.04em`; seção das configurações `h3` 20 px; título
da página inicial `clamp(48px, 5.1vw, 71px)`, `-.065em`. Pesos: 600 (botão, rótulo), 650
(título, nome), 750 (rótulo em caixa alta). Rótulo de grupo em caixa alta: `--fs-rotulo`, peso
750, `letter-spacing:.06–.12em`, cor `--faint` (`.config-grupo`, `.section-caption`,
`.mencoes-titulo`).

Corpo: a sala usa `14px/1.45`; a página inicial, `14px/1.6`. No celular, todo campo de digitar
tem 16 px (abaixo disso o iOS aproxima a página ao focar).

### 2.7 Alturas, raios, sombras

**Três alturas de controle, e só três:** `--ctl-p` 30 px (botão de ícone, chip, item de
menu, segmentado), `--ctl-m` 36 px (botão de painel, da barra de cima, rodapé de modal),
`--ctl-g` 44 px (formulário, ação principal no celular).

| raio | px | onde |
|---|---|---|
| `--r-xs` | 6 | número do volume, selo pequeno |
| `--r-sm` | 8 | botão de ícone, item de menu, aba |
| `--r-md` | 10 | botão, campo, lugar de imagem |
| `--r-lg` | 14 | bloco, cartão interno, menu, aviso |
| `--r-xl` | 20 | modal |
| `--r-pilula` | 999 | chip, selo, interruptor, pílula de volume |
| `--raio` | 16 | o palco |

Avatares: quadrado arredondado nas listas e no chat (10–11 px de raio), círculo no cartão de
perfil, no Estúdio e nas escolhas.

Sombras: `--sombra-menu` (menu, aviso, lista de menção), `--sombra-modal` (cartão do modal),
`--anel-foco` (foco em peça redonda). No claro, a sombra é da cor da tinta e mais leve — preta
num fundo claro vira mancha.

### 2.8 Movimento

| token | valor | uso |
|---|---|---|
| `--dur-rapida` | 110 ms | o que responde ao dedo: apertar, destaque de mensagem |
| `--dur` | 170 ms | passar o mouse, trocar cor, menus |
| `--dur-lenta` | 240 ms | o que aparece: modal, folha, aviso |
| `--curva` | `cubic-bezier(.2,.8,.2,1)` | tudo |
| `--curva-mola` | `cubic-bezier(.34,1.4,.64,1)` | o pulinho de avatar ao passar o mouse |

Entradas prontas (`tema.css`): `nexo-surgir` (sobe 6 px e cresce de 98,5%), `nexo-aparecer`
(só opacidade), `nexo-descer` (lista que cai de um botão), `nexo-pulso`, `nexo-girar`.

Respostas à mão: botão encolhe para 97% ao apertar; quadradinho sobe 1 px com sombra ao passar
o mouse; avatar da lista e do chat cresce 6% com mola; o ícone de cada botão da barra de controles
sobe 1 px e cresce 8% com mola; a engrenagem gira um oitavo de volta; o "+" de criar gira 90°; a
seta de "seguir adiante" anda 3 px; o cartão de sala ao vivo e o de conquista sobem 1–2 px com
sombra. É pouco de propósito: o detalhe diz "isto está vivo", e não pula na cara de ninguém.

**Abrir e fechar, o mesmo movimento para tudo.** Uma regra para o que aparece e some:

- **Colunas** (barra lateral, chat, canal de música): a coluna vai a zero e volta deslizando
  (`transition: grid-template-columns var(--dur-lenta) var(--curva)` no `.app`). As larguras são
  variáveis (`--col-lateral`, `--col-chat`) e cada estado só zera a sua, então o número de colunas
  não muda e a troca sempre desliza. O conteúdo apaga rápido (`--dur-rapida`) antes de a coluna
  estreitar, para ninguém ver texto se espremendo, e só fica `visibility:hidden` quando a coluna já
  fechou (`transition-delay` de `--dur-lenta`); ao abrir, volta na hora. O chat abre **já com a
  largura final** (a grade dele tem uma coluna de `--col-chat-aberto`) e a coluna o revela cortado
  (`overflow:clip`): o texto não quebra linha a linha enquanto ela cresce.
- **Coluna e gaveta são classes diferentes.** `sem-chat` (no `.app`) fecha a coluna na tela larga;
  até 1100 px o chat e a música são gavetas por cima de tudo, inclusive da barra de controles, e
  quem as mostra é o `aberto` do painel — `sem-chat` não as esconde. Fechar o chat é `fecharChat`,
  que mexe nas duas; `NexoMusica.fechar()` fecha só a música.
- **Nada que desliza rola a página.** O `.app` corta o que passa da janela com `overflow:clip`
  (corta sem virar área de rolagem), e o foco dado a um campo que nasce numa coluna ainda abrindo
  vai com `focus({ preventScroll: true })`. Sem os dois, abrir o chat rolava a página 166 px para o
  lado por um instante: a lateral "piscava" e a tela inteira tremia.
- **Faixas** (a plateia): a linha da grade vai de `1fr` a `0fr` no mesmo tempo, com o mesmo
  apagar e o mesmo `hidden` no fim. O filho corta com `overflow:clip` e `overflow-clip-margin`,
  que deixa a sombra do passar o mouse aparecer.
- **Painéis e menus** saem como entraram: o fundo apaga e o cartão desce os 6 px que subiu.
  `display` entra na transição (`transition-behavior: allow-discrete`), então o `.hidden` continua
  sendo o jeito de fechar em todo o código e o painel só sai da tela no fim; durante a saída ele
  não recebe clique. Navegador sem `allow-discrete` fecha na hora, como antes.
- Quem mede o palco ouve `resize`, que vai de novo no fim do deslize (`room-ui.js`).
- Troca de conteúdo no mesmo lugar (chat ↔ música, seções do início) é `nexo-aparecer`.

Um teste que confere "fechou" logo depois do clique espera o fim (`waitFor({ state: 'hidden' })`):
fechar agora leva o tempo da saída.

**Menos movimento** vale em dois níveis: o do sistema (`prefers-reduced-motion`) e o "Menos
animação" das configurações (`html.menos-movimento`, posto por `tema.js` em toda página). As duas
regras moram em `tema.css`, e valem para todas as páginas. As duas **encurtam** animações para
1 ms em vez de removê-las — código que espera `animationend` (as reações, os avisos) continua
funcionando — e zeram os atrasos de transição (o painel que some "depois de a coluna fechar" some
na hora). Nunca escreva `animation:none!important` global: uma
regra assim em `sala.css` deixava as reações da sala presas na tela. Animação que **precisa**
continuar visível com menos movimento (a reação discreta, que diz quem reagiu) vence o 1 ms com
`!important` e especificidade maior, nos dois níveis. E quem remove um elemento no
`animationend` põe também um prazo de segurança (`toast.js`, `mostrarReacaoDaSala`). A prova é
`npm run test:aparencia`. A troca de tema desliza as cores por 280 ms, só durante a troca
(`html.trocando-tema`).

### 2.9 Camadas (z-index)

| camada | z | quem |
|---|---|---|
| peças dentro do palco e do quadradinho | 1–4 | selos, controles, placar de quem assiste |
| peças dentro do cartão de perfil | 1–8 | banner, avatar, bolha, moldura, efeito de abrir |
| botão "ativar som" | 65 | |
| lateral em gaveta (celular) / chat em gaveta (≤1100 px) / gaveta do início | 68 / 70 / 70 | |
| modal, o cartão de um amigo no início, e o portão de entrada | 80 / 80 / 90 | |
| a camada do início por cima da sala / o que ela pergunta (entrar noutra sala) | 84 / 86 | acima dos painéis, abaixo do aviso de pedido de entrada (110) e das novidades (125) |
| visualizador de imagem, reações que voam | 95–96 | |
| o visor da imagem da conversa direta, e o da foto de perfil ampliada | 97 | nascem de dentro de um painel |
| menu de presença, menu de mensagem, menus do início e dica da trilha | 105–106 | |
| os painelzinhos de cor e de emojis (`.nx-pop`, 4.17), e o fundo escurecido da folha deles no celular | 106 / 105 | em `body`, fora de qualquer painel |
| aviso de pedido de entrada | 110 | |
| botão de sair do compacto | 120 | |
| apresentação e novidades | 125 | |
| avisos no canto (toast) | 130 | |

Peça nova entra numa dessas faixas, e não num número novo no meio.

---

## 3. Temas

- **Modos:** escuro (padrão), claro e sistema (segue o aparelho, sem recarregar).
- **Oito temas prontos** (`tema.js`, `TEMAS`): Nexo, Meia-noite, Floresta, Carvão (escuros);
  Claro, Céu, Areia, Sakura (claros). Cada um é um matiz de fundo e uma cor de destaque.
- **Oito destaques de um clique**, livres para todos: violeta, azul, turquesa, verde, âmbar,
  coral, rosa, ameixa.
- **Cores exatas** (nível completo, regra do `NEXO_PLANOS`; com os planos desligados, que é como o
  Nexo roda hoje, são de todo mundo): a pessoa escolhe a cor de destaque e a do fundo. A escolha
  fica guardada mesmo quando o nível se perde, e volta com ele.

Como funciona: a pessoa escolhe no máximo duas cores, e `derivar()` tira delas a paleta
inteira com o **contraste conferido** — o botão cheio escurece até 4,6:1 com o branco, o texto
em destaque clareia até 8,5:1 com o painel, cada nível de texto é levado até o seu alvo. Não
existe escolha que produza texto ilegível. O tema padrão não calcula nada: os valores estão em
`tema.css`.

O que precisa de cuidado no claro:
- Dentro de `.contexto-escuro` (vídeo), os tokens voltam aos do escuro, e o destaque usa
  `--accent-hi-escuro`. Peça sobre vídeo herda isso de graça se usar os tokens.
- O nome colorido de quem escreve no chat (cor do perfil, feita para o escuro) é escurecido por
  filtro no claro: continua a cor da pessoa, legível.
- A barra do navegador no celular acompanha o fundo (`<meta name="theme-color">`).

`tema.js` roda no `<head>` antes da primeira pintura: um tema claro que nascesse escuro piscaria
a cada navegação.

---

## 4. As peças

### 4.1 Botões

| tipo | classe | aparência | quando |
|---|---|---|---|
| principal | (nenhuma) | `--accent-forte`, texto branco | a ação do painel; uma por painel |
| secundário | `.secondary` | `--bg-3`, texto `--text` | ação alternativa, "Fechar" |
| fantasma | `.ghost` | transparente, `--muted`; `--bg-3` no passar | ações de linha, ícones de lista |
| perigo | `.danger` | `--danger-suave`, texto `--danger-texto` | apagar, desligar links, expulsar |
| só ícone | `.icone-so`, `.botao-icone` | quadrado `--ctl-p`, `--r-sm` | X de painel, enviar, anexar |
| link com cara de botão | `.botao-link` (`.secundario` = contorno) | igual ao principal | navegação ("Criar conta grátis") |
| botão com cara de link | `.link-botao` | sublinhado, `--accent-hi` | ação no meio de uma frase |

Todo botão: aperta para 97%, desabilitado fica a 45% com cursor de proibido. Botão só de ícone
tem **sempre** `title` e `aria-label` com o verbo ("Silenciar a voz desta pessoa"). Botão que
liga/desliga usa `aria-pressed` — e o estado aparece no desenho (ícone cortado), não no texto:
o rótulo é o nome fixo da coisa ("Microfone", "Câmera", "Ouvir").

Confirmação no próprio botão: o botão de copiar vira **"Copiado"** (ou "Link copiado!") em verde
por um instante e volta — no Estúdio, 1,6 s. Não há aviso no canto para isso.

**Botão de três estados** (o repetir do canal de música: desligado, a fila, a faixa): um botão só,
que gira na ordem de todo tocador. O desenho diz o modo (as setas; com um "1" dentro quando é só a
faixa), um ponto embaixo e a cor `--accent-texto` dizem que está ligado, `aria-pressed` é
verdadeiro em qualquer modo ligado, e o `aria-label` leva o modo ("Repetir: a fila inteira"),
porque "pressionado" sozinho não diria qual. Ao servidor vai o modo que a pessoa viu como o
próximo, e não "avance um": dois cliques ao mesmo tempo chegam ao mesmo lugar.

**A ação que está acontecendo vira o seu "parar".** Na mesa de sons, o botão do som que **você**
tocou vira "Parar" (o quadrado cheio e o rótulo, em `--accent-texto`, sobre `--accent-suave-hi`)
enquanto o som dura, com uma barra de 3 px andando embaixo até o fim. Com menos movimento a barra
some — com a animação de 1 ms, ela diria "acabou" no começo do som.

### 4.2 Campos

`input`, `select`, `textarea`: borda de 7% de tinta, fundo `--bg-0`, `--r-md`. No foco a caixa
inteira acende — borda `--accent` e um anel de 3 px de `--accent-suave-hi` —, e não um contorno
solto. Quando o campo tem algo dentro (o "#" do código da sala), o foco acende a caixa toda
(`:focus-within`). Placeholder em `--faint`/`--apagado`, sempre um exemplo real ("Ex.: queria
poder deixar a sala aberta…").

### 4.3 Interruptor, segmentado, escolhas

- **Interruptor** (`.toggle-line` com checkbox `role="switch"`, ou `input.interruptor`): 38×22,
  bolinha branca e trilho `--accent` ligado; texto à esquerda em duas linhas — `strong` com o
  que é, `small` com a consequência ("Desligar tira do ar na hora o que já estiver lá").
- **Segmentado** (`.segmentado`): rádios escondidos com `span` por cima; o escolhido é
  `--accent-forte` com texto branco. Para 2–4 opções exclusivas e curtas (efeito, formato, de
  onde vêm as imagens). Versão pequena: `span` de 26 px e `--fs-meta`.
- **Escolhas de cor e marca** (`.escolhas`, `perfil.js` monta): bolinhas de 36 px; a escolhida
  ganha anel de destaque; a primeira é sempre "o padrão" (valor vazio).
- **Temas e destaques** (`.temas-grade`, `.destaques`): cartão com miniatura do próprio tema;
  bolinhas de 28 px.

### 4.4 Réguas e números

- **Régua fina** (`.volume-slider`): `accent-color` do destaque; âmbar quando passa de 100%.
- **Régua grande** (`.volume-regua`, a folha de volume): trilho de 8 px preenchido até o valor,
  polegar branco de 28 px nos dois temas.
- **O valor fica sempre à vista ao lado**, e **se digita**: clicar no número o transforma num
  campo com a unidade ao lado (`valor-digitado.js`). Enter ou sair aplica, Esc desiste, o que
  passa do limite fica no limite. Por isso toda régua tem passo 1.
- O 100% "gruda" no arrasto (±4 na régua fina, ±5 na folha), porque voltar ao normal é o gesto
  mais comum; o digitado não gruda.

### 4.5 Painéis (modais)

Todo painel é a mesma peça (`.modal` > `.modal-card`):

- fundo da página escurecido (`#0d0d16ed`), cartão `--bg-2`, `--r-xl`, `--sombra-modal`,
  largura padrão `min(100%, 470px)`, altura até 88% da janela com rolagem **dentro** do cartão;
- entra com `nexo-surgir`;
- **um X no canto** de todo painel que se fecha, posto por `room-ui.js` — Esc e clicar fora
  também fecham, mas nenhum dos dois se descobre olhando, e no celular não há Esc;
- `h2` + `.modal-sub` (o que é e para que serve, em uma ou duas frases);
- **rodapé com as ações preso embaixo** (`.modal-actions`, `sticky`) enquanto o conteúdo rola.
  No HTML a ordem é de importância (principal primeiro); na tela, `row-reverse` põe a principal
  à direita. "Fechar" (`[data-close]`) é sempre cinza;
- no celular, as ações empilham em largura cheia com 44 px, a principal em cima;
- o foco entra no primeiro campo (ou no primeiro botão), fica preso no painel pelo Tab e volta a
  quem o abriu; com o painel aberto, a sala por trás fica `inert`. Quando o primeiro campo não é o
  lugar de começar (no editor do cartão ele é o seletor de cor), `data-foco-inicial` marca o que
  recebe o foco.

**Painel sobre painel** é permitido quando o segundo nasce do primeiro (a foto grande — que é o visor
de `foto-grande.js`, por cima de qualquer painel, e não um `.modal` — sobre o
cartão de perfil, o aviso de sair para a conta sobre "Meu perfil"): o de cima vem depois no HTML, e
fechá-lo volta ao de baixo.

**A sala não manda ninguém para outra aba, e quem tem conta não sai da chamada para ver outra
página.** No aplicativo, "outra aba" é o navegador, fora do Nexo. O que dá para fazer ali dentro
vira painel (o cartão completo, abaixo) ou **camada** (o início e a conta, em 5.2): a página
inteira, por cima da sala, com a chamada de pé por baixo. A marca do Nexo, Ctrl K, "Senha e conta"
e todo link para `/conta` de quem tem conta abrem a camada.

O que **muda quem entrou na sala** — criar a conta, que vira outra identidade na mesma sala — não
cabe numa camada: abre **na mesma janela**, depois de um painel que avisa que a pessoa sai da
chamada (a ação de sair é `.danger`, "Continuar na sala" é o cinza). Vale para **todo "Criar conta
grátis" de dentro da chamada** (nas configurações, no Estúdio, em Meu perfil, na mesa de sons, na
dica de qualidade, no próprio cartão): `perfil-sala.js` intercepta o clique e mostra o aviso. A
saída passa por `sairDaSala` (`sala.js`), que avisa a sala e desliga a mídia direito, com
`/conta?voltar=`: o cadastro termina de volta na mesma sala, já com a conta. Antes de entrar (a
porta, a espera) e depois de sair (o aviso de remoção), o link troca a página direto: não há
chamada para perder. Ctrl ou Shift no clique continua abrindo noutra aba, que aí é escolha de quem
clicou.

Variações do mesmo cartão: as **configurações** (coluna de seções à esquerda como no Discord,
altura fixa para não pular ao trocar de seção; no celular as seções viram uma fita que rola de
lado), o **Estúdio** (sem preenchimento, com topo, corpo em duas colunas e rodapé próprios), o
**editor do cartão** (largo, de altura fixa, sem preenchimento: o editor rola por dentro e tem o
rodapé de salvar dele; no celular ocupa a tela quase toda) e a **folha de volume**, que no celular
vira folha presa embaixo, da largura da tela, subindo de baixo.

Dentro de um painel:
- **`.config-bloco`**: borda `--line`, `--r-lg`, fundo de 1,6% de tinta, 14 px de folga — o
  grupo de controles que andam juntos;
- **`.config-rotulo`** (rótulo de grupo), **`.config-dica`** (a explicação em `--faint`, depois
  dos controles);
- **`.avancado`** (`<details>`): o ajuste que quase ninguém mexe fica dobrado;
- **`.abas-fita`**: abas que grudam no topo enquanto o conteúdo rola.

### 4.6 Menus e listas que surgem

Menus de contexto (`.msg-menu`, `.presence-menu`), a lista de menção e o placar de quem assiste:
fundo `--bg-1`, `--r-lg`, `--sombra-menu`, entrada `nexo-surgir`. Itens de `--ctl-p`, passar o
mouse de 5,9% de tinta, ação de perigo em `--danger-texto`. **O menu é ancorado pelo JS no botão
que o abriu**, nunca a uma distância fixa da quina — a lateral recolhe e no celular é gaveta.

**Mudar o tamanho da janela reposiciona o menu, e não o fecha.** No celular, o teclado que sobe para
um campo do menu muda o tamanho da janela: fechar no `resize` levava o campo e o teclado junto, e
"Entrar numa sala pelo código" abria e sumia antes de dar para digitar (`posicionarMenu`, no
`inicio.js`). A prova é `npm run test:inicio`, que encolhe a janela com o balão aberto.

**Uma escolha entre várias** (o status do "eu" do início, `abrirMenu` em `inicio.js`) leva o ponto do
cartão no lugar do ícone (`.nx-ponto`, 4.14) — no espaço de um ícone de 16 px, para o rótulo de todos
os itens começar no mesmo lugar — e a escolhida fica com o destaque do menu de status da sala (o
fundo e a cor do destaque, com um contorno fino), marcada por `role="menuitemradio"` e
`aria-checked`, que é o que o leitor de tela lê. Quatro carinhas iguais e um visto não diziam o que
cada opção era. A prova é `npm run test:status`.

### 4.7 Avisos no canto (`toast.js`)

Um canto só, a mesma peça em toda página: ícone num quadrado de 34 px, título e linha de meta,
barra de progresso opcional (com modo indeterminado), ações opcionais e o X. Tons: neutro,
`ok` (verde) e `erro` (vermelho). O aviso é um objeto vivo — quem cria atualiza e fecha. Na
página inicial fica embaixo à direita; **na sala desce do topo**, abaixo da barra de cima,
porque o canto de baixo é do chat e da barra de controles. Texto sempre por `textContent`.

Use para o que demora ou acontece longe do clique (download, atualização). Não use para
confirmar um clique — isso é o próprio botão (4.1).

**Atividade na sala** (`atividade.js`): quando alguém compartilha a tela ou põe uma música e o palco
não está à vista de quem recebe — o chat em foco, o início por cima da sala, outra aba ou a janela
em segundo plano —, sai um aviso com o ícone da atividade, quem foi e **Assistir** (que traz o
palco). Quem já está olhando o palco não recebe nada: seria repetir o que está na tela. Junto vai um
ponto no título da aba ("● …") e, com a permissão dada, uma notificação do sistema **sem som**. As
duas chaves moram em Configurações → Sons ("Avisos na tela"); **Não incomodar** cala só a
notificação do sistema.

**Um aviso que fica** (`fecharEm` ausente) é para o que a pessoa precisa saber e não pode perder numa
frase da barra de status: o som da tela que não chegou (docs/audio-da-tela.md) é o exemplo.

### 4.8 Selos, chips, contagens

- **Selo** (`.estudio-selo`, `.selo-completo`, `.session-badge`, `.dono-selo`): caixa alta
  `--fs-rotulo`, peso 700–750, pílula ou raio de 6 px, cor da família (rosa ao vivo, âmbar
  nível completo, verde na sala, vermelho recusa). O selo do nível completo só aparece com os
  planos ligados e para quem não o tem.
- **Chip** (`.estudio-link`): pílula `--bg-3`, ícone + rótulo, 28–30 px; o ponto verde no fim
  diz "no ar agora".
- **Contagem** (`#joinRequestCount`, número de mensagens fixadas): círculo pequeno, cor cheia.
- **Pílula sobre vídeo** (`.espectadores`, `.obs-selo`, `.presence-badge`): fundo escuro
  translúcido fixo com desfoque — está sobre o vídeo, então é igual nos dois temas.

### 4.9 Avatares e pessoas

Todo avatar é pintado por **`NexoPerfil.pintar(el, nome, perfil)`**: a foto, se houver; senão
a cor escolhida (ou a sorteada pelo nome, sempre a mesma) com a marca escolhida ou as iniciais.
A cor fica por baixo da foto e aparece enquanto ela carrega.

| onde | tamanho | forma |
|---|---|---|
| menção, placar de quem assiste | 18–24 | círculo |
| chat | 28 (22 no compacto) | quadrado arredondado |
| lista lateral e o "eu" de baixo | 30–32, com o ponto de status da conta (4.14) | quadrado arredondado |
| quadradinho sem câmera | 36 | quadrado arredondado |
| Estúdio, folha de volume | 36–44 | círculo |
| amigos e conversas (início, convidar, mensagens) | 34 (`.nx-av.pequeno`) ou 44 (`.medio`), com borda e ponto de status | círculo |
| cartão de perfil (a vitrine) | 86; 68 no compacto da sala (a foto se abre grande) | círculo |
| configurações → perfil | 72, sobre uma faixa de destaque | círculo |

Quem fala ganha **anel verde** (`--online`) no quadradinho e na lista. O microfone mudo é o
microfone cortado em vermelho no canto de baixo do quadradinho e ao lado do nome na lista; quem
ensurdece troca esse ícone pelo fone cortado (o mesmo do botão Ouvir), no mesmo lugar.

**O perfil abre de qualquer lugar onde a pessoa aparece:** a lista, o nome embaixo do
quadradinho, o quadradinho de quem não tem câmera — também quando a pessoa compartilha a tela,
que tem o quadradinho dela ao lado para ir ao palco —, e o nome e o avatar do autor no chat
(`abrirPerfil`). Nomes clicáveis sublinham ao passar o mouse.

**A foto abre grande onde ela é o assunto** (`public/foto-grande.js`, o visor de `cartao.css`): o
avatar do cartão de perfil — no início, na sala e na prévia do editor, porque quem liga é o
próprio `NexoCartao.montar` —, o do topo da página da conta, a prévia do "Meu perfil" e o resumo
das configurações. Com foto, o avatar vira botão (`.nx-ampliavel`: cursor de lupa, cresce 3% ao
passar o mouse, anel de foco, `role="button"`, "Ver a foto de Fulano maior"); sem foto, continua
sendo só um desenho, porque a cor e as iniciais são as mesmas em qualquer tamanho. O visor é a
caixa quadrada do tamanho da foto (até 440 px, nunca mais alta que a janela), com a moldura, o fundo
do cartão e o estilo do nome da pessoa, o X em cima da foto e o código embaixo. **Esc fecha só a
foto** (o Esc é ouvido na janela, antes de qualquer outro) e o foco volta ao avatar; clicar fora
também fecha. Avatar de linha de lista, de mensagem e de quadradinho não amplia: ele abre o cartão,
e é o cartão que amplia. Tela nova com foto de pessoa liga o avatar com
`NexoFoto.ampliavel(el, { foto, nome, codigo, vitrine })` e desliga com `null`.

**O X do visor traz a base de botão inteira** (`cartao.css`, `.nx-foto-fechar`: círculo de 30 px, fundo
escuro fixo, X branco), e não herda a de `social.css`: a página da conta não carrega essa folha, e
ali o `button` global de `home.css` o pintava de roxo, com 100% de largura e 44 px de altura mínima —
um oval sem X. Peça que nasce em `body` e vive em páginas com folhas diferentes não pode depender de
uma folha que só algumas carregam (seção 8). A prova é `npm run test:foto`, que mede o X nas três
páginas.

**A foto troca no editor do cartão** (4.13): o grupo "Foto de perfil", o primeiro da aba Visual, no
início e no painel da sala. Ela vale ao ser escolhida, sem o "Salvar o cartão" — é da conta, e não do
cartão —, e a prévia, o "eu" do início e a sala a recebem na hora.

Nome repetido na sala ganha um trecho do código ao lado (`rotuloDe`) — só quando se repete.

### 4.10 Ícones

SVG desenhado em traço, `viewBox="0 0 24 24"`, `stroke-width` 1,8 (1,9–2,2 em tamanhos muito
pequenos), pontas e junções redondas, `fill:none`, cor `currentColor`:

- `.ico` 18 px, `.ico-p` 15 px, `.ico-g` 21 px;
- botões da barra de controles e da barra de cima usam **máscara CSS** com o desenho numa
  variável (`--control-icon`, `--icone-topo`): o botão pinta o ícone com a cor do texto e troca
  o desenho por estado (microfone → microfone cortado);
- nada de glifo de texto como ícone (✎ ⌁ ⚙ mudavam de desenho a cada fonte); emoji só para o
  que é emoji (reações, presença);
- **um desenho por conceito**, o mesmo em toda parte: microfone cortado, fone cortado, olho,
  câmera, tela, link, lixo. Antes de desenhar, procure o existente (`ICONES` em
  `public/estudio.js` e `public/novidades.js`, `ICONES` das conquistas em `public/cartao.js`,
  máscaras em `sala.css`);
- **conceitos vizinhos, desenhos diferentes**: a **câmera** é a filmadora; o **Estúdio** (levar
  para o OBS) é o ponto com ondas dos dois lados, de transmissão. Dois botões lado a lado na mesma
  barra com o mesmo desenho faziam ligar o errado.

### 4.11 Superfícies de vídeo

O palco, o quadradinho e a grade são `.contexto-escuro`. Por cima do vídeo, as peças usam
fundo escuro translúcido fixo (`#16151edb` e parecidos) com borda de 7% de tinta. Os controles
do palco **somem depois de 2,5 s sem mexer o mouse** e voltam com qualquer movimento; ficam se o
foco estiver neles pelo teclado ou se alguém estiver digitando o volume.

### 4.12 Estados vazios e de espera

- **Vazio de verdade** (palco sem ninguém transmitindo): ilustração, uma frase de título, uma
  linha de explicação e até duas ações. A ilustração sai primeiro quando falta altura.
- **Passagem** ("Conectando…", "Recebendo vídeo…"): sem ilustração e sem botão
  (`.stage.so-mensagem`), para não parecer que acabou quando só está chegando.
- **Carregando**: anel girando pequeno (`nexo-girar`) ao lado do que espera, nunca uma tela
  inteira de carregamento.
- **Lista vazia**: uma frase em `--faint` dizendo o que vai aparecer ali e como fazer aparecer.
  Numa área grande (a lista de amigos), o mesmo com um ícone num quadrado de destaque, um
  título curto e, quando há, o botão que resolve ("Adicionar amigo").

### 4.13 O cartão de perfil (a vitrine)

O cartão que abre ao clicar em alguém — na sala, na lista de amigos, na conversa — é a vitrine da
pessoa (`cartao.js` monta, `vitrine.js` decide o que vale, docs/amigos-e-perfil.md):

- **De cima para baixo**: o banner (cor, animado ou imagem), o avatar com a borda escolhida e o
  ponto de status, a bolha de pensamento ao lado, e um **véu escuro** com o nome (no estilo
  escolhido), o apelido que quem vê deu, os pronomes, o código, a frase do status, a sala, a bio, as
  conquistas e "No Nexo desde". Embaixo, as ações de quem vê.
- **Sempre escuro** (`.contexto-escuro`), como o vídeo: é a arte da pessoa. As duas cores dela
  chegam como `--v1` e `--v2` e são só decoração; texto nunca é a cor crua — fica no véu, com os
  tokens do escuro, e o nome colorido é a cor clareada até ser legível.
- **O efeito de abrir** é um canvas transparente por cima, por 2,6 s, sem receber clique, que
  começa depois de o cartão ter tamanho. Com menos movimento, não toca, e as animações contínuas
  param no primeiro quadro.
- **Na sala** ele é compacto, ocupa o topo do painel de perfil de borda a borda, e o resto do
  painel (tempo na sala, amizade, OBS, ações) vem embaixo. O X do painel ganha fundo escuro fixo
  por estar sobre a arte. **O cartão de cima é sempre inteiro** — é a vitrine da pessoa, e a
  arte dela não se esconde. O que a sala acrescenta **embaixo** dele nasce minimizado
  (`.perfil-card.minimizado .perfil-detalhes`): o tempo na sala, a explicação do código ("O código é
  permanente…") e o "Levar para o OBS" esperam o **"Ver mais"** (`#perfilMais`, que vira "Ver
  menos"). A linha de amizade (adicionar, mensagem) fica acima do botão e os botões de baixo não se
  escondem: são o que a pessoa procura de imediato. Quem abre um cartão no meio de uma conversa quer
  saber quem é e falar com a pessoa; a explicação e as ferramentas do Estúdio são de depois. A
  escolha é lembrada (`perfilMinimizado`).
- **Fora do cartão** a pessoa aparece com o que escolheu em todo lugar (docs/amigos-e-perfil.md,
  "Onde a personalização aparece"): a borda em volta do avatar que o lugar já tem — no formato
  dele, `--borda-raio` (os da sala têm cantos arredondados), a um `--borda-anel` de distância —,
  o estilo do nome, e no quadradinho da plateia, na foto grande e no topo da conta também a
  moldura e o fundo do cartão. O estilo do nome mistura a cor da pessoa à `--tinta` do lugar
  (clareia no escuro, escurece no claro) e pinta a letra por `-webkit-text-fill-color`, para a cor
  própria de cada lugar não apagá-lo. No chat, no canal de música e na conversa, borda e nome
  animam só com o mouse em cima da mensagem.
- **O editor** é um só (`editor-cartao.{js,css}`), em dois lugares: a seção "Personalizar
  perfil" do início e um painel na sala (o "eu" da lateral, o próprio cartão, ou Configurações →
  Perfil), sem sair da chamada. É **o único lugar do perfil**: o apelido, a cor e a marca do avatar,
  a foto e o cartão (a seção "Nome e cor" é a primeira da aba Visual, e o "Salvar o perfil" salva o
  nome e o cartão juntos; a foto vale ao ser escolhida). Tem a prévia ao lado, ao vivo, e cada peça é
  um rádio de verdade com a amostra desenhada. Peça que pede o nível completo ou uma conquista mostra o selo e diz
  o que falta no título; escolher continua possível — fica guardado e vale quando a pessoa tiver.
  Duas colunas quando **o editor** tem 700 px ou mais (consulta de contêiner `editor`), uma só,
  com a prévia em cima, abaixo disso. As colunas rolam por dentro e o rodapé de salvar fica fixo
  embaixo, fora da rolagem — grudado (`sticky`) dentro do formulário, ele não subia acima do começo
  do formulário, e no celular nascia cortado embaixo da prévia.
- **O título "Personalizar perfil" só existe onde nada o diz**: o painel da sala, que não tem barra de
  cima. No início a barra de cima já diz o nome da seção, e o editor nasce `semTitulo` — repetir o
  título logo abaixo era ruído. A seção "Conquistas" também não repete o seu: o resumo e a barra de
  progresso vêm direto. A seção é nomeada pelo `h1` da barra (`aria-labelledby="tituloSecao"`).
- **A aba Visual** abre com a **foto de perfil** (4.9): o avatar de 64 px com a borda escolhida,
  "Enviar uma foto" / "Trocar a foto" e "Tirar a foto". Segue o **tema**: as dez bolinhas e, embaixo,
  as **cores exatas** — duas gemas ("Cor 1", "Cor 2", cada uma com a bolinha e o código), o degradê
  entre elas numa barra com o brilho das duas cores, **trocar de lugar** (as setas giram) e
  **sortear** (o dado rola por algumas combinações antes de parar numa). Cada gema abre o **seletor
  de cor** (4.17), no lugar do quadrado nativo do navegador, que cada sistema desenhava de um jeito e
  destoava do resto; o bloco leva o mesmo desenho do bloco "Cores exatas" das configurações de
  aparência (borda, fundo de 1,6% de tinta, rótulo em caixa alta).
- **As amostras do catálogo seguem as cores de agora**: as de banner, fundo, borda, moldura e estilo
  do nome mostram o cartão da pessoa, e não o do tema salvo. Com um tema elas são refeitas (`montar`);
  com as **cores exatas** são **repintadas no lugar** (`recolorir`, `editor-cartao.js`), no mesmo
  quadro da prévia — digitar o código, arrastar na área, uma cor pronta, trocar de lugar, sortear e
  "Usar as do tema". Para isso toda amostra pinta só com o par `--v1`/`--v2` (nunca com a cor escrita
  no JS) e fica registrada em `coloridas`: arrastar dispara dezenas de mudanças por segundo, e
  refazer cada amostra a cada quadro pesaria e tiraria o foco de quem escolhe pelo teclado. Uma
  amostra nova do catálogo entra nesse registro por `comCores`. As que têm paleta própria (Arco-íris,
  Fogo, Dourada, Holográfica, Prisma) seguem como são.
- **A aba Status** tem o **emoji da frase como um botão** que abre o seletor de emojis (4.17) — antes
  era um campo de texto com um 🎮 de exemplo —, com um X pequeno no canto para tirar o emoji; o valor
  vai num campo escondido, e o escolhido que ainda não foi salvo não é apagado por um repintar. A
  descrição ("Sobre mim") e a bolha de pensamento têm o botão da carinha ao lado do rótulo, que insere
  o emoji onde está o cursor.

### 4.14 Amigos, conversa direta e convites

- **A linha de um amigo** (`.nx-amigo`): avatar médio com borda e status, o nome (o apelido que
  você deu, com o dele miúdo ao lado), e embaixo a sala em verde ou o status, com a frase. As
  ações à direita: **Entrar** (verde, quando ele está numa sala; "Pedir" se ela estiver trancada),
  mensagem e "⋯". A linha inteira abre o cartão.
- **Status**: verde disponível, âmbar com a lua ausente, vermelho com o traço não incomodar, anel
  vazio desconectado (e invisível, para os outros). Sempre o mesmo desenho, do avatar da lista ao
  cartão. **Dentro da sala é o mesmo ponto**: ao lado do nome na lista da sala, no "eu" de baixo e no
  avatar do cartão de quem está nela. Ele vem no perfil de cada pessoa (`perfil.status`), muda na
  hora para a sala inteira quando ela troca o status em qualquer lugar (o menu da sala, o início, o
  editor, outra aba) e vale para quem entra depois; quem entrou sem conta é "disponível". "Volto já"
  (☕, o "agora na sala") é estar ausente: o ponto vira a lua mesmo para quem está "disponível" —
  sem mexer no status da conta, e sem desfazer o "não incomodar". Na lista da sala a lua e o traço
  são pintados na cor do anel (como no Discord); solto, no menu e no editor, são furos (`.nx-ponto`).
  "Invisível" é o anel vazio para todos — numa sala, quem está nela continua vendo a pessoa.
- **O menu de status da sala** (`#presenceMenu`, o botão da carinha ao lado do "eu"): de cima para
  baixo, **"Seu status"** (só com conta: Disponível, Ausente, Não incomodar, Invisível, com o ponto
  e uma linha embaixo dizendo o que o escolhido faz), **"Agora na sala"** (Nada em especial, Quero
  falar, Volto já, Em jogo, Sem falar: vale só enquanto a pessoa está ali) e **"Reagir na sala"**
  (cinco emojis e o "+" do seletor, 4.17). Com o status da conta o menu ficou alto: numa janela
  baixa (o celular deitado) ele cabe na tela e rola por dentro, em vez de ter o começo cortado.
- **A conversa** (`conversa.js`): a mesma peça no início e no painel de mensagens da sala. Diz uma
  vez, no topo, que as mensagens ficam só na memória e somem em três dias. Mensagens seguidas da
  mesma pessoa em cinco minutos se agrupam; a própria se apaga para os dois; "Visto" embaixo da
  última lida; "fulano está escrevendo…" em itálico, sem pular nada.
- **A imagem na conversa**: o botão de imagem à esquerda do campo (ou colar, ou arrastar), uma
  prévia acima do campo até enviar — com "Tirar" —, e na mensagem a imagem com o lugar já
  reservado pelas dimensões (até 360 × 300), que abre grande num visor (`.nx-dm-visor`, clicar ou
  Esc fecha só ele). A que saiu da memória do servidor vira uma linha em itálico dizendo isso. O
  andamento ("Preparando a imagem…", "Enviando a imagem…") sai em `--muted`, e não no vermelho
  dos erros.
- **As reações na mensagem direta**: ao passar o mouse (ou tocar) numa mensagem aparece uma barrinha
  com as cinco reações rápidas e o "+" do seletor de emojis (4.17). A reação vira uma pílula embaixo
  da mensagem (`.nx-dm-reacao`: o emoji e a contagem, destacada quando é a sua), que liga e desliga
  no clique, e o `title` diz quem reagiu ("Você, Bia"). Só amigos reagem, qualquer emoji inteiro
  vale (a mesma regra da sala, `ehUmEmoji`), até 20 diferentes por mensagem — e reagir não acende
  notificação nem a contagem de não lidas.
- **O painel de mensagens da sala muda de tamanho pelo canto** (seção 5): arrastar, as setas, duplo
  clique para voltar ao padrão (880 × 640); o tamanho é lembrado.
- **O convite** é uma mensagem com cartão próprio (ícone de porta, "#sala", botão Entrar na sala) e
  um aviso no canto de quem recebe, onde estiver — inclusive no meio de outra chamada, dizendo que
  entrar sai dela.
- **Avisos**: mensagem nova fora da conversa aberta vira aviso no canto com "Responder"; "Não
  incomodar" segura os de mensagem (a contagem continua) e deixa passar os convites, que pedem uma
  decisão. Pedido de amizade novo e conquista ganha também avisam. **"Não incomodar" cala também o
  som do chat da sala** — a mensagem comum e a menção, que são as duas que tocam — e o aviso do
  sistema da menção (a aba escondida); a mensagem continua marcada no chat, para quem olhar. O que é
  da chamada (entrar, sair, tela, o microfone) segue tocando: quem não quer ser incomodado quer
  continuar ouvindo a sala. No Android, o aplicativo não recebe pedido de notificação de mensagem.
- **Menus** do início caem do botão que os abriu (4.6) e confirmam no próprio menu o que é de
  perigo ("Remover a Bia dos amigos? A pessoa não é avisada.").

### 4.15 O que está tocando

O cartão do canal de música tem duas linhas: em cima a capa (48 px) e, ao lado, o rótulo
("TOCANDO", com o ponto verde pulsando, ou "PAUSADO" em âmbar) dividindo a linha com o tempo, o
título e o autor; embaixo, a linha de um tocador — pausar, pular, a barra de progresso e o
repetir. Os controles ao lado do título o espremiam em dez letras numa coluna de 266 px. O rótulo
perdeu o "AGORA" pelo mesmo motivo: o ponto pulsando já diz que é agora.

### 4.16 O aplicativo, visto de dentro

- **"Aplicativo de mesa"** é uma seção das configurações que só existe no aplicativo de mesa
  (`atualizacao-app.js` a mostra). Tem a versão e o estado dela ("instalado · se atualiza
  sozinho", "a 1.3.0 está pronta: reinicie para usar") com **Procurar atualização** ao lado, e os
  interruptores **Atualizar sozinho** e **Abrir ao entrar no computador**. No portátil, a dica diz o
  que ele não faz e onde está o instalador. O menu do aplicativo fica escondido (Alt mostra), e o
  que só existe num menu escondido ninguém descobre.
- **A atualização do instalado não aparece enquanto desce.** Só o fim: um aviso, uma vez ("Ele se
  instala quando você fechar o Nexo"), e o botão **Reiniciar** no topo. O progresso só aparece
  quando foi a pessoa que pediu.
- **A versão nova aparece fora da sala também.** O botão **Atualizar** (verde, o ícone de
  download) mora no topo da sala e no topo do início, antes do "Adicionar amigo"; abaixo de
  1400 px os dois ficam só com o ícone, para não apertar as abas. Numa página sem esse botão (a
  apresentação, que é o que o aplicativo abre sem conta) o mesmo convite vem no canto, com
  **Atualizar agora** e **Depois**. No Android o fim é **Instalar** em vez de Reiniciar, e o
  aviso diz que instalar fecha o Nexo (e, na sala, que a chamada cai).
- **Os downloads da página inicial**: o sistema de quem lê ganha o botão cheio, na forma que se
  instala (o instalador antes do portátil; o APK num Android), e as outras formas viram pílulas
  de 32 px embaixo ("Linux .deb"), com tamanho e versão no `title`. Dentro do aplicativo Android a
  seção não aparece: seria oferecer o que a pessoa já tem.

### 4.17 Painelzinhos ancorados: o seletor de cor e o de emojis

Um painelzinho que abre ao lado de um botão, para escolher uma coisa e sumir. A base é uma peça só
(`popover.{js,css}`, `NexoPopover.abrir(botao, montar, opcoes)`), e o seletor de cor e o de emojis
moram em cima dela. Primos do menu (4.6), mas com campos dentro.

- **Camada 106** (2.9), em `body`, fora de qualquer painel. **É `role="group"`, e nunca
  `role="dialog"`**: o `room-ui.js` trata todo dialog como modal e congelaria a sala (seção 8).
- **Ancorado e preso à janela**: abre para baixo, para cima quando não cabe (o botão do chat fica no
  pé da janela), nunca sai pelos lados. Acompanha o botão quando a página rola ou a janela muda de
  tamanho — o chat rola sozinho quando chega uma mensagem, e fechar a cada rolagem era um defeito —
  e fecha só se o botão sai da janela. **No celular (até 520 px) vira uma folha embaixo**, com o fundo
  escurecido: o polegar alcança, e o teclado da tela não esconde o campo de busca. **Cabe sempre na
  janela**: numa janela baixa (o celular deitado tem uns 300 px) o conteúdo rola por dentro, em vez de
  ficar cortado para fora da tela (o seletor de emojis ajusta a altura; o de cor rola).
- **Um de cada vez**; o **Esc fecha só ele** (é ouvido na janela, antes de qualquer outro, e o painel
  de onde veio continua aberto) e o foco volta ao botão; o Tab gira dentro dele. **Clicar fora
  fecha**, e o clique que fechou não vale para o fundo de um painel (senão o painel fechava junto), para
  o próprio botão (senão fechar e reabrir era um clique só) nem para o toque no fundo escurecido da
  folha — esse fecha no `pointerdown`, o fundo sai da página, e o `click` que o navegador sintetiza
  depois cairia num botão da barra que o dedo nem mirava; em qualquer outro botão ele passa. Fecha
  também quando o painel de onde veio fecha.
- **Defende-se das regras globais** (seção 8): a base de botão do painelzinho (`.nx-pop button`,
  (0,1,1)) lê fundo e cor de `--nx-fundo` e `--nx-cor`, e o passar do mouse (0,3,1) vence o da sala.

**O seletor de cor** (`seletor-cor.{js,css}`, `NexoCor.abrir(botao, { valor, rotulo, paleta,
aoMudar })`): a área de saturação e brilho com a bolinha (arrastar com o mouse ou o dedo; as setas
andam, Shift de dez em dez), a régua do matiz, o código da cor (`#rrggbb`; aceita `#abc` e sem o
`#`; o inválido marca o campo e não muda nada), o conta-gotas onde o navegador tem e uma fileira de
cores prontas — as dez vivas e as dez fundas dos temas do cartão, conforme a gema. `aoMudar` recebe
o `#rrggbb` a cada movimento; quem usa refaz a prévia no máximo uma vez por quadro. O servidor só
guarda `#rrggbb` (`vitrine.js`). `NexoCor.sortear()` devolve duas cores que combinam, uma viva e uma
funda. **Falta trocar os dois quadrados nativos das cores exatas das configurações de aparência**
(`.cor-exata`), que seguem o padrão visual de pílula mas ainda abrem o seletor do navegador.

**O seletor de emojis** (`emojis.{js,css}`, `NexoEmojis.abrir(botao, { aoEscolher })`): todos os
emojis, com o topo da **busca** (o nome e as palavras-chave em português, sem acento, em qualquer
ordem; "coração" traz o vermelho primeiro), a barra de **categorias** (os usados por último, e as
nove do Unicode), a grade que rola com o título da categoria grudado no alto, e o **rodapé** com o
emoji sob o mouse e o nome, e os seis **tons de pele** (o padrão e os cinco). O que a pessoa lembra
fica no navegador (`localStorage`: os 24 usados por último e o tom) e não vai para o servidor. Teclado:
a busca recebe o foco (no toque, não: o teclado da tela não sobe sozinho), seta para baixo desce para
a grade, as setas andam por ela (para baixo e para cima vale o desenho), Enter escolhe — na busca,
escolhe o primeiro resultado —, **Shift+clique escolhe e deixa aberto**.

- **A lista** é `public/emojis.json`, gerada de uma vez por `npm run emojis:gerar`
  (`scripts/gerar-emojis.cjs`) a partir da lista oficial do Unicode (`emoji-test.txt`) e dos nomes em
  português do CLDR; a página a pede na primeira vez que o seletor abre (170 KB que quem nunca o abre
  nunca baixa). Refazer quando sair um Unicode novo: o script baixa as fontes numa pasta temporária.
- **Só aparece o que o aparelho sabe desenhar.** A lista é a do Unicode mais novo, e um emoji que a
  fonte do sistema não tem sai como um quadrado: o seletor desenha, numa tela escondida, um emoji de
  cada versão (o `testes` do json) e esconde as versões que saem sem cor — nos compostos, as que saem
  como dois desenhos — e as bandeiras de país, que o Windows não desenha (apareceria "BR"). Quem
  recebe um emoji que o aparelho dele não tem vê o quadrado: é o limite de usar a fonte do sistema.
- **Onde ele entrou**: o emoji da frase do status; a descrição e a bolha de pensamento do perfil
  (inserem onde está o cursor, respeitando o `maxlength`); o campo do chat da sala e o da conversa
  direta (o botão da carinha entre o campo e o enviar; o foco volta ao campo); as **reações das
  mensagens** (o "+" do menu rápido e o "+" no fim da fileira de reações) e as **reações da plateia**
  (o "+" do menu de status). **O canal de música não tem**: ali se pede música, e emoji no pedido só
  atrapalharia a busca.
- **A regra no servidor** é a forma, e não uma lista: reação é **um emoji inteiro** (`ehUmEmoji`, em
  `vitrine.js`) — o composto, a bandeira, o tom de pele —, e nada mais, porque ela é a chave de um
  mapa guardado com a mensagem e vai para a tela de todo mundo; uma mensagem aceita até **20 emojis
  diferentes**, e quem tira a última reação de um emoji leva a chave junto. Era uma lista de cinco.

---

## 5. Leiaute da sala

A sala é uma grade: **lateral | palco | chat**, com a barra de cima e a de controles.

| largura da janela | o que muda |
|---|---|
| ≥ 1600 | lateral 240, chat 320 |
| padrão | lateral 224, chat 292, barra de cima 64, barra de controles 84 |
| ≤ 1250 | lateral 200, chat 266, controles mais estreitos |
| ≤ 1100 | o chat vira gaveta (360 px) que entra pela direita, com botão na barra de cima |
| ≤ 760 | uma coluna: a lateral vira gaveta, barra de cima 57, controles 81 + área segura |
| ≤ 430 | a barra de controles fica só com ícones (o nome continua para o leitor de tela) |

Por altura: abaixo de 800, 690 e 480 px a ilustração do palco encolhe, some, e por fim a plateia
sai, para o palco continuar com espaço.

As larguras das colunas são `--col-lateral` e `--col-chat-aberto` (de onde vem `--col-chat`),
redefinidas em cada degrau; a barra recolhida e o chat fechado só zeram a sua (2.8).

**O topo da lateral** é uma linha com dois itens: o link da marca (para quem tem conta, abre o
início por cima da sala — 5.2; sem conta, sai da sala para a apresentação) e a estrela das
novidades. Onde "seu espaço" não cabe ao lado de NEXO (lateral de 224 px ou menos), a frase
desce para baixo dele (consulta de contêiner `marca`) — a estrela já foi posta por cima, com posição
absoluta, e passava sobre a frase.

**A caixa de conexão**, embaixo da lateral, é o estado em cima (o ponto, "Conectado à sala" e o
relógio, cada um numa linha só) e as ações numa fileira de botões iguais embaixo (mensagens,
sugestões, diagnóstico), como o painel de voz de um app de chamada. Com os ícones ao lado do texto,
numa lateral de 200 px, cada texto quebrava em duas linhas.

**O tamanho do chat é de quem conversa** (`redimensionar.js`). Uma alça fina na borda do painel —
a da esquerda do chat, no mesmo lugar nas duas formas dele (coluna e gaveta) — arrasta o painel,
anda com as setas (16 px, Shift ×4), vai às pontas com Home/End e volta ao padrão com o duplo clique
ou Enter. É um `role="separator"` com `aria-valuenow/min/max`, e a largura fica entre 240 e 720 px
(420 enquanto há uma tela no palco: o palco nunca é espremido além do que se enxerga). A escolha é
lembrada. No celular, onde o chat é a tela inteira, a alça não existe. O canal de música tem a alça
dele (`#musicaAlca`) e vale a mesma largura; a janela de mensagens usa a mesma peça num canto de dois
eixos (`role="button"`, mesmas setas).

**O meu perfil**, no pé da lateral, tem o estado do microfone embaixo do nome, numa linha só. Entre
o avatar e os dois botões sobram de 56 a 96 px para ele no computador, e "Microfone desligado" pede
103: ali vale a **forma curta** ("Mic mudo", "Mic ligado", "Ensurdecido", "Fora da sala"), com os
espaços um pouco mais justos; a frase inteira fica para a gaveta do celular, onde cabe, e para o
`title` (consulta de contêiner `eu`). As duas formas estão no HTML e o CSS escolhe — a frase não
muda de tamanho a cada segundo, quando o relógio da sala repinta.

### 5.1 O início de quem tem conta

`/` com a sessão aberta: **trilha | lateral | centro | Agora no Nexo**.

| largura | o que muda |
|---|---|
| padrão | trilha 72, lateral 264, "Agora no Nexo" 340 |
| ≤ 1250 | lateral 240, "Agora" 300 |
| ≤ 1100 | "Agora no Nexo" sai da direita e as salas ao vivo descem para o topo dos amigos |

O editor do cartão não segue esta tabela: ele decide pela própria largura (4.13), então tem duas
colunas a 1440 e entre 1012 e 1100 px, e uma só (a prévia em cima) a 1250 e no celular.
| ≤ 760 | uma coluna: trilha e lateral viram gaveta (botão no topo), as abas descem para uma linha própria |
| ≤ 430 | os botões de linha ficam só com o ícone (o nome continua para o leitor de tela) |

A trilha mostra as salas recentes deste aparelho (`localStorage`, até 12), cada uma com a cor
sorteada pelo código e as duas iniciais; o número verde no canto é quantos amigos estão nela agora.

**A busca** (o alto da lateral) é um campo de verdade, no padrão de combobox: digita-se nele mesmo,
e as sugestões caem embaixo — vazio, os amigos; com texto, os amigos e as salas recentes que
batem, e "Entrar na sala #código" quando o texto é um código e não um amigo (ou começa com `#`). O
foco fica no campo: as setas andam pela lista, Enter segue a marcada (com texto, a primeira), Esc
fecha a lista e, de novo, apaga o texto; tocar fora fecha. A lista é um `.nx-menu` preso ao campo
pelo CSS, então o teclado do celular não a tira do lugar. Antes era um botão que abria outro campo
num balão, com "Ctrl K" escrito ao lado — o atalho continua, só não ocupa mais o campo.

**Consultas de contêiner** onde a peça divide a janela com outras e a largura da janela mente:

- **A barra de cima** (`container: topo`) tira as peças **pela ordem do que importa menos**:
  quantas pessoas e o relógio (a lateral também diz), os rótulos que só repetem o ícone, o selo
  do tipo de sala; depois os botões viram ícone. O nome da sala é o último — encolhe com
  reticências e nunca empurra ninguém.
- **O palco** (`container-type: size`) decide pelo próprio tamanho o que cabe nele.
- **A lista de pessoas do Estúdio** (`container: estudio-pessoas`) desce as imagens para uma
  linha própria, com legenda, quando fica estreita.

### 5.2 O início por cima da sala (a camada)

Para quem tem conta, a **marca do Nexo** na lateral, **Ctrl K** e "Senha e conta" abrem a página
inteira — o início (`/`) ou a conta (`/conta`) — **por cima da sala, sem sair da chamada**. Antes,
ver os amigos, as mensagens ou as conquistas pedia sair: o microfone, a câmera e a tela paravam, e a
sala via a pessoa ir embora.

- **É um painel como os outros** (4.5, `.modal.camada`, camada 84 em 2.9) que ocupa a janela: a sala
  vira `inert`, o Esc fecha, o foco entra na página e volta a quem abriu. Fica depois de todos os
  painéis no HTML, porque `room-ui.js` trata como o de cima o último `[role="dialog"]` visível. Não
  tem `.modal-card`, então não ganha o X — tem o "Voltar para a sala".
- **A página dentro é a de sempre**, num `<iframe>` da própria origem (`?camada=<sala>`; o lado de lá
  é `public/camada.js`, que põe `html.na-camada`). Não é a mesma página dentro da sala por uma razão
  só: o início e a sala têm regras globais de `button`, `input` e `h2` e ids repetidos (seção 8), e
  reaproveitar a página pronta, isolada, é o que mantém uma tela só para dois lugares. O quadro
  nasce a cada abertura e morre ao fechar, e leva o socket de amigos dele junto.
- **A barra do alto** é o que a chamada precisa à mão, porque a barra de controles fica por baixo e
  `inert`: o nome da sala com quantas pessoas e há quanto tempo (o ponto fica âmbar se a conexão
  oscila), **Microfone**, **Ouvir**, **Sair** (`.danger`) e **Voltar para a sala** (a única ação
  violeta). Os botões espelham os da sala e chamam as mesmas funções; Ctrl+Shift+M e D valem com o
  foco dentro da página. Abaixo de 760 px ficam só os desenhos (o nome continua para o leitor de
  tela), e abaixo de 430 o "Voltar para a sala" encurta para "Sala".
- **Fechar**: Esc (só quando não há nada aberto na página para ele fechar, e a pessoa não está no
  meio de um texto — um rascunho não some com um Esc), "Voltar para a sala", o "voltar" do navegador
  (abrir acrescenta uma entrada ao histórico, e é ela que sai) e escolher a própria sala. Ser removido
  da sala ou voltar à espera também fecham, porque esses avisos moram abaixo da camada.
- **Entrar noutra sala sai desta**, então a camada pergunta (`#camadaSairPanel`, camada 86) antes de
  `sairDaSala`. A sala da chamada é a primeira da trilha, com o anel verde; para quem já está nela,
  o botão é "Voltar para a sala", e "Chamar para uma sala" põe a sala dela em primeiro. Criar uma sala
  nova não aparece no convite de dentro da chamada: o convite sairia antes da pergunta.
- **Os avisos são os da página de dentro** com a camada aberta (a sala fica calada, senão o aviso
  viria duas vezes); fechada, voltam a ser os da sala. A apresentação das novidades não abre sozinha
  lá dentro.
- **Sair da conta e apagar a conta** tiram a pessoa da sala também — a conta é quem a abriu —, e a
  página diz isso nos botões. **Criar conta** continua sendo fora da chamada (4.5).

`npm run test:camada` prova a chamada de pé por baixo (o servidor e os outros nunca veem a pessoa
sair), a barra, os atalhos, o Esc, o Ctrl K, o histórico, o aviso único, a conta e a pergunta de
trocar de sala; `npm run test:layout` tem os três estados (`camada`, `camada:conta`, `camada-sair`).

---

## 6. Responsividade

Regras que valem para toda peça nova:

1. **Nada rola para o lado, nunca.** Texto longo corta com reticências (`min-width:0` no filho
   de flex/grid é quase sempre o que falta). A página inicial usa `overflow-x:clip` para a
   decoração que passa da borda.
2. **Nada se sobrepõe**: nenhum irmão de linha flex/grid por cima do outro, nenhum filho
   vazando pela lateral ou, dentro de painel, por baixo de um pai que não rola.
3. **Os degraus de largura** em uso: 1600, 1250, 1100, 980, 760, 640, 600, 560, 430/420, 350.
   **760 é a fronteira do celular**: abaixo dela tudo é uma coluna, as ações dos painéis
   empilham e as gavetas entram. Prefira um desses a inventar outro.
4. **Prefira consulta de contêiner** quando a peça vive ao lado de outras (barra de cima,
   palco, colunas de painel).
5. **Celular, área segura**: `env(safe-area-inset-*)` em tudo que encosta na borda de cima ou de
   baixo (barra de controles, folhas, gavetas, avisos).
6. **Toque é outra coisa que celular.** Há duas perguntas diferentes:
   - *a pessoa usa o dedo?* — `matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)')`
     (a classe `volume-toque`): decide **interação** (a régua fina vira pílula que abre a folha);
   - *o aparelho é um celular?* — `ehCelular` (`sala.js`): decide **o que o aparelho aguenta e o
     que faz sentido nele** (qualidade, o botão do Estúdio, que nunca aparece no celular).
7. **Alvos de toque**: no mínimo 32 px (pílula de volume, silenciar, chips), 44 px para a ação
   principal de um painel no celular. Campos com 16 px de letra.
8. **Sem passar o mouse não há `:hover`**: o que só aparecia ao passar o mouse fica à vista no
   toque, mas apagado (`@media (hover: none)` — ações da mensagem a 50%, o X de tirar imagem,
   as ações da fila).
9. **Janela baixa** também é caso: painéis altos tiram a frase de explicação abaixo de 560 px
   de altura; o celular deitado tem de caber.

`npm run test:layout` é a prova: 32 estados da sala (painéis, configurações, Estúdio, chat
fechado, lateral recolhida, foco no chat…) em até 22 larguras de 320 a 2560 px, mais as páginas
de fora. Painel ou estado novo entra na lista dele (`ESTADOS` em `tests/layout-browser.cjs`).

---

## 7. Acessibilidade

- **Foco visível em tudo** que recebe teclado: anel de 2 px `--anel-cor`, 3 px para fora
  (`:focus-visible`); campos acendem por inteiro (4.2); peça redonda usa `--anel-foco`.
- **Peça que não é botão e age como um** (nome no quadradinho, autor no chat, linha da lista,
  número da régua) ganha `role="button"`, `tabindex="0"` e Enter/Espaço.
- **Todo botão só de ícone** tem `aria-label` e `title` com o verbo; liga-desliga tem
  `aria-pressed`; a escolha entre opções é rádio de verdade (navegável pelas setas).
- **Texto só para o leitor de tela**: `.so-leitor`. Quando um botão perde o rótulo por falta de
  espaço, o texto fica em tamanho zero e a máscara desenha o ícone — o leitor continua lendo.
- **Painéis**: foco preso, Esc fecha, o foco volta a quem abriu (4.5). Não use `role="dialog"`
  fora dos painéis de verdade: `room-ui.js` trata todo diálogo como modal e congela a sala.
- **Regiões vivas**: o chat é `role="log"`, avisos de estado são `role="status"`.
- **Contraste medido** (2.3, 2.4), também nos temas que a pessoa monta.
- **Menos movimento** respeitado nos dois níveis (2.8).

---

## 8. Peças compartilhadas entre páginas

A sala e a página inicial têm **regras globais de `button`, `input`, `label`, `h2`** — a inicial
deixa todo botão violeta e de largura cheia; a sala pinta o fundo no `:hover:not(:disabled)`,
que pesa (0,2,1). Uma peça que vive nas duas páginas (o modal das novidades, os avisos, o campo
de digitar o valor) precisa se defender:

- zerar o que herda com `:where(button)` (peso (0,1,0)), para a classe de cada botão vencer sem
  `!important` — ou, num painelzinho (4.17), com `.nx-pop button` (0,1,1) e o passar do mouse a
  (0,3,1);
- **não depender de uma folha que só algumas páginas carregam**: o visor da foto grande nasce em
  `body` nas três páginas e dependia do `social.css`, que a da conta não tem; o X dele ficou roxo
  (4.9). A peça que nasce de fora de qualquer página traz tudo o que precisa;
- ler fundo e cor de variáveis próprias (`--nx-fundo`, `--nx-cor`) quando o passar do mouse
  precisa ganhar da sala;
- declarar tudo o que precisa (largura, altura, margem, letra) em vez de confiar no padrão;
- quando a especificidade precisar subir, subir com seletor longo e comentado
  (`input[type="text"].valor-digitado`), nunca com `!important`.

O que é comum a toda página mora em `tema.css`: tokens, avisos, ícones, escolhas de perfil,
número digitável, `.so-leitor`, entradas animadas.

---

## 9. O Estúdio e o OBS

O painel do Estúdio é um painel como os outros (4.5) e usa as peças das configurações. **O que
vai para o OBS é diferente**: `reativo.css` e `obs.css` usam cores fixas, porque são desenhados
por cima da transmissão de quem usa o OBS e ficam iguais em qualquer tema. A prévia do Estúdio
é o mesmo desenho do OBS, num palco xadrez de transparência — ajustar olhando um desenho que não
é o de verdade seria ajustar no escuro.

---

## 10. Sons

Princípios de `sons.js`, que valem para qualquer som novo:

- **baixo por padrão**, com volume e cada grupo ajustáveis nas configurações;
- **nunca em rajada**: o mesmo aviso não se repete dentro de um intervalo (450 ms a 5 s,
  conforme o evento); dez mensagens seguidas são um toque;
- **só o que muda a sala toca**: entrada, saída, tela começando e acabando, menção, pedido de
  entrada. Câmera não toca — ela liga e desliga o tempo todo;
- **ensurdecido, a sala fica em silêncio**, mas o que é sobre você continua (o próprio som de
  ensurdecer, o microfone, a conexão caindo);
- **a forma diz a função**: sobe quando alguém chega, desce quando vai embora. Timbres graves e
  macios — agudo foi recusado (`scripts/sons/compor.cjs`);
- saem pelo fone escolhido nas configurações, como a voz.

---

## 11. Como o Nexo fala

**Língua.** Português do Brasil, com acentuação correta, em toda a interface, no código, nos
comentários e nos commits.

**Tom.** Direto e tranquilo, como alguém do lado explicando. Segunda pessoa com "você". Sem
exclamação de entusiasmo, sem "Ops!", sem jargão técnico na interface ("codec" fica dobrado no
avançado).

**Rótulos.**
- Botão de ação: **verbo no infinitivo + objeto** — "Abrir o Estúdio", "Desligar meus links",
  "Criar conta grátis", "Ver o perfil".
- Botão de estado: **o nome fixo da coisa** — "Microfone", "Câmera", "Ouvir". O estado está no
  ícone e na cor, não no texto (texto que muda faz a barra pular de largura).
- Interruptor: o que ele faz, como frase — "Deixar que me levem para o OBS".
- Só a primeira letra maiúscula, nunca Título Em Caixa Alta Por Palavra. Caixa alta de verdade
  só nos rótulos de grupo pequenos (2.6).

**Explicações.** Abaixo do controle, em `--muted`/`--faint`, dizendo a **consequência**: "Só
você ouve a diferença, e o Nexo lembra na próxima vez." — e não o que o controle é.

**Erros e recusas.** O que aconteceu e o que fazer, em uma frase: "Sem conexão com o servidor.
Tente de novo.", "Mudanças demais em pouco tempo. Aguarde um minuto.", "Esta pessoa não deixa
ser levada para o OBS." Nunca culpar a pessoa; nunca mostrar a mensagem crua do servidor.

**Andamento.** Gerúndio com reticências — "Salvando…", "Enviando…", "Conectando…" — trocado por
um particípio quando termina: "Salvo · o OBS já mostra", "Copiado".

**Gênero.** Sem marcar gênero de quem não se sabe: "quem entrou", "quem tem conta", "a pessoa".
Quando a frase pede concordância, ela vai com "a pessoa".

**Números.** `60%` (sem espaço), `160 px` (com espaço), hora `16:40`, "há 2 horas",
"desde as 16:40". Códigos como aparecem para a pessoa: `K7M2-PQ4X`.

**Pontuação.** Reticências tipográficas (`…`), travessão com espaços (` — `) e ponto médio
(` · `) para juntar duas informações curtas numa linha.

---

## 12. Antes de entregar uma tela nova

- [ ] Toda cor vem de token; cor fixa só sobre vídeo, em preenchimento colorido com texto
      escuro, em sombra ou em ilustração (e o comentário diz por quê).
- [ ] Alturas de controle são as três de `tema.css`; raios e tempos também.
- [ ] Uma ação principal violeta no máximo; "Fechar" cinza.
- [ ] Botão só de ícone com `aria-label` e `title`; liga-desliga com `aria-pressed`.
- [ ] Foco visível, Enter/Espaço em tudo que é clicável, Esc fecha o que abriu.
- [ ] O texto segue a seção 11.
- [ ] Funciona de 320 a 2560 px sem rolar de lado nem sobrepor; o estado novo entrou em
      `tests/layout-browser.cjs`.
- [ ] No toque: alvos de 32 px, nada que só exista no `:hover`.
- [ ] Tema claro conferido (e a peça sobre vídeo continua escura).
- [ ] Menos movimento: a peça funciona com animações de 1 ms.
- [ ] Se é peça compartilhada entre páginas, se defende das regras globais (seção 8).

---

## 13. O que ainda não está no padrão

Resolvido em 01/10/2026: os tamanhos de letra da escala viraram `--fs-*` em todas as páginas; as
cores fixas fora do vídeo viraram tokens (menção em `--aviso`, "oculto para você" e tela ao vivo
em `--rosa` com `--sobre-cor`, contagens em `--danger-forte`, pontos de conexão em
`--online`/`--aviso`/`--danger`, o medidor do microfone nas três); as abas da conta viraram a fita
das abas da sala; os rótulos em caixa alta são todos 750; as **aspas são curvas** (“…”) em todo
texto da interface; glifos usados como ícone (`＋`, `✓`, `◆`, `✕`, `−`, `→`) viraram desenho em
traço; e o Estúdio ganhou o desenho próprio de transmissão, longe da câmera.

O que continua fora, e por quê:

- **Tamanhos de título soltos** (18, 20, 22, 27 px…): títulos de painel e números grandes que não
  estão na escala. A escala é de texto; um token por título seria um token por tela.
- **A coluna de seções das configurações** é um desenho de navegação, e não de aba: fica como está
  (4.5).
- **As cores da ilustração** (palco vazio, 404) e da arte do cartão de perfil (4.13) são fixas por
  serem arte, como o padrão permite.
