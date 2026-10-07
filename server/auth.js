import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);

export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}

export function createAuth({ hash, secret, secure, basePath }) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '') || (secret || '').length < 32) throw new Error('Set ADMIN_PASSWORD_HASH and SESSION_SECRET before starting Mosaic');
  const [salt, encoded] = hash.split(':');
  const expected = Buffer.from(encoded, 'hex');
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  const cookiePath = basePath || '/';
  const cookie = (value, age) => `mosaic_session=${value}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  return {
    async verifyPassword(value) {
      if (typeof value !== 'string' || value.length > 256) return false;
      return timingSafeEqual(await derive(value, salt, 64), expected);
    },
    loginCookie() {
      const body = Buffer.from(JSON.stringify({ expires: Date.now() + 12 * 3600_000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
      return cookie(`${body}.${sign(body)}`, 12 * 3600);
    },
    logoutCookie: () => cookie('', 0),
    authenticated(request) {
      const token = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('mosaic_session='))?.slice(15);
      if (!token || token.length > 512) return false;
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra) return false;
      const actual = Buffer.from(signature);
      const expectedSignature = Buffer.from(sign(body));
      if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) return false;
      try { return JSON.parse(Buffer.from(body, 'base64url')).expires > Date.now(); } catch { return false; }
    },
  };
}
