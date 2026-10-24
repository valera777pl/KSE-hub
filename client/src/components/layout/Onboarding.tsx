import { useCallback, useEffect, useState } from 'react';
import { api, track } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import type { GoogleStatus } from '../../types';

function openExternal(url: string) {
  // @ts-ignore - Telegram WebApp SDK
  const tg = window.Telegram?.WebApp;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

const hint = { fontSize: '13px', lineHeight: 1.5, color: 'var(--tg-hint)', margin: '6px 0 12px' } as const;

function Step({ n, title, done, optional, children }: { n: number; title: string; done?: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '16px', marginBottom: '12px', ...(done ? { borderColor: 'var(--accent-lime-border)' } : {}) }}>
      <div className="font-semibold" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span>{done ? '✅' : `${n}.`}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {optional && !done && <span className="text-sm text-hint">необовʼязково</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * First run: the mini app and the bot open up only after the student connects
 * their KSE mail. Schedule, Moodle and programme can be done now or later.
 */
export function Onboarding() {
  const { user, fetchUser, updateUser } = useAuthStore();
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [courses, setCourses] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState(user?.calendarUrl ?? '');
  const [moodleSaved, setMoodleSaved] = useState(!!user?.calendarUrl);
  const [faculty, setFaculty] = useState(user?.faculty ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGoogle = useCallback(() => api.get<GoogleStatus>('/google/status').then(setGoogle).catch(() => setGoogle(null)), []);

  useEffect(() => {
    loadGoogle();
    // Back from the Google login in the browser
    const onVisible = () => document.visibilityState === 'visible' && loadGoogle();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadGoogle]);

  const mailOk = !!google?.connected && !google.needsReconnect;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message || 'Щось пішло не так');
    } finally {
      setBusy(false);
    }
  };

  const connectMail = () => run(async () => {
    track('onboarding.step.mail');
    const { url } = await api.get<{ url: string }>('/google/connect');
    openExternal(url);
  });

  const checkSchedule = async () => {
    setChecking(true);
    try {
      const { calendars } = await api.post<{ calendars: number }>('/schedule/refresh');
      setCourses(calendars);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const saveMoodle = () => run(async () => {
    track('onboarding.step.moodle');
    await updateUser({ calendarUrl: calendarUrl.trim() });
    await api.post('/moodle/sync', { calendarUrl: calendarUrl.trim() });
    setMoodleSaved(true);
  });

  const finish = () => run(async () => {
    if (faculty.trim() && faculty.trim() !== user?.faculty) await updateUser({ faculty: faculty.trim() });
    await api.post('/users/me/onboarding');
    await fetchUser();
  });

  return (
    <div className="page" style={{ paddingBottom: '40px' }}>
      <div style={{ fontSize: '40px' }}>🎓</div>
      <h1 className="section-header__title" style={{ margin: '4px 0' }}>Вітаємо в KSE Hub</h1>
      <p className="text-hint" style={{ marginBottom: '16px' }}>
        Кілька кроків — і бот почне надсилати дайджести, нагадування про дедлайни та відповідати на питання.
      </p>

      {error && (
        <div style={{ background: 'rgba(255, 69, 58, 0.15)', color: 'var(--danger)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' }}>
          ❌ {error}
        </div>
      )}

      <Step n={1} title="Пошта @kse.org.ua" done={mailOk}>
        {mailOk ? (
          <div className="text-sm text-hint" style={{ marginTop: '6px' }}>{google!.email}</div>
        ) : (
          <>
            <div style={hint}>Через неї приходять дайджести листів, а ще підтягується твій розклад. Лише читання — ми нічого не надсилаємо від твого імені.</div>
            <button className="btn btn--primary btn--full" onClick={connectMail} disabled={busy}>
              {google?.needsReconnect ? 'Підключити знову' : 'Увійти через Google'}
            </button>
          </>
        )}
      </Step>

      <Step n={2} title="Розклад пар" done={!!courses} optional>
        <div style={hint}>
          На schedule.kse.ua натисни на своє імʼя вгорі справа → <b>Sync with Google Calendar</b>. Потім «Перевірити» — пари зʼявляться у вкладці «Розклад».
        </div>
        {courses ? (
          <div className="text-sm text-hint">Знайдено курсів: {courses}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn btn--secondary btn--full" onClick={() => { track('onboarding.step.schedule'); openExternal('https://schedule.kse.ua/'); }}>
              Відкрити schedule.kse.ua
            </button>
            <button className="btn btn--secondary btn--full" onClick={checkSchedule} disabled={!mailOk || checking}>
              {checking ? 'Перевіряю…' : 'Перевірити'}
            </button>
          </div>
        )}
        {courses === 0 && <div className="text-sm text-hint" style={{ marginTop: '8px' }}>Поки не бачу курсів — KSE додає їх кілька хвилин. Можна продовжити, вони підтягнуться самі.</div>}
      </Step>

      <Step n={3} title="Дедлайни з Moodle" done={moodleSaved} optional>
        {!moodleSaved && (
          <>
            <div style={hint}>
              1. Відкрий Moodle (teaching.kse.org.ua) → «Календар»<br />
              2. Внизу «Експорт календаря»<br />
              3. Обери «Усі події» і «Останні та наступні 60 днів»<br />
              4. «Отримати URL календаря» → скопіюй і встав сюди
            </div>
            <input
              className="input mb-sm"
              value={calendarUrl}
              onChange={(e) => setCalendarUrl(e.target.value)}
              placeholder="https://teaching.kse.org.ua/calendar/export_execute.php?..."
            />
            <button className="btn btn--secondary btn--full" onClick={saveMoodle} disabled={busy || !calendarUrl.trim()}>Зберегти</button>
          </>
        )}
      </Step>

      <Step n={4} title="Твоя програма" done={false} optional>
        <input className="input" style={{ marginTop: '8px' }} value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="Напр. BE, EBD, SE" />
      </Step>

      <button className="btn btn--primary btn--full" onClick={finish} disabled={!mailOk || busy} style={{ marginTop: '8px' }}>
        {mailOk ? 'Почати 🚀' : 'Спершу підключи пошту'}
      </button>
    </div>
  );
}
