import { ScreenHead } from '../../ui/ScreenHead';
import { useUi } from '../../../stores/uiStore';
import { SchedulePage } from '../schedule/SchedulePage';
import { DeadlinesPage } from '../deadlines/DeadlinesPage';
import { tr } from '../../../lib/i18n';

/** Навчання: the week of classes and everything due, the two titles are the switch. */
export function StudyPage() {
  const { studyView, setStudyView } = useUi();
  return (
    <div className="screen">
      <ScreenHead
        tabs={[{ id: 'schedule', label: tr('Розклад', 'Schedule') }, { id: 'deadlines', label: tr('Дедлайни', 'Deadlines') }]}
        active={studyView} onTab={setStudyView} />
      <div role="tabpanel" key={studyView} className="fade-in" id={`panel-${studyView}`} aria-labelledby={`tab-${studyView}`}>
        {studyView === 'schedule' ? <SchedulePage /> : <DeadlinesPage />}
      </div>
    </div>
  );
}
