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

  /**
   * Prepara um arquivo para envio pelo WhatsApp: nome seguro com a extensão certa e, para áudio gravado
   * no app (webm no Android/computador, mp4 no iPhone), conversão para mp3. A Evolution decide o tipo da
   * mensagem pela extensão: áudio com extensão de áudio chega ao cliente como mensagem de voz.
   * @param {{dados: Buffer, nome: string, tipo: string}} arquivo
   * @param {{voz?: boolean}} opcoes `voz`: áudio gravado na hora
   */
  async prepararEnvio(arquivo, { voz = false } = {}) {
    let { dados } = arquivo;
    let tipo = String(arquivo.tipo || '').split(';')[0].trim().toLowerCase();
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(tipo)) tipo = 'application/octet-stream';
    let nome = nomeSeguro(arquivo.nome);
    let ext = path.extname(nome).toLowerCase();
    const ehAudio = voz || tipo.startsWith('audio/');
    if (ehAudio && (voz || !AUDIO_PRONTO.includes(ext))) {
      const base = voz ? `audio-${carimbo()}` : path.basename(nome, ext) || 'audio';
      if (await this.ffmpegDisponivel()) {
        dados = await this.converterBuffer(dados, ['-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3']);
        nome = `${base}.mp3`;
        tipo = 'audio/mpeg';
      } else {
        // Sem conversor: manda como está, com extensão de áudio para não virar "vídeo" no WhatsApp
        nome = `${base}${tipo.includes('mp4') ? '.m4a' : '.ogg'}`;
      }
      ext = path.extname(nome);
    }
    if (!ext) nome += EXT_POR_TIPO[tipo] || '';
    return { dados, nome, tipo };
  }

  /** Passa um arquivo em memória pelo ffmpeg e devolve o resultado. */
  async converterBuffer(dados, args) {
    const base = path.join(this.dir, `envio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const entrada = `${base}.in.tmp`;
    const saida = `${base}.out.tmp`;
    fs.writeFileSync(entrada, dados);
    try {
      await ffmpeg(['-y', '-loglevel', 'error', '-i', entrada, ...args, saida]);
      return fs.readFileSync(saida);
    } finally {
      fs.rmSync(entrada, { force: true });
      fs.rmSync(saida, { force: true });
    }
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
  return ffmpeg(['-y', '-loglevel', 'error', '-i', origem, '-vn', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', destino]);
}

function ffmpeg(args) {
  return new Promise((ok, falha) => {
    const p = spawn('ffmpeg', args);
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error(erro.slice(0, 200) || `ffmpeg saiu com ${c}`))));
  });
}

// Áudios que o WhatsApp (via Evolution) já reconhece como áudio pela extensão
const AUDIO_PRONTO = ['.mp3', '.m4a', '.ogg', '.oga', '.opus', '.wav', '.aac'];

const carimbo = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** Nome de arquivo sem acentos, barras ou caracteres estranhos (vai parar no endereço do arquivo no Chatwoot). */
export function nomeSeguro(nome) {
  const limpo = String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-80);
  return limpo || 'arquivo';
}
