// Nome dos contatos. Quando o Chatwoot só tem o número (ou um ponto, ou emojis), o painel procura um
// nome de verdade e grava no contato. Fontes, nesta ordem:
//   1. agenda dos celulares conectados (os contatos que a Evolution recebe do WhatsApp);
//   2. cadastro externo (arquivo nomes-externos.json na pasta de dados: { "telefone": "Nome" });
//   3. nome de perfil que o cliente usa no WhatsApp (aparece nas mensagens que ele mandou).
// Nunca troca um nome que já tem letras: o que a equipe digitou fica como está.
import fs from 'node:fs';
import path from 'node:path';

/** Sem nome de verdade: vazio, só número, ponto, emojis... (precisa de 2 letras seguidas para valer). */
export const semNome = (nome) => {
  const n = String(nome || '').trim();
  return !/\p{L}{2}/u.test(n) || n.toLowerCase() === 'sem nome';
};

/** Chave do telefone: DDD + 8 últimos dígitos (iguala números com e sem o nono dígito e com ou sem 55). */
export function chaveTelefone(valor) {
  const d = String(valor || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (d.length < 10) return '';
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  return n.slice(0, 2) + n.slice(-8);
}

const limpar = (nome) => String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const valido = (nome) => {
  const n = limpar(nome);
  return n && !semNome(n) ? n : '';
};

export class Nomes {
  constructor({ evolution, client, dataDir, logger = console, validadeMs = 6 * 3600 * 1000, porVez = 15 }) {
    this.evolution = evolution;
    this.client = client;
    this.arquivo = dataDir ? path.join(dataDir, 'nomes-externos.json') : '';
    this.log = logger;
    this.validadeMs = validadeMs;
    this.porVez = porVez;
    this.cacheAgenda = null; // { at, mapa, instancias }
    this.cacheExternos = { mtime: -1, mapa: new Map() };
    this.tentados = new Map(); // contactId -> quando procurou e não achou
  }

  /** Agenda dos celulares conectados: chave do telefone -> nome salvo. */
  async agenda() {
    if (this.cacheAgenda && Date.now() - this.cacheAgenda.at < this.validadeMs) return this.cacheAgenda;
    const mapa = new Map();
    const instancias = [];
    for (const inst of await this.evolution.list()) {
      instancias.push(inst.nome);
      let contatos = [];
      try {
        contatos = await this.evolution.contacts(inst.nome);
      } catch (err) {
        this.log.error(`[nomes] agenda de ${inst.nome}: ${err.message}`);
      }
      for (const c of contatos) {
        if (!String(c.remoteJid || '').endsWith('@s.whatsapp.net')) continue;
        const k = chaveTelefone(c.remoteJid);
        const nome = valido(c.pushName);
        if (k && nome && !mapa.has(k)) mapa.set(k, nome);
      }
    }
    this.cacheAgenda = { at: Date.now(), mapa, instancias };
    return this.cacheAgenda;
  }

  /** Cadastro externo (ex.: exportado do sistema de ordens de serviço): { "telefone": "Nome" }. */
  externos() {
    if (!this.arquivo) return this.cacheExternos.mapa;
    let mtime = 0;
    try {
      mtime = fs.statSync(this.arquivo).mtimeMs;
    } catch {
      return new Map();
    }
    if (mtime !== this.cacheExternos.mtime) {
      const mapa = new Map();
      try {
        const dados = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
        for (const [tel, nome] of Object.entries(dados || {})) {
          const k = chaveTelefone(tel);
          const n = valido(nome);
          if (k && n) mapa.set(k, n);
        }
      } catch (err) {
        this.log.error(`[nomes] nomes-externos.json inválido: ${err.message}`);
      }
      if (this.cacheExternos.mtime !== -1) this.tentados.clear(); // cadastro atualizado: procura de novo
      this.cacheExternos = { mtime, mapa };
    }
    return this.cacheExternos.mapa;
  }

  /** Nome de perfil do WhatsApp, tirado das mensagens que o próprio cliente mandou. */
  async perfil(conv, instancias) {
    const jid = String(conv.contactIdentifier || '').endsWith('@s.whatsapp.net')
      ? conv.contactIdentifier
      : `${String(conv.contactPhone || '').replace(/\D/g, '')}@s.whatsapp.net`;
    if (jid.length < 25) return '';
    for (const inst of instancias) {
      let msgs = [];
      try {
        msgs = await this.evolution.recentMessages(inst, jid, 20);
      } catch {
        continue;
      }
      for (const m of msgs) {
        if (m?.key?.fromMe === false && valido(m.pushName)) return valido(m.pushName);
      }
    }
    return '';
  }

  /** Procura um nome para o contato da conversa: { nome, fonte } ou null. */
  async procurar(conv) {
    const k = chaveTelefone(conv.contactPhone) || chaveTelefone(conv.contactIdentifier);
    if (!k) return null;
    const { mapa, instancias } = await this.agenda();
    if (mapa.has(k)) return { nome: mapa.get(k), fonte: 'agenda' };
    const ext = this.externos();
    if (ext.has(k)) return { nome: ext.get(k), fonte: 'cadastro' };
    const p = await this.perfil(conv, instancias);
    return p ? { nome: p, fonte: 'perfil' } : null;
  }

  /** Dá nome aos contatos sem nome das conversas informadas. Devolve quantos foram preenchidos. */
  async preencher(convs) {
    if (!this.evolution?.configured) return 0;
    this.externos(); // se o cadastro externo mudou, volta a procurar quem tinha ficado sem nome
    const vistos = new Set();
    const fila = [];
    for (const c of convs) {
      if (c.contactId == null || vistos.has(c.contactId) || !semNome(c.contactName)) continue;
      vistos.add(c.contactId);
      const antes = this.tentados.get(c.contactId);
      if (antes && Date.now() - antes < this.validadeMs) continue; // já procurou há pouco e não achou
      fila.push(c);
    }
    let feitos = 0;
    for (const c of fila.slice(0, this.porVez)) {
      try {
        const achado = await this.procurar(c);
        if (!achado) {
          this.tentados.set(c.contactId, Date.now());
          continue;
        }
        await this.client.updateContact(c.contactId, { name: achado.nome });
        this.tentados.delete(c.contactId);
        feitos++;
        this.log.info(`[nomes] contato ${c.contactId}: nome preenchido (${achado.fonte})`);
      } catch (err) {
        this.tentados.set(c.contactId, Date.now());
        this.log.error(`[nomes] contato ${c.contactId}: ${err.message}`);
      }
    }
    return feitos;
  }

  /** Esquece o que já tentou (ex.: depois de atualizar o cadastro externo). */
  recomecar() {
    this.tentados.clear();
    this.cacheAgenda = null;
  }
}
