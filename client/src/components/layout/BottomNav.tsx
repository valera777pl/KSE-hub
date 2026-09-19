import { useTranslation } from 'react-i18next';
import type { TabId } from '../../types';

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; icon: string }[] = [
  { id: 'rooms', icon: '🏠' },
  { id: 'moodle', icon: '📚' },
  { id: 'venture', icon: '🤝' },
  { id: 'careers', icon: '💼' },
  { id: 'copilot', icon: '🤖' },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`bottom-nav__item ${activeTab === tab.id ? 'bottom-nav__item--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="bottom-nav__icon">{tab.icon}</span>
          <span>{t(`nav.${tab.id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
