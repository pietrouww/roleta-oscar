// Cliente da API do Chatwoot (Application API).
// Documentação: https://www.chatwoot.com/developers/api/

export class ChatwootClient {
  constructor({ url, accountId, token }) {
    this.url = url;
    this.accountId = accountId;
    this.token = token;
  }

  async request(method, path, body) {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        api_access_token: this.token,
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
      contactName: c.meta?.sender?.name || c.meta?.sender?.phone_number || 'Sem nome',
      contactPhone: c.meta?.sender?.phone_number || '',
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

  async resolve(conversationId) {
    return this.request('POST', this.acc(`/conversations/${conversationId}/toggle_status`), { status: 'resolved' });
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
    return { id: u.id, name: u.available_name || u.name || u.email, email: u.email, role };
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
    if (senderType === 'user') {
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
