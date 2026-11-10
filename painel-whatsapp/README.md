# Painel de Pendências – WhatsApp + Chatwoot

App para iPhone (PWA) que mostra **quais clientes estão esperando retorno** da equipe nos números de WhatsApp conectados ao Chatwoot.

- **Pediu atendente**: o cliente pediu para falar com uma pessoa ("quero falar com um atendente", "isso é um robô?", "tem alguém aí?") e nenhum humano respondeu depois.
- **Retorno prometido**: alguém da equipe escreveu "vou verificar", "estamos verificando", "já te retorno", "assim que eu tiver te aviso", "um momento"... e não voltou a escrever.
- **Sem resposta**: o cliente mandou a última mensagem (que não seja só "ok", "obrigado" ou 👍) e ninguém respondeu, nem a IA.
- **Selo IA**: a conversa teve respostas da inteligência artificial. Uma resposta da IA conta como respondida, **a não ser** que o cliente peça um atendente.

Verificações automáticas às **08:30, 12:00 e 17:00, de segunda a sábado**. O resultado de cada uma fica guardado com o histórico por dia, e a equipe recebe um alerta no celular. Também chega um **alerta na hora** quando alguém pede atendente e quando um retorno prometido passa de 2 horas sem resposta.

As conversas pendentes também ganham **etiquetas no próprio Chatwoot** (`pediu-atendente`, `retorno-prometido`, `pendente-resposta`), que saem sozinhas quando a conversa é respondida.

Os atendentes entram no painel com o **mesmo e-mail e senha do Chatwoot**.

---

## 1. Testar no computador (sem Chatwoot)

```bash
npm install
npm run demo          # abre em http://localhost:3100 com conversas fictícias
```

Qualquer e-mail e senha entram no modo demonstração.

## 2. Instalar no VPS da Hostinger

Pré-requisito: VPS (KVM 2 ou maior) com o Chatwoot já rodando, por exemplo com o modelo **"Ubuntu 24.04 with Chatwoot"**.

### 2.1 Copiar o projeto para o servidor

No painel da Hostinger, abra o **Terminal do navegador** do VPS (ou use SSH) e rode:

```bash
cd /opt
git clone https://github.com/pietrouww/roleta-oscar.git painel-src
cp -r painel-src/painel-whatsapp /opt/painel-whatsapp
cd /opt/painel-whatsapp
cp .env.example .env
nano .env
```

### 2.2 Preencher o `.env`

| Campo | Onde pegar |
|---|---|
| `CHATWOOT_URL` / `CHATWOOT_PUBLIC_URL` | Endereço do seu Chatwoot (ex.: `https://atendimento.suaempresa.com.br`) |
| `CHATWOOT_ACCOUNT_ID` | Número que aparece na URL do Chatwoot: `.../app/accounts/`**`1`**`/...` |
| `CHATWOOT_API_TOKEN` | No Chatwoot, com um usuário **administrador**: foto → *Configurações do perfil* → *Token de acesso* |
| `SESSION_SECRET` | Rode `openssl rand -hex 32` e cole o resultado |
| `VAPID_SUBJECT` | `mailto:` + um e-mail seu (usado pelas notificações) |
| `PAINEL_DOMINIO` | Subdomínio do painel, ex.: `painel.suaempresa.com.br` |

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

### 2.3 Apontar o subdomínio

No DNS do seu domínio (na Hostinger: *Domínios → DNS*), crie um registro **A** com nome `painel` apontando para o **IP do VPS**.

### 2.4 Subir o painel

As notificações do iPhone **exigem HTTPS**. Antes, veja se as portas 80/443 já estão em uso (o Chatwoot pode já ter um proxy):

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

**A) Portas 80/443 livres.** Use o Caddy incluído, que gera o certificado HTTPS sozinho:

```bash
docker compose --profile https up -d --build
```

**B) Portas já usadas por um Nginx no servidor.** Suba só o painel e acrescente um site no Nginx:

```bash
docker compose up -d --build
```

```nginx
server {
    server_name painel.suaempresa.com.br;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois rode `sudo certbot --nginx -d painel.suaempresa.com.br` para o HTTPS.

**C) Portas usadas pelo Traefik ou por outro proxy em Docker.** Suba o painel com `docker compose up -d --build` e crie uma rota no proxy existente para `http://127.0.0.1:3100` (ou para o container `painel-pendencias`, porta 3100).

Conferir se está no ar:

```bash
docker compose logs -f painel      # deve mostrar "Painel de pendências rodando na porta 3100"
curl http://127.0.0.1:3100/health  # {"ok":true,...}
```

### 2.5 Criar as etiquetas no Chatwoot

Em *Configurações → Etiquetas*, crie `pediu-atendente` (vermelho), `retorno-prometido` (laranja) e `pendente-resposta` (amarelo). Para não usar etiquetas, defina `LABELS_SYNC=false`.

### 2.6 Instalar no iPhone de cada atendente

1. Abra `https://painel.suaempresa.com.br` no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra pelo ícone, entre com o login do Chatwoot.
4. Vá em **Ajustes → Ativar notificações** e toque em **Enviar teste**.

> As notificações no iPhone precisam do iOS 16.4 ou mais novo e do app aberto pelo ícone da Tela de Início.

## 3. Nome do atendente na mensagem para o cliente

O painel já mostra quem respondeu. Para o **cliente** também ver o nome, cada atendente configura no Chatwoot: foto → *Configurações do perfil* → **Assinatura de mensagem** (ex.: `*Ana*`), e ativa a assinatura na caixa de resposta.

## 4. Selo IA e números com IA da Meta

- Em `AI_DETECTION=sem_usuario` (padrão), toda resposta que **não** saiu de um atendente do Chatwoot recebe o selo **IA**: a IA da Meta, robôs (Agent Bot) e automações.
- Se a equipe também responder **pelo app do celular** nesse número, essas respostas também ganham o selo IA. Nesse caso use `AI_DETECTION=assinatura` e `AI_SIGNATURE_REGEX` com um trecho que só a IA escreve (ex.: `assistente virtual`). As outras respostas fora do Chatwoot aparecem como **Celular**.
- **Importante:** confirme com a Meta que o número verificado mantém o **selo Meta Verified** e a **IA** ao ser conectado à API em modo coexistência *antes* de conectá-lo.

## 5. Ajustes finos (`.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `CHECK_TIMES` | `08:30,12:00,17:00` | Horários das verificações |
| `CHECK_DAYS` | `1-6` | Dias (1=segunda … 6=sábado) |
| `WAIT_MIN_MINUTES` | `15` | Tempo para "sem resposta" virar pendência |
| `PROMISE_MIN_MINUTES` | `30` | Tempo para "vou verificar" sem retorno virar pendência |
| `PROMISE_ALERT_MINUTES` | `120` | Alerta imediato quando o retorno prometido atrasa |
| `PROMISE_EXTRA_TERMS` | – | Frases extras de promessa, separadas por vírgula (ex.: `vou orçar,te mando o orçamento`) |
| `ATTENDANT_EXTRA_TERMS` | – | Frases extras de pedido de atendente |
| `LIVE_INTERVAL_MINUTES` | `5` | Intervalo dos alertas imediatos |
| `LIVE_ALERT_WINDOW` | `07:00-19:00` | Horário em que os alertas imediatos são enviados |
| `INBOX_IDS` | todas | Monitorar só algumas caixas de entrada |

Depois de mudar o `.env`: `docker compose up -d`.

## 6. Atualizar, backup e problemas comuns

```bash
cd /opt/painel-src && git pull && cp -r painel-whatsapp/. /opt/painel-whatsapp/
cd /opt/painel-whatsapp && docker compose up -d --build
```

- **Backup**: a pasta `data/` guarda o histórico das verificações, as inscrições de notificação e as chaves. Copie essa pasta.
- **"Falha ao consultar o Chatwoot"**: confira `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID` e se o token é de um administrador (`docker compose logs painel`).
- **Login não funciona**: se o usuário usa verificação em duas etapas no Chatwoot, o login direto pode ser recusado.
- **Verificação "não executada"**: o servidor estava desligado no horário.

## Estrutura

```
src/classifier.js   regras de pendência (frases de promessa e de pedido de atendente)
src/chatwoot.js     comunicação com a API do Chatwoot
src/pendencias.js   varredura das conversas abertas, cache e etiquetas
src/scheduler.js    verificações 08:30/12:00/17:00 e alertas imediatos
src/push.js         notificações no celular
public/             app (PWA) que roda no iPhone
test/               testes (npm test)
```
