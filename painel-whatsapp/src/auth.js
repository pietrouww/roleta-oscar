// Sessão em cookie assinado (HMAC). Os atendentes entram com o mesmo e-mail e senha do Chatwoot.
import crypto from 'node:crypto';

const COOKIE = 'painel_sessao';
const MAX_AGE_DAYS = 30;

export function createAuth({ secret, secure }) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  if (!secret) console.warn('[auth] SESSION_SECRET não definido: as sessões caem a cada reinício.');

  const sign = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url');

  function issue(res, user) {
    const payload = Buffer.from(
      JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role || '', exp: Date.now() + MAX_AGE_DAYS * 864e5 }),
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
      return data.exp > Date.now() ? data : null;
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
