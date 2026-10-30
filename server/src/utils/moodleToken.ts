import { createHash } from 'crypto';

/*
 * Moodle grades, owner-only experiment. Moodle's own app signs in through admin/tool/mobile/launch.php:
 * after the Google sign-in the page links to moodlemobile://token=BASE64(siteid:::token[:::privatetoken]),
 * siteid = md5(wwwroot + passport). The student copies that link into KSE Hub; we keep only the token.
 * The QR sign-in is not used: Moodle allows it to its official app only.
 */

export const MOODLE_URL = 'https://teaching.kse.org.ua';

/** KSE Moodle's Google sign-in (identityproviders in tool_mobile_get_public_config: auth/oauth2/login.php?id=2) */
export const MOODLE_GOOGLE_ISSUER = 2;

/**
 * The page that hands out the student's own token after they sign in; `confirmed=1` shows the link instead of jumping.
 * `oauthsso` sends them through the Google sign-in first: KSE Moodle gives a token only right after a sign-in
 * ("Плагін не ввімкнено або не налаштовано" for an already open session).
 */
export function launchUrl(passport: string, wwwroot = MOODLE_URL) {
  const q = new URLSearchParams({ service: 'moodle_mobile_app', passport, urlscheme: 'moodlemobile', confirmed: '1', oauthsso: String(MOODLE_GOOGLE_ISSUER) });
  return `${wwwroot}/admin/tool/mobile/launch.php?${q}`;
}

export type LaunchParse = { token: string } | { error: 'no_token' | 'bad_token' | 'other_site' };

/**
 * "moodlemobile://token=…" (or just the part after token=) → the web service token.
 * The site id must be md5(wwwroot + passport) of the link we gave: a link from another Moodle, or from someone
 * else's sign-in page, doesn't fit. The private token (auto-login into the website) is dropped, never stored.
 */
export function parseLaunchLink(text: string, passport: string, wwwroot = MOODLE_URL): LaunchParse {
  const b64 = text.trim().match(/token=([A-Za-z0-9+/=_-]+)/)?.[1];
  if (!b64) return { error: 'no_token' };
  let decoded: string;
  try {
    decoded = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return { error: 'bad_token' };
  }
  const [siteId, token] = decoded.split(':::');
  if (!siteId || !token || !/^[a-f0-9]{32}$/i.test(token)) return { error: 'bad_token' };
  if (siteId !== createHash('md5').update(wwwroot + passport).digest('hex')) return { error: 'other_site' };
  return { token };
}

/** "ECON100 Principles of Economics" / shortname "ECON100-L1" → "ECON100" */
export const courseCodeOf = (...names: (string | null | undefined)[]) =>
  names.map((n) => n?.match(/\b([A-Z]{2,6}\s?\d{3}[A-Z]?)\b/)?.[1]?.replace(/\s/g, '')).find(Boolean) ?? null;

/** Moodle's grade strings carry HTML and "-" for "not graded yet" */
export const cleanGrade = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return !t || t === '-' ? null : t;
};
