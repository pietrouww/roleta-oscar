# Publicar em rfserver.link (Hostinger)

O site é estático: nenhum banco de dados, nenhum PHP. Basta copiar a pasta
`venda_aparelhos/` para dentro de `public_html/`.

Resultado:

| Endereço | O que é |
|---|---|
| `https://rfserver.link/venda_aparelhos/` | Catálogo — é o que vai para o cliente |
| `https://rfserver.link/venda_aparelhos/config/` | Configuração — onde se cola a lista em texto |

## Gerar o pacote

```bash
./ferramentas/publicar.sh
```

Isso cria `publicar/venda_aparelhos/` e `publicar/venda_aparelhos.zip`.
Para publicar com outro nome de pasta: `./ferramentas/publicar.sh loja`.

## Subir pelo Gerenciador de Arquivos (mais direto)

1. hPanel → **Sites** → rfserver.link → **Gerenciador de Arquivos**.
2. Entre em **public_html**.
3. Botão **Enviar arquivos** → envie `venda_aparelhos.zip`.
4. Clique com o botão direito no zip → **Extrair** → confirme em `public_html`.
5. Apague o `.zip`.
6. Abra `https://rfserver.link/venda_aparelhos/`.

## Subir por FTP

Dados em hPanel → **Arquivos** → **Contas FTP**. No FileZilla, conecte e
arraste a pasta `publicar/venda_aparelhos` inteira para dentro de `public_html`.

## Atualizar a lista do dia

1. Abra `https://rfserver.link/venda_aparelhos/config/`.
2. Aba **Importar lista**, cole a lista, processe e confirme.
3. Aba **Publicar** → **Baixar catalogo.json**.
4. No Gerenciador de Arquivos, entre em `public_html/venda_aparelhos/` e
   **substitua** o `catalogo.json` pelo arquivo baixado.

Só esse arquivo muda no dia a dia — o resto fica parado.

## Publicar pelo Git (opcional, para não subir arquivo na mão)

hPanel → **Avançado** → **Git**:

- Repositório: `https://github.com/pietrouww/roleta-oscar.git`
- Branch: `claude/iphone-sales-catalog-i2brothers-8mlgtq`
- Diretório: `public_html/repo`

Depois é só apontar `public_html/venda_aparelhos` para `public_html/repo/i2brothers`
(link simbólico) ou copiar a pasta após cada **Deploy**. Nesse caminho, o
`catalogo.json` publicado passa a vir do repositório.

## Sobre o acesso à configuração

O catálogo é aberto: o cliente entra e navega, sem senha. A senha vale só para
`/venda_aparelhos/config/`, e **o catálogo não tem link para lá** — só chega
quem souber o endereço.

A senha é guardada como resumo SHA-256 dentro do `catalogo.json`, nunca em
texto. Isso importa porque esse arquivo fica público na hospedagem: se a senha
estivesse em texto, bastaria abrir
`rfserver.link/venda_aparelhos/catalogo.json` para lê-la.

Ainda assim, é uma tranca de tela — não há servidor conferindo nada. **Para
proteção de verdade**, ative em hPanel → **Avançado** → **Proteção de
diretório**, apontando para `public_html/venda_aparelhos/config`. Aí o próprio
servidor pede usuário e senha antes de a página carregar.

Para trocar a senha depois: aba **Preços e taxas** → *Trocar a senha desta
página* → digite a nova → publique o `catalogo.json`. Renomear a pasta `config`
para algo menos óbvio também ajuda: basta trocar o nome na hospedagem.
