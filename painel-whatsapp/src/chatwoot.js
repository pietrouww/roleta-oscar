// Cliente da API do Chatwoot (Application API).
// Documentação: https://www.chatwoot.com/developers/api/

export class ChatwootClient {
  constructor({ url, accountId, token }) {
    this.url = url;
    this.accountId = accountId;
    this.token = token;
  }

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

  async listConversations(status) {
    const out = [];
    for (let page = 1; page <= 40; page++) {
      const r = await this.request(
        'GET',
        this.acc(`/conversations?status=${encodeURIComponent(status)}&assignee_type=all&page=${page}`),
      );
      const items = r?.data?.payload || [];
      out.push(...items);
      if (items.length < 25) break;
    }
    return out.map((c) => ({
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
    }));
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

  /** Envia resposta ao cliente como o atendente dono do token (assinatura com o nome dele). */
  async sendMessage(conversationId, content, token) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/messages`), {
      content, message_type: 'outgoing', private: false,
    }, token);
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
    const at = (x.created_at || 0) * 1000;
    if (x.message_type === 0) {
      out.push({ id: x.id, at, dir: 'in', author: 'cliente', name: x.sender?.name || '', text, hasMedia });
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
    out.push({ id: x.id, at, dir: 'out', author, name, text, hasMedia });
  }
  return out;
}
