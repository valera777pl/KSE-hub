import { useEffect, useState } from 'react';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { api, errorText } from '../../../api/client';
import { tr } from '../../../lib/i18n';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { Sheet } from '../../ui/Sheet';
import { useUi } from '../../../stores/uiStore';
import { useAuthStore } from '../../../stores/authStore';
import { dayKey, hm, todayKey } from '../../../lib/time';

type Course = { courseId: number; code: string | null; name: string; grade: string | null };
type State = { connected: boolean; courses: Course[]; deadlinesSyncedAt?: string | null };

const looksLikeLink = (s: string) => /token=[A-Za-z0-9+/=_-]{20,}/.test(s);

/**
 * Профіль → «Moodle» — an owner-only test. Moodle's own app sign-in page gives the student their token
 * after the Google sign-in; they copy its «open in the app» link here. Read-only: courses, grades and deadlines
 * (the deadlines replace the calendar link). Not for students until the owner opens it to everyone.
 */
export function MoodleGradesSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<State>('/moodle/grades')
    .then((r) => { setState(r); setError(null); })
    .catch((e) => setError(errorText(e)));
  // Connected or not changes the Profile row and where deadlines come from
  const reload = () => { load(); useAuthStore.getState().fetchUser(); };
  useEffect(() => { load(); }, []);

  return (
    <Sheet onClose={onClose} label="Moodle">
      <div className="sheet__title">Moodle</div>
      <div className="sheet__sub">{tr('Оцінки й дедлайни напряму з Moodle. Тест: бачиш лише ти.', 'Grades and deadlines straight from Moodle. Test: only you see it.')}</div>
      {!state && !error && <div className="group" aria-busy="true" style={{ marginTop: 16 }}><div className="row"><div className="skel" style={{ height: 16, width: '55%' }} /></div><div className="row"><div className="skel" style={{ height: 16, width: '40%' }} /></div></div>}
      {error && !state && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {state && !state.connected && <MoodleSignIn onDone={reload} />}
      {state?.connected && <Connected syncedAt={state.deadlinesSyncedAt ?? null} onClose={onClose} onDisconnect={async () => {
        haptic.select();
        await api.delete('/moodle/grades').catch(() => {});
        reload();
      }} />}
    </Sheet>
  );
}

export function MoodleSignIn({ onDone }: { onDone: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Moodle with the link copied: fill the field ourselves, like the calendar link
  useEffect(() => {
    const onBack = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const text = await navigator.clipboard.readText();
        if (looksLikeLink(text)) setLink(text.trim());
      } catch { /* clipboard closed to us — the field is still there */ }
    };
    document.addEventListener('visibilitychange', onBack);
    return () => document.removeEventListener('visibilitychange', onBack);
  }, []);

  // The server knows this student's sign-in passport itself: nothing to keep while they're in the browser
  const openMoodle = async () => {
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>('/moodle/grades/start');
      openExternal(url);
    } catch (e) { haptic.error(); setError(errorText(e)); }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/moodle/grades/connect', { link: link.trim() });
      haptic.success();
      onDone();
    } catch (e) { haptic.error(); setError(errorText(e)); }
    setBusy(false);
  };

  const ready = looksLikeLink(link);
  useMainButton({ text: ready ? tr('Підключити', 'Connect') : tr('Відкрити Moodle', 'Open Moodle'), onClick: ready ? connect : openMoodle, loading: busy });

  return (
    <>
      <ol className="group steps" style={{ marginTop: 16 }}>
        <li className="row"><span className="steps__n">1</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('«Відкрити Moodle» — увійди через пошту KSE', '“Open Moodle” — sign in with your KSE mail')}</div></div></li>
        <li className="row"><span className="steps__n">2</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Внизу посилання «Натисніть тут, якщо додаток не відкривається…» — не тисни його, а утримуй → «Скопіювати»', 'At the bottom: «Натисніть тут, якщо додаток не відкривається…». Don\'t tap it — press and hold → Copy')}</div></div></li>
        <li className="row"><span className="steps__n">3</span><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Повернись сюди — вставимо самі', 'Come back here — we\'ll paste it')}</div></div></li>
      </ol>
      <input className="field" style={{ marginTop: 12 }} value={link} onChange={(e) => setLink(e.target.value)}
        placeholder="moodlemobile://token=…" aria-label={tr('Посилання з Moodle', 'Link from Moodle')} aria-invalid={!!link && !ready} />
      <p className="note" style={{ color: error || (link && !ready) ? 'var(--danger)' : undefined }}>
        {error ?? (link && !ready
          ? tr('Це не те посилання: воно починається з moodlemobile://token=', 'Not that link: it starts with moodlemobile://token=')
          : tr('KSE Hub лише читає курси, оцінки й дедлайни, зберігає доступ зашифрованим і видаляє його, коли відключиш.', 'KSE Hub only reads courses, grades and deadlines, keeps the access encrypted and deletes it when you disconnect.'))}
      </p>
    </>
  );
}

/** Connected: grades and materials now live in Навчання → Курси; here only the state and the way out. */
function Connected({ syncedAt, onClose, onDisconnect }: { syncedAt: string | null; onClose: () => void; onDisconnect: () => void }) {
  return (
    <>
      <div className="group" style={{ marginTop: 16 }}>
        <button className="row press" onClick={() => { haptic.tap(); onClose(); useUi.setState({ tab: 'study', studyView: 'courses', profileOpen: false }); }}>
          <GraduationCap className="row-icon" strokeWidth={1.7} />
          <div className="row__main">
            <div className="row__title" style={{ fontWeight: 500 }}>{tr('Курси й оцінки', 'Courses and grades')}</div>
            <div className="row__meta">{tr('Навчання → Курси', 'Study → Courses')}</div>
          </div>
          <ChevronRight className="chev" strokeWidth={1.75} />
        </button>
      </div>
      <p className="note num">
        {syncedAt
          ? (dayKey(new Date(syncedAt)) === todayKey()
            ? tr(`Дедлайни оновлено о ${hm(syncedAt)}.`, `Deadlines updated at ${hm(syncedAt)}.`)
            : tr('Дедлайни оновлюються кожні 15 хв.', 'Deadlines update every 15 min.'))
          : tr('Дедлайни зʼявляться за кілька хвилин.', 'Deadlines will show up in a few minutes.')}
      </p>
      <button className="link-btn" style={{ color: 'var(--danger)', display: 'block', margin: '8px auto 0', minHeight: 44 }} onClick={onDisconnect}>{tr('Відключити Moodle', 'Disconnect Moodle')}</button>
    </>
  );
}
