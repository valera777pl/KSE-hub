import { useEffect, useMemo, useState } from 'react';
import { BookCheck, ChevronDown, Link2, WifiOff } from 'lucide-react';
import { api, track } from '../../../api/client';
import type { DeadlineWithCourse } from '../../../types';
import { addDays, dayKey, dayTitle, hm, now, plural, spanText, todayKey, weekdayShort } from '../../../lib/time';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { useAuthStore } from '../../../stores/authStore';
import { useUi } from '../../../stores/uiStore';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, SkeletonRows } from '../../ui/States';
import { MoodleConnectForm } from './MoodleConnect';

const DAY = 86_400_000;
const LATE_KEEP = 7 * DAY;
const GENERAL = /general\s*\/\s*university/i;

const TYPE: Record<string, string> = { assignment: 'Завдання', quiz: 'Тест', event: 'Подія' };

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
  const [all, setAll] = useState<DeadlineWithCourse[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<number | null>(deadlineId);
  const [showGeneral, setShowGeneral] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setError(false);
    api.get<{ deadlines: DeadlineWithCourse[] }>('/moodle/deadlines?completed=true')
      .then((r) => setAll(r.deadlines)).catch(() => setError(true));
  }, [reload]);

  // A deep link from the bot opened this deadline; forget it so the tab opens plainly next time
  useEffect(() => { if (deadlineId) useUi.setState({ deadlineId: null }); }, []);

  const t = now().getTime();
  const { groups, general, done } = useMemo(() => {
    const live = (all ?? []).filter(({ assignment: a }) => a.dueDate && new Date(a.dueDate).getTime() > t - LATE_KEEP);
    const open = live.filter((d) => !d.assignment.isCompleted);
    const today = todayKey();
    const weekEnd = addDays(today, 7);
    const buckets: Group[] = [
      { title: 'Прострочено', items: [] }, { title: 'Сьогодні', items: [] }, { title: 'Завтра', items: [] },
      { title: 'Цього тижня', items: [] }, { title: 'Пізніше', items: [] },
    ];
    const general: DeadlineWithCourse[] = [];
    for (const d of open) {
      if (GENERAL.test(d.courseName ?? '')) { general.push(d); continue; }
      const due = new Date(d.assignment.dueDate!);
      const k = dayKey(due);
      const i = due.getTime() < t ? 0 : k === today ? 1 : k === addDays(today, 1) ? 2 : k < weekEnd ? 3 : 4;
      buckets[i].items.push(d);
    }
    return { groups: buckets.filter((b) => b.items.length), general, done: live.filter((d) => d.assignment.isCompleted) };
  }, [all, t]);

  const toggle = async (id: number) => {
    const was = all?.find((d) => d.assignment.id === id)?.assignment.isCompleted;
    setAll((list) => list?.map((d) => (d.assignment.id === id ? { ...d, assignment: { ...d.assignment, isCompleted: !d.assignment.isCompleted } } : d)) ?? null);
    try {
      await api.patch(`/moodle/assignments/${id}/toggle`);
      haptic.success();
      if (!was) track('deadline.done');
    } catch {
      haptic.error();
      setReload((n) => n + 1);
    }
  };

  const opened = all?.find((d) => d.assignment.id === openId) ?? null;

  if (error) {
    return <div className="group"><EmptyState icon={WifiOff} title="Не вдалося завантажити дедлайни" text="Перевір інтернет." action={{ label: 'Спробувати ще раз', onClick: () => setReload((n) => n + 1) }} /></div>;
  }
  if (!all) return <SkeletonRows rows={4} />;

  if (!user?.calendarUrl && all.length === 0) {
    return (
      <>
        <div className="group">
          <EmptyState icon={Link2} title="Додай дедлайни з Moodle" text="Хвилина — і всі здачі будуть тут, а бот нагадає за 24 і за 3 години."
            action={{ label: 'Підключити Moodle', onClick: () => setConnecting(true) }} />
        </div>
        {connecting && <ConnectSheet onClose={() => setConnecting(false)} onSaved={() => { setConnecting(false); setReload((n) => n + 1); }} />}
      </>
    );
  }

  const nothingOpen = groups.length === 0;

  return (
    <>
      {nothingOpen && (
        <div className="group"><EmptyState icon={BookCheck} title="Усе здано" text="Нові дедлайни зʼявляться тут, щойно викладач додасть їх у Moodle." /></div>
      )}

      {groups.map((g, gi) => (
        <section key={g.title}>
          <div className="caption" style={gi === 0 && !nothingOpen ? { marginTop: 4 } : undefined}>{g.title}</div>
          <div className="group">
            {g.items.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }} />)}
          </div>
        </section>
      ))}

      {general.length > 0 && (
        <>
          <div className="caption">Загальноуніверситетські</div>
          <div className="group">
            {showGeneral && general.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }} />)}
            <button className="row toggle-row" aria-expanded={showGeneral} onClick={() => { haptic.select(); setShowGeneral((v) => !v); }}>
              <span className="row__main">{showGeneral ? 'Згорнути' : `Показати ${general.length} ${plural(general.length, 'подію', 'події', 'подій')}`}</span>
              <ChevronDown size={18} strokeWidth={1.75} />
            </button>
          </div>
          {!showGeneral && <p className="note">Без нагадувань: це події для всіх студентів KSE.</p>}
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="caption">Зроблено</div>
          <div className="group">
            {showDone && done.map((d) => <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { haptic.tap(); setOpenId(d.assignment.id); }} />)}
            <button className="row toggle-row" aria-expanded={showDone} onClick={() => { haptic.select(); setShowDone((v) => !v); }}>
              <span className="row__main">{showDone ? 'Згорнути' : `Показати ${done.length}`}</span>
              <ChevronDown size={18} strokeWidth={1.75} />
            </button>
          </div>
        </>
      )}

      <p className="note" style={{ paddingTop: 16 }}>
        З календаря Moodle, оновлюється кожні 10 хв.{' '}
        <button className="link-btn" style={{ padding: 0, fontSize: 13 }} onClick={() => setConnecting(true)}>Змінити посилання</button>
      </p>

      {opened && <DeadlineSheet d={opened} onClose={() => setOpenId(null)} onToggle={() => { toggle(opened.assignment.id); setOpenId(null); }} />}
      {connecting && <ConnectSheet onClose={() => setConnecting(false)} onSaved={() => { setConnecting(false); setReload((n) => n + 1); }} />}
    </>
  );
}

function DeadlineRow({ d, onOpen }: { d: DeadlineWithCourse; onOpen: () => void }) {
  const { assignment: a } = d;
  const due = new Date(a.dueDate!);
  const left = due.getTime() - now().getTime();
  const late = left < 0 && !a.isCompleted;
  const k = dayKey(due);
  const [code, rest] = splitCourse(d.courseName);
  const whenDay = k === todayKey() ? 'сьог.' : k === addDays(todayKey(), 1) ? 'завтра' : weekdayShort(k).toLowerCase();
  return (
    <button className={`dl press${late ? ' dl--late' : ''}${a.isCompleted ? ' dl--done' : ''}`} onClick={onOpen}>
      <span className="dl__when"><b>{hm(due)}</b>{whenDay}</span>
      <span style={{ minWidth: 0 }}>
        <span className="dl__title clamp2">{a.title}</span>
        <span className="dl__meta" style={{ display: 'block' }}>{code || rest}{a.type !== 'assignment' && TYPE[a.type] ? ` · ${TYPE[a.type].toLowerCase()}` : ''}</span>
      </span>
      {!a.isCompleted && !late && left < 2 * DAY && <span className="dl__left">{spanText(left)}</span>}
    </button>
  );
}

function DeadlineSheet({ d, onClose, onToggle }: { d: DeadlineWithCourse; onClose: () => void; onToggle: () => void }) {
  const { assignment: a } = d;
  const due = new Date(a.dueDate!);
  const left = due.getTime() - now().getTime();
  const late = left < 0;
  const [code, rest] = splitCourse(d.courseName);
  const big = spanText(Math.abs(left)).split(' ');

  useMainButton({
    text: 'Відкрити в Moodle',
    visible: !!a.sourceUrl,
    onClick: () => { if (a.sourceUrl) { track('deadline.moodle_open'); openExternal(a.sourceUrl); } },
  });

  return (
    <Sheet onClose={onClose} label={a.title}>
      {a.isCompleted ? (
        <div className="now__label">Зроблено</div>
      ) : (
        <>
          <div className="now__label" style={late ? { color: 'var(--danger)' } : undefined}>{late ? 'Прострочено на' : 'Залишилось'}</div>
          <div className={`sheet__big${late ? ' sheet__big--late' : ''}`}>{big[0]}<small>{big.slice(1).join(' ')}</small></div>
        </>
      )}
      <div className="sheet__title" style={{ marginTop: a.isCompleted ? 6 : 0 }}>{a.title}</div>
      <div className="sheet__sub">{[code, rest].filter(Boolean).join(' ')}</div>

      <div className="group" style={{ marginTop: 16 }}>
        <div className="row"><div className="row__main"><div className="row__title num" style={{ fontWeight: 500 }}>{dayTitle(dayKey(due))}, {hm(due)}</div><div className="row__meta">{TYPE[a.type] ?? 'Завдання'}</div></div></div>
      </div>

      <button className="btn-plain press" style={{ marginTop: 12 }} onClick={onToggle}>
        {a.isCompleted ? 'Повернути в список' : 'Позначити зробленим'}
      </button>
      {!a.sourceUrl && <p className="note">Посилання на Moodle для цієї події немає.</p>}
    </Sheet>
  );
}

function ConnectSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet onClose={onClose} label="Дедлайни з Moodle">
      <div className="sheet__title">Дедлайни з Moodle</div>
      <div className="sheet__sub" style={{ marginBottom: 16 }}>Три кроки в Moodle — і нагадування приходитимуть самі.</div>
      <MoodleConnectForm onSaved={onSaved} />
    </Sheet>
  );
}
