import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n/config';
import './index.css';
import { useAuthStore } from './stores/authStore';
import { useNotificationStore } from './stores/notificationStore';
import { useThemeStore } from './stores/themeStore';
import { TopBar } from './components/layout/TopBar';
import { BottomNav } from './components/layout/BottomNav';
import { ProfileDrawer } from './components/layout/ProfileDrawer';
import { Onboarding } from './components/layout/Onboarding';
import { track } from './api/client';
import { NotificationPanel } from './components/layout/NotificationPanel';
import { RoomsPage } from './components/modules/rooms/RoomsPage';
import { MoodlePage } from './components/modules/moodle/MoodlePage';
import { SchedulePage } from './components/modules/schedule/SchedulePage';
import { VenturePage } from './components/modules/venture/VenturePage';
import { CareersPage } from './components/modules/careers/CareersPage';
import { CopilotPage } from './components/modules/copilot/CopilotPage';
import type { TabId } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('rooms');
  const [profileOpen, setProfileOpen] = useState(false);
  const { fetchUser, user, loading } = useAuthStore();
  const { fetchNotifications } = useNotificationStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    fetchUser();
    fetchNotifications();
    track('app.open');

    // Apply theme from store
    document.documentElement.setAttribute('data-theme', useThemeStore.getState().theme);

    // Apply Telegram theme
    try {
      // @ts-ignore
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
      }
    } catch {
      // Not in Telegram context
    }
  }, []);

  // Sync language preference
  useEffect(() => {
    if (user?.languagePref) {
      i18n.changeLanguage(user.languagePref);
    }
  }, [user?.languagePref]);

  const handleHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
    try {
      // @ts-ignore
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
    } catch {
      // Not in Telegram
    }
  };

  const handleTabChange = (tab: TabId) => {
    handleHaptic('light');
    setActiveTab(tab);
    track(`tab.${tab}`);
  };

  const renderPage = () => {
    switch (activeTab) {
      case 'rooms': return <RoomsPage />;
      case 'schedule': return <SchedulePage />;
      case 'moodle': return <MoodlePage />;
      case 'venture': return <VenturePage />;
      case 'careers': return <CareersPage />;
      case 'copilot': return <CopilotPage />;
    }
  };

  if (loading) {
    return (
      <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎓</div>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>KSE Hub</div>
          <div style={{ fontSize: '12px', color: 'var(--tg-hint)', marginTop: '8px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Sign-up first: nothing else opens until the KSE mail is connected
  if (user && !user.onboardedAt) {
    return (
      <div className="app-layout">
        <main className="app-content" style={{ paddingBottom: 24 }}>
          <Onboarding />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <TopBar
        user={user}
        onProfileClick={() => { handleHaptic('medium'); setProfileOpen(true); }}
      />

      <main className="app-content">
        {renderPage()}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      {profileOpen && (
        <ProfileDrawer onClose={() => setProfileOpen(false)} />
      )}

      <NotificationPanel />
    </div>
  );
}
