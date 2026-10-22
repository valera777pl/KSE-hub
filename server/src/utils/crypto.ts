import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

function key(): Buffer {
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) throw new Error('TOKEN_ENC_KEY must be 32 bytes as hex (openssl rand -hex 32)');
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM → "iv.tag.ciphertext" (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Short-lived signed token, e.g. the OAuth `state` that ties a Google login to a Telegram user. */
export function signState(userId: number, ttlSeconds = 15 * 60): string {
  const body = `${userId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  const mac = createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(state: string): number | null {
  const [userId, exp, mac] = state.split('.');
  if (!userId || !exp || !mac) return null;
  const expected = createHmac('sha256', key()).update(`${userId}.${exp}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (parseInt(exp, 10) < Date.now() / 1000) return null;
  return parseInt(userId, 10);
}
