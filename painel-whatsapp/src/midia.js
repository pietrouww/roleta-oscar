// Busca áudios, fotos, vídeos e arquivos no Chatwoot e entrega ao app.
// Os arquivos ficam em cache no disco (o iPhone exige "Range" para tocar áudio e vídeo),
// e áudios do WhatsApp (ogg/opus) são convertidos para m4a, que toca em qualquer celular.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MAX_BYTES = 80 * 1024 * 1024;
const TIPOS = {
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf',
};
const EXT_POR_TIPO = Object.fromEntries(Object.entries(TIPOS).map(([e, t]) => [t, e]).reverse());

export class Midia {
  constructor({ dir, hostsPermitidos, logger = console }) {
    this.dir = path.join(dir, 'midia-cache');
    fs.mkdirSync(this.dir, { recursive: true });
    this.hosts = new Set(hostsPermitidos.filter(Boolean));
    this.log = logger;
    this.emAndamento = new Map();
    this.temFfmpeg = null;
  }

  /** Devolve { arquivo, tipo } pronto para enviar (baixa e converte na primeira vez). */
  async obter(anexo, tipoMidia) {
    const chave = String(anexo.id).replace(/[^\w-]/g, '');
    const pronto = this.achar(chave);
    if (pronto) return pronto;
    if (!this.emAndamento.has(chave)) {
      this.emAndamento.set(chave, this.baixar(anexo, tipoMidia, chave).finally(() => this.emAndamento.delete(chave)));
    }
    return this.emAndamento.get(chave);
  }

  achar(chave) {
    const nome = fs.readdirSync(this.dir).find((f) => f.startsWith(`${chave}.`) && !f.endsWith('.tmp'));
    if (!nome) return null;
    return { arquivo: path.join(this.dir, nome), tipo: TIPOS[path.extname(nome).toLowerCase()] || 'application/octet-stream' };
  }

  async baixar(anexo, tipoMidia, chave) {
    const url = new URL(anexo.data_url);
    if (!this.hosts.has(url.host)) throw new Error('Endereço de mídia fora do Chatwoot');
    // Os links de mídia do Chatwoot já são assinados: não mandamos token (ele poderia vazar num redirecionamento)
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!res.ok || !res.body) throw new Error(`Chatwoot respondeu ${res.status} ao buscar a mídia`);
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Arquivo grande demais');

    const tipoOrigem = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let ext = path.extname(url.pathname).toLowerCase();
    if (!/^\.\w{1,5}$/.test(ext)) ext = EXT_POR_TIPO[tipoOrigem] || '.bin';
    const bruto = path.join(this.dir, `${chave}${ext}.tmp`);
    let total = 0;
    const limite = async function* (fonte) {
      for await (const pedaco of fonte) {
        total += pedaco.length;
        if (total > MAX_BYTES) throw new Error('Arquivo grande demais');
        yield pedaco;
      }
    };
    await pipeline(Readable.fromWeb(res.body), limite, fs.createWriteStream(bruto));

    const tocaDireto = ['.m4a', '.mp3', '.wav'].includes(ext);
    if (tipoMidia === 'audio' && !tocaDireto && (await this.ffmpegDisponivel())) {
      const destino = path.join(this.dir, `${chave}.m4a`);
      try {
        await converter(bruto, `${destino}.tmp`);
        fs.renameSync(`${destino}.tmp`, destino);
        fs.rmSync(bruto, { force: true });
        return { arquivo: destino, tipo: 'audio/mp4' };
      } catch (err) {
        this.log.error('[midia] conversão do áudio falhou:', err.message);
        fs.rmSync(`${destino}.tmp`, { force: true });
      }
    }
    const final = path.join(this.dir, `${chave}${ext}`);
    fs.renameSync(bruto, final);
    return { arquivo: final, tipo: TIPOS[ext] || tipoOrigem || 'application/octet-stream' };
  }

  async ffmpegDisponivel() {
    if (this.temFfmpeg === null) {
      this.temFfmpeg = await new Promise((ok) => {
        const p = spawn('ffmpeg', ['-version']);
        p.on('error', () => ok(false));
        p.on('close', (c) => ok(c === 0));
      });
      if (!this.temFfmpeg) this.log.error('[midia] ffmpeg não encontrado: áudios serão entregues no formato original');
    }
    return this.temFfmpeg;
  }

  /** Apaga arquivos do cache com mais de `dias` dias. */
  limpar(dias = 7) {
    const corte = Date.now() - dias * 864e5;
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      try {
        if (fs.statSync(p).mtimeMs < corte) fs.rmSync(p, { force: true });
      } catch { /* já removido */ }
    }
  }
}

function converter(origem, destino) {
  return new Promise((ok, falha) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', origem, '-vn', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', destino]);
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error(erro.slice(0, 200) || `ffmpeg saiu com ${c}`))));
  });
}
