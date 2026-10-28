import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePinch } from '@use-gesture/react';
import { Coffee } from 'lucide-react';
import { api, track as report } from '../../../api/client';
import type { DeadlineWithCourse } from '../../../types';
import { tr } from '../../../lib/i18n';
import { cloud, haptic } from '../../../lib/telegram';
import { hm, now } from '../../../lib/time';
import { useUi } from '../../../stores/uiStore';
import { courseCode } from '../../ui/DeadlineRow';
import { EmptyState } from '../../ui/States';
import { Glow } from '../../ui/Glow';
import { ZOOM, zoomLevel } from './DayGrid';

const ZOOM_KEY = 'schedule_zoom';
const clamp = (px: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, px));

export type Zoom = { px: number; set: (px: number) => void; save: () => void };

/** Height of an hour in the grid, remembered in Telegram cloud storage. */
export function useZoom(): Zoom {
  const [px, setPx] = useState<number>(ZOOM.default);
  const latest = useRef(px);
  useEffect(() => {
    cloud.get(ZOOM_KEY).then((v) => { const n = Number(v); if (n) { latest.current = clamp(n); setPx(clamp(n)); } });
  }, []);
  return {
    px,
    set: (next) => {
      const v = clamp(next);
      // A tick each time the text density changes: compact / normal / detailed
      if (zoomLevel(v) !== zoomLevel(latest.current)) haptic.select();
      latest.current = v;
      setPx(v);
    },
    save: () => cloud.set(ZOOM_KEY, String(Math.round(latest.current))),
  };
}

/**
 * Two fingers pinch the hours taller or shorter; the point between the fingers stays put.
 * One finger still scrolls (touch-action: pan-y). A double tap switches between compact and detailed.
 */
export function usePinchZoom(ref: RefObject<HTMLDivElement | null>, zoom: Zoom) {
  const start = useRef(zoom.px);
  usePinch(({ first, last, offset: [scale], origin: [, oy], memo }) => {
    const el = ref.current;
    if (!el) return memo;
    const scroller = el.closest('.shell__main') as HTMLElement | null;
    if (first) start.current = zoom.px;
    const prev = (memo as number | undefined) ?? zoom.px;
    const next = clamp(start.current * scale);
    if (scroller && next !== prev) {
      // Keep the content under the fingers in place while the hours stretch
      const offset = oy - el.getBoundingClientRect().top;
      scroller.scrollTop += offset * (next / prev - 1);
    }
    zoom.set(next);
    if (last) {
      zoom.save();
      track(next);
    }
    return next;
  }, { target: ref, scaleBounds: { min: ZOOM.min / ZOOM.max, max: ZOOM.max / ZOOM.min }, from: () => [1, 0], eventOptions: { passive: false } });

  // Double tap: compact ↔ detailed
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTap = 0;
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
      const t = e.timeStamp;
      if (t - lastTap < 300) {
        zoom.set(zoomLevel(zoom.px) === 'detailed' ? ZOOM.min + 8 : ZOOM.detailedFrom + 10);
        zoom.save();
        lastTap = 0;
      } else lastTap = t;
    };
    el.addEventListener('pointerup', onTap);
    return () => el.removeEventListener('pointerup', onTap);
  });
}

let tracked = false;
function track(px: number) {
  // Once per visit is enough to know the gesture gets used
  if (tracked) return;
  tracked = true;
  report('schedule.zoom', { level: zoomLevel(px) });
}

/** A day without classes: say so, mention what's due, and how many rooms are free right now. */
export function EmptyDay({ day, today, deadlines }: { day: string; today: string; deadlines: DeadlineWithCourse[] }) {
  const [rooms, setRooms] = useState<number | null>(null);
  useEffect(() => {
    if (day !== today) return;
    const start = now();
    const params = new URLSearchParams({ start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() });
    api.get<{ rooms: { available: boolean }[] }>(`/rooms/available?${params}`).then((r) => setRooms(r.rooms.filter((x) => x.available).length)).catch(() => {});
  }, [day, today]);
  const text = deadlines.length
    ? deadlines.map((d) => `${hm(d.assignment.dueDate!)} · ${[courseCode(d.courseName), d.assignment.title].filter(Boolean).join(' ')}`).join('\n')
    : rooms ? tr(`Вільних кімнат зараз: ${rooms}`, `Rooms free now: ${rooms}`) : undefined;
  // Not a card: an empty day is open space, with the screen's one glow behind it
  return (
    <div className="has-glow empty-day">
      <Glow center />
      <EmptyState icon={Coffee} title={day < today ? tr('Цього дня пар не було', 'No classes that day') : tr('Пар немає', 'No classes')}
        text={text}
        action={day === today && rooms ? { label: tr('Відкрити кімнати', 'Open rooms'), onClick: () => useUi.getState().setTab('rooms') } : undefined} />
    </div>
  );
}
