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
| Avatar de qualquer pessoa, em qualquer página | `NexoPerfil.pintar` (`public/perfil.js`) |
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
   confere isso em 27 estados, de 320 a 2560 px.
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
| `--aviso` (âmbar) | atenção, acima do normal, premium | volume acima de 100%, menção a você, selo premium |
| `--rosa` | ao vivo | selo "LIVE", telas ao vivo |

Cada uma tem a versão `-texto` (para letra) e, quando precisa, `-suave` (fundo translúcido) e
`-forte` (preenchimento com texto branco).

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
o mouse; avatar da lista e do chat cresce 6% com mola.

**Menos movimento** vale em dois níveis: o do sistema (`prefers-reduced-motion`, em
`tema.css`) e o "Menos animação" das configurações (`html.menos-movimento`). Os dois
**encurtam** animações para 1 ms em vez de removê-las — código que espera `animationend` (as
reações, os avisos) continua funcionando. A troca de tema desliza as cores por 280 ms, só
durante a troca (`html.trocando-tema`).

### 2.9 Camadas (z-index)

| camada | z | quem |
|---|---|---|
| peças dentro do palco e do quadradinho | 1–4 | selos, controles, placar de quem assiste |
| botão "ativar som" | 65 | |
| lateral em gaveta (celular) / chat em gaveta (≤1100 px) | 68 / 70 | |
| modal e o portão de entrada | 80 / 90 | |
| visualizador de imagem, reações que voam | 95–96 | |
| menu de presença, menu de mensagem | 105–106 | |
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
- **Cores exatas** (premium, regra do `NEXO_PLANOS`): a pessoa escolhe a cor de destaque e a do
  fundo. A escolha fica guardada mesmo quando o plano vence, e volta com ele.

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
  quem o abriu; com o painel aberto, a sala por trás fica `inert`.

**Painel sobre painel** é permitido quando o segundo nasce do primeiro (a foto grande sobre o
cartão de perfil): o de cima vem depois no HTML, e fechá-lo volta ao de baixo.

Variações do mesmo cartão: as **configurações** (coluna de seções à esquerda como no Discord,
altura fixa para não pular ao trocar de seção; no celular as seções viram uma fita que rola de
lado), o **Estúdio** (sem preenchimento, com topo, corpo em duas colunas e rodapé próprios) e a
**folha de volume**, que no celular vira folha presa embaixo, da largura da tela, subindo de
baixo.

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

### 4.7 Avisos no canto (`toast.js`)

Um canto só, a mesma peça em toda página: ícone num quadrado de 34 px, título e linha de meta,
barra de progresso opcional (com modo indeterminado), ações opcionais e o X. Tons: neutro,
`ok` (verde) e `erro` (vermelho). O aviso é um objeto vivo — quem cria atualiza e fecha. Na
página inicial fica embaixo à direita; **na sala desce do topo**, abaixo da barra de cima,
porque o canto de baixo é do chat e da barra de controles. Texto sempre por `textContent`.

Use para o que demora ou acontece longe do clique (download, atualização). Não use para
confirmar um clique — isso é o próprio botão (4.1).

### 4.8 Selos, chips, contagens

- **Selo** (`.estudio-selo`, `.selo-premium`, `.session-badge`, `.dono-selo`): caixa alta
  `--fs-rotulo`, peso 700–750, pílula ou raio de 6 px, cor da família (rosa ao vivo, âmbar
  premium, verde na sala, vermelho recusa).
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
| lista lateral | 30, com ponto verde de conectado | quadrado arredondado |
| quadradinho sem câmera | 36 | quadrado arredondado |
| Estúdio, folha de volume | 36–44 | círculo |
| cartão de perfil | 54 (64 com foto, que se abre grande) | círculo |
| configurações → perfil | 72, sobre uma faixa de destaque | círculo |

Quem fala ganha **anel verde** (`--online`) no quadradinho e na lista. O microfone mudo é o
microfone cortado em vermelho no canto de baixo do quadradinho e ao lado do nome na lista; quem
ensurdece troca esse ícone pelo fone cortado (o mesmo do botão Ouvir), no mesmo lugar.

**O perfil abre de qualquer lugar onde a pessoa aparece:** a lista, o nome embaixo do
quadradinho, o quadradinho de quem não tem câmera nem tela, e o nome e o avatar do autor no
chat (`abrirPerfil`). Nomes clicáveis sublinham ao passar o mouse.

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
  `public/estudio.js` e `public/novidades.js`, máscaras em `sala.css`).

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

**Consultas de contêiner** onde a peça divide a janela com outras e a largura da janela mente:

- **A barra de cima** (`container: topo`) tira as peças **pela ordem do que importa menos**:
  quantas pessoas e o relógio (a lateral também diz), os rótulos que só repetem o ícone, o selo
  do tipo de sala; depois os botões viram ícone. O nome da sala é o último — encolhe com
  reticências e nunca empurra ninguém.
- **O palco** (`container-type: size`) decide pelo próprio tamanho o que cabe nele.
- **A lista de pessoas do Estúdio** (`container: estudio-pessoas`) desce as imagens para uma
  linha própria, com legenda, quando fica estreita.

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

`npm run test:layout` é a prova: 27 estados da sala (painéis, configurações, Estúdio, chat
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
  `!important`;
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

Diferenças que existem hoje e que este documento não esconde:

- **Tamanhos de letra soltos**: muitas regras antigas de `sala.css` usam `10px`, `11px`, `12px`
  direto em vez de `--fs-*`. Os valores batem com a escala; a troca é mecânica.
- **Cores fixas que não são de vídeo**: o amarelo da menção (`#d4ad4f`), o rosa de "ocultar
  minha imagem" (`#dd7899`), as cores da ilustração do palco vazio. As da ilustração são
  permitidas; as outras deveriam vir de `--aviso` e `--rosa`.
- **Abas em três estilos**: cheia violeta (`.abas-fita`), coluna à esquerda (configurações) e
  sublinhada (página da conta).
- **Pesos de rótulo em caixa alta** variam entre 600, 650 e 750.
- **Aspas**: curvas (“…”) nas mensagens do Estúdio e retas no resto.
- **Menos movimento duplicado**: `sala.css` tem uma regra antiga que **remove** as animações
  (`animation:none!important`) por cima da de `tema.css`, que as encurta. Com a do sistema
  ligada, as reações da sala, que só saem no fim da animação, ficariam na tela.
