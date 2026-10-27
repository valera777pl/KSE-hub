import { Hono } from 'hono';
import { signState } from '../utils/crypto.js';
import { SESSION_PURPOSE, SESSION_TTL_S } from '../middleware/telegramAuth.js';

/**
 * initData is signed once, when Telegram opens the mini app, and the same string lives for the
 * whole session. The app trades it for a 24-hour session token right away, so a mini app left
 * open for an hour keeps working without accepting stale initData for a day.
 */
const authRoutes = new Hono();

// POST /api/auth/session — only with fresh initData; a session can't extend itself
authRoutes.post('/session', (c) => {
  const header = c.req.header('Authorization') ?? '';
  const viaDev = process.env.NODE_ENV === 'development' && !!c.req.header('X-Dev-User-Id');
  if (!header.startsWith('tma ') && !viaDev) {
    return c.json({ error: 'Session needs Telegram initData', code: 'auth_invalid' }, 401);
  }
  const user = c.get('dbUser');
  return c.json({
    token: signState(user.id, SESSION_TTL_S, SESSION_PURPOSE),
    expiresAt: new Date(Date.now() + SESSION_TTL_S * 1000).toISOString(),
  });
});

export { authRoutes };
