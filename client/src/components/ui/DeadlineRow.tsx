import { useState } from 'react';
import { useDrag } from '@use-gesture/react';
import { Check } from 'lucide-react';
import type { DeadlineWithCourse } from '../../types';
import { dayKey, dayNum, hm, now, weekdayShort } from '../../lib/time';
import { tr } from '../../lib/i18n';
import type { DonePhase, DoneVia } from './doneFlow';

/** "ECON100 Principles of Economics" → "ECON100" */
export const courseCode = (name: string | null) => name?.match(/^[A-Z]{2,5}\d{3}/)?.[0] ?? name ?? '';

const SWIPE_DONE = 72;

/**
 * A deadline (DESIGN.md → DeadlineRow): the date in a column on the left, what and when on the right,
 * nothing at the far right. "MATH101 · до 23:59"; an event is a time, not a cut-off: "KSE101 · 11:30".
 * Overdue shows in red; its group title already says "Прострочено".
 * With `onCheck`: a circle on the left and a swipe to the right mark it done (DESIGN.md → Done).
 */
export function DeadlineRow({ d, onOpen, onCheck, phase = null }: {
  d: DeadlineWithCourse; onOpen: () => void; onCheck?: (via: DoneVia) => void; phase?: DonePhase | null;
}) {
  const { assignment: a } = d;
  const due = new Date(a.dueDate!);
  const late = due.getTime() < now().getTime() && !a.isCompleted;
  const k = dayKey(due);
  const when = a.type === 'event' ? hm(due) : `${tr('до', 'by')} ${hm(due)}`;
  // Handed in (from Moodle's receipt): said quietly in the caption, in green
  const submitted = a.submittedAt ? `${tr('здано', 'submitted')} ✓ ${hm(a.submittedAt)}` : null;
  // While completing, the circle and the strike are animated by .dl-wrap--completing, not switched on at once
  const done = !!a.isCompleted;

  // Swipe right to mark done: the row follows the finger over a green strip with a tick
  const [dx, setDx] = useState(0);
  const bind = useDrag(({ active, movement: [mx], last, tap }) => {
    if (tap || !onCheck || a.isCompleted) return;
    setDx(active ? Math.max(0, Math.min(mx, 120)) : 0);
    if (last && mx > SWIPE_DONE) onCheck('swipe');
  }, { axis: 'x', filterTaps: true, pointer: { touch: true } });

  return (
    <div className={`dl-wrap${phase ? ` dl-wrap--${phase}` : ''}${onCheck ? ' dl-wrap--check' : ''}`}>
      <div className="dl-wrap__in">
        {onCheck && <span className="dl-swipe" aria-hidden="true" style={{ opacity: Math.min(1, dx / SWIPE_DONE) }}><Check strokeWidth={2.4} /></span>}
        <div {...(onCheck ? bind() : {})} className={`dl dl--row${late ? ' dl--late' : ''}${done ? ' dl--done' : ''}`}
          style={dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}>
          {onCheck && (
            <button className="done-check" role="checkbox" aria-checked={done || phase === 'completing'} aria-label={done ? tr('Повернути в список', 'Mark as not done') : tr('Позначити зробленим', 'Mark as done')}
              onClick={(e) => { e.stopPropagation(); onCheck('button'); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10.2" />
                <path d="M7.5 12.4l3 3 6-6.4" />
              </svg>
            </button>
          )}
          <button className="dl__body press" onClick={onOpen}>
            <span className="dl__date" aria-hidden="true"><span>{weekdayShort(k).toLowerCase()}</span><b className="num">{dayNum(k)}</b></span>
            <span className="dl__main">
              <span className="dl__title clamp2">{a.title}</span>
              <span className="dl__meta num">
                {[courseCode(d.courseName), submitted ? null : when].filter(Boolean).join(' · ')}
                {submitted && <>{courseCode(d.courseName) ? ' · ' : ''}<span className="dl__ok">{submitted}</span></>}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
