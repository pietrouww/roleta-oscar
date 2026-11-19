// Modo demonstração: simula um Chatwoot com conversas fictícias (DEMO=true).
// Serve para ver o painel funcionando antes de conectar o Chatwoot de verdade.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MIN = 60000;

/** Gera um áudio (formato do WhatsApp) e uma foto de exemplo para a demonstração. */
export function prepararMidiaDemo(dir) {
  const pasta = path.join(dir, 'demo-midia');
  fs.mkdirSync(pasta, { recursive: true });
  const rodar = (args, saida) => fs.existsSync(saida) || spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, saida]);
  rodar(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'libopus', '-b:a', '24k'], path.join(pasta, 'audio.ogg'));
  rodar(['-f', 'lavfi', '-i', 'testsrc2=size=900x700:rate=1', '-frames:v', '1'], path.join(pasta, 'foto.jpg'));
  fs.writeFileSync(path.join(pasta, 'orcamento.pdf'), '%PDF-1.4\n% arquivo de exemplo da demonstração\n');
  return pasta;
}

export class DemoChatwootClient {
  constructor({ midiaUrl = '', midiaDir = '' } = {}) {
    this.midiaUrl = midiaUrl;
    this.midiaDir = midiaDir;
    this.base = Date.now();
    let aid = 1;
    const anexo = (file_type, arquivo) => ({ id: aid++, file_type, data_url: `${midiaUrl}/${arquivo}`, file_size: 48000 });
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
    const midia = (m, ...anexos) => ({ ...m, attachments: anexos });
    this.nextId = () => mid++;

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
          midia(ag('Carlos Dias', 240, 'Pronto! Segue o boleto atualizado.'), anexo('file', 'orcamento.pdf')),
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
          midia(cli(69, 'Olha como veio'), anexo('image', 'foto.jpg')),
          midia(cli(68, ''), anexo('audio', 'audio.ogg')),
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
      {
        // Grupo: sempre fora da verificação
        id: 108, inbox: 1, name: 'Grupo Obras Centro', phone: '', identifier: '120363000000000001@g.us', assignee: '',
        messages: [cli(90, 'Alguém confirma a entrega de amanhã?')],
      },
      {
        // Fornecedor que manda tabela todo dia: dá para "Ignorar contato"
        id: 109, inbox: 2, name: 'Distribuidora Aço Forte', phone: '+5541988887777', assignee: '',
        messages: [cli(180, 'Bom dia! Segue a tabela de preços de hoje: vergalhão 10mm R$ 52,90…')],
      },
    ];
  }

  async listInboxes() {
    return this.inboxes.map((i) => ({ id: i.id, name: i.name, channelType: i.channel_type, phone: i.phone_number }));
  }

  async listConversations(status) {
    if (status !== 'open' && status !== 'resolved') return [];
    return this.conversations
      .filter((c) => this.resolved.has(c.id) === (status === 'resolved'))
      .map((c) => ({
        id: c.id,
        inboxId: c.inbox,
        status,
        labels: this.labels.get(c.id) || [],
        lastActivityAt: c.messages[c.messages.length - 1].created_at * 1000,
        contactId: c.id + 5000,
        contactName: c.name,
        contactPhone: c.phone,
        contactIdentifier: c.identifier || '',
        assigneeName: c.assignee,
        assigneeId: c.assignee ? (c.assignee.startsWith('Ana') ? 1 : 2) : null,
        unread: c.messages[c.messages.length - 1].message_type === 0 ? c.messages.filter((m) => m.message_type === 0).slice(-2).length : 0,
        preview: (() => {
          const m = c.messages[c.messages.length - 1];
          const t = m.attachments[0]?.file_type;
          return {
            texto: m.content,
            dir: m.message_type === 0 ? 'in' : 'out',
            midia: t ? { audio: 'audio', image: 'imagem', video: 'video' }[t] || 'arquivo' : '',
            at: m.created_at * 1000,
          };
        })(),
      }));
  }

  async listCanned() {
    this.rapidas ||= [
      { id: 1, atalho: 'endereco', texto: 'Estamos na Rua das Flores, 100 - Centro. Atendemos de segunda a sexta, das 9h às 18h, e sábado até as 13h.' },
      { id: 2, atalho: 'pix', texto: 'Olá, {{contact.name}}! Nossa chave Pix é o CNPJ 00.000.000/0001-00. Assim que pagar, mande o comprovante por aqui.' },
      { id: 3, atalho: 'pronto', texto: 'Seu aparelho está pronto para retirada. 😊' },
    ];
    return this.rapidas;
  }

  async createCanned({ atalho, texto }) {
    const r = { id: Date.now(), atalho, texto };
    (await this.listCanned()).push(r);
    return r;
  }

  async deleteCanned(id) {
    this.rapidas = (await this.listCanned()).filter((x) => x.id !== Number(id));
  }

  async sendMessage(id, content, token, { nota = false } = {}) {
    const c = this.conversations.find((x) => x.id === Number(id));
    if (!c) throw new Error('Conversa não encontrada');
    c.messages.push({
      id: this.nextId(), message_type: 1, created_at: Math.round(Date.now() / 1000), content, private: !!nota,
      sender_type: 'User', sender: { name: this.usuario || 'Atendente', type: 'user' }, attachments: [], status: 'sent',
    });
  }

  async sendAttachment(id, { texto = '', arquivo }) {
    const c = this.conversations.find((x) => x.id === Number(id));
    if (!c) throw new Error('Conversa não encontrada');
    const mid = this.nextId();
    const nome = `envio-${mid}-${arquivo.nome}`;
    if (this.midiaDir) fs.writeFileSync(path.join(this.midiaDir, nome), arquivo.dados);
    const grupo = arquivo.tipo.split('/')[0];
    c.messages.push({
      id: mid, message_type: 1, created_at: Math.round(Date.now() / 1000), content: texto, private: false,
      sender_type: 'User', sender: { name: this.usuario || 'Atendente', type: 'user' }, status: 'sent',
      attachments: [{ id: 900000 + mid, file_type: ['image', 'audio', 'video'].includes(grupo) ? grupo : 'file', data_url: `${this.midiaUrl}/${encodeURIComponent(nome)}`, file_size: arquivo.dados.length }],
    });
  }

  async assign(id) {
    const c = this.conversations.find((x) => x.id === Number(id));
    if (c) c.assignee = this.usuario || 'Atendente';
  }

  async markRead() {}

  async reopen(id) {
    this.resolved.delete(Number(id));
  }

  async listMessages(id) {
    return this.conversations.find((c) => c.id === Number(id))?.messages || [];
  }

  async listMessagesPage(id, before = null) {
    const todas = await this.listMessages(id);
    const ate = before ? todas.filter((m) => m.id < before) : todas;
    return ate.slice(-20);
  }

  async listContactConversations() {
    return [];
  }

  async setLabels(id, labels) {
    this.labels.set(Number(id), labels);
  }

  async resolve(id) {
    this.resolved.add(Number(id));
  }

  async signIn(email) {
    const name = (email || 'Atendente').split('@')[0].replace(/[._-]+/g, ' ');
    this.usuario = name.replace(/\b\w/g, (c) => c.toUpperCase());
    return { id: 1, name: this.usuario, email, role: 'administrator', token: 'demo' };
  }
}

// Evolution API de mentira: mostra um QR Code ilustrativo e "conecta" depois de alguns segundos.
export class DemoEvolutionClient {
  constructor() {
    this.configured = true;
    this.instances = new Map([
      ['comercial', { nome: 'comercial', estado: 'conectado', numero: '5541999990001', perfil: 'Comercial', foto: '' }],
      ['suporte', { nome: 'suporte', estado: 'desconectado', numero: '', perfil: '', foto: '' }],
    ]);
  }

  async list() {
    return [...this.instances.values()].map((i) => ({ ...i }));
  }

  async create(nome) {
    if (this.instances.has(nome)) throw new Error('Já existe um número com esse nome');
    this.instances.set(nome, { nome, estado: 'desconectado', numero: '', perfil: '', foto: '' });
  }

  async setChatwoot() {}

  fakeQr(seed) {
    const n = 29;
    let rects = '';
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
        h = (h * 1103515245 + 12345) >>> 0;
        if (finder) {
          const fx = x < 7 ? x : x - (n - 7);
          const fy = y < 7 ? y : y - (n - 7);
          const ring = fx === 0 || fx === 6 || fy === 0 || fy === 6;
          const core = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4;
          if (ring || core) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        } else if ((h >> 16) & 1) {
          rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        }
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#111B21">${rects}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  async connect(nome, numero) {
    const i = this.instances.get(nome);
    if (!i) throw new Error('Número não encontrado');
    if (i.estado !== 'conectado') {
      i.estado = 'conectando';
      i.polls = 0;
    }
    return { qr: this.fakeQr(nome + Date.now()), codigo: numero ? 'K7QM-2XPA' : '', estado: i.estado };
  }

  async state(nome) {
    const i = this.instances.get(nome);
    if (!i) throw new Error('Número não encontrado');
    if (i.estado === 'conectando' && ++i.polls >= 4) {
      i.estado = 'conectado';
      i.numero = '5541999990002';
      i.perfil = nome.charAt(0).toUpperCase() + nome.slice(1);
    }
    return i.estado;
  }

  async logout(nome) {
    const i = this.instances.get(nome);
    if (i) Object.assign(i, { estado: 'desconectado', numero: '', perfil: '' });
  }

  async remove(nome) {
    this.instances.delete(nome);
  }
}


// Análise de mentira para a demonstração: mostra como ficam o resumo e o próximo passo da IA.
const ANALISES_DEMO = {
  101: { pendente: true, tipo: 'pediu_atendente', urgencia: 'alta', resumo: 'Quer falar com uma pessoa sobre o serviço; a resposta automática não resolveu', proximoPasso: 'Assumir a conversa e perguntar o que ela precisa', indice: 2 },
  102: { pendente: true, tipo: 'sem_resposta', urgencia: 'media', resumo: 'Pediu o valor para 3 unidades e ninguém respondeu', proximoPasso: 'Enviar o preço para 3 unidades', indice: 1 },
  103: { pendente: true, tipo: 'retorno_prometido', urgencia: 'alta', resumo: 'Aguarda o horário do técnico, prometido desde ontem', proximoPasso: 'Confirmar o horário com a equipe técnica e avisar a cliente', indice: 1 },
  104: { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Boleto enviado e cliente agradeceu', proximoPasso: '', indice: -1 },
  105: { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Dúvida respondida, cliente agradeceu', proximoPasso: '', indice: -1 },
  106: { pendente: true, tipo: 'retorno_prometido', urgencia: 'alta', resumo: 'Peça com defeito: mandou foto e áudio e já cobrou novidade', proximoPasso: 'Dar retorno do fornecedor ou um prazo para a troca', indice: 3 },
  107: { pendente: true, tipo: 'pediu_atendente', urgencia: 'alta', resumo: 'Não quer falar com robô, pediu uma pessoa', proximoPasso: 'Assumir a conversa e se apresentar', indice: 0 },
  109: { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Tabela de preços de fornecedor, não pede resposta', proximoPasso: '', indice: -1 },
};

export class DemoAnalisador {
  get ativo() { return true; }
  get model() { return 'demonstração'; }
  status() { return { ativa: true, modelo: 'demonstração', pausada: false, ultimoErro: '', chamadas: 0 }; }
  emCache(convId, messages) {
    const a = ANALISES_DEMO[convId];
    if (!a) return undefined;
    // Se a equipe respondeu depois (pelo app), a pendência some
    const ultima = messages[messages.length - 1];
    if (a.pendente && ultima?.dir === 'out' && ultima.author === 'humano' && ultima.at > Date.now() - 3600000 && !/verific|retorn|aviso|falar com/i.test(ultima.text)) {
      return { ...a, pendente: false, tipo: 'nenhuma', resumo: 'Equipe respondeu', proximoPasso: '', indice: -1 };
    }
    return a;
  }
  async analisar(convId, messages) { return this.emCache(convId, messages) || null; }
  salvar() {}
}
