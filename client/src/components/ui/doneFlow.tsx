import { useCallback, useEffect, useRef, useState } from 'react';
import { api, track } from '../../api/client';
import type { DeadlineWithCourse } from '../../types';
import { tr } from '../../lib/i18n';
import { haptic } from '../../lib/telegram';
import { read, write } from '../../lib/cache';

/*
 * «Зроблено» the Todoist way (NEXT-PROMPT.md §7, DESIGN.md → Done):
 *   0 ms     tap (or swipe): light impact, the circle fills in --success-fill (150 ms)
 *   120 ms   the tick draws itself (180 ms); at 330 ms a success haptic
 *   250 ms   the title is struck through and greys out
 *   420 ms   the row folds away (280 ms), the ones below slide up
 *   720 ms   it moves to «Зроблено»; a toast offers «Скасувати» for 4 s
 * All of it in CSS (transform, opacity, grid rows); reduced motion → straight to the result.
 */

export type DonePhase = 'completing' | 'entering';
export type DoneVia = 'button' | 'swipe' | 'auto';

const FOLDED_AT = 720;
const TOAST_MS = 4000;
const AUTO_SEEN = 'auto_done_seen';
const AUTO_WINDOW = 3 * 86_400_000;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useDoneFlow(onFail: () => void) {
  const [over, setOver] = useState<Map<number, boolean>>(new Map());
  const [phases, setPhases] = useState<Map<number, DonePhase>>(new Map());
  const [toast, setToast] = useState<{ id: number; key: number } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  const mark = (id: number, done: boolean) => setOver((m) => new Map(m).set(id, done));
  const phase = (id: number, p: DonePhase | null) => setPhases((m) => { const n = new Map(m); if (p) n.set(id, p); else n.delete(id); return n; });

  const server = useCallback((id: number) => {
    api.patch(`/moodle/assignments/${id}/toggle`).catch(() => {
      haptic.error();
      setOver((m) => { const n = new Map(m); n.delete(id); return n; });
      onFail();
    });
  }, [onFail]);

  /** Mark done with the whole animation. `auto` is Moodle's «здано»: already done on the server, just shown. */
  const complete = useCallback((id: number, via: DoneVia) => {
    if (phases.has(id)) return;
    haptic.tap();
    if (via !== 'auto') {
      server(id);
      track('deadline.done', { via });
      setToast({ id, key: Date.now() });
    }
    if (reducedMotion()) {
      mark(id, true);
      haptic.success();
      return;
    }
    phase(id, 'completing');
    later(330, () => haptic.success());
    later(FOLDED_AT, () => { mark(id, true); phase(id, null); });
  }, [phases, server]);

  /** «Скасувати»: back where it was, unfolding. */
  const undo = useCallback((id: number) => {
    setToast(null);
    haptic.select();
    server(id);
    mark(id, false);
    if (!reducedMotion()) {
      phase(id, 'entering');
      later(320, () => phase(id, null));
    }
  }, [server]);

  /** A plain switch without the show (the sheet's «Повернути в список»). */
  const set = useCallback((id: number, done: boolean) => { server(id); mark(id, done); }, [server]);

  const apply = useCallback((list: DeadlineWithCourse[] | null) => list?.map((d) => (over.has(d.assignment.id)
    ? { ...d, assignment: { ...d.assignment, isCompleted: over.get(d.assignment.id)! } } : d)) ?? null, [over]);

  // The toast leaves on its own
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return { apply, phaseOf: (id: number) => phases.get(id) ?? null, complete, undo, set, toast, dismiss: () => setToast(null), mark };
}

/**
 * Handed in on Moodle since the student last looked: the row shows up open and plays «зроблено» once by itself.
 * Seen ids are kept on the device, so Today and Дедлайни don't both replay it.
 */
export function useAutoDone(list: DeadlineWithCourse[] | null, flow: ReturnType<typeof useDoneFlow>) {
  const started = useRef(false);
  useEffect(() => {
    if (!list || started.current) return;
    const seen = new Set(read<number[]>(AUTO_SEEN)?.data ?? []);
    const fresh = list.filter(({ assignment: a }) => a.isCompleted && a.submittedAt && !seen.has(a.id)
      && Date.now() - new Date(a.submittedAt).getTime() < AUTO_WINDOW);
    started.current = true;
    if (!fresh.length) return;
    write(AUTO_SEEN, [...seen, ...fresh.map((d) => d.assignment.id)].slice(-200));
    // Shown open first, then done once the screen has settled
    fresh.forEach((d) => flow.mark(d.assignment.id, false));
    fresh.forEach((d, i) => window.setTimeout(() => flow.complete(d.assignment.id, 'auto'), 700 + i * 250));
  }, [list]);
}

/** «Зроблено · Скасувати» above the tab bar for 4 s. */
export function DoneToast({ flow }: { flow: ReturnType<typeof useDoneFlow> }) {
  if (!flow.toast) return null;
  const { id, key } = flow.toast;
  return (
    <div className="toast" role="status" key={key}>
      <span>{tr('Зроблено', 'Done')}</span>
      <button className="toast__undo" onClick={() => flow.undo(id)}>{tr('Скасувати', 'Undo')}</button>
    </div>
  );
}

/** A number that ticks: the new value slides up into place (tabular, so nothing jumps sideways). */
export function Tick({ value }: { value: number }) {
  return <span className="tick num" key={value}>{value}</span>;
}
