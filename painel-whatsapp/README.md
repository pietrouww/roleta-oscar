# Painel de Pendências – WhatsApp + Chatwoot

App para iPhone (PWA) que mostra **quais clientes estão esperando retorno** da equipe nos números de WhatsApp conectados ao Chatwoot.

- **Pediu atendente**: o cliente pediu para falar com uma pessoa ("quero falar com um atendente", "isso é um robô?", "tem alguém aí?") e nenhum humano respondeu depois.
- **Retorno prometido**: alguém da equipe escreveu "vou verificar", "estamos verificando", "já te retorno", "assim que eu tiver te aviso", "um momento"... e não voltou a escrever.
- **Sem resposta**: o cliente mandou a última mensagem (que não seja só "ok", "obrigado" ou 👍) e ninguém respondeu, nem a IA.
- **Selo IA**: a conversa teve respostas da inteligência artificial. Uma resposta da IA conta como respondida, **a não ser** que o cliente peça um atendente.

Verificações automáticas às **08:30, 12:00 e 17:00, de segunda a sábado**. O resultado de cada uma fica guardado com o histórico por dia, e a equipe recebe um alerta no celular. Também chega um **alerta na hora** quando alguém pede atendente e quando um retorno prometido passa de 2 horas sem resposta.

As conversas pendentes também ganham **etiquetas no próprio Chatwoot** (`pediu-atendente`, `retorno-prometido`, `pendente-resposta`), que saem sozinhas quando a conversa é respondida.

Os atendentes entram no painel com o **mesmo e-mail e senha do Chatwoot**.

Os números de WhatsApp são conectados **por QR Code direto no app** (*Ajustes → Números de WhatsApp*), usando a **Evolution API**, que já vem no `docker-compose.yml`. Cada número vira uma caixa de entrada no Chatwoot, e as respostas saem para o cliente com o nome do atendente.

> ⚠️ A conexão por QR Code **não é a API oficial** do WhatsApp. Funciona como o WhatsApp Web e pode levar a bloqueio do número, principalmente se mandar muitas mensagens para quem não tem seu contato. Use para atendimento (responder quem te chama), evite disparos em massa, e **não conecte por QR o número verificado com IA da Meta**.

---

## 1. Testar no computador (sem Chatwoot)

```bash
npm install
npm run demo          # abre em http://localhost:3100 com conversas fictícias
```

Qualquer e-mail e senha entram no modo demonstração.

## 2. Instalar no VPS da Hostinger

Pré-requisito: VPS (KVM 2 ou maior, 8 GB de RAM) com o Chatwoot já rodando, por exemplo com o modelo **"Ubuntu 24.04 with Chatwoot"**. Esse modelo deixa o Chatwoot em `/root/chatwoot`.

**Antes de começar, no Chatwoot:**
1. Crie sua conta de administrador e entre.
2. Em *Configurações → Agentes*, crie um usuário **"Celular"** com papel **Administrador** (pode usar um e-mail seu com `+celular`, ex.: `voce+celular@gmail.com`). Entre com ele uma vez e copie o **Token de acesso** (foto → *Configurações do perfil*). Mensagens enviadas direto pelo celular vão aparecer com o nome "Celular".
3. Copie também o token do **seu** usuário administrador.

### 2.1 Copiar o projeto para o servidor

No painel da Hostinger, abra o **Terminal do navegador** do VPS (ou use SSH) e rode:

```bash
cd /opt
git clone -b claude/dreamy-ramanujan-6uzw0g https://github.com/pietrouww/roleta-oscar.git painel-src
cp -r painel-src/painel-whatsapp /opt/painel-whatsapp
cd /opt/painel-whatsapp
cp .env.example .env
nano .env
```

> Se o repositório for privado, o `git clone` vai pedir usuário e um *token* do GitHub (não a senha). Outra opção é baixar o ZIP do projeto no GitHub e enviar pelo gerenciador de arquivos.

### 2.2 Preencher o `.env`

| Campo | Onde pegar |
|---|---|
| `CHATWOOT_URL` / `CHATWOOT_PUBLIC_URL` | Endereço do seu Chatwoot (ex.: `https://atendimento.suaempresa.com.br`) |
| `CHATWOOT_ACCOUNT_ID` | Número que aparece na URL do Chatwoot: `.../app/accounts/`**`1`**`/...` |
| `CHATWOOT_API_TOKEN` | Token do **seu** usuário administrador (foto → *Configurações do perfil* → *Token de acesso*) |
| `CHATWOOT_TOKEN_CELULAR` | Token do usuário **"Celular"** criado acima |
| `EVOLUTION_API_KEY` | Rode `openssl rand -hex 24` e cole o resultado |
| `EVOLUTION_DB_PASSWORD` | Rode `openssl rand -hex 16` e cole o resultado |
| `EVOLUTION_PUBLIC_URL` / `EVOLUTION_DOMINIO` | Subdomínio da Evolution, ex.: `https://evolution.suaempresa.com.br` / `evolution.suaempresa.com.br` |
| `SESSION_SECRET` | Rode `openssl rand -hex 32` e cole o resultado |
| `VAPID_SUBJECT` | `mailto:` + um e-mail seu (usado pelas notificações) |
| `PAINEL_DOMINIO` | Subdomínio do painel, ex.: `painel.suaempresa.com.br` |

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

### 2.3 Apontar o subdomínio

No DNS do seu domínio (na Hostinger: *Domínios → DNS*), crie dois registros **A** apontando para o **IP do VPS**:

| Nome | Para quê |
|---|---|
| `painel` | O app dos atendentes |
| `evolution` | A Evolution API (o Chatwoot usa esse endereço para mandar as respostas ao WhatsApp) |

### 2.4 Subir o painel e a Evolution API

As notificações do iPhone **exigem HTTPS**. Antes, veja se as portas 80/443 já estão em uso (o Chatwoot pode já ter um proxy):

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

**A) Portas 80/443 livres.** Use o Caddy incluído, que gera o certificado HTTPS sozinho:

```bash
docker compose --profile https up -d --build
```

**B) Portas já usadas por um Nginx no servidor.** Suba sem o Caddy e acrescente dois sites no Nginx:

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

```nginx
server {
    server_name evolution.suaempresa.com.br;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois rode `sudo certbot --nginx -d painel.suaempresa.com.br -d evolution.suaempresa.com.br` para o HTTPS.

**C) Portas usadas pelo Traefik ou por outro proxy em Docker.** Suba com `docker compose up -d --build` e crie no proxy existente duas rotas: `painel.…` → `http://127.0.0.1:3100` e `evolution.…` → `http://127.0.0.1:8080`.

Conferir se está no ar:

```bash
docker compose logs -f painel      # deve mostrar "Painel de pendências rodando na porta 3100"
curl http://127.0.0.1:3100/health  # {"ok":true,...}
docker compose logs -f evolution   # a Evolution API deve subir sem erros de banco
curl https://evolution.suaempresa.com.br   # deve responder (mensagem de boas-vindas da Evolution)
```

### 2.5 Criar as etiquetas no Chatwoot

Em *Configurações → Etiquetas*, crie `pediu-atendente` (vermelho), `retorno-prometido` (laranja) e `pendente-resposta` (amarelo). Para não usar etiquetas, defina `LABELS_SYNC=false`.

### 2.6 Instalar no iPhone de cada atendente

1. Abra `https://painel.suaempresa.com.br` no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra pelo ícone, entre com o login do Chatwoot.
4. Vá em **Ajustes → Ativar notificações** e toque em **Enviar teste**.

> As notificações no iPhone precisam do iOS 16.4 ou mais novo e do app aberto pelo ícone da Tela de Início.

### 2.7 Conectar os números por QR Code

1. Num computador ou outro celular, abra o painel e entre com um usuário **administrador** do Chatwoot.
2. Vá em **Ajustes → Números de WhatsApp → Conectar novo número** e dê um nome (ex.: `Comercial`).
3. Aparece o QR Code. No celular do número: **WhatsApp Business → Configurações → Aparelhos conectados → Conectar um aparelho** e aponte para o código.
   - Se o painel estiver aberto no **mesmo celular** do número, use *Conectar com número de telefone*: o painel mostra um código de 8 letras para digitar no WhatsApp.
4. Em alguns segundos aparece **"Número conectado!"**. No Chatwoot surge uma caixa de entrada com o mesmo nome.
5. Repita para o segundo número.
6. No Chatwoot, em *Configurações → Caixas de entrada → (a caixa nova) → Colaboradores*, adicione os atendentes que vão responder por ela.

O celular continua funcionando normalmente. Ele só precisa entrar na internet de vez em quando (pelo menos a cada 14 dias) para a conexão não cair.

## 3. Nome do atendente na mensagem para o cliente

Com a conexão por QR Code isso **já é automático**: quando a Ana responde pelo Chatwoot, o cliente recebe

```
*Ana Souza:*
Bom dia! Temos sim.
```

Não ative também a "Assinatura de mensagem" do Chatwoot, senão o nome sai duas vezes. Se um dia migrar para a API oficial, aí sim use a assinatura do Chatwoot (foto → *Configurações do perfil* → **Assinatura de mensagem**).

## 4. Selo IA e números com IA da Meta

- Nos números conectados por QR Code, o que alguém mandar **direto pelo celular** aparece no Chatwoot como enviado pelo usuário **"Celular"** e conta como resposta humana.

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
- **"Evolution API não configurada"**: falta `EVOLUTION_API_KEY` no `.env`.
- **QR Code não aparece ou não conecta**: veja `docker compose logs evolution`. O WhatsApp muda com frequência; atualize a versão da imagem `evoapicloud/evolution-api` no `docker-compose.yml` para a mais recente e rode `docker compose up -d`.
- **Mensagens do cliente não chegam no Chatwoot**: confira `CHATWOOT_TOKEN_CELULAR`, `CHATWOOT_ACCOUNT_ID` e se a Evolution consegue abrir o endereço do Chatwoot (`docker compose exec evolution wget -qO- $CHATWOOT_URL`).
- **Respostas do Chatwoot não chegam no cliente**: o Chatwoot precisa abrir `EVOLUTION_PUBLIC_URL`. Teste no navegador `https://evolution.suaempresa.com.br`.
- **Número desconectou sozinho**: em *Ajustes → Números de WhatsApp*, toque em **Conectar** e leia o QR Code de novo.

## Estrutura

```
src/classifier.js   regras de pendência (frases de promessa e de pedido de atendente)
src/chatwoot.js     comunicação com a API do Chatwoot
src/pendencias.js   varredura das conversas abertas, cache e etiquetas
src/scheduler.js    verificações 08:30/12:00/17:00 e alertas imediatos
src/push.js         notificações no celular
src/evolution.js    conexão dos números por QR Code (Evolution API)
public/             app (PWA) que roda no iPhone
test/               testes (npm test)
```
