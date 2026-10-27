import { useEffect, useMemo, useState } from 'react';
import { Check, DoorClosed, Headphones, Video, WifiOff } from 'lucide-react';
import { api, track } from '../../../api/client';
import type { BookingWithRoom, QuotaInfo, Room } from '../../../types';
import { addDays, dayKey, dayTitle, hm, now, todayKey, weekdayShort, dayNum } from '../../../lib/time';
import { haptic, useMainButton } from '../../../lib/telegram';
import { ScreenHead } from '../../ui/ScreenHead';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, SkeletonRows } from '../../ui/States';
import { Wheel } from '../../ui/Wheel';
import { tr } from '../../../lib/i18n';

type When = 'now' | 'soon' | 'pick';
type Kind = 'all' | 'skype_room' | 'silent_box';
type RoomFree = Room & { freeFrom?: string | null };

const MIN = 60_000;
const STEP = 15;
const MAX_MIN = 180;
const DEFAULT_MIN = 60;

/** "Skype Room 1 (2nd floor)" → "Skype Room 1" */
const roomName = (r: Room) => r.name.replace(/\s*\(.*\)\s*$/, '');
const roomMeta = (r: Room) => [r.floor && tr(`${r.floor} поверх`, `floor ${r.floor}`), r.capacity > 1 ? tr(`до ${r.capacity} людей`, `up to ${r.capacity} people`) : tr('на одного', 'for one')].filter(Boolean).join(', ');
const RoomIcon = ({ r }: { r: Room }) => (r.type === 'silent_box' ? <Headphones className="room__icon" strokeWidth={1.75} /> : <Video className="room__icon" strokeWidth={1.75} />);

function RoomRow({ r, from, disabled, onPick }: { r: RoomFree; from: Date | null; disabled: boolean; onPick: (r: RoomFree, from: Date) => void }) {
  return (
    <button className={`row room press${r.available ? '' : ' room--busy'}`} disabled={disabled || !from} onClick={() => from && onPick(r, from)}>
      <RoomIcon r={r} />
      <div className="row__main">
        <div className="row__title">{roomName(r)}</div>
        <div className="row__meta">{roomMeta(r)}</div>
      </div>
      {!r.available && <span className="room__free">{from ? `${tr('вільна з', 'free from')} ${hm(from)}` : tr('до кінця дня', 'until end of day')}</span>}
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
  const [when, setWhen] = useState<When>('now');
  const [picked, setPicked] = useState<Date | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [rooms, setRooms] = useState<RoomFree[] | null>(null);
  const [mine, setMine] = useState<BookingWithRoom[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [booking, setBooking] = useState<{ room: RoomFree; start: Date } | null>(null);
  const [picking, setPicking] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);

  // Start of the slot the student is looking at
  const start = useMemo(() => {
    if (when === 'pick' && picked) return picked;
    const n = now();
    return when === 'soon' ? roundUp(new Date(n.getTime() + 30 * MIN), 5) : new Date(Math.floor(n.getTime() / MIN) * MIN);
  }, [when, picked, reload]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setRooms(null);
    const params = new URLSearchParams({ start: start.toISOString(), end: new Date(start.getTime() + STEP * MIN).toISOString() });
    Promise.all([
      api.get<{ rooms: RoomFree[] }>(`/rooms/available?${params}`),
      api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings'),
      api.get<QuotaInfo>('/rooms/quota'),
    ]).then(([r, b, q]) => {
      if (cancelled) return;
      setRooms(r.rooms);
      setMine(b.bookings);
      setQuota(q);
    }).catch(() => !cancelled && setError(true));
    return () => { cancelled = true; };
  }, [start.getTime(), reload]);

  useEffect(() => { track('rooms.open'); }, []);

  // A room I already hold isn't something to pick again; it lives in tr('Твоя бронь', 'Your booking')
  const heldNow = new Set(mine.filter(({ booking: b }) => new Date(b.startTime) <= start && new Date(b.endTime) > start).map(({ room }) => room.id));
  const shown = (rooms ?? []).filter((r) => (kind === 'all' || r.type === kind) && !heldNow.has(r.id));
  const free = shown.filter((r) => r.available);
  const busy = shown.filter((r) => !r.available).sort((a, b) => (a.freeFrom ?? '9').localeCompare(b.freeFrom ?? '9'));
  const pick = (r: RoomFree, from: Date) => { haptic.tap(); track('room.select'); setBooking({ room: r, start: from }); };
  const leftMin = Math.round((quota?.remaining ?? 3) * 60);
  const outOfQuota = quota !== null && leftMin < STEP;

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
    : tr('Обрати час', 'Pick a time');

  return (
    <div className="screen">
      <ScreenHead title={tr('Кімнати', 'Rooms')} />

      {mine.length > 0 && (
        <>
          <div className="caption" style={{ marginTop: 0 }}>{tr('Твоя бронь', 'Your booking')}</div>
          <div className="group" style={{ marginBottom: 8 }}>
            {mine.map(({ booking: b, room }) => {
              const live = new Date(b.startTime).getTime() <= now().getTime();
              return (
                <div key={b.id} className={`row room${fresh === b.id ? ' fresh' : ''}`}>
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
        </>
      )}

      <div className="seg" role="group" aria-label={tr('Коли', 'When')}>
        <button aria-pressed={when === 'now'} onClick={() => pickWhen('now')}>{tr('Зараз', 'Now')}</button>
        <button aria-pressed={when === 'soon'} onClick={() => pickWhen('soon')}>{tr('Через 30 хв', 'In 30 min')}</button>
        <button aria-pressed={when === 'pick'} onClick={() => pickWhen('pick')} className="num">{whenLabel}</button>
      </div>

      <div className="pills" role="group" aria-label={tr('Тип кімнати', 'Room type')}>
        {([['all', tr('Усі', 'All')], ['skype_room', 'Skype'], ['silent_box', 'Silent Box']] as [Kind, string][]).map(([k, l]) => (
          <button key={k} className="press" aria-pressed={kind === k} onClick={() => { if (k !== kind) { haptic.select(); setKind(k); } }}>{l}</button>
        ))}
      </div>

      {error ? (
        <div className="group" style={{ marginTop: 16 }}><EmptyState icon={WifiOff} title={tr('Не вдалося завантажити кімнати', 'Couldn\'t load rooms')} text={tr('Перевір інтернет.', 'Check your connection.')} action={{ label: tr('Спробувати ще раз', 'Try again'), onClick: () => setReload((n) => n + 1) }} /></div>
      ) : !rooms ? (
        <div style={{ marginTop: 16 }}><SkeletonRows rows={4} /></div>
      ) : (
        <>
          <div className="caption num">{when === 'now' ? tr('Вільні зараз', 'Free now') : `${tr('Вільні', 'Free')} ${dayKey(start) === todayKey() ? tr('о', 'at') : `${dayTitle(dayKey(start))}, ${tr('о', 'at')}`} ${hm(start)}`}</div>
          {free.length === 0 ? (
            <div className="group"><EmptyState icon={DoorClosed} title={tr('Вільних кімнат немає', 'No free rooms')} text={busy.length ? tr('Нижче — коли звільняться.', 'Below: when they free up.') : undefined} /></div>
          ) : (
            <div className="group">{free.map((r) => <RoomRow key={r.id} r={r} from={start} disabled={outOfQuota} onPick={pick} />)}</div>
          )}
          {busy.length > 0 && (
            <>
              <div className="caption">{tr('Зайняті', 'Taken')}</div>
              <div className="group">{busy.map((r) => <RoomRow key={r.id} r={r} from={r.freeFrom && dayKey(new Date(r.freeFrom)) === dayKey(start) ? new Date(r.freeFrom) : null} disabled={outOfQuota} onPick={pick} />)}</div>
            </>
          )}
        </>
      )}

      {quota && (
        <p className="note num">
          {outOfQuota ? tr('Квоту на сьогодні використано. Завтра знову 3 год.', 'Today\'s quota is used up. Tomorrow you get 3 h again.') : tr(`Сьогодні можна ще ${durLabel(Math.floor(leftMin / STEP) * STEP)} із ${quota.max} год.`, `You can book ${durLabel(Math.floor(leftMin / STEP) * STEP)} more today, of ${quota.max} h.`)}
        </p>
      )}

      {booking && (
        <BookSheet room={booking.room} start={booking.start} leftMin={leftMin}
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

/** Pick a room's length on the wheel; the range above it is what will be booked. */
function BookSheet({ room, start, leftMin, onClose, onBooked }: {
  room: Room; start: Date; leftMin: number; onClose: () => void; onBooked: (bookingId: number) => void;
}) {
  const [nextTaken, setNextTaken] = useState<Date | null>(null);
  const [minutes, setMinutes] = useState(DEFAULT_MIN);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // The room's next booking caps how long we can take it
  useEffect(() => {
    api.get<{ bookings: { startTime: string; endTime: string }[] }>(`/rooms/${room.id}/schedule?date=${start.toISOString()}`)
      .then((r) => {
        const next = r.bookings.map((b) => new Date(b.startTime)).filter((d) => d.getTime() >= start.getTime() + MIN).sort((a, b) => a.getTime() - b.getTime())[0];
        setNextTaken(next ?? null);
      }).catch(() => setNextTaken(null));
  }, [room.id, start.getTime()]);

  const values = useMemo(() => {
    const cap = Math.min(MAX_MIN, leftMin, nextTaken ? Math.floor((nextTaken.getTime() - start.getTime()) / MIN) : MAX_MIN);
    const list: number[] = [];
    for (let m = STEP; m <= cap; m += STEP) list.push(m);
    return list.length ? list : [STEP];
  }, [leftMin, nextTaken, start.getTime()]);

  // Keep the chosen length inside what's allowed once the limits arrive
  useEffect(() => {
    if (!values.includes(minutes)) setMinutes(values.includes(DEFAULT_MIN) ? DEFAULT_MIN : values[values.length - 1]);
  }, [values]);

  const end = new Date(start.getTime() + minutes * MIN);

  const book = async () => {
    if (saving || done) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{ booking: { id: number } }>('/rooms/book', { roomId: room.id, startTime: start.toISOString(), endTime: end.toISOString() });
      haptic.success();
      setDone(true);
      setTimeout(() => onBooked(r.booking.id), 900);
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      setShakeKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  useMainButton({ text: `${tr('Забронювати до', 'Book until')} ${hm(end)}`, onClick: book, loading: saving, visible: !done });

  if (done) {
    return (
      <Sheet onClose={onClose} label={tr('Заброньовано', 'Booked')}>
        <div className="done-mark">
          <Check strokeWidth={2.25} />
          <b>{tr('Заброньовано', 'Booked')}</b>
          <span className="num">{roomName(room)}, {hm(start)}–{hm(end)}</span>
          <span>{tr('Підтвердження з кнопкою «Звільнити» — в чаті з ботом.', 'A confirmation with a Release button is in the bot chat.')}</span>
        </div>
      </Sheet>
    );
  }

  const isToday = dayKey(start) === todayKey();

  return (
    <Sheet onClose={onClose} label={roomName(room)}>
      <div className="sheet__title">{roomName(room)}</div>
      <div className="sheet__sub">{roomMeta(room)}</div>

      <div key={shakeKey} className={shakeKey ? 'shake' : undefined}>
        <div className="range">{hm(start)}–{hm(end)}</div>
        <div className="range-sub">{isToday ? tr('сьогодні', 'today') : dayTitle(dayKey(start))}{nextTaken && values[values.length - 1] < Math.min(MAX_MIN, leftMin) ? tr(` · о ${hm(nextTaken)} кімнату вже забронювали`, ` · someone has it from ${hm(nextTaken)}`) : ''}</div>
      </div>

      <Wheel values={values} value={minutes} onChange={setMinutes} label={durLabel} ariaLabel={tr('Тривалість броні', 'Booking length')} />

      {error && <p className="note" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
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
