# Segurança e privacidade

Escrito em 22/09/2026, antes de começar a implementação das contas, e atualizado no mesmo dia
com a correção do aplicativo de desktop (`ae0c9db`). Responde três perguntas —
o Nexo resiste a invasão? pode vazar dado de alguém? está de acordo com a LGPD? — a partir do
código e da lei, não de suposição. O que aparece como "já existe" foi conferido no código nesta
data; o que é lei tem a fonte no fim do documento.

Uma ideia atravessa o documento inteiro: **o dado que não é guardado não vaza.** O Nexo foi
construído assim, e manter isso é a medida de segurança mais barata que existe. Cada
funcionalidade nova que guarda algo é um lugar novo por onde vazar.

## A resposta curta

- **Muito já está feito, e bem feito.** A mídia nunca é gravada, o chat morre com a sala, o IP
  nunca toca o disco, a telemetria é agregada, e o painel só abre na própria máquina.
- **Havia uma falha real no aplicativo de desktop**, que roda na máquina de quem usa e sabe ligar
  captura de áudio. **Corrigida em `ae0c9db`** — e ela só chega a quem usa quando os
  instaladores forem gerados de novo.
- **Para contas e para abrir ao público faltam peças conhecidas:** cabeçalhos de segurança nas
  páginas, origem conferida no Socket.IO, um identificador de login, prazo para os relatos,
  backups criptografados, os documentos da LGPD e um plano de incidente.
- **O maior risco jurídico não é a LGPD. É o ECA Digital**, em vigor desde março de 2026, que
  alcança aplicativos e jogos de acesso provável por adolescentes.

---

## O que já protege hoje

| proteção | onde |
|---|---|
| **Voz, câmera e tela nunca são gravadas.** Existem só em trânsito, cifradas (DTLS-SRTP, obrigatório no WebRTC) | arquitetura do servidor de mídia |
| Chat, imagens do chat e sons da mesa vivem em memória e somem quando a sala fecha | `server.js`, `sairDaSalaAtual` |
| **O IP nunca vai ao disco.** Os limites por origem usam um HMAC do IP com um segredo sorteado a cada início do processo | `telemetria/index.js:34` |
| A telemetria de uso é agregada: contagens e faixas, sem nome, sem IP, sem sala | `telemetria/uso.js` |
| Alertas de abuso guardam nome por 7 dias, e a regravação apaga do disco os que venceram | `telemetria/alertas.js` |
| As linhas do servidor de mídia que trazem identidade e endereço são descartadas por padrão; só avisos e erros aparecem | `sfu.js`, `LINHA_DE_PROBLEMA` |
| **O painel só abre na própria máquina.** Remoto só com `NEXO_PAINEL_REMOTO=1` e HTTPS, com CSP rígida, CSRF, freio de força bruta e ACL na pasta da chave | `telemetria/origem.js`, `autenticacao.js`, `rotas.js` |
| Credenciais de sessão de 256 bits aleatórios, guardadas só por hash | `telemetria/sessoes.js` |
| Limite de taxa por sessão e por sala para cada ação | `telemetria/abuso.js` |
| Nomes escritos com `textContent`, com teste de XSS usando `<img onerror>` como nome | `sala.js`, `tests/browser.cjs` |
| As páginas não têm script, estilo nem handler embutido — uma CSP rígida cabe sem reescrita | `public/*.html` |
| Servidor de mídia com versão e SHA-256 fixos no código | `scripts/baixar-livekit.cjs` |
| Nenhuma vulnerabilidade conhecida nas dependências de produção (`npm audit`, 22/09/2026: 0) | `package-lock.json` |
| Preferências — inclusive volume por pessoa — só no navegador de cada um | `public/preferencias.js` |
| Aplicativo: a sala roda isolada do Node; a janela, as funções nativas e as permissões ficam presas ao servidor escolhido; só a tela local troca o servidor; o seletor de tela roda isolado | `app/main.js`, `ae0c9db` |
| Token de pareamento do agente com 128 bits aleatórios | `public/sala.js` |

---

## O que precisa ser corrigido

### 1. O aplicativo de desktop deixava a página trocar de servidor — corrigido

**Corrigido em `ae0c9db`.** O registro fica porque explica por que o aplicativo é desenhado
como é, e o que não pode voltar.

A cadeia, peça por peça, como era:

1. `appNativo.definirEndereco()` existe para a tela local onde a pessoa digita o endereço
   (`app/endereco.html`). O preload a entregava a **toda** página da janela — inclusive à sala,
   que é conteúdo remoto —, e o handler (`endereco:definir`) não conferia quem chamava.
2. O endereço vira configuração assim que a página carrega, e vale para as próximas aberturas.
3. Nada restringia para onde a janela navegava, e as funções nativas aceitavam qualquer página
   `http(s)`.
4. O agente de áudio sobe na entrada da sala (`sala.js:472`) e captura quando o servidor ao
   qual está ligado manda. A trava que já existia — o agente só aponta para o mesmo servidor da
   página — não ajudava quando a própria página era de outro servidor.

Juntando: **uma falha de XSS no Nexo, ou um servidor malicioso aberto uma única vez, prendia o
aplicativo num endereço de fora e, de lá, ligava o agente e mandava capturar o som da
máquina.** É o pior dano que o Nexo pode causar a alguém, e ficava a uma falha de distância.

O que mudou em `app/main.js`:

- Existe uma **origem da sala**, que nasce só do endereço que a pessoa escolheu. Um
  redirecionamento do próprio endereço ao abrir (`http` para `https`, com ou sem `www`)
  atualiza a origem; depois disso, só a tela local muda o servidor.
- `endereco:definir` só aceita a tela local. `endereco:esquecer`, a tela local ou a sala.
- `will-navigate` e `will-redirect` mantêm a janela na origem; qualquer outro destino abre no
  navegador de verdade. Dentro da origem, a navegação continua livre.
- As funções nativas conferem a origem, e `agente:iniciar` passou a conferir também a página.
- **Permissões:** o Electron concede a qualquer página tudo o que ela pede — câmera, microfone,
  notificações — sem perguntar. Isso não estava no levantamento original e apareceu ao ler o
  código para corrigir: agora só a origem da sala recebe, e um iframe injetado de outra origem,
  não.
- O seletor de tela deixou de rodar com Node ligado. Ele escrevia os nomes com `textContent`,
  mas os nomes são títulos de janela, que qualquer programa escolhe — um `innerHTML` descuidado
  ali seria execução de código na máquina. Ganhou isolamento e uma ponte de duas funções
  (`app/preload-escolher.js`).

O que o teste real do Electron (`tests/electron.cjs`) passou a cobrir: as permissões continuam
valendo para a sala; a sala pedindo outro servidor é recusada e o servidor salvo não muda; um
destino de fora abre no navegador e a janela não sai; a ponte segue respondendo à sala; a
navegação dentro da origem continua livre; e a tela local ainda troca o servidor — o caminho de
quem abre o aplicativo pela primeira vez. Contra o código antigo, o teste falha em "a sala não
pode trocar o servidor do aplicativo". Um build de conferência confirmou a ponte nova dentro do
pacote.

**O que não tem teste automático:** a permissão **negada** a outra origem. Provocá-la exige um
iframe de outra origem pedindo câmera ou microfone no Electron de teste, e o resultado depende
de como o Chromium delega permissão a iframes. A regra é uma linha, conferida lendo.

Três consequências:

- **A correção só chega a quem usa quando os instaladores forem gerados de novo** e
  substituídos em `app/dist` — o `.exe` que o servidor oferece hoje ainda é o antigo.
- **O login com Discord, quando vier, acontece no navegador externo.** O fluxo de autorização
  sai para `discord.com`, e a janela do aplicativo não sai mais da origem da sala.
- Um indicador nativo enquanto o agente captura continua sendo uma boa ideia para depois: se o
  próprio servidor for invadido, quem invadiu controla a página.

### 2. As páginas públicas não têm cabeçalhos de segurança

O painel tem uma CSP rígida; a página inicial e a sala só têm `nosniff` numa rota. Faltam:

| cabeçalho | o que evita |
|---|---|
| `Content-Security-Policy` | que uma falha de XSS, se um dia existir, consiga rodar script de fora |
| `frame-ancestors 'self'` (e **não** `'none'`) | a sala aberta dentro de um `<iframe>` de outro site (clickjacking) |
| `Referrer-Policy` | o código da sala vazando para sites de links clicados |
| `Permissions-Policy` | câmera, microfone e captura de tela pedidos de dentro de conteúdo embutido |
| `Strict-Transport-Security` | a primeira visita cair em HTTP (entra pelo Caddy, no VPS) |
| sem `X-Powered-By` | o Express anunciando a si mesmo |

A notícia boa é que as páginas não têm nada embutido, então `script-src 'self'` cabe sem
reescrita. O cuidado é ligar a política primeiro em modo relatório
(`Content-Security-Policy-Report-Only`): o RNNoise compila WebAssembly
(`'wasm-unsafe-eval'`), as imagens do chat são `data:`, e há workers. **Meio dia.**

**Um cuidado que a camada do início criou (03/10/2026):** dentro de uma chamada, o início (`/`) e a
conta (`/conta`) abrem num `<iframe>` **da própria origem**, por cima da sala (`docs/interface.md`,
5.2). Por isso `frame-ancestors` e `X-Frame-Options` têm de ser `'self'`/`SAMEORIGIN` — `'none'`/`DENY`
deixaria a camada em branco, sem erro à vista — e `frame-src` precisa de `'self'`. A camada só aceita
mensagem da janela do quadro que ela criou e da mesma origem, e o quadro só aceita da janela de
cima; o endereço `?camada=` só vale com um código de sala no formato certo. Se a `Permissions-Policy`
bloquear `clipboard-write`, "Copiar meu código", dentro do quadro, deixa de funcionar.

### 3. O Socket.IO aceitava conexão de qualquer origem — corrigido

**Corrigido em `5b03c4a`**, junto com o cookie da conta, como pedido abaixo: o aperto de mão do
Socket.IO e toda escrita da conta aceitam só a página deste servidor, a origem do `PUBLIC_URL` e
as que `CORS_ORIGIN` acrescentar (`telemetria/origem.js`). O registro fica.

`cors: { origin: process.env.CORS_ORIGIN || true }`. Hoje isso não é explorável: a credencial
da sessão mora na memória da página, e outro site não tem como apresentá-la. **No dia em que a
conta viajar num cookie**, um site de terceiros aberto por quem tem conta conseguiria abrir um
socket em nome dela (sequestro de WebSocket entre sites). A variável `CORS_ORIGIN` já existe,
e o README a recomenda para produção; a correção é o padrão deixar de ser `true` e passar a ser
a origem do `PUBLIC_URL`, para que esquecer a variável não abra a porta. Entra na etapa A —
junto com o cookie, não depois.

### 4. O plano de contas ficou sem identificador de login — decidido e feito

**Feito em `5b03c4a`**: nome de usuário único para entrar, e as quatro regras abaixo, com teste.
O `scrypt` usa N = 2^15 (55 ms nesta máquina), um por vez, numa fila de 16.

Com o apelido repetível, "apelido + senha" deixou de conseguir identificar quem está entrando:
três Anas com senha, e o servidor não sabe qual delas testar. Falta um **nome de usuário
único para entrar**, ao lado do apelido repetível e do código imutável — que é exatamente o
modelo do Discord (`@usuário` único, nome de exibição livre, id permanente).

E, já que o login está sendo desenhado, quatro regras que o plano ainda não tinha:

- **Senha de no mínimo 10 caracteres**, conferida contra uma lista de senhas comuns, sem
  regra de "maiúscula, número e símbolo" — que produz `Senha@123` e não segurança.
- **Freio por conta, além do freio por origem.** Sem ele, uma tentativa por IP a partir de mil
  IPs passa por baixo do limite.
- **A mesma resposta para "usuário não existe" e "senha errada"**, para o login não servir de
  consulta de quem tem conta.
- **O código de recuperação vale uma vez** e é trocado depois de usado.

### 5. Os relatos não têm prazo

Nome, sala, mensagem e relatório técnico ficam em `relatos.jsonl` até a rotação de 8 MB, sem
limite de tempo. Os alertas já fazem o certo — 7 dias, e a regravação apaga do disco o que
venceu. Os relatos passam a fazer o mesmo, com **180 dias**.

### 6. Pequenos

- As chaves do servidor de mídia são gravadas com `mode: 0o600`, que no Windows não separa
  usuários — o próprio código do painel diz isso, e por esse motivo aplica ACL na pasta dele.
  A pasta das chaves do LiveKit não recebe a mesma ACL. No Linux do VPS, `0600` funciona.
- O `debug.log` na raiz (log do Chromium de um teste de 15/09, 1 MB) não tem IPs e está fora do
  Git, mas não serve para nada. Pode ser apagado.

---

## Criptografia: onde já existe, e onde não vale a pena agora

| camada | hoje, em casa | no VPS |
|---|---|---|
| Página, API, chat, sinalização | HTTPS pelo túnel da Cloudflare. **O TLS termina na Cloudflare**, que vê esse tráfego em claro — é como o túnel funciona | TLS termina no Caddy, **no seu servidor**. Ninguém no meio |
| Voz, câmera, tela | DTLS-SRTP até o servidor de mídia, que decifra para distribuir | igual |
| Senhas e código de recuperação | — | `scrypt` (plano de contas) |
| Credenciais de sessão | hash | hash |
| Banco de contas em repouso | — | criptografia de disco do provedor protege contra disco roubado ou cópia de snapshot; **não** protege contra servidor invadido, que é o caso real |
| Backups | — | **cifrados antes de sair da máquina**, com a chave guardada fora do lugar do backup |

O backup merece destaque: **o vazamento mais comum que existe não é invasão, é um lugar de
armazenamento esquecido aberto.** Um backup cifrado antes de subir continua ilegível mesmo se
o armazenamento for exposto.

### Criptografia ponta a ponta

O servidor de mídia decifra a mídia para distribuir, como Discord, Meet e Zoom fazem por
padrão. O LiveKit oferece criptografia ponta a ponta, em que nem o servidor enxerga. **A
recomendação é não fazer no lançamento:**

- A chave precisa chegar a todos sem passar pelo servidor — o jeito conhecido é o fragmento
  (`#`) do link de convite.
- **O bot de música deixa de funcionar** numa sala cifrada: ele roda no servidor, e dar a chave
  a ele desfaz a promessa.
- **O chat e a mesa de sons não são cobertos**: passam pelo Socket.IO e por HTTP. "Sala
  criptografada" com chat em claro é uma promessa pela metade, e promessa pela metade de
  segurança é pior do que nenhuma.
- A LGPD não exige: pede medidas técnicas proporcionais (art. 46), e as de cima são o padrão.

Fica como possibilidade futura, bem definida: "sala privada cifrada", só voz, câmera e tela,
dita com todas as letras.

---

## LGPD para um serviço deste tamanho

### Quem responde

Você, como **controlador**. Como pessoa física ou MEI, o Nexo é agente de tratamento de
pequeno porte (Resolução CD/ANPD nº 2/2022), o que traz três alívios: **não precisa nomear
encarregado**, desde que ofereça um canal de contato; o registro das operações pode ser
simplificado; e os prazos para atender titulares e comunicar incidentes contam **em dobro**.

Uma ressalva: parte desses alívios não vale para tratamento de alto risco, e dados de crianças
e adolescentes em larga escala entram nesse conceito. Ver a seção do ECA Digital.

### O que se guarda — o registro das operações

| dado | onde | por quanto tempo | para quê |
|---|---|---|---|
| Voz, câmera, tela | só em trânsito | nunca gravado | prestar o serviço |
| Mensagens, imagens do chat, sons da mesa | memória | até a sala fechar | prestar o serviço |
| Nome usado na sala | memória; relatos; alertas | sala; 180 dias; 7 dias | serviço; suporte; segurança |
| Código da sala | `banda.jsonl`, relatos, alertas | até a rotação | medir custo; suporte |
| IP | só em memória, como HMAC | nunca vai ao disco | antiabuso |
| Relatório técnico do diagnóstico | relatos | 180 dias | suporte, a pedido de quem relatou |
| Preferências | navegador da pessoa | até ela apagar | não chegam ao servidor |
| **Com contas:** usuário, apelido, código, cor, marca, ajustes | `nexo.db` | até apagar a conta | prestar o serviço |
| Senha e código de recuperação | `nexo.db`, só `scrypt` | até apagar a conta | segurança |
| Sessões (hash do token, aparelho) | `nexo.db` | 30 dias, ou até sair | segurança |
| E-mail (opcional; obrigatório ao pagar) | `nexo.db` | até apagar a conta | recuperação; cobrança |
| Plano e prazo | `nexo.db` | até apagar a conta | cobrança |
| Registro fiscal do pagamento | provedor de pagamento | prazo legal | obrigação legal |
| Backups | fora da máquina, cifrados | **30 dias** | continuidade |

Esta tabela é o esqueleto da política de privacidade: o que se guarda, onde, por quanto tempo
e por quê.

### Os direitos de quem usa

| direito (art. 18) | como o Nexo atende |
|---|---|
| Acesso e portabilidade | **"Baixar meus dados"**: um JSON com conta, perfil e ajustes (etapa B) |
| Correção | editar o perfil |
| Eliminação | "apagar minha conta", que apaga de verdade (`ON DELETE CASCADE`), e os backups expiram em 30 dias — a política diz isso |
| Informação | a política de privacidade |
| Contato | um canal (e-mail) na política e no rodapé |

O prazo para responder é de 15 dias (art. 19), em dobro para pequeno porte.

### Os documentos

- **Política de privacidade:** a tabela de cima em português claro, a base de cada
  tratamento, o canal de contato e onde o servidor fica.
- **Termos de uso:** conduta, moderação, idade mínima (ver ECA Digital) e o que acontece com a
  conta.
- **Canal de contato:** um e-mail. É o que dispensa o encarregado.

### Incidente de segurança

Se um incidente afetar dados pessoais com risco relevante a alguém, a comunicação à ANPD e a
quem foi afetado tem prazo de **3 dias úteis — 6 para pequeno porte** — contados de quando se
sabe que dado pessoal foi atingido (Resolução CD/ANPD nº 15/2024). E todo incidente fica
registrado, inclusive o que não precisou ser comunicado.

Três dias úteis não dão tempo de inventar um procedimento. Ele fica escrito antes:

1. **Conter:** tirar do ar o que estiver vazando.
2. **Trocar tudo o que é segredo:** chaves do LiveKit, chave do painel, e derrubar todas as
   sessões de conta (uma linha: apagar a tabela `sessao`).
3. **Avaliar:** que dado, de quem, desde quando — o registro das operações de cima é o mapa.
4. **Comunicar** ANPD e titulares, quando couber, dentro do prazo.
5. **Registrar** o que aconteceu e o que mudou.

### Onde o servidor fica

Hospedar fora do Brasil é transferência internacional de dados. Desde a **Resolução CD/ANPD
nº 32, de janeiro de 2026**, Brasil e União Europeia se reconhecem como adequados, e os dados
podem ir para a Europa sem contrato adicional. Então:

| região | pela LGPD | latência da voz a partir do Brasil |
|---|---|---|
| Europa (Hetzner Alemanha/Finlândia) | **simples**: país adequado | ~200 ms de ida e volta (estimativa) |
| Estados Unidos | exige as cláusulas-padrão da ANPD (Resolução nº 19/2024) no contrato com o provedor | ~120 ms (estimativa) |
| Brasil | não é transferência | a menor |

A LGPD deixou de pesar contra a Europa; **quem pesa é a latência**, e o `docs/lancamento.md` não
a considerou. Voz com 200 ms de ida e volta é perceptível numa conversa rápida. A sala já mostra
a latência desde a entrada (`633265c`), então dá para medir antes de decidir: um VPS de teste
por uma hora na Europa, a latência da sala lida por quem vai usar.

### Pagamento

- **Nenhum dado de cartão passa pelo servidor.** O pagamento acontece na página do provedor, e
  o Nexo guarda só o identificador do cliente e o estado da assinatura.
- A webhook do provedor tem a assinatura conferida, e processar o mesmo aviso duas vezes não
  pode dar dois meses de premium.
- O registro fiscal tem prazo legal próprio e fica com o provedor: apagar a conta não apaga a
  obrigação fiscal, e a política diz isso.

---

## ECA Digital: o maior risco jurídico

A **Lei nº 15.211/2025** (Estatuto Digital da Criança e do Adolescente) está em vigor desde
**17/03/2026** e alcança aplicativos e jogos **direcionados ou de acesso provável** por crianças
e adolescentes, estejam sediados onde estiverem. Uma plataforma de voz e tela para comunidades de
jogos é, muito provavelmente, de acesso provável por adolescentes.

O que ela exige, e que atinge o Nexo:

- **Verificação de idade por método confiável, sem autodeclaração** (art. 9º). Os padrões
  técnicos ainda dependem de norma da ANPD.
- **A configuração mais protetiva disponível, por padrão** (art. 7º).
- **Remoção de conteúdo que viole direitos de crianças e adolescentes, após notificação**
  (art. 29) — o "relatar uma pessoa" da fase 2 deixa de ser conveniência e passa a ser
  obrigação.
- **Contas de menores de 16 vinculadas a um responsável** nas redes sociais (art. 22). Se o
  Nexo com contas e perfis é "rede social" para a lei é uma pergunta jurídica.
- Multa de até 10% do faturamento no Brasil.

O que isso muda:

1. **Uma consulta com advogado antes de abrir ao público.** É a única decisão deste documento
   que não dá para tomar pelo código. A lei é nova, a regulamentação está incompleta, e o custo
   de errar é desproporcional ao de perguntar.
2. **O desenho atual ajuda, e vale mantê-lo até o parecer:** salas por convite, sem busca de
   salas, sem mensagem direta, sem perfil público. O que a lei mais teme — adulto desconhecido
   encontrando criança — tem pouca superfície aqui.
3. **As contas nascem com lugar para a faixa etária**, sem implementar verificação antes de a
   ANPD dizer o que conta como confiável.
4. **Uso entre amigos e produto aberto são situações diferentes.** O que vale hoje, para o grupo
   atual, não é o parâmetro do lançamento.

---

## O servidor (fase 2)

A lista de endurecimento do VPS, toda operação, nenhuma linha de código:

- SSH só com chave, sem senha e sem login de `root`.
- Firewall com só o necessário: SSH, 80 e 443, e as portas do servidor de mídia.
- Atualizações de segurança automáticas.
- O Node roda como usuário sem privilégio, escutando só em `localhost`, atrás do Caddy — o
  README já recomenda isso.
- **O painel continua fechado**; acesso pelo túnel SSH
  (`ssh -L 3000:localhost:3000 servidor`), nunca com `NEXO_PAINEL_REMOTO`.
- Segredos em `0600`, que no Linux vale de verdade.
- `npm ci` com o lockfile, e `npm audit` no roteiro de atualização.
- Backups cifrados fora da máquina, **e uma restauração testada**.

---

## Onde cada item entra no roteiro

| quando | o quê | esforço |
|---|---|---|
| ~~agora~~ **feito** (`ae0c9db`) | aplicativo de desktop preso à origem escolhida; permissões só para ela; seletor sem Node | — |
| **em seguida** | gerar os instaladores de novo, para a correção chegar a quem usa | operação |
| ~~etapa A~~ **feito** (`5b03c4a`) | origem no Socket.IO; usuário único para login; política de senha; freio por conta; resposta única no login | — |
| ~~etapa B~~ **feito** (`899e056`) | "baixar meus dados" | — |
| fase 2 | cabeçalhos de segurança, com a CSP primeiro em modo relatório | meio dia |
| fase 2 | VPS endurecido; TLS no Caddy; painel pelo túnel SSH | operação |
| fase 2 | backups cifrados fora da máquina, com restauração testada | meio dia |
| fase 2 | relatos com 180 dias; ACL nas chaves do servidor de mídia | um quarto de dia |
| fase 2 | política de privacidade, termos, canal de contato, procedimento de incidente | um dia, mais revisão jurídica |
| fase 2 | parecer sobre o ECA Digital | fora do código |
| fase 3 | checkout do provedor; assinatura da webhook conferida | já na estimativa da fase |
| depois | ponta a ponta opcional; 2FA; indicador nativo enquanto o agente captura | — |

Somando o que falta: **uns 3 dias de código** espalhados pelas fases que já existem, mais
operação e a parte jurídica.

---

## Decisões que são suas

1. ~~**Identificador de login.**~~ **Decidido e feito:** nome de usuário único, como o `@` do
   Discord, ao lado do apelido livre e do código imutável.
2. **Parecer jurídico sobre o ECA Digital antes de abrir ao público.** Recomendação: sim. Nada
   da fase 1 depende dele; o lançamento depende.
3. **Região do servidor.** Recomendação: medir a latência da Europa com a própria sala antes de
   contratar. Se passar do aceitável para quem joga, olhar provedores no Brasil — com a conta de
   banda refeita, porque o custo do `docs/lancamento.md` é o da Hetzner.
4. **Prazos de retenção.** Recomendação: relatos 180 dias, backups 30 dias.
5. **Criptografia ponta a ponta.** Recomendação: não no lançamento.

---

## Fontes

- [ECA Digital entra em vigor: o que a lei prevê e o que ainda falta regulamentar — Data Privacy Brasil](https://www.dataprivacybr.org/eca-digital-entra-em-vigor-o-que-a-lei-preve-e-o-que-ainda-falta-regulamentar/)
- [Lei nº 15.211/2025 entra em vigor em 17 de março de 2026 — Machado Meyer](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/estatuto-digital-da-crianca-e-do-adolescente-lei-n-15-211-2025-entra-em-vigor-em-17-de-marco-de-2026)
- [Resolução CD/ANPD nº 15/2024 — Regulamento de Comunicação de Incidente de Segurança](https://www.abrapp.org.br/legislacao/resolucao-cd-anpd-no-15-de-24-de-abril-de-2024/)
- [Comunicação de incidente de segurança — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [Resolução CD/ANPD nº 2/2022 — agentes de tratamento de pequeno porte](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022)
- [Brasil e União Europeia reconhecem adequação em proteção de dados — Serpro](https://www.serpro.gov.br/menu/noticias/noticias-2026/brasil-e-uniao-europeia-reconhecem-adequacao-em-protecao-de-dados-efeitos-sobre-fluxos-internacionais)
- [Transferência internacional de dados — ANPD](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados)

Este documento resume obrigações legais para orientar o trabalho técnico. Não substitui
parecer jurídico — e, no caso do ECA Digital, recomenda um.
