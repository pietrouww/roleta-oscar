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

test('mensagem de ausência/saudação automática não conta como resposta', () => {
  const saud = 'Olá!\nAqui é a ***i2Brothers Assistência Apple*** 🍏.\nPara facilitar seu atendimento...';
  const aus = 'No momento não estamos disponíveis. Retornaremos assim que possível.';
  const r1 = run([cli(40, 'Quanto custa a troca de tela?'), ia(40, saud)]);
  assert.deepEqual(types(r1), ['sem_resposta']);
  const r2 = run([cli(60, 'Meu aparelho já está pronto?'), ia(60, aus)]);
  assert.deepEqual(types(r2), ['sem_resposta']); // e não vira "retorno prometido"
  const r3 = run([cli(60, 'Meu aparelho já está pronto?'), ia(60, aus), ia(30, 'Sim! Pode retirar hoje.')]);
  assert.deepEqual(types(r3), []);
});

test('frase própria de resposta automática (AUTO_REPLY_TERMS)', () => {
  const rules = { waitMinMinutes: 15, promiseMinMinutes: 30, autoReplyTerms: ['clique aqui para orçamentos'] };
  const r = classify([cli(40, 'Oi, preciso de ajuda'), ia(40, 'Clique aqui para orçamentos: wa.me/55...')], { now: NOW, rules, matchers: buildMatchers(rules) });
  assert.deepEqual(types(r), ['sem_resposta']);
});

test('o que sai do celular (usuário "Celular" da Evolution) é IA/celular, não atendente', () => {
  const raw = [
    { id: 1, message_type: 0, created_at: 100, content: 'oi', sender: { name: 'Cli' } },
    { id: 2, message_type: 1, created_at: 101, content: 'Resposta da IA', sender_type: 'User', sender: { name: 'Celular', type: 'user' } },
    { id: 3, message_type: 1, created_at: 102, content: 'Respondi pelo Chatwoot', sender_type: 'User', sender: { name: 'Dayane Faria', type: 'user' } },
  ];
  const a = toClassifierMessages(raw, { aiDetection: 'sem_usuario' });
  assert.deepEqual(a.map((m) => m.author), ['cliente', 'ia', 'humano']);
  const b = toClassifierMessages(raw, { aiDetection: 'assinatura', aiSignatureRegex: '^\\[IA\\]' });
  assert.equal(b[1].author, 'celular');
});

test('origem pelo código da mensagem: CE = IA, 2A = pessoa no celular, 3EB0 = WhatsApp Web', () => {
  const cel = { name: 'Celular', type: 'user' };
  const raw = [
    { id: 1, message_type: 0, created_at: 100, content: 'oi', sender: { name: 'Cli' } },
    { id: 2, message_type: 1, created_at: 101, content: 'Oii! Que bom falar com você', sender_type: 'User', sender: cel, source_id: 'WAID:CE12C1AABBCCDDEEFF00' },
    { id: 3, message_type: 1, created_at: 102, content: 'Estou com ele na bancada', sender_type: 'User', sender: cel, source_id: 'WAID:2A0EAEAABBCCDDEEFF00' },
    { id: 4, message_type: 1, created_at: 103, content: 'Sua OS está pronta', sender_type: 'User', sender: cel, source_id: 'WAID:3EB0B7AABBCCDDEEFF0011' },
  ];
  const a = toClassifierMessages(raw, { aiDetection: 'sem_usuario', aiIdPrefixes: ['CE'] });
  assert.deepEqual(a.map((m) => `${m.author}:${m.name}`), ['cliente:Cli', 'ia:IA', 'celular:Equipe (celular)', 'celular:WhatsApp Web']);
});

test('resposta de pessoa pelo celular atende o pedido de atendente; da IA não', () => {
  const cel = (min, text) => ({ at: ago(min), dir: 'out', author: 'celular', name: 'Equipe (celular)', text });
  assert.deepEqual(types(run([cli(60, 'Quero falar com um atendente'), ia(59, 'Claro, já te ajudo!')])), ['pediu_atendente']);
  assert.deepEqual(types(run([cli(60, 'Quero falar com um atendente'), cel(50, 'Oi, aqui é a Dayane, pode falar')])), []);
});

test('áudio ou imagem do cliente sem resposta depois fica pendente; "ok" após nossa resposta não', () => {
  const audio = { at: ago(40), dir: 'in', author: 'cliente', text: '', hasMedia: true };
  const cel = (min, text) => ({ at: ago(min), dir: 'out', author: 'celular', name: 'Equipe (celular)', text });
  assert.deepEqual(types(run([cel(60, 'Pode mandar foto?'), audio])), ['sem_resposta']);
  assert.deepEqual(types(run([cli(80, 'Já está pronto?'), cel(70, 'Sim, pode retirar'), cli(60, 'ok')])), []);
  assert.deepEqual(types(run([cel(90, 'Estou com ele na bancada'), cli(40, 'Puts, que estranho'), cli(39, 'O último aviso foi o modo de recuperação')])), ['sem_resposta']);
});

test('só fica pendente o que pede resposta', () => {
  const cel = (min, text) => ({ at: ago(min), dir: 'out', author: 'celular', name: 'Equipe (celular)', text });
  const base = [cli(200, 'Oi, meu iPhone não liga'), cel(190, 'Pode trazer que olhamos')];
  // pergunta
  const r1 = run([...base, cli(40, 'Vocês abrem sábado?')]);
  assert.deepEqual(types(r1), ['sem_resposta']);
  assert.equal(r1.flags[0].motivo, 'pergunta');
  // confirmações e avisos não pedem resposta
  for (const t of ['ok, aguardo', 'Combinado, obrigado!', 'Beleza 👍', 'Estou chegando', 'Já fiz o pix', 'Vou ver com meu marido e te aviso', 'sim']) {
    assert.deepEqual(types(run([...base, cli(40, t)])), [], t);
  }
  // cotação de fornecedor (sem pergunta) não pede resposta; pergunta com preço pede
  assert.deepEqual(types(run([cel(300, 'Tem tela do 13?'), cli(40, 'Tela iPhone 13 incell R$ 280,00\nOLED R$ 420,00\nPronta entrega')])), []);
  assert.deepEqual(types(run([cel(300, 'Tem tela do 13?'), cli(40, 'Bateria 13 R$ 150,00 à vista')])), []);
  assert.deepEqual(types(run([...base, cli(40, 'Ficou R$ 350,00? Pode parcelar?')])), ['sem_resposta']);
  // relato do cliente (sem pergunta) ainda pede retorno
  assert.deepEqual(types(run([...base, cli(40, 'O último aviso que apareceu foi o modo de recuperação, depois nada mais')])), ['sem_resposta']);
  // "boa tarde" abrindo conversa nova pede resposta; logo após nossa mensagem, não
  assert.deepEqual(types(run([cli(40, 'Boa tarde')])), ['sem_resposta']);
  assert.deepEqual(types(run([cel(50, 'Seu aparelho está pronto'), cli(40, 'Boa tarde')])), []);
});

test('cliente avisando que vai até a loja não pede resposta; pergunta junto pede', () => {
  const cel = (min, text) => ({ at: ago(min), dir: 'out', author: 'celular', name: 'Equipe (celular)', text });
  const base = [cli(200, 'Meu iPhone não liga'), cel(190, 'Pode trazer que olhamos')];
  for (const t of ['Ok, vou levar amanhã', 'Beleza, passo aí mais tarde', 'Amanhã eu vou buscar']) {
    assert.deepEqual(types(run([...base, cli(40, t)])), [], t);
  }
  assert.deepEqual(types(run([...base, cli(40, 'Vou levar amanhã, até que horas vocês ficam?')])), ['sem_resposta']);
  assert.deepEqual(types(run([...base, cli(40, 'Fico no aguardo do orçamento')])), ['sem_resposta']);
});
