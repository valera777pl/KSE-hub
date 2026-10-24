import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../api/client';
import type { DigestSource, GoogleStatus } from '../../types';

const SOURCES: { id: DigestSource; label: string }[] = [
  { id: 'moodle', label: '📚 Moodle' },
  { id: 'gmail', label: '📧 Пошта' },
  { id: 'slack', label: '💬 Slack' },
];
const HOURS = [8, 13, 20];

const hint = {
  marginTop: '8px',
  padding: '10px 12px',
  background: 'var(--tg-secondary-bg)',
  borderRadius: '8px',
  fontSize: '12px',
  lineHeight: '1.45',
  color: 'var(--tg-hint)',
} as const;

function tg(): any {
  // @ts-ignore - Telegram WebApp SDK
  return window.Telegram?.WebApp;
}

/** Google refuses OAuth inside embedded webviews, so the login opens in the real browser. */
function openExternal(url: string) {
  if (tg()?.openLink) tg().openLink(url);
  else window.open(url, '_blank');
}

function confirmAction(text: string): Promise<boolean> {
  if (tg()?.showConfirm) return new Promise((resolve) => tg().showConfirm(text, resolve));
  return Promise.resolve(window.confirm(text));
}

/** Everything the Telegram bot does for the student is configured here. */
export function BotSettings() {
  const { user, updateUser } = useAuthStore();
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGoogle = useCallback(async () => {
    try {
      setGoogle(await api.get<GoogleStatus>('/google/status'));
    } catch {
      setGoogle(null);
    }
  }, []);

  useEffect(() => {
    loadGoogle();
    // The student comes back from the browser after the Google login
    const onVisible = () => document.visibilityState === 'visible' && loadGoogle();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadGoogle]);

  if (!user) return null;

  const save = async (patch: Parameters<typeof updateUser>[0]) => {
    setError(null);
    try {
      await updateUser(patch);
    } catch (err: any) {
      setError(err.message || 'Не вдалося зберегти');
    }
  };

  const toggleSource = (source: DigestSource) => {
    const current = user.digestSources ?? [];
    const next = current.includes(source) ? current.filter((s) => s !== source) : [...current, source];
    save({ digestSources: next });
  };

  const connectGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>('/google/connect');
      openExternal(url);
    } catch (err: any) {
      setError(err.message || 'Не вдалося почати вхід через Google');
    } finally {
      setBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!(await confirmAction('Відключити пошту? Нові листи перестануть потрапляти в дайджест.'))) return;
    await api.delete('/google');
    loadGoogle();
  };

  const deleteData = async () => {
    const ok = await confirmAction(
      'Видалити всі твої дані з KSE Hub? Підключення пошти й Moodle, листи, дедлайни, історія чату з ІІ і профіль VentureMatch зникнуть назавжди.'
    );
    if (!ok) return;
    await api.delete('/users/me');
    if (tg()?.close) tg().close();
    else window.location.reload();
  };

  return (
    <>
      {error && (
        <div style={{ background: 'rgba(255, 69, 58, 0.15)', color: 'var(--danger)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
          ❌ {error}
        </div>
      )}

      {/* Digest */}
      <div className="profile-section">
        <h3 className="profile-section__title">🔔 Дайджест у боті</h3>
        <div className="tabs" style={{ marginBottom: '8px' }}>
          {SOURCES.map(({ id, label }) => (
            <button
              key={id}
              className={`tab ${user.digestSources?.includes(id) ? 'tab--active' : ''}`}
              style={{ whiteSpace: 'nowrap', padding: '10px 6px' }}
              onClick={() => toggleSource(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tabs">
          {HOURS.map((hour) => (
            <button
              key={hour}
              className={`tab ${user.digestHour === hour ? 'tab--active' : ''}`}
              onClick={() => save({ digestHour: hour })}
            >
              {String(hour).padStart(2, '0')}:00
            </button>
          ))}
          <button
            className={`tab ${user.digestHour < 0 ? 'tab--active' : ''}`}
            onClick={() => save({ digestHour: -1 })}
          >
            Вимк.
          </button>
        </div>
        <div style={hint}>
          Дайджест приходить щодня в обраний час окремими розділами по кожному джерелу. Нагадування про дедлайни (за 24 год і за 3 год) і термінові листи — одразу.
        </div>
      </div>

      {/* KSE mail */}
      <div className="profile-section">
        <h3 className="profile-section__title">📧 Пошта @kse.org.ua</h3>
        {google?.connected && !google.needsReconnect ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
            <span className="text-sm">✅ {google.email}</span>
            <button className="btn btn--secondary btn--small" onClick={disconnectGoogle}>Відключити</button>
          </div>
        ) : (
          <button className="btn btn--primary btn--full" onClick={connectGoogle} disabled={busy}>
            {busy ? '...' : google?.needsReconnect ? '⚠️ Підключити знову' : 'Підключити пошту'}
          </button>
        )}
        <div style={hint}>
          Лише читання листів і календаря. Однакові розсилки ми стискаємо один раз для всіх, тож у дайджесті — по 1–2 речення на лист.
        </div>
      </div>

      {/* Schedule visibility */}
      <div className="profile-section">
        <h3 className="profile-section__title">🗓 Мій розклад</h3>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={`tab ${user.scheduleVisible ? 'tab--active' : ''}`} onClick={() => save({ scheduleVisible: true })}>
            Видно студентам
          </button>
          <button className={`tab ${!user.scheduleVisible ? 'tab--active' : ''}`} onClick={() => save({ scheduleVisible: false })}>
            Приховано
          </button>
        </div>
        <div style={hint}>
          Інші студенти KSE Hub можуть знайти тебе за прізвищем і побачити твій розклад на тиждень зі спільними парами. Якщо приховати — тебе не буде в пошуку.
        </div>
      </div>

      {/* Schedule notifications */}
      <div className="profile-section">
        <h3 className="profile-section__title">⏰ Сповіщення про пари</h3>
        {([
          ['notifyScheduleChanges', 'Пару перенесли чи скасували'],
          ['classReminders', 'Пара через 15 хвилин'],
        ] as const).map(([field, label]) => (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span className="text-sm" style={{ flex: 1 }}>{label}</span>
            <div className="tabs" style={{ marginBottom: 0, width: '140px' }}>
              <button className={`tab ${user[field] ? 'tab--active' : ''}`} onClick={() => save({ [field]: true })}>Так</button>
              <button className={`tab ${!user[field] ? 'tab--active' : ''}`} onClick={() => save({ [field]: false })}>Ні</button>
            </div>
          </div>
        ))}
        <div style={hint}>
          Про перенесення приходить одне коротке повідомлення замість листів від KSE Hub Worker. Нагадування «через 15 хвилин» — з аудиторією.
        </div>
      </div>

      {/* Slack */}
      <div className="profile-section">
        <h3 className="profile-section__title">💬 Slack</h3>
        <div style={{ ...hint, marginTop: 0 }}>
          Повноцінні дайджести каналів Slack зʼявляться, коли ІТ KSE дозволить додати бота KSE Hub у робочий простір. Поки що в розділ 💬 потрапляють лише листи-сповіщення від Slack, якщо вони приходять тобі на пошту.
        </div>
      </div>

      {/* Danger zone */}
      <div className="profile-section">
        <h3 className="profile-section__title">🗑 Мої дані</h3>
        <button className="btn btn--danger btn--full" onClick={deleteData}>
          Видалити мої дані з KSE Hub
        </button>
      </div>
    </>
  );
}
