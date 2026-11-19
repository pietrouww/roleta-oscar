import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { config, validateConfig } from './config.js';
import { ChatwootClient, toDisplayMessages, acharAnexo, tipoMidia } from './chatwoot.js';
import { Analisador } from './ia.js';
import { Midia } from './midia.js';
import { DemoChatwootClient, DemoEvolutionClient, DemoAnalisador, prepararMidiaDemo } from './demo.js';
import { EvolutionClient, slug } from './evolution.js';
import { PendenciasEngine, ehSistema } from './pendencias.js';
import { CacheMensagens } from './mensagens.js';
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
const client = config.demo
  ? new DemoChatwootClient({ midiaUrl: demoMidiaUrl, midiaDir: path.join(config.dataDir, 'demo-midia') })
  : new ChatwootClient(config.chatwoot);
const ia = config.demo
  ? new DemoAnalisador()
  : new Analisador({ apiKey: config.ia.apiKey, geminiKey: config.ia.geminiKey, provedor: config.ia.provedor, model: config.ia.model, effort: config.ia.effort, timeZone: config.timezone, store });
const msgs = new CacheMensagens(client);
const engine = new PendenciasEngine({ client, config, ia, marcas: store, ignorados: () => store.ignoredIds(), mensagens: msgs });
if (!config.demo) ia.ehAuto = engine.matchers.isAutoReply;
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
// Respostas compactadas (listas e mensagens chegam mais rápido no celular); mídia já é compactada
app.use(compression({ threshold: 1024, filter: (req, res) => !req.path.startsWith('/api/midia') && compression.filter(req, res) }));
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
    // Guarda também no servidor o token do atendente, para responder pelo painel com o nome dele
    if (user.token) {
      const tokens = store.read('tokens.json', {});
      tokens[user.id] = user.token;
      store.write('tokens.json', tokens, 0o600);
    }
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
    usuario: { id: req.user.id, name: req.user.name, email: req.user.email, admin: req.user.role === 'administrator', podeResponder: !!tokenDe(req) },
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
    res.json(await (fresh ? engine.scan() : engine.rapido(60000)));
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

// Token do atendente no Chatwoot: do login atual (cookie cifrado) ou guardado no servidor em logins anteriores
function tokenDe(req) {
  return req.user.token || store.read('tokens.json', {})[req.user.id] || '';
}

// ---- Módulo Conversas: acompanhar tudo, ver mídias e responder ----
const listaCache = new Map(); // status -> { at, dados }
async function listarConversas(status) {
  const c = listaCache.get(status);
  if (c && Date.now() - c.at < 8000) return c.dados;
  const inboxes = await engine.loadInboxes();
  const porId = new Map(inboxes.map((i) => [i.id, i]));
  const paginas = status === 'resolved' ? 2 : 40;
  const [principais, emEspera] = await Promise.all([
    client.listConversations(status, paginas),
    status === 'open' ? client.listConversations('pending', 4) : [],
  ]);
  const convs = [...principais, ...emEspera];
  const dados = convs
    .filter((x) => porId.has(x.inboxId) && !ehSistema(x))
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

const MAX_FIXADAS = 6;
const lerFixadas = () => store.read('fixadas.json', []).filter(Number.isInteger);

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
    const [conversas, pend] = await Promise.all([listarConversas(status), engine.rapido(60000).catch(() => engine.last)]);
    let fixadas = lerFixadas();
    if (status === 'open') {
      // Conversa fixada que foi resolvida libera a vaga
      const abertas = new Set(conversas.map((c) => c.id));
      const vivas = fixadas.filter((id) => abertas.has(id));
      if (vivas.length !== fixadas.length) store.write('fixadas.json', (fixadas = vivas));
    }
    const pendentes = new Map((pend?.items || []).map((i) => [i.id, i]));
    const adiadas = new Set((pend?.adiadas || []).map((i) => i.id));
    res.json({
      conversas: conversas.map((c) => {
        const p = pendentes.get(c.id);
        return {
          ...c,
          pendente: p ? { tipo: p.primary, urgencia: p.urgencia, minutos: p.waitingMinutes, viaIa: p.flags.some((f) => f.viaIa && f.type === 'pediu_atendente') } : null,
          // A IA de atendimento participou desta conversa: quem respondeu por último e se ela chamou a equipe
          atendimento: pend?.quem?.[c.id] || null,
          adiada: adiadas.has(c.id),
          fixada: fixadas.includes(c.id),
          continuouEm: pend?.continuadas?.[c.id] || null,
        };
      }).sort((a, b) => Number(b.fixada) - Number(a.fixada)), // fixadas no topo; o resto segue por mais recente
      maxFixadas: MAX_FIXADAS,
      inboxes: pend?.inboxes || [],
    });
  } catch (err) {
    falhaChatwoot(res, err);
  }
});

const lidas = new Map(); // "usuario:conversa" -> id da última mensagem já marcada como lida

// Mensagens brutas: usa o que o painel já leu (ex.: para servir uma mídia) ou busca só o que falta
async function mensagensBrutas(id, max = 80, frescas = false) {
  const c = msgs.guardado(id);
  if (!frescas && c && (c.completo || c.raw.length >= max)) return c.raw;
  return msgs.obter(id, { max });
}

app.get('/api/conversas/:id', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const max = Math.min(400, Math.max(40, Number(req.query.max) || 80));
  try {
    // Uma chamada ao Chatwoot (a página mais recente) e o resto vem do que já estava lido
    const [{ raw, completo }] = await Promise.all([
      msgs.obterDetalhe(id, { max }),
      engine.rapido(60000).catch(() => null), // só espera se houve ação ou resposta agora há pouco
    ]);
    // Marca como lida só quando há mensagem nova (a tela consulta a cada poucos segundos)
    const ultimaId = raw.length ? raw[raw.length - 1].id : 0;
    const chaveLida = `${req.user.id}:${id}`;
    if (tokenDe(req) && lidas.get(chaveLida) !== ultimaId) {
      lidas.set(chaveLida, ultimaId);
      if (lidas.size > 2000) lidas.delete(lidas.keys().next().value);
      client.markRead(id, tokenDe(req)).catch(() => lidas.delete(chaveLida));
    }
    res.json({
      mensagens: toDisplayMessages(raw.slice(-max), config.rules, id, engine.matchers.isAutoReply),
      temMais: !completo || raw.length > max,
      pendencia: pendenciaDe(id),
      continuouEm: engine.last?.continuadas?.[id] || null,
      atendimento: engine.last?.quem?.[id] || null,
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
  const token = tokenDe(req);
  if (!token) return res.status(409).json({ erro: 'Para responder por aqui, saia do painel (Ajustes → Sair) e entre de novo uma vez.' });
  try {
    await client.sendMessage(id, texto, token, { nota: req.body?.nota === true });
    listaCache.clear();
    engine.cache.delete(id);
    engine.invalidate();
    res.json({ ok: true });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível enviar. Confira se você é colaborador desta caixa de entrada no Chatwoot.');
  }
});

// ---- Enviar foto, vídeo, arquivo ou áudio gravado ----
// O arquivo sobe em partes pequenas (passa por qualquer limite de tamanho do proxy) e, na última
// chamada, é montado, preparado (áudio gravado vira mp3) e entregue ao Chatwoot em nome do atendente.
const MAX_ENVIO = 40 * 1024 * 1024; // limite de anexo do Chatwoot
const MAX_PARTE = 800 * 1024;
const envios = new Map(); // "usuario:conversa:envio" -> { partes, bytes, at }
setInterval(() => {
  for (const [k, e] of envios) if (Date.now() - e.at > 15 * 60000) envios.delete(k);
}, 5 * 60000).unref();
const chaveEnvio = (req, id, envio) => `${req.user.id}:${id}:${String(envio || '').replace(/[^\w-]/g, '').slice(0, 48)}`;

app.post('/api/conversas/:id/anexo/parte', auth.require, express.raw({ type: () => true, limit: MAX_PARTE + 1024 }), (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const n = Number(req.query.n);
  const parte = req.body;
  if (!req.query.envio || !Number.isInteger(n) || n < 0 || !Buffer.isBuffer(parte) || !parte.length) return res.status(400).json({ erro: 'Envio inválido' });
  if (!tokenDe(req)) return res.status(409).json({ erro: 'Para enviar por aqui, saia do painel (Ajustes → Sair) e entre de novo uma vez.' });
  const chave = chaveEnvio(req, id, req.query.envio);
  let e = envios.get(chave);
  if (n === 0) {
    if (envios.size >= 60) envios.delete(envios.keys().next().value);
    e = { partes: [], bytes: 0, at: Date.now() };
    envios.set(chave, e);
  }
  if (!e || e.partes.length !== n) return res.status(409).json({ erro: 'O envio se perdeu no caminho. Tente de novo.' });
  e.partes.push(parte);
  e.bytes += parte.length;
  e.at = Date.now();
  if (e.bytes > MAX_ENVIO) {
    envios.delete(chave);
    return res.status(413).json({ erro: 'Arquivo grande demais (máximo 40 MB).' });
  }
  res.json({ ok: true, recebido: e.partes.length });
});

app.post('/api/conversas/:id/anexo/enviar', auth.require, async (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const token = tokenDe(req);
  if (!token) return res.status(409).json({ erro: 'Para enviar por aqui, saia do painel (Ajustes → Sair) e entre de novo uma vez.' });
  const chave = chaveEnvio(req, id, req.body?.envio);
  const e = envios.get(chave);
  if (!e || !e.partes.length) return res.status(409).json({ erro: 'O envio se perdeu no caminho. Tente de novo.' });
  envios.delete(chave);
  const legenda = String(req.body?.legenda || '').trim().slice(0, 4000);
  const voz = req.body?.voz === true;
  try {
    let arquivo;
    try {
      arquivo = await midia.prepararEnvio({ dados: Buffer.concat(e.partes), nome: req.body?.nome, tipo: req.body?.tipo }, { voz });
    } catch (err) {
      console.error('[anexo] preparo falhou:', err.message);
      return res.status(422).json({ erro: voz ? 'Não foi possível preparar o áudio. Grave de novo.' : 'Não foi possível preparar o arquivo.' });
    }
    await client.sendAttachment(id, { texto: voz ? '' : legenda, arquivo }, token);
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

// Fixar conversas no topo da lista (vale para toda a equipe)
app.post('/api/conversas/:id/fixar', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  const fixadas = lerFixadas();
  if (!fixadas.includes(id)) {
    if (fixadas.length >= MAX_FIXADAS) return res.status(409).json({ erro: `Já há ${MAX_FIXADAS} conversas fixadas. Desafixe uma para fixar outra.` });
    store.write('fixadas.json', [...fixadas, id]);
  }
  res.json({ ok: true });
});

app.post('/api/conversas/:id/desafixar', auth.require, (req, res) => {
  const id = idConv(req, res);
  if (!id) return;
  store.write('fixadas.json', lerFixadas().filter((x) => x !== id));
  res.json({ ok: true });
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
    const agora = await engine.rapido(60000);
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

// ---- Respostas rápidas (atalho + texto), guardadas no Chatwoot como "respostas prontas" ----
let rapidasCache = null; // { at, lista }
app.get('/api/respostas-rapidas', auth.require, async (req, res) => {
  try {
    if (!rapidasCache || Date.now() - rapidasCache.at > 60000) rapidasCache = { at: Date.now(), lista: await client.listCanned() };
    res.json({ respostas: [...rapidasCache.lista].sort((a, b) => a.atalho.localeCompare(b.atalho)) });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível ler as respostas rápidas');
  }
});

app.post('/api/respostas-rapidas', auth.require, async (req, res) => {
  const atalho = String(req.body?.atalho || '').trim().toLowerCase().replace(/^\/+/, '').replace(/\s+/g, '-').slice(0, 40);
  const texto = String(req.body?.texto || '').trim();
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(atalho)) return res.status(400).json({ erro: 'Dê um nome curto ao atalho, sem espaços (ex.: endereco)' });
  if (!texto) return res.status(400).json({ erro: 'Escreva o texto da resposta' });
  if (texto.length > 4000) return res.status(400).json({ erro: 'Texto longo demais' });
  try {
    const r = await client.createCanned({ atalho, texto });
    rapidasCache = null;
    res.json({ resposta: r });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível salvar. Já existe um atalho com esse nome?');
  }
});

app.delete('/api/respostas-rapidas/:id', auth.require, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Resposta inválida' });
  try {
    await client.deleteCanned(Number(req.params.id));
    rapidasCache = null;
    res.json({ ok: true });
  } catch (err) {
    falhaChatwoot(res, err, 'Não foi possível apagar');
  }
});

// ---- Verificações agendadas ----
// O que já passou por alguma verificação e continua pendente agora (é o que a aba Verificações mostra)
app.get('/api/verificacoes/pendentes', auth.require, async (req, res) => {
  try {
    const agora = await engine.rapido(60000);
    res.json({ ...scheduler.verificadasPendentes(agora), atualizadoEm: agora.updatedAt, horarios: config.checks.times });
  } catch (err) {
    falhaChatwoot(res, err);
  }
});

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
  console.log(ia.ativo ? `[ia] análise inteligente ligada (${ia.model})` : '[ia] sem chave de IA (GEMINI_API_KEY ou ANTHROPIC_API_KEY): usando regras por palavra-chave');
  engine.scan({ iaEmFundo: true }).catch((e) => console.error('[inicio] primeira varredura falhou:', e.message));
  if (!config.demo && config.chatwootSetup) {
    prepararChatwoot({ client, config }).catch((e) => console.error('[chatwoot] preparação falhou:', e.message));
  }
});
