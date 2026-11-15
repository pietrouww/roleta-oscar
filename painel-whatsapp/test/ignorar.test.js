// Grupos, contatos ignorados e etiqueta "ignorar-pendencia" ficam fora da verificação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PendenciasEngine, ehGrupo } from '../src/pendencias.js';

const agora = Math.floor(Date.now() / 1000);
const conv = (id, extra = {}) => ({
  id, inboxId: 1, status: 'open', labels: [], lastActivityAt: (agora - 3600) * 1000,
  contactId: id + 100, contactName: `Contato ${id}`, contactPhone: `+55419999900${id}`, contactIdentifier: '', ...extra,
});
const perguntaSemResposta = [{ id: 1, message_type: 0, created_at: agora - 3600, content: 'Qual o valor?', sender_type: 'Contact' }];

function fakeClient(convs) {
  const labelsSet = [];
  return {
    labelsSet,
    listInboxes: async () => [{ id: 1, name: 'Comercial' }],
    listConversations: async (st) => (st === 'open' ? convs : []),
    listMessages: async () => perguntaSemResposta,
    setLabels: async (id, labels) => labelsSet.push({ id, labels }),
  };
}

const config = {
  chatwoot: { inboxIds: [], maxMessages: 60, publicUrl: '', accountId: '1' },
  rules: { waitMinMinutes: 15, promiseMinMinutes: 30 },
  labels: { sync: true, pendencia: 'pendencia', ignorar: 'ignorar-pendencia', antigas: [] },
};

test('detecta grupo do WhatsApp', () => {
  assert.equal(ehGrupo({ contactIdentifier: '120363000000000001@g.us' }), true);
  assert.equal(ehGrupo({ contactIdentifier: '5541999990000@s.whatsapp.net', contactPhone: '+5541999990000' }), false);
});

test('ignora grupos, contatos da lista e etiqueta ignorar-pendencia', async () => {
  const convs = [
    conv(1),
    conv(2, { contactIdentifier: '120363000000000001@g.us', contactPhone: '' }),
    conv(3), // contato ignorado pela equipe
    conv(4, { labels: ['ignorar-pendencia', 'pendencia'] }),
  ];
  const client = fakeClient(convs);
  const engine = new PendenciasEngine({ client, config, logger: { error() {}, info() {} }, ignorados: () => new Set(['103']) });
  const r = await engine.scan();
  assert.deepEqual(r.items.map((i) => i.id), [1], 'só a conversa normal fica pendente');
  assert.equal(r.ignoredConversations, 3);
  assert.equal(r.items[0].contactId, 101);
  // A conversa 4 tinha "pendencia": a etiqueta sai, a "ignorar-pendencia" fica
  assert.deepEqual(client.labelsSet.find((x) => x.id === 4).labels, ['ignorar-pendencia']);
  assert.deepEqual(client.labelsSet.find((x) => x.id === 1).labels, ['pendencia']);
});
