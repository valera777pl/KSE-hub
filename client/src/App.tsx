import { lazy, Suspense, useEffect, useState } from 'react';
import { useLang } from './lib/i18n';
import { useAuthStore } from './stores/authStore';
import { applyStartParam, splitStartParam, useUi } from './stores/uiStore';
import { initTelegram, haptic, startParam } from './lib/telegram';
import { canSignIn, onAuthLost, track } from './api/client';
import { clearCache } from './lib/cache';
import { ErrorState, SignInLost } from './components/ui/States';
import { TabBar } from './components/layout/TabBar';
import { TodayPage } from './components/modules/today/TodayPage';
import { hideSplash } from './lib/splash';

// «Сьогодні» is in the first chunk; the rest load in the background right after it shows
const screens = {
  study: () => import('./components/modules/study/StudyPage'),
  rooms: () => import('./components/modules/rooms/RoomsPage'),
  opps: () => import('./components/modules/opportunities/OpportunitiesPage'),
  profile: () => import('./components/layout/ProfilePage'),
  course: () => import('./components/modules/course/CoursePage'),
  onboarding: () => import('./components/layout/Onboarding'),
};
const StudyPage = lazy(() => screens.study().then((m) => ({ default: m.StudyPage })));
const RoomsPage = lazy(() => screens.rooms().then((m) => ({ default: m.RoomsPage })));
const OpportunitiesPage = lazy(() => screens.opps().then((m) => ({ default: m.OpportunitiesPage })));
const ProfilePage = lazy(() => screens.profile().then((m) => ({ default: m.ProfilePage })));
const CoursePage = lazy(() => screens.course().then((m) => ({ default: m.CoursePage })));
const Onboarding = lazy(() => screens.onboarding().then((m) => ({ default: m.Onboarding })));

/** After the first screen: fetch the other tabs while the student reads, so switching never waits. */
function prefetchScreens() {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));
  idle(() => Object.values(screens).forEach((load) => load().catch(() => {})));
}
import type { TabId } from './types';

export default function App() {
  const { fetchUser, user, loading, error } = useAuthStore();
  // Opened from a plain link or a reply keyboard there is no initData at all; no point asking the server
  const [signInLost, setSignInLost] = useState(() => !canSignIn());
  const { tab, setTab, profileOpen, closeProfile, courseCode, closeCourse } = useUi();
  const { lang, setLang } = useLang();

  useEffect(() => {
    initTelegram();
    if (signInLost) return;
    // Someone else used this phone before: their cached screens go
    clearCache(true);
    const off = onAuthLost(() => setSignInLost(true));
    const start = splitStartParam(startParam());
    applyStartParam(start.param);
    fetchUser();
    track('app.open', { start_param: start.kind ?? 'none', tab: useUi.getState().tab });
    if (start.push) track('push.open', { type: start.push });
    return off;
  }, []);

  // One view per screen the student actually sees: tabs and their sub-screens
  const screen = useUi((s) => (s.tab === 'study' ? s.studyView : s.tab === 'opps' ? s.oppsView : s.tab));
  const onboarded = !!user?.onboardedAt;
  useEffect(() => {
    if (onboarded) track('tab.view', { tab: screen });
  }, [screen, onboarded]);
  useEffect(() => {
    if (profileOpen) track('tab.view', { tab: 'profile' });
  }, [profileOpen]);

  // The first real screen is on the page: the splash goes, the other screens load quietly
  const ready = signInLost || !loading;
  useEffect(() => {
    if (!ready) return;
    hideSplash();
    prefetchScreens();
  }, [ready]);

  useEffect(() => {
    if (!user?.languagePref) return;
    setLang(user.languagePref);
  }, [user?.languagePref]);

  const changeTab = (next: TabId) => {
    haptic.select();
    setTab(next);
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
        <main className="shell__main" key={lang}><Suspense fallback={null}><Onboarding /></Suspense></main>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Keyed by language too: every screen re-reads its strings when the student switches */}
      <main className="shell__main" key={`${tab}-${lang}`}>
        <Suspense fallback={null}>
          {tab === 'today' && <TodayPage />}
          {tab === 'study' && <StudyPage />}
          {tab === 'rooms' && <RoomsPage />}
          {tab === 'opps' && <OpportunitiesPage />}
        </Suspense>
      </main>
      <TabBar key={`tabs-${lang}`} active={tab} onChange={changeTab} />
      <Suspense fallback={null}>
        {profileOpen && <ProfilePage key={`profile-${lang}`} onClose={closeProfile} />}
        {courseCode && <CoursePage key={`course-${courseCode}-${lang}`} code={courseCode} onClose={closeCourse} />}
      </Suspense>
    </div>
  );
}
