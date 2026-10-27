import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, track } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import type { ClassEvent, GoogleStatus } from '../../types';
import { addDays, dayKey, dayTitle, hm, mondayOf, now, todayKey } from '../../lib/time';
import { shortPlace } from '../../lib/place';
import { cloud, haptic, openExternal, useBackButton, useMainButton } from '../../lib/telegram';
import { MoodleConnectForm } from '../modules/deadlines/MoodleConnect';

const STEPS = ['mail', 'synced', 'program', 'digest', 'moodle', 'visibility'] as const;
type Step = (typeof STEPS)[number];
const STEP_KEY = 'onboarding_step';
const AUTO_ADVANCE_MS = 200;

const PROGRAMS = [
  { id: 'BE', title: 'Business Economics' },
  { id: 'EBD', title: 'Economics and Big Data' },
];
const DIGEST = [
  { hour: 8, title: 'Зранку, 08:00' },
  { hour: 13, title: 'В обід, 13:00' },
  { hour: 20, title: 'Увечері, 20:00' },
  { hour: -1, title: 'Не надсилати' },
];

/** Course titles carry their programmes, e.g. "… (BE, EBD)". Whichever appears alone more often is the guess. */
function guessProgram(events: ClassEvent[]): string | null {
  const score: Record<string, number> = { BE: 0, EBD: 0 };
  for (const title of new Set(events.map((e) => e.title))) {
    const tags = title.match(/\(([^)]*)\)\s*$/)?.[1].split(/[,\s]+/) ?? [];
    const hits = tags.filter((t) => t in score);
    if (hits.length === 1) score[hits[0]]++;
  }
  if (score.BE === score.EBD) return null;
  return score.BE > score.EBD ? 'BE' : 'EBD';
}

/**
 * First run, one question per screen. Mail is required (everything else is built on it),
 * the rest is one tap each or skippable. Closing midway resumes at the same step.
 */
export function Onboarding() {
  const { user, fetchUser, updateUser } = useAuthStore();
  const [step, setStep] = useState<Step | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [events, setEvents] = useState<ClassEvent[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const loadGoogle = useCallback(() => api.get<GoogleStatus>('/google/status').then(setGoogle).catch(() => setGoogle(null)), []);
  const mailOk = !!google?.connected && !google.needsReconnect;

  useEffect(() => {
    cloud.get(STEP_KEY).then((saved) => setStep(STEPS.includes(saved as Step) ? (saved as Step) : 'mail'));
    loadGoogle();
    // Back from Google sign-in in the browser
    const onVisible = () => document.visibilityState === 'visible' && loadGoogle();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadGoogle]);

  // Mail just got connected: move on to the "here's your schedule" moment by ourselves
  useEffect(() => { if (mailOk && step === 'mail') go('synced'); }, [mailOk, step]);

  const loadSchedule = useCallback(async () => {
    const mon = mondayOf(todayKey());
    const weeks = await Promise.all([mon, addDays(mon, 7)].map((m) =>
      api.get<{ synced: boolean; events: ClassEvent[] }>(`/schedule/week?start=${m}`).catch(() => ({ synced: false, events: [] as ClassEvent[] }))));
    setSynced(weeks.some((w) => w.synced));
    setEvents(weeks.flatMap((w) => w.events));
  }, []);
  useEffect(() => { if (mailOk) loadSchedule(); }, [mailOk, loadSchedule]);

  const go = (next: Step) => {
    setStep(next);
    cloud.set(STEP_KEY, next);
    track(`onboarding.step.${next}`);
  };
  const index = step ? STEPS.indexOf(step) : 0;
  const next = () => (index < STEPS.length - 1 ? go(STEPS[index + 1]) : finish());

  const finish = async () => {
    setFinishing(true);
    try {
      await api.post('/users/me/onboarding');
      cloud.set(STEP_KEY, '');
      haptic.success();
      await fetchUser();
    } catch {
      haptic.error();
      setFinishing(false);
    }
  };

  /** One-tap answer: highlight, save, move on. */
  const answer = (save: () => Promise<unknown>) => {
    haptic.select();
    save().catch(() => {});
    setTimeout(next, AUTO_ADVANCE_MS);
  };

  useBackButton(index > 0 && step !== 'synced' ? () => go(STEPS[index - 1]) : null);

  if (!step) return <div className="onb" />;

  return (
    <div className="onb">
      <div className="onb__progress" aria-hidden="true"><i style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="onb__body" key={step}>
        {step === 'mail' && <MailStep google={google} />}
        {step === 'synced' && <SyncedStep email={google?.email ?? null} events={events} synced={synced} onRecheck={loadSchedule} onNext={next} />}
        {step === 'program' && (
          <Question title="Твоя програма" sub={guessProgram(events ?? []) ? 'Підказали за твоїми курсами. Так стажування й гранти будуть саме для тебе.' : 'Так стажування й гранти будуть саме для твоєї програми.'}
            options={PROGRAMS.map((p) => ({ key: p.id, title: p.title, sub: p.id }))}
            value={user?.faculty && PROGRAMS.some((p) => p.id === user.faculty) ? user.faculty : guessProgram(events ?? [])}
            onPick={(id) => answer(() => updateUser({ faculty: id }))} />
        )}
        {step === 'digest' && (
          <Question title="Коли надсилати дайджест?" sub="Пари, дедлайни й важливі листи одним повідомленням."
            options={DIGEST.map((d) => ({ key: String(d.hour), title: d.title }))}
            value={user ? String(user.digestHour) : null}
            onPick={(h) => answer(() => updateUser({ digestHour: Number(h) }))}
            note="Нагадування про дедлайни й перенесення пар приходять одразу, незалежно від цього." />
        )}
        {step === 'moodle' && (
          <>
            <h1 className="onb__title">Додай дедлайни з Moodle</h1>
            <p className="onb__sub">Хвилина — і бот нагадає про кожну здачу за 24 і за 3 години.</p>
            <MoodleConnectForm onSaved={next} skip={() => { track('onboarding.skip.moodle'); next(); }} />
          </>
        )}
        {step === 'visibility' && (
          <Question title="Показувати твій розклад одногрупникам?" sub="Тоді друзі побачать ваші спільні пари."
            options={[
              { key: 'show', title: 'Показувати', sub: 'Тебе можна знайти за прізвищем' },
              { key: 'hide', title: 'Приховати', sub: 'Змінити можна в профілі' },
            ]}
            value={user ? (user.scheduleVisible ? 'show' : 'hide') : null}
            disabled={finishing}
            onPick={(v) => answer(() => updateUser({ scheduleVisible: v === 'show' }))} />
        )}
      </div>
    </div>
  );
}

function MailStep({ google }: { google: GoogleStatus | null }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>('/google/connect');
      track('onboarding.step.auth');
      setWaiting(true);
      openExternal(url);
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
    }
  };

  useMainButton({ text: google?.needsReconnect ? 'Підключити знову' : 'Увійти через Google', onClick: connect });

  return (
    <>
      <div className="connect" aria-hidden="true">
        <span className="connect__mark connect__mark--kse">KSE</span>
        <span className="connect__dash" />
        <span className="connect__mark connect__mark--g">G</span>
      </div>
      <h1 className="onb__title">Увійди через пошту KSE</h1>
      <p className="onb__sub">Потрібна адреса @kse.org.ua. З неї підтягнемо розклад і листи.</p>
      <div className="group">
        <div className="row"><CalendarDays className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>Твій розклад і перенесення пар</div></div></div>
        <div className="row"><Mail className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>Важливі листи коротко, раз на день</div></div></div>
        <div className="row"><ShieldCheck className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>Лише читання</div><div className="row__meta">Нічого не надсилаємо від твого імені</div></div></div>
      </div>
      {google?.needsReconnect && <p className="note" style={{ color: 'var(--danger)' }}>Google відкликав доступ. Увійди ще раз тією ж поштою.</p>}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {waiting && !error && <p className="note">Після входу повернись сюди — продовжимо самі.</p>}
    </>
  );
}

/** The payoff right after sign-in: your actual next class. */
function SyncedStep({ email, events, synced, onRecheck, onNext }: {
  email: string | null; events: ClassEvent[] | null; synced: boolean; onRecheck: () => Promise<void>; onNext: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const t = now().getTime();
  const nextClass = useMemo(() => (events ?? []).filter((e) => new Date(e.startAt).getTime() > t).sort((a, b) => a.startAt.localeCompare(b.startAt))[0], [events]);
  const weekCount = (events ?? []).filter((e) => mondayOf(dayKey(new Date(e.startAt))) === mondayOf(todayKey())).length;

  useMainButton({ text: synced ? 'Далі' : 'Пізніше', onClick: onNext, visible: events !== null });

  const recheck = async () => {
    setChecking(true);
    try { await api.post('/schedule/refresh'); } catch { /* the list below says what we found */ }
    await onRecheck();
    setChecking(false);
  };

  const k = nextClass && dayKey(new Date(nextClass.startAt));
  const when = k === todayKey() ? 'Сьогодні наступна пара' : k === addDays(todayKey(), 1) ? 'Завтра перша пара' : k ? `${dayTitle(k)}, перша пара` : '';

  return (
    <>
      <h1 className="onb__title">Пошта підключена</h1>
      <p className="onb__sub">{email}</p>

      {events === null ? (
        <div className="aha" aria-busy="true"><div className="skel" style={{ height: 13, width: 130 }} /><div className="skel" style={{ height: 40, width: 170, margin: '10px 0' }} /><div className="skel" style={{ height: 14, width: '60%' }} /></div>
      ) : synced && nextClass ? (
        <>
          <div className="aha">
            <div className="now__label">{when}</div>
            <div className="aha__big">{hm(nextClass.startAt)}</div>
            <div className="now__title">{nextClass.courseCode}{nextClass.section ? ` [${nextClass.section}]` : ''}</div>
            <div className="now__place">{shortPlace(nextClass.location)}</div>
          </div>
          <p className="note"><Check size={14} strokeWidth={2.25} style={{ verticalAlign: -2, color: 'var(--accent)' }} /> Цього тижня {weekCount} пар — уже у вкладці «Навчання»</p>
        </>
      ) : (
        <>
          <div className="group">
            <div className="row"><div className="row__main">
              <div className="row__title">Ще один крок для розкладу</div>
              <div className="row__meta" style={{ lineHeight: 1.45 }}>На schedule.kse.ua натисни своє імʼя вгорі справа → Sync with Google Calendar. KSE додає пари кілька хвилин.</div>
            </div></div>
            <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500 }} onClick={() => openExternal('https://schedule.kse.ua/')}>Відкрити schedule.kse.ua</button>
            <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500, gap: 8 }} onClick={recheck} disabled={checking}>
              <RefreshCw size={18} strokeWidth={1.75} /> {checking ? 'Перевіряю…' : 'Перевірити ще раз'}
            </button>
          </div>
          <p className="note">Можна й пізніше — пари підтягнуться самі, коли зʼявляться.</p>
        </>
      )}
    </>
  );
}

function Question({ title, sub, options, value, onPick, note, disabled }: {
  title: string; sub?: string; options: { key: string; title: string; sub?: string }[]; value: string | null;
  onPick: (key: string) => void; note?: string; disabled?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(value);
  useEffect(() => setPicked(value), [value]);
  return (
    <>
      <h1 className="onb__title">{title}</h1>
      {sub && <p className="onb__sub">{sub}</p>}
      <div className="options" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button key={o.key} className="option press" role="radio" aria-checked={picked === o.key} disabled={disabled}
            onClick={() => { setPicked(o.key); onPick(o.key); }}>
            <span className="option__main">
              <span className="option__title" style={{ display: 'block' }}>{o.title}</span>
              {o.sub && <span className="option__sub" style={{ display: 'block' }}>{o.sub}</span>}
            </span>
            <Check strokeWidth={2.25} />
          </button>
        ))}
      </div>
      {note && <p className="note" style={{ paddingTop: 16 }}>{note}</p>}
    </>
  );
}
