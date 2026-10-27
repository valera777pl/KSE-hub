import { CalendarDays, Compass, DoorOpen, Sun, type LucideIcon } from 'lucide-react';
import type { TabId } from '../../types';
import { tr } from '../../lib/i18n';

const tabs = (): { id: TabId; label: string; icon: LucideIcon }[] => [
  { id: 'today', label: tr('Сьогодні', 'Today'), icon: Sun },
  { id: 'study', label: tr('Навчання', 'Study'), icon: CalendarDays },
  { id: 'rooms', label: tr('Кімнати', 'Rooms'), icon: DoorOpen },
  { id: 'opps', label: tr('Можливості', 'Opportunities'), icon: Compass },
];

export function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="tabbar" aria-label={tr('Розділи', 'Sections')}>
      {tabs().map(({ id, label, icon: Icon }) => (
        <button key={id} className="tabbar__item" aria-current={active === id ? 'page' : undefined} onClick={() => active !== id && onChange(id)}>
          <Icon strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </nav>
  );
}
