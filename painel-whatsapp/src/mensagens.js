// Cache das mensagens brutas do Chatwoot, compartilhado entre a análise de pendências e a tela de conversa.
// Abrir uma conversa que já foi lida custa no máximo 1 chamada ao Chatwoot (a página mais recente),
// em vez de reler todas as páginas a cada vez.

const PAGINA = 20; // o Chatwoot devolve 20 mensagens por página

const ordenar = (lista) => {
  const vistos = new Set();
  return lista
    .filter((x) => (vistos.has(x.id) ? false : vistos.add(x.id)))
    .sort((a, b) => a.created_at - b.created_at || a.id - b.id);
};

export class CacheMensagens {
  constructor(client, { maxEntradas = 400 } = {}) {
    this.client = client;
    this.maxEntradas = maxEntradas;
    this.mapa = new Map(); // conversaId -> { raw, completo, lastActivityAt, at }
    this.emCurso = new Map(); // conversaId -> Promise (evita buscas repetidas ao mesmo tempo)
  }

  /** O que já está guardado, sem ir ao Chatwoot (ou null). */
  guardado(id) {
    return this.mapa.get(Number(id)) || null;
  }

  esquecer(id) {
    this.mapa.delete(Number(id));
  }

  /** Mensagens em ordem cronológica (formato bruto do Chatwoot). */
  async obter(id, opts = {}) {
    return (await this.obterDetalhe(id, opts)).raw;
  }

  /**
   * @param {number} id conversa
   * @param {{max?: number, lastActivityAt?: number|null}} opts `lastActivityAt` igual ao guardado = nada mudou, não consulta
   * @returns {Promise<{raw: object[], completo: boolean}>} `completo`: já tem a conversa desde a primeira mensagem
   */
  async obterDetalhe(id, { max = 60, lastActivityAt = null } = {}) {
    id = Number(id);
    const c = this.mapa.get(id);
    const cobre = c && (c.completo || c.raw.length >= max);
    if (cobre && lastActivityAt != null && c.lastActivityAt === lastActivityAt) return c;

    const chave = `${id}:${max}`;
    if (this.emCurso.has(chave)) return this.emCurso.get(chave);
    const p = this._buscar(id, max, lastActivityAt, c).finally(() => this.emCurso.delete(chave));
    this.emCurso.set(chave, p);
    return p;
  }

  async _buscar(id, max, lastActivityAt, c) {
    let raw;
    let completo;
    if (typeof this.client.listMessagesPage !== 'function') {
      // Cliente simples (testes): lê tudo de uma vez
      raw = ordenar(await this.client.listMessages(id, max));
      completo = raw.length < max;
    } else {
      const lote = await this.client.listMessagesPage(id);
      const menorId = (l) => l.reduce((m, x) => (x.id < m ? x.id : m), l[0].id);
      if (lote.length < PAGINA) {
        raw = ordenar(lote);
        completo = true;
      } else {
        const corte = menorId(lote);
        const maisNovo = c?.raw.length ? c.raw[c.raw.length - 1].id : null;
        if (c && maisNovo != null && corte <= maisNovo) {
          // A página mais recente emenda com o que já estava guardado
          raw = ordenar([...c.raw.filter((x) => x.id < corte), ...lote]);
          completo = c.completo;
        } else {
          raw = ordenar(lote);
          completo = false;
        }
      }
      // Volta páginas até ter o que foi pedido
      let antes = raw.length ? menorId(raw) : null;
      while (!completo && raw.length < max && antes != null) {
        const mais = await this.client.listMessagesPage(id, antes);
        if (!mais.length) { completo = true; break; }
        const novoMenor = menorId(mais);
        raw = ordenar([...mais, ...raw]);
        if (mais.length < PAGINA || novoMenor === antes) { completo = true; break; }
        antes = novoMenor;
      }
    }
    const entrada = { raw, completo, lastActivityAt: lastActivityAt ?? c?.lastActivityAt ?? null, at: Date.now() };
    this.mapa.delete(id);
    this.mapa.set(id, entrada);
    while (this.mapa.size > this.maxEntradas) this.mapa.delete(this.mapa.keys().next().value);
    return entrada;
  }
}
