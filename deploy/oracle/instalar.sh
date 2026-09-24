#!/usr/bin/env bash
# Instala o Nexo numa máquina do Oracle Cloud Free Tier: Ubuntu 22.04 ou 24.04, AMD (x86) ou
# Ampere (ARM). Roda de novo sem estragar nada: serve também para consertar uma instalação.
#
#   curl -fsSL https://raw.githubusercontent.com/viniciusorejana/tela-compartilhada/fase-1-contas/deploy/oracle/instalar.sh | sudo bash
#
# O que fica de pé no fim:
#   - o Nexo em /opt/nexo, como serviço do systemd (usuário `nexo`, sobe sozinho no boot);
#   - o Caddy na frente, com HTTPS de verdade num nome <ip-com-traços>.sslip.io -- sem comprar
#     domínio: microfone, câmera e tela só funcionam em HTTPS;
#   - o firewall DA MÁQUINA aberto para 80, 443, 7881/tcp e 7882/udp. O da Oracle (a "Security
#     List" da rede) é outro, e é aberto no console -- ver docs/oracle.md.
#
# Variáveis opcionais: NEXO_RAMO (padrão fase-1-contas), NEXO_DOMINIO (padrão o sslip.io do
# IP), NEXO_REPO.
set -euo pipefail

if [ "$(id -u)" != 0 ]; then echo "Rode com sudo."; exit 1; fi

REPO="${NEXO_REPO:-https://github.com/viniciusorejana/tela-compartilhada.git}"
RAMO="${NEXO_RAMO:-fase-1-contas}"
PASTA=/opt/nexo
USUARIO=nexo
export DEBIAN_FRONTEND=noninteractive

passo() { printf '\n\033[1;35m== %s\033[0m\n' "$*"; }

# ---------- Endereço ----------
# A placa de rede da Oracle só tem o IP privado (10.x); o público é um NAT na frente dela.
# Por isso ele é perguntado a fora, e não lido da máquina.
passo "Descobrindo o IP público"
IP="$(curl -fsS --max-time 8 https://api.ipify.org || curl -fsS --max-time 8 https://ifconfig.me || true)"
if ! printf '%s' "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  echo "Não consegui descobrir o IP público ($IP). Rode de novo com NEXO_IP=... definido."; exit 1
fi
IP="${NEXO_IP:-$IP}"
DOMINIO="${NEXO_DOMINIO:-${IP//./-}.sslip.io}"
echo "IP: $IP"
echo "Endereço: https://$DOMINIO"

# ---------- Pacotes ----------
passo "Instalando pacotes (git, ffmpeg, Node 24, Caddy)"
apt-get update -y
apt-get install -y ca-certificates curl git ffmpeg gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 24: o banco das contas usa `node:sqlite`, que não existe nas versões dos repositórios
# do Ubuntu.
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v)"

# Caddy pelo repositório oficial: o Ubuntu 22.04 não tem, e o do 24.04 é antigo.
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---------- Memória ----------
# A máquina AMD grátis tem 1 GB. O `npm ci` e o bot de música passam disso num pico, e sem
# swap o sistema mata o Nexo no meio de uma chamada.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q /swapfile; then
  passo "Criando 2 GB de swap (a máquina tem menos de 2 GB de RAM)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- Firewall da máquina ----------
# As imagens Ubuntu da Oracle vêm com um iptables que recusa tudo menos o SSH -- é o motivo
# número um de "abri a porta no console e nada funciona". As regras entram no topo, antes
# do REJECT, e são gravadas para sobreviver ao boot.
passo "Abrindo 80, 443, 7881/tcp e 7882/udp no firewall da máquina"
for regra in "tcp 80" "tcp 443" "tcp 7881" "udp 7882"; do
  set -- $regra
  iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save
else
  apt-get install -y iptables-persistent
  netfilter-persistent save
fi

# ---------- Código ----------
passo "Baixando o Nexo ($RAMO)"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$USUARIO --shell /usr/sbin/nologin "$USUARIO"
if [ -d "$PASTA/.git" ]; then
  sudo -u "$USUARIO" -H git -C "$PASTA" fetch origin "$RAMO"
  sudo -u "$USUARIO" -H git -C "$PASTA" checkout "$RAMO"
  sudo -u "$USUARIO" -H git -C "$PASTA" pull --ff-only origin "$RAMO"
else
  git clone --branch "$RAMO" "$REPO" "$PASTA"
  chown -R "$USUARIO:$USUARIO" "$PASTA"
fi

passo "Instalando dependências e o servidor de mídia"
# Sem as dependências de desenvolvimento: o Playwright (os testes) sozinho pesa centenas de MB.
sudo -u "$USUARIO" -H bash -c "cd '$PASTA' && npm ci --omit=dev && node scripts/baixar-livekit.cjs"
# O bot de música é opcional: sem ele a sala funciona inteira, só o canal de música fica fora.
sudo -u "$USUARIO" -H bash -c "cd '$PASTA' && node scripts/baixar-musica.cjs" || echo "(o bot de música ficou de fora; o resto funciona)"

# ---------- Configuração ----------
# Só na primeira vez: rodar o instalador de novo não pode apagar o que foi ajustado à mão.
if [ ! -f "$PASTA/.env.prod" ]; then
  passo "Escrevendo $PASTA/.env.prod"
  cat > "$PASTA/.env.prod" <<FIM
# Nexo no Oracle Cloud -- escrito por deploy/oracle/instalar.sh. Referência: .env.example.
NODE_ENV=production
PORT=3000
# Só o Caddy fala com o Node; de fora, só por HTTPS.
HOST=127.0.0.1
PUBLIC_URL=https://$DOMINIO
NEXO_PROXIES_CONFIAVEIS=127.0.0.1,::1
# Teste com amigos: quem não tem conta ainda abre sala, e ninguém tem teto de resolução.
# Para as regras finais: NEXO_ANONIMO_ABRE_SALA=0 e NEXO_PLANOS=1.
NEXO_ANONIMO_ABRE_SALA=1
NEXO_PLANOS=0
NEXO_FUSO=America/Sao_Paulo
NEXO_PAINEL_REMOTO=0
# O IP público não está na placa de rede (é um NAT da Oracle): dito aqui, em vez de
# descoberto a cada início; e o endereço interno não é anunciado a ninguém.
NEXO_IP_PUBLICO=$IP
NEXO_ANUNCIAR_LAN=0
SFU_UDP_PORTS=7882
SFU_TCP_PORT=7881
FIM
  chown "$USUARIO:$USUARIO" "$PASTA/.env.prod"
  chmod 600 "$PASTA/.env.prod"
fi

# ---------- Serviço ----------
passo "Registrando o serviço nexo"
cat > /etc/systemd/system/nexo.service <<FIM
[Unit]
Description=Nexo -- sala de voz, câmera e tela
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$PASTA
ExecStart=/usr/bin/node --env-file-if-exists=.env.prod server.js
Restart=always
RestartSec=3
# O servidor de mídia é filho do Node: parar o serviço leva o grupo inteiro junto.
KillMode=control-group
TimeoutStopSec=15
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
FIM
systemctl daemon-reload
systemctl enable nexo
systemctl restart nexo

# ---------- HTTPS ----------
passo "Configurando o HTTPS ($DOMINIO)"
cat > /etc/caddy/Caddyfile <<FIM
# Escrito por deploy/oracle/instalar.sh. O certificado vem sozinho do Let's Encrypt.
$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
FIM
systemctl enable caddy
systemctl restart caddy

# ---------- Conferência ----------
passo "Conferindo"
sleep 4
if systemctl is-active --quiet nexo; then echo "nexo: no ar"; else echo "nexo: FORA DO AR -- veja: journalctl -u nexo -n 50"; fi
if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3000/; then echo "Node respondendo em 127.0.0.1:3000"; else echo "O Node ainda não respondeu (pode levar alguns segundos)."; fi

cat <<FIM

Pronto. Abra: https://$DOMINIO

  - O certificado sai na primeira visita; se der erro de HTTPS, confira as portas 80 e 443
    na Security List da Oracle (docs/oracle.md) e rode: journalctl -u caddy -n 30
  - Logs do Nexo:        journalctl -u nexo -f
  - Chave do painel:     sudo -u $USUARIO -H bash -c 'cd $PASTA && node --env-file=.env.prod scripts/painel-chave.cjs'
  - Painel (do seu PC):  ssh -L 3000:127.0.0.1:3000 ubuntu@$IP  e abra http://localhost:3000/painel
  - Atualizar depois:    sudo bash $PASTA/deploy/oracle/atualizar.sh
FIM
