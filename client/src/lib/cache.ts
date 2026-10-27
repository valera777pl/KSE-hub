import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, toApiError } from '../api/client';
import { tg } from './telegram';

/* Last good answer of each screen, so a failed refresh shows data with "дані на 20:58"
   instead of an empty error. Per Telegram user, in this device's localStorage only. */

const PREFIX = 'kh:cache:v1:';
const who = () => String(tg()?.initDataUnsafe.user?.id ?? 'dev');
const keyOf = (name: string) => `${PREFIX}${who()}:${name}`;

type Entry<T> = { data: T; savedAt: number };

function read<T>(name: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(keyOf(name));
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch { return null; }
}

function write<T>(name: string, data: T) {
  try { localStorage.setItem(keyOf(name), JSON.stringify({ data, savedAt: Date.now() })); } catch { /* full or blocked */ }
}

/** Drops cached screens: all of them (after "Видалити мої дані"), or only other people's on this device. */
export function clearCache(othersOnly = false) {
  try {
    const mine = `${PREFIX}${who()}:`;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX) && !(othersOnly && k.startsWith(mine))) localStorage.removeItem(k);
    }
  } catch { /* storage blocked */ }
}

export interface Cached<T> {
  data: T | null;
  /** Why the last refresh failed; null while fresh or loading */
  error: ApiError | null;
  /** When the shown data was saved, if it's older than this attempt (refresh failed) */
  staleAt: number | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Loads `name` with `fetcher`, showing the cached copy first.
 * `keep` trims what goes to storage (mail keeps subject, sender and time, never the text);
 * a new `version` asks again under the same name (rooms: the slot moved with the clock);
 * `persist: false` loads without saving (a search query isn't worth keeping).
 */
export function useCached<T>(name: string | null, fetcher: () => Promise<T>,
  { keep, version, persist = true }: { keep?: (data: T) => T; version?: string | number; persist?: boolean } = {}): Cached<T> {
  const [state, setState] = useState<{ name: string | null; data: T | null; error: ApiError | null; staleAt: number | null; loading: boolean }>(
    () => ({ name, data: name ? read<T>(name)?.data ?? null : null, error: null, staleAt: null, loading: true }),
  );
  const [attempt, setAttempt] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const keepRef = useRef(keep);
  keepRef.current = keep;
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    const hit = read<T>(name);
    // Same name again ("Оновити"): keep the banner up while asking; a new name starts clean
    setState((s) => (s.name === name
      ? { ...s, data: s.data ?? hit?.data ?? null, loading: true }
      : { name, data: hit?.data ?? null, error: null, staleAt: null, loading: true }));
    fetchRef.current().then(
      (data) => {
        if (cancelled) return;
        if (persistRef.current) write(name, keepRef.current ? keepRef.current(data) : data);
        setState({ name, data, error: null, staleAt: null, loading: false });
      },
      (e) => {
        if (cancelled) return;
        const saved = read<T>(name);
        setState((s) => ({
          name,
          data: s.data ?? saved?.data ?? null,
          error: toApiError(e),
          staleAt: s.data || saved ? saved?.savedAt ?? Date.now() : null,
          loading: false,
        }));
      },
    );
    return () => { cancelled = true; };
  }, [name, attempt, version]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { data: state.data, error: state.error, staleAt: state.staleAt, loading: state.loading, refresh };
}
