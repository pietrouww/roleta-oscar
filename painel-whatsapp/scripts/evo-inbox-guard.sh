#!/usr/bin/env bash
# Vigia a falha da Evolution API (v2.3.x) que às vezes grava no cache a caixa do Chatwoot errada
# para um número (ex.: mensagens do Laboratório indo para a caixa Atendimento).
# Compara o cache "getInbox" de cada número com o nome de caixa configurado ("nameInbox") e,
# se estiver errado, apaga só o cache daquele número. Não reinicia nada.
set -u
REDIS=evolution-redis; DB=6; LOG=/var/log/efx-evo-guard.log
r() { docker exec "$REDIS" redis-cli -n "$DB" "$@" 2>/dev/null; }
nome() { grep -oE "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
for k in $(r --scan --pattern '*:getInbox'); do
  base=${k%:getInbox}; inst=${base##*:}
  esperado=$(r get "$base:getProvider" | nome nameInbox)
  [ -n "$esperado" ] || continue
  atual=$(r get "$k" | nome name)
  if [ -n "$atual" ] && [ "$atual" != "$esperado" ]; then
    n=0
    for c in "$k" $(r --scan --pattern "$base:createConversation-*"); do r del "$c" >/dev/null && n=$((n+1)); done
    echo "$(date '+%F %T') $inst: cache apontava para \"$atual\" (certo: \"$esperado\") - $n chaves apagadas" >> "$LOG"
  fi
done
