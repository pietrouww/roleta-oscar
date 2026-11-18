import test from 'node:test';
import assert from 'node:assert/strict';
import { PendenciasEngine, continuouEmOutro, chaveContato } from '../src/pendencias.js';
import { CacheMensagens } from '../src/mensagens.js';
import { montarTranscricao } from '../src/ia.js';

const agora = Date.now();
const seg = (minAtras) => Math.round((agora - minAtras * 60000) / 1000);
const quieto = { error() {}, info() {} };
const SAUDACAO = 'Olá!\nAqui é a ***i2Brothers Assistência Apple*** 🍏.\nPara facilitar seu atendimento, se você é cliente e deseja orçamentos ou suporte, clique aqui: https://wa.me/5541992277477';
const cli = (id, min, content) => ({ id, message_type: 0, created_at: seg(min), content, sender_type: 'Contact', sender: { name: 'Cliente' } });
const cel = (id, min, content, waid = '2A0EAEAABBCCDDEEFF00') => ({ id, message_type: 1, created_at: seg(min), content, sender_type: 'User', sender: { name: 'Celular', type: 'user' }, source_id: `WAID:${waid}` });

const config = {
  chatwoot: { inboxIds: [], maxMessages: 60, publicUrl: '', accountId: '1' },
  rules: { waitMinMinutes: 15, promiseMinMinutes: 30, aiDetection: 'sem_usuario', aiIdPrefixes: ['CE'], celularSenderName: 'Celular' },
  labels: { sync: false, pendencia: 'pendencia', ignorar: 'ignorar-pendencia' },
  ia: { maxDias: 14, maxPorVarredura: 40 },
};
const LAB = 1;
const ATD = 2;
const conv = (id, inboxId, mensagens, extra = {}) => ({
  id, inboxId, status: 'open', labels: [], lastActivityAt: mensagens[mensagens.length - 1].created_at * 1000,
  contactId: 7, contactName: 'Cliente', contactPhone: '+5541991578051', contactIdentifier: '', assigneeName: '', ...extra,
});

function motor({ abertas, mensagens, doContato = [], ia = null }) {
  const client = {
    listInboxes: async () => [{ id: LAB, name: 'Laboratório' }, { id: ATD, name: 'Atendimento' }],
    listConversations: async (st) => (st === 'open' ? abertas : []),
    listMessages: async (id) => mensagens[id],
    listContactConversations: async () => doContato,
    setLabels: async () => {},
  };
  return new PendenciasEngine({ client, config, ia, logger: quieto });
}

test('mesmo cliente é reconhecido em números diferentes pelo telefone', () => {
  assert.equal(chaveContato({ contactPhone: '+5541991578051' }), chaveContato({ contactPhone: '554191578051' }));
  assert.notEqual(chaveContato({ contactPhone: '+5541991578051' }), chaveContato({ contactPhone: '+5541991578052' }));
  assert.equal(chaveContato({ contactPhone: '', contactId: 9 }), 'c:9');
});

test('começou no Laboratório, recebeu a mensagem automática e continuou no Atendimento: Laboratório não fica pendente', async () => {
  const mensagens = {
    10: [cli(1, 60, 'Oi, quanto custa trocar a tela do iPhone 13?'), cel(2, 60, SAUDACAO)],
    20: [cli(3, 55, 'Oi, vim pelo link. Quanto custa a tela do iPhone 13?')],
  };
  const e = motor({ abertas: [conv(10, LAB, mensagens[10]), conv(20, ATD, mensagens[20])], mensagens });
  const r = await e.scan();
  assert.deepEqual(r.items.map((i) => i.id), [20], 'a pendência fica só na conversa do Atendimento');
  assert.equal(r.continuadas[10].nome, 'Atendimento');
  assert.equal(r.continuadas[10].id, 20);
});

test('sem continuar em outro número, o Laboratório segue pendente', async () => {
  const mensagens = {
    10: [cli(1, 60, 'Oi, quanto custa trocar a tela do iPhone 13?'), cel(2, 60, SAUDACAO)],
    20: [cli(3, 300, 'Bom dia, tudo bem?'), cel(4, 290, 'Tudo ótimo! Seu aparelho já está pronto, pode retirar.')],
  };
  const e = motor({ abertas: [conv(10, LAB, mensagens[10]), conv(20, ATD, mensagens[20])], mensagens });
  const r = await e.scan();
  assert.deepEqual(r.items.map((i) => i.id), [10], 'ele escreveu no Atendimento ANTES, não depois');
  assert.deepEqual(r.continuadas, {});
});

test('resposta só da equipe no outro número não tira a pendência; quem decide é o cliente ter continuado lá', async () => {
  const mensagens = {
    10: [cli(1, 60, 'Meu aparelho já está pronto?'), cel(2, 60, SAUDACAO)],
    20: [cel(3, 30, 'Boa tarde! Passando para avisar que a OS 123 foi aberta.', '3EB0B7AABBCCDDEEFF0011')],
  };
  const e = motor({ abertas: [conv(10, LAB, mensagens[10]), conv(20, ATD, mensagens[20])], mensagens });
  assert.deepEqual((await e.scan()).items.map((i) => i.id), [10]);
});

test('promessa de retorno feita num número continua valendo mesmo que o cliente escreva no outro', async () => {
  const mensagens = {
    10: [cli(1, 120, 'Quanto fica a bateria?'), cel(2, 110, 'Vou verificar o valor e já te retorno')],
    20: [cli(3, 60, 'ok obrigado')],
  };
  const e = motor({ abertas: [conv(10, ATD, mensagens[10]), conv(20, LAB, mensagens[20])], mensagens });
  const r = await e.scan();
  assert.deepEqual(r.items.map((i) => [i.id, i.primary]), [[10, 'retorno_prometido']]);
});

test('vale também quando a conversa do outro número já foi resolvida', async () => {
  const mensagens = {
    10: [cli(1, 90, 'Vocês consertam Apple Watch?'), cel(2, 90, SAUDACAO)],
    30: [cli(5, 80, 'Vocês consertam Apple Watch?'), cel(6, 70, 'Consertamos sim! Pode trazer para avaliarmos.'), cli(7, 65, 'ok obrigado')],
  };
  const resolvida = { ...conv(30, ATD, mensagens[30]), status: 'resolved' };
  const e = motor({ abertas: [conv(10, LAB, mensagens[10])], mensagens, doContato: [resolvida] });
  const r = await e.scan();
  assert.equal(r.items.length, 0);
  assert.equal(r.continuadas[10].id, 30);
});

test('pendência marcada à mão pela equipe não some por causa do outro número', async () => {
  const mensagens = {
    10: [cli(1, 60, 'Quanto custa a tela?'), cel(2, 60, SAUDACAO)],
    20: [cli(3, 55, 'Quanto custa a tela?')],
  };
  const marcas = { dados: { 10: { manual: { nota: 'Ligar para o cliente', por: 'Rogério', em: agora - 3600000 } } }, getMarks() { return this.dados; }, setMark() {} };
  const client = {
    listInboxes: async () => [{ id: LAB, name: 'Laboratório' }, { id: ATD, name: 'Atendimento' }],
    listConversations: async (st) => (st === 'open' ? [conv(10, LAB, mensagens[10]), conv(20, ATD, mensagens[20])] : []),
    listMessages: async (id) => mensagens[id],
    setLabels: async () => {},
  };
  const e = new PendenciasEngine({ client, config, marcas, logger: quieto });
  assert.deepEqual((await e.scan()).items.map((i) => i.id).sort(), [10, 20]);
});

test('continuouEmOutro: só conta mensagem do cliente depois da última mensagem real desta conversa', () => {
  const ehAuto = (t) => /para facilitar seu atendimento/i.test(t || '');
  const aqui = [{ at: 1000, dir: 'in', author: 'cliente', text: 'oi' }, { at: 1001, dir: 'out', author: 'celular', text: 'Para facilitar seu atendimento...' }];
  const la = (at, dir = 'in') => [{ id: 9, nome: 'Atendimento', messages: [{ at, dir, author: dir === 'in' ? 'cliente' : 'celular', text: 'x' }] }];
  assert.equal(continuouEmOutro(aqui, la(900), ehAuto), null);
  assert.equal(continuouEmOutro(aqui, la(2000, 'out'), ehAuto), null);
  assert.equal(continuouEmOutro(aqui, la(1000.5), ehAuto).id, 9, 'a mensagem automática não empurra a referência');
  assert.equal(continuouEmOutro(aqui, la(2000), ehAuto).nome, 'Atendimento');
});

test('IA recebe as mensagens do outro número como contexto, e reavalia quando a conversa de lá anda', async () => {
  const mensagens = {
    10: [cli(1, 200, 'Quanto fica a bateria do 12?'), cel(2, 190, 'Vou verificar o valor e já te retorno')],
    20: [cel(3, 100, 'Rogério, a bateria do 12 fica R$ 350,00 instalada.')],
  };
  const pedidos = [];
  const ia = {
    ativo: true,
    guardado: new Map(),
    emCache(id, m, outros = []) { return this.guardado.get(`${id}:${m.length}:${outros.map((o) => o.messages.length).join(',')}`); },
    async analisar(id, m, now, outros = []) {
      pedidos.push({ id, texto: montarTranscricao(m, { now, timeZone: 'America/Sao_Paulo', outros }) });
      const r = { pendente: false, tipo: 'nenhuma', urgencia: 'baixa', resumo: 'Valor já enviado pelo outro número', proximoPasso: '', indice: -1 };
      this.guardado.set(`${id}:${m.length}:${outros.map((o) => o.messages.length).join(',')}`, r);
      return r;
    },
    salvar() {},
    status: () => ({ ativa: true }),
  };
  const e = motor({ abertas: [conv(10, ATD, mensagens[10]), conv(20, LAB, mensagens[20])], mensagens, ia });
  const r = await e.scan();
  assert.equal(r.items.length, 0, 'a IA viu que o valor foi enviado pelo outro número');
  const p10 = pedidos.find((p) => p.id === 10).texto;
  assert.match(p10, /OUTRO NÚMERO \(Laboratório\)/);
  assert.match(p10, /R\$ 350,00/);
  assert.match(p10, /\[2\] .*ATENDENTE.*Vou verificar/);
});

test('varredura rápida não espera a IA: usa as regras e a análise chega em segundo plano', async () => {
  const mensagens = { 10: [cli(1, 60, 'Vocês abrem sábado?')] };
  let soltar;
  const trava = new Promise((ok) => { soltar = ok; });
  const ia = {
    ativo: true,
    pronto: null,
    emCache() { return this.pronto || undefined; },
    async analisar() {
      await trava;
      this.pronto = { pendente: true, tipo: 'sem_resposta', urgencia: 'baixa', resumo: 'Quer saber se abre sábado', proximoPasso: 'Informar o horário de sábado', indice: 0 };
      return this.pronto;
    },
    salvar() {},
    status: () => ({ ativa: true }),
  };
  const e = motor({ abertas: [conv(10, ATD, mensagens[10])], mensagens, ia });
  const r1 = await e.rapido();
  assert.equal(r1.items[0].fonte, 'regras', 'saiu na hora, pelas regras');
  assert.equal(r1.analisando, 1);
  soltar();
  await e.drenando;
  const r2 = await e.rapido();
  assert.equal(r2.items[0].fonte, 'ia');
  assert.equal(r2.items[0].resumo, 'Quer saber se abre sábado');
  assert.equal(r2.analisando, 0);
});

test('cache de mensagens: reabrir a conversa lê só a página mais recente e emenda com o que já tinha', async () => {
  const todas = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, created_at: 1000 + i, content: `m${i + 1}` }));
  const chamadas = [];
  const client = {
    async listMessagesPage(id, before = null) {
      chamadas.push(before);
      const ate = before ? todas.filter((m) => m.id < before) : todas;
      return ate.slice(-20);
    },
  };
  const cache = new CacheMensagens(client);
  const a = await cache.obterDetalhe(5, { max: 40 });
  assert.equal(a.raw.length, 40);
  assert.equal(a.completo, false);
  assert.deepEqual(chamadas, [null, 31]);

  todas.push({ id: 51, created_at: 2000, content: 'nova' });
  chamadas.length = 0;
  const b = await cache.obterDetalhe(5, { max: 40 });
  assert.deepEqual(chamadas, [null], 'uma chamada só');
  assert.equal(b.raw.length, 41);
  assert.equal(b.raw[b.raw.length - 1].content, 'nova');
  assert.deepEqual(b.raw.map((m) => m.id), Array.from({ length: 41 }, (_, i) => i + 11), 'sem buracos nem repetidas');

  chamadas.length = 0;
  await cache.obterDetalhe(5, { max: 40, lastActivityAt: 123 });
  await cache.obterDetalhe(5, { max: 40, lastActivityAt: 123 });
  assert.deepEqual(chamadas, [null], 'sem novidade (mesma última atividade) não consulta de novo');

  chamadas.length = 0;
  const c = await cache.obterDetalhe(5, { max: 400 });
  assert.equal(c.raw.length, 51);
  assert.equal(c.completo, true);
});
