import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, errorText, track } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import type { ClassEvent, GoogleStatus, User } from '../../types';
import { addDays, dayKey, dayTitle, hm, mondayOf, now, todayKey } from '../../lib/time';
import { shortPlace } from '../../lib/place';
import { cloud, haptic, openExternal, useBackButton, useMainButton } from '../../lib/telegram';
import { MoodleConnectForm } from '../modules/deadlines/MoodleConnect';
import { programName, programsFromSchedule } from '../../lib/programs';
import { tr } from '../../lib/i18n';
import { useUi } from '../../stores/uiStore';

const STEPS = ['mail', 'synced', 'program', 'digest', 'moodle', 'visibility', 'done'] as const;
type Step = (typeof STEPS)[number];
const STEP_KEY = 'onboarding_step';
const AUTO_ADVANCE_MS = 200;
/** Right after sign-in the server is still pulling the schedule: ask again this often, this many times */
const SYNC_POLL_MS = 4000;
const SYNC_POLLS = 10;

const digestOptions = () => [
  { hour: 8, title: tr('Зранку, 08:00', 'Morning, 08:00') },
  { hour: 13, title: tr('В обід, 13:00', 'At lunch, 13:00') },
  { hour: 20, title: tr('Увечері, 20:00', 'Evening, 20:00') },
  { hour: -1, title: tr('Не надсилати', 'Don\'t send') },
];

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

  // The first sync runs on the server after sign-in: keep asking for a while, so progress is real
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (step !== 'synced' || synced || events === null || polls >= SYNC_POLLS) return;
    const timer = setTimeout(() => { setPolls((n) => n + 1); loadSchedule(); }, SYNC_POLL_MS);
    return () => clearTimeout(timer);
  }, [step, synced, events, polls, loadSchedule]);

  const go = (next: Step) => {
    setStep(next);
    cloud.set(STEP_KEY, next);
    track(`onboarding.step.${next}`);
  };
  const programs = useMemo(() => programsFromSchedule(events ?? []), [events]);
  const index = step ? STEPS.indexOf(step) : 0;
  const next = () => (index < STEPS.length - 1 ? go(STEPS[index + 1]) : finish());

  const finish = async () => {
    setFinishing(true);
    try {
      await api.post('/users/me/onboarding');
      cloud.set(STEP_KEY, '');
      haptic.success();
      useUi.getState().setTab('today');
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

  useBackButton(index > 0 && step !== 'synced' && step !== 'done' ? () => go(STEPS[index - 1]) : null);

  if (!step) return <div className="onb" />;

  return (
    <div className="onb">
      <div className="onb__progress" aria-hidden="true"><i style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="onb__body" key={step}>
        {step === 'mail' && <MailStep google={google} />}
        {step === 'synced' && <SyncedStep email={google?.email ?? null} events={events} synced={synced} waiting={!synced && polls < SYNC_POLLS} onRecheck={loadSchedule} onNext={next} />}
        {step === 'program' && (programs.length > 0 ? (
          <Question title={tr('Твоя програма', 'Your programme')}
            sub={programs.length === 1
              ? tr('Знайшли в назвах твоїх курсів. Так стажування й гранти будуть саме для тебе.', 'Found in your course titles. Internships and grants will match it.')
              : tr('Ці програми є в назвах твоїх курсів. Обери свою — так стажування й гранти будуть саме для тебе.', 'These programmes appear in your course titles. Pick yours so internships and grants match it.')}
            options={programs.map((code) => ({ key: code, title: programName(code), sub: programName(code) !== code ? code : undefined }))}
            value={user?.faculty && programs.includes(user.faculty) ? user.faculty : programs.length === 1 ? programs[0] : null}
            onPick={(code) => answer(() => updateUser({ faculty: code }))} />
        ) : (
          <NoProgramYet onNext={next} />
        ))}
        {step === 'digest' && (
          <Question title={tr('Коли надсилати дайджест?', 'When should the digest arrive?')} sub={tr('Пари, дедлайни й важливі листи одним повідомленням.', 'Classes, deadlines and important mail in one message.')}
            options={digestOptions().map((d) => ({ key: String(d.hour), title: d.title }))}
            value={user ? String(user.digestHour) : null}
            onPick={(h) => answer(() => updateUser({ digestHour: Number(h) }))}
            note={tr('Нагадування про дедлайни й перенесення пар приходять одразу, незалежно від цього.', 'Deadline reminders and class changes arrive right away either way.')} />
        )}
        {step === 'moodle' && (
          <>
            <h1 className="onb__title">{tr('Додай дедлайни з Moodle', 'Add deadlines from Moodle')}</h1>
            <p className="onb__sub">{tr('Хвилина — і бот нагадає про кожну здачу за 24 і за 3 години.', 'One minute, and the bot reminds you of every deadline 24 and 3 hours before.')}</p>
            <MoodleConnectForm onSaved={next} skip={() => { track('onboarding.skip.moodle'); next(); }} />
          </>
        )}
        {step === 'visibility' && (
          <Question title={tr('Показувати твій розклад одногрупникам?', 'Show your schedule to classmates?')} sub={tr('Тоді друзі побачать ваші спільні пари.', 'Then friends see the classes you share.')}
            options={[
              { key: 'show', title: tr('Показувати', 'Show'), sub: tr('Тебе можна знайти за прізвищем', 'Classmates can find you by surname') },
              { key: 'hide', title: tr('Приховати', 'Hide'), sub: tr('Змінити можна в профілі', 'You can change it in your profile') },
            ]}
            value={user ? (user.scheduleVisible ? 'show' : 'hide') : null}
            onPick={(v) => answer(() => updateUser({ scheduleVisible: v === 'show' }))} />
        )}
        {step === 'done' && user && <DoneStep user={user} busy={finishing} onFinish={finish} />}
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
      setError(errorText(e));
    }
  };

  useMainButton({ text: google?.needsReconnect ? tr('Підключити знову', 'Reconnect') : tr('Увійти через Google', 'Sign in with Google'), onClick: connect });

  return (
    <>
      <div className="connect" aria-hidden="true">
        <span className="connect__mark connect__mark--kse">KSE</span>
        <span className="connect__dash" />
        <span className="connect__mark connect__mark--g">G</span>
      </div>
      <h1 className="onb__title">{tr('Увійди через пошту KSE', 'Sign in with your KSE mail')}</h1>
      <p className="onb__sub">{tr('Підтягнемо розклад і листи. Лише читання — нічого не надсилаємо від твого імені.', "We'll bring in your schedule and mail. Read-only: we never send anything on your behalf.")}</p>
      <div className="group">
        <div className="row"><CalendarDays className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Твій розклад і перенесення пар', 'Your schedule and class changes')}</div></div></div>
        <div className="row"><Mail className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Важливі листи коротко, раз на день', 'Important mail in short, once a day')}</div></div></div>
        <div className="row"><ShieldCheck className="row-icon" strokeWidth={1.75} /><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Лише читання', 'Read-only')}</div><div className="row__meta">{tr('Нічого не надсилаємо від твого імені', 'We never send anything on your behalf')}</div></div></div>
      </div>
      <p className="note">{tr('Потрібна пошта @kse.org.ua', 'An @kse.org.ua address is needed')}</p>
      {google?.needsReconnect && <p className="note" style={{ color: 'var(--danger)' }}>{tr('Google відкликав доступ. Увійди ще раз тією ж поштою.', 'Google revoked access. Sign in again with the same mail.')}</p>}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {waiting && !error && <p className="note">{tr('Після входу повернись сюди — продовжимо самі.', 'After signing in, come back here and we\'ll continue.')}</p>}
    </>
  );
}

/** The payoff right after sign-in: what's connected, as it happens, then your actual next class. */
function SyncedStep({ email, events, synced, waiting, onRecheck, onNext }: {
  email: string | null; events: ClassEvent[] | null; synced: boolean; waiting: boolean; onRecheck: () => Promise<void>; onNext: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const t = now().getTime();
  const nextClass = useMemo(() => (events ?? []).filter((e) => new Date(e.startAt).getTime() > t).sort((a, b) => a.startAt.localeCompare(b.startAt))[0], [events]);
  const weekCount = (events ?? []).filter((e) => mondayOf(dayKey(new Date(e.startAt))) === mondayOf(todayKey())).length;
  const loading = events === null || (!synced && waiting);

  useMainButton({ text: synced ? tr('Далі', 'Next') : tr('Пізніше', 'Later'), onClick: onNext, visible: !loading });

  const recheck = async () => {
    setChecking(true);
    try { await api.post('/schedule/refresh'); } catch { /* the list below says what we found */ }
    await onRecheck();
    setChecking(false);
  };

  const k = nextClass && dayKey(new Date(nextClass.startAt));
  const when = k === todayKey() ? tr('Сьогодні наступна пара', 'Next class today') : k === addDays(todayKey(), 1) ? tr('Завтра перша пара', 'Tomorrow, first class') : k ? `${dayTitle(k)}, ${tr('перша пара', 'first class')}` : '';

  return (
    <>
      <h1 className="onb__title">{loading ? tr('Підключаємо', 'Connecting') : tr('Пошта підключена', 'Mail connected')}</h1>
      <p className="onb__sub">{loading ? tr('Кілька секунд — і твій тиждень буде тут.', 'A few seconds, and your week is here.')
        : synced ? tr('Твій тиждень уже тут.', 'Your week is already here.') : tr('Пошта на місці, розклад — за один крок.', 'Mail is in; the schedule is one step away.')}</p>

      <div className="group sync" role="status">
        <div className="row"><Check className="sync__ok" strokeWidth={2.4} /><div className="row__main"><div className="row__title">{tr('Пошта підключена', 'Mail connected')}</div>{email && <div className="row__meta">{email}</div>}</div></div>
        <div className="row">
          {loading ? <RefreshCw className="sync__spin" strokeWidth={2} /> : synced ? <Check className="sync__ok" strokeWidth={2.4} /> : <CalendarDays className="sync__wait" strokeWidth={1.7} />}
          <div className="row__main">
            <div className="row__title">{tr('Розклад', 'Schedule')}</div>
            <div className="row__meta num">{loading ? tr('Підтягуємо з календаря KSE…', 'Fetching from the KSE calendar…') : synced ? tr(`${weekCount} пар цього тижня`, `${weekCount} classes this week`) : tr('Ще не синхронізовано', 'Not synced yet')}</div>
          </div>
        </div>
      </div>

      {!loading && synced && nextClass && (
        <div className="aha">
          <div className="aha__label">{when}</div>
          <div className="aha__big num">{hm(nextClass.startAt)}</div>
          <div className="aha__title">{nextClass.courseCode}{nextClass.section && <span> [{nextClass.section}]</span>}</div>
          <div className="aha__place">{shortPlace(nextClass.location)}</div>
        </div>
      )}

      {!loading && !synced && (
        <>
          <div className="group" style={{ marginTop: 16 }}>
            <div className="row"><div className="row__main">
              <div className="row__title">{tr('Ще один крок для розкладу', 'One more step for your schedule')}</div>
              <div className="row__meta" style={{ lineHeight: 1.45 }}>{tr('На schedule.kse.ua натисни своє імʼя вгорі справа → Sync with Google Calendar. KSE додає пари кілька хвилин.', 'On schedule.kse.ua tap your name at the top right → Sync with Google Calendar. KSE takes a few minutes to add classes.')}</div>
            </div></div>
            <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500 }} onClick={() => openExternal('https://schedule.kse.ua/')}>{tr('Відкрити schedule.kse.ua', 'Open schedule.kse.ua')}</button>
            <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500, gap: 8 }} onClick={recheck} disabled={checking}>
              <RefreshCw size={18} strokeWidth={1.75} /> {checking ? tr('Перевіряю…', 'Checking…') : tr('Перевірити ще раз', 'Check again')}
            </button>
          </div>
          <p className="note">{tr('Можна й пізніше — пари підтягнуться самі, коли зʼявляться.', 'You can do it later: classes will appear on their own.')}</p>
        </>
      )}
    </>
  );
}

/** Last screen: it's done, what got set up (each changeable in the profile), one way on. */
function DoneStep({ user, busy, onFinish }: { user: User; busy: boolean; onFinish: () => void }) {
  useMainButton({ text: tr('До розкладу', 'To my day'), onClick: onFinish, loading: busy });
  // Kyiv hour, like the server that sends the digest
  const h = Number(hm(now()).slice(0, 2));
  const hour = user.digestHour;
  const first = hour < 0 ? null : `${hour > h ? tr('сьогодні', 'today') : tr('завтра', 'tomorrow')} ${tr('о', 'at')} ${String(hour).padStart(2, '0')}:00`;
  const rows: [string, string][] = [
    [tr('Програма', 'Programme'), user.faculty ? programName(user.faculty) : tr('візьмемо з розкладу', 'from your schedule')],
    [tr('Дайджест', 'Digest'), hour < 0 ? tr('не надсилати', 'off') : `${String(hour).padStart(2, '0')}:00`],
    ['Moodle', user.calendarUrl ? tr('підключено', 'connected') : tr('не підключено', 'not connected')],
    [tr('Розклад', 'Schedule'), user.scheduleVisible ? tr('видно одногрупникам', 'visible to classmates') : tr('приховано', 'hidden')],
  ];
  return (
    <>
      <h1 className="onb__title">{tr('Готово', 'All set')}</h1>
      <p className="onb__sub">{first
        ? tr(`Твій день уже тут. Перший дайджест — ${first}.`, `Your day is already here. The first digest arrives ${first}.`)
        : tr('Твій день уже тут. Дайджест вимкнено — увімкнути можна в профілі.', 'Your day is already here. The digest is off; turn it on in your profile.')}</p>
      <div className="group">
        {rows.map(([title, value]) => (
          <div className="row" key={title}><div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{title}</div></div><span className="row__side num">{value}</span></div>
        ))}
      </div>
      <p className="note">{tr('Усе це можна змінити в профілі — аватар угорі праворуч.', 'You can change all of this in your profile: the avatar at the top right.')}</p>
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

/** No schedule yet, so nothing to pick from: say when it will be asked, don't make one up. */
function NoProgramYet({ onNext }: { onNext: () => void }) {
  useMainButton({ text: tr('Далі', 'Next'), onClick: onNext });
  return (
    <>
      <h1 className="onb__title">{tr('Твоя програма', 'Your programme')}</h1>
      <p className="onb__sub">{tr('Візьмемо її з назв твоїх курсів, щойно підтягнеться розклад. Змінити можна в профілі.', "We'll take it from your course titles as soon as your schedule arrives. You can change it in your profile.")}</p>
    </>
  );
}
