// Configuração lida das variáveis de ambiente (arquivo .env no servidor).
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const int = (k, d) => {
  const n = parseInt(env(k, String(d)), 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (k, d) => {
  const v = env(k, d ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on'].includes(v);
};
const list = (k, d = '') => env(k, d).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  demo: bool('DEMO', false),
  port: int('PORT', 3100),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  timezone: env('TZ_PAINEL', 'America/Sao_Paulo'),
  sessionSecret: env('SESSION_SECRET', ''),

  chatwoot: {
    // URL usada pelo painel para falar com o Chatwoot (pode ser interna, ex.: http://rails:3000)
    url: env('CHATWOOT_URL', '').replace(/\/+$/, ''),
    // URL que os atendentes abrem no navegador (link "Abrir no Chatwoot")
    publicUrl: env('CHATWOOT_PUBLIC_URL', env('CHATWOOT_URL', '')).replace(/\/+$/, ''),
    accountId: env('CHATWOOT_ACCOUNT_ID', '1'),
    token: env('CHATWOOT_API_TOKEN', ''),
    inboxIds: list('INBOX_IDS').map(Number).filter(Boolean),
    maxMessages: int('MAX_MESSAGES', 60),
  },

  checks: {
    times: list('CHECK_TIMES', '08:30,12:00,17:00'),
    days: env('CHECK_DAYS', '1-6'), // 1=segunda ... 6=sábado (formato cron)
  },

  rules: {
    waitMinMinutes: int('WAIT_MIN_MINUTES', 15),
    promiseMinMinutes: int('PROMISE_MIN_MINUTES', 30),
    promiseAlertMinutes: int('PROMISE_ALERT_MINUTES', 120),
    extraPromiseTerms: list('PROMISE_EXTRA_TERMS'),
    extraAttendantTerms: list('ATTENDANT_EXTRA_TERMS'),
    // "sem_usuario": toda mensagem enviada fora do Chatwoot (sem atendente) recebe o selo IA.
    // "assinatura": só recebe o selo IA quem bater com AI_SIGNATURE_REGEX; o resto vira "Celular".
    aiDetection: env('AI_DETECTION', 'sem_usuario'),
    aiSignatureRegex: env('AI_SIGNATURE_REGEX', ''),
  },

  live: {
    intervalMinutes: int('LIVE_INTERVAL_MINUTES', 5),
    alertWindow: env('LIVE_ALERT_WINDOW', '07:00-19:00'),
  },

  labels: {
    sync: bool('LABELS_SYNC', true),
    semResposta: env('LABEL_SEM_RESPOSTA', 'pendente-resposta'),
    pediuAtendente: env('LABEL_PEDIU_ATENDENTE', 'pediu-atendente'),
    retornoPrometido: env('LABEL_RETORNO_PROMETIDO', 'retorno-prometido'),
  },

  push: {
    subject: env('VAPID_SUBJECT', 'mailto:admin@example.com'),
    publicKey: env('VAPID_PUBLIC_KEY', ''),
    privateKey: env('VAPID_PRIVATE_KEY', ''),
  },
};

export function validateConfig() {
  const problems = [];
  if (!config.demo) {
    if (!config.chatwoot.url) problems.push('CHATWOOT_URL não definido');
    if (!config.chatwoot.token) problems.push('CHATWOOT_API_TOKEN não definido');
  }
  for (const t of config.checks.times) {
    if (!/^\d{2}:\d{2}$/.test(t)) problems.push(`Horário inválido em CHECK_TIMES: ${t}`);
  }
  return problems;
}
