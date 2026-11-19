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

/** Chave para reconhecer o mesmo cliente em números (caixas) diferentes: DDD + 8 últimos dígitos, ou o contato. */
export function chaveContato(c) {
  const d = String(c.contactPhone || '').replace(/\D/g, '');
  if (d.length >= 10) {
    const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return `t:${n.slice(0, 2)}${n.slice(-8)}`;
  }
  return c.contactId != null ? `c:${c.contactId}` : '';
}

/** Momento da última mensagem "de verdade" (ignora resposta automática de ausência/saudação). */
export function ultimaReal(messages, ehAuto = () => false) {
  let at = 0;
  for (const m of messages) {
    if (m.dir === 'in' || m.author === 'humano' || !ehAuto(m.text)) at = Math.max(at, m.at);
  }
  return at;
}

/**
 * O cliente começou a falar num número e continuou em outro?
 * Vale quando ele escreveu em outro número da empresa DEPOIS da última mensagem desta conversa
 * (ex.: recebeu a mensagem automática do Laboratório e seguiu no Atendimento).
 * @param {object[]} messages mensagens desta conversa
 * @param {Array<{id:number, nome:string, messages:object[]}>} irmas conversas do mesmo cliente em outros números
 * @returns {{id:number, nome:string, at:number}|null}
 */
export function continuouEmOutro(messages, irmas, ehAuto = () => false) {
  const ref = ultimaReal(messages, ehAuto);
  if (!ref) return null;
  let melhor = null;
  for (const o of irmas || []) {
    let at = 0;
    for (const m of o.messages || []) if (m.dir === 'in' && m.at > ref) at = Math.max(at, m.at);
    if (at && (!melhor || at > melhor.at)) melhor = { id: o.id, nome: o.nome || '', at };
  }
  return melhor;
}

const SEM_MARCAS = { getMarks: () => ({}), setMark() {} };

export class PendenciasEngine {
  constructor({ client, config, logger = console, ignorados = () => new Set(), ia = null, marcas = SEM_MARCAS, mensagens = null }) {
    this.client = client;
    this.mensagens = mensagens; // cache compartilhado das mensagens brutas (opcional)
    this.contatos = new Map(); // contactId -> { at, convs }: conversas resolvidas do cliente em outros números
    this.filaIa = new Map(); // conversas esperando análise da IA em segundo plano
    this.drenando = null;
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

  /**
   * Para as telas: nunca espera a IA nem segura a resposta à toa.
   * - resultado recente: devolve na hora;
   * - resultado velho: devolve o que tem e atualiza por trás;
   * - sem resultado, ou depois de uma ação da equipe: faz a varredura rápida (a IA analisa em segundo plano).
   */
  async rapido(maxAgeMs = 60000) {
    const r = this.last;
    if (r && r.updatedAt) {
      if (Date.now() - r.updatedAt >= maxAgeMs) this.scan({ iaEmFundo: true }).catch((e) => this.log.error('[pendencias]', e.message));
      return r;
    }
    return this.scan({ iaEmFundo: true });
  }

  /** Força nova varredura na próxima consulta (depois de uma ação da equipe). */
  invalidate() {
    if (this.last) this.last.updatedAt = 0;
  }

  /**
   * Varre as conversas abertas. `iaEmFundo`: não espera a IA; conversa ainda sem análise usa as regras
   * por enquanto e a IA analisa em segundo plano (o resultado entra na varredura seguinte).
   */
  async scan(opts = {}) {
    if (this.running) {
      if (!this.runningEmFundo || opts.iaEmFundo) return this.running;
      // Há uma varredura rápida em curso e esta precisa da análise completa: espera e refaz
      await this.running.catch(() => {});
      return this.scan(opts);
    }
    this.runningEmFundo = !!opts.iaEmFundo;
    this.running = this._scan(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _scan({ iaEmFundo = false } = {}) {
    const now = Date.now();
    const inboxes = await this.loadInboxes();
    const inboxById = new Map(inboxes.map((i) => [i.id, i]));
    const [abertas, emEspera] = await Promise.all([this.client.listConversations('open'), this.client.listConversations('pending')]);
    const convs = [...abertas, ...emEspera].filter((c) => inboxById.has(c.inboxId));

    const items = [];
    const adiadas = [];
    const all = [];
    const continuadas = {};
    const quem = {};
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

    // 1) Mensagens de todas as conversas (só relê no Chatwoot as que mudaram)
    const lidas = new Map(); // conversaId -> mensagens
    const paraLer = [...queue];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (paraLer.length) {
        const c = paraLer.shift();
        try {
          lidas.set(c.id, await this.messagesFor(c));
        } catch (err) {
          this.log.error(`[pendencias] conversa ${c.id}:`, err.message);
        }
      }
    }));

    // 2) O mesmo cliente em números diferentes: uma conversa enxerga as outras
    const porCliente = new Map();
    for (const c of queue) {
      const k = chaveContato(c);
      if (!k || !lidas.has(c.id)) continue;
      if (!porCliente.has(k)) porCliente.set(k, []);
      porCliente.get(k).push(c);
    }
    const abertasIds = new Set(convs.map((c) => c.id));
    const irmasDe = (c) => (porCliente.get(chaveContato(c)) || [])
      .filter((o) => o.id !== c.id && o.inboxId !== c.inboxId)
      .map((o) => ({ id: o.id, nome: inboxById.get(o.inboxId)?.name || '', messages: lidas.get(o.id) }));

    // 3) Avaliação
    const paraAvaliar = queue.filter((c) => lidas.has(c.id));
    const workers = Array.from({ length: 4 }, async () => {
      while (paraAvaliar.length) {
        const c = paraAvaliar.shift();
        try {
          const messages = lidas.get(c.id);
          const ctx = {
            iaEmFundo,
            irmas: irmasDe(c),
            resolvidas: (ref) => this.irmasResolvidas(c, ref, inboxById, abertasIds),
          };
          const result = await this.avaliar(c, messages, now, marcas[c.id], orcamento, ctx);
          all.push({ conv: c, result });
          if (result.atendimento?.ia) quem[c.id] = result.atendimento;
          if (result.continuouEm) continuadas[c.id] = result.continuouEm;
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

    // Com análises da IA ainda por chegar, as etiquetas esperam a próxima varredura (evita pôr e tirar em seguida)
    const esperandoIa = iaEmFundo ? this.filaIa.size : 0;
    if (this.config.labels.sync && !esperandoIa) await this.syncLabels(all).catch((e) => this.log.error('[labels]', e.message));
    if (esperandoIa) this.drenarFilaIa();

    this.last = {
      updatedAt: now,
      items,
      adiadas,
      continuadas,
      quem, // conversas em que a IA de atendimento participou: quem respondeu por último e se ela chamou a equipe
      analisando: esperandoIa,
      totals: summarize(items, inboxes),
      inboxes: inboxes.map(({ id, name, phone, color }) => ({ id, name, phone, color })),
      openConversations: convs.length,
      ignoredConversations: ignoradas,
      ia: this.ia?.status() || { ativa: false },
    };
    return this.last;
  }

  /**
   * Decide se a conversa está pendente: IA (ou regras) + marcações da equipe.
   * `ctx.irmas`: conversas abertas do mesmo cliente em outros números; `ctx.resolvidas(ref)`: busca as já resolvidas.
   */
  async avaliar(c, messages, now, marca = {}, orcamento = { restante: 0 }, ctx = {}) {
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

    // Cliente começou neste número e continuou em outro (ex.: mensagem automática do Laboratório → Atendimento):
    // o que ele deixou sem resposta aqui segue na outra conversa, então aqui não é pendência.
    // Promessa de retorno feita pela equipe não entra nessa regra: continua valendo até ser cumprida.
    const auto = this.matchers.isAutoReply || (() => false);
    const irmas = ctx.irmas || [];
    const doCliente = (flags) => flags.length > 0 && flags.every((f) => f.type === 'sem_resposta' || f.type === 'pediu_atendente');
    const seguiu = (mig) => ({
      pending: false, flags: [], since: null, urgencia: 'baixa', proximoPasso: '', fonte: 'regras',
      resumo: `Cliente continuou a conversa pelo número ${mig.nome || 'de outro setor'}`,
      continuouEm: { id: mig.id, nome: mig.nome },
    });
    let mig = marca.manual ? null : continuouEmOutro(messages, irmas, auto);

    if (mig && regras.pending && doCliente(regras.flags)) {
      r = seguiu(mig);
    } else {
      const recente = now - c.lastActivityAt <= (this.config.ia?.maxDias ?? 14) * 864e5;
      if (this.ia?.ativo && messages.length && recente) {
        // Contexto para a IA: o que o mesmo cliente falou em outro número nas últimas 48 horas
        const ultimaAt = messages[messages.length - 1].at;
        const outros = irmas
          .filter((o) => o.messages?.length && Math.abs(o.messages[o.messages.length - 1].at - ultimaAt) <= 48 * 3600000)
          .map((o) => ({ id: o.id, nome: o.nome, messages: this.paraIa(o.messages) }));
        const paraIa = this.paraIa(messages);
        let analise = this.ia.emCache(c.id, paraIa, outros);
        if (!analise && orcamento.restante > 0) {
          orcamento.restante--;
          if (ctx.iaEmFundo) this.filaIa.set(c.id, { messages: paraIa, outros });
          else analise = await this.ia.analisar(c.id, paraIa, now, outros);
        }
        if (analise) {
          r = this.daAnalise(analise, messages, now);
          // Rede de segurança: a IA de atendimento disse que ia chamar a equipe e ninguém assumiu.
          // Mesmo que a análise ache que está tudo respondido, isso fica como pendência.
          const repasse = regras.flags.find((f) => f.viaIa);
          if (repasse && !r.pending) {
            r = {
              pending: true, flags: [repasse], since: repasse.since, urgencia: 'alta', fonte: 'regras',
              resumo: 'A IA disse que ia chamar a equipe e ninguém assumiu a conversa',
              proximoPasso: 'Assumir a conversa e responder o cliente',
            };
          } else if (repasse && r.flags[0]) {
            r.flags[0].viaIa = true;
          }
        }
      }
      if (r.pending && !marca.manual && doCliente(r.flags)) {
        // Também vale quando a outra conversa já foi resolvida (não está mais na lista de abertas)
        if (!mig && ctx.resolvidas) mig = continuouEmOutro(messages, await ctx.resolvidas(ultimaReal(messages, auto)), auto);
        if (mig) r = seguiu(mig);
      }
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
      continuouEm: r.pending ? null : r.continuouEm || null,
      waitingMinutes: r.pending && r.since ? Math.max(0, Math.round((now - r.since) / 60000)) : 0,
      aiInvolved: regras.aiInvolved,
      atendimento: regras.atendimento,
      lastHumanName: regras.lastHumanName,
      ultimaMsg: ultimaId,
    };
  }

  /** Conversas já resolvidas do mesmo cliente em outros números, com atividade depois de `ref`. */
  async irmasResolvidas(c, ref, inboxById, abertasIds) {
    if (c.contactId == null || typeof this.client.listContactConversations !== 'function') return [];
    const k = String(c.contactId);
    let e = this.contatos.get(k);
    if (!e || Date.now() - e.at > 3 * 60000) {
      const convs = await this.client.listContactConversations(c.contactId).catch((err) => {
        this.log.error(`[pendencias] conversas do contato ${k}:`, err.message);
        return [];
      });
      e = { at: Date.now(), convs };
      this.contatos.delete(k);
      this.contatos.set(k, e);
      while (this.contatos.size > 300) this.contatos.delete(this.contatos.keys().next().value);
    }
    const out = [];
    for (const o of e.convs) {
      if (o.id === c.id || o.inboxId === c.inboxId || !inboxById.has(o.inboxId) || abertasIds.has(o.id) || o.lastActivityAt <= ref) continue;
      try {
        const raw = await this.lerBrutas(o.id, { max: 20, lastActivityAt: o.lastActivityAt });
        out.push({ id: o.id, nome: inboxById.get(o.inboxId).name, messages: toClassifierMessages(raw, this.config.rules) });
      } catch (err) {
        this.log.error(`[pendencias] conversa ${o.id}:`, err.message);
      }
    }
    return out;
  }

  /** Manda para a IA, em segundo plano, as conversas que ficaram sem análise na varredura rápida. */
  drenarFilaIa() {
    if (this.drenando || !this.filaIa.size || !this.ia) return this.drenando;
    this.drenando = (async () => {
      let chegou = false;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (this.filaIa.size) {
          const [id, t] = this.filaIa.entries().next().value;
          this.filaIa.delete(id);
          const r = await this.ia.analisar(id, t.messages, Date.now(), t.outros).catch(() => null);
          if (r) chegou = true;
        }
      }));
      this.ia.salvar?.();
      if (chegou) this.invalidate(); // a próxima consulta já sai com a análise da IA
    })().catch((e) => this.log.error('[ia] fila:', e.message)).finally(() => {
      this.drenando = null;
    });
    return this.drenando;
  }

  lerBrutas(id, { max, lastActivityAt = null } = {}) {
    if (this.mensagens) return this.mensagens.obter(id, { max, lastActivityAt });
    return this.client.listMessages(id, max);
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
    const raw = await this.lerBrutas(c.id, { max: this.config.chatwoot.maxMessages, lastActivityAt: c.lastActivityAt });
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
