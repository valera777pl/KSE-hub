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

export type Zoom = { px: number; set: (px: number) => void; save: () => void; get: () => number };

/** Height of an hour in the grid, remembered in Telegram cloud storage. */
export function useZoom(): Zoom {
  const [px, setPx] = useState<number>(ZOOM.default);
  const latest = useRef(px);
  useEffect(() => {
    cloud.get(ZOOM_KEY).then((v) => { const n = Number(v); if (n) { latest.current = clamp(n); setPx(clamp(n)); } });
  }, []);
  return {
    px,
    get: () => latest.current,
    set: (next) => { latest.current = clamp(next); setPx(latest.current); },
    save: () => cloud.set(ZOOM_KEY, String(Math.round(latest.current))),
  };
}

/**
 * Two fingers stretch or squeeze the hours, the point between the fingers stays put. During the gesture only
 * the CSS variable --hour and the scroll position change, once per frame, so nothing re-renders and it stays smooth;
 * React learns the final value when the fingers lift. A tick (selectionChanged) at each density step.
 * One finger still scrolls (touch-action: pan-y). A double tap switches between compact and detailed.
 */
export function usePinchZoom(ref: RefObject<HTMLDivElement | null>, zoom: Zoom) {
  const g = useRef({ start: zoom.px, px: zoom.px, frame: 0, oy: 0 });

  usePinch(({ first, last, offset: [scale], origin: [, oy] }) => {
    const el = ref.current;
    if (!el) return;
    const s = g.current;
    if (first) {
      s.start = zoom.get();
      s.px = s.start;
      el.classList.add('is-pinching');
    }
    s.oy = oy;
    const next = clamp(s.start * scale);
    if (!s.frame) {
      s.frame = requestAnimationFrame(() => {
        s.frame = 0;
        const prev = s.px;
        const target = clamp(s.start * scale);
        if (target === prev) return;
        const grid = el.querySelector('.grid') as HTMLElement | null;
        const scroller = el.closest('.shell__main') as HTMLElement | null;
        // Keep the hour under the fingers where it is while the hours stretch
        const offset = grid ? s.oy - grid.getBoundingClientRect().top : 0;
        el.style.setProperty('--hour', `${target}px`);
        if (scroller) scroller.scrollTop += offset * (target / prev - 1);
        if (zoomLevel(target) !== zoomLevel(prev)) haptic.select();
        s.px = target;
      });
    }
    if (last) {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      el.style.setProperty('--hour', `${next}px`);
      s.px = next;
      el.classList.remove('is-pinching');
      zoom.set(next);
      zoom.save();
      track(next);
    }
  }, {
    target: ref,
    scaleBounds: () => ({ min: ZOOM.min / zoom.get(), max: ZOOM.max / zoom.get() }),
    rubberband: 0.15,
    from: () => [1, 0],
    eventOptions: { passive: false },
  });

  // Double tap: compact ↔ detailed, animated by the --hour transition
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTap = 0;
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
      const t = e.timeStamp;
      if (t - lastTap < 300) {
        haptic.select();
        zoom.set(zoomLevel(zoom.get()) === 'detailed' ? 40 : 120);
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
