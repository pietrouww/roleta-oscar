#!/usr/bin/env bash
# Descobre por que as mensagens do WhatsApp não chegam no Chatwoot. SOMENTE LEITURA.
# Uso: curl -fsSL <url deste arquivo> | bash
RAW="https://raw.githubusercontent.com/pietrouww/roleta-oscar/claude/dreamy-ramanujan-6uzw0g/painel-whatsapp/scripts"

DIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' painel-pendencias 2>/dev/null)"
[ -z "$DIR" ] && DIR=/opt/painel-whatsapp
cd "$DIR" || { echo "Não encontrei a pasta do painel"; exit 1; }
echo "Pasta do painel: $DIR"

curl -fsSL "$RAW/diag-mensagens.mjs" | docker compose exec -T painel node --input-type=module -

echo
echo "===== EVOLUTION → CHATWOOT (de dentro da Evolution) ====="
CW="$(docker compose exec -T painel printenv EVOLUTION_CHATWOOT_URL 2>/dev/null | tr -d '\r')"
[ -z "$CW" ] && CW="$(docker compose exec -T painel printenv CHATWOOT_URL | tr -d '\r')"
if docker compose exec -T evolution sh -c "wget -q -T 10 -O- '$CW/api' 2>&1 || curl -fsS -m 10 '$CW/api' 2>&1" ; then
  echo; echo "OK: a Evolution consegue abrir $CW"
else
  echo; echo "PROBLEMA: a Evolution NÃO consegue abrir $CW (mensagens não chegam no Chatwoot)"
fi

echo
echo "===== ÚLTIMOS AVISOS DA EVOLUTION (24h) ====="
docker compose logs --since 24h --no-color evolution 2>/dev/null \
  | grep -iE 'chatwoot|error|erro|fail|unauthor|ECONN|ENOTFOUND|timeout' \
  | grep -viE 'apikey|token' | tail -40

echo
echo "===== FIM - copie tudo acima e mande para o Claude ====="
