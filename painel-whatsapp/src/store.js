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

  write(name, data) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, f);
  }

  // Verificações: verificacoes/AAAA-MM-DD/HHMM.json
  saveCheck(date, time, data) {
    this.write(path.join('verificacoes', date, `${time.replace(':', '')}.json`), data);
  }

  getCheck(date, time) {
    return this.read(path.join('verificacoes', date, `${time.replace(':', '')}.json`), null);
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
