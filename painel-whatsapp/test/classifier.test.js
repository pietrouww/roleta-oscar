import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, buildMatchers } from '../src/classifier.js';
import { toClassifierMessages } from '../src/chatwoot.js';

const NOW = Date.UTC(2026, 10, 10, 15, 0);
const ago = (min) => NOW - min * 60000;
const cli = (min, text) => ({ at: ago(min), dir: 'in', author: 'cliente', text });
const ag = (min, text, name = 'Ana') => ({ at: ago(min), dir: 'out', author: 'humano', name, text });
const ia = (min, text) => ({ at: ago(min), dir: 'out', author: 'ia', name: 'IA', text });
const run = (msgs) => classify(msgs, { now: NOW, rules: { waitMinMinutes: 15, promiseMinMinutes: 30 } });
const types = (r) => r.flags.map((f) => f.type).sort();

test('cliente perguntou e ninguém respondeu', () => {
  const r = run([cli(40, 'Qual o valor para 3 unidades?')]);
  assert.deepEqual(types(r), ['sem_resposta']);
  assert.equal(r.waitingMinutes, 40);
});

test('mensagem recente ainda não conta (abaixo do mínimo)', () => {
  assert.equal(run([cli(5, 'Oi, tudo bem?')]).pending, false);
});

test('respondido pela equipe não fica pendente', () => {
  assert.equal(run([cli(60, 'Tem estoque?'), ag(50, 'Temos sim!')]).pending, false);
});

test('resposta da IA conta como respondido', () => {
  const r = run([cli(60, 'Qual o horário?'), ia(59, 'Abrimos das 8h às 18h.')]);
  assert.equal(r.pending, false);
  assert.equal(r.aiInvolved, true);
});

test('"ok, obrigado" do cliente não gera pendência', () => {
  assert.equal(run([cli(90, 'Qual o horário?'), ag(85, 'Das 8h às 18h.'), cli(80, 'Ok, obrigado!')]).pending, false);
  assert.equal(run([cli(90, 'Qual o horário?'), ag(85, 'Das 8h às 18h.'), cli(80, '👍')]).pending, false);
});

test('pediu atendente mesmo com a IA respondendo depois', () => {
  const r = run([cli(30, 'Quero falar com um atendente'), ia(29, 'Vou chamar alguém da equipe.')]);
  assert.ok(types(r).includes('pediu_atendente'));
});

test('várias formas de pedir atendente', () => {
  for (const t of ['Isso é um robô?', 'tem alguém aí?', 'Quero falar com uma pessoa', 'atendimento humano por favor', 'me transfere pro vendedor']) {
    assert.ok(types(run([cli(30, t)])).includes('pediu_atendente'), t);
  }
});

test('pedido de atendente resolvido quando humano responde', () => {
  assert.equal(run([cli(60, 'Quero falar com um atendente'), ag(50, 'Oi! Sou a Ana, como posso ajudar?')]).pending, false);
});

test('promessa de retorno sem retorno fica pendente', () => {
  const r = run([cli(300, 'O técnico vem que horas?'), ag(290, 'Vou verificar com a equipe e já te retorno.', 'Bruno'), cli(289, 'Ok, obrigada')]);
  assert.deepEqual(types(r), ['retorno_prometido']);
  assert.equal(r.flags[0].by, 'Bruno');
});

test('várias formas de prometer retorno', () => {
  const frases = [
    'Estamos verificando, um momento.',
    'Deixa eu ver aqui e te falo.',
    'Assim que eu tiver a resposta te aviso.',
    'Vou confirmar com o fornecedor.',
    'Já te retorno!',
    'Retorno em breve com o orçamento.',
    'Aguarde só um minutinho',
    'Ficamos de te mandar o boleto hoje.',
  ];
  for (const t of frases) {
    assert.ok(types(run([cli(120, 'Pergunta'), ag(100, t)])).includes('retorno_prometido'), t);
  }
});

test('promessa cumprida quando a equipe volta a escrever', () => {
  const r = run([cli(300, 'Preciso do boleto'), ag(290, 'Estamos verificando no financeiro.'), ag(240, 'Pronto! Segue o boleto.')]);
  assert.equal(r.pending, false);
});

test('promessa recente ainda não é pendência', () => {
  assert.equal(run([cli(12, 'Tem a peça?'), ag(10, 'Vou verificar no estoque.')]).pending, false);
});

test('cliente cobrando depois de promessa marca as duas coisas', () => {
  const r = run([cli(120, 'A peça veio com defeito'), ag(110, 'Vou falar com o fornecedor e te aviso.'), cli(40, 'Alguma novidade?')]);
  assert.deepEqual(types(r), ['retorno_prometido', 'sem_resposta']);
});

test('termos extras configuráveis', () => {
  const rules = { waitMinMinutes: 15, promiseMinMinutes: 30, extraPromiseTerms: ['vou orçar'] };
  const r = classify([cli(120, 'Quanto fica?'), ag(100, 'Vou orçar e mando')], { now: NOW, rules, matchers: buildMatchers(rules) });
  assert.ok(types(r).includes('retorno_prometido'));
});

test('conversão de mensagens do Chatwoot', () => {
  const raw = [
    { id: 1, message_type: 0, created_at: 100, content: 'oi', sender_type: 'Contact', sender: { name: 'Cli' } },
    { id: 2, message_type: 1, created_at: 101, content: 'Olá!', sender_type: 'User', sender: { name: 'Ana', available_name: 'Ana Souza' } },
    { id: 3, message_type: 1, created_at: 102, content: 'Resposta automática', sender_type: null, sender: null },
    { id: 4, message_type: 1, created_at: 103, content: 'nota', private: true, sender_type: 'User' },
    { id: 5, message_type: 2, created_at: 104, content: 'Conversa atribuída' },
    { id: 6, message_type: 1, created_at: 105, content: 'bot', sender_type: 'AgentBot', sender: { name: 'Bot' } },
  ];
  const a = toClassifierMessages(raw, { aiDetection: 'sem_usuario' });
  assert.deepEqual(a.map((m) => `${m.dir}:${m.author}:${m.name}`), ['in:cliente:Cli', 'out:humano:Ana Souza', 'out:ia:IA', 'out:ia:Bot']);
  const b = toClassifierMessages(raw, { aiDetection: 'assinatura', aiSignatureRegex: 'automática' });
  assert.equal(b[2].author, 'ia');
  const c = toClassifierMessages([{ id: 9, message_type: 1, created_at: 1, content: 'enviei do celular', sender: null }], { aiDetection: 'assinatura', aiSignatureRegex: '^\\[IA\\]' });
  assert.equal(c[0].author, 'celular');
});

test('IA dizendo "vou chamar alguém" não duplica o pedido de atendente', () => {
  const r = run([cli(80, 'Quero falar com um atendente'), ia(79, 'Claro! Vou chamar alguém da equipe.')]);
  assert.deepEqual(types(r), ['pediu_atendente']);
});
