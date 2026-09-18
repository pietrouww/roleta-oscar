# i2Brothers — Catálogo de iPhones

Sistema estático (HTML + CSS + JavaScript, sem servidor e sem dependências) para
publicar o catálogo de iPhones **novos** e **seminovos** da i2Brothers — Assistência Apple.

| Página | Arquivo | Para quem |
|---|---|---|
| Catálogo público | `index.html` | Cliente — link compartilhável |
| Área administrativa | `admin.html` | Equipe da loja |

## O que o sistema faz

- **Duas seções**: iPhones novos (lacrados · 1 ano de garantia Apple) e seminovos
  (revisados · 3 meses de garantia da loja).
- **Duas fotos por aparelho**: traseira e tela, escolhidas automaticamente pelo modelo
  **e pela cor**. O card mostra a traseira (é onde a cor aparece) e o detalhe do
  aparelho traz as duas, com miniaturas para alternar.
- **Repositório de fotos**: 290 imagens oficiais da Apple em `assets/iphones/`,
  cobrindo do iPhone 7 ao iPhone 18 Pro Max — 41 famílias e 149 cores. Modelo fora
  dessa lista cai para uma ilustração gerada na hora.
- **Padrão único de imagem**: todas passam pelo mesmo tratamento — um aparelho
  inteiro, sem corte, fundo transparente, mesma tela de 620 x 880 px e mesma altura de
  aparelho (840 px). Assim os cards ficam alinhados, sem um aparelho maior que o outro.
- **Preço à vista** = valor da lista **+ R$ 500,00** por aparelho (o acréscimo é
  configurável, e pode ser ajustado aparelho a aparelho).
- **Simulador de parcelamento** em até 12x com as taxas da maquineta, sempre
  identificado como prévia sujeita a confirmação.
- **Avisos obrigatórios** no topo, em cada aparelho e no rodapé: a lista é atualizada
  uma vez por dia e todo aparelho está sujeito a consulta de disponibilidade no
  fechamento da compra.
- **Importador de lista**: cola-se a lista do fornecedor e o sistema identifica
  modelo, capacidade, cor, saúde da bateria e valor.

## Uso diário

1. Abra `admin.html` e entre com a senha (padrão: `i2brothers` — troque em **Preços e taxas**).
2. Aba **Importar lista** → cole a lista, escolha a seção (novos/seminovos) e processe.
3. Confira a prévia e confirme.
4. Aba **Publicar** → **Baixar catalogo.json** e substitua o arquivo `catalogo.json`
   na pasta do site.
5. Pronto: o catálogo público passa a mostrar a lista nova.

O botão **Pré-visualizar** abre `index.html?preview=1`, que mostra o rascunho salvo
no navegador antes de publicar.

### Formatos aceitos na importação

O valor é sempre o último número da linha:

```
iPhone 16 Pro 256GB Titânio Natural - 7890
iPhone 15 Plus | 512GB | Rosa | 5.499,00
iPhone 12 64gb Preto 89% ; 1890
```

O `%` vira saúde da bateria (usado nos seminovos). O valor informado é o **valor base**:
o acréscimo da loja é somado automaticamente.

## Taxas do cartão

A tabela padrão é a da operadora (Mastercard e Visa):

| | Taxa | | Taxa |
|---|---|---|---|
| Débito | 0,85% | 7x | 7,24% |
| 1x | 2,89% | 8x | 7,82% |
| 2x | 4,22% | 9x | 8,41% |
| 3x | 4,83% | 10x | 8,98% |
| 4x | 5,44% | 11x | 9,56% |
| 5x | 6,05% | 12x | 10,12% |
| 6x | 6,64% | | |

Dois modos de cálculo, selecionáveis no painel:

- **Repasse integral** (padrão): `valor ÷ (1 − taxa)` — a loja recebe o valor cheio.
- **Acréscimo simples**: `valor × (1 + taxa)`.

As taxas são editáveis no painel; o catálogo sempre avisa que a simulação é uma prévia,
válida só para Mastercard e Visa, e que outras bandeiras devem ser consultadas com o atendente.

## Publicação

Qualquer hospedagem de site estático serve (GitHub Pages, Netlify, Hostinger, etc.).
Basta subir a pasta `i2brothers/` inteira. Neste repositório o deploy sai pelo
GitHub Pages e o catálogo fica em `.../roleta-oscar/i2brothers/`.

## Estrutura

```
i2brothers/
├── index.html          catálogo público
├── admin.html          área administrativa
├── catalogo.json       dados publicados (gerado pelo painel)
├── ferramentas/
│   └── fotos.py        monta o repositório de fotos a partir do material da Apple
└── assets/
    ├── core.js         dados, preços, simulador e importador
    ├── fotos.js        índice das fotos (gerado por ferramentas/fotos.py)
    ├── fotos.json      o mesmo índice, em JSON
    ├── app.css         estilo do catálogo
    ├── admin.css       estilo do painel
    ├── logo.png        logo da loja
    ├── tabela-taxas.jpg
    └── iphones/        fotos dos modelos (webp, fundo transparente)
```

## Repositório de fotos

`ferramentas/fotos.py` monta a pasta `assets/iphones/` a partir das artes oficiais da
Apple. Cada arte traz os dois aparelhos lado a lado — traseira à esquerda, tela à
direita; o script apaga o fundo, separa os dois pela emenda entre eles, recorta cada
aparelho inteiro e coloca os dois na mesma tela.

```bash
python3 ferramentas/fotos.py                 # refaz tudo
python3 ferramentas/fotos.py "iphone 18"     # refaz só uma família
python3 ferramentas/fotos.py --mapa          # só regrava o índice
```

Para incluir um modelo novo, basta acrescentá-lo à tabela `FONTES` no topo do script.

Onde a Apple publica apenas a linha de cores (iPhone 7, 8, 12 Pro e SE 3ª geração),
os versos aparecem em leque, um cobrindo o outro — nesses casos fica só a foto da
tela. Nas linhas 17 Pro e 18 Pro a arte por cor traz a tela parcialmente encoberta
pela traseira, então a foto da tela vem da arte de comparação da Apple.

## Observações

- A senha do painel protege apenas a tela, no navegador. Como o site é estático,
  não existe autenticação de servidor — mantenha o endereço do painel restrito à equipe.
- As imagens dos aparelhos são material oficial da Apple, usadas para identificar os
  modelos à venda. iPhone e Apple são marcas registradas da Apple Inc.; a i2Brothers é
  uma assistência independente, sem vínculo com a Apple Inc.
