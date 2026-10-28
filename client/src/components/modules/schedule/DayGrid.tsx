import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DoorOpen } from 'lucide-react';
import { api } from '../../../api/client';
import type { ClassEvent, DeadlineWithCourse } from '../../../types';
import { tr } from '../../../lib/i18n';
import { hm, now, spanText, todayKey, dayKey } from '../../../lib/time';
import { shortPlace } from '../../../lib/place';
import { Avatar } from '../../ui/Avatar';
import { courseCode } from '../../ui/DeadlineRow';

/*
 * The day as a time grid (NEXT-PROMPT.md §6, DESIGN.md → DayGrid): hours down the left, classes as blocks
 * placed and sized by time, the free time between them as dashed "windows". Height of an hour is the zoom.
 */

export type GridFriend = { userId: number; name: string; avatarUrl?: string | null };
export type GridClass = { e: ClassEvent; theirs?: boolean; friends?: GridFriend[] };
export type GridColumn = { key: string; who: GridFriend | null; classes: GridClass[] };

/** Zoom: px per hour, and where the text gets more or less detailed. */
export const ZOOM = { min: 32, max: 120, compactBelow: 56, detailedFrom: 90, default: 64 } as const;
export const zoomLevel = (px: number) => (px < ZOOM.compactBelow ? 'compact' : px >= ZOOM.detailedFrom ? 'detailed' : 'normal');

const MIN = 60_000;
const WINDOW_MIN = 30;

const minutesOfDay = (iso: string) => {
  const [h, m] = hm(iso).split(':').map(Number);
  return h * 60 + m;
};

/** Gaps of 30+ minutes between the given busy intervals (minutes of the day). */
export function gaps(busy: [number, number][], minLength = WINDOW_MIN): [number, number][] {
  const sorted = [...busy].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let end = sorted[0]?.[1] ?? 0;
  for (const [s, e] of sorted.slice(1)) {
    if (s - end >= minLength) out.push([end, s]);
    end = Math.max(end, e);
  }
  return out;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const spanMin = (min: number) => spanText(min * MIN);

export function DayGrid({ day, columns, shared, busy, deadlines, hourPx, onOpen, onWindow, onDeadline }: {
  day: string;
  columns: GridColumn[];
  /** «Спільні»: rings on shared classes, windows when everyone is free */
  shared: boolean;
  /** «Спільні»: everyone's classes, for the windows when all are free */
  busy?: ClassEvent[];
  deadlines: DeadlineWithCourse[];
  hourPx: number;
  onOpen: (e: ClassEvent) => void;
  /** A window tapped: open Кімнати at that time */
  onWindow: (start: Date) => void;
  onDeadline: (id: number) => void;
}) {
  const today = todayKey();
  const isToday = day === today;
  const t = now();
  const nowMin = isToday ? minutesOfDay(t.toISOString()) : null;
  const many = columns.length >= 3;
  const level = zoomLevel(hourPx);

  const all = columns.flatMap((c) => c.classes);
  const span = [...all.map((c) => c.e), ...(busy ?? [])];
  // From an hour before the first class (or "now", if earlier) to an hour after the last: no empty morning to scroll past
  const firstMin = span.length ? Math.min(...span.map((e) => minutesOfDay(e.startAt)), nowMin ?? 24 * 60) : 9 * 60;
  const lastMin = span.length ? Math.max(...span.map((e) => minutesOfDay(e.endAt))) : 18 * 60;
  const from = Math.max(0, Math.floor(firstMin / 60) - (firstMin % 60 < 20 ? 1 : 0));
  const to = Math.min(24, Math.max(Math.ceil(lastMin / 60) + 1, from + 3));
  const y = (min: number) => ((min - from * 60) / 60) * hourPx;

  // Windows: in one column, between my classes; with friends, the time when everyone is free
  const windows = useMemo(() => {
    // A window is something to use: not on a day that's gone, not in «Разом» (the columns show it)
    if ((columns.length > 1 && !shared) || day < today) return [];
    const taken = (shared ? busy ?? all.map((c) => c.e) : (columns[0]?.classes ?? []).map((c) => c.e))
      .map((e) => [minutesOfDay(e.startAt), minutesOfDay(e.endAt)] as [number, number]);
    return gaps(taken).filter(([, e]) => !isToday || e > (nowMin ?? 0));
  }, [columns, shared, busy, isToday, day, today]);

  return (
    <div className="grid-day">
      {deadlines.length > 0 && (
        <div className="grid-due" role="list" aria-label={tr('Дедлайни цього дня', 'Due this day')}>
          {deadlines.map((d) => (
            <button key={d.assignment.id} role="listitem" className={`grid-due__chip press${d.assignment.isCompleted ? ' grid-due__chip--done' : ''}`}
              onClick={() => onDeadline(d.assignment.id)}>
              <b className="num">{hm(d.assignment.dueDate!)}</b>
              <span>{[courseCode(d.courseName), d.assignment.title].filter(Boolean).join(' ')}</span>
            </button>
          ))}
        </div>
      )}

      {columns.length > 1 && (
        <div className="grid-who" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((c) => (
            <span key={c.key} className="grid-who__cell">
              <Avatar name={c.who?.name ?? tr('Я', 'Me')} url={c.who?.avatarUrl ?? null} size={24} />
              {!many && <em>{c.who ? c.who.name.split(' ')[0] : tr('Я', 'Me')}</em>}
            </span>
          ))}
        </div>
      )}

      <div className="grid" style={{ height: (to - from) * hourPx }}>
        {Array.from({ length: to - from + 1 }, (_, i) => (
          <div key={i} className="grid__hour" style={{ top: i * hourPx }}>
            {/* The hour label steps aside for the "now" time when they'd touch */}
            {!(nowMin !== null && Math.abs(y(nowMin) - i * hourPx) < 18) && <span className="num">{hhmm((from + i) * 60)}</span>}
          </div>
        ))}

        <div className="grid__cols" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((c) => (
            <div key={c.key} className="grid__col">
              {c.classes.map((g) => (
                <Block key={`${g.theirs ? 't' : 'm'}${g.e.id}`} g={g} top={y(minutesOfDay(g.e.startAt))}
                  height={((minutesOfDay(g.e.endAt) - minutesOfDay(g.e.startAt)) / 60) * hourPx}
                  level={many ? 'compact' : level} codeOnly={many} ring={shared && !!g.friends?.length} onOpen={() => onOpen(g.e)} />
              ))}
            </div>
          ))}
        </div>

        {windows.map(([s, e]) => (
          <Window key={s} day={day} start={s} end={e} top={y(s)} height={((e - s) / 60) * hourPx} everyone={shared}
            compact={((e - s) / 60) * hourPx < 40} onTap={onWindow} />
        ))}

        {nowMin !== null && nowMin >= from * 60 && nowMin <= to * 60 && (
          <div className="grid__now" style={{ top: y(nowMin) }} aria-label={`${tr('Зараз', 'Now')} ${hm(t)}`}>
            <span className="num">{hm(t)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Block({ g, top, height, level, codeOnly, ring, onOpen }: {
  g: GridClass; top: number; height: number; level: ReturnType<typeof zoomLevel>; codeOnly: boolean; ring: boolean; onOpen: () => void;
}) {
  const { e } = g;
  const t = now().getTime();
  const start = new Date(e.startAt).getTime();
  const end = new Date(e.endAt).getTime();
  const past = end <= t;
  const live = start <= t && t < end;
  // Short blocks (zoomed out) keep one line: code and time
  const oneLine = codeOnly || height < 46 || level === 'compact';
  const style: CSSProperties = { top: top + 1, height: Math.max(height - 2, 18) };
  const place = shortPlace(e.location);
  return (
    <button className={`gblock press${past ? ' gblock--past' : ''}${g.theirs ? ' gblock--theirs' : ''}${live ? ' gblock--now' : ''}${ring ? ' gblock--shared' : ''}`}
      style={style} onClick={onOpen}
      aria-label={`${e.courseCode}${e.section ? ` [${e.section}]` : ''}, ${hm(e.startAt)}–${hm(e.endAt)}${place ? `, ${place}` : ''}`}>
      {oneLine ? (
        <span className="gblock__line">
          <b>{e.courseCode}</b>{!codeOnly && <span className="num"> · {hm(e.startAt)}</span>}
        </span>
      ) : (
        <>
          <span className="gblock__line"><b>{e.courseCode}</b>{e.section && <small> [{e.section}]</small>}</span>
          {place && <span className="gblock__meta">{place}</span>}
          {level === 'detailed' && <span className="gblock__meta num">{hm(e.startAt)}–{hm(e.endAt)}</span>}
        </>
      )}
      {ring && !codeOnly && height >= 46 && (
        <span className="gblock__friends">{g.friends!.slice(0, 3).map((f) => <Avatar key={f.userId} name={f.name} url={f.avatarUrl ?? null} size={20} />)}</span>
      )}
      {live && height >= 40 && <span className="gblock__progress"><i style={{ width: `${((t - start) / (end - start)) * 100}%` }} /></span>}
    </button>
  );
}

/** A gap of 30+ minutes: dashed, says how long and how many rooms are free; tap → Кімнати at that time. */
function Window({ day, start, end, top, height, everyone, compact, onTap }: {
  day: string; start: number; end: number; top: number; height: number; everyone: boolean; compact: boolean; onTap: (start: Date) => void;
}) {
  const [rooms, setRooms] = useState<number | null>(null);
  const at = useRef<Date>(new Date(`${day}T${hhmm(start)}:00`));
  // Kyiv wall clock → instant: the day's key plus the time, read in Kyiv
  useEffect(() => {
    const startAt = kyivInstant(day, start);
    const effective = new Date(Math.max(startAt.getTime(), now().getTime()));
    at.current = effective;
    const endAt = kyivInstant(day, end);
    if (endAt.getTime() - effective.getTime() < 15 * MIN) return;
    const params = new URLSearchParams({ start: effective.toISOString(), end: new Date(Math.min(endAt.getTime(), effective.getTime() + 60 * MIN)).toISOString() });
    api.get<{ rooms: { available: boolean }[] }>(`/rooms/available?${params}`)
      .then((r) => setRooms(r.rooms.filter((x) => x.available).length)).catch(() => {});
  }, [day, start, end]);

  const length = spanMin(end - start);
  const label = everyone
    ? tr(`Усі вільні ${hhmm(start)}–${hhmm(end)}`, `Everyone free ${hhmm(start)}–${hhmm(end)}`)
    : tr(`Вікно ${length}`, `Gap ${length}`);
  const roomsText = rooms === null ? '' : rooms ? tr(` · ${rooms} ${rooms === 1 ? 'кімната вільна' : rooms < 5 ? 'кімнати вільні' : 'кімнат вільні'}`, ` · ${rooms} room${rooms === 1 ? '' : 's'} free`) : '';
  return (
    <button className={`gwindow press${compact ? ' gwindow--compact' : ''}`} style={{ top: top + 3, height: Math.max(height - 6, 20) }}
      onClick={() => onTap(at.current)} aria-label={`${label}${roomsText}`}>
      <DoorOpen strokeWidth={1.7} aria-hidden="true" />
      <span>{label}<span className="gwindow__rooms">{roomsText}</span></span>
    </button>
  );
}

/** "2026-10-29" + minutes of the Kyiv day → the instant (DST-safe enough for daytime hours). */
function kyivInstant(day: string, minutes: number): Date {
  const guess = new Date(`${day}T${hhmm(minutes)}:00Z`);
  // Kyiv is UTC+2 or +3: shift by whatever offset Kyiv shows at that moment
  const shown = minutesOfDay(guess.toISOString()) + (dayKey(guess) === day ? 0 : 24 * 60);
  return new Date(guess.getTime() - (shown - minutes) * MIN);
}
