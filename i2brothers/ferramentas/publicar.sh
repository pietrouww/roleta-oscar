#!/usr/bin/env bash
# Monta o pacote para publicar na hospedagem.
#
#   ./ferramentas/publicar.sh            -> publicar/venda_aparelhos/ + venda_aparelhos.zip
#   ./ferramentas/publicar.sh loja       -> mesma coisa, com a pasta chamada "loja"
#
# O conteúdo vai para public_html/<pasta>/ na Hostinger. O catálogo é o
# index.html da pasta; a configuração fica em <pasta>/config/.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASTA="${1:-venda_aparelhos}"
SAIDA="$RAIZ/publicar"
ALVO="$SAIDA/$PASTA"

rm -rf "$ALVO" "$SAIDA/$PASTA.zip"
mkdir -p "$ALVO"

cp "$RAIZ/index.html" "$RAIZ/catalogo.json" "$ALVO/"
cp -r "$RAIZ/assets" "$ALVO/assets"
mkdir -p "$ALVO/config"
cp "$RAIZ/config/index.html" "$ALVO/config/"

# a hospedagem não precisa do índice em JSON nem da imagem de referência da tabela
rm -f "$ALVO/assets/fotos.json"

( cd "$SAIDA" && zip -qr "$PASTA.zip" "$PASTA" )

echo "pronto:"
echo "  pasta:  $ALVO"
echo "  zip:    $SAIDA/$PASTA.zip  ($(du -h "$SAIDA/$PASTA.zip" | cut -f1))"
echo "  arquivos: $(find "$ALVO" -type f | wc -l)"
