# Tela Compartilhada

Sala de voz e video em tempo real (estilo Discord) usando WebRTC e Socket.IO: todos os participantes de uma sala conversam por microfone e podem ligar camera e/ou compartilhar a tela quando quiserem. O servidor apenas faz a sinalizacao (mesh P2P); video e audio sao enviados diretamente entre os navegadores, sem passar pelo servidor. Recomendado para salas de ate 4-5 pessoas, ja que cada participante mantem uma conexao direta com cada outro (upload cresce com o numero de pessoas).

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

O `npm install` instala Express e Socket.IO. Nao e preciso instalar dependencias manualmente dentro de `native/`; os arquivos do helper e do WIL ja estao no repositorio.

## Rodar no proprio computador

O comando abaixo compila o helper C++ em `native/audio-helper/x64/Release/` e inicia o servidor:

```powershell
npm start
```

Se a compilacao falhar, confirme que `C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe` existe e que o workload de C++ e o Windows SDK foram instalados.

Acesse no computador que executa o servidor:

- Inicio: http://localhost:3000/
- Sala: http://localhost:3000/sala

Para testar em outro dispositivo da mesma rede, descubra o IPv4 do computador servidor com `ipconfig` e use, por exemplo, `http://192.168.0.10:3000/sala`. Libere o Node.js no Firewall do Windows quando solicitado. Todos os participantes devem conseguir acessar a porta TCP 3000.

## Como usar

1. Abra a pagina inicial, digite um codigo de sala (4 a 32 caracteres, letras minusculas, numeros, `_` ou `-`) e clique em **Criar sala** ou **Entrar na sala**. Isso leva para `/{codigo}/sala`.
2. Na primeira vez, escolha um nome de exibicao. O microfone e ligado automaticamente (com a opcao de silenciar a qualquer momento).
3. Use a barra inferior para ligar/desligar a camera, compartilhar a tela ou testar o audio. Ao compartilhar tela, um painel deixa escolher o tipo de captura (aba/janela/tela inteira) e se o audio vai junto. Nao existe lista de aplicativos para escolher: a origem do audio e decidida automaticamente pelo que voce esta compartilhando (veja abaixo).
4. Cada participante controla localmente o volume e o mudo de cada outro participante (sem afetar o que os demais ouvem). Clique na camera ou na tela de alguem para destacar no palco.
5. Compartilhe o link da sala (botao **Copiar link**) para outras pessoas entrarem. Links antigos (`/{codigo}/compartilhar` e `/{codigo}/ao-vivo`) continuam funcionando e redirecionam para a sala.

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

> **Aviso de antivirus:** o executavel nao e assinado digitalmente, entao o SmartScreen mostra
> "O Windows protegeu o seu computador" na primeira execucao (e preciso clicar em *Mais
> informacoes -> Executar assim mesmo*). Evitar isso exigiria um certificado de assinatura de
> codigo, que e pago. Por esse mesmo motivo o servidor entrega o binario **sem alterar um unico
> byte**: a primeira versao gravava a configuracao dentro do `.exe` e o Windows Defender passou
> a barrar o download como `Trojan:Win32/Wacatac.B!ml` (deteccao heuristica), enquanto o binario
> intacto passa normalmente.

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

Abra **`http://localhost:3000`** no seu proprio PC (nao pela URL do tunel). Crie a sala e copie
o link do botao *Copiar link* -- ele ja vem com o endereco publico para enviar aos amigos.

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
| `PUBLIC_URL` | `http://localhost:PORT` | URL exibida nos logs |
| `CORS_ORIGIN` | qualquer origem | Origem permitida pelo Socket.IO; defina uma origem exata em producao |
| `TURN_URLS` | vazio | URLs TURN separadas por virgula |
| `TURN_USERNAME` | vazio | Usuario do TURN |
| `TURN_CREDENTIAL` | vazio | Credencial do TURN |

Exemplo:

```powershell
$env:PORT="3000"
$env:HOST="0.0.0.0"
$env:PUBLIC_URL="https://stream.exemplo.com"
$env:CORS_ORIGIN="https://stream.exemplo.com"
npm start
```

`PUBLIC_URL` nao publica o servidor nem configura DNS; ele apenas altera os enderecos mostrados nos logs.

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

## TURN para redes restritas

WebRTC tenta uma conexao direta. Se os participantes estiverem em redes diferentes e a conexao nao for estabelecida, configure um servidor TURN, como Coturn:

```powershell
$env:TURN_URLS="turn:turn.seudominio.com:3478,turns:turn.seudominio.com:5349"
$env:TURN_USERNAME="usuario"
$env:TURN_CREDENTIAL="credencial"
npm start
```

O endpoint `/api/rtc-config` entrega essa configuracao aos clientes. TURN aumenta o consumo de banda no servidor e deve usar credenciais fortes e rotacionadas. O tunnel HTTPS nao substitui TURN: eles resolvem problemas diferentes.

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
- **Atraso crescente ou muitos participantes:** reduza resolucao, FPS ou bitrate em `public/sala.html`; como a conexao e mesh (todos com todos), salas grandes pesam mais na banda de upload de cada um.
- **Tunnel nao abre:** confirme que o Node responde em `http://localhost:3000`, que o `cloudflared` esta no `PATH` e que a janela do tunnel continua aberta.

## Estrutura

```text
tela-compartilhada/
├── package.json                    # scripts e dependencias Node.js
├── package-lock.json               # versoes fixadas das dependencias
├── server.js                       # Express, Socket.IO e sinalizacao WebRTC
├── build-helper.ps1                # build Release x64 do helper C++
├── native/audio-helper/            # captura de audio por processo no Windows
├── native/audio-agent/             # agente que cada participante roda no proprio PC
└── public/
    ├── index.html                  # criar/entrar em uma sala
    └── sala.html                   # sala de voz/video (mesh WebRTC)
```