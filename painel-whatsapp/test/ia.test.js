// Análise com IA (cliente falso) + marcações da equipe (marcar, adiar, dispensar).
import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { Analisador, montarTranscricao, normalizar } from '../src/ia.js';
import { PendenciasEngine } from '../src/pendencias.js';

const agora = Date.now();
const seg = (minAtras) => Math.floor((agora - minAtras * 60000) / 1000);
const quieto = { error() {}, info() {} };

function clienteFalso(respostas) {
  const pedidos = [];
  const responder = async (p) => {
    pedidos.push(p);
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { pedidos, messages: { create: responder }, beta: { messages: { create: responder } } };
}
const json = (o) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }] });
const msgs = [
  { id: 1, at: agora - 90 * 60000, dir: 'in', author: 'cliente', text: 'Vocês conseguem entregar até sexta?' },
  { id: 2, at: agora - 80 * 60000, dir: 'out', author: 'humano', name: 'Bruno', text: 'Deixa comigo, olho isso com o pessoal da logística.' },
];

test('transcrição numerada com papéis e mídia', () => {
  const t = montarTranscricao([...msgs, { id: 3, at: agora, dir: 'in', author: 'cliente', text: '', hasMedia: true, mediaKind: 'áudio' }], { now: agora, timeZone: 'America/Sao_Paulo' });
  assert.match(t, /\[1\] .* CLIENTE: Vocês conseguem/);
  assert.match(t, /\[2\] .* ATENDENTE \(Bruno\): Deixa comigo/);
  assert.match(t, /\[3\] .* CLIENTE: \[áudio\]/);
});

test('normaliza a resposta da IA', () => {
  const r = normalizar({ pendente: true, tipo: 'retorno_prometido', urgencia: 'x', resumo: 'a', proximo_passo: 'b', mensagem_inicio: 2 }, 2);
  assert.deepEqual(r, { pendente: true, tipo: 'retorno_prometido', urgencia: 'media', resumo: 'a', proximoPasso: 'b', indice: 1 });
  assert.equal(normalizar({ pendente: true, tipo: 'nenhuma' }, 2).pendente, false);
  assert.equal(normalizar({ pendente: true, tipo: 'sem_resposta', mensagem_inicio: 9 }, 2).indice, -1);
});

test('analisa, usa saída estruturada e guarda em cache', async () => {
  const cli = clienteFalso([json({ pendente: true, tipo: 'retorno_prometido', urgencia: 'media', resumo: 'Quer entrega até sexta', proximo_passo: 'Confirmar com a logística', mensagem_inicio: 2 })]);
  const ia = new Analisador({ client: cli, model: 'claude-haiku-5-5', logger: quieto });
  const r = await ia.analisar(7, msgs, agora);
  assert.equal(r.tipo, 'retorno_prometido');
  assert.equal(r.indice, 1);
  const p = cli.pedidos[0];
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.tool_choice, undefined);
  assert.equal(p.thinking, undefined);
  await ia.analisar(7, msgs, agora);
  assert.equal(cli.pedidos.length, 1, 'segunda vez vem do cache');
});

test('recusa, erro da API e chave inválida caem para as regras (null)', async () => {
  const erro401 = new Anthropic.AuthenticationError(401, { error: { message: 'x' } }, 'x', new Headers());
  const cli = clienteFalso([{ stop_reason: 'refusal', content: [] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] }, erro401]);
  const ia = new Analisador({ client: cli, model: 'claude-haiku-5-5', logger: quieto });
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.match(ia.status().ultimoErro, /Chave da API inválida/);
  assert.equal(ia.disponivel, false, 'pausa depois de chave inválida');
});

test('opus 5.5 pede fallback de recusa e desiste dele se a API não aceitar', async () => {
  const erro400 = new Anthropic.BadRequestError(400, { error: { message: 'x' } }, 'x', new Headers());
  const cli = clienteFalso([erro400, json({ pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'ok', proximo_passo: '', mensagem_inicio: 0 })]);
  const ia = new Analisador({ client: cli, logger: quieto });
  const r = await ia.analisar(3, msgs, agora);
  assert.equal(r.pendente, false);
  assert.equal(cli.pedidos[0].fallbacks, 'default');
  assert.equal(cli.pedidos[1].fallbacks, undefined);
});

// ---------- Motor com IA + marcações ----------
function motor({ analise, marcas = {}, mensagens }) {
  const marcasObj = { dados: marcas, getMarks() { return this.dados; }, setMark(id, t, v) { this.dados[id] = { ...(this.dados[id] || {}) }; if (v == null) delete this.dados[id][t]; else this.dados[id][t] = v; } };
  const client = {
    listInboxes: async () => [{ id: 1, name: 'Comercial' }],
    listConversations: async (st) => (st === 'open' ? [{ id: 50, inboxId: 1, status: 'open', labels: [], lastActivityAt: agora - 60000, contactId: 9, contactName: 'Cliente', contactPhone: '+5541', contactIdentifier: '', assigneeName: 'Bruno' }] : []),
    listMessages: async () => mensagens,
    setLabels: async () => {},
  };
  const ia = { ativo: true, emCache: () => undefined, analisar: async () => analise, salvar() {}, status: () => ({ ativa: true }) };
  const config = {
    chatwoot: { inboxIds: [], maxMessages: 60, publicUrl: '', accountId: '1' },
    rules: { waitMinMinutes: 15, promiseMinMinutes: 30 },
    labels: { sync: false, pendencia: 'pendencia', ignorar: 'ignorar-pendencia' },
    ia: { maxDias: 14, maxPorVarredura: 40 },
  };
  return { engine: new PendenciasEngine({ client, config, ia, marcas: marcasObj, logger: quieto }), marcasObj };
}
const brutas = [
  { id: 1, message_type: 0, created_at: seg(90), content: 'Vocês conseguem entregar até sexta?', sender_type: 'Contact' },
  { id: 2, message_type: 1, created_at: seg(80), content: 'Deixa comigo, olho isso com o pessoal da logística.', sender_type: 'User', sender: { name: 'Bruno' } },
];
const prometeu = { pendente: true, tipo: 'retorno_prometido', urgencia: 'alta', resumo: 'Quer entrega até sexta', proximoPasso: 'Confirmar com a logística', indice: 1 };

test('IA pega promessa que as regras não pegam', async () => {
  const { engine } = motor({ analise: prometeu, mensagens: brutas });
  const r = await engine.scan();
  assert.equal(r.items.length, 1);
  const i = r.items[0];
  assert.equal(i.primary, 'retorno_prometido');
  assert.equal(i.fonte, 'ia');
  assert.equal(i.resumo, 'Quer entrega até sexta');
  assert.equal(i.flags[0].by, 'Bruno');
  assert.equal(i.waitingMinutes, 80);
  assert.equal(r.totals.urgentes, 1);
});

test('IA dizendo que não é pendente vence as regras; tolerância segura promessa recente', async () => {
  const semResposta = [{ id: 1, message_type: 0, created_at: seg(60), content: 'Segue tabela de preços de hoje', sender_type: 'Contact' }];
  const a = motor({ analise: { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Oferta de fornecedor', proximoPasso: '', indice: -1 }, mensagens: semResposta });
  assert.equal((await a.engine.scan()).items.length, 0);
  const recentes = [brutas[0], { ...brutas[1], created_at: seg(5) }];
  const b = motor({ analise: prometeu, mensagens: recentes });
  assert.equal((await b.engine.scan()).items.length, 0, 'promessa de 5 minutos ainda não é pendência');
});

test('marcar à mão, adiar e dispensar', async () => {
  const respondida = [...brutas, { id: 3, message_type: 1, created_at: seg(10), content: 'Conseguimos sim, entrega quinta.', sender_type: 'User', sender: { name: 'Bruno' } }];
  const nada = { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Respondido', proximoPasso: '', indice: -1 };

  const m = motor({ analise: nada, mensagens: respondida, marcas: { 50: { manual: { nota: 'Ligar na sexta para confirmar', por: 'Ana', em: agora - 20 * 60000 } } } });
  let r = await m.engine.scan();
  assert.equal(r.items[0].primary, 'manual');
  assert.equal(r.items[0].resumo, 'Ligar na sexta para confirmar');
  assert.equal(r.totals.manual, 1);

  const ad = motor({ analise: prometeu, mensagens: brutas, marcas: { 50: { adiar: { ate: agora + 3600000, por: 'Ana' } } } });
  r = await ad.engine.scan();
  assert.equal(r.items.length, 0);
  assert.equal(r.adiadas.length, 1);

  const vencida = motor({ analise: prometeu, mensagens: brutas, marcas: { 50: { adiar: { ate: agora - 1000, por: 'Ana' } } } });
  r = await vencida.engine.scan();
  assert.equal(r.items.length, 1, 'adiamento vencido volta para a lista');
  assert.equal(vencida.marcasObj.dados[50].adiar, undefined);

  const disp = motor({ analise: prometeu, mensagens: brutas, marcas: { 50: { dispensa: { ultimaMsg: 2 } } } });
  assert.equal((await disp.engine.scan()).items.length, 0, 'dispensada enquanto não chega mensagem nova');
  const nova = motor({ analise: prometeu, mensagens: brutas, marcas: { 50: { dispensa: { ultimaMsg: 1 } } } });
  assert.equal((await nova.engine.scan()).items.length, 1, 'mensagem nova desfaz a dispensa');
});
