// Sessão em cookie assinado (HMAC). Os atendentes entram com o mesmo e-mail e senha do Chatwoot.
import crypto from 'node:crypto';

const COOKIE = 'painel_sessao';
const MAX_AGE_DAYS = 30;

export function createAuth({ secret, secure }) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  if (!secret) console.warn('[auth] SESSION_SECRET não definido: as sessões caem a cada reinício.');

  const sign = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url');

  // O token do atendente no Chatwoot (para responder em nome dele) vai cifrado no cookie
  const chaveCifra = crypto.createHash('sha256').update(`cifra:${key}`).digest();
  const cifrar = (texto) => {
    if (!texto) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', chaveCifra, iv);
    const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), corpo]).toString('base64url');
  };
  const decifrar = (dado) => {
    if (!dado) return '';
    try {
      const b = Buffer.from(dado, 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', chaveCifra, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  };

  function issue(res, user) {
    const payload = Buffer.from(
      JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role || '', tk: cifrar(user.token), exp: Date.now() + MAX_AGE_DAYS * 864e5 }),
    ).toString('base64url');
    const value = `${payload}.${sign(payload)}`;
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_DAYS * 86400}${secure ? '; Secure' : ''}`,
    ]);
  }

  function clear(res) {
    res.setHeader('Set-Cookie', [`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`]);
  }

  function read(req) {
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (data.exp <= Date.now()) return null;
      const { tk, ...resto } = data;
      return { ...resto, token: decifrar(tk) };
    } catch {
      return null;
    }
  }

  function require(req, res, next) {
    const user = read(req);
    if (!user) return res.status(401).json({ erro: 'Faça login' });
    req.user = user;
    next();
  }

  function requireAdmin(req, res, next) {
    require(req, res, () => {
      if (req.user.role !== 'administrator') return res.status(403).json({ erro: 'Somente administradores do Chatwoot' });
      next();
    });
  }

  return { issue, clear, read, require, requireAdmin };
}
