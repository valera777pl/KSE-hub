import { ScreenHead } from '../../ui/ScreenHead';
import { useUi } from '../../../stores/uiStore';
import { haptic } from '../../../lib/telegram';
import { SchedulePage } from '../schedule/SchedulePage';
import { MoodlePage } from '../moodle/MoodlePage';

/** Навчання: the week of classes and everything due, one switch apart. */
export function StudyPage() {
  const { studyView, setStudyView } = useUi();
  const pick = (v: typeof studyView) => { if (v !== studyView) { haptic.select(); setStudyView(v); } };
  return (
    <div className="screen">
      <ScreenHead title="Навчання" />
      <div className="seg" role="group" aria-label="Розділ">
        <button aria-pressed={studyView === 'schedule'} onClick={() => pick('schedule')}>Розклад</button>
        <button aria-pressed={studyView === 'deadlines'} onClick={() => pick('deadlines')}>Дедлайни</button>
      </div>
      {studyView === 'schedule' ? <SchedulePage /> : <MoodlePage />}
    </div>
  );
}
