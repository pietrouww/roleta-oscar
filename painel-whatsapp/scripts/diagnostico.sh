#!/usr/bin/env bash
# Diagnóstico do VPS - SOMENTE LEITURA. Não instala, não apaga e não altera nada.
# Uso: curl -fsSL <url deste arquivo> | bash

linha() { printf '\n===== %s =====\n' "$1"; }

linha "SISTEMA"
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "Núcleos: $(nproc)"
free -h | sed -n '1,2p'
df -h / | tail -1 | awk '{print "Disco: " $2 " total, " $4 " livre (" $5 " usado)"}'
echo "IPs: $(hostname -I 2>/dev/null)"

linha "DOCKER"
if command -v docker >/dev/null 2>&1; then
  docker --version
  docker compose version 2>/dev/null
  echo; echo "Projetos (compose):"
  docker compose ls 2>/dev/null
  echo; echo "Containers rodando:"
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null
  echo; echo "Redes:"
  docker network ls --format '{{.Name}}' 2>/dev/null | tr '\n' ' '; echo
else
  echo "Docker NÃO instalado"
fi

linha "QUEM USA AS PORTAS 80 / 443 / 3000 / 3100 / 8080"
ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443|3000|3100|8080)$/ {print $4, $6}'

linha "PROXY / SERVIDOR WEB"
command -v nginx >/dev/null && nginx -v 2>&1
command -v caddy >/dev/null && caddy version
command -v apache2 >/dev/null && apache2 -v | head -1
docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -Ei 'traefik|nginx|caddy|proxy' || echo "(nenhum proxy em container)"
ls /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/nginx site: /'

linha "CHATWOOT JÁ EXISTE?"
[ -d /root/chatwoot ] && echo "Sim: /root/chatwoot" || echo "Pasta /root/chatwoot não existe"
docker ps --format '{{.Names}}' 2>/dev/null | grep -i chatwoot || true

linha "DNS DOS ENDEREÇOS"
for h in atendimento.efiscus.com.br pendencias.efiscus.com.br evo.efiscus.com.br; do
  ip=$(getent hosts "$h" | awk '{print $1}' | head -1)
  echo "$h -> ${ip:-(ainda não existe)}"
done

linha "FIM - copie tudo acima e mande para o Claude"
