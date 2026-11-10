// Cliente da Evolution API (v2): conecta números de WhatsApp por QR Code e liga cada um ao Chatwoot.
// Documentação: https://doc.evolution-api.com/v2

export function slug(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const STATE = { open: 'conectado', connecting: 'conectando', close: 'desconectado' };

export class EvolutionClient {
  constructor({ url, apiKey, chatwoot }) {
    this.url = url;
    this.apiKey = apiKey;
    this.chatwoot = chatwoot; // { url, accountId, token }
  }

  get configured() {
    return !!(this.url && this.apiKey);
  }

  async request(method, path, body) {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.response?.message || data?.message || data?.error || text;
      throw new Error(`Evolution ${method} ${path} -> ${res.status} ${JSON.stringify(msg).slice(0, 200)}`);
    }
    return data;
  }

  /** Lista de números conectados (ou não) na Evolution. */
  async list() {
    const r = await this.request('GET', '/instance/fetchInstances');
    const arr = Array.isArray(r) ? r : r?.instances || [];
    return arr.map((x) => {
      const i = x.instance || x; // v1 envolvia em { instance: {...} }
      const status = i.connectionStatus || i.status || i.state || 'close';
      const jid = i.ownerJid || i.owner || '';
      return {
        nome: i.name || i.instanceName,
        estado: STATE[status] || status,
        numero: i.number || (jid ? jid.split('@')[0] : ''),
        perfil: i.profileName || '',
        foto: i.profilePicUrl || i.profilePictureUrl || '',
      };
    });
  }

  async create(instanceName) {
    return this.request('POST', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    });
  }

  /** Liga o número ao Chatwoot: cria a caixa de entrada sozinho e assina as respostas com o nome do atendente. */
  async setChatwoot(instanceName, nomeCaixa) {
    return this.request('POST', `/chatwoot/set/${encodeURIComponent(instanceName)}`, {
      enabled: true,
      accountId: String(this.chatwoot.accountId),
      token: this.chatwoot.token,
      url: this.chatwoot.url,
      nameInbox: nomeCaixa,
      signMsg: true,
      signDelimiter: '\n',
      reopenConversation: true,
      conversationPending: false,
      autoCreate: true,
      importContacts: false,
      importMessages: false,
      daysLimitImportMessages: 0,
      mergeBrazilContacts: true,
      ignoreJids: ['@g.us'],
    });
  }

  /** QR Code atual (imagem base64). Com `numero`, devolve também o código de pareamento de 8 letras. */
  async connect(instanceName, numero) {
    const q = numero ? `?number=${encodeURIComponent(numero)}` : '';
    const r = await this.request('GET', `/instance/connect/${encodeURIComponent(instanceName)}${q}`);
    const base64 = r?.base64 || r?.qrcode?.base64 || '';
    return {
      qr: base64 && !base64.startsWith('data:') ? `data:image/png;base64,${base64}` : base64,
      codigo: r?.pairingCode || r?.qrcode?.pairingCode || '',
      estado: r?.instance?.state ? STATE[r.instance.state] || r.instance.state : '',
    };
  }

  async state(instanceName) {
    const r = await this.request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const st = r?.instance?.state || r?.state || 'close';
    return STATE[st] || st;
  }

  async logout(instanceName) {
    return this.request('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async remove(instanceName) {
    return this.request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  }
}
