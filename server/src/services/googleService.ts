import { db } from '../db/connection.js';
import { googleAccounts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt, encrypt, signState } from '../utils/crypto.js';
import { appUrl } from '../bot/send.js';
import { AppError } from '../middleware/errorHandler.js';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];
const ALLOWED_DOMAIN = 'kse.org.ua';

function redirectUri() {
  return `${appUrl()}/api/google/callback`;
}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new AppError('Google login is not configured yet', 503);
  return { clientId, clientSecret };
}

export class GoogleService {
  /** URL that starts the Google consent flow for this KSE Hub user. */
  static authUrl(userId: number): string {
    const params = new URLSearchParams({
      client_id: credentials().clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // always return a refresh token, also on reconnect
      include_granted_scopes: 'true',
      hd: ALLOWED_DOMAIN,
      state: signState(userId),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Exchange the callback code, check it's a @kse.org.ua account, store the encrypted refresh token. */
  static async completeLogin(userId: number, code: string): Promise<string> {
    const { clientId, clientSecret } = credentials();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const token = await res.json() as { refresh_token?: string; access_token?: string; scope?: string; error?: string };
    if (!res.ok || !token.access_token) throw new AppError(`Google token exchange failed: ${token.error ?? res.status}`, 502);
    if (!token.refresh_token) throw new AppError('Google did not return a refresh token', 502);

    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).then((r) => r.json() as Promise<{ email?: string; email_verified?: boolean; hd?: string }>);

    if (!info.email || !info.email_verified || info.hd !== ALLOWED_DOMAIN) {
      throw new AppError(`Потрібна пошта @${ALLOWED_DOMAIN}`, 403);
    }

    const values = {
      userId,
      email: info.email,
      refreshTokenEnc: encrypt(token.refresh_token),
      scopes: token.scope ?? null,
      syncError: null,
      connectedAt: new Date(),
    };
    await db.insert(googleAccounts).values(values).onConflictDoUpdate({ target: googleAccounts.userId, set: values });
    return info.email;
  }

  /** Fresh access token from the stored refresh token. */
  static async accessToken(account: typeof googleAccounts.$inferSelect): Promise<string> {
    const { clientId, clientSecret } = credentials();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decrypt(account.refreshTokenEnc),
        grant_type: 'refresh_token',
      }),
    });
    const token = await res.json() as { access_token?: string; error?: string };
    if (!res.ok || !token.access_token) {
      // invalid_grant = the student revoked access; keep the row so the UI can ask to reconnect
      await db.update(googleAccounts).set({ syncError: token.error ?? `HTTP ${res.status}` }).where(eq(googleAccounts.id, account.id));
      throw new AppError(`Google refresh failed: ${token.error ?? res.status}`, 502);
    }
    return token.access_token;
  }

  static async disconnect(userId: number) {
    const [account] = await db.delete(googleAccounts).where(eq(googleAccounts.userId, userId)).returning();
    if (!account) return;
    // Best effort: also revoke on Google's side
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decrypt(account.refreshTokenEnc) }),
    }).catch(() => {});
  }

  static async getAccount(userId: number) {
    const [account] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, userId)).limit(1);
    return account ?? null;
  }
}
