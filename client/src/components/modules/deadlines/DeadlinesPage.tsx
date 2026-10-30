import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, BookCheck, BookOpen, CheckCheck, ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import { DoneToast, Tick, useAutoDone, useDoneFlow, type DoneVia } from '../../ui/doneFlow';
import { Glow } from '../../ui/Glow';
import { RemindSheet, shortWhen } from '../../ui/RemindSheet';
import { api, track } from '../../../api/client';
import type { DeadlineWithCourse, MoodleExtra } from '../../../types';
import { addDays, dayKey, dayTitle, hm, mondayOf, now, plural, spanText, todayKey } from '../../../lib/time';
import { cloud, haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { useAuthStore } from '../../../stores/authStore';
import { useUi } from '../../../stores/uiStore';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { useCached } from '../../../lib/cache';
import { MoodleConnectForm } from './MoodleConnect';
import { MoodleGradesSheet } from '../grades/MoodleGradesSheet';
import { AskPanel } from '../../ui/AskPanel';
import { DeadlineRow } from '../../ui/DeadlineRow';
import { tr } from '../../../lib/i18n';

const DAY = 86_400_000;
const LATE_KEEP = 7 * DAY;
const GENERAL = /general\s*\/\s*university/i;
const CLEAN_KEY = 'week_clean';

const typeLabel = (): Record<string, string> => ({ assignment: tr('Завдання', 'Assignment'), quiz: tr('Тест', 'Quiz'), event: tr('Подія', 'Event') });

/** "ECON100 Principles of Economics" → ["ECON100", "Principles of Economics"] */
function splitCourse(name: string | null): [string, string] {
  const m = name?.match(/^([A-Z]{2,5}\d{3})\s*(.*)$/);
  return m ? [m[1], m[2]] : [name ?? '', ''];
}

type Group = { title: string; items: DeadlineWithCourse[] };

/** Навчання → Дедлайни: in the order they're due; university-wide events and done items folded away. */
export function DeadlinesPage() {
  const user = useAuthStore((s) => s.user);
  const { deadlineId } = useUi();
  const q = useCached('deadlines', () => api.get<{ deadlines: DeadlineWithCourse[] }>('/moodle/deadlines?completed=true').then((r) => r.deadlines));
  // «Зроблено» shows at once (and animates), before the server answers
  const flow = useDoneFlow(q.refresh);
  const all = flow.apply(q.data);
  useAutoDone(q.data, flow);
  const [openId, setOpenId] = useState<number | null>(deadlineId);
  const [showGeneral, setShowGeneral] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // A deep link from the bot opened this deadline; forget it so the tab opens plainly next time
  useEffect(() => { if (deadlineId) useUi.setState({ deadlineId: null }); }, []);

  const t = now().getTime();
  const { groups, general, done, week, overdue } = useMemo(() => {
    const live = (all ?? []).filter(({ assignment: a }) => a.dueDate && new Date(a.dueDate).getTime() > t - LATE_KEEP);
    const open = live.filter((d) => !d.assignment.isCompleted);
    const today = todayKey();
    const weekEnd = addDays(today, 7);
    const buckets: Group[] = [
      { title: tr('Прострочено', 'Overdue'), items: [] }, { title: tr('Сьогодні', 'Today'), items: [] }, { title: tr('Завтра', 'Tomorrow'), items: [] },
      { title: tr('Цього тижня', 'This week'), items: [] }, { title: tr('Пізніше', 'Later'), items: [] },
    ];
    const general: DeadlineWithCourse[] = [];
    for (const d of open) {
      if (GENERAL.test(d.courseName ?? '')) { general.push(d); continue; }
      const due = new Date(d.assignment.dueDate!);
      const k = dayKey(due);
      const i = due.getTime() < t ? 0 : k === today ? 1 : k === addDays(today, 1) ? 2 : k < weekEnd ? 3 : 4;
      buckets[i].items.push(d);
    }
    // This week, Mon–Sun: how much of it is done ("4 з 6 цього тижня")
    const monday = mondayOf(today);
    const week = live.filter((d) => !GENERAL.test(d.courseName ?? '') && dayKey(new Date(d.assignment.dueDate!)) >= monday
      && dayKey(new Date(d.assignment.dueDate!)) < addDays(monday, 7));
    return {
      groups: buckets.filter((b) => b.items.length), general, done: live.filter((d) => d.assignment.isCompleted),
      week: { total: week.length, done: week.filter((d) => d.assignment.isCompleted).length, monday },
      overdue: buckets[0].items.length,
    };
  }, [all, t]);

  const weekClean = week.total > 0 && week.done === week.total && overdue === 0;
  // A clean week earns one quiet success tick, once per week
  useEffect(() => {
    if (!weekClean) return;
    cloud.get(CLEAN_KEY).then((v) => { if (v !== week.monday) { haptic.success(); cloud.set(CLEAN_KEY, week.monday); } });
  }, [weekClean, week.monday]);

  /** From the sheet: done with the full animation once the sheet is down; «Повернути» is a plain switch. */
  const toggle = (id: number) => {
    const d = all?.find((x) => x.assignment.id === id);
    if (d?.assignment.isCompleted) flow.set(id, false);
    else setTimeout(() => flow.complete(id, 'button'), 260);
  };
  const check = (d: DeadlineWithCourse) => (via: DoneVia) => (d.assignment.isCompleted ? flow.set(d.assignment.id, false) : flow.complete(d.assignment.id, via));

  const opened = all?.find((d) => d.assignment.id === openId) ?? null;

  if (!all && q.error) return <ErrorState error={q.error} onRetry={q.refresh} />;
  if (!all) return <SkeletonRows rows={4} />;
  const stale = q.staleAt ? <StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} /> : null;

  // Connected to Moodle itself (owner-only test): no calendar link to add or change
  const direct = !!user?.moodleConnected;
  if (!user?.calendarUrl && !direct && all.length === 0) {
    return (
      <>
        {stale}
        <div className="group">
          <EmptyState icon={Link2} title={tr('Додай дедлайни з Moodle', 'Add deadlines from Moodle')} text={tr('Хвилина — і всі здачі будуть тут, а бот нагадає за 24 і за 3 години.', 'One minute, and every due date lands here with reminders 24 and 3 hours before.')}
            action={{ label: tr('Підключити Moodle', 'Connect Moodle'), onClick: () => setConnecting(true) }} />
        </div>
        {connecting && <ConnectSheet onClose={() => setConnecting(false)} onSaved={() => { setConnecting(false); q.refresh(); }} />}
      </>
    );
  }

  const nothingOpen = groups.length === 0;
  const nextLater = groups.find((g) => g.items.length)?.items[0];

  return (
    <>
      {stale}
      {week.total > 0 && !weekClean && (
        <div className="week-count" aria-live="polite">
          <span><b><Tick value={week.done} /> {tr('з', 'of')} {week.total}</b> {tr('цього тижня', 'this week')}</span>
        </div>
      )}
      {weekClean ? (
        <div className="has-glow week-clean">
          <Glow center />
          <EmptyState icon={CheckCheck} title={tr('Тиждень чистий', 'Week cleared')}
            text={nextLater
              ? tr(`Усе на цей тиждень зроблено. Далі — ${shortWhen(new Date(nextLater.assignment.dueDate!))}.`, `Everything for this week is done. Next up: ${shortWhen(new Date(nextLater.assignment.dueDate!))}.`)
              : tr('Усе на цей тиждень зроблено.', 'Everything for this week is done.')} />
        </div>
      ) : nothingOpen && (
        <div className="group"><EmptyState icon={BookCheck} title={tr('Усе здано', 'All done')} text={tr('Нові дедлайни зʼявляться тут, щойно викладач додасть їх у Moodle.', 'New deadlines appear here as soon as they\'re added in Moodle.')} /></div>
      )}

      {groups.map((g, gi) => (
        <section key={g.title}>
          <h3 className="group-title" style={gi === 0 && !nothingOpen && !weekClean ? { marginTop: 4 } : undefined}>{g.title}</h3>
          <div className="group">
            {g.items.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }}
              onCheck={check(d)} phase={flow.phaseOf(d.assignment.id)} />)}
          </div>
        </section>
      ))}

      {general.length > 0 && (
        <>
          <h3 className="group-title">{tr('Загальноуніверситетські', 'University-wide')}</h3>
          <div className="group">
            {showGeneral && general.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }} />)}
            <button className="row toggle-row" aria-expanded={showGeneral} onClick={() => { haptic.select(); setShowGeneral((v) => !v); }}>
              <span className="row__main">{showGeneral ? tr('Згорнути', 'Collapse') : tr(`Показати ${general.length} ${plural(general.length, 'подію', 'події', 'подій')}`, `Show ${general.length} ${general.length === 1 ? 'event' : 'events'}`)}</span>
              <ChevronDown size={18} strokeWidth={1.75} />
            </button>
          </div>
          {!showGeneral && <p className="note">{tr('Без нагадувань: це події для всіх студентів KSE.', 'No reminders: these are events for all KSE students.')}</p>}
        </>
      )}

      {done.length > 0 && (
        <>
          <h3 className="group-title">{tr('Зроблено', 'Done')}</h3>
          <div className="group">
            {showDone && done.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }}
              onCheck={check(d)} phase={flow.phaseOf(d.assignment.id)} />)}
            <button className="row toggle-row" aria-expanded={showDone} onClick={() => { haptic.select(); setShowDone((v) => !v); }}>
              <span className="row__main">{showDone ? tr('Згорнути', 'Collapse') : tr(`Показати ${done.length}`, `Show ${done.length}`)}</span>
              <ChevronDown size={18} strokeWidth={1.75} />
            </button>
          </div>
        </>
      )}

      <p className="note" style={{ paddingTop: 16 }}>
        {direct ? tr('Напряму з Moodle, оновлюється кожні 15 хв.', 'Straight from Moodle, refreshed every 15 min.') : <>
          {tr('З календаря Moodle, оновлюється кожні 10 хв.', 'From your Moodle calendar, refreshed every 10 min.')}{' '}
          <button className="link-btn" style={{ padding: 0, fontSize: 13 }} onClick={() => setConnecting(true)}>{tr('Змінити посилання', 'Change link')}</button>
        </>}
      </p>

      {opened && <DeadlineSheet d={opened} onClose={() => setOpenId(null)} onToggle={() => { toggle(opened.assignment.id); setOpenId(null); }} />}
      <DoneToast flow={flow} />
      {connecting && <ConnectSheet onClose={() => setConnecting(false)} onSaved={() => { setConnecting(false); q.refresh(); }} />}
    </>
  );
}


function DeadlineSheet({ d, onClose, onToggle }: { d: DeadlineWithCourse; onClose: () => void; onToggle: () => void }) {
  const { assignment: a } = d;
  const m = a.moodle;
  const due = new Date(a.dueDate!);
  const left = due.getTime() - now().getTime();
  const late = left < 0;
  const [code, rest] = splitCourse(d.courseName);
  const big = spanText(Math.abs(left)).split(' ');
  const [asking, setAsking] = useState(false);
  const [reminding, setReminding] = useState(false);
  useEffect(() => { track('deadline.sheet_open'); }, []);

  useMainButton({
    text: tr('Відкрити в Moodle', 'Open in Moodle'),
    visible: !!a.sourceUrl && !asking && !reminding,
    onClick: () => { if (a.sourceUrl) { track('deadline.moodle_open'); openExternal(a.sourceUrl); } },
  });

  if (reminding) {
    return <RemindSheet text={`${[code, a.title].filter(Boolean).join(' ')} — ${shortWhen(due)}`} at={due}
      startapp={`deadline_${a.id}`} assignmentId={a.id} onClose={() => setReminding(false)} />;
  }
  if (asking) {
    return (
      <Sheet onClose={() => setAsking(false)} label="Copilot">
        <AskPanel about={a.title} onBack={() => setAsking(false)}
          context={`${tr('дедлайн', 'deadline')} «${a.title}», ${[code, rest].filter(Boolean).join(' ')}, ${dayTitle(dayKey(due))} ${hm(due)}`}
          starters={[tr('Як розбити це на кроки?', 'How do I break this into steps?'), tr('Скільки часу закласти?', 'How much time should I plan?')]} />
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} label={a.title}>
      {a.isCompleted ? (
        <div className="sheet__label" style={a.submittedAt ? { color: 'var(--success)' } : undefined}>
          {a.submittedAt ? `${a.type === 'quiz' ? tr('Пройдено', 'Taken') : tr('Здано', 'Submitted')} ✓ ${dayTitle(dayKey(new Date(a.submittedAt)))}, ${hm(a.submittedAt)}` : tr('Зроблено', 'Done')}
        </div>
      ) : (
        <>
          <div className="sheet__label" style={late ? { color: 'var(--danger)' } : undefined}>{late ? tr('Прострочено на', 'Overdue by') : tr('Залишилось', 'Time left')}</div>
          <div className={`sheet__big${late ? ' sheet__big--late' : ''}`}>{big[0]}<small>{big.slice(1).join(' ')}</small></div>
        </>
      )}
      <div className="sheet__title" style={{ marginTop: a.isCompleted ? 6 : 0 }}>{a.title}</div>
      <div className="sheet__sub">{[code, rest].filter(Boolean).join(' ')}</div>

      <div className="group" style={{ marginTop: 16 }}>
        <div className="row"><div className="row__main"><div className="row__title num cap-first" style={{ fontWeight: 500 }}>{dayTitle(dayKey(due))}, {hm(due)}</div><div className="row__meta">{typeLabel()[a.type] ?? tr('Завдання', 'Assignment')}</div></div></div>
        {m && <MoodleFacts m={m} done={!!a.isCompleted} />}
        {m?.grade && (
          <button className="row press" disabled={!a.sourceUrl} onClick={() => { track('deadline.grade_open'); openExternal(a.sourceUrl!); }}>
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Оцінка', 'Grade')}</div></div>
            <span className="row__value num">{m.grade}</span>
            {a.sourceUrl && <ChevronRight className="chev" />}
          </button>
        )}
        {/^[A-Z]{2,6}\d{3}/.test(code ?? '') && (
          <button className="row press" onClick={() => { haptic.tap(); onClose(); useUi.getState().openCourse(code!.match(/^[A-Z]{2,6}\d{3}[A-Z]?/)![0]); }}>
            <BookOpen className="row-icon" strokeWidth={1.7} />
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr(`Сторінка курсу ${code}`, `${code} course page`)}</div></div>
            <ChevronRight className="chev" />
          </button>
        )}
        {!late && !a.isCompleted && (
          <button className="row press" onClick={() => { haptic.tap(); setReminding(true); }}>
            <Bell className="row-icon" strokeWidth={1.7} />
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Нагадати…', 'Remind me…')}</div><div className="row__meta">{tr('Собі або другу', 'Yourself or a friend')}</div></div>
            <ChevronRight className="chev" />
          </button>
        )}
        {a.feedbackAt && !m?.grade && (
          <button className="row press" disabled={!a.sourceUrl} aria-label={tr('Відкрити відгук у Moodle', 'Open feedback in Moodle')}
            onClick={() => { track('deadline.feedback_open'); openExternal(a.sourceUrl!); }}>
            <div className="row__main">
              <div className="row__title" style={{ fontWeight: 500 }}>{tr('Є відгук', 'Feedback is in')}</div>
              <div className="row__meta num cap-first">{dayTitle(dayKey(new Date(a.feedbackAt)))}, {hm(a.feedbackAt)}</div>
            </div>
            {a.sourceUrl && <ChevronRight className="chev" />}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <button className="btn-plain press" style={{ fontSize: 16 }} onClick={() => setAsking(true)}>{tr('Запитати Copilot', 'Ask Copilot')}</button>
        <button className="btn-plain press" style={{ fontSize: 16 }} onClick={onToggle}>
        {a.isCompleted ? tr('Повернути в список', 'Move back to the list') : tr('Позначити зробленим', 'Mark as done')}
      </button>
      </div>
      {!a.sourceUrl && <p className="note">{tr('Посилання на Moodle для цієї події немає.', 'This event has no Moodle link.')}</p>}
    </Sheet>
  );
}

/** What Moodle itself says beyond the date (owner-only test): extension, cut-off, quiz opening and attempts. */
function MoodleFacts({ m, done }: { m: MoodleExtra; done: boolean }) {
  // "Неділя, 1 листопада, 07:45", capitalised like the date row above
  const when = (iso: string) => { const t = `${dayTitle(dayKey(new Date(iso)))}, ${hm(iso)}`; return t[0].toUpperCase() + t.slice(1); };
  const opens = m.opensAt && new Date(m.opensAt).getTime() > now().getTime() ? m.opensAt : null;
  const attempts = m.attemptsUsed !== undefined && m.attemptsAllowed !== undefined
    ? (m.attemptsAllowed ? tr(`${m.attemptsUsed} з ${m.attemptsAllowed}`, `${m.attemptsUsed} of ${m.attemptsAllowed}`) : tr(`${m.attemptsUsed} · без обмежень`, `${m.attemptsUsed} · unlimited`))
    : null;
  return (
    <>
      {m.extendedFrom && <Fact label={tr('Продовжено', 'Extended')} meta={tr(`Було: ${when(m.extendedFrom)}`, `Was: ${when(m.extendedFrom)}`)} />}
      {m.cutoff && !done && <Fact label={tr('Жорсткий дедлайн', 'Hard cut-off')} meta={tr(`${when(m.cutoff)} — після нього Moodle не прийме`, `${when(m.cutoff)}, Moodle takes nothing after it`)} />}
      {opens && <Fact label={tr('Відкривається', 'Opens')} meta={when(opens)} />}
      {attempts && <Fact label={tr('Спроби', 'Attempts')} value={attempts} />}
    </>
  );
}

function Fact({ label, meta, value }: { label: string; meta?: ReactNode; value?: ReactNode }) {
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__title" style={{ fontWeight: 500 }}>{label}</div>
        {meta && <div className="row__meta num">{meta}</div>}
      </div>
      {value && <span className="row__value num">{value}</span>}
    </div>
  );
}

function ConnectSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((s) => s.user);
  // Owner-only test: one Moodle connection brings grades and deadlines, no calendar link
  if (user?.isAdmin) return <MoodleGradesSheet onClose={onSaved} />;
  return (
    <Sheet onClose={onClose} label={tr('Дедлайни з Moodle', 'Deadlines from Moodle')}>
      <div className="sheet__title">{tr('Дедлайни з Moodle', 'Deadlines from Moodle')}</div>
      <div className="sheet__sub" style={{ marginBottom: 16 }}>{tr('Три кроки в Moodle — і нагадування приходитимуть самі.', 'Three steps in Moodle, and reminders come on their own.')}</div>
      <MoodleConnectForm onSaved={onSaved} />
    </Sheet>
  );
}
