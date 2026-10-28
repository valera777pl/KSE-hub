import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, DoorClosed, Headphones, Video, X } from 'lucide-react';
import { api, errorText, track } from '../../../api/client';
import type { BookingWithRoom, QuotaInfo, Room } from '../../../types';
import { addDays, dayKey, dayTitle, hm, now, todayKey, weekdayShort, dayNum } from '../../../lib/time';
import { useUi } from '../../../stores/uiStore';
import { haptic } from '../../../lib/telegram';
import { ScreenHead } from '../../ui/ScreenHead';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { useCached } from '../../../lib/cache';
import { tr } from '../../../lib/i18n';

type When = 'now' | 'soon' | 'pick';
/** From /rooms/available: free at the asked time, and until when it stays free that day (null = all day) */
type RoomFree = Room & { freeFrom?: string | null; freeUntil?: string | null };

const MIN = 60_000;
const STEP = 15;
const MAX_MIN = 180;
const DEFAULT_MIN = 60;

/** "Skype Room 1 (2nd floor)" → "Skype Room 1" */
const roomName = (r: Room) => r.name.replace(/\s*\(.*\)\s*$/, '');
const roomMeta = (r: Room) => [r.floor && tr(`${r.floor} поверх`, `floor ${r.floor}`), r.capacity > 1 ? tr(`до ${r.capacity} людей`, `up to ${r.capacity} people`) : tr('на одного', 'for one')].filter(Boolean).join(' · ');
// The type sits in a small tile on --inset, so a long list has something to hold on to on the left
const RoomIcon = ({ r }: { r: Room }) => (
  <span className="room__tile" aria-hidden="true">
    {r.type === 'silent_box' ? <Headphones className="room__icon" strokeWidth={1.7} /> : <Video className="room__icon" strokeWidth={1.7} />}
  </span>
);
const untilLabel = (r: RoomFree) => (r.freeUntil ? `${tr('до', 'until')} ${hm(r.freeUntil)}` : tr('весь день', 'all day'));

/** A free room: what it is, how long it stays free, tap to book */
function RoomRow({ r, disabled, onPick }: { r: RoomFree; disabled: boolean; onPick: (r: RoomFree) => void }) {
  return (
    <button className="row row--roomy room press" disabled={disabled} onClick={() => onPick(r)}>
      <RoomIcon r={r} />
      <div className="row__main">
        <div className="row__title">{roomName(r)}</div>
        <div className="row__meta">{roomMeta(r)}</div>
      </div>
      <span className="row__side num">{untilLabel(r)}</span>
      <ChevronRight className="chev" strokeWidth={2.4} />
    </button>
  );
}

/** "15 хв", "1 год", "1 год 45 хв" */
const durLabel = (m: number) => {
  const [h, mm] = [tr('год', 'h'), tr('хв', 'min')];
  return m < 60 ? `${m} ${mm}` : m % 60 ? `${Math.floor(m / 60)} ${h} ${m % 60} ${mm}` : `${m / 60} ${h}`;
};

const roundUp = (d: Date, step: number) => new Date(Math.ceil(d.getTime() / (step * MIN)) * step * MIN);

/** Кімнати: when → which room → how long → booked. */
export function RoomsPage() {
  // From a window in the schedule grid: open at that time, once
  const [asked] = useState(() => { const at = useUi.getState().roomsAt; return at ? new Date(at) : null; });
  useEffect(() => { if (asked) useUi.setState({ roomsAt: null }); }, [asked]);
  const [when, setWhen] = useState<When>(asked && asked.getTime() > now().getTime() + 60_000 ? 'pick' : 'now');
  const [picked, setPicked] = useState<Date | null>(asked && asked.getTime() > now().getTime() + 60_000 ? roundUp(asked, 5) : null);
  const [reload, setReload] = useState(0);
  const [booking, setBooking] = useState<{ room: RoomFree; start: Date } | null>(null);
  const [picking, setPicking] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);

  // Start of the slot the student is looking at
  const start = useMemo(() => {
    if (when === 'pick' && picked) return picked;
    const n = now();
    // Bookings start on a 5-minute mark: "now" rounds down (14:12 → 14:10), later rounds up
    return when === 'soon' ? roundUp(new Date(n.getTime() + 30 * MIN), 5) : new Date(Math.floor(n.getTime() / (5 * MIN)) * 5 * MIN);
  }, [when, picked, reload]);

  // "Зараз" and "Через 30 хв" keep one cached copy each; a picked time is cached by its slot
  const q = useCached(`rooms:${when === 'pick' ? start.toISOString() : when}`, async () => {
    const params = new URLSearchParams({ start: start.toISOString(), end: new Date(start.getTime() + STEP * MIN).toISOString() });
    const [r, b, quota] = await Promise.all([
      api.get<{ rooms: RoomFree[] }>(`/rooms/available?${params}`),
      api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings'),
      api.get<QuotaInfo>('/rooms/quota'),
    ]);
    return { rooms: r.rooms, mine: b.bookings, quota };
  }, { version: start.getTime() });
  const rooms = q.data?.rooms ?? null;
  const mine = q.data?.mine ?? [];
  const quota = q.data?.quota ?? null;

  useEffect(() => { track('rooms.open'); }, []);

  // A room I already hold isn't something to pick again; it's under "Мої броні"
  const heldNow = new Set(mine.filter(({ booking: b }) => new Date(b.startTime) <= start && new Date(b.endTime) > start).map(({ room }) => room.id));
  // Free ones only, the longest-free first: busy rooms are nothing to choose from
  const free = (rooms ?? []).filter((r) => r.available && !heldNow.has(r.id))
    .sort((a, b) => (b.freeUntil ?? '9').localeCompare(a.freeUntil ?? '9')
      // Equally free: rooms for a group before single boxes, then by name
      || Number(a.type === 'silent_box') - Number(b.type === 'silent_box') || roomName(a).localeCompare(roomName(b)));
  const pick = (r: RoomFree) => { haptic.tap(); track('room.select'); setBooking({ room: r, start }); };
  const leftMin = Math.round((quota?.remaining ?? 3) * 60);
  const outOfQuota = quota !== null && leftMin < 30;

  const cancel = async (id: number) => {
    haptic.tap();
    try {
      await api.delete(`/rooms/bookings/${id}`);
      haptic.success();
      setReload((n) => n + 1);
    } catch { haptic.error(); }
  };

  const pickWhen = (w: When) => {
    if (w === 'pick') { setPicking(true); return; }
    if (w !== when) { haptic.select(); setWhen(w); }
  };

  const whenLabel = picked && when === 'pick'
    ? `${dayKey(picked) === todayKey() ? '' : `${weekdayShort(dayKey(picked))} `}${hm(picked)}`
    : tr('Інший час', 'Other time');
  const freeTitle = when === 'now' && q.staleAt ? `${tr('Вільні о', 'Free at')} ${hm(new Date(q.staleAt))}`
    : when === 'now' ? tr('Вільні зараз', 'Free now')
      : `${tr('Вільні', 'Free')} ${dayKey(start) === todayKey() ? tr('о', 'at') : `${dayTitle(dayKey(start))}, ${tr('о', 'at')}`} ${hm(start)}`;
  const quotaNote = !quota ? undefined : outOfQuota
    ? tr('Квоту на сьогодні використано', 'Today\'s quota is used up')
    : tr(`Сьогодні можна ще ${durLabel(Math.floor(leftMin / 15) * 15)}`, `${durLabel(Math.floor(leftMin / 15) * 15)} left today`);

  return (
    <div className="screen">
      <ScreenHead title={tr('Кімнати', 'Rooms')} note={quotaNote} />
      {q.staleAt && <StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} />}

      <div className="seg" role="group" aria-label={tr('Коли', 'When')}>
        <button aria-pressed={when === 'now'} onClick={() => pickWhen('now')}>{tr('Зараз', 'Now')}</button>
        <button aria-pressed={when === 'soon'} onClick={() => pickWhen('soon')}>{tr('Через 30 хв', 'In 30 min')}</button>
        <button aria-pressed={when === 'pick'} onClick={() => pickWhen('pick')} className="num">{whenLabel}</button>
      </div>

      {!rooms && q.error ? (
        <ErrorState error={q.error} onRetry={q.refresh} />
      ) : !rooms ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <div className="section-head"><h2 className="num">{freeTitle}</h2>{free.length > 0 && <span className="num">{free.length}</span>}</div>
          {free.length === 0 ? (
            <div className="group">
              <EmptyState icon={DoorClosed} title={tr(`Усі кімнати зайняті${when === 'now' ? '' : ` о ${hm(start)}`}`, `All rooms are taken${when === 'now' ? '' : ` at ${hm(start)}`}`)}
                action={when === 'now' ? { label: tr('Подивитись через 30 хв', 'Check in 30 min'), onClick: () => pickWhen('soon') } : undefined} />
            </div>
          ) : (
            // Two groups instead of one long list: rooms for a group, then single boxes
            ([['skype_room', 'Skype Rooms'], ['silent_box', 'Silent Box']] as const).map(([type, title], i) => {
              const list = free.filter((r) => (r.type === 'silent_box') === (type === 'silent_box'));
              return list.length > 0 && (
                <section key={type}>
                  <h3 className={`group-title${i === 0 ? ' group-title--first' : ''}`}>{title}</h3>
                  <div className="group">{list.map((r) => <RoomRow key={r.id} r={r} disabled={outOfQuota} onPick={pick} />)}</div>
                </section>
              );
            })
          )}
          {outOfQuota && <p className="note">{tr('Завтра знову 3 год.', 'Tomorrow you get 3 h again.')}</p>}
        </>
      )}

      <div className="section-head"><h2>{tr('Мої броні', 'My bookings')}</h2></div>
      <div className="group">
        {mine.length === 0 ? (
          <p className="group-note">{tr('Поки немає. Обери вільну кімнату вище.', 'None yet. Pick a free room above.')}</p>
        ) : mine.map(({ booking: b, room }) => {
          const live = new Date(b.startTime).getTime() <= now().getTime();
          return (
            <div key={b.id} className={`row row--roomy room${fresh === b.id ? ' fresh' : ''}`}>
              <RoomIcon r={room} />
              <div className="row__main">
                <div className="row__title">{roomName(room)}</div>
                <div className="row__meta num">
                  {live ? `${tr('зараз, до', 'now, until')} ${hm(b.endTime)}` : `${dayKey(new Date(b.startTime)) === todayKey() ? tr('сьогодні', 'today') : dayTitle(dayKey(new Date(b.startTime)))}, ${hm(b.startTime)}–${hm(b.endTime)}`}
                </div>
              </div>
              <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => cancel(b.id)}>{live ? tr('Звільнити', 'Release') : tr('Скасувати', 'Cancel')}</button>
            </div>
          );
        })}
      </div>

      {booking && (
        <BookSheet room={booking.room} start={booking.start} leftMin={leftMin}
          startLabel={when === 'now' ? `${tr('Зараз', 'Now')}, ${hm(booking.start)}` : `${dayKey(booking.start) === todayKey() ? '' : `${weekdayShort(dayKey(booking.start))} `}${hm(booking.start)}`}
          onClose={() => setBooking(null)}
          onBooked={(id) => { setBooking(null); setFresh(id); setReload((n) => n + 1); }} />
      )}
      {picking && (
        <TimeSheet value={picked} onClose={() => setPicking(false)}
          onPick={(d) => { haptic.select(); setPicked(d); setWhen('pick'); setPicking(false); }} />
      )}
    </div>
  );
}

const DURATIONS = [30, 60, 90, 120];
/** "30 хв", "1 год", "1,5 год", "2 год" */
const durShort = (m: number) => (m < 60 ? `${m} ${tr('хв', 'min')}` : `${String(m / 60).replace('.', tr(',', '.'))} ${tr('год', 'h')}`);

/** Book a room: when it starts, how long (four lengths), one button that turns green when it's done. */
function BookSheet({ room, start, startLabel, leftMin, onClose, onBooked }: {
  room: RoomFree; start: Date; startLabel: string; leftMin: number; onClose: () => void; onBooked: (bookingId: number) => void;
}) {
  // Longest it can be: the daily quota, and the next booking of this room
  const cap = Math.min(MAX_MIN, leftMin, room.freeUntil ? Math.floor((Date.parse(room.freeUntil) - start.getTime()) / MIN) : MAX_MIN);
  const allowed = DURATIONS.filter((m) => m <= cap);
  const [minutes, setMinutes] = useState(allowed.includes(DEFAULT_MIN) ? DEFAULT_MIN : allowed[allowed.length - 1] ?? 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const end = new Date(start.getTime() + minutes * MIN);
  const isToday = dayKey(start) === todayKey();
  const after = leftMin - minutes;

  const book = async () => {
    if (saving || done || !allowed.length) return;
    haptic.tap();
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{ booking: { id: number } }>('/rooms/book', { roomId: room.id, startTime: start.toISOString(), endTime: end.toISOString() });
      haptic.success();
      track('booking.confirm');
      setDone(true);
      setTimeout(() => onBooked(r.booking.id), 1200);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
      setShakeKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet onClose={onClose} label={`${tr('Бронювання', 'Booking')} ${roomName(room)}`}>
      <div className="book">
        <div className="book__head">
          <div>
            <div className="sheet__title">{roomName(room)}</div>
            <div className="book__meta">{roomMeta(room)} · {room.freeUntil ? `${tr('вільна до', 'free until')} ${hm(room.freeUntil)}` : tr('вільна до кінця дня', 'free for the rest of the day')}</div>
          </div>
          <button className="close-btn press" aria-label={tr('Закрити', 'Close')} onClick={onClose}><X strokeWidth={2.6} /></button>
        </div>

        <div key={shakeKey} className={shakeKey ? 'shake' : undefined}>
          <div className="book__range num">{hm(start)} – {hm(end)}</div>
          <div className="book__when">{isToday ? tr('сьогодні', 'today') : dayTitle(dayKey(start))} · {durShort(minutes)}</div>
        </div>

        <div className="book__card">
          <div className="book__row"><span>{tr('Початок', 'Starts')}</span><span className="num">{startLabel}</span></div>
          <div className="book__dur">
            <span>{tr('Тривалість', 'Length')}</span>
            <div className="seg seg--value" role="group" aria-label={tr('Тривалість броні', 'Booking length')}>
              {DURATIONS.map((m) => (
                <button key={m} aria-pressed={m === minutes} disabled={done || !allowed.includes(m)}
                  onClick={() => { if (m !== minutes) { haptic.select(); setMinutes(m); } }}>{durShort(m)}</button>
              ))}
            </div>
          </div>
        </div>

        <p className="book__note num" role="status">
          {error ? <span style={{ color: 'var(--danger)' }}>{error}</span>
            : done ? tr('Нагадаємо за 10 хв до кінця. Підтвердження — у чаті з ботом.', "We'll remind you 10 min before the end. The confirmation is in the bot chat.")
              : !allowed.length ? tr('Зараз забронювати не вийде: квота на сьогодні або наступна бронь не лишають і 30 хв.', 'Not bookable now: today\'s quota or the next booking leaves less than 30 min.')
                : isToday ? (after >= 15 ? tr(`Після броні сьогодні залишиться ${durLabel(after)}`, `${durLabel(after)} left today after this`) : tr('Це вся квота на сьогодні', "That's all of today's quota"))
                  : tr('До 3 год на день', 'Up to 3 h a day')}
        </p>

        <button className={`book__btn press${done ? ' book__btn--done' : ''}${allowed.length ? '' : ' book__btn--off'}`} disabled={saving || !allowed.length} onClick={book}>
          {done && <Check strokeWidth={2.6} />}
          <span className="num">{done ? `${tr('Заброньовано до', 'Booked until')} ${hm(end)}` : saving ? tr('Бронюю…', 'Booking…') : `${tr('Забронювати до', 'Book until')} ${hm(end)}`}</span>
        </button>
      </div>
    </Sheet>
  );
}

/** Another day or hour: a week of days and half-hour slots from 08:00 to 21:30. */
function TimeSheet({ value, onPick, onClose }: { value: Date | null; onPick: (d: Date) => void; onClose: () => void }) {
  const today = todayKey();
  const [day, setDay] = useState(value ? dayKey(value) : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const t = now().getTime();

  // Kyiv wall time for this day; the slot list is the same every day
  const slotAt = (hhmm: string) => new Date(`${day}T${hhmm}:00${kyivOffset(day)}`);
  const slots = Array.from({ length: 28 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

  return (
    <Sheet onClose={onClose} label={tr('Обрати час', 'Pick a time')}>
      <div className="sheet__title">{tr('Коли потрібна кімната?', 'When do you need a room?')}</div>
      <div className="daystrip" style={{ marginTop: 16 }} role="group" aria-label={tr('День', 'Day')}>
        {days.map((k) => (
          <button key={k} className={`day press${k === today ? ' day--today' : ''}`} aria-pressed={k === day} onClick={() => { haptic.select(); setDay(k); }}>
            {weekdayShort(k)}<b className="num">{dayNum(k)}</b><i className="none" />
          </button>
        ))}
      </div>
      {day === today && slots.every((s) => slotAt(s).getTime() < t - 15 * MIN) && <p className="note">{tr('На сьогодні вільних годин уже немає — обери інший день.', 'No more slots today. Pick another day.')}</p>}
      <div className="slots" role="group" aria-label={tr('Час', 'Time')}>
        {slots.filter((s) => slotAt(s).getTime() >= t - 15 * MIN).map((s) => {
          const d = slotAt(s);
          return (
            <button key={s} className="press" aria-pressed={!!value && value.getTime() === d.getTime()} onClick={() => onPick(d)}>{s}</button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** "+02:00" or "+03:00" for Kyiv on that date (summer time switches in March and October). */
function kyivOffset(day: string) {
  const probe = new Date(`${day}T12:00:00Z`);
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(probe);
  const h = Number(local) - 12;
  return `+${String(h).padStart(2, '0')}:00`;
}
