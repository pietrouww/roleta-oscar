import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, validateConfig } from './config.js';
import { ChatwootClient, toDisplayMessages, acharAnexo, tipoMidia } from './chatwoot.js';
import { Analisador } from './ia.js';
import { Midia } from './midia.js';
import { DemoChatwootClient, DemoEvolutionClient, DemoAnalisador, prepararMidiaDemo } from './demo.js';
import { EvolutionClient, slug } from './evolution.js';
import { PendenciasEngine } from './pendencias.js';
import { Store } from './store.js';
import { PushService } from './push.js';
import { Scheduler } from './scheduler.js';
import { createAuth } from './auth.js';
import { zonedParts } from './time.js';
import { prepararChatwoot } from './setup.js';

const problems = validateConfig();
if (problems.length) {
  console.error('Configuração incompleta:\n - ' + problems.join('\n - '));
  console.error('Copie .env.example para .env e preencha. Para testar sem Chatwoot use DEMO=true.');
  process.exit(1);
}

const store = new Store(config.dataDir);
const demoMidiaUrl = `http://127.0.0.1:${config.port}/demo-midia`;
const client = config.demo ? new DemoChatwootClient({ midiaUrl: demoMidiaUrl }) : new ChatwootClient(config.chatwoot);
const ia = config.demo
  ? new DemoAnalisador()
  : new Analisador({ apiKey: config.ia.apiKey, model: config.ia.model, effort: config.ia.effort, timeZone: config.timezone, store });
const engine = new PendenciasEngine({ client, config, ia, marcas: store, ignorados: () => store.ignoredIds() });
const hostDe = (u) => { try { return new URL(u).host; } catch { return ''; } };
const midia = new Midia({
  dir: config.dataDir,
  hostsPermitidos: config.demo ? [hostDe(demoMidiaUrl)] : [hostDe(config.chatwoot.url), hostDe(config.chatwoot.publicUrl)],
});
const evolution = config.demo
  ? new DemoEvolutionClient()
  : new EvolutionClient({
      url: config.evolution.url,
      apiKey: config.evolution.apiKey,
      chatwoot: { url: config.evolution.chatwootUrl, accountId: config.chatwoot.accountId, token: config.evolution.chatwootToken },
    });
const push = new PushService({ store, config });
const scheduler = new Scheduler({ engine, store, push, config });
const auth = createAuth({ secret: config.sessionSecret, secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : !config.demo });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => {
  // Telas e scripts sempre conferem se há versão nova (atualizações aparecem na hora no iPhone)
  if (/\.(html|js|css|webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
} }));

if (config.demo) app.use('/demo-midia', express.static(prepararMidiaDemo(config.dataDir)));

app.get('/health', (req, res) => res.json({ ok: true, demo: config.demo }));

// ---- Login (mesmo e-mail e senha do Chatwoot) ----
const attempts = new Map();
app.post('/api/login', async (req, res) => {
  const ip = req.ip || 'x';
  const a = attempts.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - a.at > 15 * 60000) Object.assign(a, { n: 0, at: Date.now() });
  if (a.n >= 10) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha' });
  try {
    const user = await client.signIn(String(email).trim(), String(senha));
    if (!user) {
      a.n++;
      attempts.set(ip, a);
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }
    attempts.delete(ip);
    auth.issue(res, user);
    res.json({ usuario: { name: user.name, email: user.email } });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(502).json({ erro: 'Não foi possível falar com o Chatwoot' });
  }
});

app.post('/api/logout', (req, res) => {
  auth.clear(res);
  res.json({ ok: true });
});

app.get('/api/me', auth.require, (req, res) => {
  res.json({
    usuario: { id: req.user.id, name: req.user.name, email: req.user.email, admin: req.user.role === 'administrator', podeResponder: !!req.user.token },
    ia: ia.status(),
    demo: config.demo,
    horarios: config.checks.times,
    qrcode: evolution.configured,
  });
});

// ---- Pendências agora ----
app.get('/api/pendencias', auth.require, async (req, res) => {
  try {
    const fresh = req.query.atualizar === '1';
    res.json(await (fresh ? engine.scan() : engine.get(60000)));
  } catch (err) {
    console.error('[pendencias]', err.message);
    res.status(502).json({ erro: 'Falha ao consultar o Chatwoot' });
  }
});

app.post('/api/conversas/:id/resolver', auth.require, async (req, res) => {
  try {
    await engine.resolve(Number(req.params.id));
    listaCache.clear();
    res.json({ ok: true });
  } catch (err) {
    console.error('[resolver]', err.message);
    res.status(502).json({ erro: 'Não foi possível marcar como resolvida' });
  }
});

// ---- Módulo Conversas: acompanhar tudo, ver mídias e responder ----
const listaCache = new Map(); // status -> { at, dados }
async function listarConversas(status) {
  const c = listaCache.get(status);
  if (c && Date.now() - c.at < 8000) return c.dados;
  const inboxes = await engine.loadInboxes();
  const porId = new Map(inboxes.map((i) => [i.id, i]));
  const paginas = status === 'resolved' ? 2 : 40;
  let convs = await client.listConversations(status, paginas);
  if (status === 'open') convs = [...convs, ...(await client.listConversations('pending', 4))];
  const dados = convs
    .filter((x) => porId.has(x.inboxId))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((x) => {
      const i = porId.get(x.inboxId);
      return {
        id: x.id, status: x.status, contactId: x.contactId, contactName: x.contactName, contactPhone: x.contactPhone,
        assigneeName: x.assigneeName, assigneeId: x.assigneeId, unread: x.unread, preview: x.preview, lastActivityAt: x.lastActivityAt,
        inbox: { id: i.id, name: i.name, color: i.color },
      };
    });
  listaCache.set(status, { at: Date.now(), dados });
  return dados;
}

const falhaChatwoot = (res, err, msg = 'Falha ao consultar o Chatwoot') => {
  console.error('[conversas]', err.message);
  res.status(502).json({ erro: msg });
};
const idConv = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ erro: 'Conversa inválida' }); return null; }
  return id;
};
const pendenciaDe = (id) => {
  const r = engine.last;
  if (!r) return null;
  return r.items.find((i) => i.id === id) || (r.adiadas || []).find((i) => i.id === id) || null;
};

app.get('/api/conversas', auth.require, async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  try {
    const [conversas, pend] = await Promise.all([listarConversas(status), engine.get(60000).catch(() => null)]);
    const pendentes = new Map((pend?.items || []).map((i) => [i.id, i]));
    const adiadas = new Set((pend?.adiadas || []).map((i) => i.id));
    res.json({
      conversas: conversas.map((c) => {
        const p = pendentes.get(c.id);
        return { ...c, pendente: p ? { tipo: p.primary, urgencia: p.urgencia, minutos: p.waitingMinutes } : null, adiada: adiadas.has(c.id) };
      }),
      inboxes: pend?.inboxes || [],
    });
  } catch (err) {
    falhaChatwoot(res, err);
  }
});

const brutoCache = new Map(); // conversaId -> { at, raw }
async function mensagensBrutas(id, max = 80, frescas = false) {
  const c = brutoCache.get(id);
  if (!frescas && c && c.max >= max && Date.now() - c.at < 60000) return c.raw;
  const raw = await client.listMessages(id, max);
  brutoCache.set(id, { at: Date.now(), raw, max });
  if (brutoCache.size > 200) brutoCache.delete(brutoCache.keys().next().value);
  return raw;
}

app.get('/api/conversas/:id', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const max = Math.min(400, Math.max(40, Number(req.query.max) || 80));
  try {
    const raw = await mensagensBrutas(id, max, true);
    await engine.get(60000).catch(() => null); // reanalisa se houve ação ou resposta recente
    if (req.user.token) client.markRead(id, req.user.token).catch(() => {});
    res.json({
      mensagens: toDisplayMessages(raw, config.rules, id),
      temMais: raw.length >= max,
      pendencia: pendenciaDe(id),
      marca: store.getMarks()[id] || {},
      url: config.chatwoot.publicUrl ? `${config.chatwoot.publicUrl}/app/accounts/${config.chatwoot.accountId}/conversations/${id}` : '',
    });
  } catch (err) {
    falhaChatwoot(res, err);
  }
});

app.post('/api/conversas/:id/mensagens', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'Escreva a mensagem' });
  if (texto.length > 4000) return res.status(400).json({ erro: 'Mensagem longa demais' });
  if (!req.user.token) return res.status(409).json({ erro: 'Saia e entre de novo no painel para poder responder por aqui.' });
  try {
    await client.sendMessage(id, texto, req.user.token);
    brutoCache.delete(id);
    listaCache.clear();
    engine.cache.delete(id);
    engine.invalidate();
    res.json({ ok: true });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível enviar. Confira se você é colaborador desta caixa de entrada no Chatwoot.');
  }
});

app.post('/api/conversas/:id/assumir', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  try {
    await client.assign(id, req.user.id);
    listaCache.clear();
    engine.invalidate();
    res.json({ ok: true });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível assumir a conversa');
  }
});

app.post('/api/conversas/:id/reabrir', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  try {
    await client.reopen(id);
    listaCache.clear();
    engine.invalidate();
    res.json({ ok: true });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível reabrir');
  }
});

// Marcações da equipe: marcar pendência, concluir, adiar e "não é pendência"
app.post('/api/conversas/:id/marcar', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  store.setMark(id, 'manual', { nota: String(req.body?.nota || '').trim().slice(0, 300), por: req.user.name, em: Date.now() });
  store.setMark(id, 'dispensa', null);
  engine.invalidate();
  res.json({ ok: true });
});

app.post('/api/conversas/:id/concluir', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  store.setMark(id, 'manual', null);
  store.setMark(id, 'adiar', null);
  engine.invalidate();
  res.json({ ok: true });
});

app.post('/api/conversas/:id/adiar', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const minutos = Number(req.body?.minutos);
  if (minutos === 0) {
    store.setMark(id, 'adiar', null);
  } else {
    if (!Number.isFinite(minutos) || minutos < 5 || minutos > 7 * 1440) return res.status(400).json({ erro: 'Tempo inválido' });
    store.setMark(id, 'adiar', { ate: Date.now() + minutos * 60000, por: req.user.name });
  }
  engine.invalidate();
  res.json({ ok: true });
});

app.post('/api/conversas/:id/dispensar', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const p = pendenciaDe(id);
  if (!p) return res.status(404).json({ erro: 'Esta conversa não está pendente' });
  store.setMark(id, 'dispensa', { ultimaMsg: p.ultimaMsg, por: req.user.name, em: Date.now() });
  store.setMark(id, 'manual', null);
  store.setMark(id, 'adiar', null);
  engine.invalidate();
  res.json({ ok: true });
});

// Áudios, fotos, vídeos e arquivos das conversas
app.get('/api/midia/:id/:msg/:anexo', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  try {
    let anexo = acharAnexo(await mensagensBrutas(id, 80), req.params.msg, req.params.anexo);
    if (!anexo) anexo = acharAnexo(await mensagensBrutas(id, 400, true), req.params.msg, req.params.anexo);
    if (!anexo?.data_url) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const { arquivo, tipo } = await midia.obter(anexo, tipoMidia(anexo));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Só mídia conhecida abre no navegador; o resto baixa (evita abrir HTML vindo de fora)
    if (!/^(audio|video|image)\/|^application\/pdf$/.test(tipo) || tipo === 'image/svg+xml') res.setHeader('Content-Disposition', 'attachment');
    res.type(tipo).sendFile(arquivo);
  } catch (err) {
    console.error('[midia]', err.message);
    res.status(502).json({ erro: 'Não foi possível abrir o arquivo' });
  }
});

// ---- Indicadores para o módulo de análise ----
app.get('/api/indicadores', auth.require, async (req, res) => {
  try {
    const agora = await engine.get(60000);
    const hoje = zonedParts(new Date(), config.timezone).date;
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${hoje}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const data = d.toISOString().slice(0, 10);
      const verificacoes = store.listChecks(data).map((t) => ({ hora: t, total: store.getCheck(data, t)?.totals?.total ?? 0 }));
      dias.push({ data, verificacoes });
    }
    res.json({ totals: agora.totals, adiadas: (agora.adiadas || []).length, ignoradas: agora.ignoredConversations, abertas: agora.openConversations, dias, ia: agora.ia });
  } catch (err) {
    falhaChatwoot(res, err);
  }
});

// ---- Contatos ignorados (fornecedores, cotações diárias...) ----
app.get('/api/ignorados', auth.require, (req, res) => res.json({ ignorados: store.listIgnored() }));

app.post('/api/ignorados', auth.require, (req, res) => {
  const { contactId, nome, telefone } = req.body || {};
  if (contactId == null || !/^\d+$/.test(String(contactId))) return res.status(400).json({ erro: 'Contato inválido' });
  store.addIgnored({
    contactId: String(contactId),
    nome: String(nome || '').slice(0, 120),
    telefone: String(telefone || '').slice(0, 40),
    por: req.user.name,
    em: new Date().toISOString(),
  });
  engine.invalidate(); // próxima consulta já sai sem ele
  res.json({ ok: true });
});

app.delete('/api/ignorados/:contactId', auth.require, (req, res) => {
  store.removeIgnored(req.params.contactId);
  engine.invalidate();
  res.json({ ok: true });
});

// ---- Verificações agendadas ----
app.get('/api/verificacoes', auth.require, (req, res) => {
  const today = zonedParts(new Date(), config.timezone).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : today;
  res.json({ data: date, hoje: today, horarios: scheduler.checksForDate(date) });
});

app.get('/api/verificacoes/:data/:hora', auth.require, (req, res) => {
  const { data, hora } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:?\d{2}$/.test(hora)) return res.status(400).json({ erro: 'Data/hora inválida' });
  const t = hora.includes(':') ? hora : `${hora.slice(0, 2)}:${hora.slice(2)}`;
  const snap = store.getCheck(data, t);
  if (!snap) return res.status(404).json({ erro: 'Verificação não encontrada' });
  res.json(snap);
});

// ---- Notificações ----
app.get('/api/push/chave', auth.require, (req, res) => res.json({ chave: push.publicKey }));
app.post('/api/push/inscrever', auth.require, (req, res) => {
  try {
    push.subscribe(req.body, req.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});
app.post('/api/push/teste', auth.require, async (req, res) => {
  const n = await push.sendAll(
    { title: 'Notificações ativadas', body: `Olá, ${req.user.name}! Você vai receber os alertas de pendências.`, url: '/' },
    (s) => s.user.id === req.user.id,
  );
  res.json({ enviados: n });
});

// ---- Números de WhatsApp por QR Code (Evolution API) — só administradores ----
const semEvolution = (res) => res.status(503).json({ erro: 'Evolution API não configurada (EVOLUTION_API_KEY no .env)' });
const nomeValido = (n) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(n);
const erroEvolution = (res, err) => {
  console.error('[evolution]', err.message);
  res.status(502).json({ erro: 'Não foi possível falar com a Evolution API' });
};

app.get('/api/conexoes', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  try {
    res.json({ conexoes: await evolution.list() });
  } catch (err) {
    erroEvolution(res, err);
  }
});

app.post('/api/conexoes', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  const titulo = String(req.body?.nome || '').trim().slice(0, 40);
  const nome = slug(titulo);
  if (!titulo || !nomeValido(nome)) return res.status(400).json({ erro: 'Dê um nome ao número, ex.: Comercial' });
  try {
    const existentes = await evolution.list();
    if (existentes.some((c) => c.nome === nome)) return res.status(409).json({ erro: 'Já existe um número com esse nome' });
    await evolution.create(nome);
    await evolution.setChatwoot(nome, titulo);
    engine.inboxesAt = 0; // a caixa nova no Chatwoot aparece na próxima varredura
    res.json({ nome });
  } catch (err) {
    erroEvolution(res, err);
  }
});

app.get('/api/conexoes/:nome/qr', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  if (!nomeValido(req.params.nome)) return res.status(400).json({ erro: 'Nome inválido' });
  const numero = String(req.query.numero || '').replace(/\D/g, '');
  try {
    res.json(await evolution.connect(req.params.nome, numero || undefined));
  } catch (err) {
    erroEvolution(res, err);
  }
});

app.get('/api/conexoes/:nome/estado', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  if (!nomeValido(req.params.nome)) return res.status(400).json({ erro: 'Nome inválido' });
  try {
    res.json({ estado: await evolution.state(req.params.nome) });
  } catch (err) {
    erroEvolution(res, err);
  }
});

app.post('/api/conexoes/:nome/desconectar', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  if (!nomeValido(req.params.nome)) return res.status(400).json({ erro: 'Nome inválido' });
  try {
    await evolution.logout(req.params.nome);
    res.json({ ok: true });
  } catch (err) {
    erroEvolution(res, err);
  }
});

app.delete('/api/conexoes/:nome', auth.requireAdmin, async (req, res) => {
  if (!evolution.configured) return semEvolution(res);
  if (!nomeValido(req.params.nome)) return res.status(400).json({ erro: 'Nome inválido' });
  try {
    await evolution.logout(req.params.nome).catch(() => {});
    await evolution.remove(req.params.nome);
    res.json({ ok: true });
  } catch (err) {
    erroEvolution(res, err);
  }
});

// Só em modo demonstração: dispara uma verificação na hora para ver o resultado
app.post('/api/demo/verificar', auth.require, async (req, res) => {
  if (!config.demo) return res.status(404).end();
  const t = config.checks.times.find((x) => !store.getCheck(zonedParts(new Date(), config.timezone).date, x)) || config.checks.times[0];
  res.json(await scheduler.runCheck(t));
});

app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(config.port, () => {
  console.log(`Painel de pendências rodando na porta ${config.port}${config.demo ? ' (MODO DEMONSTRAÇÃO)' : ''}`);
  scheduler.start();
  midia.limpar();
  setInterval(() => midia.limpar(), 12 * 3600000).unref();
  console.log(ia.ativo ? `[ia] análise inteligente ligada (${ia.model})` : '[ia] sem ANTHROPIC_API_KEY: usando regras por palavra-chave');
  engine.scan().catch((e) => console.error('[inicio] primeira varredura falhou:', e.message));
  if (!config.demo && config.chatwootSetup) {
    prepararChatwoot({ client, config }).catch((e) => console.error('[chatwoot] preparação falhou:', e.message));
  }
});
