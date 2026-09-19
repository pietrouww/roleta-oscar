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
- **Duas imagens por aparelho**: traseira e tela. O card mostra a traseira (é onde a
  cor aparece) e o detalhe traz as duas, com miniaturas para alternar.
- **Imagem padronizada de verdade**: cada aparelho é desenhado por
  `assets/desenho.js` a partir das medidas reais da Apple — sempre de frente, sem
  inclinação, mesma luz, mesmo enquadramento. O tamanho na tela respeita o tamanho
  real: um Pro Max aparece maior que um mini, na proporção certa. São 41 modelos, do
  iPhone 7 ao 18 Pro Max, com a cor exata do aparelho, o módulo de câmera e a tela
  (botão, entalhe ou ilha dinâmica) de cada geração.
- **Fotos oficiais como alternativa**: `assets/iphones/` guarda 290 imagens do
  material da Apple (41 famílias, 149 cores). Em *Preços e taxas → Imagens dos
  aparelhos* dá para trocar de ilustração para foto. As artes da Apple mudam de
  geração para geração — as antigas são renders em perspectiva, as novas são retas —
  então nesse modo os aparelhos não ficam todos na mesma pose.
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

1. Abra `config/` e entre com a senha (trocável em **Preços e taxas**).
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
    ├── desenho.js      medidas dos modelos e desenho padronizado dos aparelhos
    ├── fotos.js        índice das fotos (gerado por ferramentas/fotos.py)
    ├── fotos.json      o mesmo índice, em JSON
    ├── app.css         estilo do catálogo
    ├── admin.css       estilo do painel
    ├── logo.png        logo da loja
    ├── tabela-taxas.jpg
    └── iphones/        fotos dos modelos (webp, fundo transparente)
```

## Desenho dos aparelhos

`assets/desenho.js` tem a tabela de medidas (altura, largura e raio em milímetros,
tipo de tela e módulo de câmera) de cada modelo e desenha o aparelho em SVG, na hora,
na cor cadastrada. Nada de arquivo de imagem: a mesma pose e o mesmo enquadramento
valem para todos, e um modelo novo é uma linha na tabela `ESPECS`.

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

- O catálogo é aberto e não tem link para a configuração; a senha vale só para
  `config/`. Ela é guardada como resumo SHA-256, nunca em texto, porque o
  `catalogo.json` fica público. Ainda assim é uma tranca de tela: para proteção
  real, use a proteção de diretório da hospedagem sobre a pasta `config`.
- As imagens dos aparelhos são material oficial da Apple, usadas para identificar os
  modelos à venda. iPhone e Apple são marcas registradas da Apple Inc.; a i2Brothers é
  uma assistência independente, sem vínculo com a Apple Inc.
