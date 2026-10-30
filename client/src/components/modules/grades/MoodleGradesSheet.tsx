import { useEffect, useState } from 'react';
import { ChevronDown, GraduationCap } from 'lucide-react';
import { api, errorText } from '../../../api/client';
import { tr } from '../../../lib/i18n';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { Sheet } from '../../ui/Sheet';
import { EmptyState } from '../../ui/States';

type Course = { courseId: number; code: string | null; name: string; grade: string | null };
type Item = { id: number; name: string; grade: string | null; percent: string | null; feedback: string | null; gradedAt: string | null };

const looksLikeLink = (s: string) => /token=[A-Za-z0-9+/=_-]{20,}/.test(s);

/**
 * Профіль → «Оцінки з Moodle» — an owner-only test. Moodle's own app sign-in page gives the student their token
 * after the Google sign-in; they copy its «open in the app» link here. Read-only: courses and grades.
 * Not for students until KSE IT agrees.
 */
export function MoodleGradesSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ connected: boolean; courses: Course[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ connected: boolean; courses: Course[] }>('/moodle/grades')
    .then((r) => { setState(r); setError(null); })
    .catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);

  return (
    <Sheet onClose={onClose} label={tr('Оцінки з Moodle', 'Moodle grades')}>
      <div className="sheet__title">{tr('Оцінки з Moodle', 'Moodle grades')}</div>
      <div className="sheet__sub">{tr('Тест: бачиш лише ти. Перед тим як відкрити всім, питаємо ІТ KSE.', 'Test: only you see it. Before opening it to everyone we ask KSE IT.')}</div>
      {!state && !error && <div className="group" aria-busy="true" style={{ marginTop: 16 }}><div className="row"><div className="skel" style={{ height: 16, width: '55%' }} /></div><div className="row"><div className="skel" style={{ height: 16, width: '40%' }} /></div></div>}
      {error && !state && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {state && !state.connected && <Connect onDone={load} />}
      {state?.connected && <Grades courses={state.courses} onDisconnect={async () => {
        haptic.select();
        await api.delete('/moodle/grades').catch(() => {});
        load();
      }} />}
    </Sheet>
  );
}

function Connect({ onDone }: { onDone: () => void }) {
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
          : tr('KSE Hub лише читає курси й оцінки, зберігає доступ зашифрованим і видаляє його, коли відключиш.', 'KSE Hub only reads courses and grades, keeps the access encrypted and deletes it when you disconnect.'))}
      </p>
    </>
  );
}

function Grades({ courses, onDisconnect }: { courses: Course[]; onDisconnect: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [items, setItems] = useState<Record<number, { total: string | null; items: Item[] } | 'error'>>({});

  const toggle = async (id: number) => {
    haptic.select();
    setOpen(open === id ? null : id);
    if (items[id]) return;
    try {
      const r = await api.get<{ total: string | null; items: Item[] }>(`/moodle/grades/${id}`);
      setItems((m) => ({ ...m, [id]: r }));
    } catch { setItems((m) => ({ ...m, [id]: 'error' })); }
  };

  if (!courses.length) return <EmptyState icon={GraduationCap} title={tr('Курсів не знайшли', 'No courses found')} text={tr('Moodle не показав жодного курсу для тебе.', 'Moodle showed no courses for you.')} />;
  return (
    <>
      <div className="group grades" style={{ marginTop: 16 }}>
        {courses.map((c) => {
          const detail = items[c.courseId];
          return (
            <div key={c.courseId} className="grades__course">
              <button className="row press" aria-expanded={open === c.courseId} onClick={() => toggle(c.courseId)}>
                <div className="row__main">
                  <div className="row__title clamp2" style={{ fontWeight: 500 }}>{c.code ?? c.name}</div>
                  {c.code && <div className="row__meta clamp2">{c.name}</div>}
                </div>
                <span className={`row__value num${c.grade ? '' : ' grades__none'}`}>{c.grade ?? '—'}</span>
                <ChevronDown className="chev grades__chev" strokeWidth={1.75} aria-hidden />
              </button>
              {open === c.courseId && (
                <div className="grades__items">
                  {!detail && <div className="skel" style={{ height: 14, width: '60%', margin: '6px 0' }} />}
                  {detail === 'error' && <p className="note">{tr('Moodle не відповів. Спробуй ще раз.', 'Moodle didn\'t answer. Try again.')}</p>}
                  {detail && detail !== 'error' && (detail.items.length ? detail.items.map((i) => (
                    <div key={i.id} className="grades__item">
                      <span className="grades__name">{i.name}</span>
                      <span className="grades__grade num">{i.grade ?? '—'}{i.percent && i.grade ? <small> · {i.percent}</small> : null}</span>
                      {i.feedback && <p className="grades__feedback">{i.feedback}</p>}
                    </div>
                  )) : <p className="note">{tr('Оцінок ще немає.', 'No grades yet.')}</p>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="link-btn" style={{ color: 'var(--danger)', display: 'block', margin: '8px auto 0', minHeight: 44 }} onClick={onDisconnect}>{tr('Відключити оцінки', 'Disconnect grades')}</button>
    </>
  );
}
