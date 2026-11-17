#!/usr/bin/env bash
# Instala a checagem a cada minuto da caixa certa na Evolution (não mexe em nada existente).
set -euo pipefail
URL="https://raw.githubusercontent.com/pietrouww/roleta-oscar/claude/dreamy-ramanujan-6uzw0g/painel-whatsapp/scripts/evo-inbox-guard.sh"
curl -fsSL "$URL" -o /usr/local/bin/efx-evo-guard.sh
chmod 755 /usr/local/bin/efx-evo-guard.sh
bash -n /usr/local/bin/efx-evo-guard.sh
echo '* * * * * root /usr/local/bin/efx-evo-guard.sh' > /etc/cron.d/efx-evo-guard
chmod 644 /etc/cron.d/efx-evo-guard
touch /var/log/efx-evo-guard.log
/usr/local/bin/efx-evo-guard.sh
echo "PRONTO! Checagem instalada (a cada minuto). Registro: /var/log/efx-evo-guard.log"
