import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, validateConfig } from './config.js';
import { ChatwootClient } from './chatwoot.js';
import { DemoChatwootClient, DemoEvolutionClient } from './demo.js';
import { EvolutionClient, slug } from './evolution.js';
import { PendenciasEngine } from './pendencias.js';
import { Store } from './store.js';
import { PushService } from './push.js';
import { Scheduler } from './scheduler.js';
import { createAuth } from './auth.js';
import { zonedParts } from './time.js';

const problems = validateConfig();
if (problems.length) {
  console.error('Configuração incompleta:\n - ' + problems.join('\n - '));
  console.error('Copie .env.example para .env e preencha. Para testar sem Chatwoot use DEMO=true.');
  process.exit(1);
}

const store = new Store(config.dataDir);
const client = config.demo ? new DemoChatwootClient() : new ChatwootClient(config.chatwoot);
const engine = new PendenciasEngine({ client, config });
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
  if (p.endsWith('sw.js') || p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
} }));

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
    usuario: { name: req.user.name, email: req.user.email, admin: req.user.role === 'administrator' },
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
    res.json({ ok: true });
  } catch (err) {
    console.error('[resolver]', err.message);
    res.status(502).json({ erro: 'Não foi possível marcar como resolvida' });
  }
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
  engine.scan().catch((e) => console.error('[inicio] primeira varredura falhou:', e.message));
});
