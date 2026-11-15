// Varre as conversas abertas no Chatwoot e monta a lista de pendências.
import { classify, buildMatchers } from './classifier.js';
import { toClassifierMessages } from './chatwoot.js';

const PALETTE = [
  { bg: '#DBEAFE', fg: '#1E3A8A' },
  { bg: '#FEF3C7', fg: '#78350F' },
  { bg: '#EDE9FE', fg: '#4C1D95' },
  { bg: '#DCFCE7', fg: '#14532D' },
];

const FLAG_ORDER = { pediu_atendente: 0, retorno_prometido: 1, sem_resposta: 2 };

/** Conversa de grupo do WhatsApp (via Evolution o identificador termina em @g.us). */
export function ehGrupo(c) {
  return /@g\.us$/i.test(c.contactIdentifier || '') || /@g\.us$/i.test(c.contactPhone || '');
}

export class PendenciasEngine {
  constructor({ client, config, logger = console, ignorados = () => new Set() }) {
    this.client = client;
    this.ignorados = ignorados; // () => Set de contactId que a equipe mandou ignorar
    this.config = config;
    this.log = logger;
    this.matchers = buildMatchers(config.rules);
    this.cache = new Map(); // conversationId -> { lastActivityAt, messages }
    this.inboxes = [];
    this.inboxesAt = 0;
    this.last = null;
    this.running = null;
  }

  async loadInboxes() {
    if (Date.now() - this.inboxesAt < 10 * 60000 && this.inboxes.length) return this.inboxes;
    const all = await this.client.listInboxes();
    const filter = this.config.chatwoot.inboxIds;
    this.inboxes = all
      .filter((i) => !filter.length || filter.includes(i.id))
      .map((i, idx) => ({ ...i, color: PALETTE[idx % PALETTE.length] }));
    this.inboxesAt = Date.now();
    return this.inboxes;
  }

  /** Resultado recente (até maxAgeMs) ou nova varredura. */
  async get(maxAgeMs = 60000) {
    if (this.last && Date.now() - this.last.updatedAt < maxAgeMs) return this.last;
    return this.scan();
  }

  async scan() {
    if (this.running) return this.running;
    this.running = this._scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _scan() {
    const now = Date.now();
    const inboxes = await this.loadInboxes();
    const inboxById = new Map(inboxes.map((i) => [i.id, i]));
    const convs = [
      ...(await this.client.listConversations('open')),
      ...(await this.client.listConversations('pending')),
    ].filter((c) => inboxById.has(c.inboxId));

    const items = [];
    const all = [];
    const ignoradosSet = this.ignorados();
    const etiquetaIgnorar = this.config.labels.ignorar;
    let ignoradas = 0;
    const queue = [];
    for (const c of convs) {
      const ignorar = ehGrupo(c)
        || (c.contactId != null && ignoradosSet.has(String(c.contactId)))
        || (etiquetaIgnorar && c.labels.includes(etiquetaIgnorar));
      if (ignorar) {
        ignoradas++;
        all.push({ conv: c, result: { pending: false, flags: [] } }); // tira a etiqueta "pendencia" se tiver
      } else {
        queue.push(c);
      }
    }
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const c = queue.shift();
        try {
          const messages = await this.messagesFor(c);
          const result = classify(messages, { now, rules: this.config.rules, matchers: this.matchers });
          all.push({ conv: c, result });
          if (result.pending) items.push(this.toItem(c, result, inboxById.get(c.inboxId)));
        } catch (err) {
          this.log.error(`[pendencias] conversa ${c.id}:`, err.message);
        }
      }
    });
    await Promise.all(workers);

    // Limpa cache de conversas que não estão mais abertas
    const openIds = new Set(convs.map((c) => c.id));
    for (const id of this.cache.keys()) if (!openIds.has(id)) this.cache.delete(id);

    items.sort((a, b) => FLAG_ORDER[a.primary] - FLAG_ORDER[b.primary] || b.waitingMinutes - a.waitingMinutes);

    if (this.config.labels.sync) await this.syncLabels(all).catch((e) => this.log.error('[labels]', e.message));

    this.last = {
      updatedAt: now,
      items,
      totals: summarize(items, inboxes),
      inboxes: inboxes.map(({ id, name, phone, color }) => ({ id, name, phone, color })),
      openConversations: convs.length,
      ignoredConversations: ignoradas,
    };
    return this.last;
  }

  async messagesFor(c) {
    const cached = this.cache.get(c.id);
    if (cached && cached.lastActivityAt === c.lastActivityAt) return cached.messages;
    const raw = await this.client.listMessages(c.id, this.config.chatwoot.maxMessages);
    const messages = toClassifierMessages(raw, this.config.rules);
    this.cache.set(c.id, { lastActivityAt: c.lastActivityAt, messages });
    return messages;
  }

  toItem(c, r, inbox) {
    const flags = [...r.flags].sort((a, b) => FLAG_ORDER[a.type] - FLAG_ORDER[b.type]);
    const pub = this.config.chatwoot.publicUrl;
    return {
      id: c.id,
      contactId: c.contactId,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      assigneeName: c.assigneeName,
      inbox: inbox ? { id: inbox.id, name: inbox.name, color: inbox.color } : null,
      primary: flags[0].type,
      flags,
      since: r.since,
      waitingMinutes: r.waitingMinutes,
      aiInvolved: r.aiInvolved,
      lastHumanName: r.lastHumanName,
      url: pub ? `${pub}/app/accounts/${this.config.chatwoot.accountId}/conversations/${c.id}` : '',
    };
  }

  async syncLabels(all) {
    const L = this.config.labels;
    const managed = [L.pendencia, ...(L.antigas || [])];
    for (const { conv, result } of all) {
      const wanted = result.pending ? [L.pendencia] : [];
      const kept = conv.labels.filter((l) => !managed.includes(l));
      const next = [...new Set([...kept, ...wanted])].sort();
      const current = [...new Set(conv.labels)].sort();
      if (next.join('|') !== current.join('|')) {
        await this.client.setLabels(conv.id, next);
        conv.labels = next;
      }
    }
  }

  async resolve(id) {
    await this.client.resolve(id);
    this.cache.delete(Number(id));
    if (this.last) {
      this.last.items = this.last.items.filter((i) => i.id !== Number(id));
      this.last.totals = summarize(this.last.items, this.inboxes);
    }
  }
}

export function summarize(items, inboxes) {
  const count = (type) => items.filter((i) => i.flags.some((f) => f.type === type)).length;
  return {
    total: items.length,
    pediuAtendente: count('pediu_atendente'),
    retornoPrometido: count('retorno_prometido'),
    semResposta: count('sem_resposta'),
    porNumero: inboxes.map((i) => ({ id: i.id, name: i.name, total: items.filter((x) => x.inbox?.id === i.id).length })),
    maisAntigoMin: items.reduce((m, i) => Math.max(m, i.waitingMinutes), 0),
  };
}
