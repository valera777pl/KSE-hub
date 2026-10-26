import { CalendarDays, Compass, DoorOpen, Sun, type LucideIcon } from 'lucide-react';
import type { TabId } from '../../types';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'today', label: 'Сьогодні', icon: Sun },
  { id: 'study', label: 'Навчання', icon: CalendarDays },
  { id: 'rooms', label: 'Кімнати', icon: DoorOpen },
  { id: 'opps', label: 'Можливості', icon: Compass },
];

export function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="tabbar" aria-label="Розділи">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} className="tabbar__item" aria-current={active === id ? 'page' : undefined} onClick={() => active !== id && onChange(id)}>
          <Icon strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </nav>
  );
}
