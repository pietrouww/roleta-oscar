// Troca de atendente para aparelhos compartilhados (recepcao/laboratorio)
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3300);
const CW = process.env.CHATWOOT_INTERNAL || 'http://127.0.0.1:3200';
const ACCOUNT_ID = Number(process.env.CHATWOOT_ACCOUNT_ID || 1);
const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN || '';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
// ATENDENTES="2|Rogério Faria|rogerio.faria@x;3|Dayane Faria|dayane.faria@x"
const ATENDENTES = String(process.env.ATENDENTES || '').split(';').filter(Boolean).map(s => {
  const [id, nome, email] = s.split('|'); return { id: Number(id), nome, email };
});

fs.mkdirSync(DATA, { recursive: true });
const fPins = path.join(DATA, 'pins.json');
const fDev = path.join(DATA, 'aparelhos.json');
const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
const save = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

const falhas = new Map(); // chave -> {n, ate}
function bloqueado(k) { const f = falhas.get(k); return f && f.ate > Date.now(); }
function falhou(k) { const f = falhas.get(k) || { n: 0, ate: 0 }; f.n++; if (f.n >= 5) { f.ate = Date.now() + 5 * 60000; f.n = 0; } falhas.set(k, f); }
function acertou(k) { falhas.delete(k); }

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok, err) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e4) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ok({}); } }); req.on('error', err); }); }

async function cwSignIn(email, password) {
  const r = await fetch(CW + '/auth/sign_in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) return null;
  const j = await r.json().catch(() => ({}));
  return j.data || null;
}
async function ssoUrl(userId) {
  const r = await fetch(CW + '/platform/api/v1/users/' + userId + '/login', { headers: { api_access_token: PLATFORM_TOKEN } });
  if (r.status !== 200) throw new Error('sso ' + r.status);
  const j = await r.json(); return j.url;
}
function aparelho(req) {
  const k = req.headers['x-aparelho'] || '';
  if (!k) return null;
  const d = load(fDev)[sha(k)];
  return d || null;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/^\/troca/, '') || '/';
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress);

    if (p === '/health') return json(res, 200, { ok: true });

    // Ativa este aparelho: admin do Chatwoot informa e-mail/senha uma vez
    if (p === '/ativar' && req.method === 'POST') {
      if (bloqueado('ativar:' + ip)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde 5 minutos.' });
      const b = await body(req);
      const data = await cwSignIn(String(b.email || ''), String(b.senha || ''));
      const conta = data && (data.accounts || []).find(a => Number(a.id) === ACCOUNT_ID);
      if (!conta || conta.role !== 'administrator') { falhou('ativar:' + ip); return json(res, 403, { erro: 'Login de administrador inválido.' }); }
      acertou('ativar:' + ip);
      const chave = crypto.randomBytes(24).toString('hex');
      const devs = load(fDev); devs[sha(chave)] = { nome: String(b.nome || 'Aparelho').slice(0, 40), por: data.email, em: new Date().toISOString() }; save(fDev, devs);
      return json(res, 200, { chave, nome: devs[sha(chave)].nome });
    }

    const dev = aparelho(req);
    if (!dev) return json(res, 401, { erro: 'Aparelho não ativado.' });

    if (p === '/atendentes' && req.method === 'GET') {
      const pins = load(fPins);
      return json(res, 200, { aparelho: dev.nome, atendentes: ATENDENTES.map(a => ({ id: a.id, nome: a.nome, temPin: !!pins[a.id] })) });
    }

    const b = await body(req);
    const at = ATENDENTES.find(a => a.id === Number(b.id));
    if (!at) return json(res, 404, { erro: 'Atendente não encontrado.' });

    // Cria ou refaz o PIN: exige a senha do Chatwoot da própria pessoa
    if (p === '/definir-pin' && req.method === 'POST') {
      if (bloqueado('senha:' + at.id)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde 5 minutos.' });
      if (!/^\d{4}$/.test(String(b.pin || ''))) return json(res, 400, { erro: 'O PIN deve ter 4 números.' });
      const data = await cwSignIn(at.email, String(b.senha || ''));
      if (!data) { falhou('senha:' + at.id); return json(res, 403, { erro: 'Senha do Chatwoot incorreta.' }); }
      acertou('senha:' + at.id);
      const salt = crypto.randomBytes(16).toString('hex');
      const pins = load(fPins); pins[at.id] = { salt, hash: hashPin(b.pin, salt), em: new Date().toISOString() }; save(fPins, pins);
      return json(res, 200, { ok: true });
    }

    // Confere o PIN; com "entrar" devolve o link de acesso da pessoa
    if ((p === '/entrar' || p === '/confirmar') && req.method === 'POST') {
      if (bloqueado('pin:' + at.id)) return json(res, 429, { erro: 'PIN bloqueado por 5 minutos após 5 erros.' });
      const reg = load(fPins)[at.id];
      if (!reg) return json(res, 409, { erro: 'Este atendente ainda não criou o PIN.', semPin: true });
      const ok = crypto.timingSafeEqual(Buffer.from(hashPin(b.pin || '', reg.salt), 'hex'), Buffer.from(reg.hash, 'hex'));
      if (!ok) { falhou('pin:' + at.id); return json(res, 403, { erro: 'PIN incorreto.' }); }
      acertou('pin:' + at.id);
      if (p === '/confirmar') return json(res, 200, { ok: true });
      return json(res, 200, { url: await ssoUrl(at.id), nome: at.nome });
    }

    return json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    console.error('[troca]', e.message);
    return json(res, 500, { erro: 'Erro interno. Tente de novo.' });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('troca-atendente na porta ' + PORT + ' com ' + ATENDENTES.length + ' atendentes'));
