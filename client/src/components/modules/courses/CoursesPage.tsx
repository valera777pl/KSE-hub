import { useState } from 'react';
import { ChevronDown, ChevronRight, GraduationCap } from 'lucide-react';
import { api, track } from '../../../api/client';
import { useCached } from '../../../lib/cache';
import { tr } from '../../../lib/i18n';
import { haptic, openExternal } from '../../../lib/telegram';
import { useAuthStore } from '../../../stores/authStore';
import { useUi } from '../../../stores/uiStore';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { MoodleSignIn } from '../grades/MoodleGradesSheet';

type Course = { courseId: number; code: string | null; name: string; grade: string | null; ended?: boolean };
type Overview = { connected: boolean; courses: Course[] };

/**
 * Навчання → Курси (the owner's test): every course in the student's Moodle with its total so far.
 * A course opens its page — the same one the schedule and deadlines open — with grades and materials.
 */
export function CoursesPage() {
  const q = useCached('moodle_courses', () => api.get<Overview>('/moodle/grades'));
  const [showPast, setShowPast] = useState(false);

  if (!q.data && q.error) return <ErrorState error={q.error} onRetry={q.refresh} />;
  if (!q.data) return <SkeletonRows rows={4} />;
  const stale = q.staleAt ? <StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} /> : null;

  if (!q.data.connected) {
    return (
      <>
        {stale}
        {/* Short, so the link field stays above the tab bar: the steps are the content here */}
        <div className="section-head" style={{ marginTop: 4 }}><h2>{tr('Підключи Moodle', 'Connect Moodle')}</h2></div>
        <p className="note" style={{ paddingTop: 0 }}>{tr('Оцінки, відгуки й матеріали кожного курсу — тут, без входу в Moodle.', 'Grades, feedback and materials of every course, right here.')}</p>
        <MoodleSignIn onDone={() => { q.refresh(); useAuthStore.getState().fetchUser(); }} />
      </>
    );
  }

  const current = q.data.courses.filter((c) => !c.ended);
  const past = q.data.courses.filter((c) => c.ended);
  if (!current.length && !past.length) {
    return <>{stale}<div className="group"><EmptyState icon={GraduationCap} title={tr('Курсів немає', 'No courses')} text={tr('Moodle не показав жодного курсу для тебе.', 'Moodle showed no courses for you.')} /></div></>;
  }

  return (
    <>
      {stale}
      {current.length > 0 && <div className="group">{current.map((c) => <CourseRow key={c.courseId} c={c} />)}</div>}
      {past.length > 0 && (
        <>
          <h3 className="group-title">{tr('Минулі курси', 'Past courses')}</h3>
          <div className="group">
            {showPast && past.map((c) => <CourseRow key={c.courseId} c={c} />)}
            <button className="row toggle-row" aria-expanded={showPast} onClick={() => { haptic.select(); setShowPast((v) => !v); }}>
              <span className="row__main">{showPast ? tr('Згорнути', 'Collapse') : tr(`Показати ${past.length}`, `Show ${past.length}`)}</span>
              <ChevronDown size={18} strokeWidth={1.75} />
            </button>
          </div>
        </>
      )}
      <p className="note" style={{ paddingTop: 16 }}>{tr('Підсумок курсу — як у журналі оцінок Moodle.', 'Course totals as in the Moodle gradebook.')}</p>
    </>
  );
}

function CourseRow({ c }: { c: Course }) {
  const open = () => {
    haptic.tap();
    track('courses.open');
    // A course without a code in its name has no page here: Moodle's own
    if (c.code) useUi.getState().openCourse(c.code);
    else openExternal(`https://teaching.kse.org.ua/course/view.php?id=${c.courseId}`);
  };
  return (
    <button className="row press" onClick={open}>
      <div className="row__main">
        <div className="row__title" style={{ fontWeight: 600 }}>{c.code ?? c.name}</div>
        {c.code && <div className="row__meta clamp2">{c.name.replace(c.code, '').replace(/^[\s·/-]+/, '') || c.name}</div>}
      </div>
      <span className={`row__value num${c.grade ? '' : ' grades__none'}`}>{c.grade ?? '—'}</span>
      <ChevronRight className="chev" strokeWidth={1.75} />
    </button>
  );
}
