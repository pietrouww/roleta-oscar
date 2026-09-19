# 🎬 Roleta do Oscar

Site estático que sorteia um filme entre **todos os 97 vencedores do Oscar de Melhor Filme** (de *Wings*, 1927, a *Anora*, 2024) por meio de uma roleta animada, e exibe um card com os **100 melhores filmes segundo o IMDb** (baseado no Top 250), com busca e destaque para os títulos que também venceram o Oscar.

## Funcionalidades

- 🎡 **Roleta animada** (canvas) com todos os vencedores de Melhor Filme
- ⭐ **Top 100 IMDb** com nota, ano e busca por título/ano
- 🏆 Selo indicando quais filmes do Top 100 também ganharam o Oscar de Melhor Filme
- 📱 Layout responsivo, sem dependências externas — um único `index.html`

## Hospedagem

O deploy é feito automaticamente no **GitHub Pages** via GitHub Actions (`.github/workflows/deploy-pages.yml`) a cada push.

URL do site: `https://pietrouww.github.io/roleta-oscar/`

---

## Outros projetos neste repositório

- [`i2brothers/`](i2brothers/) — **Catálogo de iPhones da i2Brothers (Assistência Apple)**:
  catálogo público de aparelhos novos e seminovos, com fotos reais dos modelos,
  simulador de parcelamento e área administrativa para atualizar a lista.
  Publicado em `https://pietrouww.github.io/roleta-oscar/i2brothers/`.
