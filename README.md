# Nexo · Tela Compartilhada

Sala de voz e vídeo em tempo real. Os participantes podem ligar microfone, câmera e compartilhar tela.

A mídia passa por um **servidor de mídia (SFU)** que sobe junto com o Node: cada pessoa envia uma
cópia da própria imagem, e ele entrega a cada espectador a qualidade que a conexão dele aguenta.
Isso resolve os dois limites da malha ponto a ponto anterior — a conexão é sempre de saída para um
endereço público, então não é mais preciso furar o NAT dos dois lados, e o upload de quem transmite
deixou de crescer com o tamanho da sala.

O custo dessa escolha é explícito: **toda a mídia passa pela conexão de quem hospeda**. Quatro
espectadores de uma tela em 1080p continuam somando cerca de 32 Mbps de upload — a diferença é que
agora eles saem sempre da mesma máquina, e não do participante que estiver compartilhando.

A interface Nexo tem navegação lateral, presença do squad, chat com envio de imagens no celular,
palco com recuperação de reprodução e diagnóstico de mídia. A mesma sala é usada pelo navegador
e pelo Electron. Veja [a revisão técnica e o roteiro de teste no iPhone](docs/revisao-safari.md).

**Telas são assistidas a pedido**, como no Discord: quando alguém compartilha, todo mundo vê que a
transmissão existe, mas a imagem só desce do servidor para quem clicar em **Assistir** — e para de
descer ao clicar em **Parar**. Numa sala com várias telas no ar isso muda o custo de quem só quer
conversar, e reduz o de quem transmite: sem ninguém assistindo, o servidor desliga as camadas e o
codificador fica ocioso. Câmera e voz continuam chegando sozinhas.

A sala tem ainda um **bot de música por sala**, que entra na chamada como participante e toca o
que for pedido no canal `♪ música`, e uma **mesa de sons** temporária, que vive enquanto a sala
existir. Os dois estão descritos abaixo.

Para desenvolver a interface sem recompilar os helpers nativos, use `npm run dev`. A captura de
áudio por processo continua exigindo os executáveis compilados por `npm run build:helper`, a
mídia exige o servidor baixado por `npm run build:sfu` — `npm start` faz os dois — e o bot de
música exige as ferramentas baixadas por `npm run musica:instalar`.

## Painel privado de telemetria

O dashboard de custo, banda, limites de uso e saúde sobe junto com o servidor em `/painel`.
Na máquina do servidor, execute `npm run painel:chave` para consultar a chave de acesso.
Consulte [acesso remoto, contabilidade, limites e testes](docs/telemetria.md) para configurar
HTTPS/proxy e entender a cobertura dos números. Verificações: `npm test` e `npm run test:painel`.

## Requisitos

- Windows 10/11 para executar o helper nativo de captura de audio por aplicativo.
- Node.js 18 ou superior: https://nodejs.org/
- Visual Studio Build Tools 2022 (ou Visual Studio) com Desenvolvimento para Desktop com C++, MSVC para x64 e Windows 10/11 SDK.
- Navegador atualizado. Chrome ou Edge sao as opcoes mais completas para captura de tela e audio.
- Para acesso pela internet: HTTPS. `localhost` funciona sem HTTPS, mas um IP publico em HTTP normalmente impede `getDisplayMedia`.

> O helper usa a API de loopback por processo do Windows. Ela exige Windows 10 build 20348 ou superior, ou Windows 11. Em builds antigos do Windows 10, use captura de audio pelo navegador, VB-CABLE/OBS ou atualize o sistema.

## Instalar depois de clonar

No PowerShell, abra a pasta do projeto e execute:

```powershell
git clone URL_DO_REPOSITORIO tela-compartilhada
Set-Location tela-compartilhada
npm install
```

O `npm install` instala as dependências do servidor e o modelo RNNoise usado pelo cliente. Não é preciso instalar dependências manualmente dentro de `native/`; os arquivos do helper e do WIL já estão no repositório.

## Rodar no proprio computador

O comando abaixo compila o helper C++ em `native/audio-helper/x64/Release/` e inicia o servidor:

```powershell
npm start
```

Se a compilacao falhar, confirme que `C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe` existe e que o workload de C++ e o Windows SDK foram instalados.

Acesse no computador que executa o servidor:

- Inicio: http://localhost:3000/
- Sala: http://localhost:3000/sala

Para uma conferência da interface na mesma rede, o IP local do servidor permite abrir a página. Porém, HTTP por IP não é um contexto seguro e pode bloquear câmera/microfone e outras APIs de mídia. Para conversar e compartilhar, use o endereço HTTPS do Funnel descrito abaixo, inclusive no iPhone.

## Como usar

1. Abra a pagina inicial, digite um codigo de sala (4 a 32 caracteres, letras minusculas, numeros, `_` ou `-`) e clique em **Criar sala** ou **Entrar na sala**. Isso leva para `/{codigo}/sala`.
2. Escolha um nome de exibição. Você entra com microfone e câmera desligados; as permissões só são pedidas quando você ativa cada recurso.
3. Use a barra inferior para ligar microfone, câmera ou compartilhar a tela. Em **Dispositivos** ficam o teste de áudio, a prioridade de vídeo e o RNNoise. No Electron, compartilhar uma janela seleciona automaticamente o áudio do programa. Para transmitir uma única aba com áudio, use Chrome/Edge. Ao compartilhar o monitor inteiro, permanecem as opções de inclusão/exclusão de programas.
4. Cada participante controla localmente o volume e o mudo de cada outro participante (sem afetar o que os demais ouvem). Clique na camera ou na tela de alguem para destacar no palco.
5. Na barra lateral, ao lado do chat, ficam os canais **♪ música** (peça uma faixa e o bot toca
   para a sala) e **◎ mesa de sons** (efeitos sonoros que qualquer um envia e dispara). Veja
   [Bot de música](#bot-de-música-canal--música) e [Mesa de sons](#mesa-de-sons-soundboard).
6. Compartilhe o link pelo botão **Convidar amigos**. Se o host usa `localhost`, configure `PUBLIC_URL` com o endereço HTTPS do Funnel para que o convite use esse endereço. Sem essa configuração, o convite usa a origem aberta no navegador. Links antigos (`/{codigo}/compartilhar` e `/{codigo}/ao-vivo`) continuam funcionando.

Cada participante conecta diretamente com cada outro (mesh P2P) -- funciona bem em salas pequenas (ate 4-5 pessoas); o servidor nao retransmite midia, so a sinalizacao.

### Como o audio da tela e escolhido (automatico)

Marcando **Compartilhar audio (automatico)**, a origem do som e decidida sozinha a partir do
tipo de captura e de quem voce e na sala:

| Situacao | O que e transmitido | De qual computador | Tem eco? |
| --- | --- | --- | --- |
| Compartilhando uma **aba** (qualquer participante) | So o audio daquela aba | Do proprio participante | Nao |
| **Janela/tela inteira** com o **agente rodando** | Todo o audio do sistema **menos a arvore de processos do navegador** | Do proprio participante | Nao |
| **Janela/tela inteira**, aberto **direto no computador do servidor** | Idem, pelo helper do proprio servidor | Do host | Nao |
| **Janela/tela inteira**, sem agente | Audio do sistema capturado pelo navegador | Do proprio participante | Pode ter |

O caso do host usa o helper nativo do Windows (loopback por processo, modo `excludetree`). O
processo a excluir e descoberto sozinho: o servidor identifica a familia do navegador pelo
`user-agent`, lista os processos com `Win32_Process` e acha a raiz da arvore (o processo cujo
pai nao e do mesmo navegador). Como a exclusao vale para a arvore inteira, todas as abas saem
junto -- inclusive a desta chamada. E o mesmo efeito de "todo o som menos o Discord".

Participantes em **outros computadores** nao usam esse helper: ele roda na maquina do servidor
e capturaria o audio do host, nao o deles. Eles usam o caminho do navegador, que captura o
audio do **proprio computador** deles normalmente -- basta marcar a caixa de compartilhar audio
na janela do Chrome/Edge (sem ela nao vai audio nenhum, e a causa mais comum de "compartilhei
mas nao saiu som"). A forma garantida de mandar audio sem eco nesse caso e **compartilhar uma
aba**: ai o navegador entrega apenas o audio daquela aba. A interface avisa isso e oferece um
botao para trocar para compartilhamento de aba.

> **Importante para quem hospeda com tunel/proxy (Cloudflare Tunnel, nginx):** atras de um
> proxy todas as conexoes chegam ao servidor como `127.0.0.1`. Se o servidor confiasse so nesse
> endereco, qualquer participante remoto seria confundido com o host e acabaria transmitindo o
> audio do computador do host. Por isso a captura nativa e liberada apenas quando a conexao e
> direta e o cabecalho `Host` aponta para um endereco desta maquina na porta real do servidor;
> qualquer sinal de proxy desliga o recurso. Consequencia pratica: se voce hospeda e quer usar
> a captura nativa, abra a sala por `http://localhost:3000/{codigo}/sala` no proprio computador,
> mesmo que os outros entrem pelo endereco publico. A interface mostra esse aviso sozinha.

### Escolher microfone, fone e camera

O botao **Dispositivos**, na barra de baixo, escolhe qual microfone, qual saida de audio e
qual camera usar. A troca vale na hora, no meio da conversa: o microfone novo entra sem cortar
a chamada, o filtro de ruido e remontado nele e o mudo continua valendo se estava mudo.

A escolha fica guardada no navegador. Se o aparelho escolhido nao estiver mais ligado, a sala
usa o padrao do sistema e mostra o escolhido como "desconectado" -- a preferencia continua la
para quando ele voltar.

Duas limitacoes que vem do navegador, nao daqui:

- Os **nomes** dos aparelhos so aparecem depois de conceder a permissao de microfone ou camera
  uma vez. Antes disso a lista existe, mas vem anonima; a propria tela avisa.
- Escolher a **saida** de audio (`setSinkId`) so existe em navegadores baseados no Chromium. No
  Firefox e no Safari quem decide e o sistema operacional, e o seletor nao aparece.

### Escolhendo o que do som do sistema vai junto

O Windows captura audio de processo com **um** alvo por captura: ou tudo **menos** uma arvore
de processos, ou **somente** ela. Nao da para somar duas exclusoes -- misturar audio e uniao,
nao intersecao -- e e isso que faz existirem tres modos, no painel de compartilhar tela:

| Modo | O que vai para a sala | Quando usar |
| --- | --- | --- |
| **Tudo, menos um programa** (padrao) | Todo o som, menos o navegador desta pessoa | A conversa por voz e aqui. E o caso sem eco. |
| **Somente um programa** | So o som do programa escolhido | A conversa por voz e por fora (Discord) **e** voce compartilha tela |
| **Tudo, menos este aplicativo** | Todo o som, menos o aplicativo de mesa | Aparece so rodando pelo aplicativo (veja abaixo) |

**Por que "somente um programa" existe.** Com voz no Discord e tela compartilhada por aqui, as
duas escolhas do modo padrao quebram: excluindo o Discord, o navegador entra na captura e
devolve para a sala a tela que os outros estao compartilhando; excluindo o navegador, o Discord
entra e a voz de todo mundo volta. Sao os dois que precisam ficar de fora, e a unica forma de
conseguir isso e dizer o que **entra**. Escolha o jogo (ou o que estiver tocando) e nada mais sai.

A sala tambem **avisa antes** de o eco acontecer: se voce esta mandando som de tela, alguem mais
tambem esta, e o modo escolhido deixa o navegador dentro da captura, aparece uma faixa dizendo
quem esta voltando como eco e o que fazer.

## Download do aplicativo

O `.exe` tem cerca de **95 MB** — um Electron carrega o Chromium inteiro, então ele não é o
arquivo pequeno que parece. Medido: o servidor entrega os 95 MB em **0,35 s** pelo loopback
(285 MB/s), então quando o download demora o gargalo não está aqui.

Pelo **Tailscale Funnel** o tráfego público não vai direto: ele atravessa um relay DERP da
Tailscale (o mais próximo daqui é São Paulo, 35 ms), e esses relays limitam a banda de propósito,
para ser justo entre todos que os usam. Somando a isso a subida da sua casa — que costuma ser
uma fração da descida —, 95 MB demoram mesmo. Não há ajuste no Nexo que contorne isso: o limite
é do caminho, não do servidor.

O que dá para fazer:

- **Rebaixar não custa nada.** O download passou a permitir cache com revalidação obrigatória,
  então um segundo clique devolve `304` e zero byte em vez dos 95 MB. Continua sem servir build
  velha: quando o `.exe` muda, o `ETag` muda e o arquivo novo desce inteiro.
- **Retomar funciona** (`Accept-Ranges: bytes`), então uma queda no meio continua de onde parou
  em vez de recomeçar.
- **Hospedar o arquivo fora** é o único jeito de sair do Funnel. Publicando o `.exe` em algo com
  CDN própria, o download deixa de passar pela sua conexão.

### Teto de downloads

| Limite | Valor |
| --- | --- |
| Downloads simultâneos por endereço | 3 |
| Downloads iniciados por endereço | 20 a cada 10 min |

Existe porque o arquivo é grande e sai pela sua subida: sem teto, uma aba com defeito — ou
alguém se divertindo — ocupa a banda da casa inteira e a sala toda sente. Quem estoura recebe
`429` com `Retry-After`; **nada mais é afetado**, porque o teto vale só para
`/downloads/SalaCompartilhada.exe`. Entrar na sala, o token de mídia, o chat e os arquivos da
página continuam respondendo normalmente para a mesma pessoa.

Os números são generosos de propósito: uma retomada legítima reabre a conexão várias vezes, e um
teto apertado transformaria uma rede instável em "o download não funciona". O que ele barra é o
laço automatizado.

Atrás do Funnel toda conexão chega de `127.0.0.1`, e o endereço real de quem baixa vem no
cabeçalho `X-Forwarded-For`. O teto lê esse cabeçalho — **e só quando quem o entrega é o proxy
local**. Sem essa leitura, o teto viraria um teto para a sala inteira, com o primeiro a baixar
gastando a cota de todos; e sem a checagem de origem, qualquer um escreveria o cabeçalho e
burlaria o próprio limite.

## O que a sala lembra de você

Cada pessoa tem escolhas que repete toda vez: o volume de quem fala alto, o fone certo, a
qualidade que a conexão dela aguenta. Refazer isso a cada entrada é o tipo de atrito que
some sozinho quando a sala presta atenção.

| Lembrado | Onde vale |
| --- | --- |
| Nome de exibição | sempre |
| Microfone, fone e câmera | sempre |
| Qualidade, prioridade e codec | sempre |
| Redução de ruído ligada/desligada | sempre |
| O que compartilhar e se o som vai junto | sempre |
| **Volume e mudo de cada pessoa** | por nome, em qualquer sala |
| **Volume do bot de música** (o seu) | por nome, em qualquer sala |
| **Volume da mesa de sons** | **por sala** (a primeira vez herda o último usado) |
| Barra lateral recolhida | sempre |

E uma que **não** fica no navegador de ninguém, porque não é de ninguém: o **volume do bot na
sala** (`!volume`) é da sala, vale para todo mundo e vive no servidor enquanto a sala existir —
ver [Bot de música](#bot-de-música-canal--música).

Tudo vive no `localStorage` do navegador de cada um. **Nada disso vai para o servidor nem é
visto por outra pessoa** — abaixar o volume de alguém é uma decisão privada, e continua sendo.
Numa janela anônima, ou com armazenamento bloqueado, a sala funciona igual: apenas não lembra.

O volume é guardado pelo **nome**, e não pela identidade. A identidade de mídia carrega um
sufixo sorteado a cada entrada (`Ana#3f2a91c0`), então lembrar por ela seria não lembrar nada.
Pelo nome, o ajuste sobrevive a sair e voltar — e é o mesmo motivo pelo qual o volume do bot
vale em qualquer sala: o nome dele é sempre o mesmo.

Três decisões contêm o tamanho disso. Só se guarda o que foi **mudado** (voltar ao padrão apaga
a entrada em vez de gravar o padrão); a lista tem **teto de 40 pessoas**, descartando quem foi
ajustado há mais tempo; e a gravação é **adiada**, porque arrastar um controle de volume dispara
dezenas de eventos e escrever no armazenamento é síncrono — trava a mesma linha que desenha a
sala. Uma escrita por ajuste, não trinta por gesto.

A mesa de sons é a exceção que é guardada **por sala**, e não pela pessoa em geral: cada sala
tem os sons que subiram nela, e o quanto eles incomodam depende de quais são — uma mesa de
gritaria pede 20%, uma de trilha de fundo pede 80%. Um número só para todas fazia reajustar a
cada troca. Entrar numa sala nova não recomeça do zero: vale o último volume escolhido em
qualquer lugar, e só a partir do primeiro ajuste ali aquela sala passa a ter o dela. O teto
aqui é de **20 salas**.

O que **não** é lembrado, de propósito: zoom do palco, modo teatro e qual painel estava aberto.
São estado de navegação, não preferência — restaurá-los faria a pessoa entrar numa tela que ela
não pediu.

Em **Dispositivos** há uma linha dizendo quantas pessoas têm volume ajustado, e um botão para
esquecer tudo. Ela existe porque uma preferência guardada vira um mistério no dia em que a
pessoa esquece que a fez: "não estou ouvindo fulano" cuja causa é um volume baixado meses atrás
e sem nada na tela que explique.

## Por onde cada coisa passa

Tudo sai da mesma máquina, mas por **dois caminhos diferentes** — e a diferença é o que decide
o custo e a latência de cada recurso:

| O quê | Caminho | Por quê |
| --- | --- | --- |
| Voz, câmera, tela | servidor de mídia (WebRTC) | é fluxo contínuo; o SFU entrega a cada um a qualidade que a conexão dele aguenta |
| **Bot de música** | servidor de mídia (WebRTC) | entra como participante, então a sala ouve o mesmo instante da música e o volume por pessoa já existe |
| Chat e avisos | sinalização (Socket.IO) | mensagens pequenas que precisam chegar na hora |
| **Mesa de sons** | HTTP + reprodução local | o arquivo desce uma vez por navegador, com cache, e toca **ali**; o disparo é só um aviso |

A mesa é o único caso que **não** passa pelo servidor de mídia, e é de propósito: um efeito
sonoro vale pelo tempo. Subir, codificar, distribuir e decodificar custaria centenas de
milissegundos; tocando local o atraso é o do aviso — **1 ms** entre o clique de uma pessoa e o
som na outra aba, medido em rede local.

Em compatibilidade os dois caminhos pedem coisas diferentes. Voz, câmera, tela e o bot pedem
WebRTC, que todo navegador atual tem. A mesa pede Web Audio e um `<audio>` capaz de tocar MP3 —
por isso tudo que entra nela é convertido para MP3, o formato que até o Safari do iPhone toca.

No iPhone há uma regra a mais: o Safari só libera áudio dentro de um gesto. O botão **Ativar
reprodução · som e vídeo**, que a sala já mostrava para vídeo e voz, agora destrava também o
contexto da mesa de sons. Sem isso, quem entrasse pelo iPhone e nunca abrisse a janela de sons
ouviria a sala inteira menos a mesa — e sem nada na tela explicando por quê.

### Engasgos no celular

Duas mudanças atacam o "engasginho" que aparece em rede móvel ou Wi-Fi instável.

**A música ganhou meio segundo de reserva.** O navegador guarda uns **30 ms** de áudio antes de
tocar, e esse número existe para conversa: cada milissegundo a mais é atraso entre alguém falar e
o outro ouvir. O preço é não ter folga — um pacote fora de hora vira engasgo audível. Com o bot
esse preço não se justifica, porque ninguém conversa com a música: a faixa dele agora pede
**500 ms** de reserva (medido: o buffer real subiu de 30 ms para 345 ms e segue subindo). A voz
das pessoas continua com a folga curta de sempre — a diferença é aplicada só à faixa do bot,
reconhecida pela identidade reservada.

**A câmera do celular passou a codificar duas camadas, não três.** Simulcast codifica a mesma
imagem uma vez por qualidade, para cada espectador receber a que a conexão dele aguenta. Num PC
isso é barato; num telefone é a terceira codificação que empurra o aparelho ao limite — e o
sintoma não é a imagem ficar feia, é ela tropeçar, porque o codificador não termina um quadro
antes do próximo chegar. Com duas camadas a adaptação continua existindo e some um terço do
trabalho. As duas são declaradas a 30 fps de propósito: os presets prontos da biblioteca limitam
a 20, e trocar três camadas a 30 por duas a 20 consertaria o tropeço criando outro. No
computador nada muda.

Se o engasgo persistir, o **Diagnóstico** agora mede exatamente isso: `congelamentos` e
`descartados` no vídeo, e `buffer`, `jitter`, `perdidos` e `remendos` no áudio. Do lado do
servidor a reprodução foi medida por 138 segundos sem uma única falha de entrega (a fila ficou
estável em ~510 ms, o Node em 1,8 % de processador) — então, se o diagnóstico mostrar perdas, a
causa está no caminho até o aparelho, e não no bot.

## Bot de música (canal `♪ música`)

Cada sala tem um canal próprio para música. Escreva o nome de uma faixa — ou cole um link — e o
**Nexo DJ** entra na chamada como mais um participante e toca para todo mundo.

```
tame impala the less i know the better     pedir é só escrever
https://youtu.be/...                       link também: cole e pronto
!bot <música>                              o mesmo, explícito (!tocar e !p também servem)
!lista <link>                              a playlist inteira, mesmo de um link de música
!pular  !pausar  !voltar                   controle da reprodução
!parar                                     esvazia a fila e tira o bot da chamada (= !sair)
!fila  !agora  !embaralhar  !remover <n>   a fila
!volume 0-150                              volume do bot para a sala inteira (fica guardado)
!ajuda
```

`!parar` e `!sair` são a mesma coisa: a fila é esvaziada, o download encerrado, a faixa
despublicada e o bot deixa a chamada — medido em **100 ms** do comando até ele sumir da lista de
participantes. Ele volta sozinho no próximo pedido. Sem isso o bot continuava plantado na sala
por mais um minuto e meio depois de `!parar`, mudo, ocupando um lugar na lista de todo mundo.

**O volume é da sala, não da passagem do bot por ela.** Quem deixou em 40% deixou a sala em 40%:
o bot sair (por `!parar`, ou sozinho depois de 90 s sem fila) não desfaz isso, e o próximo pedido
entra nos mesmos 40%. Antes voltava a 85% a cada ida e volta, o que é um susto no meio da conversa
de todo mundo. `!volume` também vale **antes** de o bot chegar — dá para deixar a sala pronta em
vez de chamá-lo alto para só então abaixá-lo. A escolha vive no servidor enquanto a sala existir
e some com ela, como o histórico do chat e a mesa de sons. O slider no quadradinho do Nexo DJ
continua sendo o seu, separado deste, e é lembrado no seu navegador.

### De onde o bot aceita link

| Plataforma | Faixa | Álbum / playlist | Como |
| --- | --- | --- | --- |
| YouTube, YouTube Music | ✅ | ✅ | baixado direto |
| SoundCloud (`/sets/`) | ✅ | ✅ | baixado direto |
| Bandcamp (`/album/`) | ✅ | ✅ | baixado direto |
| **Spotify** | ✅ | ✅ | nome + artista lidos da página, tocado do YouTube |
| **Deezer** | ✅ | ✅ | idem |
| **Apple Music** | ✅ | ✅ álbum | idem (playlist da Apple não abre para fora) |

As três últimas **não entregam o áudio para ninguém de fora** — o fluxo é cifrado e não há conta
paga que resolva. O que dá para fazer é o que todo bot de música faz: ler na página pública qual
é a música e tocá-la de onde é possível baixar.

**O que decide se toca a música certa é ler o artista junto com o nome.** O `oEmbed` do Spotify
devolve só o título: para a faixa [`RUDE!`, do Hearts2Hearts](https://open.spotify.com/track/2bAQsNqdo62T8akkIvWzGl),
ele devolve `RUDE!` e mais nada — e a busca trazia `Rude`, do Magic!, outra música de outra
década, incomparavelmente mais popular. Tocava a errada sem nenhum aviso de que era. Lendo a
mesma ficha que o tocador do Spotify usa, a busca vira `Hearts2Hearts RUDE!` e o primeiro
resultado é o certo:

| Busca | Primeiro resultado |
| --- | --- |
| `RUDE!` (antes) | ❌ MAGIC! — Rude (Official Video) |
| `Hearts2Hearts RUDE!` (agora) | ✅ Hearts2Hearts 하츠투하츠 'RUDE!' MV — SMTOWN |

Também entendidos: o `/intl-pt/` que o Spotify põe no caminho de quem abre o site em português,
o `spotify:track:…` do aplicativo, os links encurtados do botão de compartilhar (`spotify.link`),
e a diferença entre `…/album/<id>` (o disco) e `…/album/<id>?i=<faixa>` da Apple Music (uma
música só). O que o `yt-dlp` já baixa sozinho não passa por nada disso.

### Listas sem sair da sala

`!lista <nome>` procura playlists e devolve cinco para escolher, com um toque:

```
!lista rock anos 80
→ Achei 5 listas. Toque em uma para enfileirar:
  ♪ Best of Classic Rock
  ♪ Top 500 Classic Rock songs
  ♪ 80s Rock Hits Music Playlist …
```

Colar um link continua funcionando e é o caminho mais direto quando você já tem a lista aberta.
A busca existe para o outro caso: quando encontrá-la significaria trocar de aplicativo, procurar,
copiar o endereço e voltar — três passos fora da conversa para uma coisa que a conversa devia
resolver. Os botões travam depois do primeiro toque, para dois cliques não enfileirarem duas
listas.

### Playlists

Um `list=` no endereço quer dizer duas coisas diferentes, e o bot trata cada uma como ela é:

| O que você cola | O que acontece |
| --- | --- |
| `/playlist?list=…`, um `/sets/` do SoundCloud, um `/album/` do Bandcamp | **Entra inteira** (até 100 faixas, limitado pelo espaço na fila) |
| Um álbum ou uma playlist do Spotify, do Deezer ou da Apple Music | **Entra inteira**, cada faixa com nome e artista de origem |
| `/watch?v=X&list=Y` — uma música que por acaso estava numa lista | Toca **só ela**, e avisa que dá para pegar a lista com `!lista` |
| Uma faixa do Spotify que por acaso está num álbum | Toca **só ela** |

A distinção existe porque o YouTube monta o segundo formato para *qualquer* vídeo aberto a partir
de uma playlist: enfileirar cinquenta faixas ali seria sequestrar a sala por causa de um copiar e
colar. Quando a lista é o que você quer mesmo, `!lista <link>` força.

Uma lista de sessenta faixas entra em cerca de dois segundos porque o bot **não** resolve as
sessenta: ele lê o índice de uma vez (título, duração, endereço da página) e descobre o áudio de
cada uma só quando chega a vez dela — com a seguinte sendo preparada enquanto a atual toca. Vale
igual para as listas do Spotify, do Deezer e da Apple Music: o que entra na fila é o nome e o
artista de cada faixa, e a busca de cada uma é paga quando ela vira a próxima. Medido com o
álbum *Scorpion* pelo link do Spotify: 25 faixas na fila, a primeira tocando, e `!pular` levando
à segunda sem pausa perceptível.
Medido numa playlist real: cinco trocas seguidas com **20 ms** de silêncio em média, 101 ms no
pior caso.

**Por que um participante de verdade, e não um player em cada navegador.** Todo mundo recebe os
mesmos pacotes pelo mesmo caminho do áudio de tela: não há relógio para acertar nem deriva para
corrigir — a sala inteira ouve o mesmo instante da música. E o controle de volume que a sala já
tem **por participante** passa a valer para o bot sem nenhuma interface nova: o `!volume` é o
rádio da sala; o slider no quadradinho do Nexo DJ é o seu.

Três coisas cuidam do desempenho. O bot **só entra quando há pedido**, sai sozinho depois de 90
segundos sem nada na fila e sai na hora com `!parar`; o token dele **não autoriza receber**, então ele nunca baixa a câmera
nem a voz de ninguém; e decodificar acontece num processo à parte por sala, de modo que uma sala
tocando não atrapalha as outras — o Node só recorta o áudio já pronto em quadros de 20 ms.

A busca (a parte cara, uns três segundos conversando com o site) é paga **quando a faixa entra na
fila**, e dela se guarda o endereço direto do áudio. Na hora de tocar, o `ffmpeg` abre esse
endereço sozinho: a troca de faixa sai em torno de **50 ms** em vez de três segundos de silêncio,
e o `yt-dlp` nem aparece no caminho. Ele volta como reserva quando o endereço não serve — porque
venceu, ou porque o site entrega o áudio em pedaços — e aí a faixa é refeita por ele sem que
ninguém precise pedir de novo.

Medido numa sala tocando: 150 s de reprodução contínua sem uma única falha de áudio, memória do
Node constante, e duas salas simultâneas somando 4% de um processador de 12 núcleos.

### Instalar o bot

```powershell
npm run musica:instalar
```

Baixa o `yt-dlp` (17 MB) e, se não houver nenhum no sistema, o `ffmpeg` (106 MB). Sem isso a sala
funciona inteira — só o canal de música fica de fora, dizendo o que falta.

O `yt-dlp` é **sempre o nosso**, nunca o do `PATH`: ele é a peça que negocia com o YouTube, e o
YouTube muda essa negociação a cada poucas semanas. Uma cópia velha não dá erro claro — ela
devolve `403 Forbidden` ou "the page needs to be reloaded", e a sala acha que o bot quebrou.
Quando isso acontecer:

```powershell
npm run musica:atualizar
```

O `ffmpeg` é diferente: ele só converte áudio para PCM, e essa parte não muda entre versões — o do
sistema serve, se existir.

### O que ocupa espaço (e o que não ocupa)

**Música: nada toca o disco.** O `yt-dlp` não baixa para um arquivo — quando ele é usado, escreve
no cano do `ffmpeg`; no caminho normal ele nem entra, e o `ffmpeg` lê o endereço direto da rede.
O áudio decodificado atravessa a memória do Node em quadros de 20 ms (3,8 KB cada) e é descartado
assim que sai para o servidor de mídia. Não existe pasta de cache de música, nem arquivo
temporário, nem limpeza a fazer — não há o que limpar.

Verificado em 12/09/2026: com uma sala tocando por 30 s, a pasta do projeto ficou em 13 708
arquivos e 1 153,87 MB, exatamente como antes, e nenhum `.webm`, `.m4a`, `.part` ou `.ytdl`
apareceu em lugar nenhum. O que cresce enquanto o bot toca é só a memória do processo: **88 MB
constantes**, sem subir ao longo de 150 s.

**Mesa de sons: memória, e só enquanto a sala existir.** Os arquivos ficam num `Map` dentro do
processo Node, nunca em disco, com teto de 2 MB por som, 30 sons e 24 MB por sala, e 256 MB
somando todas as salas. Quando a última pessoa sai, a mesa é apagada junto com o histórico do
chat — o mesmo `if (!membros.size)` cuida dos dois. Reiniciar o servidor também zera tudo,
porque nada disso sobrevive ao processo. Ver [Mesa de sons](#mesa-de-sons-soundboard) para o
porquê de cada limite.

**O que de fato fica gravado em disco:**

| Onde | O quê | Tamanho |
| --- | --- | --- |
| `native/musica/` | o `yt-dlp.exe` (e o `ffmpeg.exe`, se você não tinha um) | 17 MB (+106 MB) |
| `~/.cache/yt-dlp/` | metadados de extração do `yt-dlp` — nunca áudio | dezenas de bytes |
| `node_modules/@livekit/` | o SDK e o binário nativo dele | ~30 MB |

O `~/.cache/yt-dlp` é do próprio `yt-dlp`, não nosso: ele guarda coisas como o `client_id` do
SoundCloud para não pedir de novo a cada faixa. Na máquina de teste o diretório inteiro tinha
**76 bytes**. Para dispensá-lo, acrescente `--no-cache-dir` em `NEXO_YTDLP_ARGS`.

| Variável | Para quê |
| --- | --- |
| `NEXO_MAXIMO_DE_BOTS` | Salas tocando ao mesmo tempo (padrão 8). Recusar a próxima é melhor do que estragar as que já tocam. |
| `NEXO_DURACAO_MAXIMA` | Segundos que uma faixa pode ter (padrão 3 h). |
| `NEXO_YTDLP_ARGS` | Argumentos extras do `yt-dlp` — é aqui que entra `--cookies-from-browser chrome`, se um site exigir login. |
| `NEXO_FILTRO_DE_AUDIO` | Filtro do `ffmpeg` (padrão `loudnorm`, que iguala o volume entre faixas). |

## Mesa de sons (soundboard)

O botão **Sons** na barra inferior abre a mesa da sala: qualquer participante envia um arquivo
curto (MP3, OGG, WAV, M4A, FLAC ou WebM), ele vira um botão, e quem clicar toca **para todo mundo
na hora**.

Cada sala tem a sua, e elas não se enxergam: a sala 1 pode ter dois sons enquanto a sala 2 está
vazia, e o que a sala 2 enviar depois só existe lá. Um clique na sala 1 também não é ouvido na
sala 2 — o aviso de disparo só vai para quem está naquela sala.

Nada disso é guardado em disco. Os sons vivem na memória do processo enquanto a sala existir e
somem quando a última pessoa sai — junto com o histórico do chat e com o bot, pela mesma regra:
nada de uma sala fechada sobrevive a ela. Reiniciar o servidor também zera tudo.

**O volume da mesa é seu e é por sala.** Ele não sobe para o servidor: baixar a mesa não baixa
para os outros, e cada sala guarda o próprio número no seu navegador, porque uma mesa de
gritaria e uma de trilha de fundo não pedem o mesmo volume. A primeira vez numa sala herda o
último volume que você escolheu em qualquer lugar. Detalhes em
[O que a sala lembra de você](#o-que-a-sala-lembra-de-você).

### Um som por pessoa de cada vez

Apertar de novo **troca** o som em vez de somar mais um por cima. A regra é por **pessoa**:

| Quem aperta | O que se ouve |
| --- | --- |
| Você, o mesmo som cinco vezes | só o último — cada toque corta o anterior |
| Você, um som e depois outro | só o segundo |
| Você e outra pessoa, ao mesmo tempo | **os dois juntos** — isso é a mesa funcionando |

Duas pessoas tocando coisas diferentes é metade da graça; uma pessoa tocando quatro ao mesmo
tempo é sempre engano ou bagunça. E não havia como desfazer: não existe botão de "parar", então
cinco cliques num som de trinta segundos deixavam a sala inteira debaixo de uma parede de
barulho até ela acabar sozinha. Medido antes: **cinco cópias vivas ao mesmo tempo**; depois,
uma. O limite de dois cliques por segundo do servidor continua valendo, e ainda permitia umas
setenta cópias no ar.

O corte tem um desligamento de **40 ms** em vez de ser seco: cortar uma onda no meio estala, e
um estalo assusta mais que o som. Quem decide é o navegador de cada ouvinte, sozinho — os avisos
chegam na mesma ordem para todo mundo e a regra só depende de quem disparou, então ninguém
precisa arbitrar.

Um arquivo com mais de 30 segundos **não é recusado: entra cortado no começo**, e quem enviou é
avisado disso. Recusar seria grosseiro com quem arrastou uma música de três minutos querendo só o
comecinho dela.

Todo arquivo que entra é convertido para **MP3 de 128 kbps** no caminho, pelo `ffmpeg`. Isso
resolve três coisas de uma vez: o corte fica garantido no servidor e não na boa vontade de quem
envia, um WAV de 2 MB vira um MP3 de 300 KB, e todo navegador toca o que sair — inclusive o do
iPhone. Sem o `ffmpeg` instalado a mesa continua funcionando, só sem cortar e sem converter.

| Limite | Valor | Quem garante |
| --- | --- | --- |
| Tamanho de um som | 2 MB | servidor |
| Duração de um som | 30 s (corta o excedente) | servidor, pelo `ffmpeg` |
| Sons por sala | 30 | servidor |
| Memória por sala | 24 MB | servidor |
| Memória de todas as salas | 256 MB (`NEXO_SOUNDBOARD_MAXIMO_MB`) | servidor |

Quem pode enviar é **quem está naquela sala**: o envio exige o identificador de socket, que o
servidor sorteia, só o dono conhece, e é conferido contra a sala em que ele realmente está. Um
pedido sem credencial, com uma inventada, ou com a de outra sala recebe `403` — testado também
por `curl`, fora do navegador. Não há como enviar para uma sala em que você não entrou; e quem
entrou já podia enviar de qualquer forma, porque a sala é aberta a quem tem o código.

Os dois últimos são o que impede a mesa de derrubar o Nexo. O limite por sala sozinho não protege
nada, porque se multiplica pelo número de salas — e esse não tem limite: vinte salas cheias
seriam meio giga de `Buffer`, e cem seriam dois giga e meio. Como `Buffer` não vive no monte do
V8 e sim na memória do processo, o desfecho não seria uma exceção tratável, e sim o alocador
falhando ou o sistema encerrando o Node — derrubando vídeo, voz e chat por causa de uma mesa de
sons. Com o teto global, o envio seguinte é recusado com uma frase explicando, e a sala continua.

O limite de **duração** precisa existir porque o de bytes não o implica: dois megabytes são 52
segundos a 320 kbps, mas quase nove minutos a 32 kbps — sem ele dava para usar a mesa como
rádio. Quem corta é o `ffmpeg`, no servidor, e por isso o corte vale mesmo para quem não passa
pela interface: um envio de 90 segundos declarando "5 segundos" foi guardado com **30,0 s**
exatos. O navegador mede a duração antes de enviar apenas para poder avisar ("mando os primeiros
30 s…"), nunca para decidir.

Apagar um som devolve a memória: medido com 40 sons de 1 MB, a memória externa do processo foi de
2 MB para 25 MB e **voltou aos 2 MB** depois que a sala foi limpa. O `Map` solta a referência e o
coletor libera o `Buffer` — não imediatamente, porque objetos grandes têm finalização adiada,
mas sem sobrar nada.

O som **não passa pelo servidor de mídia**. Ele é baixado uma vez por cada navegador, por HTTP com
cache, e tocado ali no instante em que o aviso chega — o disparo tem o tamanho de uma mensagem de
chat. Um efeito sonoro vale pelo tempo: a volta completa pelo servidor de mídia custaria algumas
centenas de milissegundos, e um toque que chega tarde perde a graça.

Cada pessoa tem seu **próprio volume** da mesa, com mudo, guardado no navegador dela. Não muda
nada para os outros — é o equivalente a tapar o próprio ouvido, não a abaixar o rádio.

## Aplicativo de mesa (opcional, Windows)

No navegador o Chrome faz dois papeis ao mesmo tempo: e o **cliente** (toca a voz e as telas dos
outros) e e uma **fonte legitima** de som (um video que voce quer compartilhar). Como a captura
exclui uma arvore de processos so, os dois papeis nao cabem na mesma escolha -- ou voce perde o
Chrome como fonte, ou ele devolve para a rede o que acabou de receber dela.

O aplicativo de mesa desfaz o conflito: o cliente passa a ser ele. Ele manda o proprio PID para o
agente, que exclui essa arvore da captura, e o navegador volta a ser apenas mais um programa que
faz som -- podendo ir inteiro para a transmissao.

A interface nao e duplicada: a janela carrega a mesma URL do servidor que o navegador carregaria.
O aplicativo tambem sobe o `AgenteAudio.exe` sozinho, entao ninguem precisa baixar nada a parte.

```bash
cd app
npm install
npm start
```

Na primeira vez ele pergunta o endereco do servidor (`http://localhost:3000` na maquina que o
hospeda, o IP dela na rede para os outros, ou o endereco publico) e guarda a resposta.

O endereco so e guardado **depois** de a pagina carregar. Se ele nao abrir -- servidor fora do
ar, endereco errado --, o aplicativo volta para a tela de endereco dizendo o motivo, com o que
foi digitado ja preenchido. Para trocar de servidor a qualquer momento: **Ctrl+Shift+S** (a barra
de menu fica escondida; `Alt` mostra).

### Gerar o executavel

```bash
npm run build:helper   # na raiz: compila o helper e o AgenteAudio.exe
cd app
npm install            # so na primeira vez
npm run empacotar
```

Sai um arquivo unico em **`app/dist/SalaCompartilhada.exe`**, com cerca de 96 MB. Nao precisa de
instalacao: dois cliques e abre. O `AgenteAudio.exe` vai embutido dentro dele -- quem recebe nao
baixa mais nada.

O tamanho e do Chromium, que vai inteiro no pacote. E o preco de a sala rodar fora do navegador.

> Compile o agente **antes** de empacotar. O empacotamento le
> `native/audio-agent/x64/Release/AgenteAudio.exe`; se ele nao existir, o pacote sai sem o agente
> e o som do sistema nao e capturado.

### Distribuir para outras pessoas

Mande so o `SalaCompartilhada.exe`. Cada pessoa abre, digita o endereco do seu servidor uma vez
(o IP da sua maquina na rede, ou o endereco publico se voce usa tunel) e pronto.

Tres coisas que vao acontecer e valem ser ditas antes:

- **SmartScreen** vai mostrar "O Windows protegeu o computador" na primeira execucao, porque o
  executavel nao e assinado. O caminho e *Mais informacoes* -> *Executar assim mesmo*. Assinatura
  exige certificado pago; nao ha atalho gratuito.
- **Antivirus** pode barrar, pelo mesmo motivo do agente -- so que agora com um arquivo bem maior
  e que captura audio do sistema. Se sumir da pasta, foi alarme falso.
- **So Windows.** O aplicativo depende da captura de audio por processo, que e uma API do Windows.
  Quem estiver no celular, no Mac ou no Linux continua entrando pelo navegador normalmente.

> **Rodando pelo terminal do VS Code:** ele exporta `ELECTRON_RUN_AS_NODE=1`, e com essa variavel
> o Electron sobe como Node puro -- nenhuma janela abre e o erro nao tem relacao aparente com a
> causa. O `npm start` daqui limpa a variavel sozinho; se voce chamar `electron .` na mao, limpe-a
> antes.

## Agente de audio (para qualquer participante, em qualquer computador)

O helper acima roda na maquina do servidor, entao serve so ao host. Para que **qualquer
participante** transmita o som do proprio computador sem eco existe o `AgenteAudio.exe`: um
executavel unico, de ~360 KB, sem instalacao e sem dependencia nenhuma (nem .NET, nem Node,
nem VC++ Redistributable -- so DLLs do proprio Windows).

**Caminho do audio.** O agente entrega o PCM direto ao navegador da propria pessoa, por um
WebSocket em `127.0.0.1` numa porta escolhida na hora. O navegador descobre essa porta pelo
servidor da sala, que ja sabe qual navegador corresponde a cada agente -- ninguem digita nada,
nao ha porta fixa para dar conflito, e **nao e preciso abrir porta no roteador nem criar excecao
de firewall**, porque trafego de loopback nao passa por nenhum dos dois. A conexao exige o mesmo
token da sala, entao nenhuma outra pagina aberta no computador consegue pedir esse audio.

Sem isso o som fazia uma volta absurda: saia do PC de quem compartilha, atravessava a internet
ate o servidor e voltava para o navegador da MESMA maquina -- duas travessias do tunel, enquanto
o video ia direto P2P. Era essa a causa do audio atrasado em relacao a imagem.

Se a conexao direta nao puder ser aberta (agente antigo, navegador que bloqueie loopback), o
agente volta sozinho a mandar pelo servidor: o audio continua funcionando, so com mais atraso.

**Como o participante usa:** dentro da sala, ao configurar o compartilhamento de tela, aparece
a caixa "Agente de audio" com um botao de download. Ele baixa, da um duplo clique e deixa a
janelinha aberta. Nao ha nada para digitar: o token e o endereco do servidor vao no **nome do
arquivo** e o agente le o proprio nome ao iniciar, como em

```text
AgenteAudio.cfg-<token>-<endereco-do-servidor>.exe
```

O nome e legivel de proposito, para a pessoa ver a qual servidor o agente vai se conectar antes
de executar. Downloads repetidos (que o navegador nomeia com " (1)") continuam funcionando.
Depois da primeira conexao a configuracao fica salva em
`%LOCALAPPDATA%\AgenteAudioSala\config.txt`, entao o agente segue funcionando mesmo se o arquivo
for renomeado.

**Como funciona por dentro:** o agente e sempre *cliente* -- ele conecta para fora, no
`/agente` do servidor, por WebSocket (WinHTTP, com o TLS do proprio Windows). Por isso nao
precisa de certificado, nem de porta aberta, nem esbarra na regra de mixed content do
navegador. Ele captura o audio com a mesma API de loopback por processo do Windows, excluindo a
arvore de processos do navegador (que ele localiza sozinho), e envia o PCM ao servidor, que o
entrega ao navegador daquela mesma pessoa. Dali o audio entra na transmissao WebRTC como
qualquer outra faixa.

O pareamento e sem estado: o token e gerado pelo navegador, fica no `localStorage` dele e vai no
nome do executavel. Servidor e agente se encontram por apresentarem o mesmo token, entao
reiniciar o servidor nao invalida os agentes ja baixados. Trate esse link de download como
privado: quem tiver o token consegue parear com o agente.

**Como hospedar e testar com amigos:** veja a secao "Testando com outras pessoas" mais abaixo.

> **Aviso de antivirus.** O executavel nao e assinado digitalmente -- assinar exige um
> certificado de assinatura de codigo, que e pago. Dois avisos sao esperados:
>
> 1. **SmartScreen** ("O Windows protegeu o seu computador") na primeira execucao: *Mais
>    informacoes -> Executar assim mesmo*.
> 2. **Deteccao como `Trojan:Win32/Wacatac.B!ml` ou `.C!ml`.** O sufixo `!ml` diz que quem
>    acusou foi o modelo de aprendizado de maquina do Defender, na nuvem: nao houve
>    correspondencia com assinatura de malware nenhuma. Um binario pequeno, recem-compilado,
>    sem assinatura, que captura audio e abre um socket cai direitinho nesse perfil generico.
>    Uma varredura local do mesmo arquivo (`MpCmdRun -Scan -ScanType 3 -File ...`) nao acusa
>    nada -- o veredito so aparece no download ou na execucao, quando a nuvem opina.
>
> O que ja e feito para reduzir isso, sem pagar nada:
>
> - o binario carrega **informacoes de versao, icone e manifesto** (`AgenteAudio.rc` e
>   `AgenteAudio.manifest`). Executavel sem metadado nenhum e um dos sinais mais fortes a favor
>   da deteccao, e era exatamente o caso antes;
> - o servidor entrega o binario **sem alterar um unico byte** -- a configuracao viaja no nome
>   do arquivo. A primeira versao gravava a configuracao dentro do `.exe`, e so isso ja bastava
>   para o download ser barrado.
>
> Se mesmo assim for barrado:
>
> - **para liberar agora:** na lista de downloads do Chrome, escolha *Manter*. Se o Defender ja
>   tiver removido, va em *Seguranca do Windows -> Protecao contra virus e ameacas -> Historico
>   de protecao* e escolha *Permitir no dispositivo*;
> - **para resolver de vez, e de graca:** envie o arquivo como falso positivo em
>   <https://www.microsoft.com/en-us/wdsi/filesubmission>. A correcao costuma sair em algumas
>   horas e vale para todo mundo, nao so para o seu computador;
> - **no computador que hospeda:** o Defender pode apagar o `.exe` logo depois de compilado. Se
>   isso acontecer, `/api/agente` responde que o agente nao foi compilado, os participantes
>   ficam sem agente e a sala volta a capturar o audio pelo navegador -- que e justamente o modo
>   **com** eco. Ou seja: **eco que volta do nada costuma ser o antivirus tendo apagado
>   `native/audio-agent/x64/Release/AgenteAudio.exe`.** Vale conferir se o arquivo existe.

**Banda:** o PCM vai cru (44,1 kHz, estereo, 16 bits), cerca de 1,4 Mbps por participante que
esteja compartilhando, e passa pelo servidor duas vezes (sobe do agente, desce para o navegador
da mesma pessoa). Para grupos pequenos e tranquilo; se precisar, da para comprimir com Opus.

## Testando com outras pessoas

Roteiro completo, do zero ate os amigos entrarem.

### 1. Voce (host), no seu PC

```powershell
Set-Location C:\caminho\para\tela-compartilhada
npm install
npm start
```

O `npm start` compila os dois executaveis nativos e sobe o servidor na porta 3000.

### 2. Deixar a sala acessivel pela internet

O navegador so libera microfone e captura de tela em **contexto seguro**, ou seja HTTPS. Como
`localhost` e a unica excecao, seus amigos nao conseguiriam nem falar entrando por `http://` num
IP. Por isso e preciso uma entrada HTTPS.

**Tailscale Funnel (recomendado):** da um endereco fixo, de graca, sem dominio e sem abrir porta
no roteador. Configuracao unica:

```powershell
winget install --id Tailscale.Tailscale
tailscale up                       # abre o navegador para autenticar
tailscale funnel --bg 3000
```

O endereco aparece no fim (`https://<sua-maquina>.<sua-tailnet>.ts.net`) e **nao muda mais**:
depois de reiniciar o PC, so `tailscale funnel --bg 3000` de novo, com o mesmo nome de sempre.
Os amigos baixam o agente uma unica vez.

O video e o audio da conversa nao passam por ai: WebRTC conecta os participantes ponto a ponto.
Pelo Funnel vao so a sinalizacao, os arquivos da pagina e o WebSocket do agente.

Para desligar: `tailscale funnel --https=443 off`.

**Cloudflare Quick Tunnel (alternativa):** nao precisa de conta, mas o endereco e sorteado a cada
execucao.

```powershell
cloudflared tunnel --url http://localhost:3000
```

> Com o Quick Tunnel, toda vez que a URL muda os amigos precisam baixar o agente de novo, porque
> o endereco do servidor vem no nome do arquivo. Nao ha o que fechar antes: ao abrir o arquivo
> novo, o agente antigo se encerra sozinho e cede o lugar. Se o servidor ficar inalcancavel, o
> agente avisa na janela dele depois de algumas tentativas, em vez de tentar em silencio.

### 3. Voce entra na sala

Antes de iniciar o servidor, defina `$env:PUBLIC_URL="https://sua-maquina.sua-tailnet.ts.net"`
com o endereço real informado pelo Funnel. Abra **`http://localhost:3000`** no seu próprio PC.
Crie a sala e use **Convidar amigos**: com `PUBLIC_URL` configurado, o convite terá o endereço público.
O aplicativo não descobre o endereço do Funnel automaticamente.

Usar `localhost` e o que libera a captura nativa de audio para voce sem precisar do agente. Se
voce entrar pela URL do tunel, o recurso fica desativado de proposito (senao voce enviaria o
audio do seu PC em nome de outra pessoa) e a interface avisa isso.

### 4. Seus amigos entram

Eles abrem o link publico terminando em `/{codigo}/sala`, escolhem um nome e ja estao na
conversa por microfone. Camera e tela sao botoes na barra de baixo.

### 5. Audio do sistema para os amigos (opcional)

Se um amigo quiser transmitir o som do computador dele junto com a tela:

1. Clicar em **Compartilhar tela** -> aparece a caixa "Agente de audio" com o botao de download.
2. Baixar, dar um duplo clique e deixar a janelinha aberta. Na primeira execucao o Windows mostra
   *"O Windows protegeu o seu computador"*: clicar em **Mais informacoes -> Executar assim mesmo**
   (o executavel nao e assinado; veja o aviso na secao do agente).
3. A caixa na sala fica verde ("Agente de audio conectado") e o som do sistema dele passa a ir
   junto com a tela, sem eco.

Sem o agente ainda funciona: o som vai pelo proprio navegador, bastando marcar a caixa de
compartilhar audio na janela do Chrome -- mas ai pode haver eco. Compartilhar uma **aba** nunca
tem eco e nao precisa de agente nenhum.

**Requisitos na maquina dos amigos:** Windows 10 build 20348+ ou Windows 11 (a API de captura por
processo nao existe em versoes anteriores) e um navegador atualizado. Nada mais precisa ser
instalado.

## Configuracao

As variaveis sao opcionais e devem ser definidas antes de `npm start` no mesmo terminal:

| Variavel | Padrao | Funcao |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP do servidor |
| `HOST` | `0.0.0.0` | Endereco onde o servidor escuta |
| `PUBLIC_URL` | origem aberta no navegador para convites; localhost nos logs | Origem HTTP(S) pública usada nos convites e nos logs |
| `CORS_ORIGIN` | qualquer origem | Origem permitida pelo Socket.IO; defina uma origem exata em producao |
| `NEXO_IP_PUBLICO` | descoberto sozinho | IP publico que o servidor de midia anuncia |
| `SFU_UDP_PORTS` | `7882-7891` | Portas UDP da midia |
| `SFU_TCP_PORT` | `7881` | Porta TCP alternativa |
| `SFU_PORT` | `7880` | Porta local do servidor de midia; nao abrir no roteador |
| `NEXO_MAXIMO_DE_BOTS` | `8` | Salas com musica tocando ao mesmo tempo |
| `NEXO_DURACAO_MAXIMA` | `10800` | Segundos que uma faixa pode ter |
| `NEXO_YTDLP_ARGS` | vazio | Argumentos extras do `yt-dlp` (ex.: `--cookies-from-browser chrome`) |
| `NEXO_FILTRO_DE_AUDIO` | `loudnorm=I=-16:TP=-1.5:LRA=11` | Filtro do `ffmpeg` aplicado a musica |
| `NEXO_SOUNDBOARD_MAXIMO_MB` | `256` | Memoria da mesa de sons somando TODAS as salas |

Exemplo:

```powershell
$env:PORT="3000"
$env:HOST="0.0.0.0"
$env:PUBLIC_URL="https://stream.exemplo.com"
$env:CORS_ORIGIN="https://stream.exemplo.com"
npm start
```

`PUBLIC_URL` não publica o servidor nem configura DNS. Ele define o endereço de convite e os logs.

## Publicar com Cloudflare Tunnel

O Tunnel cria uma conexao de saida do computador para a Cloudflare, sem abrir a porta 3000 no roteador. O HTTPS termina na Cloudflare e o tunnel encaminha para `http://localhost:3000`. Ainda assim, a sala nao tem login: trate o link e o codigo da sala como informacao privada.

### Opcao rapida, sem conta e temporaria

1. Instale o `cloudflared` no Windows. Com `winget`:

```powershell
winget install --id Cloudflare.cloudflared
```

   Alternativamente, baixe o executavel em https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ e coloque-o no `PATH`.
2. Em um terminal, inicie o projeto:

```powershell
npm start
```

3. Em outro terminal, crie o tunnel:

```powershell
cloudflared tunnel --url http://localhost:3000
```

4. Copie a URL `https://....trycloudflare.com` mostrada no terminal e use `/sala` (ou `/{codigo}/sala`) para entrar na sala.

Esse endereco e aleatorio, muda quando o processo termina e e apropriado para testes. Mantenha a janela do `cloudflared` aberta durante a transmissao. Nao use um Quick Tunnel como endereco permanente.

### Opcao permanente com dominio proprio

Essa opcao exige uma conta Cloudflare e um dominio cuja zona DNS esteja na Cloudflare.

1. Instale o `cloudflared` e autentique o computador:

```powershell
cloudflared tunnel login
```

Uma pagina sera aberta; escolha a zona do seu dominio e autorize o acesso.
2. Crie um tunnel nomeado e um registro DNS:

```powershell
cloudflared tunnel create tela-compartilhada
cloudflared tunnel route dns tela-compartilhada stream.seudominio.com
```

3. Crie `cloudflared-config.yml` fora do repositorio, substituindo o caminho pelo arquivo de credenciais criado no passo anterior:

```yaml
tunnel: ID_DO_TUNNEL
credentials-file: C:\Users\SEU_USUARIO\.cloudflared\ID_DO_TUNNEL.json

ingress:
  - hostname: stream.seudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

4. Inicie o Node e o tunnel:

```powershell
$env:PUBLIC_URL="https://stream.seudominio.com"
$env:CORS_ORIGIN="https://stream.seudominio.com"
npm start
cloudflared tunnel --config C:\caminho\cloudflared-config.yml run tela-compartilhada
```

Use `https://stream.seudominio.com/sala` (ou `/{codigo}/sala`) para entrar na sala. O DNS e o certificado HTTPS sao gerenciados pela Cloudflare. Proteja o arquivo `.json` de credenciais e nunca o commite.

Para manter o servico apos reinicializacoes, configure o `cloudflared` como servico do Windows ou use o Agendador de Tarefas. O processo Node tambem precisa ser mantido ativo por NSSM, PM2 ou um servico do Windows.

## Dominio proprio sem Cloudflare Tunnel

Outra arquitetura e apontar o DNS para um servidor publico e colocar Caddy ou Nginx como proxy HTTPS na frente do Node. O proxy deve encaminhar HTTP e WebSocket para `localhost:3000`; libere apenas as portas 80/443 no firewall e mantenha o Node escutando localmente. Configure `PUBLIC_URL` e `CORS_ORIGIN` com a URL HTTPS final. Nao encaminhe a porta 3000 diretamente quando o objetivo for acesso publico seguro.

## Servidor de mídia

O `npm start` baixa o servidor de mídia na primeira execução (versão e hash fixos em
`scripts/baixar-livekit.cjs`), sobe junto com o Node e encerra junto. Não há passo manual.

**A sinalização não abre porta.** O cliente conecta em `/rtc` na mesma origem que serviu a página,
e o Node encaminha isso para o processo local — a sinalização herda o HTTPS do túnel, sem
certificado nem domínio próprio. Só a mídia usa porta própria:

| Porta | Protocolo | Para quê |
| --- | --- | --- |
| 7882-7891 | UDP | Mídia |
| 7881 | TCP | Alternativa para redes que bloqueiam UDP |

A porta 7880 fica só em `127.0.0.1` e **não** deve ser aberta no roteador.

Se algum participante ficar sem mídia em rede corporativa ou de hotel, o passo seguinte é mover a
mídia para UDP 443 e a alternativa para TCP 443, com `SFU_UDP_PORTS` e `SFU_TCP_PORT`: muitas dessas
redes liberam a 443 por causa do QUIC.

### O que conferir quando a mídia não passa

Abra **Diagnóstico** na sala. Ele mostra o estado da conexão com o servidor de mídia, a rota
escolhida, o codec e — quando o navegador informa — se a placa de vídeo está codificando.

O servidor de mídia precisa de um endereço alcançável de fora. Sem `NEXO_IP_PUBLICO` ele descobre o
próprio IP sozinho; com a variável definida, anuncia exatamente esse. **Atrás de CGNAT nada disso
funciona**, porque não existe endereço público para anunciar: compare o IP WAN do seu roteador com
o resultado de `curl -s https://api.ipify.org` antes de investigar qualquer outra coisa.

O TURN embutido fica desligado de propósito: ele existe para servidores sem IP público, e a
alternativa por TCP já cobre quem bloqueia UDP. Para o cenário sem IP público, o caminho continua
documentado em [`docs/turn.md`](docs/turn.md).

## Seguranca e privacidade

- HTTPS e necessario para captura de tela fora de `localhost`; nunca instrua usuarios a ignorar alertas de certificado.
- O servidor atual nao possui autenticacao, lista de convidados, expiracao de salas ou controle de acesso. Nao publique links sensiveis sem adicionar uma camada de autenticacao.
- A sinalizacao passa pelo servidor, mas a midia e peer-to-peer quando possivel; com TURN, a midia pode passar pelo relay.
- Um endereco fixo (Tailscale Funnel, dominio proprio) fica exposto na internet enquanto estiver ligado, e mais facil de achar do que uma URL sorteada. Como nao ha autenticacao, desligue o Funnel quando nao estiver usando: `tailscale funnel --https=443 off`.
- A captura nativa de audio so e liberada para quem abre a pagina em `localhost` na propria maquina do servidor. Atras de um proxy toda conexao chega como `127.0.0.1`, entao a checagem olha tambem os cabecalhos de proxy e o `Host` -- e sempre falha para o lado seguro.
- Nao inclua tokens, credenciais TURN, arquivos `.cloudflared` ou certificados no Git.
- Para producao, defina `CORS_ORIGIN` para o dominio exato, use firewall, mantenha Node.js/Windows/cloudflared atualizados e monitore os logs.

## Solucao de problemas

- **Helper de audio nao encontrado:** execute `npm start` em Windows com Visual Studio Build Tools C++ e confirme que o build terminou sem erro.
- **Captura bloqueada:** abra a pagina por `https://` ou por `localhost`; um IP publico em HTTP nao e contexto seguro.
- **Participante nao conecta:** confirme o codigo da sala e configure TURN se houver NAT/firewall restritivo entre os participantes.
- **Audio sem som:** marque a opcao de audio no seletor do navegador; a disponibilidade depende da fonte, navegador e sistema operacional.
- **Tela preta no iPhone:** use **Ativar reprodução** se aparecer. Se a imagem não chegar, use **Reproduzir vídeo** e **Ver diagnóstico** no palco, ou o botão de diagnóstico na lateral. Consulte o [roteiro de validação](docs/revisao-safari.md#validacao-em-um-iphone-real).
- **O jogo perde FPS ao compartilhar, ou aparece uma tarja amarela:** compartilhe a **tela inteira** em vez de uma janela. O custo e a tarja vêm do caminho de captura de janela do Windows, não do Nexo; a explicação e as alternativas estão em [`docs/captura-de-tela.md`](docs/captura-de-tela.md).
- **Atraso crescente ou muitos participantes:** ajuste resolução, FPS ou bitrate em `public/sala.js`; como a conexão é mesh (todos com todos), salas grandes pesam mais na banda de upload de cada um.
- **Tunnel nao abre:** confirme que o Node responde em `http://localhost:3000`, que o `cloudflared` esta no `PATH` e que a janela do tunnel continua aberta.

## Estrutura

```text
tela-compartilhada/
├── package.json                    # scripts e dependencias Node.js
├── package-lock.json               # versoes fixadas das dependencias
├── server.js                       # Express, Socket.IO e sinalizacao WebRTC
├── sfu.js                          # sobe o servidor de midia e emite os tokens de acesso
├── musica.js                       # o bot: fila por sala, yt-dlp/ffmpeg e a faixa publicada
├── soundboard.js                   # a mesa de sons de cada sala, so na memoria
├── build-helper.ps1                # build Release x64 do helper C++
├── native/audio-helper/            # captura de audio por processo no Windows
├── native/audio-agent/             # agente que cada participante roda no proprio PC
├── app/                            # aplicativo de mesa (Electron): a sala fora do navegador
│   ├── main.js                     # janela, seletor de tela e ciclo de vida do agente
│   ├── preload.js                  # a ponte estreita entre a sala e o aplicativo
│   ├── lancar.js                   # sobe o Electron com o ambiente limpo
│   ├── endereco.html               # onde fica o servidor (perguntado uma vez)
│   └── escolher.html               # seletor de tela/janela com miniaturas
└── public/
    ├── index.html, home.css, home.js # criar/entrar e salas recentes
    ├── sala.html, sala.css          # interface da sala
    ├── sala.js                     # captura, sinalização, chat e reprodução
    ├── media-utils.js              # identidade das faixas, codecs e streams de vídeo
    ├── musica.js                   # o canal de música: pedidos, fila e o que está tocando
    ├── soundboard.js               # a mesa de sons: envio, disparo e volume de cada um
    └── room-ui.js                  # presença, acessibilidade e diagnóstico
```

## Testes de regressão

Node.js 20 ou superior para as ferramentas de desenvolvimento (Node.js 24 usado na revisão).

```powershell
npm install
npx playwright install chromium webkit
npm test
npm run test:browser
npm run test:soundboard
$env:TEST_BROWSER="webkit"
npm run test:browser
Remove-Item Env:TEST_BROWSER
```

Os testes iniciam um servidor isolado em `127.0.0.1:3217` (Chromium) ou `:3218` (WebKit).
Usam câmera/tela sintéticas e comunicação WebRTC real; não capturam o desktop ou microfone
de quem executa. As imagens de revisão ficam em `test-results/`, ignorado pelo Git.

`npm run test:soundboard` (porta `:3219`) sobe dois navegadores na mesma sala e **conta quantas
fontes de áudio ficam vivas ao mesmo tempo** — a única forma de verificar a regra de um som por
pessoa, que só existe dentro da Web Audio de quem ouve. O tom de teste é sintetizado pelo
próprio teste; não depende de arquivo no repositório nem do `ffmpeg`.

`tests/musica.test.js` e `tests/soundboard.test.js` rodam sem rede: fixam o que não pode mudar
sem alguém perceber — que o token do bot **não** autoriza receber mídia, que a mesa de sons
confere os primeiros bytes do arquivo em vez de acreditar no tipo declarado, que uma sala não
enxerga a mesa de outra, e que um comando de música numa sala sem bot responde em vez de estourar.
Tocar de verdade depende de sites externos e não entra em teste automático.

O WebKit de teste para Windows não implementa WebRTC: nesse ambiente os testes verificam
interface, chat e navegação e informam explicitamente a limitação. A validação final do Safari
exige um iPhone/iPad real. Não confundir emulação de viewport com teste do Safari.


## RNNoise e compartilhamento por janela

O microfone usa RNNoise local, gratuito e sem cota, com alternativa para o filtro do
navegador em **Dispositivos**. O processamento não depende do servidor e não altera o som
das telas. Há um pequeno atraso de buffer/modelo; veja as medições e limitações na revisão.
As licenças do RNNoise e de sua distribuição WASM ficam em `public/licenses/RNNoise.txt` e
no pacote `@jitsi/rnnoise-wasm/LICENSE`.

No Electron, **Janela ou aplicativo** mostra apenas janelas e seleciona o áudio do processo
correspondente automaticamente. **Tela inteira** mostra apenas monitores. Não é possível
enumerar abas de outro navegador pelo Electron: para compartilhar uma única aba e seu som,
abra a sala no Chrome/Edge. Janelas/abas do mesmo processo podem ter áudio conjunto.

Atualize o servidor e o aplicativo juntos. Feche a versão antiga antes de executar
`app/dist/SalaCompartilhada.exe`. Para reconstruir:

```powershell
npm run build:helper
npm --prefix app ci
npm --prefix app run empacotar
```

`npm run test:electron` verifica o preload e o seletor em um perfil temporário, sem capturar
seus dispositivos. Exige as dependências de `app` e o agente compilado; usa a porta 3219.
O ícone Windows é derivado de `public/mark.svg`; `npm run build:icon` o regenera usando o
Chromium do Playwright quando a marca for alterada.


## Perfis de qualidade (30 fps)

Em **Compartilhar tela** ou **Dispositivos**, escolha 720p (até 2 Mbps), 1080p (até
4 Mbps, padrão) ou 1440p (até 6 Mbps). Esses são tetos por destinatário, não consumo
constante nem garantia de resolução/fps. Uma fonte menor não ganha detalhes por escolher
um perfil maior. O perfil pode mudar durante a transmissão; se a fonte recusar as novas
restrições, a interface orienta usar **Atualizar tela**.

O teto é orçamento, não meta: o codificador gasta o que receber, e cada Mbps a mais é
multiplicado pelo número de espectadores. Quanto isso custa de verdade, o que já foi feito
para reduzir e o que fazer quando a sala crescer estão em
[`docs/banda-e-escala.md`](docs/banda-e-escala.md) — que também explica como medir
(`npm run banda`).

O limite total de upload, em Dispositivos, oferece 10/20/40/80 Mbps; o padrão é 40 Mbps,
com 15% reservado para áudio e tráfego adicional. Escolha um valor abaixo da sua subida
real disponível. Na malha P2P, três espectadores em 1080p podem consumir até 24 Mbps de
vídeo, além de câmera/voz e overhead. Não se trata de uma medição automática do seu plano.

Cada conexão tem seu próprio orçamento e resolução. Uma conexão fraca não reduz o
orçamento das demais por si só; o limite total do remetente continua compartilhado.
O controle do WebRTC continua ativo. A resolução baixa quando necessário e pode voltar
a subir; margens entre as mudanças evitam alternância por pequenas oscilações. O alvo é
30 fps, sem oferecer 60 fps, mas rede e CPU podem reduzir o valor real. Em Dispositivos,
as estatísticas mostram resolução, fps e bitrate efetivamente enviados a cada pessoa.
Não há buffer adicional para melhorar a imagem: em vez de acumular atraso, reduz-se a
qualidade. Não é possível garantir imagem sem perda e atraso zero em qualquer internet.

Controles de zoom/tela cheia desaparecem após 2,5 segundos sem interação, inclusive
quando o mouse fica parado sobre um botão que foi clicado. Mouse/toque os revela novamente;
o foco por teclado mantém os controles acessíveis enquanto você os utiliza.


## Download público do aplicativo portátil

A página inicial contém **Baixar para Windows (.exe)**, com o tamanho e a data do arquivo
atualmente disponível. O endereço direto é `/downloads/SalaCompartilhada.exe`, no mesmo
domínio do site, inclusive pelo Tailscale Funnel. O servidor entrega somente
`app/dist/SalaCompartilhada.exe`; a pasta `app/dist` não fica exposta para navegação.

Gere a próxima build com `npm --prefix app run empacotar`. O nome fixo do artefato já está
configurado no Electron Builder: depois de concluída a geração, o botão entrega essa
versão sem mudar o link ou reiniciar o servidor. O agente de áudio vai dentro do portátil.
O download não altera o executável nem insere configurações nele. Na primeira abertura,
a pessoa informa o endereço do site no aplicativo.

Se o arquivo não existir, o botão fica indisponível e o acesso pelo navegador continua
normal. A consulta de disponibilidade e o download usam `Cache-Control: no-store` para
não preservar uma build antiga. O arquivo é transmitido por streaming, com suporte a Range.
A metadata (`/api/desktop-app`) informa tamanho e data do arquivo, não a versão dos arquivos
web que o aplicativo carrega. Uma instalação clonada do Git precisa gerar/copiar o portátil,
pois `app/dist` permanece ignorado pelo Git.

Após adicionar estas rotas pela primeira vez, reinicie o servidor Node. Para validar:
`npm test` e `npm run test:download`. O teste de navegador usa um arquivo fictício pequeno;
não baixa nem executa o aplicativo real.
