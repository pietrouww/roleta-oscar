import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Midia, nomeSeguro } from '../src/midia.js';
import { ChatwootClient } from '../src/chatwoot.js';

const quieto = { error() {}, info() {} };
const temFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('nome de arquivo fica seguro e mantém a extensão', () => {
  assert.equal(nomeSeguro('Orçamento nº 12 (final).pdf'), 'Orcamento-n-12-final.pdf');
  assert.equal(nomeSeguro('../../etc/passwd'), 'etc-passwd');
  assert.equal(nomeSeguro(''), 'arquivo');
});

test('foto e PDF seguem como estão; arquivo sem extensão ganha a do tipo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'));
  const m = new Midia({ dir, hostsPermitidos: [], logger: quieto });
  const dados = Buffer.from('conteudo');
  assert.deepEqual(await m.prepararEnvio({ dados, nome: 'Foto da tela.JPG', tipo: 'image/jpeg' }), { dados, nome: 'Foto-da-tela.JPG', tipo: 'image/jpeg' });
  assert.equal((await m.prepararEnvio({ dados, nome: 'laudo', tipo: 'application/pdf' })).nome, 'laudo.pdf');
  assert.equal((await m.prepararEnvio({ dados, nome: 'musica.mp3', tipo: 'audio/mpeg' })).nome, 'musica.mp3');
  assert.equal((await m.prepararEnvio({ dados, nome: 'x.bin', tipo: 'tipo invalido' })).tipo, 'application/octet-stream');
});

test('áudio gravado no app (webm) vira mp3 com extensão de áudio, para chegar como mensagem de voz', { skip: !temFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'));
  const webm = path.join(dir, 'gravacao.webm');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus', '-b:a', '32k', webm]);
  const m = new Midia({ dir, hostsPermitidos: [], logger: quieto });
  const r = await m.prepararEnvio({ dados: fs.readFileSync(webm), nome: 'audio', tipo: 'audio/webm;codecs=opus' }, { voz: true });
  assert.match(r.nome, /^audio-\d{14}\.mp3$/);
  assert.equal(r.tipo, 'audio/mpeg');
  assert.ok(r.dados.length > 2000);
  const ehMp3 = r.dados.subarray(0, 3).toString() === 'ID3' || (r.dados[0] === 0xff && (r.dados[1] & 0xe0) === 0xe0);
  assert.ok(ehMp3, 'conteúdo é mp3 de verdade');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'midia-cache')), [], 'não deixa arquivo temporário');
  // gravação do iPhone chega como audio/mp4 com nome sem extensão de áudio: também converte
  const r2 = await m.prepararEnvio({ dados: fs.readFileSync(webm), nome: 'gravacao.webm', tipo: 'audio/webm' });
  assert.equal(r2.nome, 'gravacao.mp3');
});

test('anexo vai ao Chatwoot como formulário com arquivo, legenda e o token do atendente', async () => {
  const original = globalThis.fetch;
  let pedido;
  globalThis.fetch = async (url, opts) => { pedido = { url, opts }; return new Response('{"id":1}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const c = new ChatwootClient({ url: 'http://cw', accountId: 1, token: 'geral' });
    await c.sendAttachment(42, { texto: 'Segue o orçamento', arquivo: { dados: Buffer.from('pdf'), nome: 'orcamento.pdf', tipo: 'application/pdf' } }, 'do-atendente');
    assert.equal(pedido.url, 'http://cw/api/v1/accounts/1/conversations/42/messages');
    assert.equal(pedido.opts.headers.api_access_token, 'do-atendente');
    const f = pedido.opts.body;
    assert.equal(f.get('content'), 'Segue o orçamento');
    assert.equal(f.get('message_type'), 'outgoing');
    assert.equal(f.get('private'), 'false');
    const arq = f.get('attachments[]');
    assert.equal(arq.name, 'orcamento.pdf');
    assert.equal(arq.type, 'application/pdf');
    assert.equal(await arq.text(), 'pdf');
  } finally {
    globalThis.fetch = original;
  }
});
