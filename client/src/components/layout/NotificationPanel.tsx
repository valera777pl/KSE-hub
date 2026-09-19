import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../../stores/notificationStore';

export function NotificationPanel() {
  const { t } = useTranslation();
  const { notifications, panelOpen, closePanel, markRead, markAllRead, unreadCount } = useNotificationStore();

  if (!panelOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'deadline': return '📚';
      case 'match': return '🤝';
      case 'booking_expiry': return '🏠';
      case 'system': return '⚙️';
      default: return '🔔';
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  return (
    <>
      <div className="drawer-overlay" onClick={closePanel} />
      <aside className="drawer">
        <div className="drawer__header">
          <h2 className="drawer__title">{t('notifications.title')}</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {unreadCount > 0 && (
              <button className="btn btn--ghost btn--small" onClick={markAllRead}>
                {t('notifications.markAllRead')}
              </button>
            )}
            <button className="btn btn--ghost btn--small" onClick={closePanel}>✕</button>
          </div>
        </div>

        <div className="drawer__content">
          {notifications.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🔔</div>
              <div className="empty-state__title">{t('notifications.empty')}</div>
              <div className="empty-state__text">{t('notifications.emptyDesc')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  className="card"
                  onClick={() => !notif.isRead && markRead(notif.id)}
                  style={{
                    textAlign: 'left',
                    opacity: notif.isRead ? 0.6 : 1,
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '20px' }}>{getIcon(notif.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{notif.title}</span>
                        <span className="text-sm text-hint">{formatTime(notif.createdAt)}</span>
                      </div>
                      {notif.message && (
                        <p className="text-sm text-hint" style={{ marginTop: '4px' }}>
                          {notif.message}
                        </p>
                      )}
                    </div>
                    {!notif.isRead && (
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: 'var(--kse-primary)',
                          flexShrink: 0,
                          marginTop: '6px',
                        }}
                      />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
