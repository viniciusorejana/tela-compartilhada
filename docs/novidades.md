# Apresentação, novidades e os vídeos do Nexo

Escrito em 26/09/2026, junto com a primeira edição. Três peças que andam juntas:

- **o modal** (`public/novidades.js` + `novidades.css`): a apresentação na primeira vez de cada
  pessoa e as novidades quando algo grande muda;
- **as edições** (`public/novidades-edicoes.js`): o texto de cada novidade — é o arquivo que se
  edita para publicar uma;
- **os vídeos** (`video/`, em Remotion): a apresentação de 1 minuto que toca dentro do modal e o de
  lançamento, em 16:9 e em pé.

## O modal

### Onde e quando aparece

| situação | o que acontece |
|---|---|
| primeira vez da pessoa | abre sozinho em **Conheça o Nexo** |
| edição nova com `aparecer: true` ainda não lida | abre sozinho em **Novidades**, com a edição marcada "NOVA" |
| edição nova com `aparecer: false` | não abre; o botão ✦ Novidades ganha um ponto |
| tudo lido | nada; o botão continua abrindo quando a pessoa quiser |

Aparece na **página inicial** e na **sala, por cima da tela de entrada** — antes de conectar. A
sala é onde chega a maioria (quem vem por convite nunca passa pela página inicial), e a tela de
entrada é o único momento em que a pessoa ainda não está numa conversa: depois de entrar, o vídeo
tocaria por cima da voz dos amigos e iria para o microfone de quem está sem fone. Quem clicar em
"Entrar" antes de a conta responder já está na sala — aí o modal não abre, fica o ponto no botão, e
a próxima visita mostra.

O botão **✦ Novidades** fica no alto da página inicial e no alto da barra lateral da sala, na linha
da marca. Com edição não lida, ganha um ponto rosa.

### A trava

Quando abre sozinho, o modal só fecha depois de **8 segundos** (primeira vez) ou **5 segundos**
(novidade; uma edição pode pedir outro número com `espera`) — **ou quando a pessoa chega ao fim do
conteúdo**, o que vier antes — com um mínimo de 1,5 s, porque uma edição curta cabe inteira na
tela e o fim nasceria à vista. O anel em volta do X e o botão principal enchem com o tempo. A trava é
contra o fechar por reflexo, não uma prova de leitura: esperar sempre funciona. Aberto pelo botão,
fecha na hora.

### O "lido", por pessoa

"Lida" é o `id` da edição mais nova que a pessoa **fechou**. Mora em dois lugares:

- **com conta**: é o ajuste `novidades` da conta (a lista fechada de `public/perfil.js`), e segue a
  pessoa em todo aparelho — leu no computador, não vê de novo no celular;
- **sem conta**: `localStorage` (`nexo.pref.novidades`), só naquele navegador.

Entre os dois vale o maior: ler sem estar logado e entrar na conta depois não faz a apresentação
voltar. Recarregar com o modal aberto mostra de novo — "lido" é fechado, não visto.

`NEXO_NOVIDADES=0` no ambiente impede o modal de abrir sozinho (o botão continua funcionando). Os
testes de navegador usam isso por padrão, porque todo navegador de teste é "primeira vez".

## Publicar uma novidade

| edição | data | título |
|---|---|---|
| 6 | 03/10/2026 | O início e a conta sem sair da chamada |
| 5 | 02/10/2026 | Repetir, parar o som e o Nexo no celular |
| 4 | 01/10/2026 | Amigos, conversas e um perfil só seu |
| 3 | 29/09/2026 | A sala no seu OBS |
| 2 | 28/09/2026 | A tela pela placa de vídeo |
| 1 | 26/09/2026 | O Nexo de cara nova |

1. Em `public/novidades-edicoes.js`, acrescente a edição **no topo**, com o `id` seguinte:

   ```js
   {
     id: 3,
     data: '2026-10-15',
     titulo: 'Salas que não expiram',
     resumo: 'Uma frase que resume a edição.',
     aparecer: true,            // abre sozinho para todo mundo; false = só o ponto no botão
     // abrirEm: 'conheca',     // opcional: reabre a apresentação em vez da lista
     // espera: 6,              // opcional: segundos de trava (padrão 5)
     itens: [
       { icone: 'link', titulo: 'O link não morre mais', texto: 'O que mudou, em uma ou duas frases.', onde: 'Configurações → Sala' }
     ]
   },
   ```

   Os ícones disponíveis são as chaves de `ICONES` em `public/novidades.js` (`mic`, `tela`, `olho`,
   `tema`, `arroba`, `som`, `relogio`, `volume`, `musica`, `compacto`, `conta`, `onda`, `brilho`,
   `link`, `chat`, `grade`, `pulso`, `placa`, `atualizar`, `servidor`…); faltando um, acrescente-o
   lá, no mesmo traço dos outros. `onde` é opcional, e é o que a pessoa mais procura depois de ler.
2. `npm test` confere a lista (ids inteiros, únicos e decrescentes; datas; ícones que existem).
3. Suba o servidor. Quem abrir o Nexo depois disso vê a edição uma vez.

**Nunca renumere uma edição publicada**: um `id` menor faria ninguém ver a nova; um maior faria
todo mundo rever tudo.

Para mudar a **apresentação** em si (textos e demonstrações), o conteúdo está em
`conteudoConheca()`, em `public/novidades.js`. Se a mudança for grande, publique uma edição com
`abrirEm: 'conheca'` para quem já viu a antiga.

## Os vídeos

| arquivo | onde aparece | duração | tamanho |
|---|---|---:|---:|
| `public/midia/apresentacao.mp4` | dentro do modal, na abertura de "Conheça o Nexo" | 60 s | 6,2 MB |
| `public/midia/lancamento.mp4` | página inicial, seção "O Nexo em meio minuto" | 34 s | 4,5 MB |
| `public/midia/lancamento-vertical.mp4` | para Reels, Shorts e TikTok (não aparece no site) | 34 s | 4,5 MB |

Cada um tem a capa `.jpg` ao lado. Os dois do site usam `preload="none"`: o modal abre para todo
mundo, e baixar um minuto de vídeo para quem só queria fechar seria banda da casa de quem hospeda.
O arquivo sai com o índice no começo (`faststart`), então começa a tocar antes de baixar inteiro, e o
servidor já responde a pedidos por pedaço (Range) e com revalidação por ETag.

### Refazer

```powershell
npm run video:instalar      # uma vez: Remotion e React, só dentro de video/
npm run video:estudio       # abre o Remotion Studio para mexer e ver ao vivo
npm run video:renderizar    # renderiza os três e entrega em public/midia (~3 min)
```

`npm run video:renderizar -- Apresentacao` refaz um só. O script nivela o som em −16 LUFS (o padrão
da web), grava a capa e exporta os sons da mesa de demonstração do modal (`public/midia/mesa`).

O código fica em `video/src`: `Apresentacao.jsx` e `Lancamento.jsx` são os roteiros, e `base/` tem a
sala redesenhada para vídeo (barra de controles, palco, chat, mesa, fila, temas). As cores são as de
`public/tema.css`, e a cena de temas usa as paletas que `public/tema.js` calcula de verdade. Os
avisos que tocam nos vídeos são os da sala (`public/sons`), copiados por `scripts/preparar.cjs`.

As duas trilhas estão em **120 BPM** (medido: 120,25). Todo corte cai num compasso (a cada 60
quadros) e todo gesto importante numa batida — as constantes estão em `video/src/base/tema.js`. A
trilha da apresentação entra cheia aos 16 s, que é quando a tela é compartilhada; a do lançamento
tem o *drop* aos 8 s, que é quando a marca aparece. Trocar a trilha por uma de outro andamento pede
ajustar `BATIDA` e `COMPASSO`.

**Licença do Remotion**: gratuita para pessoa física, para empresas de até três pessoas e para
organizações sem fins lucrativos; acima disso, pede a licença de empresa. Confira as condições
atuais em remotion.dev/license antes de o Nexo virar empresa com equipe.

### O som (ElevenLabs)

Tudo está no fluxo **"Nexo · vídeos de apresentação e lançamento"** do workspace
(elevenlabs.io/app/flows/MOIoTItaexy1BUOWxMDY), com todas as variações — inclusive as não usadas.
Custo total: ~3.250 créditos (≈ US$ 0,33). Os arquivos escolhidos ficam em `video/public/audio`.

| arquivo | modelo | prompt (resumo) | escolha |
|---|---|---|---|
| `trilha-apresentacao` | Music v2, 64 s | indie-pop brincalhão, Rhodes, baixo, palmas, 120 BPM | variação B: introdução de 16 s e entrada cheia |
| `trilha-lancamento` | Music v2, 34 s | pop eletrônico, *drop* depois de 4 s de introdução | variação B: *drop* aos 8 s; a A veio com 52 s |
| `whoosh`, `pop`, `brilho` | SFX v2 | transição, bolha, assinatura do logo | A: as B saíram 10–12 dB mais baixas |
| `impacto`, `teclado` | SFX v2 | golpe grave do *drop*, digitação | única |
| `uhh`, `palmas`, `boing` | SFX v2 | sons da mesa de demonstração | A |
| `piada` (ba-dum-tss) | SFX v2 + ffmpeg | caixa, caixa um tom abaixo + tom, prato | montado, ver abaixo |

Nada disso foi ouvido na escolha — a sessão não tinha como. Foi medido: andamento e fase da
batida por autocorrelação do fluxo de energia, contorno de volume por segundo (para achar introdução
e *drop*), pico e onde cada efeito começa. **Vale ouvir antes de publicar**; trocar é pôr outro
arquivo com o mesmo nome em `video/public/audio` e renderizar de novo.

O **ba-dum-tss** confirma o que os avisos da sala já tinham ensinado: o gerador faz golpes
isolados, não frases. Pedido inteiro, ele devolve um prato só. Pedidos de caixa e de tom isolados
vieram com o timbre certo (tom em 40–120 Hz, caixa em 250–1.000 Hz) mas a −37…−48 dBFS, então foram
amplificados e montados no ritmo (caixa em 0, caixa um tom abaixo com o tom em 0,19 s, prato em
0,44 s):

```bash
ffmpeg -i caixa.mp3 -i caixa2.mp3 -i tom.mp3 -i prato.mp3 -filter_complex "[0]aformat=sample_rates=44100:channel_layouts=mono,volume=34dB,atrim=0:0.3,afade=t=out:st=0.18:d=0.12[ba];[1]aformat=sample_rates=44100:channel_layouts=mono,volume=34dB,asetrate=39250,aresample=44100,atrim=0:0.3,afade=t=out:st=0.18:d=0.12,adelay=190[dum];[2]aformat=sample_rates=44100:channel_layouts=mono,volume=24dB,atrim=0:0.4,afade=t=out:st=0.25:d=0.15,adelay=190[corpo];[3]aformat=sample_rates=44100:channel_layouts=mono,volume=-4dB,adelay=440[tss];[ba][dum][corpo][tss]amix=inputs=4:normalize=0:duration=longest,highpass=f=70,alimiter=limit=0.89" -ac 1 -b:a 96k piada.mp3
```

### O Reels de humor

Um anúncio de aplicativo no estilo dos Reels, com piada e meme, sem gravação de ninguém: `ReelsComVoz`
(narrador simulado) e `ReelsSemVoz` (só trilha, efeitos e o texto na tela), 1080×1920, ~67 s. Saem em
`video/saida` (não vão para o site) e são pedidos pelo grupo:

```powershell
npm run video:renderizar -- Reels        # os dois; ReelsComVoz ou ReelsSemVoz para um só
```

O roteiro é uma fila de 13 cenas, uma por fala, cada uma com uma piada e um recurso do Nexo: o Léo que
"já tá entrando" (o gancho), a chegada do Nexo no drop, tela com som, assistir só quem quer, volume por
pessoa, a mesa de sons e a piada do pato, o bot de música ("Evidências"), a placa de vídeo, o tema claro,
onde funciona, o grátis e o código de recuperação, a enquete "qual amigo é você?" (para comentários) e a
chamada final ("marca o Léo"), que volta ao gancho. O código fica em `video/src/reels`:

| arquivo | o que tem |
|---|---|
| `linha.js` | a linha do tempo: cada cena dura o que a fala dura; o carimbo do NEXO cai no drop |
| `cenas-a.jsx`, `cenas-b.jsx` | as 13 cenas e os efeitos de cada uma |
| `pecas.jsx` | legenda que estoura por palavra, adesivo, etiqueta, confete, câmera que dá soco na batida |
| `Reels.jsx` | as duas versões: trilha com *ducking* sob a voz, falas e efeitos no nível de cima |
| `falas.json` | duração e trechos de cada fala (gerado por `scripts/reels-audio.cjs`) |

**Trocar uma fala** (texto, voz): ponha o `vNN.mp3` novo em `video/public/audio/reels/origem`, rode
`node scripts/reels-audio.cjs` (apara, acelera 6%, iguala o volume e remede) e renderize: a linha se
refaz sozinha. As falas foram geradas com `eleven_v4` e a voz premade **Liam**, porque as vozes
brasileiras da biblioteca exigem o plano Creator; com ele, vale regerar com uma voz nativa. Nada disso
foi ouvido — **ouça antes de publicar**, principalmente o sotaque e o ritmo das piadas.

A trilha (`trilha-a`, Music v2, 78 s, 120 BPM, fase 0) tem o drop exato em 8,00 s; a `trilha-b` (60 s, drop
em 7,3 s fora do compasso) ficou de reserva. Efeitos novos: `arranhao` (disco arranhando, "47 minutos
depois"), `buzina` (só no flash do tema claro) e `plateia` (risada, depois das piadas). Os avisos da sala
e o `impacto` ganham cópias mais altas em `public/audio/reels/sfx` (a sala os quer discretos; um anúncio, não).
Gasto de créditos: ~3.000 (≈ US$ 0,30), todas as gerações no fluxo "Nexo · Reels de humor" do ElevenLabs.

## Testes

- `npm test` — a decisão (quando abre, em que aba, o maior "lido") e a lista de edições.
- `npm run test:novidades` — pela tela: abre uma vez, trava, destrava pelo fim e pelo tempo, não
  volta no F5, reabre pelo botão, abre sobre a entrada da sala e devolve o foco ao nome, o "lido"
  chega a outro aparelho pela conta, uma edição nova (injetada) reabre na lista, tema claro e
  celular sem rolagem lateral. As capturas ficam em `test-results/novidades`.
