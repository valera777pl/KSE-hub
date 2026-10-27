import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../../../api/client';
import type { ClassEvent, DeadlineWithCourse } from '../../../types';
import { addDays, dayKey, dayTitle, duration, hm, mondayOf, now, relDay, spanText, todayKey } from '../../../lib/time';
import { shortPlace } from '../../../lib/place';
import { haptic, openExternal } from '../../../lib/telegram';
import { useUi } from '../../../stores/uiStore';
import { useAuthStore } from '../../../stores/authStore';
import { ScreenHead } from '../../ui/ScreenHead';
import { ErrorState, StaleBanner } from '../../ui/States';
import { useCached } from '../../../lib/cache';
import { tr } from '../../../lib/i18n';

type Week = { connected: boolean; synced: boolean; events: ClassEvent[] };
type Mail = { id: number; subject: string | null; from: string | null; summary: string; receivedAt: string; url: string };

const H48 = 48 * 3_600_000;

/** "MATH111 [P6]" → "MATH111" + "P6" */
const code = (e: ClassEvent) => (e.section ? `${e.courseCode} [${e.section}]` : e.courseCode);
/** "ECON100 Principles of Economics" → "ECON100" */
const courseShort = (name: string | null) => (name?.match(/^[A-Z]{2,5}\d{3}/)?.[0] ?? name ?? '');

/** Сьогодні: what's on right now, what's due soon, what in the mail needs action. */
export function TodayPage() {
  const today = todayKey();
  const [, tick] = useState(0);
  const user = useAuthStore((s) => s.user);
  const { openDay, openDeadline } = useUi();

  // This week plus next: on Sunday evening "next class" lives in the following week
  const mon = mondayOf(today);
  const weeksQ = useCached(`today.weeks:${mon}`, () => Promise.all([mon, addDays(mon, 7)].map((m) => api.get<Week>(`/schedule/week?start=${m}`))));
  const deadlinesQ = useCached('deadlines', () => api.get<{ deadlines: DeadlineWithCourse[] }>('/moodle/deadlines?completed=true').then((r) => r.deadlines));
  // Mail keeps only subject, sender and time on the device, never the text
  const mailQ = useCached('mail.important', () => api.get<{ emails: Mail[] }>('/mail/important').then((r) => r.emails),
    { keep: (list) => list.map((m) => ({ id: m.id, subject: m.subject, from: m.from, receivedAt: m.receivedAt, summary: '', url: '' })) });
  const weeks = weeksQ.data;
  const deadlines = deadlinesQ.data;
  const deadlinesFailed = !deadlines && !!deadlinesQ.error;
  const mail = mailQ.data ?? [];
  const stale = [weeksQ, deadlinesQ, mailQ].find((q) => q.staleAt);
  const retry = () => { weeksQ.refresh(); deadlinesQ.refresh(); mailQ.refresh(); };

  // Re-render every 30 s so the countdown and the progress bar stay true
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const t = now().getTime();
  const events = useMemo(() => (weeks ?? []).flatMap((w) => w.events).sort((a, b) => a.startAt.localeCompare(b.startAt)), [weeks]);
  const current = events.find((e) => new Date(e.startAt).getTime() <= t && t < new Date(e.endAt).getTime());
  const upcoming = events.filter((e) => new Date(e.startAt).getTime() > t);
  const laterToday = upcoming.filter((e) => dayKey(new Date(e.startAt)) === today);

  const soon = (deadlines ?? [])
    .filter(({ assignment: a }) => !a.isCompleted && a.dueDate && new Date(a.dueDate).getTime() > t && new Date(a.dueDate).getTime() - t <= H48)
    .sort((a, b) => a.assignment.dueDate!.localeCompare(b.assignment.dueDate!));

  const synced = weeks?.[0]?.synced;

  return (
    <div className="screen">
      <ScreenHead title={tr('Сьогодні', 'Today')} sub={dayTitle(today)} />

      {stale && <StaleBanner at={stale.staleAt!} error={stale.error} busy={stale.loading} onRetry={retry} />}

      {!weeks && weeksQ.error ? (
        <ErrorState error={weeksQ.error} onRetry={retry} />
      ) : !weeks ? (
        <div className="now" aria-busy="true"><div className="skel" style={{ height: 13, width: 110 }} /><div className="skel" style={{ height: 52, width: 150, margin: '10px 0 14px' }} /><div className="skel" style={{ height: 18, width: '60%' }} /></div>
      ) : !synced ? (
        <button className="now press" style={{ width: '100%', textAlign: 'left' }} onClick={() => openDay(today)}>
          <div className="now__label">{tr('Розклад', 'Schedule')}</div>
          <div className="now__title" style={{ marginTop: 6 }}>{tr('Пари ще не підтягнулись', 'Classes haven\'t arrived yet')}</div>
          <div className="now__place">{tr('Один крок на schedule.kse.ua — покажемо як', 'One step on schedule.kse.ua, we\'ll show you how')}</div>
        </button>
      ) : (
        <NowCard current={current} next={current ? laterToday[0] : upcoming[0]} after={laterToday.slice(1, 3)} today={today} onOpen={(d) => { haptic.tap(); openDay(d); }} />
      )}

      {deadlinesFailed ? null : <div className="caption">{tr('Дедлайни · 48 год', 'Deadlines · 48 h')}</div>}
      {deadlinesFailed ? null : deadlines === null ? (
        <div className="group"><div className="row"><div className="row__main"><div className="skel" style={{ height: 14, width: '55%' }} /><div className="skel" style={{ height: 12, width: '30%', marginTop: 6 }} /></div></div></div>
      ) : !user?.calendarUrl && deadlines.length === 0 ? (
        <div className="group">
          <button className="row press" onClick={() => useUi.getState().openProfile()}>
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Додати дедлайни з Moodle', 'Add deadlines from Moodle')}</div><div className="row__meta">{tr('Хвилина — і нагадаємо за 24 і за 3 години', 'One minute, and we\'ll remind you 24 and 3 hours before')}</div></div>
            <ChevronRight className="chev" strokeWidth={1.75} />
          </button>
        </div>
      ) : soon.length === 0 ? (
        <p className="note" style={{ paddingTop: 0 }}>{tr('Найближчі два дні нічого здавати не треба.', 'Nothing is due in the next two days.')}</p>
      ) : (
        <div className="group">
          {soon.map(({ assignment: a, courseName }) => {
            const left = new Date(a.dueDate!).getTime() - t;
            return (
              <button key={a.id} className="row press" onClick={() => { haptic.tap(); openDeadline(a.id); }}>
                <div className="row__main">
                  <div className="row__title clamp2" style={{ fontWeight: 500 }}>{a.title}</div>
                  <div className="row__meta">{[courseShort(courseName), `${relDay(a.dueDate!)}, ${hm(a.dueDate!)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="row__side num" style={left < 6 * 3_600_000 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{spanText(left)}</span>
              </button>
            );
          })}
        </div>
      )}

      {mail.length > 0 && (
        <>
          <div className="caption">{tr('Пошта', 'Mail')}</div>
          <div className="group">
            {mail.map((m) => (
              <button key={m.id} className="row press" style={{ alignItems: 'flex-start' }} disabled={!m.url} onClick={() => m.url && openExternal(m.url)}>
                <div className="row__main">
                  <div className="row__title" style={{ fontWeight: 500 }}>{m.subject}</div>
                  {m.summary && <div className="row__meta clamp2" style={{ color: 'var(--text)', opacity: 0.8 }}>{m.summary}</div>}
                  {m.from && <div className="row__meta">{m.from}</div>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** "45 хв", "1 год 45 хв", "20 год", "3 дні": how long until a class, for the brand-card pill */
function waitText(ms: number) {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60 || min >= 180) return spanText(ms);
  const [h, m] = [Math.floor(min / 60), min % 60];
  return m ? `${h} ${tr('год', 'h')} ${m} ${tr('хв', 'min')}` : `${h} ${tr('год', 'h')}`;
}

/** One big number: minutes left in this class, or until the next one. */
function NowCard({ current, next, after, today, onOpen }: {
  current?: ClassEvent; next?: ClassEvent; after: ClassEvent[]; today: string; onOpen: (day: string) => void;
}) {
  const t = now().getTime();
  const focus = current ?? next;

  if (!focus) {
    return (
      <div className="now">
        <div className="now__label">{tr('Розклад', 'Schedule')}</div>
        <div className="now__title" style={{ marginTop: 6 }}>{tr('Попереду пар немає', 'No classes ahead')}</div>
        <div className="now__place">{tr('Цього й наступного тижня — вільно', 'Free this week and next')}</div>
      </div>
    );
  }

  const focusDay = dayKey(new Date(focus.startAt));
  const startsIn = new Date(focus.startAt).getTime() - t;
  let label: string;
  let big: { value: string; unit: string };
  if (current) {
    label = tr('Зараз · до кінця пари', 'Now · until the end');
    big = duration(new Date(current.endAt).getTime() - t);
  } else if (focusDay === today && startsIn <= 90 * 60_000) {
    label = tr('Наступна пара · через', 'Next class · in');
    big = duration(startsIn);
  } else {
    label = focusDay === today ? tr('Наступна пара', 'Next class') : focusDay === addDays(today, 1) ? tr('Завтра · перша пара', 'Tomorrow · first class') : `${dayTitle(focusDay)} · ${tr('перша пара', 'first class')}`;
    big = { value: hm(focus.startAt), unit: '' };
  }

  const followUps = current ? [next, ...after].filter(Boolean).slice(0, 2) as ClassEvent[] : after.slice(0, 1);
  // A clock time as the big number needs the wait next to it; a countdown already is one
  const pill = big.unit ? null : `${tr('через', 'in')} ${waitText(startsIn)}`;

  return (
    <button className="now press" onClick={() => onOpen(focusDay)}>
      <div className="now__top">
        <span className="now__label">{label}</span>
        {pill && <span className="now__pill num">{pill}</span>}
      </div>
      <div className="now__big">{big.value}{big.unit && <small>{big.unit}</small>}</div>
      <div className="now__title">{focus.courseCode}{focus.section && <span> [{focus.section}]</span>}</div>
      <div className="now__place num">{[shortPlace(focus.location), `${tr('до', 'until')} ${hm(focus.endAt)}`].filter(Boolean).join(' · ')}</div>
      {current && <div className="now__progress"><i style={{ width: `${((t - new Date(current.startAt).getTime()) / (new Date(current.endAt).getTime() - new Date(current.startAt).getTime())) * 100}%` }} /></div>}
      {followUps.length > 0 && (
        <div className="now__next">
          <div className="now__label">{tr('Далі', 'Next')}</div>
          {followUps.map((e) => (
            <div key={e.id} className="now__line">
              <b className="num">{hm(e.startAt)}</b><b>{code(e)}</b><span>{shortPlace(e.location)}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
