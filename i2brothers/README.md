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
- **Fotos reais dos modelos**: 117 imagens oficiais da Apple já recortadas em
  `assets/iphones/`, escolhidas automaticamente pelo modelo **e pela cor** do aparelho.
  Modelo sem imagem cadastrada cai para uma ilustração gerada na hora.
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
└── assets/
    ├── core.js         dados, preços, simulador e importador
    ├── app.css         estilo do catálogo
    ├── admin.css       estilo do painel
    ├── logo.png        logo da loja
    ├── tabela-taxas.jpg
    └── iphones/        fotos dos modelos (webp, fundo transparente)
```

## Observações

- A senha do painel protege apenas a tela, no navegador. Como o site é estático,
  não existe autenticação de servidor — mantenha o endereço do painel restrito à equipe.
- As imagens dos aparelhos são material oficial da Apple, usadas para identificar os
  modelos à venda. iPhone e Apple são marcas registradas da Apple Inc.; a i2Brothers é
  uma assistência independente, sem vínculo com a Apple Inc.
