import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import type { ClassEvent, ScheduleCompare, StudentMatch } from '../../../types';

const TZ = 'Europe/Kyiv';
const DAY = 86_400_000;

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const time = (iso: string) => new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayTitle = (key: string) =>
  new Intl.DateTimeFormat('uk-UA', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00Z`));

/** Monday (Kyiv calendar date) of the week `offset` weeks from now, plus its 7 day keys. */
function weekDays(offset: number): string[] {
  const today = new Date(`${dayKey(new Date())}T12:00:00Z`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY + offset * 7 * DAY);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY).toISOString().slice(0, 10));
}

const OFFICIAL_SCHEDULE = 'https://schedule.kse.ua/';

function openExternal(url: string) {
  // @ts-ignore - Telegram WebApp SDK
  const tg = window.Telegram?.WebApp;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

/** One-time step on the official site: it adds all the student's course calendars to Google Calendar. */
function SyncHint({ compact, onRefresh, refreshing }: { compact?: boolean; onRefresh: () => void; refreshing: boolean }) {
  if (compact) {
    return (
      <div className="text-sm text-hint" style={{ textAlign: 'center', margin: '8px 0 16px' }}>
        Бачиш не всі пари?{' '}
        <button className="font-semibold" style={{ textDecoration: 'underline' }} onClick={() => openExternal(OFFICIAL_SCHEDULE)}>
          Синхронізуй на schedule.kse.ua
        </button>{' '}
        і{' '}
        <button className="font-semibold" style={{ textDecoration: 'underline' }} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'оновлюю…' : 'онови'}
        </button>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: '16px', marginBottom: '12px' }}>
      <div className="font-semibold" style={{ marginBottom: '6px' }}>🗓 Один крок, щоб побачити пари</div>
      <div className="text-sm text-hint" style={{ lineHeight: 1.5, marginBottom: '12px' }}>
        1. Відкрий офіційний розклад KSE і увійди своєю поштою @kse.org.ua<br />
        2. Натисни на своє імʼя вгорі справа → <b>Sync with Google Calendar</b> і підтверди<br />
        3. Повернись сюди й натисни «Оновити» (якщо пар ще немає — KSE додає їх кілька хвилин)
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => openExternal(OFFICIAL_SCHEDULE)}>Відкрити schedule.kse.ua</button>
        <button className="btn btn--secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? '…' : 'Оновити'}</button>
      </div>
    </div>
  );
}

const kind = (section: string | null) => (section?.startsWith('L') ? 'Лекція' : section?.startsWith('P') ? 'Практика' : null);

export function SchedulePage() {
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => weekDays(offset), [offset]);
  const [connected, setConnected] = useState(true);
  const [synced, setSynced] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [mine, setMine] = useState<ClassEvent[]>([]);
  const [compare, setCompare] = useState<ScheduleCompare | null>(null);
  const [selected, setSelected] = useState<StudentMatch | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // My week, or the selected student's week with shared classes marked
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = selected
      ? api.get<ScheduleCompare>(`/schedule/compare/${selected.userId}?start=${days[0]}`).then((r) => !cancelled && setCompare(r))
      : api.get<{ connected: boolean; synced: boolean; events: ClassEvent[] }>(`/schedule/week?start=${days[0]}`).then((r) => {
          if (cancelled) return;
          setConnected(r.connected);
          setSynced(r.synced);
          setMine(r.events);
        });
    load.catch((err) => !cancelled && setError(err.message)).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [days, selected, reloadKey]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/schedule/refresh');
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  // Debounced student search
  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      api.get<{ students: StudentMatch[] }>(`/schedule/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => setMatches(r.students))
        .catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const events: (ClassEvent & { shared?: boolean })[] = selected ? compare?.events ?? [] : mine;
  const byDay = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const e of events) {
      const key = dayKey(new Date(e.startAt));
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [events]);
  const sharedCount = events.filter((e) => e.shared).length;

  const pick = (student: StudentMatch) => {
    setSelected(student);
    setCompare(null);
    setQuery('');
    setMatches([]);
  };

  const range = `${dayTitle(days[0]).split(', ')[1]} – ${dayTitle(days[6]).split(', ')[1]}`;

  if (!connected && !selected) {
    return (
      <div className="page">
        <h1 className="section-header__title mb-md">Розклад</h1>
        <div className="empty-state">
          <div className="empty-state__icon">🗓</div>
          <div className="empty-state__title">Підключи пошту KSE</div>
          <div className="empty-state__text">
            Розклад підтягується з календаря KSE тим самим входом Google. Профіль (вгорі зліва) → «Підключити пошту».
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-header">
        <h1 className="section-header__title">Розклад</h1>
      </div>

      {/* Compare with another student */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        {selected ? (
          <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-semibold">{selected.name}{selected.cohort ? ` · ${selected.cohort}` : ''}</div>
              <div className="text-sm text-hint">
                {compare ? (sharedCount ? `Спільних пар цього тижня: ${sharedCount}` : 'Цього тижня спільних пар немає') : '…'}
              </div>
            </div>
            <button className="btn btn--secondary btn--small" onClick={() => setSelected(null)}>Мій розклад</button>
          </div>
        ) : (
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔎 Порівняти з… (прізвище студента)"
          />
        )}
        {matches.length > 0 && (
          <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: '4px', padding: '4px', zIndex: 10 }}>
            {matches.map((s) => (
              <button
                key={s.userId}
                onClick={() => pick(s)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '8px' }}
              >
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-hint">{s.cohort ? ` · ${s.cohort}` : ''}{s.username ? ` · @${s.username}` : ''}</span>
              </button>
            ))}
          </div>
        )}
        {query.trim().length >= 2 && matches.length === 0 && (
          <div className="text-sm text-hint" style={{ marginTop: '6px' }}>
            Нікого не знайдено. Видно лише студентів, які підключили пошту в KSE Hub і не приховали розклад.
          </div>
        )}
      </div>

      {/* Week switcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button className="btn btn--secondary btn--small" onClick={() => setOffset(offset - 1)}>‹</button>
        <div className="font-semibold" style={{ flex: 1, textAlign: 'center' }}>{range}</div>
        {offset !== 0 && <button className="btn btn--secondary btn--small" onClick={() => setOffset(0)}>Сьогодні</button>}
        <button className="btn btn--secondary btn--small" onClick={() => setOffset(offset + 1)}>›</button>
      </div>

      {selected && sharedCount > 0 && (
        <div className="text-sm text-hint" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--accent-lime)', display: 'inline-block' }} />
          спільна пара
        </div>
      )}

      {error && <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: '12px' }}>❌ {error}</div>}

      {!selected && !synced && <SyncHint onRefresh={refresh} refreshing={refreshing} />}

      {!selected && !synced ? null : loading ? (
        <div className="text-sm text-hint" style={{ textAlign: 'center', padding: '24px' }}>Завантаження…</div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🎉</div>
          <div className="empty-state__title">Пар цього тижня немає</div>
        </div>
      ) : (
        days.filter((d) => byDay.has(d)).map((d) => (
          <div key={d} style={{ marginBottom: '16px' }}>
            <div className="profile-section__title" style={{ textTransform: 'none', fontSize: '13px' }}>
              {dayTitle(d)}{d === dayKey(new Date()) ? ' · сьогодні' : ''}
            </div>
            {byDay.get(d)!.map((e) => (
              <div
                key={e.id}
                className="card"
                style={{
                  padding: '12px 14px',
                  marginBottom: '8px',
                  display: 'flex',
                  gap: '12px',
                  ...(e.shared ? { background: 'var(--accent-lime-bg)', borderColor: 'var(--accent-lime-border)' } : {}),
                }}
              >
                <div style={{ minWidth: '48px', fontVariantNumeric: 'tabular-nums' }}>
                  <div className="font-semibold">{time(e.startAt)}</div>
                  <div className="text-sm text-hint">{time(e.endAt)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-semibold">
                    {e.courseCode} <span className="text-hint">[{e.section}]</span>
                    {e.shared && <span className="badge badge--grant" style={{ marginLeft: '6px' }}>разом</span>}
                  </div>
                  <div className="text-sm">{e.title.replace(/^[A-Z]{2,6}\d{3}[A-Z]?\s*/, '')}</div>
                  <div className="text-sm text-hint">
                    {[kind(e.section), e.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {!selected && synced && !loading && <SyncHint compact onRefresh={refresh} refreshing={refreshing} />}
    </div>
  );
}
