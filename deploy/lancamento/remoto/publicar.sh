# Põe no app/dist da máquina os builds que o lançamento gerou no PC e anota as versões deles.
#
# Os arquivos chegam numa pasta temporária; só entram depois de conferido o SHA-256 de cada um --
# uma transferência cortada não pode virar o download de ninguém. Cada um entra por rename, que é
# atômico: quem estiver baixando continua com o arquivo velho inteiro, e quem chegar depois pega o
# novo inteiro. A anotação (versao.json) vem por último, quando os arquivos já estão no lugar.
#
# Exportadas antes: NEXO_PASTA, NEXO_USUARIO, NEXO_ENTRADA, NEXO_ARQUIVOS (na ordem de entrada),
# NEXO_SOMAS (linhas "sha256  arquivo"), NEXO_CHAVES e NEXO_SERVIDOR_PADRAO.
set -euo pipefail

cd "$NEXO_ENTRADA"
printf '%s\n' "$NEXO_SOMAS" | sha256sum --check --quiet -
echo "SHA-256 conferido: $NEXO_ARQUIVOS."

dist="$NEXO_PASTA/app/dist"
install -d -o "$NEXO_USUARIO" -g "$NEXO_USUARIO" "$dist"
for arquivo in $NEXO_ARQUIVOS; do
  install -o "$NEXO_USUARIO" -g "$NEXO_USUARIO" -m 644 "$arquivo" "$dist/.$arquivo.novo"
  mv -f "$dist/.$arquivo.novo" "$dist/$arquivo"
done

sudo -u "$NEXO_USUARIO" -H env NEXO_SERVIDOR_PADRAO="$NEXO_SERVIDOR_PADRAO" node "$NEXO_PASTA/app/escrever-versao.js" $NEXO_CHAVES

cd /
rm -rf "$NEXO_ENTRADA"
