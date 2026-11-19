// Verificações agendadas (de hora em hora, de segunda a sábado) e alertas contínuos.
// Cada verificação anota quais conversas continuam pendentes desde as anteriores (verificadas.json).
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

  /**
   * Acompanhamento entre verificações: para cada conversa pendente, desde qual verificação ela vem
   * aparecendo e em quantas já apareceu. Sai da lista quando deixa de estar pendente.
   */
  acompanhamento() {
    let a = this.store.read('verificadas.json', null);
    if (!a) {
      // Primeira vez: monta a partir das verificações já guardadas (últimos 3 dias)
      a = { conv: {}, ultima: null };
      for (const dia of this.store.listCheckDays().slice(-3)) {
        for (const hora of this.store.listChecks(dia)) {
          const snap = this.store.getCheck(dia, hora);
          if (snap) a = avancar(a, snap.items || [], [], { date: dia, time: hora, at: snap.createdAt || `${dia}T${hora}:00` });
        }
      }
      this.store.write('verificadas.json', a);
    }
    return a;
  }

  /** Verificação oficial de um horário: salva o retrato, atualiza o acompanhamento e avisa a equipe. */
  async runCheck(time) {
    const { date } = zonedParts(new Date(), this.config.timezone);
    const r = await this.engine.scan();
    const snapshot = { date, time, createdAt: new Date().toISOString(), items: r.items, adiadas: (r.adiadas || []).length, totals: r.totals, inboxes: r.inboxes };
    const antes = this.acompanhamento(); // lido antes de guardar esta verificação, para ela não contar duas vezes
    this.store.saveCheck(date, time, snapshot);
    const a = avancar(antes, r.items, r.adiadas || [], { date, time, at: snapshot.createdAt });
    this.store.write('verificadas.json', a);
    const { novas, resolvidas } = a.ultima;
    this.log.info(`[verificacao] ${date} ${time}: ${r.totals.total} pendência(s), ${novas} nova(s), ${resolvidas} resolvida(s)`);

    const t = r.totals;
    // De hora em hora só avisa quando há o que fazer (ou quando a lista acabou de zerar)
    if (t.total === 0 && !resolvidas) return snapshot;
    const continuam = t.total - novas;
    const body = t.total === 0
      ? 'Nenhuma conversa pendente. Tudo respondido!'
      : [
          novas && plural(novas, 'nova', 'novas'),
          continuam && plural(continuam, 'continua desde a verificação anterior', 'continuam desde a verificação anterior'),
          t.urgentes && plural(t.urgentes, 'urgente', 'urgentes'),
        ].filter(Boolean).join(' · ');
    await this.push.sendAll({
      title: `Verificação das ${time}: ${plural(t.total, 'pendência', 'pendências')}`,
      body,
      url: '/?aba=verificacoes',
      tag: 'verificacao', // a de agora substitui a da hora anterior na tela do celular
    });
    return snapshot;
  }

  /** O que já passou por alguma verificação e continua pendente agora. */
  verificadasPendentes(agora) {
    const a = this.acompanhamento();
    const itens = (agora.items || [])
      .filter((i) => a.conv[i.id])
      .map((i) => ({ ...i, verificacao: a.conv[i.id] }))
      .sort((x, y) => new Date(x.verificacao.primeira) - new Date(y.verificacao.primeira));
    return {
      itens,
      ultima: a.ultima,
      proxima: this.proxima(),
      // Pendentes de agora que ainda não passaram por nenhuma verificação (entram na próxima)
      aindaNaoVerificadas: (agora.items || []).filter((i) => !a.conv[i.id]).length,
      adiadas: (agora.adiadas || []).filter((i) => a.conv[i.id]).length,
    };
  }

  /** Próxima verificação agendada: { date, time } (procura até 8 dias à frente). */
  proxima(now = new Date()) {
    const hoje = zonedParts(now, this.config.timezone);
    for (let d = 0; d <= 8; d++) {
      const dia = new Date(`${hoje.date}T12:00:00Z`);
      dia.setUTCDate(dia.getUTCDate() + d);
      if (!this.days.has(dia.getUTCDay())) continue;
      const date = dia.toISOString().slice(0, 10);
      const time = this.config.checks.times.find((t) => d > 0 || t > hoje.time);
      if (time) return { date, time };
    }
    return null;
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
        ? { title: `${item.contactName}${numero} pediu atendente`, body: (item.resumo || flag.text).slice(0, 140) }
        : { title: `Retorno atrasado: ${item.contactName}${numero}`, body: item.resumo || `${flag.by || 'Equipe'}: "${flag.text.slice(0, 120)}"` };
      await this.push.sendAll({ ...payload, url: `/?conversa=${item.id}`, tag: `conv-${item.id}` });
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

/** Avança o acompanhamento com o resultado de uma verificação. */
export function avancar(anterior, itens, adiadas, quando) {
  const antes = anterior?.conv || {};
  const conv = {};
  let novas = 0;
  for (const i of itens) {
    const a = antes[i.id];
    if (a) conv[i.id] = { primeira: a.primeira, vezes: a.vezes + 1, ultima: quando.at };
    else {
      conv[i.id] = { primeira: quando.at, vezes: 1, ultima: quando.at };
      novas++;
    }
  }
  // Adiada continua pendente: mantém o histórico, sem contar esta verificação
  for (const i of adiadas) if (antes[i.id] && !conv[i.id]) conv[i.id] = antes[i.id];
  const resolvidas = Object.keys(antes).filter((id) => !conv[id]).length;
  return { conv, ultima: { date: quando.date, time: quando.time, at: quando.at, total: itens.length, novas, resolvidas } };
}
