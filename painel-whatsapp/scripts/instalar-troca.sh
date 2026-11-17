#!/usr/bin/env bash
# Instala a troca de atendente com PIN (aparelhos da recepção e do laboratório) e o tema claro padrão no Chatwoot.
# Não para nem reinicia Chatwoot, Evolution, painel ou outros projetos. Só cria o container "troca-atendente"
# (porta 3300, só local), acrescenta /troca/ no site atendimento do Nginx e recarrega o Nginx (sem queda).
# Não mostra senhas nem tokens. Uso: bash instalar-troca.sh < /dev/null
set -euo pipefail
REPO="https://github.com/pietrouww/roleta-oscar.git"
BRANCH="claude/dreamy-ramanujan-6uzw0g"
CW=/opt/chatwoot; DST=/opt/troca-atendente
NG=/etc/nginx/sites-available/atendimento; SN=/etc/nginx/snippets/efiscus-tema.conf; WEB=/var/www/efiscus-tema
STAMP=$(date +%Y%m%d%H%M)
falha(){ echo "ERRO: $*" >&2; exit 1; }

echo "==> Conferindo o servidor..."
[ -f "$NG" ] && [ -f "$SN" ] && [ -d "$WEB" ] && [ -f "$CW/docker-compose.yaml" ] || falha "arquivos esperados do Chatwoot/Nginx não encontrados"
if ss -ltn | awk '{print $4}' | grep -qE '[:.]3300$' && ! docker ps --format '{{.Names}}' | grep -qx troca-atendente; then
  falha "a porta 3300 já está em uso por outro programa"
fi
cd "$CW"
docker compose ps --services --status running | grep -qx rails || falha "serviço rails do Chatwoot não está rodando"

echo "==> Baixando os arquivos..."
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 -b "$BRANCH" "$REPO" "$TMP/src"
N="$TMP/src/troca-atendente"
mkdir -p "$DST/data"
cp "$N/server.js" "$N/docker-compose.yml" "$DST/"

echo "==> Criando o acesso de troca no Chatwoot (sem reiniciar nada)..."
RB='app = PlatformApp.find_or_create_by!(name: "troca-atendente")
tok = (app.access_token || app.create_access_token!).token
lista = %w[rogerio.faria dayane.faria mharllon.felipe larissa.gabrieli].map { |n|
  u = User.find_by(email: "#{n}@i2brothers.com.br")
  next unless u
  PlatformAppPermissible.find_or_create_by!(platform_app: app, permissible: u)
  "#{u.id}|#{u.name}|#{u.email}"
}.compact
puts "EFX_TOKEN=#{tok}"
puts "EFX_ATEND=#{lista.join(";")}"
puts "EFX_N=#{lista.size}"'
OUT=$(docker compose exec -T rails bundle exec rails runner "$RB" < /dev/null 2>/dev/null) || falha "não consegui falar com o Chatwoot (rails runner)"
TOK=$(printf '%s\n' "$OUT" | sed -n 's/^EFX_TOKEN=//p' | tail -1)
ATD=$(printf '%s\n' "$OUT" | sed -n 's/^EFX_ATEND=//p' | tail -1)
NAT=$(printf '%s\n' "$OUT" | sed -n 's/^EFX_N=//p' | tail -1)
[ -n "$TOK" ] && [ -n "$ATD" ] || falha "o Chatwoot não devolveu o acesso/atendentes"
echo "    Atendentes encontrados: $NAT"
( umask 077; printf 'CHATWOOT_ACCOUNT_ID=1\nPLATFORM_TOKEN=%s\nATENDENTES=%s\n' "$TOK" "$ATD" > "$DST/.env" )
unset TOK OUT

echo "==> Subindo o serviço de troca (container novo, porta 3300 local)..."
cd "$DST"
docker compose up -d < /dev/null
OK=0; for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3300/troca/health >/dev/null 2>&1 && OK=1 && break; sleep 2; done
[ "$OK" = 1 ] || falha "o serviço de troca não respondeu. Rode: docker logs --tail 40 troca-atendente"

echo "==> Ajustando o Nginx do atendimento (com cópia de segurança)..."
cp -a "$NG" "/root/atendimento.nginx.bak-$STAMP"; cp -a "$SN" "/root/efiscus-tema.conf.bak-$STAMP"
cp "$N/troca.js" "$N/claro.js" "$WEB/"
python3 - "$NG" "$SN" <<'PY'
import sys,re
ng, sn = sys.argv[1], sys.argv[2]
t = open(ng).read()
if 'location /troca/' not in t:
    if t.count('location / {') != 1:
        sys.exit('ERRO: não achei um único "location / {" no site atendimento')
    bloco = ('location /troca/ {\n        proxy_pass http://127.0.0.1:3300;\n'
             '        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n'
             '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n\n    location / {')
    t = t.replace('location / {', bloco, 1)
    open(ng, 'w').write(t)
s = open(sn).read()
if 'troca.js' not in s:
    alvo = "<script src='/efiscus-tema/tema.js?v=1' defer></script>"
    if alvo not in s or "<link rel='stylesheet'" not in s:
        sys.exit('ERRO: o snippet do tema está diferente do esperado')
    s = s.replace("<link rel='stylesheet'", "<script src='/efiscus-tema/claro.js?v=1'></script><link rel='stylesheet'", 1)
    s = s.replace(alvo, alvo + "<script src='/efiscus-tema/troca.js?v=1' defer></script>", 1)
    open(sn, 'w').write(s)
PY
if ! nginx -t >/dev/null 2>&1; then
  cp -a "/root/atendimento.nginx.bak-$STAMP" "$NG"; cp -a "/root/efiscus-tema.conf.bak-$STAMP" "$SN"
  falha "o teste do Nginx falhou; voltei os arquivos como estavam (nada foi recarregado)"
fi
systemctl reload nginx

echo "==> Conferindo pelo endereço público..."
sleep 2
curl -fsS https://atendimento.efiscus.com.br/troca/health | grep -q '"ok":true' || falha "/troca/ não respondeu pelo endereço público"
curl -fsS https://atendimento.efiscus.com.br/app/login | grep -q 'troca.js' || echo "ATENÇÃO: a página do Chatwoot ainda não mostra o troca.js (pode ser cache)."
echo ""
echo "PRONTO! Troca de atendente instalada e tema claro como padrão."
echo "Para ativar um aparelho: abra https://atendimento.efiscus.com.br/app/#ativar-aparelho nele."
