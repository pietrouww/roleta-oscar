// Testa o cliente da Evolution API contra um servidor falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EvolutionClient, slug } from '../src/evolution.js';

test('slug do nome do número', () => {
  assert.equal(slug('Comercial'), 'comercial');
  assert.equal(slug('  Suporte Técnico 2 '), 'suporte-tecnico-2');
  assert.equal(slug('Ação & Vendas!'), 'acao-vendas');
});

test('cliente Evolution: criar, ligar ao Chatwoot, QR, estado', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, key: req.headers.apikey, body: body ? JSON.parse(body) : null });
      const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (req.headers.apikey !== 'chave') return json(401, { message: 'Unauthorized' });
      if (req.url === '/instance/fetchInstances') {
        return json(200, [
          { name: 'comercial', connectionStatus: 'open', ownerJid: '5541999990001@s.whatsapp.net', profileName: 'Loja' },
          { name: 'suporte', connectionStatus: 'close' },
        ]);
      }
      if (req.url === '/instance/create') return json(201, { instance: { instanceName: 'suporte' }, qrcode: { base64: 'data:image/png;base64,AAA' } });
      if (req.url.startsWith('/chatwoot/set/')) return json(201, { ok: true });
      if (req.url === '/instance/connect/suporte') return json(200, { base64: 'data:image/png;base64,QRQR', code: 'x', count: 1 });
      if (req.url === '/instance/connect/suporte?number=5541999990002') return json(200, { pairingCode: 'ABCD1234', base64: 'QRQR' });
      if (req.url === '/instance/connectionState/suporte') return json(200, { instance: { instanceName: 'suporte', state: 'connecting' } });
      json(404, { message: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const evo = new EvolutionClient({ url, apiKey: 'chave', chatwoot: { url: 'https://cw.exemplo', accountId: 1, token: 'tok-celular' } });
    assert.equal(evo.configured, true);

    const lista = await evo.list();
    assert.deepEqual(lista[0], { nome: 'comercial', estado: 'conectado', numero: '5541999990001', perfil: 'Loja', foto: '' });
    assert.equal(lista[1].estado, 'desconectado');

    await evo.create('suporte');
    assert.deepEqual(calls.at(-1).body, { instanceName: 'suporte', integration: 'WHATSAPP-BAILEYS', qrcode: true });

    await evo.setChatwoot('suporte', 'Suporte');
    const cw = calls.at(-1).body;
    assert.equal(calls.at(-1).url, '/chatwoot/set/suporte');
    assert.equal(cw.accountId, '1');
    assert.equal(cw.token, 'tok-celular');
    assert.equal(cw.nameInbox, 'Suporte');
    assert.equal(cw.autoCreate, true);
    assert.equal(cw.signMsg, true);
    for (const k of ['enabled', 'accountId', 'token', 'url', 'signMsg', 'reopenConversation', 'conversationPending']) {
      assert.ok(k in cw, `campo obrigatório ${k}`);
    }

    const q = await evo.connect('suporte');
    assert.equal(q.qr, 'data:image/png;base64,QRQR');
    const p = await evo.connect('suporte', '5541999990002');
    assert.equal(p.codigo, 'ABCD1234');
    assert.equal(p.qr, 'data:image/png;base64,QRQR');

    assert.equal(await evo.state('suporte'), 'conectando');

    const ruim = new EvolutionClient({ url, apiKey: 'errada', chatwoot: {} });
    await assert.rejects(() => ruim.list(), /401/);
  } finally {
    server.close();
  }
});
