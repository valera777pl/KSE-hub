import { useEffect, useState } from 'react';
import type { TabId } from '../../types';
import { tr } from '../../lib/i18n';
import { dayNum, todayKey } from '../../lib/time';
import { TabIcon } from './TabIcons';

const tabs = (): { id: TabId; label: string }[] => [
  { id: 'today', label: tr('Сьогодні', 'Today') },
  { id: 'study', label: tr('Навчання', 'Study') },
  { id: 'rooms', label: tr('Кімнати', 'Rooms') },
  { id: 'opps', label: tr('Можливості', 'Opportunities') },
];

/** Today's date in Kyiv for the "Сьогодні" icon; turns over at midnight while the app stays open. */
function useToday() {
  const [day, setDay] = useState(todayKey);
  useEffect(() => {
    const tick = () => setDay(todayKey());
    const timer = setInterval(tick, 60_000);
    // A phone asleep overnight: show the new date the moment the app is back
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return dayNum(day);
}

/** Tapping the open tab again scrolls it back to the top, as in iOS */
const toTop = () => document.querySelector('.shell__main')?.scrollTo({ top: 0, behavior: 'smooth' });

export function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const day = useToday();
  return (
    <nav className="tabbar" aria-label={tr('Розділи', 'Sections')}>
      {tabs().map(({ id, label }) => (
        <button key={id} className="tabbar__item" aria-current={active === id ? 'page' : undefined} onClick={() => (active === id ? toTop() : onChange(id))}>
          <TabIcon tab={id} on={active === id} day={day} />
          {label}
        </button>
      ))}
    </nav>
  );
}
