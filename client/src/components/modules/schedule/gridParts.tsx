import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { usePinch } from '@use-gesture/react';
import { Coffee } from 'lucide-react';
import { track as report } from '../../../api/client';
import type { DeadlineWithCourse } from '../../../types';
import { tr } from '../../../lib/i18n';
import { cloud, haptic } from '../../../lib/telegram';
import { hm } from '../../../lib/time';
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

/** A day without classes: say so, and what's due that day if anything. */
export function EmptyDay({ day, today, deadlines }: { day: string; today: string; deadlines: DeadlineWithCourse[] }) {
  const text = deadlines.length
    ? deadlines.map((d) => `${hm(d.assignment.dueDate!)} · ${[courseCode(d.courseName), d.assignment.title].filter(Boolean).join(' ')}`).join('\n')
    : undefined;
  // Not a card: an empty day is open space, with the screen's one glow behind it
  return (
    <div className="has-glow empty-day">
      <Glow center />
      <EmptyState icon={Coffee} title={day < today ? tr('Цього дня пар не було', 'No classes that day') : tr('Пар немає', 'No classes')} text={text} />
    </div>
  );
}

/**
 * The day strip as a slider: press anywhere on it and slide sideways, the day under the finger lights up at once
 * (with a tick) and the grid follows without holding the finger back. Fast flicks count too: the pointer is captured,
 * the strip doesn't hand the gesture to scrolling (touch-action: none), and the day under the finger on release wins.
 */
export function useStripScrub(days: string[], onHover: (day: string | null) => void, commit: (day: string) => void) {
  const s = useRef({ x0: 0, active: false, down: false, last: '' });
  const dayAt = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    const i = Math.min(days.length - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * days.length)));
    return days[i];
  };
  const finish = (el: HTMLElement | null, x: number | null) => {
    const st = s.current;
    if (st.active && el && x !== null) commit(dayAt(el, x));
    st.down = false;
    st.active = false;
    onHover(null);
  };
  useEffect(() => {
    const end = () => { if (s.current.down) finish(null, null); };
    window.addEventListener('pointercancel', end);
    return () => window.removeEventListener('pointercancel', end);
  });
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      s.current = { x0: e.clientX, active: false, down: true, last: dayAt(e.currentTarget, e.clientX) };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const st = s.current;
      if (!st.down) return;
      if (!st.active && Math.abs(e.clientX - st.x0) < 6) return;
      st.active = true;
      const day = dayAt(e.currentTarget, e.clientX);
      if (day !== st.last) {
        st.last = day;
        haptic.select();
        onHover(day);
        commit(day);
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => finish(e.currentTarget, e.clientX),
    onLostPointerCapture: () => { if (s.current.down) finish(null, null); },
  };
}
