# Um chassi só: a passagem do início para a sala

Escrito em 06/10/2026 e **implementado no mesmo dia: as fases 1 a 4** (entrar sem o portão, a moldura
igual, o trilho na sala e a troca de página animada). A fase 5, a camada de dentro da moldura, **ficou
de fora** e continua sendo o que vem depois. O que o código ficou sendo está em `docs/interface.md`
(2.10, 4.18, 5, 5.1, 5.3); este documento guarda o porquê, os números do antes e a conta do custo, e
"O que a implementação decidiu" fecha o texto. Os números do "antes" vêm do código de então, medidos em
1440 × 900 (e nos tamanhos da seção "O que custa"), e a proposta foi prototipada por cima das páginas de
verdade — CSS e DOM injetados pelo Playwright — antes de ser escrita no código.

Uma frase orienta tudo: **a moldura não muda; o miolo muda.** Quem sai do início para uma sala
vê as colunas, a linha de cima e o "eu" ficarem exatamente onde estavam, e só o que está dentro
delas troca — como no Discord, onde entrar num canal de voz não muda a tela.

## O que está diferente hoje

O que **não** é o problema: as cores e as peças. A lateral é `--bg-1`, o centro `--bg`, o "eu"
`--bg-0` nas duas páginas, e os botões, campos e ícones são os mesmos. A diferença está em quatro
lugares.

| | Início (`/`, com conta) | Sala |
|---|---|---|
| Colunas | trilho 72 · lateral 264 · centro · "Agora no Nexo" 340 | lateral 224 · palco · chat 292 (**sem trilho**) |
| Linha de cima | 56 px, só no centro; a lateral começa pela busca | 64 px, na lateral e no centro; o chat tem a dele |
| Faixa de cima | `--bg` (a mesma do centro) | `--bg-1` (a mesma da lateral e do chat: uma moldura) |
| Marca | o quadrado "N" no alto do trilho | "NEXO" + "seu espaço" + ✦ no alto da lateral |
| O "eu" de baixo | 64 px, avatar **círculo** de 34, toque = menu de status, engrenagem = conta | 71 px (e a caixa de conexão de 95 por cima), avatar **quadrado** de 32, toque = editor de perfil, carinha = status, engrenagem = configurações |
| Entrar | clicar em "Entrar" é uma navegação de página inteira que cai num **portão** e pede um segundo clique ("Entrar na sala") | — |
| Voltar | a marca abre a camada: o início inteiro por cima da sala, com uma barra de chamada de 52 px **mais** o cabeçalho do início = dois cabeçalhos empilhados | — |

Quatro causas, em ordem do que mais se sente:

1. **O portão.** Quem tem conta clicou em "Entrar" e vê uma tela escura com um cartão ("Você está
   entrando na sala", o nome, outro botão). É uma cerimônia para quem já disse que quer entrar, e
   cobre a sala inteira com um véu: a pessoa só vê a sala depois de decidir outra vez.
2. **A moldura pula.** Na troca, a linha de cima vai de 56 a 64, a borda da lateral de 336 a 224, o
   começo da coluna da direita de 1100 a 1148, e o trilho some. Nenhuma borda que o olho seguia
   continua no lugar.
3. **A anatomia muda.** A marca está em dois lugares, o "eu" é outro desenho (círculo × quadrado,
   64 × 71 px) com outros toques, e a faixa de cima troca de tom.
4. **O corte é seco.** São dois documentos: a página some e a outra aparece. E a camada (a volta
   sem sair da chamada) cobre a janela inteira em vez de trocar só o miolo.

## O desenho

### As zonas

| zona | Início | Sala |
|---|---|---|
| **Trilho** (64) | N (início) · salas recentes · criar · entrar por código · ✦ | N (abre a camada) · as mesmas recentes, **a sala de agora primeiro, com o anel verde** · ✦ |
| **Alto da lateral** (56, com borda) | a busca | a sala: quadrado da cor dela, `#código`, "2 pessoas · há 0:12" |
| **Corpo da lateral** | seções, mensagens diretas | canais da sala, quem está |
| **Pé da lateral** | o "eu" | a caixa de conexão (só na chamada) e o "eu" |
| **Faixa de cima** (56, `--bg-1`) | título da seção, abas, ação | nome da sala, selo, ações |
| **Miolo** | lista, conversa, editor | palco e plateia, e embaixo a barra de controles |
| **Coluna da direita** (292, com cabeçalho de 56 e borda) | "Agora no Nexo" | chat ou música |

A coluna da direita do início ganha o cabeçalho de 56 px que o chat já tem — a linha de cima passa
a atravessar as três colunas nas duas páginas.

### Os números (tokens novos em `tema.css`)

| token | hoje (início / sala) | proposta |
|---|---|---|
| `--chassi-trilho` | 72 / — | **64** (quadrados de 44; a marca de 26) |
| `--chassi-topo` | 56 / 64 (57 no celular) | **56** em tudo, também o cabeçalho do chat e do canal de música |
| `--chassi-lateral` | 264 · 240 · 264 / 224 · 200 · 240 | **232** · 208 (≤ 1250) · 248 (≥ 1600) |
| `--chassi-direita` | 340 · 300 / 292 · 266 · 320 | **292** · 266 (≤ 1250) · 320 (≥ 1600) |
| `--chassi-eu` | 64 / 71 | **64** |

Na sala o trilho mora **dentro do `.room-sidebar`** (uma linha: trilho e conteúdo da lateral), e
`--col-lateral` passa a ser trilho + lateral. Assim tudo o que já existe continua valendo sem
reescrever as dez listas de `grid-template-areas` do `sala.css` (modo teatro, foco no chat,
compacto, gaveta): recolher a barra tira trilho e lateral juntos, e no celular a gaveta traz os
dois, como a do início já faz.

### Peça por peça

- **O trilho na sala** é o mesmo do início (as mesmas regras de `inicio.css`, extraídas para um
  `public/trilho.js` que as duas páginas usam). Na sala não aparecem "criar" e "entrar por código" —
  `docs/interface.md` 5.2 já diz por quê: o convite sairia antes da pergunta. Clicar em outra sala
  usa a pergunta que a camada já tem (`#camadaSairPanel`). A sala de agora leva o anel verde e perde
  o número de amigos (já se sabe quem está nela). O ✦ das novidades sai do alto da lateral e vai
  para o pé do trilho, onde está no início.
- **O alto da lateral na sala diz onde a pessoa está**, e a marca vai para o trilho. É o bloco que
  a camada já mostra na barra dela ("#sala · 2 pessoas · há 0:12"). A consulta de contêiner `marca`
  do `sala.css`, que existia para a frase "seu espaço", deixa de ter o que fazer.
- **O "eu" é um só desenho nas duas páginas**: 64 px, avatar de 34, o **quadrado arredondado** —
  `docs/interface.md` 4.9 já define o "eu" de baixo como quadrado, e foi o início que fugiu da
  regra —, o ponto de status, nome e estado em duas linhas. Os toques seguem onde fazem sentido
  (a sala tem reações e configurações da chamada; o início tem a conta); só a aparência e a posição
  são idênticas.
- **A faixa de cima do início passa a `--bg-1`**, como a da sala. A moldura (`--bg-1` em volta,
  `--bg` no miolo) vale nas duas.
- **A busca** (placeholder "Encontrar um amigo ou conversa", 30 letras) é cortada em 232 px:
  vira **"Buscar amigos e salas"**.

### Entrar sem o portão

`irParaSala` (`inicio.js`), o trilho, a pergunta da camada (`sairDaSala(destino)`) e o convite de um
amigo gravam, um instante antes de trocar de página, `sessionStorage['nexo.entradaDireta']` com a sala
e a hora (`NexoChassi.marcarEntrada`, `chassi.js`). Em `sala.js`, quando `NexoConta.pronto` confirma uma
conta **e** o recado é para esta sala e tem menos de 15 s, o recado é apagado e `entrar()` roda sozinho. O portão continua, igual, para quem não tem conta e para quem chega por um
link (alguém que clicou num convite não pode aparecer numa chamada sem ter confirmado). O
aviso "o microfone e a câmera começam desligados" já está no "eu" ("Mic mudo") e na linha de
estado. Os 47 usos do portão nos testes abrem a URL da sala direto, sem recado: não mudam.

Risco: o navegador só deixa tocar som depois de um gesto; o clique em "Entrar" aconteceu na página
anterior. O Chrome conta a interação com o domínio, e a sala já tem o botão "Ativar reprodução"
(`#enableSoundBtn`) para quando não vale — mas **Safari e o WebView do Android têm de ser
conferidos num aparelho**.

### A troca de página animada

Cross-document view transitions: duas linhas de CSS por página fazem o navegador animar a
navegação entre duas páginas da mesma origem. O que tem o mesmo `view-transition-name` nas duas
fica no lugar (ou desliza até o lugar novo); o resto faz fusão de 240 ms.

```css
/* public/chassi.css, nas duas páginas (e só nelas) */
@view-transition { navigation: auto; }
.ini-trilho, .room-sidebar > .trilho { view-transition-name: nx-trilho; }
.ini-lateral, .lateral-conteudo      { view-transition-name: nx-lateral; }
.ini-eu, .self-profile               { view-transition-name: nx-eu; }
::view-transition-group(*) { animation-duration: var(--dur-lenta); animation-timing-function: var(--curva); }
```

Com a moldura igual, a fusão mostra o miolo e o conteúdo da lateral trocando de lugar enquanto o
trilho, a linha de cima e o "eu" nem se mexem. **Conferido em 06/10/2026**: nas duas páginas reais,
`pageswap` e `pagereveal` trouxeram a transição (Chromium do Playwright). O Electron 44 e o WebView
do Android atualizado também suportam; onde não há (Firefox, Safari antigo), a navegação é a de
sempre — melhora sem custo.

Duas regras do padrão que a transição precisa respeitar: os pseudo-elementos `::view-transition-*`
**não** são alcançados pelo `*` das regras de menos movimento de `tema.css`, então entram nelas
explicitamente (1 ms, nos dois níveis: `prefers-reduced-motion` e `html.menos-movimento`); e um
elemento nomeado vira contexto de empilhamento, o que o `test:layout` e o `test:camada` vão dizer
se atrapalha alguma gaveta ou menu.

### A camada, no fim

Com a moldura igual, a camada deixa de cobrir a janela inteira: ela começa à direita do trilho **da
sala** (que continua à vista e é o "voltar": a sala de agora com o anel, o N para abrir e fechar), e
o início de dentro esconde o trilho dele (`html.na-camada .ini-trilho`). A barra de chamada de cima
(microfone, ouvir, sair, voltar) sai de lá e vira um bloco **"Na chamada"** no pé da lateral, acima
do "eu", como a caixa de conexão da sala: o mesmo lugar, o mesmo desenho. Os botões continuam
chamando as funções da sala por `postMessage`, como `camada.avisar` já faz. É a parte maior e a que
pode esperar.

## O que custa

**No palco.** O trilho tira 64 px de largura e a lateral 8; a linha de cima devolve 8 px de altura.
Como o palco é limitado pela altura em quase toda tela, o vídeo 16:9 contido no palco mudou assim
(medido com a sala vazia, o palco é a caixa onde o vídeo cabe):

| janela | vídeo hoje | com a proposta | área |
|---|---|---|---|
| 1280 × 720 | 574 × 323 | 588 × 331 | **+5,0%** |
| 1366 × 768 | 660 × 371 | 674 × 379 | **+4,3%** |
| 1536 × 864 | 830 × 467 | 844 × 475 | **+3,4%** |
| 1600 × 900 · 1920 × 1080 | 894 × 503 · 1214 × 683 | 908 × 511 · 1228 × 691 | **+3,2% · +2,3%** |
| 1440 × 900 | 876 × 493 | 804 × 452 | **−15,9%** |
| 1680 × 1050 | 1072 × 603 | 1000 × 563 | **−12,9%** |
| 1920 × 1200 | 1312 × 738 | 1240 × 698 | **−10,6%** |

Ou seja: **em telas 16:9 o vídeo cresce; em monitores 16:10 ele perde de 11 a 16%** (nelas o palco
é limitado pela largura). O que alivia: "Recolher a barra lateral" (já existe) devolve os 296 px de
trilho e lateral com um clique e é lembrado. Se quiser tirar o custo dos 16:10 de vez, o trilho pode
ir a 56 px (quadrados de 40) — devolve 8 px de largura, e eu só faria isso medindo de novo.

**Em teste.** Passam a mudar de lugar: o alto da lateral, o ✦ das novidades (`data-novidades`, que
já é ligado por atributo), o "eu" (cinco arquivos de teste o tocam: `camada`, `contas`, `foto`,
`fila-e-perfil`, `status`) e o tamanho das colunas. `npm run test:layout` (32 estados, 320 a 2560 px)
é a rede de segurança. Entra um teste novo: o recado de entrada direta (conta, vindo do início;
sem conta; por link) e o trilho da sala (anel, pergunta ao trocar de sala, sem criar nem entrar por
código).

**Em risco.** Quem não tem conta não tem início, então a sala dela **não ganha trilho**
(`.app.sem-trilho`). Como `NexoConta.pronto` é assíncrono, o trilho entraria depois da primeira
pintura e empurraria o layout: a página precisa de uma dica antes da primeira pintura (um
`localStorage` escrito por `conta-cliente.js`, no estilo do `tema.js`), confirmada depois.

## As fases

Cada uma vale sozinha, na ordem em que eu faria.

1. **Entrar sem o portão** — **feito**: `chassi.js`, `sala.js`, `inicio.js`, `inicio-na-sala.js`,
   `social-sala.js`, `conversa.js`. É o que mais tira a sensação de "outro lugar" e quase não mexe em layout.
2. **A moldura igual** — **feito**: tokens `--chassi-*` em `tema.css`; linha de 56 px, faixa `--bg-1`,
   cabeçalho de 56 na coluna da direita do início, o "eu" de 64 px e quadrado nas duas, as larguras da
   lateral e da direita.
3. **O trilho na sala** — **feito**: `public/trilho.{js,css}` (extraídos do início), `trilho-sala.js`, o
   `.room-sidebar` em linha, o alto da lateral com a sala, o ✦ no pé do trilho, `html.com-conta`.
   É a fase com o custo no palco.
4. **A troca de página animada** — **feito**: `public/chassi.css`, as regras de menos movimento em
   `tema.css` e a rejeição calada em `tema.js`.
5. **A camada de dentro da moldura** — **não feito**: o bloco "Na chamada" e o trilho da sala à vista
   por fora da camada. Pode virar outro plano.

`docs/interface.md` mudou junto: 2.8 (a troca de página), 2.10 (a moldura), 4.9 (o "eu"), 4.18 (o trilho),
5 e 5.1 (as larguras), 5.2 (a marca no trilho) e 5.3 (entrar sem o portão). E o `.server-rail { display:none }`
do `sala.css`, regra sem elemento correspondente desde o commit `d3b5c7d`, saiu.

## Fora do plano, e por quê

- **O nome da sala aparece três vezes** (alto da lateral, título da barra de cima e o primeiro
  canal). Com o alto da lateral dizendo a sala, o título de cima poderia dizer o canal ("Sala de
  voz", "# chat da sala"), como no Discord. É uma mudança de informação, e não de moldura.
- **Os toques do "eu"** continuam como estão: unificar o que cada toque abre (status × perfil)
  mexe no `test:status` e merece o próprio desenho.
- **O Nexo sem trilho no início**, o contrário da proposta: o trilho tem pouco que o lado direito
  ("Criar uma sala nova", "Abrir uma sala") já não ofereça além das recentes. Mas é a cara do
  produto, e deixá-lo só no início manteria o salto que se quer tirar.

## Como foi medido

Um protótipo (fora do repositório) subiu o servidor de teste, criou duas contas amigas, pôs uma delas
numa sala, injetou as regras da proposta nas duas páginas e mediu as caixas: **trilho, lateral, linha
de cima, "eu" e coluna da direita com exatamente a mesma posição e tamanho nas duas páginas** em
1280 × 720, 1366 × 768, 1440 × 900 e 1920 × 1080, e o tema claro funcionou só com os tokens. Depois de
escrita no código, a mesma conferência virou teste (`npm run test:chassi`, de 1100 a 1920 px).

## O que a implementação decidiu

- **O recado de "entrar direto" mora em `chassi.js`, no `<head>`, e não em `trilho.js`**: o portão tem de
  estar escondido no primeiro quadro (`html.entrando-direto`), e só um script síncrono do `<head>` chega
  antes da pintura. O mesmo script traz a dica de "tem conta" (`html.com-conta`) que mostra o trilho já no
  primeiro quadro, sem a sala se mexer quando a conta responde.
- **A rejeição "Transition was skipped" é calada em `tema.js`**, e não em `chassi.js`: quem a recebe é a
  página de **destino**, e quando ela não adere (a apresentação em `/`, a conta, o 404) não carrega o
  `chassi.js`. O `tema.js` está no `<head>` de toda página, e o filtro é só para esse erro.
- **O "eu" do início ficou quadrado** (`.nx-av.quadrado`, em `cartao.css`) em vez de o da sala virar círculo:
  a 4.9 já definia o "eu" de baixo como quadrado, e o início é que fugia da regra.
- **A largura mínima do palco com o chat** (`larguraDaLateral()`, `sala.js`) passou a ler os números da
  moldura, e não mais um 224 escrito à mão: o trilho entra na conta para quem tem conta.
- **O limite do container `eu`** subiu de 240 para 260 px: a lateral de 248 px (≥ 1600) caía na forma longa
  do estado do microfone, que ali não cabe.
- **Os avisos e botões que ficavam "abaixo da barra de cima"** (o toast, o aviso de pedido de entrada, o
  botão "Ativar reprodução") usam `--chassi-topo` e acompanham os 56 px.
