#!/usr/bin/env bash
# Atualiza SÓ o painel de pendências para a versão mais nova do GitHub.
# Não mexe no .env, nos dados (data/), no docker-compose.yml, no Chatwoot, na Evolution nem em outros projetos.
# Uso: curl -fsSL <url deste arquivo> | bash
set -euo pipefail

REPO="https://github.com/pietrouww/roleta-oscar.git"
BRANCH="claude/dreamy-ramanujan-6uzw0g"
CONTAINER="painel-pendencias"

echo "==> Procurando a instalação do painel..."
DIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$CONTAINER" 2>/dev/null || true)"
if [ -z "$DIR" ] || [ ! -f "$DIR/docker-compose.yml" ]; then
  DIR=""
  for d in /opt/painel-whatsapp /root/painel-whatsapp /home/*/painel-whatsapp; do
    [ -f "$d/docker-compose.yml" ] && [ -d "$d/src" ] && DIR="$d" && break
  done
fi
if [ -z "$DIR" ]; then
  DIR="$(find / -maxdepth 5 -type f -path '*painel-whatsapp/src/server.js' 2>/dev/null | head -1 | sed 's#/src/server.js##')"
fi
if [ -z "$DIR" ] || [ ! -d "$DIR/src" ]; then
  echo "ERRO: não encontrei a pasta do painel. Mande esta mensagem para o Claude." >&2
  exit 1
fi
echo "    Encontrado em: $DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Baixando a versão nova..."
git clone -q --depth 1 -b "$BRANCH" "$REPO" "$TMP/src"
NOVO="$TMP/src/painel-whatsapp"

echo "==> Guardando cópia da versão atual em $DIR/backup-$(date +%Y%m%d-%H%M).tgz"
tar -czf "$DIR/backup-$(date +%Y%m%d-%H%M).tgz" -C "$DIR" src public package.json 2>/dev/null || true

echo "==> Copiando arquivos do app (sem tocar em .env, data/ e docker-compose.yml)..."
rm -rf "$DIR/src" "$DIR/public"
cp -r "$NOVO/src" "$NOVO/public" "$DIR/"
cp "$NOVO/package.json" "$NOVO/package-lock.json" "$NOVO/Dockerfile" "$NOVO/.env.example" "$NOVO/README.md" "$DIR/"
mkdir -p "$DIR/scripts" && cp -r "$NOVO/scripts/." "$DIR/scripts/"

echo "==> Recriando só o container do painel..."
cd "$DIR"
docker compose build painel
docker compose up -d --no-deps painel

echo "==> Conferindo..."
for i in $(seq 1 20); do
  if docker compose exec -T painel wget -qO- http://127.0.0.1:3100/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "${OK:-0}" = "1" ] && grep -q 'tema-opcoes' "$DIR/public/index.html"; then
  echo ""
  echo "PRONTO! Painel atualizado e funcionando."
  echo "No celular: feche o app do painel e abra de novo."
else
  echo "ATENÇÃO: o painel não respondeu. Rode: cd $DIR && docker compose logs --tail 60 painel  e mande para o Claude." >&2
  exit 1
fi
