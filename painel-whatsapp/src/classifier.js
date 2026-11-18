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

// Respostas automáticas do WhatsApp Business (ausência / saudação / "recebemos sua mensagem").
// Não contam como resposta: a conversa continua pendente até alguém responder de verdade.
const AUTO_REPLY_PATTERNS = [
  /\b(no momento|neste momento|agora) (nao|nao) (estamos|podemos|conseguimos|e possivel)\b/,
  /\bfora do (nosso )?horario\b/,
  /\bhorario de (atendimento|funcionamento)\b/,
  /\b(estamos|estou) (ausentes?|fechados?|indisponiveis?|offline)\b/,
  /\bmensagem (automatica|de ausencia)\b/,
  /\bobrigad[oa] (por|pelo|pela) (entrar em |seu |sua |o |a )?(contato|mensagem)\b/,
  /\b(recebemos|recebi) (a |sua |tua )?mensagem\b/,
  /\b(retornaremos|responderemos|entraremos em contato)\b.{0,30}\b(em breve|assim que|o mais (breve|rapido)|logo|possivel)\b/,
  /^(ola|oi|bom dia|boa tarde|boa noite)\W+aqui e (a|o)\b.{60,}/, // saudação longa da empresa (não "oi, aqui é a Dayane")
  /\bpara facilitar (o |seu )?atendimento\b/,
];

const CLOSING = /^(ok|okay|okk+|ok obrigad[oa]|ok muito obrigad[oa]|obrigad[oa]|muito obrigad[oa]|obg|brigad[oa]|valeu|vlw|blz|beleza|show|perfeito|certo|combinado|tudo bem|tudo certo|ta bom|ta|ta certo|joia|top|otimo|entendi|entendido|beleza obrigad[oa]|de nada|bom dia|boa tarde|boa noite|ate mais|ate logo|tchau|amem|sim obrigad[oa]|perfeito obrigad[oa])$/;
// Palavras de confirmação/agradecimento: mensagem feita só delas não pede resposta ("ok, aguardo obrigado")
const ACK_WORDS = new Set(('ok okay okk okkk blz beleza show perfeito certo combinado tudo bem certinho ta bom joia top otimo otima ' +
  'maravilha entendi entendido obrigado obrigada obg obgd brigado brigada valeu vlw muito mt agradeco grato grata de nada ' +
  'aguardo aguardando fico no aguardando aguardamos sim isso ai fechado feito pode ser sem problemas tranquilo tranquila ' +
  'bom dia boa tarde noite ate mais logo amanha tchau abraco abracos amem deus abencoe kkk kkkk kkkkk rs rsrs haha hahaha ' +
  'e a o de pra para entao ja').split(' '));

// Informes que não pedem resposta (cliente avisando, sem pergunta)
const NO_REPLY_PATTERNS = [
  /^(ja )?(to|tou|estou|estamos|ja estou) (chegando|indo|saindo|a caminho|no caminho)\b/,
  /^(chego|chegamos|passo ai|passo la|vou passar) (em|daqui|logo|mais tarde|amanha|hoje|depois)\b/,
  /\b(fiz|fizemos|feito|mandei|enviei|ja fiz|ja mandei|ja enviei) (o )?(pix|pagamento|transferencia|deposito)\b(?!.*\?)/,
  /^(vou|vamos) (ver|pensar|verificar|conversar|falar)( com\b.*)? e (te |lhe )?(aviso|falo|retorno|digo)\b/,
  /^(depois|amanha|mais tarde) (te |lhe )?(aviso|falo|retorno|chamo)\b/,
];

// Pergunta ou pedido explícito
const QUESTION_START = /^(qual|quais|quanto|quantos|quantas|quando|como|onde|aonde|porque|por que|pq|quem|o que|oque|que horas|tem|teria|voces tem|vcs tem|pode|podem|poderia|consegue|conseguem|da pra|daria|sera|e possivel|ainda|ja esta|ja ta|esta pronto|ta pronto|fica pronto)\b/;
const REQUEST_WORDS = /\b(preciso|precisava|gostaria|queria|quero|quer(ia)? saber|me (manda|envia|passa|fala|diz|avisa|liga|retorna)|orcamento|orcar|valor|preco|quanto (custa|fica|sai)|agendar|marcar|horario|disponivel|disponibilidade|retirar|buscar|garantia|problema|defeito|nao (liga|carrega|funciona|deu|esta|ta)|parou|quebrou|travou|urgente|ajuda|duvida|ainda nao)\b/;

// Cotação/lista de preços enviada por fornecedor (sem pergunta)
const PRICE = /(r\$\s*\d|\b\d{1,3}(\.\d{3})*,\d{2}\b)/g;
const QUOTE_WORDS = /\b(cotacao|orcamento segue|segue (o )?(orcamento|valor|valores|cotacao|tabela|lista)|tabela|lista de precos|valor unitario|unitario|un\b|und\b|pc\b|pcs\b|peca|pecas|estoque|a vista|avista|no pix|frete|prazo de entrega|pronta entrega|original|paralela|incell|oled|tela|bateria|modelo)\b/;

const ONLY_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!.]+$/u;

export function buildMatchers(rules = {}) {
  const extraPromise = (rules.extraPromiseTerms || []).map((t) => new RegExp(`\\b${escape(normalize(t))}\\b`));
  const extraAttendant = (rules.extraAttendantTerms || []).map((t) => new RegExp(`\\b${escape(normalize(t))}\\b`));
  const promise = [...PROMISE_PATTERNS, ...extraPromise];
  const attendant = [...ATTENDANT_PATTERNS, ...extraAttendant];
  const extraAuto = (rules.autoReplyTerms || []).map((t) => new RegExp(`\\b${escape(normalize(t))}\\b`));
  const auto = [...AUTO_REPLY_PATTERNS, ...extraAuto];
  return {
    isAutoReply: (text) => {
      const n = normalize(text).replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
      return !!n && auto.some((re) => re.test(n));
    },
    isPromise: (text) => {
      const n = normalize(text);
      return !!n && promise.some((re) => re.test(n));
    },
    isAttendantRequest: (text) => {
      const n = normalize(text);
      return !!n && attendant.some((re) => re.test(n));
    },
    /** Mensagem do cliente pede resposta? Retorna 'pergunta' | 'mensagem' | null */
    needsReply: (x) => {
      if (x.hasMedia) return 'midia';
      const raw = (x.text || '').trim();
      if (!raw || ONLY_EMOJI.test(raw)) return null;
      const n = normalize(raw).replace(/[*_~]/g, ' ');
      const words = n.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (!words) return null;
      const temPergunta = raw.includes('?') || QUESTION_START.test(words);
      if (temPergunta) return 'pergunta';
      if (CLOSING.test(words) || words.split(' ').every((w) => ACK_WORDS.has(w))) return null;
      if (supplierQuote(n)) return null;
      if (NO_REPLY_PATTERNS.some((re) => re.test(words))) return null;
      if (REQUEST_WORDS.test(words)) return 'pedido';
      return 'mensagem';
    },
    isSupplierQuote: (text) => supplierQuote(normalize(text || '')),
    isClosing: (text) => {
      const raw = (text || '').trim();
      if (!raw) return true; // texto vazio; mídia (foto, áudio) é tratada à parte via hasMedia
      if (ONLY_EMOJI.test(raw)) return true;
      const words = normalize(raw).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
      return !words || CLOSING.test(words);
    },
  };
}

/** Lista/cotação de preços (fornecedor): tem preço, não tem pergunta, e parece tabela ou cotação. */
function supplierQuote(n) {
  if (!n || n.includes('?')) return false;
  const precos = n.match(PRICE) || [];
  if (!precos.length) return false;
  return precos.length >= 2 || QUOTE_WORDS.test(n);
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

  // Respostas automáticas (ausência/saudação) enviadas fora do Chatwoot são ignoradas
  const msgs = [...messages]
    .filter((x) => !(x.dir === 'out' && x.author !== 'humano' && m.isAutoReply && m.isAutoReply(x.text)))
    .sort((a, b) => a.at - b.at);
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
    // Só conta o que pede resposta: pergunta, pedido, mídia (áudio/foto) ou relato; não conta "ok/aguardo",
    // avisos ("estou chegando", "fiz o pix") nem cotação de fornecedor
    const motivos = tailIn.map((x) => (m.needsReply ? m.needsReply(x) : (x.hasMedia || !m.isClosing(x.text) ? 'mensagem' : null)));
    // Cumprimento sozinho ("boa tarde") abrindo conversa nova (sem nossa mensagem nas últimas 2h) pede resposta
    const GREETING = /^(oi|ola|opa|bom dia|boa tarde|boa noite|oi bom dia|oi boa tarde|oi boa noite|ola bom dia|ola boa tarde|ola boa noite|tudo bem|oi tudo bem)$/;
    const prevOut = lastOut !== -1 ? msgs[lastOut] : null;
    if (!motivos.some(Boolean) && (!prevOut || tailIn[0].at - prevOut.at > 2 * 3600000)) {
      const i = tailIn.findIndex((x) => GREETING.test(normalize(x.text || '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()));
      if (i !== -1) motivos[i] = 'mensagem';
    }
    const meaningful = tailIn.filter((x, i) => motivos[i]);
    const motivo = ['pergunta', 'pedido', 'midia', 'mensagem'].find((k) => motivos.includes(k)) || null;
    const promised = flags.some((f) => f.type === 'retorno_prometido');
    const asked = flags.some((f) => f.type === 'pediu_atendente');
    if (meaningful.length && !asked && now - meaningful[0].at >= waitMin) {
      // Se já existe promessa pendente, a nova mensagem do cliente reforça a pendência
      flags.push({
        type: 'sem_resposta',
        since: meaningful[0].at,
        text: meaningful[meaningful.length - 1].text || (meaningful[meaningful.length - 1].hasMedia ? '[mídia]' : ''),
        alsoPromised: promised,
        motivo,
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
