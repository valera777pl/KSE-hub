import { tr } from '../lib/i18n';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/* ─── Errors: one kind per real cause, each with its own words ─── */

export type ErrorKind = 'network' | 'auth' | 'server' | 'notFound' | 'rejected';

export class ApiError extends Error {
  kind: ErrorKind;
  status: number;
  constructor(kind: ErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('network', 0, (e as Error)?.message ?? 'network');
}

// Server texts written for students are Ukrainian ("Цей час уже хтось забронював…"); English ones are internal
const forStudents = (text: string) => /[а-щьюяєіїґ]/i.test(text);

/** What to tell the student about a failed request, never the raw server message. */
export function errorText(e: unknown): string {
  const err = toApiError(e);
  switch (err.kind) {
    case 'rejected': return forStudents(err.message) ? err.message : tr('Не вийшло. Перевір дані й спробуй ще раз.', 'That didn\'t work. Check and try again.');
    case 'network': return tr('Немає звʼязку. Перевір інтернет.', 'No connection. Check your internet.');
    case 'auth': return tr('Закрий і відкрий KSE Hub з меню бота.', 'Close and reopen KSE Hub from the bot menu.');
    case 'notFound': return forStudents(err.message) ? err.message : tr('Цього вже немає.', 'This is no longer here.');
    default: return tr('Сервер не відповідає. Спробуй за хвилину.', 'The server isn\'t responding. Try again in a minute.');
  }
}

/** Short headline for the same causes, for empty states. */
export function errorTitle(e: unknown): string {
  const kind = toApiError(e).kind;
  if (kind === 'network') return tr('Немає звʼязку', 'No connection');
  if (kind === 'server') return tr('Не вдалося завантажити', 'Couldn\'t load');
  return tr('Не вийшло', 'That didn\'t work');
}

/* ─── Auth: Telegram's initData is traded for a 24-hour session on open (server/routes/auth.ts) ─── */

function initData(): string {
  try {
    // @ts-ignore - Telegram WebApp SDK
    return window.Telegram?.WebApp?.initData || '';
  } catch {
    return '';
  }
}

// Local server without Telegram: the dev user header, no session
const devBypass = () => import.meta.env.DEV && !initData();

/** Opened outside Telegram's mini app button (a plain link, a reply keyboard): nothing to sign in with. */
export const canSignIn = () => !!initData() || devBypass();

let session: string | null = null;
let pending: Promise<string | null> | null = null;
const lostListeners = new Set<() => void>();

/** Called once sign-in is gone for good: the app shows "close and reopen". */
export function onAuthLost(cb: () => void) {
  lostListeners.add(cb);
  return () => { lostListeners.delete(cb); };
}

function authLost(): never {
  lostListeners.forEach((cb) => cb());
  throw new ApiError('auth', 401, 'auth');
}

/** Session token, fetched once and shared by concurrent requests. null = server too old, use initData. */
function getSession(): Promise<string | null> {
  if (session) return Promise.resolve(session);
  pending ??= (async () => {
    const res = await send('/auth/session', { method: 'POST' }, `tma ${initData()}`);
    if (res.status === 404) return null;
    if (res.status === 401) authLost();
    if (!res.ok) throw await failure(res);
    session = ((await res.json()) as { token: string }).token;
    return session;
  })().finally(() => { pending = null; });
  return pending;
}

async function send(endpoint: string, options: RequestInit, auth: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
    ...(devBypass() ? { 'X-Dev-User-Id': import.meta.env.VITE_DEV_USER_ID || '12345678' } : {}),
    ...(options.headers as Record<string, string> || {}),
  };
  try {
    return await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  } catch (e) {
    throw new ApiError('network', 0, (e as Error).message);
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  const message = body.error || body.message || `HTTP ${res.status}`;
  if (res.status === 401) return new ApiError('auth', 401, message);
  if (res.status === 404) return new ApiError('notFound', 404, message);
  if (res.status >= 500) return new ApiError('server', res.status, message);
  return new ApiError('rejected', res.status, message);
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!canSignIn()) authLost();
  const authHeader = async () => {
    if (devBypass()) return null;
    const token = await getSession();
    return token ? `Session ${token}` : `tma ${initData()}`;
  };

  let res = await send(endpoint, options, await authHeader());
  if (res.status === 401 && !devBypass()) {
    // Session ran out while the app stayed open: one quiet retry with a new one
    session = null;
    res = await send(endpoint, options, await authHeader());
    if (res.status === 401) authLost();
  }
  if (!res.ok) throw await failure(res);
  return res.json();
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint),
  post: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(endpoint: string, body?: any) =>
    apiRequest<T>(endpoint, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(endpoint: string) =>
    apiRequest<T>(endpoint, { method: 'DELETE' }),
};

/** Report a screen view or onboarding step for the admin dashboard; never throws. */
export function track(event: string) {
  apiRequest('/users/me/events', { method: 'POST', body: JSON.stringify({ event }) }).catch(() => {});
}
