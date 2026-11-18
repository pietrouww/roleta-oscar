// Cliente da API do Chatwoot (Application API).
// Documentação: https://www.chatwoot.com/developers/api/

export class ChatwootClient {
  constructor({ url, accountId, token }) {
    this.url = url;
    this.accountId = accountId;
    this.token = token;
  }

  /** `token` troca o usuário da chamada (ex.: responder em nome do atendente logado). */
  async request(method, path, body, token) {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        api_access_token: token || this.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Chatwoot ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
  }

  acc(path) {
    return `/api/v1/accounts/${this.accountId}${path}`;
  }

  async listInboxes() {
    const r = await this.request('GET', this.acc('/inboxes'));
    return (r?.payload || []).map((i) => ({
      id: i.id,
      name: i.name,
      channelType: i.channel_type,
      phone: i.phone_number || '',
    }));
  }

  async listConversations(status, maxPages = 40) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.request(
        'GET',
        this.acc(`/conversations?status=${encodeURIComponent(status)}&assignee_type=all&page=${page}`),
      );
      const items = r?.data?.payload || [];
      out.push(...items);
      if (items.length < 25) break;
    }
    return out.map(conversaDe);
  }

  /** Todas as conversas de um contato (abertas e resolvidas, de qualquer número). */
  async listContactConversations(contactId) {
    const r = await this.request('GET', this.acc(`/contacts/${contactId}/conversations`));
    return (r?.payload || []).map(conversaDe);
  }

  /** Uma página (20) de mensagens no formato bruto: as mais recentes, ou as anteriores a `before`. */
  async listMessagesPage(conversationId, before = null) {
    const q = before ? `?before=${before}` : '';
    const r = await this.request('GET', this.acc(`/conversations/${conversationId}/messages${q}`));
    return r?.payload || [];
  }

  async sendMessage(conversationId, content, token) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/messages`), { content, message_type: 'outgoing', private: false }, token);
  }

  async assign(conversationId, assigneeId) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/assignments`), { assignee_id: assigneeId });
  }

  async markRead(conversationId, token) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/update_last_seen`), {}, token);
  }

  async reopen(conversationId) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/toggle_status`), { status: 'open' });
  }

  /** Mensagens mais recentes (até `max`), em ordem cronológica, no formato bruto do Chatwoot. */
  async listMessages(conversationId, max = 60) {
    let all = [];
    let before = null;
    while (all.length < max) {
      const q = before ? `?before=${before}` : '';
      const r = await this.request('GET', this.acc(`/conversations/${conversationId}/messages${q}`));
      const batch = r?.payload || [];
      if (!batch.length) break;
      all = [...batch, ...all];
      const oldest = batch.reduce((min, x) => (x.id < min ? x.id : min), batch[0].id);
      if (batch.length < 20 || oldest === before) break;
      before = oldest;
    }
    const seen = new Set();
    return all
      .filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))
      .sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  }

  async setLabels(conversationId, labels) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/labels`), { labels });
  }

  async resolve(conversationId) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/toggle_status`), { status: 'resolved' });
  }

  async listLabels() {
    const r = await this.request('GET', this.acc('/labels'));
    return (r?.payload || (Array.isArray(r) ? r : [])).map((l) => ({ id: l.id, title: l.title, showOnSidebar: l.show_on_sidebar }));
  }

  async createLabel({ title, description, color, showOnSidebar = false }) {
    return this.request('POST', this.acc('/labels'), { title, description, color, show_on_sidebar: showOnSidebar });
  }

  async listDashboardApps() {
    const r = await this.request('GET', this.acc('/dashboard_apps'));
    return (Array.isArray(r) ? r : r?.payload || []).map((a) => ({
      id: a.id,
      title: a.title,
      urls: (a.content || []).map((c) => c.url),
    }));
  }

  async createDashboardApp({ title, url }) {
    return this.request('POST', this.acc('/dashboard_apps'), { title, content: [{ type: 'frame', url }] });
  }

  /** Login com e-mail e senha do Chatwoot. Retorna o usuário ou null. */
  async signIn(email, password) {
    const res = await fetch(`${this.url}/auth/sign_in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const u = body?.data;
    if (!u) return null;
    const accounts = u.accounts || [];
    const conta = accounts.find((a) => String(a.id) === String(this.accountId));
    if (accounts.length && !conta) return null;
    // O papel (administrator / agent) vem por conta; versões antigas mandam no próprio usuário
    const role = conta?.role || u.role || '';
    return { id: u.id, name: u.available_name || u.name || u.email, email: u.email, role, token: u.access_token || '' };
  }
}

function conversaDe(c) {
  return {
    id: c.id,
    inboxId: c.inbox_id,
    status: c.status,
    labels: c.labels || [],
    lastActivityAt: (c.last_activity_at || c.timestamp || 0) * 1000,
    contactId: c.meta?.sender?.id ?? null,
    contactName: c.meta?.sender?.name || c.meta?.sender?.phone_number || 'Sem nome',
    contactPhone: c.meta?.sender?.phone_number || '',
    contactIdentifier: c.meta?.sender?.identifier || '',
    assigneeName: c.meta?.assignee?.name || '',
    assigneeId: c.meta?.assignee?.id ?? null,
    unread: c.unread_count || 0,
    preview: previaDe(c.last_non_activity_message || (c.messages || []).filter((m) => m.message_type !== 2).pop()),
  };
}

/**
 * Converte mensagens do Chatwoot para o formato do classificador.
 * message_type: 0 = recebida, 1 = enviada, 2 = atividade (ignorada), 3 = modelo/template.
 */
export function toClassifierMessages(raw, rules) {
  const sigRe = rules.aiSignatureRegex ? new RegExp(rules.aiSignatureRegex, 'i') : null;
  const out = [];
  for (const x of raw) {
    if (x.private) continue; // notas internas não contam
    if (x.message_type === 2) continue;
    const text = x.content || '';
    const hasMedia = Array.isArray(x.attachments) && x.attachments.length > 0;
    const mediaKind = hasMedia ? NOME_MIDIA[tipoMidia(x.attachments[0])] : '';
    const at = (x.created_at || 0) * 1000;
    if (x.message_type === 0) {
      out.push({ id: x.id, at, dir: 'in', author: 'cliente', name: x.sender?.name || '', text, hasMedia, mediaKind });
      continue;
    }
    const senderType = (x.sender_type || x.sender?.type || '').toLowerCase();
    let author;
    let name = x.sender?.available_name || x.sender?.name || '';
    // A Evolution registra tudo o que sai do próprio celular (IA da Meta, resposta automática ou
    // alguém digitando no aparelho) com o usuário "Celular": não é atendente do Chatwoot.
    const celularNome = (rules.celularSenderName || 'Celular').toLowerCase();
    const doCelular = senderType === 'user' && name.toLowerCase() === celularNome;
    // Para o que sai do celular, o código da mensagem no WhatsApp mostra a origem:
    // "CE…" = IA da Meta; "3EB0…" = WhatsApp Web/sistema; demais ("2A…", "3A"…) = pessoa no app.
    const waId = String(x.source_id || '').replace(/^WAID:/i, '').toUpperCase();
    const prefixosIa = (rules.aiIdPrefixes || ['CE']).map((p) => String(p).toUpperCase()).filter(Boolean);
    if (doCelular && rules.aiDetection !== 'assinatura' && waId) {
      if (prefixosIa.some((p) => waId.startsWith(p))) {
        author = 'ia';
        name = 'IA';
      } else if (waId.startsWith('3EB0')) {
        author = 'celular';
        name = 'WhatsApp Web';
      } else {
        author = 'celular';
        name = 'Equipe (celular)';
      }
    } else if (senderType === 'user' && !doCelular) {
      author = 'humano';
    } else if (senderType === 'agentbot' || senderType === 'agent_bot') {
      author = 'ia';
      name = name || 'IA';
    } else if (rules.aiDetection === 'assinatura') {
      author = sigRe && sigRe.test(text) ? 'ia' : 'celular';
      name = author === 'ia' ? 'IA' : 'Celular';
    } else {
      // Sem atendente do Chatwoot: veio da IA da Meta / automação / app no celular
      author = 'ia';
      name = 'IA';
    }
    out.push({ id: x.id, at, dir: 'out', author, name, text, hasMedia, mediaKind });
  }
  return out;
}

const NOME_MIDIA = { audio: 'áudio', imagem: 'imagem', video: 'vídeo', arquivo: 'arquivo', local: 'localização', contato: 'contato' };

export function tipoMidia(a) {
  const t = String(a?.file_type || '').toLowerCase();
  if (t === 'audio') return 'audio';
  if (t === 'image') return 'imagem';
  if (t === 'video') return 'video';
  if (t === 'location') return 'local';
  if (t === 'contact') return 'contato';
  return 'arquivo';
}

function previaDe(m) {
  if (!m) return null;
  const anexo = (m.attachments || [])[0];
  return {
    texto: (m.content || '').slice(0, 160),
    dir: m.message_type === 0 ? 'in' : 'out',
    midia: anexo ? tipoMidia(anexo) : '',
    at: (m.created_at || 0) * 1000,
  };
}

function nomeArquivo(a) {
  try {
    const nome = decodeURIComponent(new URL(a.data_url).pathname.split('/').pop() || '');
    if (nome) return nome;
  } catch { /* sem url */ }
  return `arquivo-${a.id}`;
}

/** Mensagens no formato da tela de conversa (com mídias, notas internas e avisos do sistema). */
export function toDisplayMessages(raw, rules, convId, ehAutomatica = () => false) {
  const autores = new Map(toClassifierMessages(raw, rules).map((m) => [m.id, m]));
  return raw.map((x) => {
    const c = autores.get(x.id);
    const base = { id: x.id, at: (x.created_at || 0) * 1000, texto: x.content || '' };
    if (x.message_type === 2) return { ...base, tipo: 'sistema' };
    const anexos = (x.attachments || []).map((a) => {
      const tipo = tipoMidia(a);
      return {
        id: a.id,
        tipo,
        nome: nomeArquivo(a),
        tamanho: a.file_size || 0,
        url: a.data_url ? `/api/midia/${convId}/${x.id}/${a.id}` : '',
        lat: a.coordinates_lat ?? null,
        lng: a.coordinates_long ?? null,
        titulo: a.fallback_title || '',
      };
    });
    if (x.private) return { ...base, tipo: 'nota', autor: x.sender?.available_name || x.sender?.name || 'Equipe', anexos };
    return {
      ...base,
      tipo: c?.dir === 'in' ? 'recebida' : 'enviada',
      autor: c?.dir === 'in' ? '' : c?.name || '',
      autorTipo: c?.author || '',
      // Resposta automática do WhatsApp Business (ausência/saudação): não conta como resposta
      auto: c?.dir === 'out' && c.author !== 'humano' && ehAutomatica(c.text),
      status: x.status || '',
      anexos,
    };
  });
}

/** Anexo bruto de uma mensagem (para o servidor buscar o arquivo). */
export function acharAnexo(raw, messageId, attachmentId) {
  const m = raw.find((x) => String(x.id) === String(messageId));
  return (m?.attachments || []).find((a) => String(a.id) === String(attachmentId)) || null;
}
