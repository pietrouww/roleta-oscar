// Verificações agendadas (08:30, 12:00, 17:00 de segunda a sábado) e alertas contínuos.
import cron from 'node-cron';
import { zonedParts, parseDays, inWindow } from './time.js';

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export class Scheduler {
  constructor({ engine, store, push, config, logger = console }) {
    this.engine = engine;
    this.store = store;
    this.push = push;
    this.config = config;
    this.log = logger;
    this.days = parseDays(config.checks.days);
  }

  start() {
    for (const t of this.config.checks.times) {
      const [h, m] = t.split(':').map(Number);
      cron.schedule(`${m} ${h} * * ${this.config.checks.days}`, () => this.runCheck(t).catch((e) => this.log.error('[verificacao]', e)), {
        timezone: this.config.timezone,
      });
    }
    const every = Math.max(1, this.config.live.intervalMinutes);
    cron.schedule(`*/${every} * * * *`, () => this.liveTick().catch((e) => this.log.error('[ao-vivo]', e.message)), {
      timezone: this.config.timezone,
    });
    this.log.info(`[agenda] verificações ${this.config.checks.times.join(', ')} (dias ${this.config.checks.days}, ${this.config.timezone}); alertas a cada ${every} min`);
  }

  /** Verificação oficial de um horário: salva o retrato e avisa a equipe. */
  async runCheck(time) {
    const { date } = zonedParts(new Date(), this.config.timezone);
    const r = await this.engine.scan();
    const snapshot = { date, time, createdAt: new Date().toISOString(), items: r.items, totals: r.totals, inboxes: r.inboxes };
    this.store.saveCheck(date, time, snapshot);
    this.log.info(`[verificacao] ${date} ${time}: ${r.totals.total} pendência(s)`);

    const t = r.totals;
    const body = t.total === 0
      ? 'Nenhuma conversa pendente. Tudo respondido!'
      : [
          t.pediuAtendente && plural(t.pediuAtendente, 'pediu atendente', 'pediram atendente'),
          t.retornoPrometido && plural(t.retornoPrometido, 'retorno prometido', 'retornos prometidos'),
          t.semResposta && plural(t.semResposta, 'sem resposta', 'sem resposta'),
        ].filter(Boolean).join(' · ');
    await this.push.sendAll({
      title: `Verificação das ${time}: ${plural(t.total, 'pendência', 'pendências')}`,
      body,
      url: `/?aba=verificacoes&data=${date}&hora=${time}`,
      tag: `verificacao-${date}-${time}`,
    });
    return snapshot;
  }

  /** A cada poucos minutos: avisa na hora quando alguém pede atendente ou uma promessa de retorno atrasa. */
  async liveTick() {
    const now = new Date();
    const { time, weekday } = zonedParts(now, this.config.timezone);
    const r = await this.engine.scan();
    if (!this.days.has(weekday) || !inWindow(time, this.config.live.alertWindow)) return;

    const state = this.store.read('alertas.json', {});
    const alertMin = this.config.rules.promiseAlertMinutes;
    const fresh = [];
    for (const item of r.items) {
      for (const f of item.flags) {
        let key = null;
        if (f.type === 'pediu_atendente') key = `pa:${item.id}:${f.since}`;
        if (f.type === 'retorno_prometido' && (now - f.since) / 60000 >= alertMin) key = `rp:${item.id}:${f.since}`;
        if (key && !state[key]) {
          state[key] = now.getTime();
          fresh.push({ item, flag: f });
        }
      }
    }
    // Remove alertas com mais de 7 dias
    for (const [k, v] of Object.entries(state)) if (now - v > 7 * 864e5) delete state[k];
    this.store.write('alertas.json', state);

    for (const { item, flag } of fresh) {
      const numero = item.inbox?.name ? ` (${item.inbox.name})` : '';
      const payload = flag.type === 'pediu_atendente'
        ? { title: `${item.contactName}${numero} pediu atendente`, body: flag.text.slice(0, 140) }
        : { title: `Retorno atrasado: ${item.contactName}${numero}`, body: `${flag.by || 'Equipe'}: "${flag.text.slice(0, 120)}"` };
      await this.push.sendAll({ ...payload, url: '/?aba=agora', tag: `conv-${item.id}` });
    }
  }

  /** Lista de horários do dia com status (feita / agendada / perdida). */
  checksForDate(date) {
    const done = new Set(this.store.listChecks(date));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!this.days.has(weekday) && !done.size) return [];
    const today = zonedParts(new Date(), this.config.timezone);
    return this.config.checks.times.map((t) => {
      let status = 'agendada';
      if (done.has(t)) status = 'feita';
      else if (date < today.date || (date === today.date && t < today.time)) status = 'nao_executada';
      return { time: t, status };
    });
  }
}
