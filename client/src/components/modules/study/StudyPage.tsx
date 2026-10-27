import { ScreenHead } from '../../ui/ScreenHead';
import { useUi } from '../../../stores/uiStore';
import { haptic } from '../../../lib/telegram';
import { SchedulePage } from '../schedule/SchedulePage';
import { DeadlinesPage } from '../deadlines/DeadlinesPage';
import { tr } from '../../../lib/i18n';

/** Навчання: the week of classes and everything due, one switch apart. */
export function StudyPage() {
  const { studyView, setStudyView } = useUi();
  const pick = (v: typeof studyView) => { if (v !== studyView) { haptic.select(); setStudyView(v); } };
  return (
    <div className="screen">
      <ScreenHead title={tr('Навчання', 'Study')} />
      <div className="seg" role="group" aria-label={tr('Розділ', 'Section')}>
        <button aria-pressed={studyView === 'schedule'} onClick={() => pick('schedule')}>{tr('Розклад', 'Schedule')}</button>
        <button aria-pressed={studyView === 'deadlines'} onClick={() => pick('deadlines')}>{tr('Дедлайни', 'Deadlines')}</button>
      </div>
      {studyView === 'schedule' ? <SchedulePage /> : <DeadlinesPage />}
    </div>
  );
}
