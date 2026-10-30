import { ScreenHead } from '../../ui/ScreenHead';
import { useUi } from '../../../stores/uiStore';
import { SchedulePage } from '../schedule/SchedulePage';
import { DeadlinesPage } from '../deadlines/DeadlinesPage';
import { SlackFeed } from '../slack/SlackFeed';
import { CoursesPage } from '../courses/CoursesPage';
import { tr } from '../../../lib/i18n';
import { useAuthStore } from '../../../stores/authStore';

/**
 * Навчання: the week of classes, everything due, the courses from Moodle, what was said in Slack; the titles are the switch.
 * «Курси» is the owner's test for now (Moodle through the student's token): students see three titles.
 */
export function StudyPage() {
  const { studyView, setStudyView } = useUi();
  const moodle = !!useAuthStore((s) => s.user?.isAdmin);
  const view = studyView === 'courses' && !moodle ? 'schedule' : studyView;
  return (
    <div className="screen">
      <ScreenHead
        tabs={[
          { id: 'schedule', label: tr('Розклад', 'Schedule') }, { id: 'deadlines', label: tr('Дедлайни', 'Deadlines') },
          ...(moodle ? [{ id: 'courses' as const, label: tr('Курси', 'Courses') }] : []), { id: 'slack', label: 'Slack' },
        ]}
        active={view} onTab={setStudyView} />
      <div role="tabpanel" key={view} className="fade-in" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
        {view === 'schedule' ? <SchedulePage /> : view === 'deadlines' ? <DeadlinesPage /> : view === 'courses' ? <CoursesPage /> : <SlackFeed />}
      </div>
    </div>
  );
}
