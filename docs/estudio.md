# O Estúdio: a sala dentro do OBS

Escrito em 29/09/2026, junto com a implementação. São duas funcionalidades com a mesma base:

1. **Fontes por link.** A câmera, a tela, a voz ou o som da tela de uma pessoa da sala viram
   uma fonte "Navegador" no OBS, como no VDO.ninja. Quem transmite monta uma cena com os amigos
   sem capturar janela nenhuma.
2. **Rostos que reagem à voz.** Uma fonte com o rosto de cada pessoa da sala: quem fala pula,
   quem está quieto fica apagado, como no Reactive Images. Há um link para a sala inteira e um
   por pessoa, e cada pessoa pode ter até quatro imagens — "parado", "falando", "mudo" e
   "ensurdecido" —, escolhidas por quem usa o Estúdio e vistas só no OBS dele.

Junto veio a **foto de perfil**, que o `docs/plano-contas.md` tinha deixado para depois: os
rostos precisavam de um rosto.

| peça | arquivo |
|---|---|
| O link assinado, a chave de cada pessoa, a configuração dos rostos | `estudio.js` |
| As páginas do OBS no ar, a credencial oculta, o aviso à sala | `estudio-ao-vivo.js` |
| As imagens: tipo pelos bytes, tetos | `contas/imagens.js`, migração `0002` |
| A página que vai dentro do OBS | `public/obs.html` + `obs.js` |
| O desenho dos rostos (OBS e prévia) | `public/reativo.js` + `reativo.css` |
| O painel do Estúdio, dentro da sala e só com conta | `public/estudio.js` + `estudio.css` |
| Dentro da sala: permissão, links do cartão de perfil, selo "OBS", botão da barra | `public/estudio-sala.js` |

O Estúdio chegou a ser uma página própria (`/estudio`). Virou um painel da sala: é na sala que se
sabe quem está nela, e no aplicativo não havia onde abrir outra aba. Abre pelo botão **Estúdio** da
barra de baixo — só para quem tem conta, e nunca no celular: montar cena de OBS é coisa de
computador, e a barra do celular já está no limite. Também abre por Configurações → Estúdio (OBS).

---

## O link é de quem o criou

Um link não aponta para uma sala. Ele aponta para uma **pessoa** (quem aparece) e é ancorado em
**quem o criou**, o diretor, que sempre tem conta. Ele vale na sala em que o diretor estiver
agora.

Isso tem duas consequências boas:

- **A cena é montada uma vez.** "A câmera da Ana" funciona em toda chamada com a Ana, em
  qualquer sala, sem gerar link de novo. As salas do Nexo morrem quando esvaziam, e um link
  preso à sala morreria junto.
- **A captura tem dono.** Ela só existe enquanto o diretor está na sala. Um diretor removido ou
  banido leva as capturas junto, e um link vazado não serve a ninguém se quem o criou não
  estiver lá.

**Quem aparece** é reconhecido pela chave de `estudio.js`: o código da conta (`c:K7M2PQ4X`), que
não muda com o apelido, ou o nome de quem entra sem conta (`n:ana`). O nome é o "endereçar" de
quem usa o Estúdio: a imagem dada à "Ana" vale para qualquer convidada que entrar como Ana. As
duas chaves nunca se confundem, pela mesma regra do banimento (`moderacao.js`).

**Criar um link pede conta.** É a conta que responde pela captura e que a sala vê.

### Sem estado, e revogável

O link é `corpo.assinatura` em base64url: um JSON curto assinado com HMAC. O segredo é derivado
do que assina os tokens do servidor de mídia (`sfu.segredoDerivado`), então sobrevive a
reiniciar o servidor sem arquivo novo. O servidor não guarda link nenhum.

Revogar é trocar a **geração** guardada na conta (tabela `estudio`). Todo link da geração
anterior deixa de valer de uma vez, inclusive os que estão no ar. É o botão de quem colou um
link no lugar errado.

---

## A página do OBS

A página abre um socket no namespace `/estudio` apresentando o link. O servidor responde com o
estado e o manda de novo sempre que algo muda:

| estado | quando |
|---|---|
| `aguardando` (diretor) | quem criou o link não está em sala nenhuma |
| `aguardando` (alvo) | o diretor está numa sala, e a pessoa não |
| `recusado` | a pessoa desligou a captura para si |
| `revogado`, `invalido` | a geração mudou, ou a conta sumiu ou foi suspensa |
| `ok` | no ar, com uma credencial de mídia |

A credencial é um token **oculto**, que só **recebe**: não publica nada e não manda dados. Oculta,
a página não aparece na lista de ninguém nem conta como gente na sala. O servidor de mídia a
aceita pela terceira porta (`telemetria/index.js`): não há sessão de sala, e quem responde é o
Estúdio, que só reconhece a identidade `nexo-estudio#...` que ele mesmo emitiu, para aquela sala.

Dentro do OBS a página não mostra nada além da imagem. Um "aguardando a Ana" no meio de uma
transmissão seria pior que o vazio. O OBS se anuncia em `window.obsstudio`; fora dele (o link
aberto numa aba para conferir), a página diz o que está esperando. Parâmetros do link, que só
podem **tirar** coisas:

- `?som=0`: câmera ou tela sem som.
- `?ajuste=preencher`: corta a imagem para ocupar a fonte inteira.
- `?avisos=1`: mostra os avisos também dentro do OBS, para montar a cena.

### A tela chega pelo RTP, nos três caminhos

A página assina a faixa RTP da tela, como qualquer espectador:

- **RTP comum** e **Automático** (`tela-placa-rtp.js`): a faixa é H.264 comum pelo RTP, e o OBS
  decodifica sem nada especial.
- **Forçar** (`tela-webcodecs.js`): a imagem de verdade viaja numa faixa de dados, mas a
  publicação RTP continua existindo como reserva. A página do OBS assina a reserva, e o servidor
  religa as camadas dela. O custo é que o codificador do WebRTC de quem transmite volta a
  trabalhar enquanto o OBS assiste.

Falar o protocolo da faixa de dados na página do OBS nem funcionaria: oculta, ela manda mensagens
que chegam sem remetente, e `tela-webcodecs.js` descarta tudo o que chega assim.

---

## Quem é capturado fica sabendo

Oculta no servidor de mídia não quer dizer escondida da sala.

- **A sala inteira recebe `estudio-capturas`:** quem leva o quê para o OBS. Vira um selo "OBS"
  no quadradinho de quem está sendo levado ("Ana leva a sua câmera para o OBS"), um selo na
  barra de cima enquanto houver qualquer captura, e a lista na aba Estúdio das configurações.
- **Cada pessoa decide por si.** "Deixar que me levem para o OBS" vem ligado, segue a conta
  (`perfil.js`) e vai no aperto de mão do socket, e não num aviso depois da entrada: entre um e
  outro, uma captura já poderia ter começado contra a vontade dela. Desligar derruba na hora o
  que já estava no ar, e a captura volta sozinha quando ela religar.

A permissão vale também para os rostos que reagem: quem desliga some da cena do grupo.

**E quem abriu a sala decide pela sala.** Na moderação, "Participantes podem levar a sala para o
OBS" segue a regra dos outros três controles: desligado, vale para os participantes, e o dono
continua podendo. As capturas dos participantes saem do ar na hora (a página do OBS fica em
`recusado`, motivo `sala`) e voltam sozinhas quando o controle é religado. Trocar de dono
reavalia tudo, porque a exceção é de quem é dono agora.

---

## Os rostos que reagem

A página dos rostos assina a **voz** de cada pessoa e mede o nível ali mesmo, com Web Audio: a
raiz da média dos quadrados, em dB, contra um limiar que a sensibilidade escolhe (35, o padrão,
é -37,5 dBFS). "Falando" dura 220 ms depois do último trecho alto, senão o rosto piscaria entre
as sílabas. A voz nunca toca: o elemento de áudio é mudo e existe só porque o Chrome não entrega
o som de uma faixa remota ao Web Audio se ninguém estiver "tocando" a faixa (o mesmo cuidado de
`sala.js`).

Medir na página, e não pelos avisos de quem fala do servidor de mídia, é o que dá resposta a
cada quadro e o controle de sensibilidade. Um rosto que reage uma sílaba atrasado parece
desligado do som.

A configuração (efeito, formato, tamanho dos rostos e dos nomes, arranjo, imagens por pessoa) é de
quem usa o Estúdio,
mora na conta dele (`estudio.config`, forma fechada em `estudio.js`) e chega na hora às fontes que
já estão no OBS: mexer no tamanho no Estúdio muda a cena sem recarregar nada.

### Mudo e ensurdecido

Cada pessoa pode ter uma imagem para quando está **muda** e outra para quando está
**ensurdecida**. Com imagem, ela cobre as outras enquanto o estado dura (apagada como quem está
quieto, mas com as cores dela); sem imagem, vale o rosto de sempre, apagado e cinza. Ensurdecida
sem imagem própria usa a de muda: quem ensurdece no Nexo fecha o microfone junto.

Os dois estados chegam por caminhos diferentes:

- **Mudo** vem da mídia: a página do OBS vê a faixa do microfone mudar, na hora.
- **Ensurdecido** não passa pela mídia — ensurdecer só corta o som de quem ensurdece. A pessoa o
  anuncia à sala (evento `ensurdecer`, com freio próprio), a sala mostra o fone cortado no quadradinho
  e na lista, e o servidor reavalia as páginas do OBS daquela sala, que recebem o estado novo de
  cada pessoa.

Na prévia do Estúdio, mudo e ensurdecido são os de verdade, lidos da sala: para ver a imagem de
"mudo" de alguém, basta essa pessoa — ou você — fechar o microfone.

### O rosto que a própria pessoa escolhe

Quem tem conta pode escolher o próprio **rosto**: as quatro imagens (parado, falando, mudo,
ensurdecido) com que quer aparecer nos rostos que reagem, no OBS de quem a levar. Elas moram no
perfil da conta (`perfil.rosto`, migração 3), são públicas como a foto e vão à sala junto com o
perfil. Escolhe-se em Configurações → Estúdio (OBS), ou na própria linha, no painel do Estúdio.

Quem monta a cena decide, por pessoa, de onde vêm as imagens dela, e a escolha fica guardada na
configuração dele (`usar`):

| escolha | o que aparece no OBS |
|---|---|
| **Da pessoa** | o rosto que ela escolheu (só aparece para quem tem um) |
| **Minhas** | as imagens que quem monta a cena anexou para ela, e que só valem no OBS dele |
| **Nenhuma** | nenhuma imagem: a foto do perfil, ou a cor e as iniciais |

Sem escolha guardada, vale o que existir: as minhas, senão as da pessoa, senão nenhuma
(`origemDasImagens`, em `estudio.js` e em `reativo.js`). É o que faz o rosto que alguém escolheu
aparecer sozinho no Estúdio de quem nunca mexeu nela, sem passar por cima de quem já tinha
anexado imagens próprias para ela.

---

## As imagens

Moram no banco (tabela `imagem`, BLOB), e não em arquivos: são da conta, e "apagar minha conta"
as leva pelo mesmo CASCADE que já levava perfil e sessões. A cópia diária do banco as leva
junto sem ninguém lembrar delas.

| | avatar | rosto | Estúdio |
|---|---|---|---|
| tamanho | 6 MB | 12 MB cada, uma por estado (4 no máximo) | 12 MB cada, 40 por conta, 64 MB no total |
| preparo | recortado no quadrado do meio e reduzido a 512 px pela página (256 se não couber) | como as do Estúdio | como está (a arte de quem transmite: GIF animado, PNG recortado); parada acima do teto, reduzida a 1024 px |

A foto de perfil também se vê grande: em todo cartão de perfil (o da sala, o do início, a prévia do
editor), na página da conta e no "Meu perfil", o avatar de quem tem foto se abre num visor de até 440
px (`docs/interface.md`, 4.9). É por isso que ela sobe em 512 px — em 256, ampliada, ficava macia.
As fotos enviadas antes continuam em 256 até a pessoa trocar. A foto se troca na conta, no "Meu
perfil", nas configurações e no editor do cartão, pelas mesmas rotas (`/api/conta/avatar`).

- **O tipo vem dos bytes** (PNG, JPEG, GIF, WebP), nunca do nome nem do cabeçalho. SVG fica de
  fora: é um documento, não uma imagem.
- **A entrega não deixa nada rodar:** tipo fixo, `nosniff`, `Content-Security-Policy:
  default-src 'none'; sandbox`. O id é sorteado a cada envio, então a imagem fica em cache para
  sempre e trocar a foto é trocar o endereço.
- **A moderação é a do painel:** "Tirar as imagens" apaga a foto, o rosto e as imagens do Estúdio
  de uma conta de uma vez. É o tamanho que a moderação de imagem tem hoje.
- Imagens do Estúdio que ficaram de fora da configuração por mais de uma hora somem no próximo
  salvamento.

---

## O que isto não resolve

- **Uma página do OBS modificada pode assinar outras faixas da sala.** O token do servidor de
  mídia libera assinar a sala inteira; não há permissão por faixa. É o mesmo poder de qualquer
  participante, e o link só funciona com o diretor presente e anunciado à sala, mas a lista de
  capturas mostra o que a página *declarou*, não tudo o que ela assinou.
- **A banda do OBS não entra na contabilidade.** As páginas do OBS não mandam `medicao-de-banda`,
  então o que desce para elas fica fora do relatório de banda.
- **No "Forçar", o OBS religa o codificador do WebRTC** de quem transmite (ver acima).
- **O OBS usa o Chromium embutido dele (CEF).** WebRTC e Web Audio existem lá há muitas versões,
  mas o teste automático roda no Chromium do Playwright, e não num OBS de verdade.

---

## Testes

- `npm test`: `tests/estudio.test.js`. O link (ida e volta, adulteração, outro servidor), a
  chave, a configuração fechada, o tipo das imagens pelos bytes, a foto pelo HTTP, o Estúdio
  (imagens de outra conta recusadas, revogação), e o namespace `/estudio` seguindo o diretor,
  esperando a pessoa e respeitando quem não deixa.
- `npm run test:estudio`: com servidor de mídia. A foto enviada pela página (e aberta grande no
  cartão de perfil), o link copiado do
  cartão de perfil, a página do OBS recebendo a câmera e a voz, o selo na sala, os rostos falando
  com o apito do microfone falso, a configuração chegando ao vivo, a imagem de ensurdecida trocando
  o rosto no OBS (e o fone cortado na plateia, também para quem chega depois), o ponto "no ar" dos
  links acendendo e apagando com o microfone, a permissão desligada e
  religada, o painel aberto pelo botão da barra (com o tamanho dos nomes chegando à prévia), o
  dono da sala desligando e religando o OBS para os participantes, e o diretor saindo.
