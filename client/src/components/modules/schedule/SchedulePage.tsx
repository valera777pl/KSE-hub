import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDrag } from '@use-gesture/react';
import { CalendarCheck, CalendarX2, ChevronLeft, ChevronRight, Coffee, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { api } from '../../../api/client';
import type { ClassEvent, ScheduleCompare, StudentMatch } from '../../../types';
import { addDays, dayKey, dayMonth, dayNum, dayTitle, hm, mondayOf, now, spanText, todayKey, weekdayShort, weekOf } from '../../../lib/time';
import { classKind, initials, shortPlace } from '../../../lib/place';
import { cloud, haptic, openExternal } from '../../../lib/telegram';
import { useUi } from '../../../stores/uiStore';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, SkeletonRows } from '../../ui/States';
import { track } from '../../../api/client';

const OFFICIAL_SCHEDULE = 'https://schedule.kse.ua/';
const MAX_FRIENDS = 5;
const FRIENDS_KEY = 'compare_friends';

type Friend = { userId: number; name: string };
type Week = { connected: boolean; synced: boolean; events: ClassEvent[] };

/** One week of my classes per Monday, fetched once and kept while the screen is open. */
function useWeek(monday: string, reloadKey: number) {
  const cache = useRef(new Map<string, Week>());
  const [week, setWeek] = useState<Week | null>(cache.current.get(monday) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hit = cache.current.get(monday);
    setWeek(hit ?? null);
    setError(null);
    if (hit && reloadKey === 0) return;
    api.get<Week>(`/schedule/week?start=${monday}`)
      .then((w) => { if (cancelled) return; cache.current.set(monday, w); setWeek(w); })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [monday, reloadKey]);

  return { week, error };
}

/** Friends I compare with: remembered in Telegram cloud storage, their weeks loaded in parallel. */
function useFriends(monday: string) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [active, setActive] = useState<Set<number>>(new Set());
  const [weeks, setWeeks] = useState<Map<number, ScheduleCompare>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    cloud.get(FRIENDS_KEY).then((raw) => {
      try {
        const saved = JSON.parse(raw || '[]') as Friend[];
        setFriends(saved);
        setActive(new Set(saved.map((f) => f.userId)));
      } catch { /* nothing saved yet */ }
    });
  }, []);

  const save = (list: Friend[]) => { setFriends(list); cloud.set(FRIENDS_KEY, JSON.stringify(list)); };

  useEffect(() => {
    let cancelled = false;
    setWeeks(new Map());
    Promise.all(friends.map((f) =>
      api.get<ScheduleCompare>(`/schedule/compare/${f.userId}?start=${monday}`)
        .then((r) => [f.userId, r] as const)
        .catch((e: Error) => {
          // Hidden since we added them: say so once and drop them from the strip
          if (!cancelled) {
            setNotice(`${f.name.split(' ')[0]} приховує розклад — прибрали зі списку`);
            save(friends.filter((x) => x.userId !== f.userId));
          }
          return [f.userId, null, e] as const;
        })))
      .then((rows) => { if (!cancelled) setWeeks(new Map(rows.filter((r) => r[1]).map((r) => [r[0], r[1]!]))); });
    return () => { cancelled = true; };
  }, [friends.map((f) => f.userId).join(','), monday]);

  const add = (s: StudentMatch) => {
    if (friends.some((f) => f.userId === s.userId) || friends.length >= MAX_FRIENDS) return;
    save([...friends, { userId: s.userId, name: s.name }]);
    setActive((a) => new Set(a).add(s.userId));
    track('schedule.friend_added');
  };
  const remove = (id: number) => { save(friends.filter((f) => f.userId !== id)); setActive((a) => { const n = new Set(a); n.delete(id); return n; }); };
  const toggle = (id: number) => setActive((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /** Who of the active friends sits in this very class: same section calendar, same start. */
  const withMe = useCallback((e: ClassEvent): Friend[] =>
    friends.filter((f) => active.has(f.userId) && weeks.get(f.userId)?.events.some((x) => x.shared && x.calendarId === e.calendarId && x.startAt === e.startAt)),
  [friends, active, weeks]);

  return { friends, active, add, remove, toggle, withMe, notice, clearNotice: () => setNotice(null) };
}

export function SchedulePage() {
  const today = todayKey();
  const requested = useUi((s) => s.scheduleDay);
  const [day, setDay] = useState(requested ?? today);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ClassEvent | null>(null);
  const [adding, setAdding] = useState(false);

  const monday = mondayOf(day);
  const days = useMemo(() => weekOf(day), [monday]);
  const { week, error } = useWeek(monday, reloadKey);
  const pals = useFriends(monday);

  const byDay = useMemo(() => {
    const map = new Map<string, ClassEvent[]>();
    for (const e of week?.events ?? []) {
      const k = dayKey(new Date(e.startAt));
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [week]);

  const go = (next: string) => {
    if (next === day) return;
    haptic.select();
    setDir(next > day ? 'next' : 'prev');
    setDay(next);
  };

  // Swipe the list sideways for the neighbouring day
  const bind = useDrag(({ swipe: [sx] }) => { if (sx) go(addDays(day, -sx)); }, { axis: 'x', filterTaps: true, swipe: { distance: 40, velocity: 0.3 } });

  const refresh = async () => {
    setRefreshing(true);
    try { await api.post('/schedule/refresh'); setReloadKey((k) => k + 1); } catch { /* error shows on reload */ }
    setRefreshing(false);
  };

  const sharedThisWeek = useMemo(
    () => (week?.events ?? []).filter((e) => pals.withMe(e).length > 0).length,
    [week, pals.withMe],
  );

  if (week && !week.synced) {
    return (
      <div className="group">
        <EmptyState
          icon={CalendarCheck}
          title={week.connected ? 'Один крок, щоб побачити пари' : 'Підключи пошту KSE'}
          text={week.connected
            ? 'На schedule.kse.ua натисни на своє імʼя вгорі справа → Sync with Google Calendar. Потім повернись і онови.'
            : 'Розклад підтягується з календаря KSE тим самим входом Google.'}
          action={week.connected ? { label: 'Відкрити schedule.kse.ua', onClick: () => openExternal(OFFICIAL_SCHEDULE) } : undefined}
        />
        {week.connected && (
          <button className="btn-plain press" style={{ borderTop: '0.5px solid var(--separator)', borderRadius: 0 }} onClick={refresh} disabled={refreshing}>
            <RefreshCw strokeWidth={1.75} /> {refreshing ? 'Перевіряю…' : 'Я синхронізував, оновити'}
          </button>
        )}
      </div>
    );
  }

  const list = byDay.get(day) ?? [];
  const range = `${dayMonth(days[0])} – ${dayMonth(days[6])}`.replace(/ (\S+) – (\d+) \1$/, ' – $2 $1');

  return (
    <>
      <div className="week-nav">
        <button className="icon-btn press" aria-label="Попередній тиждень" onClick={() => go(addDays(monday, -7))}><ChevronLeft strokeWidth={1.75} /></button>
        <span className="week-nav__label num">{range}</span>
        <button className="icon-btn press" aria-label="Наступний тиждень" onClick={() => go(addDays(monday, 7))}><ChevronRight strokeWidth={1.75} /></button>
      </div>

      <div className="daystrip" role="group" aria-label="День тижня">
        {days.map((k) => (
          <button key={k} className={`day press${k === today ? ' day--today' : ''}`} aria-pressed={k === day} onClick={() => go(k)}
            aria-label={dayTitle(k)}>
            {weekdayShort(k)}
            <b className="num">{dayNum(k)}</b>
            <i className={byDay.has(k) ? '' : 'none'} />
          </button>
        ))}
      </div>

      <div className="friends" aria-label="Порівняти з друзями">
        {pals.friends.map((f) => (
          <button key={f.userId} className="friend press" aria-pressed={pals.active.has(f.userId)} onClick={() => { haptic.select(); pals.toggle(f.userId); }}>
            <span className="mini">{initials(f.name)}</span>{f.name.split(' ')[0]}
          </button>
        ))}
        {pals.friends.length < MAX_FRIENDS && (
          <button className="friend friend--add press" onClick={() => setAdding(true)}>
            <Plus strokeWidth={2} />{pals.friends.length ? 'Додати' : 'Порівняти з друзями'}
          </button>
        )}
      </div>

      <div className="caption" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span>{day === today ? 'Сьогодні' : dayTitle(day)}</span>
        {day !== today
          ? <button className="link-btn" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 15, padding: 0 }} onClick={() => go(today)}>Сьогодні</button>
          : pals.active.size > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}>Спільних цього тижня: {sharedThisWeek}</span>}
      </div>

      {pals.notice && <p className="note" style={{ paddingTop: 0, paddingBottom: 8 }} onClick={pals.clearNotice}>{pals.notice}</p>}

      <div {...bind()} style={{ touchAction: 'pan-y' }}>
        <div key={day} className={dir ? `slide-${dir}` : undefined}>
          {error ? (
            <div className="group">
              <EmptyState icon={CalendarX2} title="Не вдалося завантажити розклад" text={error} action={{ label: 'Спробувати ще раз', onClick: () => setReloadKey((k) => k + 1) }} />
            </div>
          ) : !week ? (
            <SkeletonRows rows={3} />
          ) : list.length === 0 ? (
            <div className="group">
              <EmptyState icon={Coffee} title={day < today ? 'Цього дня пар не було' : 'Цього дня пар немає'} />
            </div>
          ) : (
            <div className="group">
              {list.map((e) => <ClassRow key={e.id} e={e} friends={pals.withMe(e)} onOpen={() => { haptic.tap(); setOpen(e); }} />)}
            </div>
          )}
        </div>
      </div>

      {open && <ClassSheet e={open} friends={pals.withMe(open)} onClose={() => setOpen(null)} />}
      {adding && <AddFriendSheet taken={pals.friends} onPick={(s) => { haptic.success(); pals.add(s); setAdding(false); }} onRemove={pals.remove} onClose={() => setAdding(false)} />}
    </>
  );
}

function ClassRow({ e, friends, onOpen }: { e: ClassEvent; friends: Friend[]; onOpen: () => void }) {
  const t = now().getTime();
  const start = new Date(e.startAt).getTime();
  const end = new Date(e.endAt).getTime();
  const status = t >= end ? 'past' : t >= start ? 'now' : 'next';
  const progress = status === 'now' ? ((t - start) / (end - start)) * 100 : 0;

  return (
    <button className={`class press class--${status}`} onClick={onOpen}>
      <div className="class__time">{hm(e.startAt)}<span>{hm(e.endAt)}</span></div>
      <div style={{ minWidth: 0 }}>
        <div className="class__code">
          {e.courseCode}{e.section && <small>[{e.section}]</small>}
          {friends.length > 0 && (
            <span className="avatars" aria-label={`Разом з: ${friends.map((f) => f.name).join(', ')}`}>
              {friends.slice(0, 3).map((f) => <span key={f.userId} className="mini">{initials(f.name)}</span>)}
            </span>
          )}
        </div>
        <div className="class__place">
          {status === 'now' ? `${shortPlace(e.location) ?? ''} · ще ${spanText(end - t)}` : shortPlace(e.location)}
        </div>
        {status === 'now' && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      </div>
    </button>
  );
}

function ClassSheet({ e, friends, onClose }: { e: ClassEvent; friends: Friend[]; onClose: () => void }) {
  const key = dayKey(new Date(e.startAt));
  const kind = classKind(e.section);
  return (
    <Sheet onClose={onClose} label={e.courseCode}>
      <div className="sheet__title">{e.courseCode}{e.section ? ` [${e.section}]` : ''}</div>
      <div className="sheet__sub">{e.title}</div>
      <div className="caption">Коли і де</div>
      <div className="group">
        <div className="row"><div className="row__main"><div className="row__title num">{hm(e.startAt)}–{hm(e.endAt)}</div><div className="row__meta">{key === todayKey() ? 'сьогодні' : dayTitle(key)}{kind ? ` · ${kind}` : ''}</div></div></div>
        <div className="row"><div className="row__main"><div className="row__title">{shortPlace(e.location) ?? 'Аудиторію не вказано'}</div></div></div>
      </div>
      {friends.length > 0 && (
        <>
          <div className="caption">Там же</div>
          <div className="group">
            {friends.map((f) => (
              <div className="row" key={f.userId}><span className="mini" style={{ width: 28, height: 28, fontSize: 12 }}>{initials(f.name)}</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div></div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function AddFriendSheet({ taken, onPick, onRemove, onClose }: {
  taken: Friend[]; onPick: (s: StudentMatch) => void; onRemove: (id: number) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<StudentMatch[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setFound(null); return; }
    const timer = setTimeout(() => {
      api.get<{ students: StudentMatch[] }>(`/schedule/search?q=${encodeURIComponent(q)}`).then((r) => setFound(r.students)).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const takenIds = new Set(taken.map((f) => f.userId));

  return (
    <Sheet onClose={onClose} label="Порівняти з друзями">
      <div className="sheet__title">Порівняти з друзями</div>
      <div className="sheet__sub">Покажемо спільні пари. До {MAX_FRIENDS} людей.</div>
      <div className="field-wrap" style={{ marginTop: 16 }}>
        <Search strokeWidth={1.75} />
        <input className="field" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Прізвище" enterKeyHint="search" />
      </div>

      {found && found.length > 0 && (
        <div className="group" style={{ marginTop: 12 }}>
          {found.map((s) => (
            <button key={s.userId} className="row press" disabled={takenIds.has(s.userId)} onClick={() => onPick(s)}>
              <span className="mini" style={{ width: 32, height: 32, fontSize: 13 }}>{initials(s.name)}</span>
              <div className="row__main">
                <div className="row__title" style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="row__meta">{[s.cohort && `вступ ${s.cohort}`, s.username && `@${s.username}`].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="row__side">{takenIds.has(s.userId) ? 'Уже додано' : ''}</span>
            </button>
          ))}
        </div>
      )}
      {found && found.length === 0 && (
        <EmptyState icon={Users} title="Нікого не знайдено" text="Видно лише тих, хто підключив пошту в KSE Hub і не приховав розклад." />
      )}

      {!found && taken.length > 0 && (
        <>
          <div className="caption">Уже порівнюєш</div>
          <div className="group">
            {taken.map((f) => (
              <div className="row" key={f.userId}>
                <span className="mini" style={{ width: 32, height: 32, fontSize: 13 }}>{initials(f.name)}</span>
                <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div>
                <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => { haptic.tap(); onRemove(f.userId); }}>Прибрати</button>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
