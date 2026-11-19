// Armazenamento simples em arquivos JSON dentro de DATA_DIR.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'verificacoes'), { recursive: true });
  }

  file(name) {
    return path.join(this.dir, name);
  }

  read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  write(name, data, mode) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
    fs.renameSync(tmp, f);
  }

  // Contatos que a equipe mandou ignorar na verificação de pendências
  listIgnored() {
    return this.read('ignorados.json', []);
  }

  ignoredIds() {
    return new Set(this.listIgnored().map((x) => String(x.contactId)));
  }

  addIgnored(entry) {
    const list = this.listIgnored().filter((x) => String(x.contactId) !== String(entry.contactId));
    list.push(entry);
    list.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    this.write('ignorados.json', list);
  }

  removeIgnored(contactId) {
    this.write('ignorados.json', this.listIgnored().filter((x) => String(x.contactId) !== String(contactId)));
  }

  // Marcações da equipe por conversa: { [conversaId]: { manual, adiar, dispensa } }
  getMarks() {
    return this.read('marcacoes.json', {});
  }

  setMark(convId, tipo, valor) {
    const all = this.getMarks();
    const m = { ...(all[convId] || {}) };
    if (valor == null) delete m[tipo];
    else m[tipo] = valor;
    if (Object.keys(m).length) all[convId] = m;
    else delete all[convId];
    this.write('marcacoes.json', all);
  }

  // Verificações: verificacoes/AAAA-MM-DD/HHMM.json
  saveCheck(date, time, data) {
    this.write(path.join('verificacoes', date, `${time.replace(':', '')}.json`), data);
  }

  getCheck(date, time) {
    return this.read(path.join('verificacoes', date, `${time.replace(':', '')}.json`), null);
  }

  /** Dias (AAAA-MM-DD) que têm verificações guardadas, do mais antigo para o mais novo. */
  listCheckDays() {
    const d = path.join(this.dir, 'verificacoes');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  }

  listChecks(date) {
    const d = path.join(this.dir, 'verificacoes', date);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d)
      .filter((f) => /^\d{4}\.json$/.test(f))
      .map((f) => `${f.slice(0, 2)}:${f.slice(2, 4)}`)
      .sort();
  }
}
