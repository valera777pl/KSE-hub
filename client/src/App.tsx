import { useEffect, useState } from 'react';
import { useLang } from './lib/i18n';
import { useAuthStore } from './stores/authStore';
import { applyStartParam, useUi } from './stores/uiStore';
import { initTelegram, haptic, startParam } from './lib/telegram';
import { canSignIn, onAuthLost, track } from './api/client';
import { clearCache } from './lib/cache';
import { ErrorState, SignInLost } from './components/ui/States';
import { TabBar } from './components/layout/TabBar';
import { ProfilePage } from './components/layout/ProfilePage';
import { Onboarding } from './components/layout/Onboarding';
import { TodayPage } from './components/modules/today/TodayPage';
import { StudyPage } from './components/modules/study/StudyPage';
import { RoomsPage } from './components/modules/rooms/RoomsPage';
import { OpportunitiesPage } from './components/modules/opportunities/OpportunitiesPage';
import type { TabId } from './types';

export default function App() {
  const { fetchUser, user, loading, error } = useAuthStore();
  // Opened from a plain link or a reply keyboard there is no initData at all; no point asking the server
  const [signInLost, setSignInLost] = useState(() => !canSignIn());
  const { tab, setTab, profileOpen, closeProfile } = useUi();
  const { lang, setLang } = useLang();

  useEffect(() => {
    initTelegram();
    if (signInLost) return;
    // Someone else used this phone before: their cached screens go
    clearCache(true);
    const off = onAuthLost(() => setSignInLost(true));
    applyStartParam(startParam());
    fetchUser();
    track('app.open');
    return off;
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
  if (signInLost) return <div className="shell"><main className="shell__main"><SignInLost /></main></div>;
  if (loading) return <div className="shell" />;
  if (!user) {
    return <div className="shell"><main className="shell__main"><div className="screen screen--center"><ErrorState error={error} onRetry={fetchUser} /></div></main></div>;
  }

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
