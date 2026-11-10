// Testa o cliente do Chatwoot e a varredura completa contra um servidor falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChatwootClient } from '../src/chatwoot.js';
import { PendenciasEngine } from '../src/pendencias.js';

const now = Math.floor(Date.now() / 1000);

function fakeChatwoot() {
  const calls = [];
  const msgs = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1, message_type: i % 2 ? 1 : 0, created_at: now - 7200 + i * 60, content: `m${i + 1}`,
    sender_type: i % 2 ? 'User' : 'Contact', sender: { name: i % 2 ? 'Ana' : 'Cliente' },
  }));
  msgs.push({ id: 26, message_type: 0, created_at: now - 3000, content: 'Quero falar com um atendente', sender_type: 'Contact' });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, token: req.headers.api_access_token, body });
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/auth/sign_in') {
        const b = JSON.parse(body);
        return b.password === 'certa'
          ? json(200, { data: { id: 7, name: 'Ana Souza', email: b.email, accounts: [{ id: 3, role: 'administrator' }] } })
          : json(401, { errors: ['x'] });
      }
      if (u.pathname === '/api/v1/accounts/3/inboxes') return json(200, { payload: [{ id: 11, name: 'Comercial', phone_number: '+55' }] });
      if (u.pathname === '/api/v1/accounts/3/conversations') {
        const st = u.searchParams.get('status');
        if (st !== 'open') return json(200, { data: { payload: [] } });
        return json(200, { data: { payload: [{ id: 99, inbox_id: 11, status: 'open', labels: ['vip'], last_activity_at: now - 3000, meta: { sender: { name: 'Mariana', phone_number: '+5541999990000' }, assignee: { name: 'Ana Souza' } } }] } });
      }
      if (u.pathname === '/api/v1/accounts/3/conversations/99/messages') {
        const before = Number(u.searchParams.get('before') || 0);
        const pool = before ? msgs.filter((m) => m.id < before) : msgs;
        return json(200, { payload: pool.slice(-20) });
      }
      if (u.pathname === '/api/v1/accounts/3/conversations/99/labels') return json(200, { payload: JSON.parse(body).labels });
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('cliente Chatwoot + varredura completa', async () => {
  const { server, calls, url } = await fakeChatwoot();
  try {
    const client = new ChatwootClient({ url, accountId: '3', token: 'tok' });
    assert.equal(await client.signIn('ana@x.com', 'errada'), null);
    const u = await client.signIn('ana@x.com', 'certa');
    assert.equal(u.name, 'Ana Souza');
    assert.equal(u.role, 'administrator');

    const raw = await client.listMessages(99, 60);
    assert.equal(raw.length, 26, 'busca páginas anteriores');
    assert.deepEqual(raw.map((m) => m.id), Array.from({ length: 26 }, (_, i) => i + 1));

    const config = {
      chatwoot: { url, publicUrl: 'https://cw.exemplo', accountId: '3', token: 'tok', inboxIds: [], maxMessages: 60 },
      rules: { waitMinMinutes: 15, promiseMinMinutes: 30 },
      labels: { sync: true, semResposta: 'pendente-resposta', pediuAtendente: 'pediu-atendente', retornoPrometido: 'retorno-prometido' },
    };
    const engine = new PendenciasEngine({ client, config, logger: { error() {}, info() {} } });
    const r = await engine.scan();
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].primary, 'pediu_atendente');
    assert.equal(r.items[0].inbox.name, 'Comercial');
    assert.equal(r.items[0].url, 'https://cw.exemplo/app/accounts/3/conversations/99');
    const labelCall = calls.find((c) => c.url.endsWith('/labels'));
    assert.deepEqual(JSON.parse(labelCall.body).labels, ['pediu-atendente', 'vip'], 'mantém etiquetas existentes');
    assert.ok(calls.filter((c) => c.url.startsWith('/api/')).every((c) => c.token === 'tok'));

    // Segunda varredura usa cache (sem buscar mensagens de novo)
    const before = calls.filter((c) => c.url.includes('/messages')).length;
    await engine.scan();
    assert.equal(calls.filter((c) => c.url.includes('/messages')).length, before);
  } finally {
    server.close();
  }
});
