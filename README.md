# Tela Compartilhada

Aplicacao web para compartilhar tela, camera e audio em tempo real usando WebRTC e Socket.IO. O servidor faz a sinalizacao; video e audio sao enviados diretamente entre os navegadores.

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
- Transmitir: http://localhost:3000/compartilhar
- Assistir: http://localhost:3000/ao-vivo

Para testar em outro dispositivo da mesma rede, descubra o IPv4 do computador servidor com `ipconfig` e use, por exemplo, `http://192.168.0.10:3000/ao-vivo`. Libere o Node.js no Firewall do Windows quando solicitado. O transmissor e o espectador devem conseguir acessar a porta TCP 3000.

## Como usar

1. Na pagina de transmitir, escolha somente tela, somente camera ou tela e camera.
2. Clique em **Iniciar compartilhamento** e aceite as permissoes do navegador.
3. Para levar audio da tela, marque **Compartilhar audio** na janela de selecao do Chrome/Edge. As opcoes variam conforme a fonte escolhida.
4. Compartilhe com os espectadores o endereco `/ao-vivo`. Para uma sala especifica, use `/{codigo}/compartilhar` e `/{codigo}/ao-vivo`, com um codigo de 4 a 32 caracteres contendo letras minusculas, numeros, `_` ou `-`.
5. Na pagina ao vivo, o espectador pode usar o link da sala e, quando habilitado, compartilhar a propria tela pelo navegador sem instalar Node.js.

So ha um transmissor ativo por sala. Varios espectadores podem assistir. A qualidade depende da conexao e do encoder/decoder dos dois navegadores; o servidor nao retransmite a midia.

### Audio por aplicativo no Windows

Na pagina de transmitir, use **Atualizar aplicativos** para listar processos, escolha uma politica e selecione os processos desejados. Em **Somente aplicativos selecionados**, use Ctrl para selecionar varios; eles sao mixados. Em **Todo o sistema, exceto um aplicativo**, selecione o processo que deve ser excluido.

Essa captura depende do helper compilado e do Windows. O navegador continua sendo responsavel pelo audio compartilhado na janela de `getDisplayMedia`; nenhum aplicativo pode ser selecionado silenciosamente por codigo.

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

4. Copie a URL `https://....trycloudflare.com` mostrada no terminal e use `/compartilhar` para transmitir ou `/ao-vivo` para assistir.

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

Use `https://stream.seudominio.com/compartilhar` para transmitir e `https://stream.seudominio.com/ao-vivo` para assistir. O DNS e o certificado HTTPS sao gerenciados pela Cloudflare. Proteja o arquivo `.json` de credenciais e nunca o commite.

Para manter o servico apos reinicializacoes, configure o `cloudflared` como servico do Windows ou use o Agendador de Tarefas. O processo Node tambem precisa ser mantido ativo por NSSM, PM2 ou um servico do Windows.

## Dominio proprio sem Cloudflare Tunnel

Outra arquitetura e apontar o DNS para um servidor publico e colocar Caddy ou Nginx como proxy HTTPS na frente do Node. O proxy deve encaminhar HTTP e WebSocket para `localhost:3000`; libere apenas as portas 80/443 no firewall e mantenha o Node escutando localmente. Configure `PUBLIC_URL` e `CORS_ORIGIN` com a URL HTTPS final. Nao encaminhe a porta 3000 diretamente quando o objetivo for acesso publico seguro.

## TURN para redes restritas

WebRTC tenta uma conexao direta. Se transmissor e espectador estiverem em redes diferentes e a conexao nao for estabelecida, configure um servidor TURN, como Coturn:

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
- Nao inclua tokens, credenciais TURN, arquivos `.cloudflared` ou certificados no Git.
- Para producao, defina `CORS_ORIGIN` para o dominio exato, use firewall, mantenha Node.js/Windows/cloudflared atualizados e monitore os logs.

## Solucao de problemas

- **Helper de audio nao encontrado:** execute `npm start` em Windows com Visual Studio Build Tools C++ e confirme que o build terminou sem erro.
- **Captura bloqueada:** abra a pagina por `https://` ou por `localhost`; um IP publico em HTTP nao e contexto seguro.
- **Espectador nao conecta:** teste a sala correta, confirme que o transmissor esta online e configure TURN se houver NAT/firewall restritivo.
- **Audio sem som:** marque a opcao de audio no seletor do navegador; a disponibilidade depende da fonte, navegador e sistema operacional.
- **Atraso crescente:** reduza resolucao, FPS ou bitrate em `public/compartilhar.html`; em TVs e dispositivos fracos, o gargalo costuma ser a decodificacao.
- **Tunnel nao abre:** confirme que o Node responde em `http://localhost:3000`, que o `cloudflared` esta no `PATH` e que a janela do tunnel continua aberta.

## Estrutura

```text
tela-compartilhada/
├── package.json                    # scripts e dependencias Node.js
├── package-lock.json               # versoes fixadas das dependencias
├── server.js                       # Express, Socket.IO e sinalizacao WebRTC
├── build-helper.ps1                # build Release x64 do helper C++
├── native/audio-helper/            # captura de audio por processo no Windows
└── public/
    ├── index.html                  # entrada e salas
    ├── compartilhar.html            # interface do transmissor
    └── ao-vivo.html                 # interface do espectador
```