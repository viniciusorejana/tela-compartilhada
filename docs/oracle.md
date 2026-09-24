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
| Shape | **Ampere → VM.Standard.A1.Flex**, 2 OCPU e 12 GB (o grátis vai até 4 e 24) |
| Rede | a VCN padrão, sub-rede **pública**, **Assign a public IPv4 address** marcado |
| SSH | **Generate a key pair for me** → **Save private key** (guarde o `.key`) |

- **"Out of capacity" no Ampere** é comum. Tente outro *Availability Domain* na mesma tela,
  tente mais tarde, ou use a **VM.Standard.E2.1.Micro** (AMD, também grátis). A Micro roda o
  Nexo, mas é fraca: 1 GB de RAM e 1/8 de processador. Serve para voz e tela entre poucos;
  o bot de música pode engasgar nela.
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

**O painel** não abre de fora, de propósito. Do seu PC:

```powershell
ssh -i C:\caminho\para\a-chave.key -L 3000:127.0.0.1:3000 ubuntu@SEU_IP
```

e, com essa janela aberta, <http://localhost:3000/painel>.

**O banco das contas** fica em `/opt/nexo/native/contas`. Num teste isso basta; antes de
convidar gente de fora do grupo, ele precisa de cópia fora da máquina.

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
