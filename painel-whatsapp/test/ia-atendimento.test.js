// IA de atendimento (assistente virtual no WhatsApp): reconhecer as respostas dela, saber quando é ela
// quem está cuidando da conversa e quando ela chamou a equipe e ninguém assumiu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, buildMatchers, nomeDaIa } from '../src/classifier.js';
import { toClassifierMessages } from '../src/chatwoot.js';
import { montarTranscricao } from '../src/ia.js';
import { PendenciasEngine } from '../src/pendencias.js';

const agora = Date.now();
const min = (n) => agora - n * 60000;
const seg = (n) => Math.floor(min(n) / 1000);
const quieto = { error() {}, info() {} };
const m = buildMatchers({});
const cli = (id, n, text, extra = {}) => ({ id, at: min(n), dir: 'in', author: 'cliente', text, ...extra });
const ia = (id, n, text) => ({ id, at: min(n), dir: 'out', author: 'ia', name: 'IA', text });
const eq = (id, n, text) => ({ id, at: min(n), dir: 'out', author: 'celular', name: 'Equipe (celular)', text });
const APRESENTA = 'Olá, Andressa! Eu sou o Steve, assistente da i2Brothers. 😊 Como posso te ajudar hoje?';
const REPASSA = 'Torres, já vou te conectar com nosso técnico para confirmar a disponibilidade da peça.';

test('reconhece a IA pelo código da mensagem do WhatsApp e o nome com que ela se apresenta', () => {
  const brutas = [
    { id: 1, message_type: 0, created_at: seg(30), content: 'Oi', sender_type: 'Contact' },
    { id: 2, message_type: 1, created_at: seg(29), content: APRESENTA, sender_type: 'User', sender: { name: 'Celular' }, source_id: 'WAID:CE6F0123456789ABCDEF' },
    { id: 3, message_type: 1, created_at: seg(20), content: 'R$ 120,00', sender_type: 'User', sender: { name: 'Celular' }, source_id: 'WAID:2A600123456789ABCDEF' },
  ];
  const msgs = toClassifierMessages(brutas, {});
  assert.equal(msgs[1].author, 'ia');
  assert.equal(msgs[2].author, 'celular');
  assert.equal(nomeDaIa(msgs), 'Steve');
  assert.equal(nomeDaIa([ia(1, 5, 'Sou a Bia, sua assistente virtual.')]), 'Bia');
  assert.equal(nomeDaIa([eq(1, 5, 'Eu sou o Pedro, assistente técnico')]), '', 'só vale para mensagem da IA');
});

test('frases em que a IA passa a conversa para a equipe', () => {
  for (const t of [REPASSA, 'Vou transferir você para um atendente.', 'Estou encaminhando seu caso para a nossa equipe.', 'Um técnico vai te responder em instantes.', 'Seu atendimento foi transferido para o setor responsável.'])
    assert.equal(m.isHandoff(t), true, t);
  for (const t of ['O prazo da tampa traseira depende da disponibilidade da peça.', 'Aceitamos link de pagamento e pix.', 'Nosso técnico é certificado pela Apple.'])
    assert.equal(m.isHandoff(t), false, t);
});

test('IA respondeu por último: conversa está com a IA e não é pendência', () => {
  const r = classify([cli(1, 40, 'Qual o valor da troca de tela?'), ia(2, 39, 'A troca de tela do iPhone 13 fica R$ 899, em até 10x.')], { now: agora, matchers: m });
  assert.equal(r.pending, false);
  assert.equal(r.atendimento.por, 'ia');
  assert.equal(r.atendimento.repasse, false);
});

test('IA chamou a equipe e ninguém assumiu: pendência urgente, marcada como vinda da IA', () => {
  const msgs = [cli(1, 50, 'Tem a tampa traseira do 14 Pro?'), ia(2, 49, APRESENTA), cli(3, 48, 'Quero trocar hoje'), ia(4, 47, REPASSA), cli(5, 46, 'ok')];
  const r = classify(msgs, { now: agora, matchers: m });
  assert.equal(r.pending, true);
  assert.equal(r.flags.length, 1);
  assert.deepEqual({ type: r.flags[0].type, viaIa: r.flags[0].viaIa, byAuthor: r.flags[0].byAuthor }, { type: 'pediu_atendente', viaIa: true, byAuthor: 'ia' });
  assert.equal(r.flags[0].since, min(47));
  assert.equal(r.atendimento.por, 'ia');
  assert.equal(r.atendimento.repasse, true);
  assert.equal(r.atendimento.iaNome, 'Steve');
});

test('alguém da equipe assumiu depois da IA: deixa de ser pendência e a conversa passa para a equipe', () => {
  const msgs = [cli(1, 50, 'Tem a tampa traseira?'), ia(2, 49, REPASSA), eq(3, 30, 'Temos sim, R$ 399. Pode trazer hoje.')];
  const r = classify(msgs, { now: agora, matchers: m });
  assert.equal(r.pending, false);
  assert.equal(r.atendimento.por, 'equipe');
  assert.equal(r.atendimento.ia, true);
  assert.equal(r.atendimento.repasse, false);
});

test('transcrição para a análise separa IA de mensagem automática', () => {
  const t = montarTranscricao(
    [cli(1, 50, 'Oi'), ia(2, 49, 'Olá! No momento não estamos atendendo. Nosso horário de atendimento é das 9h às 18h.'), ia(3, 48, 'O reparo fica R$ 399.'), eq(4, 40, 'Pode trazer')],
    { now: agora, timeZone: 'America/Sao_Paulo', ehAuto: m.isAutoReply },
  );
  assert.match(t, /\[2\] .* AUTOMÁTICO: Olá! No momento/);
  assert.match(t, /\[3\] .* IA: O reparo fica/);
  assert.match(t, /\[4\] .* ATENDENTE \(Equipe \(celular\)\): Pode trazer/);
});

// ---------- No motor: lista de quem está atendendo + rede de segurança sobre a análise ----------
function motor({ analise, mensagens }) {
  const marcas = { getMarks: () => ({}), setMark() {} };
  const client = {
    listInboxes: async () => [{ id: 2, name: 'Atendimento' }],
    listConversations: async (st) => (st === 'open' ? [{ id: 70, inboxId: 2, status: 'open', labels: [], lastActivityAt: agora - 60000, contactId: 9, contactName: 'Torres', contactPhone: '+5541', contactIdentifier: '', assigneeName: '' }] : []),
    listMessages: async () => mensagens,
    setLabels: async () => {},
  };
  const iaAnalise = analise === undefined ? null : { ativo: true, emCache: () => undefined, analisar: async () => analise, salvar() {}, status: () => ({ ativa: true }) };
  const config = {
    chatwoot: { inboxIds: [], maxMessages: 60, publicUrl: '', accountId: '1' },
    rules: { waitMinMinutes: 15, promiseMinMinutes: 30 },
    labels: { sync: false, pendencia: 'pendencia', ignorar: 'ignorar-pendencia' },
    ia: { maxDias: 14, maxPorVarredura: 40 },
  };
  return new PendenciasEngine({ client, config, ia: iaAnalise, marcas, logger: quieto });
}
const bruta = (id, n, content, tipo, waid) => ({ id, message_type: tipo, created_at: seg(n), content, sender_type: tipo ? 'User' : 'Contact', sender: tipo ? { name: 'Celular' } : { name: 'Torres' }, ...(waid ? { source_id: `WAID:${waid}` } : {}) });

test('motor: informa as conversas em que a IA está atendendo', async () => {
  const r = await motor({ mensagens: [bruta(1, 40, 'Qual o valor da tela?', 0), bruta(2, 39, 'Eu sou o Steve, assistente da i2Brothers. A tela fica R$ 899.', 1, 'CE0200000000000000AA')] }).scan();
  assert.equal(r.items.length, 0);
  assert.deepEqual({ por: r.quem[70].por, nome: r.quem[70].iaNome, repasse: r.quem[70].repasse }, { por: 'ia', nome: 'Steve', repasse: false });
});

test('motor: IA chamou a equipe vira pendência mesmo se a análise disser que está respondido', async () => {
  const mensagens = [bruta(1, 50, 'Tem a tampa traseira?', 0), bruta(2, 49, REPASSA, 1, 'CE6B00000000000000AA')];
  const nada = { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'IA respondeu', proximoPasso: '', indice: -1 };
  const r = await motor({ analise: nada, mensagens }).scan();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].primary, 'pediu_atendente');
  assert.equal(r.items[0].flags[0].viaIa, true);
  assert.equal(r.items[0].urgencia, 'alta');
  assert.match(r.items[0].resumo, /IA disse que ia chamar a equipe/);
  assert.equal(r.quem[70].repasse, true);
});

// Caso real: cliente pergunta o preço, a IA responde com o valor e devolve uma pergunta. A análise
// inteligente marcou "sem resposta"; pela ordem das mensagens a vez é do cliente, então não é pendência.
const PRECO = 'Bom dia, Ary! Para o **iPhone 14 Pro Max**, a troca da tampa traseira de vidro é **R$ 599,00**. Peça com qualidade da original. Quer agendar para trazer o aparelho e fazermos a avaliação?';
const semResposta = { pendente: true, tipo: 'sem_resposta', urgencia: 'media', resumo: 'Cliente perguntou o preço da troca da tampa traseira', proximoPasso: 'Responder o cliente', indice: 0 };

test('motor: IA respondeu o preço por último não é "sem resposta", mesmo que a análise diga que é', async () => {
  const mensagens = [bruta(1, 59, 'bom dia, qual o preço pra troca da tampa traseira de vidro do iphone 14 pro max?', 0), bruta(2, 58, PRECO, 1, 'CE4300000000000000AA')];
  const r = await motor({ analise: semResposta, mensagens }).scan();
  assert.equal(r.items.length, 0);
  assert.equal(r.quem[70].por, 'ia');
  assert.equal(r.quem[70].respondeuPorUltimo, true);
});

test('motor: se o cliente escreveu depois da IA, a análise continua valendo', async () => {
  const mensagens = [bruta(1, 59, 'qual o preço da tampa traseira?', 0), bruta(2, 58, PRECO, 1, 'CE4300000000000000AA'), bruta(3, 30, 'Quero sim, tem horário hoje às 15h?', 0)];
  const r = await motor({ analise: { ...semResposta, indice: 2 }, mensagens }).scan();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].primary, 'sem_resposta');
});

test('motor: análise que aponta promessa ou pedido de atendente não é derrubada pela resposta da IA', async () => {
  const mensagens = [bruta(1, 59, 'tem a peça?', 0), bruta(2, 58, 'Preciso checar o estoque com o pessoal, um instante.', 1, 'CE4300000000000000AA')];
  const promessa = { pendente: true, tipo: 'retorno_prometido', urgencia: 'media', resumo: 'IA ficou de checar o estoque', proximoPasso: 'Confirmar a peça', indice: 1 };
  const r = await motor({ analise: promessa, mensagens }).scan();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].primary, 'retorno_prometido');
});
