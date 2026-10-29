import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ClassEvent, DeadlineWithCourse } from '../../../types';
import { tr } from '../../../lib/i18n';
import { hm, now, spanText, todayKey } from '../../../lib/time';
import { haptic } from '../../../lib/telegram';
import { shortPlace } from '../../../lib/place';
import { Avatar } from '../../ui/Avatar';
import { courseCode } from '../../ui/DeadlineRow';

/*
 * The day as a time grid (NEXT-PROMPT.md §6, DESIGN.md → DayGrid): hours down the left, classes as blocks
 * placed and sized by time. Everything is measured in hours times the CSS variable --hour (set by the parent),
 * so a pinch changes one variable and nothing re-renders; how much text a block shows is up to container queries.
 */

export type GridFriend = { userId: number; name: string; avatarUrl?: string | null };
export type GridClass = { e: ClassEvent; theirs?: boolean; friends?: GridFriend[] };
export type GridColumn = { key: string; who: GridFriend | null; classes: GridClass[] };

/** Zoom: px per hour, and where the text gets more or less detailed (for the haptic ticks). */
export const ZOOM = { min: 24, max: 180, compactBelow: 56, detailedFrom: 96, default: 64 } as const;
export const zoomLevel = (px: number) => (px < ZOOM.compactBelow ? 'compact' : px >= ZOOM.detailedFrom ? 'detailed' : 'normal');

const hoursOfDay = (iso: string) => {
  const [h, m] = hm(iso).split(':').map(Number);
  return h + m / 60;
};
const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const at = (hours: number, length?: number) => ({ '--at': hours, ...(length !== undefined ? { '--len': length } : {}) }) as CSSProperties;

export function DayGrid({ day, columns, shared, busy, deadlines, hourPx, onOpen, onDeadline }: {
  day: string;
  columns: GridColumn[];
  /** «Спільні»: rings on shared classes, with the friends' avatars */
  shared: boolean;
  /** Everyone's classes in «Спільні», so the hours shown cover them too */
  busy?: ClassEvent[];
  deadlines: DeadlineWithCourse[];
  /** The current zoom, only to keep hour labels clear of the "now" time */
  hourPx: number;
  onOpen: (e: ClassEvent) => void;
  onDeadline: (id: number) => void;
}) {
  const isToday = day === todayKey();
  const t = now();
  const nowH = isToday ? hoursOfDay(t.toISOString()) : null;
  const many = columns.length >= 3;

  const span = [...columns.flatMap((c) => c.classes.map((g) => g.e)), ...(busy ?? [])];
  // From an hour before the first class (or "now", if earlier) to an hour after the last: no empty morning to scroll past
  const first = span.length ? Math.min(...span.map((e) => hoursOfDay(e.startAt)), nowH ?? 24) : 9;
  const last = span.length ? Math.max(...span.map((e) => hoursOfDay(e.endAt))) : 18;
  const from = Math.max(0, Math.floor(first) - (first % 1 < 0.34 ? 1 : 0));
  const to = Math.min(24, Math.max(Math.ceil(last) + 1, from + 3));

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

      <div className="grid" style={at(0, to - from)}>
        {Array.from({ length: to - from + 1 }, (_, i) => (
          <div key={i} className="grid__hour" style={at(i)}>
            {/* The hour label steps aside for the "now" time when they'd touch */}
            {!(nowH !== null && Math.abs(nowH - from - i) * hourPx < 18) && <span className="num">{hh(from + i)}</span>}
          </div>
        ))}

        <div className="grid__cols" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((c) => (
            <div key={c.key} className="grid__col">
              {c.classes.map((g) => (
                <Block key={`${g.theirs ? 't' : 'm'}${g.e.id}`} g={g} at={hoursOfDay(g.e.startAt) - from}
                  length={hoursOfDay(g.e.endAt) - hoursOfDay(g.e.startAt)} codeOnly={many} ring={shared && !!g.friends?.length} onOpen={() => onOpen(g.e)} />
              ))}
            </div>
          ))}
        </div>

        <Scrub from={from} to={to} classes={columns[0]?.classes.map((g) => g.e) ?? []} />

        {nowH !== null && nowH >= from && nowH <= to && (
          <div className="grid__now" style={at(nowH - from)} aria-label={`${tr('Зараз', 'Now')} ${hm(t)}`}>
            <span className="num">{hm(t)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A class. All of its text is always there; the block's own height decides what shows (container queries):
 * short → "MATH101 · 11:30", normal → code, section and room, tall → plus the time range.
 */
function Block({ g, at: start, length, codeOnly, ring, onOpen }: {
  g: GridClass; at: number; length: number; codeOnly: boolean; ring: boolean; onOpen: () => void;
}) {
  const { e } = g;
  const t = now().getTime();
  const s = new Date(e.startAt).getTime();
  const end = new Date(e.endAt).getTime();
  const past = end <= t;
  const live = s <= t && t < end;
  const place = shortPlace(e.location);
  return (
    <button className={`gblock press${past ? ' gblock--past' : ''}${g.theirs ? ' gblock--theirs' : ''}${live ? ' gblock--now' : ''}${ring ? ' gblock--shared' : ''}${codeOnly ? ' gblock--code' : ''}`}
      style={at(start, length)} onClick={onOpen}
      aria-label={`${e.courseCode}${e.section ? ` [${e.section}]` : ''}, ${hm(e.startAt)}–${hm(e.endAt)}${place ? `, ${place}` : ''}`}>
      <span className="gblock__line">
        <b>{e.courseCode}</b>
        {e.section && <small className="gblock__sec"> [{e.section}]</small>}
        <span className="gblock__t num"> · {hm(e.startAt)}</span>
      </span>
      {place && <span className="gblock__meta gblock__place">{place}</span>}
      <span className="gblock__meta gblock__range num">{hm(e.startAt)}–{hm(e.endAt)}</span>
      {ring && <span className="gblock__friends">{g.friends!.slice(0, 3).map((f) => <Avatar key={f.userId} name={f.name} url={f.avatarUrl ?? null} size={20} />)}</span>}
      {live && <span className="gblock__progress"><i style={{ width: `${((t - s) / (end - s)) * 100}%` }} /></span>}
    </button>
  );
}

const LONG_PRESS_MS = 320;
const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/**
 * «Палець по лінії дня»: hold a finger on the hours column, then slide it. A line follows the finger with the time
 * and what's happening then: «на парі ECON100 · ще 35 хв» or «вільно до 15:00». A tick at every class edge.
 * Only the hours column reacts (touch-action: none there), so scrolling anywhere else is untouched.
 */
function Scrub({ from, to, classes }: { from: number; to: number; classes: ClassEvent[] }) {
  const [at, setAt] = useState<number | null>(null);
  const press = useRef<{ timer: number; y0: number; active: boolean; inside: string | null }>({ timer: 0, y0: 0, active: false, inside: null });
  const box = useRef<HTMLDivElement>(null);
  const spans = useMemo(() => classes.map((e) => ({ code: e.courseCode, s: hoursOfDay(e.startAt), e: hoursOfDay(e.endAt) }))
    .sort((a, b) => a.s - b.s), [classes]);

  const hourAt = (clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const h = from + ((clientY - r.top) / r.height) * (to - from);
    // Steps of 5 minutes: easier to read, and the label doesn't flicker
    return Math.min(to, Math.max(from, Math.round(h * 12) / 12));
  };
  const move = (clientY: number) => {
    const h = hourAt(clientY);
    const inside = spans.find((c) => h >= c.s && h < c.e);
    const key = inside ? `${inside.code}${inside.s}` : null;
    if (key !== press.current.inside) { haptic.select(); press.current.inside = key; }
    setAt(h);
  };

  const status = (() => {
    if (at === null) return '';
    const inside = spans.find((c) => at >= c.s && at < c.e);
    if (inside) return tr(`на парі ${inside.code} · ще ${spanText((inside.e - at) * 3_600_000)}`, `in ${inside.code} · ${spanText((inside.e - at) * 3_600_000)} left`);
    const next = spans.find((c) => c.s > at);
    return next ? tr(`вільно до ${fmt(next.s)}`, `free until ${fmt(next.s)}`) : tr('пари на сьогодні закінчились', 'no more classes this day');
  })();

  return (
    <div ref={box} className="grid__scrub"
      onPointerDown={(e) => {
        const p = press.current;
        p.y0 = e.clientY;
        const target = e.currentTarget;
        const id = e.pointerId;
        p.timer = window.setTimeout(() => {
          p.active = true;
          p.inside = null;
          target.setPointerCapture(id);
          haptic.tap();
          move(p.y0);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p.active) move(e.clientY);
        else if (Math.abs(e.clientY - p.y0) > 8) clearTimeout(p.timer);
      }}
      onPointerUp={() => { clearTimeout(press.current.timer); press.current.active = false; setAt(null); }}
      onPointerCancel={() => { clearTimeout(press.current.timer); press.current.active = false; setAt(null); }}>
      {at !== null && (
        <div className="scrub" style={{ '--at': at - from } as CSSProperties} role="status">
          <span className="scrub__pill num">{fmt(at)}</span>
          <span className="scrub__text">{status}</span>
        </div>
      )}
    </div>
  );
}
