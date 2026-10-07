# Leva a máquina para o commit do lançamento e reinicia o serviço -- o mesmo que deploy/oracle/atualizar.sh,
# com caminho, usuário e serviço vindos da configuração (deploy/lancamento/config.json).
#
# Chega pela SSH (sudo bash -s), e não roda de dentro da pasta que atualiza: o bash lê um script aos
# poucos, e um `git pull` que mudasse este arquivo no meio da execução faria ele continuar lendo outro.
#
# Exportadas antes: NEXO_PASTA, NEXO_USUARIO, NEXO_SERVICO, NEXO_REMOTO, NEXO_RAMO, NEXO_COMMIT.
set -euo pipefail

como() { sudo -u "$NEXO_USUARIO" -H "$@"; }

cd "$NEXO_PASTA"
antes=$(como git -C "$NEXO_PASTA" rev-parse HEAD)

# O refspec explícito traz o ramo mesmo num clone feito com --single-branch de outro ramo.
como git -C "$NEXO_PASTA" fetch --quiet "$NEXO_REMOTO" "+refs/heads/$NEXO_RAMO:refs/remotes/$NEXO_REMOTO/$NEXO_RAMO"
como git -C "$NEXO_PASTA" checkout --quiet "$NEXO_RAMO"
como git -C "$NEXO_PASTA" merge --ff-only --quiet "$NEXO_REMOTO/$NEXO_RAMO"
depois=$(como git -C "$NEXO_PASTA" rev-parse HEAD)

if [ "$depois" != "$NEXO_COMMIT" ]; then
  echo "A máquina chegou em ${depois:0:7}, e o lançamento é do ${NEXO_COMMIT:0:7}: o $NEXO_REMOTO/$NEXO_RAMO visto de lá é outro." >&2
  exit 1
fi
if [ "$antes" = "$depois" ]; then
  echo "Já estava em ${depois:0:7}; nada a reiniciar."
  exit 0
fi
echo "Código: ${antes:0:7} -> ${depois:0:7}."

if [ ! -d node_modules ] || ! como git -C "$NEXO_PASTA" diff --quiet "$antes" "$depois" -- package.json package-lock.json; then
  echo "Dependências do servidor mudaram: npm ci..."
  como bash -c "cd '$NEXO_PASTA' && npm ci --omit=dev --no-audit --no-fund"
fi
# Com o .env.prod: se ele fixa NEXO_LIVEKIT, é essa a versão que o serviço vai querer ao subir.
como bash -c "cd '$NEXO_PASTA' && node --env-file-if-exists=.env.prod scripts/baixar-livekit.cjs"

systemctl restart "$NEXO_SERVICO"
for _ in $(seq 1 30); do
  systemctl is-active --quiet "$NEXO_SERVICO" && break
  sleep 1
done
# Um serviço que cai logo depois de subir aparece "active" por um instante: a segunda olhada pega.
sleep 3
if ! systemctl is-active --quiet "$NEXO_SERVICO"; then
  journalctl -u "$NEXO_SERVICO" -n 40 --no-pager >&2
  echo "O serviço $NEXO_SERVICO não ficou de pé. O log está acima." >&2
  exit 1
fi
echo "Serviço $NEXO_SERVICO no ar em ${depois:0:7}."
