import { useState } from 'react';
import { ScreenHead } from '../../ui/ScreenHead';
import { haptic } from '../../../lib/telegram';
import { CareersPage } from '../careers/CareersPage';
import { VenturePage } from '../venture/VenturePage';

/** Можливості: internships and grants for you, and student startups. Rebuilt in block 3. */
export function OpportunitiesPage() {
  const [view, setView] = useState<'forYou' | 'startups'>('forYou');
  const pick = (v: typeof view) => { if (v !== view) { haptic.select(); setView(v); } };
  return (
    <div className="screen">
      <ScreenHead title="Можливості" />
      <div className="seg" role="group" aria-label="Розділ">
        <button aria-pressed={view === 'forYou'} onClick={() => pick('forYou')}>Для тебе</button>
        <button aria-pressed={view === 'startups'} onClick={() => pick('startups')}>Стартапи і люди</button>
      </div>
      {view === 'forYou' ? <CareersPage /> : <VenturePage />}
    </div>
  );
}
