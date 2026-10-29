import { ScreenHead } from '../../ui/ScreenHead';
import { useUi } from '../../../stores/uiStore';
import { SchedulePage } from '../schedule/SchedulePage';
import { DeadlinesPage } from '../deadlines/DeadlinesPage';
import { SlackFeed } from '../slack/SlackFeed';
import { tr } from '../../../lib/i18n';

/** Навчання: the week of classes, everything due, what was said in Slack; the titles are the switch. */
export function StudyPage() {
  const { studyView, setStudyView } = useUi();
  return (
    <div className="screen">
      <ScreenHead
        tabs={[{ id: 'schedule', label: tr('Розклад', 'Schedule') }, { id: 'deadlines', label: tr('Дедлайни', 'Deadlines') }, { id: 'slack', label: 'Slack' }]}
        active={studyView} onTab={setStudyView} />
      <div role="tabpanel" key={studyView} className="fade-in" id={`panel-${studyView}`} aria-labelledby={`tab-${studyView}`}>
        {studyView === 'schedule' ? <SchedulePage /> : studyView === 'deadlines' ? <DeadlinesPage /> : <SlackFeed />}
      </div>
    </div>
  );
}
