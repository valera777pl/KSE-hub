import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ExternalLink, Hash, Lock, MessagesSquare, X } from 'lucide-react';
import { EmptyState } from '../ui/States';

/**
 * /admin → Slack (SLACK-DIGEST-PROMPT.md §5.2–5.3): summaries go out on their own; drafts wait here only from
 * channels with auto-publish off or not tied yet — the owner publishes, edits the points or rejects. Below, every
 * channel the reader account is in, with who sees it. Owner-only, Ukrainian only.
 */

type Item = { kind: 'deadline' | 'change' | 'announcement' | 'event' | 'other'; text: string; dueAt?: string; permalink: string };
type Draft = {
  id: number; channelId: string; channelName: string; isPrivate: boolean; courseCode: string | null; section: string | null;
  fromTs: string; toTs: string; items: Item[]; events: { title: string; startsAt: string; place?: string; permalink: string }[];
};
type Channel = {
  channelId: string; name: string; isPrivate: boolean; status: 'pending' | 'active' | 'hidden';
  courseCode: string | null; section: string | null; program: string | null; cohortYear: number | null;
  defaultOn: boolean; autoPublish: boolean; drafts: number; published: number;
};
type Overview = { channels: Channel[]; drafts: Draft[]; courses: { courseCode: string; title: string; sections: string[] }[]; programs: string[] };
type Scope = { kind: 'course'; courseCode: string; section: string | null } | { kind: 'cohort'; program: string | null; cohortYear: number } | null;

const API = import.meta.env.VITE_API_URL || '/api';
const KIND: Record<Item['kind'], string> = { deadline: 'Дедлайн', change: 'Зміна', announcement: 'Оголошення', event: 'Подія', other: 'Інше' };
/** The task runs at 08:40 and 19:40 Kyiv */
const nextRun = (now = new Date()) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Kyiv' }).format(now));
  const m = now.getMinutes();
  return h < 8 || (h === 8 && m < 40) ? 'о 08:40' : h < 19 || (h === 19 && m < 40) ? 'о 19:40' : 'завтра о 08:40';
};
const tsDay = (ts: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(Number(ts) * 1000));
const when = (iso: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(iso));
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Who sees the channel, in words: "MATH111 · P6", "BE · вступ 2026", "Усі студенти". */
export function audience(ch: Pick<Channel, 'isPrivate' | 'courseCode' | 'section' | 'program' | 'cohortYear'>) {
  if (!ch.isPrivate) return 'Усі студенти';
  if (ch.courseCode) return ch.section ? `${ch.courseCode} · ${ch.section}` : `${ch.courseCode} · увесь курс`;
  if (ch.cohortYear) return `${ch.program ?? 'Усі програми'} · вступ ${ch.cohortYear}`;
  return 'Не привʼязаний — ніхто не бачить';
}

export function AdminSlack({ auth, onCount }: { auth: string; onCount: (sub: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(`${API}/admin${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json' } })
      .catch(() => { throw new Error('Немає звʼязку з сервером. Перевір інтернет і спробуй ще раз.'); });
    if (r.status === 401 || r.status === 403) throw new Error('Посилання недійсне або застаріло — надішли боту /admin ще раз.');
    if (!r.ok) {
      // 4xx carry our own Ukrainian reason ("Чернетку не знайдено…"); anything else is the server failing
      const reason = r.status < 500 ? (await r.json().catch(() => null))?.error : null;
      throw new Error(typeof reason === 'string' ? reason : 'Сервер не відповів. Онови сторінку за хвилину.');
    }
    return r.json() as Promise<T>;
  };

  useEffect(() => {
    let live = true;
    call<Overview>('/slack').then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    if (data) onCount(`${data.drafts.length} ${plural(data.drafts.length, 'чернетка', 'чернетки', 'чернеток')} · ${data.channels.length} ${plural(data.channels.length, 'канал', 'канали', 'каналів')}`);
  }, [data, onCount]);

  if (error && !data) return <EmptyState icon={AlertCircle} title="Не вдалося завантажити" text={error} />;
  if (!data) return <Skeleton />;
  if (!data.channels.length) {
    return <EmptyState icon={MessagesSquare} title="Каналів ще немає"
      text={`Вони зʼявляться після першого прогону задачі Claude — ${nextRun()}. Додай акаунт-читач у канал у Slack.`} />;
  }

  const drop = (id: number) => setData((d) => d && { ...d, drafts: d.drafts.filter((x) => x.id !== id) });
  const patchChannel = async (id: string, patch: { scope?: Scope; status?: 'active' | 'hidden'; autoPublish?: boolean; defaultOn?: boolean }) => {
    const { channel } = await call<{ channel: Channel }>(`/slack/channels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setData((d) => d && { ...d, channels: d.channels.map((c) => (c.channelId === id ? { ...c, ...channel } : c)) });
  };
  const pending = data.channels.filter((c) => c.status === 'pending');

  return (
    <>
      <section className="adm-block">
        <p className="adm-kicker">Чернетки</p>
        <h2 className="adm-headline">
          {data.drafts.length
            ? `${data.drafts.length} ${plural(data.drafts.length, 'чернетка чекає', 'чернетки чекають', 'чернеток чекають')} перевірки`
            : `Нових чернеток немає — підсумки йдуть студентам самі. Наступний прогін ${nextRun()}`}
        </h2>
        {data.drafts.map((d) => (
          <DraftCard key={d.id} draft={d}
            onPublish={async (items) => { await call(`/slack/summaries/${d.id}/publish`, { method: 'POST', body: JSON.stringify(items ? { items } : {}) }); }}
            onReject={async () => { await call(`/slack/summaries/${d.id}/reject`, { method: 'POST' }); }}
            onGone={() => drop(d.id)} />
        ))}
      </section>

      <section className="adm-block">
        <p className="adm-kicker">Канали</p>
        <h2 className="adm-headline">
          {pending.length
            ? `${pending.length === 1 ? `#${pending[0].name}` : `${pending.length} ${plural(pending.length, 'канал', 'канали', 'каналів')}`} ${pending.length === 1 ? 'чекає' : 'чекають'} привʼязки — поки ніхто не бачить`
            : 'Кожен закритий канал бачать лише його студенти'}
        </h2>
        <div className="group">
          {data.channels.map((c) => <ChannelRow key={c.channelId} ch={c} courses={data.courses} programs={data.programs} onPatch={(p) => patchChannel(c.channelId, p)} />)}
        </div>
      </section>
    </>
  );
}

function ChannelIcon({ isPrivate }: { isPrivate: boolean }) {
  return isPrivate ? <Lock className="adm-ch__icon" aria-label="Закритий" /> : <Hash className="adm-ch__icon" aria-label="Відкритий" />;
}

/* ─── A draft: the points as students will read them, each with its link; publish as is, edit, or reject ─── */

function DraftCard({ draft, onPublish, onReject, onGone }: {
  draft: Draft; onPublish: (items?: Item[]) => Promise<void>; onReject: () => Promise<void>; onGone: () => void;
}) {
  const [editing, setEditing] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<'publish' | 'reject' | null>(null);
  const [done, setDone] = useState<'published' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'publish' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'publish') await onPublish(editing ?? undefined);
      else await onReject();
      setDone(kind === 'publish' ? 'published' : 'rejected');
      setTimeout(onGone, 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const items = editing ?? draft.items;
  const changed = editing && (editing.length !== draft.items.length || editing.some((it, i) => it.text !== draft.items[i]?.text));

  if (done) {
    return (
      <div className="group adm-card adm-draft adm-draft--done" role="status">
        <Check aria-hidden /> {done === 'published' ? `#${draft.channelName} опубліковано` : `#${draft.channelName} відхилено`}
      </div>
    );
  }

  return (
    <article className="group adm-card adm-draft">
      <header className="adm-draft__head">
        <ChannelIcon isPrivate={draft.isPrivate} />
        <div className="adm-draft__title">
          <b>{draft.channelName}</b>
          <span className="num">{audience(draft)} · {tsDay(draft.fromTs)} – {tsDay(draft.toTs)}</span>
        </div>
      </header>

      <ol className="adm-points">
        {items.map((it, i) => (
          <li key={i}>
            {editing ? (
              <div className="adm-points__edit">
                <textarea className="field" rows={2} value={it.text} aria-label={`Пункт ${i + 1}`}
                  onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button className="adm-icon-btn press" aria-label={`Прибрати пункт ${i + 1}`} disabled={editing.length === 1}
                  onClick={() => setEditing(editing.filter((_, j) => j !== i))}><X /></button>
              </div>
            ) : (
              <>
                <p>{it.text}</p>
                <span className="adm-points__meta">
                  {KIND[it.kind]}{it.dueAt && <span className="num"> · {when(it.dueAt)}</span>}
                  <a href={it.permalink} target="_blank" rel="noreferrer">Оригінал <ExternalLink aria-hidden /></a>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>

      {draft.events.length > 0 && !editing && (
        <p className="adm-draft__events">
          У «Події» після публікації: {draft.events.map((e) => `${e.title} — ${when(e.startsAt)}`).join('; ')}
        </p>
      )}
      {error && <p className="adm-draft__error" role="alert">{error}</p>}

      {/* One filled button for the main action; the other two share the row below */}
      <div className="adm-actions">
        <button className="adm-btn adm-btn--accent adm-btn--wide press" disabled={!!busy || editing?.some((it) => !it.text.trim())} onClick={() => run('publish')}>
          {busy === 'publish' ? 'Публікуємо…' : changed ? 'Опублікувати з правками' : 'Опублікувати'}
        </button>
        {editing
          ? <button className="adm-btn adm-btn--wide press" disabled={!!busy} onClick={() => setEditing(null)}>Скасувати правки</button>
          : (
            <>
              <button className="adm-btn press" disabled={!!busy} onClick={() => setEditing(draft.items.map((it) => ({ ...it })))}>Редагувати</button>
              <button className="adm-btn adm-btn--danger press" disabled={!!busy} onClick={() => run('reject')}>
                {busy === 'reject' ? 'Відхиляємо…' : 'Відхилити'}
              </button>
            </>
          )}
      </div>
    </article>
  );
}

/* ─── A channel: who sees it; tap to tie it to a course or cohort, hide it, let it publish on its own ─── */

function ChannelRow({ ch, courses, programs, onPatch }: {
  ch: Channel; courses: Overview['courses']; programs: string[];
  onPatch: (p: { scope?: Scope; status?: 'active' | 'hidden'; autoPublish?: boolean; defaultOn?: boolean }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (p: Parameters<typeof onPatch>[0]) => { setError(null); onPatch(p).catch((e: Error) => setError(e.message)); };
  const panelId = `ch-${ch.channelId}`;

  return (
    <div className="adm-ch">
      <button className="row adm-ch__row" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <ChannelIcon isPrivate={ch.isPrivate} />
        <div className="row__main">
          <div className="adm-ch__name">{ch.name}</div>
          <div className={`adm-ch__sub${ch.status === 'pending' ? ' adm-ch__sub--warn' : ''}`}>
            {[
              ch.status === 'hidden' ? 'Сховано — ніхто не бачить' : audience(ch),
              ch.status !== 'hidden' && !ch.isPrivate && (ch.defaultOn ? 'увімкнений одразу' : 'за бажанням'),
              ch.autoPublish && ch.status === 'active' && 'автопублікація',
            ].filter(Boolean).join(' · ')}
          </div>
          {ch.drafts > 0 && <div className="adm-ch__drafts num">{ch.drafts} {plural(ch.drafts, 'чернетка', 'чернетки', 'чернеток')}</div>}
        </div>
        <ChevronDown className="chev adm-ch__chev" aria-hidden />
      </button>

      {open && (
        <div className="adm-ch__panel" id={panelId}>
          {ch.isPrivate && <Binding ch={ch} courses={courses} programs={programs} onSave={(scope) => save({ scope })} />}
          {!ch.isPrivate && (
            <Toggle label="Увімкнений для нових студентів" checked={ch.defaultOn} onChange={(v) => save({ defaultOn: v })} />
          )}
          <Toggle label="Автопублікація" note="Вимкни, щоб підсумки цього каналу спершу чекали тут на перевірку"
            checked={ch.autoPublish} disabled={ch.status !== 'active'} onChange={(v) => save({ autoPublish: v })} />
          {error && <p className="adm-draft__error" role="alert">{error}</p>}
          <button className="adm-ch__hide press" onClick={() => save({ status: ch.status === 'hidden' ? 'active' : 'hidden' })}>
            {ch.status === 'hidden' ? 'Показати канал' : 'Сховати канал'}
          </button>
        </div>
      )}
    </div>
  );
}

function Binding({ ch, courses, programs, onSave }: {
  ch: Channel; courses: Overview['courses']; programs: string[]; onSave: (s: Scope) => void;
}) {
  const [kind, setKind] = useState<'course' | 'cohort'>(ch.cohortYear ? 'cohort' : 'course');
  const [course, setCourse] = useState(ch.courseCode ?? '');
  const [section, setSection] = useState(ch.section ?? '');
  const [program, setProgram] = useState(ch.program ?? '');
  const [year, setYear] = useState(String(ch.cohortYear ?? new Date().getFullYear()));
  const sections = courses.find((c) => c.courseCode === course)?.sections ?? [];
  const thisYear = new Date().getFullYear();

  const scope: Scope = kind === 'course'
    ? (course ? { kind: 'course', courseCode: course, section: section || null } : null)
    : { kind: 'cohort', program: program || null, cohortYear: Number(year) };
  const same = JSON.stringify(scope) === JSON.stringify(
    ch.courseCode ? { kind: 'course', courseCode: ch.courseCode, section: ch.section }
      : ch.cohortYear ? { kind: 'cohort', program: ch.program, cohortYear: ch.cohortYear } : null,
  );

  return (
    <div className="adm-bind">
      <span className="field-label">Хто бачить</span>
      <div className="seg" role="group" aria-label="Привʼязка">
        <button aria-pressed={kind === 'course'} onClick={() => setKind('course')}>Курс</button>
        <button aria-pressed={kind === 'cohort'} onClick={() => setKind('cohort')}>Потік</button>
      </div>
      {kind === 'course' ? (
        <div className="adm-bind__fields">
          <select className="field" aria-label="Курс" value={course} onChange={(e) => { setCourse(e.target.value); setSection(''); }}>
            <option value="">Обери курс</option>
            {courses.map((c) => <option key={c.courseCode} value={c.courseCode}>{c.courseCode} · {c.title.replace(/\s*\([^)]*\)\s*$/, '')}</option>)}
          </select>
          <select className="field" aria-label="Секція" value={section} disabled={!course} onChange={(e) => setSection(e.target.value)}>
            <option value="">Увесь курс</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ) : (
        <div className="adm-bind__fields">
          <select className="field" aria-label="Програма" value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value="">Усі програми</option>
            {programs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="field num" aria-label="Рік вступу" value={year} onChange={(e) => setYear(e.target.value)}>
            {[0, 1, 2, 3, 4].map((k) => <option key={k} value={thisYear - k}>вступ {thisYear - k}</option>)}
          </select>
        </div>
      )}
      {same && scope
        ? <p className="adm-bind__saved"><Check aria-hidden /> Бачать: {audience({ isPrivate: true, ...scopeFields(scope) })}</p>
        : <button className="adm-btn adm-btn--accent adm-btn--wide press adm-bind__save" disabled={!scope} onClick={() => onSave(scope)}>Зберегти привʼязку</button>}
    </div>
  );
}

const scopeFields = (s: Scope) => ({
  courseCode: s?.kind === 'course' ? s.courseCode : null, section: s?.kind === 'course' ? s.section : null,
  program: s?.kind === 'cohort' ? s.program : null, cohortYear: s?.kind === 'cohort' ? s.cohortYear : null,
});

function Toggle({ label, note, checked, disabled, onChange }: { label: string; note?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`adm-toggle${disabled ? ' adm-toggle--off' : ''}`}>
      <span>
        {label}
        {note && <small>{note}</small>}
      </span>
      <button role="switch" className="switch" aria-checked={checked} disabled={disabled} aria-label={label} onClick={() => onChange(!checked)} />
    </label>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Завантаження">
      <div className="skel" style={{ height: 22, width: '70%', margin: '24px 0 12px' }} />
      {[0, 1].map((i) => <div key={i} className="group adm-card"><div className="skel" style={{ height: 120 }} /></div>)}
    </div>
  );
}
