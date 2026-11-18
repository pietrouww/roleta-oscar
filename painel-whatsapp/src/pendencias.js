// Varre as conversas abertas no Chatwoot e monta a lista de pendências.
// Cada conversa é analisada pela IA (contexto completo) ou, sem IA, pelas regras por palavra-chave.
// Por cima disso entram as marcações da equipe: marcar pendência à mão, adiar e "não é pendência".
import { classify, buildMatchers } from './classifier.js';
import { toClassifierMessages } from './chatwoot.js';

const PALETTE = [
  { bg: '#DBEAFE', fg: '#1E3A8A' },
  { bg: '#FEF3C7', fg: '#78350F' },
  { bg: '#EDE9FE', fg: '#4C1D95' },
  { bg: '#DCFCE7', fg: '#14532D' },
];

const FLAG_ORDER = { manual: 0, pediu_atendente: 1, retorno_prometido: 2, sem_resposta: 3 };
const URG_ORDER = { alta: 0, media: 1, baixa: 2 };

/** Conversa de grupo do WhatsApp (via Evolution o identificador termina em @g.us). */
export function ehGrupo(c) {
  return /@g\.us$/i.test(c.contactIdentifier || '') || /@g\.us$/i.test(c.contactPhone || '');
}

/** Conversa interna da Evolution (status da conexão), não é cliente. */
export function ehSistema(c) {
  return c.contactName === 'EvolutionAPI' || /^\+?123456$/.test(c.contactPhone || '');
}

const SEM_MARCAS = { getMarks: () => ({}), setMark() {} };

export class PendenciasEngine {
  constructor({ client, config, logger = console, ignorados = () => new Set(), ia = null, marcas = SEM_MARCAS }) {
    this.client = client;
    this.ignorados = ignorados; // () => Set de contactId que a equipe mandou ignorar
    this.ia = ia;
    this.marcas = marcas;
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

  /** Força nova varredura na próxima consulta (depois de uma ação da equipe). */
  invalidate() {
    if (this.last) this.last.updatedAt = 0;
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
    const adiadas = [];
    const all = [];
    const ignoradosSet = this.ignorados();
    const etiquetaIgnorar = this.config.labels.ignorar;
    const marcas = this.marcas.getMarks();
    const orcamento = { restante: this.config.ia?.maxPorVarredura ?? 40 };
    let ignoradas = 0;
    const queue = [];
    for (const c of convs) {
      const ignorar = ehGrupo(c) || ehSistema(c)
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
          const result = await this.avaliar(c, messages, now, marcas[c.id], orcamento);
          all.push({ conv: c, result });
          if (!result.pending) continue;
          const item = this.toItem(c, result, inboxById.get(c.inboxId));
          if (result.adiadaAte) adiadas.push(item);
          else items.push(item);
        } catch (err) {
          this.log.error(`[pendencias] conversa ${c.id}:`, err.message);
        }
      }
    });
    await Promise.all(workers);

    // Limpa caches e marcações de conversas que não estão mais abertas
    const openIds = new Set(convs.map((c) => c.id));
    for (const id of this.cache.keys()) if (!openIds.has(id)) this.cache.delete(id);
    for (const id of Object.keys(marcas)) {
      if (!openIds.has(Number(id))) for (const t of Object.keys(marcas[id])) this.marcas.setMark(id, t, null);
    }
    this.ia?.salvar(openIds);

    const ordem = (a, b) => URG_ORDER[a.urgencia] - URG_ORDER[b.urgencia] || b.waitingMinutes - a.waitingMinutes;
    items.sort(ordem);
    adiadas.sort((a, b) => a.adiadaAte - b.adiadaAte);

    if (this.config.labels.sync) await this.syncLabels(all).catch((e) => this.log.error('[labels]', e.message));

    this.last = {
      updatedAt: now,
      items,
      adiadas,
      totals: summarize(items, inboxes),
      inboxes: inboxes.map(({ id, name, phone, color }) => ({ id, name, phone, color })),
      openConversations: convs.length,
      ignoredConversations: ignoradas,
      ia: this.ia?.status() || { ativa: false },
    };
    return this.last;
  }

  /** Decide se a conversa está pendente: IA (ou regras) + marcações da equipe. */
  async avaliar(c, messages, now, marca = {}, orcamento = { restante: 0 }) {
    const regras = classify(messages, { now, rules: this.config.rules, matchers: this.matchers });
    const ultimaId = messages.length ? messages[messages.length - 1].id : null;
    let r = {
      pending: regras.pending,
      flags: regras.flags,
      since: regras.since,
      urgencia: regras.flags.some((f) => f.type === 'pediu_atendente') ? 'alta' : 'media',
      resumo: '',
      proximoPasso: '',
      fonte: 'regras',
    };

    const recente = now - c.lastActivityAt <= (this.config.ia?.maxDias ?? 14) * 864e5;
    if (this.ia?.ativo && messages.length && recente) {
      let analise = this.ia.emCache(c.id, messages);
      if (!analise && orcamento.restante > 0) {
        orcamento.restante--;
        analise = await this.ia.analisar(c.id, this.paraIa(messages), now);
      }
      if (analise) r = this.daAnalise(analise, messages, now);
    }

    // "Não é pendência": vale enquanto não chegar mensagem nova
    if (marca.dispensa) {
      if (marca.dispensa.ultimaMsg === ultimaId) r = { ...r, pending: false, flags: [] };
      else this.marcas.setMark(c.id, 'dispensa', null);
    }
    // Marcada à mão pela equipe: fica pendente até alguém concluir
    if (marca.manual) {
      const flag = { type: 'manual', since: marca.manual.em, text: marca.manual.nota || '', by: marca.manual.por || '' };
      r = {
        ...r,
        pending: true,
        flags: [flag, ...r.flags],
        since: Math.min(marca.manual.em, r.since ?? Infinity),
        resumo: marca.manual.nota || r.resumo,
        fonte: 'equipe',
      };
    }
    // Adiada: some da lista até o horário combinado
    if (r.pending && marca.adiar) {
      if (now < marca.adiar.ate) r.adiadaAte = marca.adiar.ate;
      else this.marcas.setMark(c.id, 'adiar', null);
    }

    return {
      ...r,
      waitingMinutes: r.pending && r.since ? Math.max(0, Math.round((now - r.since) / 60000)) : 0,
      aiInvolved: regras.aiInvolved,
      lastHumanName: regras.lastHumanName,
      ultimaMsg: ultimaId,
    };
  }

  /** Respostas automáticas (ausência/saudação) vão para a IA marcadas como automáticas, não como atendente. */
  paraIa(messages) {
    const auto = this.matchers.isAutoReply;
    if (!auto) return messages;
    return messages.map((m) => (m.dir === 'out' && m.author !== 'humano' && auto(m.text) ? { ...m, author: 'ia' } : m));
  }

  daAnalise(a, messages, now) {
    const base = { urgencia: a.urgencia, resumo: a.resumo, proximoPasso: a.proximoPasso, fonte: 'ia' };
    if (!a.pendente) return { ...base, pending: false, flags: [], since: null };
    const promessa = a.tipo === 'retorno_prometido';
    let origem = messages[a.indice];
    if (!origem) {
      const candidatas = messages.filter((m) => (promessa ? m.dir === 'out' : m.dir === 'in'));
      origem = candidatas[candidatas.length - 1] || messages[messages.length - 1];
    }
    // Tolerância: dá um tempo para a equipe responder antes de virar pendência
    const minutos = promessa ? this.config.rules.promiseMinMinutes ?? 30 : this.config.rules.waitMinMinutes ?? 15;
    if (now - origem.at < minutos * 60000) return { ...base, pending: false, flags: [], since: null };
    const flag = {
      type: a.tipo,
      since: origem.at,
      text: origem.text || (origem.hasMedia ? `[${origem.mediaKind || 'mídia'}]` : ''),
      by: origem.dir === 'out' ? origem.name || '' : '',
      byAuthor: origem.dir === 'out' ? origem.author : 'cliente',
    };
    return { ...base, pending: true, flags: [flag], since: origem.at };
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
      assigneeId: c.assigneeId ?? null,
      inbox: inbox ? { id: inbox.id, name: inbox.name, color: inbox.color } : null,
      primary: flags[0].type,
      flags,
      motivo: flags.find((f) => f.motivo)?.motivo || '',
      since: r.since,
      waitingMinutes: r.waitingMinutes,
      urgencia: r.urgencia || 'media',
      resumo: r.resumo || '',
      proximoPasso: r.proximoPasso || '',
      fonte: r.fonte,
      adiadaAte: r.adiadaAte || null,
      ultimaMsg: r.ultimaMsg,
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
      this.last.adiadas = (this.last.adiadas || []).filter((i) => i.id !== Number(id));
      this.last.totals = summarize(this.last.items, this.inboxes);
    }
  }
}

export function summarize(items, inboxes) {
  const count = (type) => items.filter((i) => i.flags.some((f) => f.type === type)).length;
  const porAtendente = new Map();
  for (const i of items) {
    const nome = i.assigneeName || 'Sem responsável';
    porAtendente.set(nome, (porAtendente.get(nome) || 0) + 1);
  }
  return {
    total: items.length,
    urgentes: items.filter((i) => i.urgencia === 'alta').length,
    manual: count('manual'),
    pediuAtendente: count('pediu_atendente'),
    retornoPrometido: count('retorno_prometido'),
    semResposta: count('sem_resposta'),
    porNumero: inboxes.map((i) => ({ id: i.id, name: i.name, total: items.filter((x) => x.inbox?.id === i.id).length })),
    porAtendente: [...porAtendente].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    maisAntigoMin: items.reduce((m, i) => Math.max(m, i.waitingMinutes), 0),
  };
}
