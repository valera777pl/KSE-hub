import { useTranslation } from 'react-i18next';
import type { User } from '../../types';
import { useNotificationStore } from '../../stores/notificationStore';

interface TopBarProps {
  user: User | null;
  onProfileClick: () => void;
}

export function TopBar({ user, onProfileClick }: TopBarProps) {
  const { t } = useTranslation();
  const { unreadCount, togglePanel } = useNotificationStore();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('greetingTime.morning');
    if (hour < 18) return t('greetingTime.afternoon');
    return t('greetingTime.evening');
  };

  const getInitials = (name: string) => {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <button className="top-bar__avatar" onClick={onProfileClick}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            getInitials(user?.fullName || 'KS')
          )}
        </button>
        <div className="top-bar__greeting">
          <span className="top-bar__greeting-text">{getGreeting()}</span>
          <span className="top-bar__name">{user?.fullName || 'Student'}</span>
        </div>
      </div>

      <div className="top-bar__right">
        <button className="top-bar__bell" onClick={togglePanel}>
          🔔
          {unreadCount > 0 && (
            <span className="top-bar__bell-badge">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
