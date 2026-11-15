// Testa a preparação automática do Chatwoot (etiquetas + aba "Pendências").
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChatwootClient } from '../src/chatwoot.js';
import { prepararChatwoot } from '../src/setup.js';

test('cria etiquetas que faltam e a aba Pendências só uma vez', async () => {
  const labels = [{ id: 1, title: 'vip', show_on_sidebar: true }, { id: 2, title: 'pediu-atendente', show_on_sidebar: true }];
  const apps = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      const b = body ? JSON.parse(body) : null;
      if (req.url === '/api/v1/accounts/5/labels' && req.method === 'GET') return json(200, { payload: labels });
      if (req.url === '/api/v1/accounts/5/labels' && req.method === 'POST') { labels.push({ id: labels.length + 1, ...b }); return json(200, b); }
      if (req.url === '/api/v1/accounts/5/dashboard_apps' && req.method === 'GET') return json(200, apps);
      if (req.url === '/api/v1/accounts/5/dashboard_apps' && req.method === 'POST') { apps.push({ id: 9, ...b }); return json(200, b); }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new ChatwootClient({ url: `http://127.0.0.1:${server.address().port}`, accountId: '5', token: 't' });
    const config = {
      publicUrl: 'https://pendencias.efiscus.com.br',
      dashboardAppTitle: 'Pendências',
      labels: { sync: true, pendencia: 'pendencia', antigas: [] },
    };
    const log = { info() {} };
    const primeira = await prepararChatwoot({ client, config, logger: log });
    assert.deepEqual(primeira, ['etiqueta pendencia', 'aba "Pendências" nas conversas']);
    assert.equal(labels.find((l) => l.title === 'pendencia').show_on_sidebar, false, 'não polui o menu lateral');
    assert.equal(apps[0].content[0].url, 'https://pendencias.efiscus.com.br/?embed=1');
    assert.equal(apps[0].content[0].type, 'frame');

    const segunda = await prepararChatwoot({ client, config, logger: log });
    assert.deepEqual(segunda, [], 'não duplica nada ao reiniciar');
  } finally {
    server.close();
  }
});
