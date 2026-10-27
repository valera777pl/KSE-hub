import { useEffect } from 'react';
import { useLang } from './lib/i18n';
import { useAuthStore } from './stores/authStore';
import { applyStartParam, useUi } from './stores/uiStore';
import { initTelegram, haptic, startParam } from './lib/telegram';
import { track } from './api/client';
import { TabBar } from './components/layout/TabBar';
import { ProfilePage } from './components/layout/ProfilePage';
import { Onboarding } from './components/layout/Onboarding';
import { TodayPage } from './components/modules/today/TodayPage';
import { StudyPage } from './components/modules/study/StudyPage';
import { RoomsPage } from './components/modules/rooms/RoomsPage';
import { OpportunitiesPage } from './components/modules/opportunities/OpportunitiesPage';
import type { TabId } from './types';

export default function App() {
  const { fetchUser, user, loading } = useAuthStore();
  const { tab, setTab, profileOpen, closeProfile } = useUi();
  const { lang, setLang } = useLang();

  useEffect(() => {
    initTelegram();
    applyStartParam(startParam());
    fetchUser();
    track('app.open');
  }, []);

  useEffect(() => {
    if (!user?.languagePref) return;
    setLang(user.languagePref);
  }, [user?.languagePref]);

  const changeTab = (next: TabId) => {
    haptic.select();
    setTab(next);
    track(`tab.${next}`);
  };

  // Telegram shows its own loader while we fetch the profile; an empty screen in the theme colour is calmer than a splash
  if (loading) return <div className="shell" />;

  // Sign-up first: nothing else opens until the KSE mail is connected
  if (user && !user.onboardedAt) {
    return (
      <div className="shell">
        <main className="shell__main" key={lang}><Onboarding /></main>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Keyed by language too: every screen re-reads its strings when the student switches */}
      <main className="shell__main" key={`${tab}-${lang}`}>
        {tab === 'today' && <TodayPage />}
        {tab === 'study' && <StudyPage />}
        {tab === 'rooms' && <RoomsPage />}
        {tab === 'opps' && <OpportunitiesPage />}
      </main>
      <TabBar key={`tabs-${lang}`} active={tab} onChange={changeTab} />
      {profileOpen && <ProfilePage key={`profile-${lang}`} onClose={closeProfile} />}
    </div>
  );
}
