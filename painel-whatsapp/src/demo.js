// Modo demonstração: simula um Chatwoot com conversas fictícias (DEMO=true).
// Serve para ver o painel funcionando antes de conectar o Chatwoot de verdade.

const MIN = 60000;

export class DemoChatwootClient {
  constructor() {
    this.base = Date.now();
    this.resolved = new Set();
    this.labels = new Map();
    let mid = 1000;
    const t = (minAgo) => Math.round((this.base - minAgo * MIN) / 1000);
    const msg = (type, minAgo, content, sender) => ({
      id: mid++,
      message_type: type,
      created_at: t(minAgo),
      content,
      private: false,
      sender_type: sender?.type || (type === 0 ? 'Contact' : null),
      sender: sender ? { name: sender.name, type: sender.type?.toLowerCase() } : null,
      attachments: [],
    });
    const cli = (minAgo, text) => msg(0, minAgo, text, { type: 'Contact', name: 'Cliente' });
    const ag = (name, minAgo, text) => msg(1, minAgo, text, { type: 'User', name });
    const ia = (minAgo, text) => msg(1, minAgo, text, null);

    this.inboxes = [
      { id: 1, name: 'Comercial', channel_type: 'Channel::Whatsapp', phone_number: '+5541999990001' },
      { id: 2, name: 'Suporte', channel_type: 'Channel::Whatsapp', phone_number: '+5541999990002' },
    ];

    this.conversations = [
      {
        id: 101, inbox: 1, name: 'Mariana Lopes', phone: '+5541999991111', assignee: 'Ana Souza',
        messages: [
          cli(95, 'Olá, bom dia! Gostaria de saber sobre o serviço de vocês.'),
          ia(94, 'Olá! Sou a assistente virtual. Posso ajudar com preços e horários. O que você precisa?'),
          cli(80, 'Quero falar com um atendente, por favor.'),
          ia(79, 'Claro! Vou chamar alguém da equipe.'),
        ],
      },
      {
        id: 102, inbox: 1, name: 'João Pereira', phone: '+5541999992222', assignee: '',
        messages: [
          cli(150, 'Boa tarde'),
          cli(122, 'Qual o valor para 3 unidades?'),
        ],
      },
      {
        id: 103, inbox: 2, name: 'Fernanda Costa', phone: '+5541999993333', assignee: 'Bruno Lima',
        messages: [
          cli(1200, 'O técnico vem que horas amanhã?'),
          ag('Bruno Lima', 1185, 'Oi Fernanda! Vou verificar com a equipe técnica e já te retorno.'),
          cli(1180, 'Ok, obrigada'),
        ],
      },
      {
        id: 104, inbox: 2, name: 'Construtora Alfa', phone: '+5541999994444', assignee: 'Carlos Dias',
        messages: [
          cli(300, 'Preciso do boleto atualizado.'),
          ag('Carlos Dias', 290, 'Estamos verificando no financeiro, um momento.'),
          ag('Carlos Dias', 240, 'Pronto! Segue o boleto atualizado.'),
          cli(238, 'Obrigado!'),
        ],
      },
      {
        id: 105, inbox: 1, name: 'Ricardo Mendes', phone: '+5541999995555', assignee: 'Ana Souza',
        messages: [
          cli(400, 'Vocês entregam em Pinhais?'),
          ia(399, 'Entregamos sim! A taxa para Pinhais é calculada no orçamento.'),
          cli(398, 'Perfeito, obrigado'),
        ],
      },
      {
        id: 106, inbox: 2, name: 'Paulo Henrique', phone: '+5541999996666', assignee: 'Bruno Lima',
        messages: [
          cli(70, 'A peça chegou com defeito'),
          ag('Bruno Lima', 65, 'Sinto muito, Paulo! Vou falar com o fornecedor e te aviso ainda hoje.'),
          cli(40, 'Alguma novidade?'),
        ],
      },
      {
        id: 107, inbox: 1, name: 'Lucas Almeida', phone: '+5541999997777', assignee: '',
        messages: [
          cli(25, 'Isso é um robô? Quero falar com uma pessoa.'),
          ia(24, 'Sou a assistente virtual, mas já avisei a equipe.'),
        ],
      },
    ];
  }

  async listInboxes() {
    return this.inboxes.map((i) => ({ id: i.id, name: i.name, channelType: i.channel_type, phone: i.phone_number }));
  }

  async listConversations(status) {
    if (status !== 'open') return [];
    return this.conversations
      .filter((c) => !this.resolved.has(c.id))
      .map((c) => ({
        id: c.id,
        inboxId: c.inbox,
        status: 'open',
        labels: this.labels.get(c.id) || [],
        lastActivityAt: c.messages[c.messages.length - 1].created_at * 1000,
        contactName: c.name,
        contactPhone: c.phone,
        assigneeName: c.assignee,
      }));
  }

  async listMessages(id) {
    return this.conversations.find((c) => c.id === Number(id))?.messages || [];
  }

  async setLabels(id, labels) {
    this.labels.set(Number(id), labels);
  }

  async resolve(id) {
    this.resolved.add(Number(id));
  }

  async signIn(email) {
    const name = (email || 'Atendente').split('@')[0].replace(/[._-]+/g, ' ');
    return { id: 1, name: name.replace(/\b\w/g, (c) => c.toUpperCase()), email, role: 'administrator' };
  }
}
