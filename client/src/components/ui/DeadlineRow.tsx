import type { DeadlineWithCourse } from '../../types';
import { dayKey, dayNum, hm, now, weekdayShort } from '../../lib/time';
import { tr } from '../../lib/i18n';

/** "ECON100 Principles of Economics" → "ECON100" */
export const courseCode = (name: string | null) => name?.match(/^[A-Z]{2,5}\d{3}/)?.[0] ?? name ?? '';

/**
 * A deadline (DESIGN.md → DeadlineRow): the date in a column on the left, what and when on the right,
 * nothing at the far right. "MATH101 · до 23:59"; an event is a time, not a cut-off: "KSE101 · 11:30".
 * Overdue shows in red; its group title already says "Прострочено".
 */
export function DeadlineRow({ d, onOpen }: { d: DeadlineWithCourse; onOpen: () => void }) {
  const { assignment: a } = d;
  const due = new Date(a.dueDate!);
  const late = due.getTime() < now().getTime() && !a.isCompleted;
  const k = dayKey(due);
  const when = a.type === 'event' ? hm(due) : `${tr('до', 'by')} ${hm(due)}`;
  return (
    <button className={`dl press${late ? ' dl--late' : ''}${a.isCompleted ? ' dl--done' : ''}`} onClick={onOpen}>
      <span className="dl__date" aria-hidden="true"><span>{weekdayShort(k).toLowerCase()}</span><b className="num">{dayNum(k)}</b></span>
      <span className="dl__main">
        <span className="dl__title clamp2">{a.title}</span>
        <span className="dl__meta num">{[courseCode(d.courseName), when].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}
