#!/usr/bin/env bash
# Traz a versão nova do Nexo para a máquina da Oracle e reinicia o serviço.
#
#   sudo bash /opt/nexo/deploy/oracle/atualizar.sh
#
# O .env.prod e os dados (native/contas, native/painel, native/medicao) ficam como estão: são
# ignorados pelo Git, e o `pull` não toca neles. Reiniciar derruba as chamadas em curso --
# rode quando a sala estiver vazia.
set -euo pipefail

if [ "$(id -u)" != 0 ]; then echo "Rode com sudo."; exit 1; fi
PASTA=/opt/nexo
USUARIO=nexo
RAMO="${NEXO_RAMO:-$(sudo -u "$USUARIO" -H git -C "$PASTA" rev-parse --abbrev-ref HEAD)}"

sudo -u "$USUARIO" -H git -C "$PASTA" fetch origin "$RAMO"
sudo -u "$USUARIO" -H git -C "$PASTA" checkout "$RAMO"
sudo -u "$USUARIO" -H git -C "$PASTA" pull --ff-only origin "$RAMO"
sudo -u "$USUARIO" -H bash -c "cd '$PASTA' && npm ci --omit=dev && node scripts/baixar-livekit.cjs"
systemctl restart nexo
sleep 3
systemctl is-active --quiet nexo && echo "Nexo atualizado e no ar ($(sudo -u "$USUARIO" -H git -C "$PASTA" log --oneline -1))." || { echo "O Nexo não subiu: journalctl -u nexo -n 50"; exit 1; }
