# Gera o AppImage e o .deb na própria máquina (Linux) e os põe no app/dist.
#
# O build sai numa pasta à parte e só depois entra no app/dist, por rename: gerar direto lá deixaria,
# durante minutos, um AppImage pela metade sendo oferecido como download. O --x64 é fixo porque a
# página anuncia "Linux x64" -- numa máquina ARM, o padrão do electron-builder seria um arm64.
#
# Exportadas antes: NEXO_PASTA, NEXO_USUARIO, NEXO_SERVIDOR_PADRAO, NEXO_SAIDA.
set -euo pipefail

app="$NEXO_PASTA/app"
como() { sudo -u "$NEXO_USUARIO" -H env NEXO_SERVIDOR_PADRAO="$NEXO_SERVIDOR_PADRAO" "$@"; }

# O .deb é montado pelo fpm, que precisa do `ar` (binutils); o Ubuntu mínimo da nuvem não traz.
if ! command -v ar >/dev/null 2>&1; then
  echo "Instalando o binutils (o .deb precisa do ar)..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq binutils >/dev/null
fi

# As dependências do aplicativo só são reinstaladas quando o package-lock.json muda: a marca guarda o
# hash do lock com que a pasta node_modules foi montada.
lock=$(sha256sum "$app/package-lock.json" | cut -d' ' -f1)
if [ "$(cat "$app/node_modules/.nexo-lock" 2>/dev/null || true)" != "$lock" ]; then
  echo "Instalando as dependências do aplicativo (npm ci)..."
  como bash -c "cd '$app' && npm ci --no-audit --no-fund"
  como bash -c "echo '$lock' > '$app/node_modules/.nexo-lock'"
fi

como bash -c "cd '$app' && node ../scripts/servidor-padrao.cjs"
como rm -rf "$app/$NEXO_SAIDA"
como bash -c "cd '$app' && nice -n 19 node node_modules/electron-builder/cli.js --linux AppImage deb --x64 --publish never -c.directories.output='$NEXO_SAIDA'"

for arquivo in Nexo.AppImage Nexo.deb latest-linux.yml; do
  [ -s "$app/$NEXO_SAIDA/$arquivo" ] || { echo "O build terminou sem $arquivo." >&2; exit 1; }
done
# A ficha (latest-linux.yml) por último: ela cita os arquivos, que precisam já estar lá.
for arquivo in Nexo.AppImage Nexo.deb latest-linux.yml; do
  como mv -f "$app/$NEXO_SAIDA/$arquivo" "$app/dist/$arquivo"
done
como node "$app/escrever-versao.js" linux linux-deb
como rm -rf "$app/$NEXO_SAIDA"
