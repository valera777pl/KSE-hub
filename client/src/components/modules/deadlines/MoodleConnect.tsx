import { useEffect, useState } from 'react';
import { api, track } from '../../../api/client';
import { useAuthStore } from '../../../stores/authStore';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { tr } from '../../../lib/i18n';

const EXPORT_PAGE = 'https://teaching.kse.org.ua/calendar/export.php';
const isMoodleUrl = (s: string) => /^https:\/\/teaching\.kse\.org\.ua\/calendar\/export_execute\.php\?/.test(s.trim());

/**
 * Three steps on Moodle's export page, then paste the link. When the student comes
 * back from Moodle with the link copied, we fill the field ourselves.
 */
export function MoodleConnectForm({ onSaved, skip }: { onSaved: () => void; skip?: () => void }) {
  const updateUser = useAuthStore((s) => s.updateUser);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onBack = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const text = await navigator.clipboard.readText();
        if (isMoodleUrl(text)) setUrl(text.trim());
      } catch { /* clipboard closed to us — the field is still there */ }
    };
    document.addEventListener('visibilitychange', onBack);
    return () => document.removeEventListener('visibilitychange', onBack);
  }, []);

  const valid = isMoodleUrl(url);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await updateUser({ calendarUrl: url.trim() });
      await api.post('/moodle/sync', { calendarUrl: url.trim() });
      track('moodle.connected');
      haptic.success();
      onSaved();
    } catch (e) {
      haptic.error();
      setError((e as Error).message || tr('Не вдалося зберегти. Перевір посилання.', 'Couldn\'t save. Check the link.'));
    } finally {
      setSaving(false);
    }
  };

  // Until there's a link, the main action is the first step: go get it
  useMainButton({ text: valid ? tr('Зберегти', 'Save') : tr('Відкрити Moodle', 'Open Moodle'), onClick: valid ? save : () => openExternal(EXPORT_PAGE), loading: saving });

  return (
    <>
      <ol className="group steps">
        <li className="row">
          <span className="steps__n">1</span>
          <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Відкрий експорт календаря в Moodle', 'Open calendar export in Moodle')}</div></div>
        </li>
        <li className="row"><span className="steps__n">2</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Обери «Усі події» і «Останні та наступні 60 днів»', 'Pick “All events” and “Recent and next 60 days”')}</div></div></li>
        <li className="row"><span className="steps__n">3</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('«Отримати URL календаря» — скопіюй посилання', '“Get calendar URL”, then copy the link')}</div></div></li>
      </ol>
      <input className="field" style={{ marginTop: 12 }} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url"
        placeholder="https://teaching.kse.org.ua/calendar/export_execute.php?…" aria-invalid={!!url && !valid} />
      <p className="note" style={{ color: error || (url && !valid) ? 'var(--danger)' : undefined }}>
        {error ?? (url && !valid ? tr('Це не посилання експорту Moodle. Воно починається з teaching.kse.org.ua/calendar/export_execute.php', 'That\'s not a Moodle export link. It starts with teaching.kse.org.ua/calendar/export_execute.php') : tr('Повернешся з Moodle зі скопійованим посиланням — вставимо його самі.', 'Come back from Moodle with the link copied and we\'ll paste it for you.'))}
      </p>
      {skip && <button className="btn-plain press" style={{ marginTop: 8, background: 'transparent' }} onClick={skip}>{tr('Пропустити', 'Skip')}</button>}
    </>
  );
}
