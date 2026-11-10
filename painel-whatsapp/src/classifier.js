// Regras que decidem se uma conversa está pendente.
//
// Três situações geram pendência:
//  - pediu_atendente:   o cliente pediu para falar com uma pessoa e nenhum humano respondeu depois.
//  - retorno_prometido: alguém da equipe disse "vou verificar", "já te retorno"... e não voltou a escrever.
//  - sem_resposta:      o cliente mandou a última mensagem e ninguém (nem a IA) respondeu.

export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROMISE_PATTERNS = [
  /\b(vou|vamos|irei|iremos) (te |lhe )?(verificar|ver|checar|conferir|confirmar|consultar|analisar|levantar|providenciar|averiguar|olhar|perguntar|pesquisar|buscar|solicitar|encaminhar|falar com)\b/,
  /\b(estou|estamos|to|tamo|ja estou|ja estamos) (verificando|vendo|checando|conferindo|confirmando|consultando|analisando|providenciando|levantando|olhando|averiguando|pesquisando|aguardando)\b/,
  /\b(vou|vamos|irei|iremos) (te |lhe )?(retornar|responder|avisar|passar|enviar|mandar|informar|atualizar|chamar|ligar)\b/,
  /\b(ja|logo) (te |lhe )?(retorno|retornamos|respondo|respondemos|aviso|avisamos|falo|falamos|chamo|chamamos|envio|enviamos|mando|mandamos)\b/,
  /\b(retorno|retornamos|respondo|respondemos|aviso|avisamos|te falo|te chamo|envio|enviamos)\b.{0,25}\b(em breve|assim que|logo|mais tarde|amanha|ainda hoje|no maximo|ate o fim|daqui a pouco|ja ja)\b/,
  /\bassim que (eu |a gente |nos )?(tiver|tivermos|souber|soubermos|confirmar|confirmarmos|verificar|verificarmos|receber|recebermos|conseguir)\b/,
  /\b(so |apenas )?(um|uma) (momento|minuto|minutinho|instante|segundo|segundinho)\b/,
  /\b(aguarde|aguarda|aguardem)\b/,
  /\b(ficamos|fico|fiquei|ficou) de\b/,
  /\bdeixa eu (ver|verificar|checar|confirmar|conferir|olhar)\b/,
  /\b(em breve|ja ja) (te |lhe )?(retorno|retornamos|respondo|respondemos|aviso|avisamos)\b/,
];

const ATTENDANT_PATTERNS = [
  /\b(atendente|atendentes|humano|humana)\b/,
  /\bpessoa (real|de verdade)\b/,
  /\b(falar|conversar) com (alguem|uma pessoa|um atendente|uma atendente|o atendente|a atendente|o vendedor|a vendedora|vendedor|responsavel|o responsavel|gerente|o gerente|suporte|o suporte|o dono|a dona|uma pessoa real)\b/,
  /\batendimento (humano|pessoal)\b/,
  /\b(nao quero|nao e|para de|chega de) .{0,15}\b(robo|bot|ia|maquina|automatico)\b/,
  /\b(e|eh|voce e|vc e|isso e) (um )?(robo|bot)\b/,
  /\btem alguem (ai|ae)\b/,
  /\bme (transfere|transfira|passa para|passe para)\b/,
];

const CLOSING = /^(ok|okay|okk+|ok obrigad[oa]|ok muito obrigad[oa]|obrigad[oa]|muito obrigad[oa]|obg|brigad[oa]|valeu|vlw|blz|beleza|show|perfeito|certo|combinado|tudo bem|tudo certo|ta bom|ta|ta certo|joia|top|otimo|entendi|entendido|beleza obrigad[oa]|de nada|bom dia|boa tarde|boa noite|ate mais|ate logo|tchau|amem|sim obrigad[oa]|perfeito obrigad[oa])$/;
const ONLY_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!.]+$/u;

export function buildMatchers(rules = {}) {
  const extraPromise = (rules.extraPromiseTerms || []).map((t) => new RegExp(`\\b${escape(normalize(t))}\\b`));
  const extraAttendant = (rules.extraAttendantTerms || []).map((t) => new RegExp(`\\b${escape(normalize(t))}\\b`));
  const promise = [...PROMISE_PATTERNS, ...extraPromise];
  const attendant = [...ATTENDANT_PATTERNS, ...extraAttendant];
  return {
    isPromise: (text) => {
      const n = normalize(text);
      return !!n && promise.some((re) => re.test(n));
    },
    isAttendantRequest: (text) => {
      const n = normalize(text);
      return !!n && attendant.some((re) => re.test(n));
    },
    isClosing: (text) => {
      const raw = (text || '').trim();
      if (!raw) return true; // texto vazio; mídia (foto, áudio) é tratada à parte via hasMedia
      if (ONLY_EMOJI.test(raw)) return true;
      const words = normalize(raw).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
      return !words || CLOSING.test(words);
    },
  };
}

/**
 * Classifica uma conversa.
 * @param {Array<{id:any, at:number, dir:'in'|'out', author:'cliente'|'humano'|'ia'|'celular', name?:string, text?:string, hasMedia?:boolean}>} messages em ordem cronológica
 * @param {object} opts { now, rules, matchers }
 */
export function classify(messages, opts = {}) {
  const now = opts.now ?? Date.now();
  const rules = opts.rules ?? {};
  const m = opts.matchers ?? buildMatchers(rules);
  const waitMin = (rules.waitMinMinutes ?? 15) * 60000;
  const promiseMin = (rules.promiseMinMinutes ?? 30) * 60000;

  const msgs = [...messages].sort((a, b) => a.at - b.at);
  const isHuman = (x) => x.dir === 'out' && x.author !== 'ia';
  const lastIdx = (pred) => {
    for (let i = msgs.length - 1; i >= 0; i--) if (pred(msgs[i])) return i;
    return -1;
  };

  const lastOut = lastIdx((x) => x.dir === 'out');
  const lastHumanOut = lastIdx(isHuman);
  const flags = [];

  // 1) Pediu atendente e nenhum humano respondeu depois
  let attendant = null;
  for (let i = lastHumanOut + 1; i < msgs.length; i++) {
    const x = msgs[i];
    if (x.dir === 'in' && m.isAttendantRequest(x.text)) {
      attendant = x;
      break;
    }
  }
  if (attendant) {
    flags.push({ type: 'pediu_atendente', since: attendant.at, text: attendant.text || '' });
  }

  // 2) Prometemos retorno e não voltamos a escrever
  const promiseIdx = lastIdx((x) => x.dir === 'out' && m.isPromise(x.text));
  if (promiseIdx !== -1) {
    const p = msgs[promiseIdx];
    const humanAfter = msgs.slice(promiseIdx + 1).some((x) => isHuman(x) && !m.isPromise(x.text));
    const aiAfter = p.author !== 'ia'
      ? false
      : msgs.slice(promiseIdx + 1).some((x) => x.dir === 'out' && !m.isPromise(x.text));
    // "Vou chamar alguém da equipe" dito pela IA já está coberto por "pediu atendente"
    const coveredByAttendant = p.author === 'ia' && !!attendant;
    if (!humanAfter && !aiAfter && !coveredByAttendant && now - p.at >= promiseMin) {
      flags.push({ type: 'retorno_prometido', since: p.at, text: p.text || '', by: p.name || '', byAuthor: p.author });
    }
  }

  // 3) Cliente falou por último e ninguém respondeu
  const tailIn = msgs.slice(lastOut + 1).filter((x) => x.dir === 'in');
  if (tailIn.length) {
    const meaningful = tailIn.filter((x) => x.hasMedia || !m.isClosing(x.text));
    const promised = flags.some((f) => f.type === 'retorno_prometido');
    const asked = flags.some((f) => f.type === 'pediu_atendente');
    if (meaningful.length && !asked && now - meaningful[0].at >= waitMin) {
      // Se já existe promessa pendente, a nova mensagem do cliente reforça a pendência
      flags.push({
        type: 'sem_resposta',
        since: meaningful[0].at,
        text: meaningful[meaningful.length - 1].text || (meaningful[meaningful.length - 1].hasMedia ? '[mídia]' : ''),
        alsoPromised: promised,
      });
    }
  }

  const aiInvolved = msgs.some((x) => x.author === 'ia');
  const lastHuman = lastHumanOut !== -1 ? msgs[lastHumanOut] : null;
  const since = flags.length ? Math.min(...flags.map((f) => f.since)) : null;

  return {
    pending: flags.length > 0,
    flags,
    since,
    waitingMinutes: since ? Math.max(0, Math.round((now - since) / 60000)) : 0,
    aiInvolved,
    lastHumanName: lastHuman?.name || '',
    lastMessage: msgs.length ? msgs[msgs.length - 1] : null,
  };
}
