import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDrag } from '@use-gesture/react';
import { CalendarCheck, ChevronLeft, ChevronRight, Coffee, Minus, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { api } from '../../../api/client';
import type { ClassEvent, ScheduleCompare, StudentMatch } from '../../../types';
import { addDays, dayKey, dayMonth, dayNum, dayTitle, hm, mondayOf, now, spanText, todayKey, weekdayShort, weekOf } from '../../../lib/time';
import { classKind, shortPlace } from '../../../lib/place';
import { Avatar } from '../../ui/Avatar';
import { cloud, haptic, openExternal } from '../../../lib/telegram';
import { useUi } from '../../../stores/uiStore';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { useCached } from '../../../lib/cache';
import { AskPanel } from '../../ui/AskPanel';
import { track } from '../../../api/client';
import { tr } from '../../../lib/i18n';

const OFFICIAL_SCHEDULE = 'https://schedule.kse.ua/';
const MAX_FRIENDS = 5;
const FRIENDS_KEY = 'compare_friends';
const ACTIVE_KEY = 'compare_active';
const MODE_KEY = 'compare_mode';

type Friend = { userId: number; name: string; avatarUrl?: string | null };
/** Лише мої · Разом · Спільні */
type Mode = 'mine' | 'together' | 'shared';
/** A class on the day's list: mine, or only my friends' (then `theirs`), with the friends in it */
type Row = { e: ClassEvent; theirs: boolean; friends: Friend[] };
type Week = { connected: boolean; synced: boolean; events: ClassEvent[] };

/** One week of my classes per Monday; the last good copy shows at once and when offline. */
const useWeek = (monday: string) => useCached(`week:${monday}`, () => api.get<Week>(`/schedule/week?start=${monday}`));

/** Friends I compare with, who of them is switched on and how: all remembered in Telegram cloud storage. */
function useFriends(monday: string) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [active, setActive] = useState<Set<number>>(new Set());
  const [mode, setModeState] = useState<Mode>('together');
  const [weeks, setWeeks] = useState<Map<number, ScheduleCompare>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([cloud.get(FRIENDS_KEY), cloud.get(ACTIVE_KEY), cloud.get(MODE_KEY)]).then(([rawFriends, rawActive, rawMode]) => {
      try {
        const saved = JSON.parse(rawFriends || '[]') as Friend[];
        setFriends(saved);
        // Before this was remembered, everyone added was on
        const on = rawActive ? (JSON.parse(rawActive) as number[]) : saved.map((f) => f.userId);
        setActive(new Set(on.filter((id) => saved.some((f) => f.userId === id))));
      } catch { /* nothing saved yet */ }
      if (rawMode === 'mine' || rawMode === 'together' || rawMode === 'shared') setModeState(rawMode);
    });
  }, []);

  const save = (list: Friend[]) => { setFriends(list); cloud.set(FRIENDS_KEY, JSON.stringify(list)); };
  const saveActive = (next: Set<number>) => { setActive(next); cloud.set(ACTIVE_KEY, JSON.stringify([...next])); };
  const setMode = (m: Mode) => { setModeState(m); cloud.set(MODE_KEY, m); };

  useEffect(() => {
    let cancelled = false;
    setWeeks(new Map());
    Promise.all(friends.map((f) =>
      api.get<ScheduleCompare>(`/schedule/compare/${f.userId}?start=${monday}`)
        .then((r) => [f.userId, r] as const)
        .catch((e: Error) => {
          // Hidden since we added them: say so once and drop them from the strip
          if (!cancelled) {
            setNotice(tr(`${f.name.split(' ')[0]} приховує розклад — прибрали зі списку`, `${f.name.split(' ')[0]} hid their schedule, removed from the list`));
            save(friends.filter((x) => x.userId !== f.userId));
          }
          return [f.userId, null, e] as const;
        })))
      .then((rows) => {
        if (cancelled) return;
        const found = rows.filter((r) => r[1]).map((r) => [r[0], r[1]!] as const);
        setWeeks(new Map(found));
        // A friend changed their Telegram photo since we saved them
        const fresh = friends.map((f) => {
          const url = found.find(([id]) => id === f.userId)?.[1].student.avatarUrl ?? null;
          return url !== (f.avatarUrl ?? null) ? { ...f, avatarUrl: url } : f;
        });
        if (fresh.some((f, i) => f !== friends[i])) save(fresh);
      });
    return () => { cancelled = true; };
  }, [friends.map((f) => f.userId).join(','), monday]);

  const add = (s: StudentMatch) => {
    if (friends.some((f) => f.userId === s.userId) || friends.length >= MAX_FRIENDS) return;
    save([...friends, { userId: s.userId, name: s.name, avatarUrl: s.avatarUrl ?? null }]);
    saveActive(new Set(active).add(s.userId));
    track('schedule.friend_added');
  };
  const remove = (id: number) => {
    save(friends.filter((f) => f.userId !== id));
    const next = new Set(active); next.delete(id); saveActive(next);
  };
  const toggle = (id: number) => { const next = new Set(active); if (next.has(id)) next.delete(id); else next.add(id); saveActive(next); };

  /** Who of the active friends sits in this very class: same section calendar, same start. */
  const withMe = useCallback((e: ClassEvent): Friend[] =>
    friends.filter((f) => active.has(f.userId) && weeks.get(f.userId)?.events.some((x) => x.shared && x.calendarId === e.calendarId && x.startAt === e.startAt)),
  [friends, active, weeks]);

  /** Active friends' classes on `day` that I'm not in, one row per class with everyone who's there. */
  const theirsOn = useCallback((day: string, mine: ClassEvent[]): Row[] => {
    const rows = new Map<string, Row>();
    for (const f of friends) {
      if (!active.has(f.userId)) continue;
      for (const x of weeks.get(f.userId)?.events ?? []) {
        if (dayKey(new Date(x.startAt)) !== day || mine.some((m) => m.calendarId === x.calendarId && m.startAt === x.startAt)) continue;
        const k = `${x.calendarId}|${x.startAt}`;
        const row = rows.get(k) ?? { e: x, theirs: true, friends: [] };
        row.friends.push(f);
        rows.set(k, row);
      }
    }
    return [...rows.values()];
  }, [friends, active, weeks]);

  // Without anyone switched on there's nothing to compare: it's just my day
  const effectiveMode: Mode = active.size ? mode : 'mine';
  return { friends, active, mode: effectiveMode, setMode, add, remove, toggle, withMe, theirsOn, notice, clearNotice: () => setNotice(null) };
}

export function SchedulePage() {
  const today = todayKey();
  const requested = useUi((s) => s.scheduleDay);
  const [day, setDay] = useState(requested ?? today);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ClassEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const monday = mondayOf(day);
  const days = useMemo(() => weekOf(day), [monday]);
  const weekQ = useWeek(monday);
  const week = weekQ.data;
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
    try { await api.post('/schedule/refresh'); weekQ.refresh(); } catch { /* error shows on reload */ }
    setRefreshing(false);
  };

  const sharedThisWeek = useMemo(
    () => (week?.events ?? []).filter((e) => pals.withMe(e).length > 0).length,
    [week, pals.withMe],
  );

  // Nobody left to edit: leave edit mode
  useEffect(() => { if (!pals.friends.length) setEditing(false); }, [pals.friends.length]);

  if (week && !week.synced) {
    return (
      <div className="group">
        <EmptyState
          icon={CalendarCheck}
          title={week.connected ? tr('Один крок, щоб побачити пари', 'One step to see your classes') : tr('Підключи пошту KSE', 'Connect your KSE mail')}
          text={week.connected
            ? tr('На schedule.kse.ua натисни на своє імʼя вгорі справа → Sync with Google Calendar. Потім повернись і онови.', 'On schedule.kse.ua tap your name at the top right → Sync with Google Calendar. Then come back and refresh.')
            : tr('Розклад підтягується з календаря KSE тим самим входом Google.', 'Your schedule comes from the KSE calendar through the same Google sign-in.')}
          action={week.connected ? { label: tr('Відкрити schedule.kse.ua', 'Open schedule.kse.ua'), onClick: () => openExternal(OFFICIAL_SCHEDULE) } : undefined}
        />
        {week.connected && (
          <button className="btn-plain press" style={{ borderTop: '0.5px solid var(--separator)', borderRadius: 0 }} onClick={refresh} disabled={refreshing}>
            <RefreshCw strokeWidth={1.75} /> {refreshing ? tr('Перевіряю…', 'Checking…') : tr('Я синхронізував, оновити', 'I\'ve synced, refresh')}
          </button>
        )}
      </div>
    );
  }

  const mineToday = byDay.get(day) ?? [];
  const rows: Row[] = pals.mode === 'mine'
    ? mineToday.map((e) => ({ e, theirs: false, friends: [] }))
    : pals.mode === 'shared'
      ? mineToday.map((e) => ({ e, theirs: false, friends: pals.withMe(e) })).filter((r) => r.friends.length > 0)
      : [...mineToday.map((e) => ({ e, theirs: false, friends: pals.withMe(e) })), ...pals.theirsOn(day, mineToday)]
        .sort((a, b) => a.e.startAt.localeCompare(b.e.startAt));
  const range = `${dayMonth(days[0])} – ${dayMonth(days[6])}`.replace(/ (\S+) – (\d+) \1$/, ' – $2 $1');

  return (
    <>
      {weekQ.staleAt && <StaleBanner at={weekQ.staleAt} error={weekQ.error} busy={weekQ.loading} onRetry={weekQ.refresh} />}
      <div className="week-nav">
        <button className="icon-btn press" aria-label={tr('Попередній тиждень', 'Previous week')} onClick={() => go(addDays(monday, -7))}><ChevronLeft strokeWidth={1.75} /></button>
        <span className="week-nav__label num">{range}</span>
        <button className="icon-btn press" aria-label={tr('Наступний тиждень', 'Next week')} onClick={() => go(addDays(monday, 7))}><ChevronRight strokeWidth={1.75} /></button>
      </div>

      <div className="daystrip" role="group" aria-label={tr('День тижня', 'Day of the week')}>
        {days.map((k) => (
          <button key={k} className={`day press${k === today ? ' day--today' : ''}`} aria-pressed={k === day} onClick={() => go(k)}
            aria-label={dayTitle(k)}>
            {weekdayShort(k)}
            <b className="num">{dayNum(k)}</b>
            <i className={byDay.has(k) ? '' : 'none'} />
          </button>
        ))}
      </div>

      <div className="compare-head">
        <span>{tr('Порівняти з', 'Compare with')}</span>
        {pals.friends.length > 0 && (
          <button className="link-btn" onClick={() => { haptic.select(); setEditing((v) => !v); }}>{editing ? tr('Готово', 'Done') : tr('Змінити', 'Edit')}</button>
        )}
      </div>
      <div className="pals">
        {pals.friends.map((f) => {
          const on = pals.active.has(f.userId);
          return (
            <div className="pal" key={f.userId}>
              <button className="pal__btn press" aria-pressed={on} aria-label={f.name} disabled={editing}
                onClick={() => { haptic.select(); pals.toggle(f.userId); }}>
                <Avatar name={f.name} url={f.avatarUrl} />
              </button>
              <span className="pal__name">{f.name.split(' ')[0]}</span>
              {editing && (
                <button className="pal__remove" aria-label={`${tr('Прибрати', 'Remove')} ${f.name}`} onClick={() => { haptic.tap(); pals.remove(f.userId); }}>
                  <Minus strokeWidth={3} />
                </button>
              )}
            </div>
          );
        })}
        {pals.friends.length < MAX_FRIENDS && !editing && (
          <div className="pal">
            <button className="pal__btn pal__add press" aria-label={tr('Додати друга', 'Add a friend')} onClick={() => setAdding(true)}><Plus strokeWidth={2} /></button>
            <span className="pal__name">{tr('Додати', 'Add')}</span>
          </div>
        )}
        {/* First time: say what comparing gives, next to the only button there is */}
        {pals.friends.length === 0 && (
          <button className="pals__hint" onClick={() => setAdding(true)}>{tr('Знайди одногрупників — покажемо спільні пари', 'Find classmates, we\'ll show the classes you share')}</button>
        )}
      </div>

      {pals.active.size > 0 ? (
        <div className="seg" role="group" aria-label={tr('Які пари показати', 'Which classes to show')} style={{ margin: '14px 0 0' }}>
          {([['mine', tr('Лише мої', 'Only mine')], ['together', tr('Разом', 'Together')], ['shared', tr('Спільні', 'Shared')]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} aria-pressed={pals.mode === m} onClick={() => { if (m !== pals.mode) { haptic.select(); pals.setMode(m); } }}>{label}</button>
          ))}
        </div>
      ) : pals.friends.length > 0 && (
        // Everyone switched off: keep the row's place and say how to turn someone on
        <p className="seg-hint">{tr('Торкнись аватара, щоб порівняти', 'Tap someone to compare')}</p>
      )}

      <div className="day-head">
        <span>{dayTitle(day)}</span>
        {day !== today && <button className="link-btn" onClick={() => go(today)}>{tr('Сьогодні', 'Today')}</button>}
      </div>

      {pals.notice && <p className="note" style={{ paddingTop: 0, paddingBottom: 8 }} onClick={pals.clearNotice}>{pals.notice}</p>}

      <div {...bind()} style={{ touchAction: 'pan-y' }}>
        <div key={day} className={dir ? `slide-${dir}` : undefined}>
          {!week && weekQ.error ? (
            <ErrorState error={weekQ.error} onRetry={weekQ.refresh} />
          ) : !week ? (
            <SkeletonRows rows={3} />
          ) : rows.length === 0 ? (
            <div className="group">
              <EmptyState icon={Coffee} title={pals.mode === 'shared' ? tr('Цього дня спільних пар немає', 'No shared classes this day')
                : day < today ? tr('Цього дня пар не було', 'No classes that day') : tr('Цього дня пар немає', 'No classes this day')} />
            </div>
          ) : (
            <div className="group">
              {rows.map((r) => <ClassRow key={`${r.theirs ? 't' : 'm'}${r.e.id}`} row={r} onOpen={() => { haptic.tap(); setOpen(r.e); }} />)}
            </div>
          )}
        </div>
      </div>
      {pals.mode === 'shared' && <p className="note num" style={{ padding: '10px 0 0' }}>{tr('Спільних пар цього тижня', 'Shared classes this week')}: {sharedThisWeek}</p>}

      {open && <ClassSheet e={open} friends={pals.withMe(open)} onClose={() => setOpen(null)} />}
      {adding && <AddFriendSheet taken={pals.friends} onPick={(s) => { haptic.success(); pals.add(s); setAdding(false); }} onRemove={pals.remove} onClose={() => setAdding(false)} />}
    </>
  );
}

function ClassRow({ row: { e, theirs, friends }, onOpen }: { row: Row; onOpen: () => void }) {
  const t = now().getTime();
  const start = new Date(e.startAt).getTime();
  const end = new Date(e.endAt).getTime();
  const status = theirs ? 'theirs' : t >= end ? 'past' : t >= start ? 'now' : 'next';
  const progress = status === 'now' ? ((t - start) / (end - start)) * 100 : 0;
  const names = friends.map((f) => f.name.split(' ')[0]).join(', ');

  return (
    <button className={`class press class--${status}`} onClick={onOpen}>
      <div className="class__time">{hm(e.startAt)}<span>{hm(e.endAt)}</span></div>
      <div style={{ minWidth: 0 }}>
        <div className="class__code">{e.courseCode}{e.section && <small>[{e.section}]</small>}</div>
        <div className="class__place">
          {theirs
            ? `${friends.length > 1 ? tr('Пара друзів', 'Friends\' class') : tr('Пара друга', 'Friend\'s class')} · ${names}`
            : status === 'now' ? `${shortPlace(e.location) ?? ''} · ${tr(`ще ${spanText(end - t)}`, `${spanText(end - t)} left`)}` : shortPlace(e.location)}
        </div>
        {status === 'now' && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      </div>
      {friends.length > 0 && (
        <span className="class__friends" aria-label={`${tr('Разом з', 'With')}: ${friends.map((f) => f.name).join(', ')}`}>
          {friends.slice(0, 3).map((f) => <Avatar key={f.userId} name={f.name} url={f.avatarUrl} size={24} />)}
        </span>
      )}
    </button>
  );
}

function ClassSheet({ e, friends, onClose }: { e: ClassEvent; friends: Friend[]; onClose: () => void }) {
  const key = dayKey(new Date(e.startAt));
  const kind = classKind(e.section);
  const [asking, setAsking] = useState(false);
  const code = `${e.courseCode}${e.section ? ` [${e.section}]` : ''}`;
  if (asking) {
    return (
      <Sheet onClose={() => setAsking(false)} label="Copilot">
        <AskPanel about={code} onBack={() => setAsking(false)}
          context={`${code} ${e.title}, ${dayTitle(key)} ${hm(e.startAt)}–${hm(e.endAt)}, ${shortPlace(e.location) ?? ''}`}
          starters={[tr('Що в мене після цієї пари?', 'What do I have after this class?'), tr('Які дедлайни з цього курсу найближчі?', "What's due soon for this course?")]} />
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose} label={e.courseCode}>
      <div className="sheet__title">{e.courseCode}{e.section ? ` [${e.section}]` : ''}</div>
      <div className="sheet__sub">{e.title}</div>
      <div className="caption">{tr('Коли і де', 'When and where')}</div>
      <div className="group">
        <div className="row"><div className="row__main"><div className="row__title num">{hm(e.startAt)}–{hm(e.endAt)}</div><div className="row__meta">{key === todayKey() ? tr('сьогодні', 'today') : dayTitle(key)}{kind ? ` · ${kind}` : ''}</div></div></div>
        <div className="row"><div className="row__main"><div className="row__title">{shortPlace(e.location) ?? tr('Аудиторію не вказано', 'Room not given')}</div></div></div>
      </div>
      {friends.length > 0 && (
        <>
          <div className="caption">{tr('Там же', 'Also there')}</div>
          <div className="group">
            {friends.map((f) => (
              <div className="row" key={f.userId}><Avatar name={f.name} url={f.avatarUrl} size={28} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div></div>
            ))}
          </div>
        </>
      )}
      <button className="btn-plain press" style={{ marginTop: 16 }} onClick={() => setAsking(true)}>{tr('Запитати Copilot', 'Ask Copilot')}</button>
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
    <Sheet onClose={onClose} label={tr('Порівняти з друзями', 'Compare with friends')}>
      <div className="sheet__title">{tr('Порівняти з друзями', 'Compare with friends')}</div>
      <div className="sheet__sub">{tr(`Покажемо спільні пари. До ${MAX_FRIENDS} людей.`, `We'll show the classes you share. Up to ${MAX_FRIENDS} people.`)}</div>
      <div className="field-wrap" style={{ marginTop: 16 }}>
        <Search strokeWidth={1.75} />
        <input className="field" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Прізвище', 'Surname')} enterKeyHint="search" />
      </div>

      {found && found.length > 0 && (
        <div className="group" style={{ marginTop: 12 }}>
          {found.map((s) => (
            <button key={s.userId} className="row press" disabled={takenIds.has(s.userId)} onClick={() => onPick(s)}>
              <Avatar name={s.name} url={s.avatarUrl} size={32} />
              <div className="row__main">
                <div className="row__title" style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="row__meta">{[s.cohort && `${tr('вступ', 'class of')} ${s.cohort}`, s.username && `@${s.username}`].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="row__side">{takenIds.has(s.userId) ? tr('Уже додано', 'Added') : ''}</span>
            </button>
          ))}
        </div>
      )}
      {found && found.length === 0 && (
        <EmptyState icon={Users} title={tr('Нікого не знайдено', 'No one found')} text={tr('Видно лише тих, хто підключив пошту в KSE Hub і не приховав розклад.', 'Only students who connected their mail to KSE Hub and keep their schedule visible show up.')} />
      )}

      {!found && taken.length > 0 && (
        <>
          <div className="caption">{tr('Уже порівнюєш', 'Comparing with')}</div>
          <div className="group">
            {taken.map((f) => (
              <div className="row" key={f.userId}>
                <Avatar name={f.name} url={f.avatarUrl} size={32} />
                <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div>
                <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => { haptic.tap(); onRemove(f.userId); }}>{tr('Прибрати', 'Remove')}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
