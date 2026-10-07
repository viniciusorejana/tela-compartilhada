# Nexo no Oracle Cloud Free Tier

Para testar com amigos, de graça, com IP público, UDP livre e sem a máquina dormir. O que é
feito no console da Oracle está aqui; o que é feito na máquina é um comando só
(`deploy/oracle/instalar.sh`).

## 0. Antes: o código precisa estar no GitHub

A máquina baixa o Nexo do GitHub. Envie a branch antes de instalar:

```powershell
git push -u origin fase-1-contas
```

## 1. A conta

Crie em <https://www.oracle.com/cloud/free/>. Pede cartão para verificar identidade, mas os
recursos "Always Free" não cobram.

- **A região de origem (home region) é definitiva**, e os recursos grátis só existem nela.
  Escolha **Brazil East (São Paulo)** ou **Brazil Southeast (Vinhedo)**: o som e a imagem vão
  e voltam do Brasil, e cada 100 ms de distância é atraso na conversa.

## 2. A máquina

**Compute → Instances → Create instance.**

| Campo | O que escolher |
|---|---|
| Image | **Canonical Ubuntu 24.04** (serve 22.04) |
| Shape | **Ampere → VM.Standard.A1.Flex**, 2 OCPU e 12 GB (o limite grátis desde junho de 2026) |
| Rede | a VCN padrão, sub-rede **pública**, **Assign a public IPv4 address** marcado |
| SSH | **Generate a key pair for me** → **Save private key** (guarde o `.key`) |

- **"Out of capacity" no Ampere** é comum. Tente outro *Availability Domain* na mesma tela,
  tente mais tarde, ou use a **VM.Standard.E2.1.Micro** (AMD, também grátis). A Micro roda o
  Nexo, mas é fraca: 1 GB de RAM, 1/8 de núcleo sustentado (com rajada de até uma hora) e
  **50 Mbps de internet** — uns 7 espectadores de tela em 1440p, somando todas as salas. Serve
  para voz e tela entre poucos; o bot de música pode engasgar nela.
- **Até junho de 2026 o grátis ia até 4 OCPU e 24 GB**; hoje são 1 500 OCPU-hora e 9 000 GB-hora
  por mês, ou seja, 2 OCPU e 12 GB. Cada OCPU a mais custa US$ 0,01 por hora (~US$ 7,30 por mês),
  e a memória US$ 0,0015 por GB-hora: 4 OCPU com os mesmos 12 GB saem por ~US$ 15 por mês.
- **A tela pela placa de vídeo (WebCodecs) pesa no servidor**: ela viaja numa faixa de dados, e o
  servidor de mídia gasta umas cinco vezes mais processador por espectador com ela do que com a
  tela pelo WebRTC. Na Micro, dois ou três assistindo em 1440p já levam o servidor ao limite; o
  Nexo percebe e passa a tela para o WebRTC sozinho. Nela, desligue o caminho novo
  (`NEXO_WEBCODECS=0` no `.env.prod`). Na Ampere de 2 OCPU a conta dá uns 25 espectadores em
  1440p pelo WebCodecs (`docs/plano-webcodecs.md`, "O primeiro servidor de verdade" e "Teste de
  carga").
- As duas funcionam com o mesmo instalador: ele detecta x86 ou ARM.

Anote o **Public IP address** da instância.

## 3. As portas, no firewall da Oracle

A rede da Oracle tem um firewall próprio (a *Security List*), separado do da máquina. De
fábrica ele só deixa passar o SSH.

**Networking → Virtual cloud networks → (a VCN) → Security → Security Lists → Default
Security List → Add Ingress Rules**, uma regra para cada linha, todas com *Source CIDR*
`0.0.0.0/0`:

| Protocolo | Porta de destino | Para quê |
|---|---|---|
| TCP | 80 | o certificado HTTPS (Let's Encrypt) |
| TCP | 443 | a página, o chat e a sinalização |
| TCP | 7881 | mídia para quem tem UDP bloqueado |
| UDP | 7882 | mídia: voz, câmera e tela |

## 4. Entrar na máquina e instalar

No PowerShell do seu PC (o Windows já tem `ssh`):

```powershell
ssh -i C:\caminho\para\a-chave.key ubuntu@SEU_IP
```

Se reclamar das permissões da chave: clique direito no `.key` → Propriedades → Segurança →
Avançado → desabilitar herança e deixar só o seu usuário.

Já dentro da máquina:

```bash
curl -fsSL https://raw.githubusercontent.com/viniciusorejana/tela-compartilhada/fase-1-contas/deploy/oracle/instalar.sh | sudo bash
```

Leva uns 5 minutos. No fim ele mostra o endereço, algo como
`https://129-146-10-20.sslip.io` — o **sslip.io** transforma o IP num nome, e é isso que deixa
ter HTTPS sem comprar domínio (microfone, câmera e tela só funcionam em HTTPS).

## 5. Usar

- Abra o endereço, crie sua conta em `/conta` e mande o link da sala para os amigos.
- **O primeiro acesso demora uns segundos**: é o Caddy tirando o certificado.
- A configuração fica em `/opt/nexo/.env.prod` (o instalador deixa quem não tem conta abrir
  sala e sem teto de resolução, para o teste). Depois de mudar: `sudo systemctl restart nexo`.

| Para | Comando (na máquina) |
|---|---|
| ver os logs | `journalctl -u nexo -f` |
| reiniciar | `sudo systemctl restart nexo` |
| atualizar (depois de um `git push`) | `sudo bash /opt/nexo/deploy/oracle/atualizar.sh` |
| a chave do painel | `sudo -u nexo -H bash -c 'cd /opt/nexo && node --env-file=.env.prod scripts/painel-chave.cjs'` |

Do PC, `npm run lancar` faz a atualização acima e ainda lança as versões novas dos aplicativos
(Windows e Android gerados no PC, Linux gerado aqui): `docs/lancar-aplicativos.md`. Ele também
explica como trocar de máquina sem perder as contas e o painel.

**O painel** não abre de fora, de propósito. Do seu PC:

```powershell
ssh -i C:\caminho\para\a-chave.key -L 3000:127.0.0.1:3000 ubuntu@SEU_IP
```

e, com essa janela aberta, <http://localhost:3000/painel>.

**O banco das contas** fica em `/opt/nexo/native/contas`. Num teste isso basta; antes de
convidar gente de fora do grupo, ele precisa de cópia fora da máquina.

## O bot de música e o YouTube

O YouTube desconfia de IP de datacenter e responde **"Sign in to confirm you're not a bot"**. O
yt-dlp precisa então dos cookies de uma conta logada. **Use uma conta Google secundária**: o
arquivo dá acesso à conta, e o YouTube pode restringir conta usada por bot.

1. No PC, instale a extensão **"Get cookies.txt LOCALLY"** (Chrome) ou **"cookies.txt"**
   (Firefox) e permita que ela rode em janela anônima.
2. Numa **janela anônima**: entre no YouTube, vá na mesma aba para
   `https://www.youtube.com/robots.txt`, exporte os cookies e **feche a janela** — aberta, o
   YouTube troca os cookies e o arquivo exportado deixa de valer.
3. Mande para a máquina e ligue no Nexo:

```powershell
scp -i C:\caminho\para\a-chave.key .\cookies.txt ubuntu@SEU_IP:/tmp/cookies.txt
```

```bash
sudo install -o nexo -g nexo -m 600 /tmp/cookies.txt /opt/nexo/native/musica/cookies.txt && rm /tmp/cookies.txt
echo 'NEXO_YTDLP_ARGS="--cookies /opt/nexo/native/musica/cookies.txt"' | sudo tee -a /opt/nexo/.env.prod
sudo systemctl restart nexo
```

**"The page needs to be reloaded"** com cookies já lidos é outra coisa: o yt-dlp sem
interpretador de JavaScript para resolver o desafio que embaralha o endereço do áudio. O bot
passa ao yt-dlp o próprio Node do Nexo (`--js-runtimes`, em `musica.js`); numa instalação
anterior a isso, acrescente `--js-runtimes node` ao `NEXO_YTDLP_ARGS`. Para diagnosticar:

```bash
sudo -u nexo -H /opt/nexo/native/musica/yt-dlp -v --js-runtimes node --cookies /opt/nexo/native/musica/cookies.txt --skip-download "https://www.youtube.com/watch?v=ID" 2>&1 | tail -40
```

Os cookies vencem em semanas ou meses: quando o erro voltar, repita os passos 1 a 3 (sem a
linha do `.env.prod`). Links do SoundCloud e do Bandcamp não passam por nada disso.

## Quando algo não funciona

| Sintoma | Onde olhar |
|---|---|
| O navegador diz que o site não é seguro, ou não abre | portas 80 e 443 na Security List (passo 3); `journalctl -u caddy -n 30` |
| A página abre, mas ninguém vê nem ouve ninguém | UDP 7882 e TCP 7881 na Security List; o Diagnóstico da sala diz se o servidor de mídia conectou |
| `curl: (22) ... 404` ao rodar o instalador | a branch ainda não foi enviada ao GitHub (passo 0) |
| O Nexo cai sozinho na máquina Micro | memória: `free -h`; o instalador cria 2 GB de swap, confira com `swapon --show` |

**A Oracle recupera máquinas grátis ociosas**: uma instância *Always Free* com processador,
rede e memória quase parados por 7 dias seguidos pode ser desligada. Num teste com uso de
verdade isso não acontece; se for acontecer, o aviso chega por e-mail antes.
