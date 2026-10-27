import { ScreenHead } from '../../ui/ScreenHead';
import { haptic } from '../../../lib/telegram';
import { tr } from '../../../lib/i18n';
import { useUi } from '../../../stores/uiStore';
import { ForYou } from './ForYou';
import { Startups } from './Startups';
import { People } from './People';

/** Можливості: internships and grants for your programme, student startups, people to team up with. */
export function OpportunitiesPage() {
  const { oppsView: view, setOppsView, oppId } = useUi();
  const pick = (v: typeof view) => { if (v !== view) { haptic.select(); setOppsView(v); } };
  return (
    <div className="screen">
      <ScreenHead title={tr('Можливості', 'Opportunities')} />
      <div className="seg" role="group" aria-label={tr('Розділ', 'Section')}>
        <button aria-pressed={view === 'forYou'} onClick={() => pick('forYou')}>{tr('Для тебе', 'For you')}</button>
        <button aria-pressed={view === 'startups'} onClick={() => pick('startups')}>{tr('Стартапи', 'Startups')}</button>
        <button aria-pressed={view === 'people'} onClick={() => pick('people')}>{tr('Люди', 'People')}</button>
      </div>
      {view === 'forYou' && <ForYou openId={oppId} />}
      {view === 'startups' && <Startups />}
      {view === 'people' && <People />}
    </div>
  );
}
