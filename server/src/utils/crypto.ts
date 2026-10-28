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

/**
 * Signed, expiring token for a user. `purpose` keeps kinds apart: an OAuth
 * `state` can't be replayed as an admin login and vice versa.
 */
export function signState(userId: number, ttlSeconds = 15 * 60, purpose = 'oauth'): string {
  const body = `${userId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  const mac = createHmac('sha256', key()).update(`${purpose}:${body}`).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(state: string, purpose = 'oauth'): number | null {
  const [userId, exp, mac] = state.split('.');
  if (!userId || !exp || !mac) return null;
  const expected = createHmac('sha256', key()).update(`${purpose}:${userId}.${exp}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (parseInt(exp, 10) < Date.now() / 1000) return null;
  return parseInt(userId, 10);
}

/**
 * Short code for an invite link, t.me/<bot>?start=inv_<code> (Telegram allows 64 chars of [A-Za-z0-9_-]).
 * Signed, so nobody can claim to have been invited by someone else; doesn't expire.
 */
export function signInvite(userId: number): string {
  const mac = createHmac('sha256', key()).update(`invite:${userId}`).digest('base64url').slice(0, 12);
  return `${userId.toString(36)}_${mac}`;
}

export function verifyInvite(code: string): number | null {
  const sep = code.indexOf('_');
  if (sep < 1) return null;
  const userId = parseInt(code.slice(0, sep), 36);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const a = Buffer.from(code);
  const b = Buffer.from(signInvite(userId));
  return a.length === b.length && timingSafeEqual(a, b) ? userId : null;
}
