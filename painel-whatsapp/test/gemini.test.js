// Análise com o Gemini (Google): pedido, resposta, limites e escolha do serviço. Usa um fetch falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Analisador, ClienteGemini, escolherProvedor, extrairJson } from '../src/ia.js';

const agora = Date.now();
const quieto = { error() {}, info() {} };
const msgs = [
  { id: 1, at: agora - 90 * 60000, dir: 'in', author: 'cliente', text: 'Vocês conseguem entregar até sexta?' },
  { id: 2, at: agora - 80 * 60000, dir: 'out', author: 'humano', name: 'Bruno', text: 'Deixa comigo, olho isso com o pessoal da logística.' },
];
const analise = { pendente: true, tipo: 'retorno_prometido', urgencia: 'media', resumo: 'Quer entrega até sexta', proximo_passo: 'Confirmar com a logística', mensagem_inicio: 2 };
const ok = (texto) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: texto }] } }] }) });
const erro = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) });

function fetchFalso(respostas) {
  const pedidos = [];
  const fn = async (url, opcoes) => {
    pedidos.push({ url, headers: opcoes.headers, corpo: JSON.parse(opcoes.body) });
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, pedidos };
}
const gemini = (f, extra = {}) => new Analisador({ geminiKey: 'chave-de-teste', fetchFn: f.fn, logger: quieto, intervaloMs: 0, ...extra });

test('escolhe o serviço pela chave que existe ou por AI_PROVIDER', () => {
  assert.equal(escolherProvedor({ geminiKey: 'g' }), 'gemini');
  assert.equal(escolherProvedor({ apiKey: 'a' }), 'anthropic');
  assert.equal(escolherProvedor({ apiKey: 'a', geminiKey: 'g' }), 'anthropic');
  assert.equal(escolherProvedor({ apiKey: 'a', geminiKey: 'g', provedor: 'Gemini' }), 'gemini');
  assert.equal(escolherProvedor({}), 'anthropic');
  assert.equal(new Analisador({ logger: quieto }).ativo, false, 'sem chave nenhuma fica desligada');
  assert.equal(new Analisador({ geminiKey: 'g', model: 'claude-opus-5-5', logger: quieto }).model, 'gemini-3.5-flash-lite', 'modelo do Claude esquecido no .env não vale para o Gemini');
  assert.equal(new Analisador({ geminiKey: 'g', model: 'gemini-3.1-flash-lite', logger: quieto }).model, 'gemini-3.1-flash-lite');
});

test('Gemini: monta o pedido, lê a resposta e guarda em cache', async () => {
  const f = fetchFalso([ok(JSON.stringify(analise))]);
  const ia = gemini(f);
  const r = await ia.analisar(7, msgs, agora);
  assert.equal(r.tipo, 'retorno_prometido');
  assert.equal(r.indice, 1);
  const p = f.pedidos[0];
  assert.match(p.url, /\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(p.headers['x-goog-api-key'], 'chave-de-teste');
  assert.doesNotMatch(p.url, /chave-de-teste/, 'a chave vai no cabeçalho, nunca no endereço');
  assert.match(p.corpo.systemInstruction.parts[0].text, /esperando alguma coisa da equipe/);
  assert.match(p.corpo.contents[0].parts[0].text, /\[1\] .* CLIENTE: Vocês conseguem/);
  const g = p.corpo.generationConfig;
  assert.equal(g.responseMimeType, 'application/json');
  assert.deepEqual(g.responseJsonSchema.required.slice(0, 2), ['pendente', 'tipo']);
  assert.equal(g.responseJsonSchema.additionalProperties, undefined);
  await ia.analisar(7, msgs, agora);
  assert.equal(f.pedidos.length, 1, 'segunda vez vem do cache');
  assert.deepEqual(ia.status().provedor, 'gemini');
});

test('Gemini: resposta embrulhada em ```json e troca de formato se a API recusar', async () => {
  assert.deepEqual(extrairJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extrairJson('sem json'));
  const f = fetchFalso([erro(400, 'Invalid JSON payload received. Unknown name "responseJsonSchema" at \'generation_config\''), ok('```json\n' + JSON.stringify(analise) + '\n```')]);
  const ia = gemini(f);
  const r = await ia.analisar(8, msgs, agora);
  assert.equal(r.pendente, true);
  assert.equal(f.pedidos[1].corpo.generationConfig.responseFormat.text.mimeType, 'application/json');
  assert.ok(f.pedidos[1].corpo.generationConfig.responseFormat.text.schema);
  assert.equal(f.pedidos[1].corpo.generationConfig.responseMimeType, undefined);
});

test('Gemini: chave inválida, modelo inexistente e bloqueio caem para as regras', async () => {
  let ia = gemini(fetchFalso([erro(400, 'API key not valid. Please pass a valid API key.')]));
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.match(ia.status().ultimoErro, /Chave da API inválida \(GEMINI_API_KEY\)/);
  assert.equal(ia.disponivel, false);

  ia = gemini(fetchFalso([erro(404, 'models/x is not found')]), { model: 'gemini-x' });
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.match(ia.status().ultimoErro, /Modelo "gemini-x" indisponível/);

  ia = gemini(fetchFalso([{ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }]));
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.equal(ia.disponivel, true, 'bloqueio de uma conversa não pausa a IA');
  assert.equal(ia.status().ultimoErro, '');
});

test('Gemini: limite de uso pausa pouco, e mais tempo se insistir', async () => {
  const f = fetchFalso([erro(429, 'quota'), erro(429, 'quota'), erro(429, 'quota')]);
  const ia = gemini(f);
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.equal(ia.disponivel, false);
  assert.ok(ia.pausadaAte - Date.now() <= 2 * 60000 + 50);
  assert.equal(await ia.analisar(1, msgs, agora), null);
  assert.equal(f.pedidos.length, 1, 'em pausa não gasta pedidos');
  ia.pausadaAte = 0;
  await ia.analisar(1, msgs, agora);
  ia.pausadaAte = 0;
  await ia.analisar(1, msgs, agora);
  assert.ok(ia.pausadaAte - Date.now() > 50 * 60000, 'terceiro limite seguido: espera 1 hora');
  assert.match(ia.status().ultimoErro, /segue pelas regras/);
});

test('Gemini: pedidos vão um de cada vez, com intervalo', async () => {
  const f = fetchFalso([ok(JSON.stringify(analise)), ok(JSON.stringify(analise))]);
  const ia = gemini(f, { intervaloMs: 120 });
  const t0 = Date.now();
  await Promise.all([ia.analisar(1, msgs, agora), ia.analisar(2, msgs, agora)]);
  assert.equal(f.pedidos.length, 2);
  assert.ok(Date.now() - t0 >= 110, 'o segundo pedido esperou o intervalo');
});

test('ClienteGemini tenta de novo uma vez em erro do servidor', async () => {
  const f = fetchFalso([erro(503, 'overloaded'), ok('{"x":1}')]);
  const c = new ClienteGemini({ apiKey: 'k', fetchFn: f.fn });
  assert.equal(await c.gerar({ model: 'm', sistema: 's', texto: 't', esquema: { type: 'object' } }), '{"x":1}');
});
