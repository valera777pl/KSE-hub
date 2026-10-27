import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Inbox, Plus, Rocket, Search, WifiOff } from 'lucide-react';
import { api } from '../../../api/client';
import type { Application, StartupCard, VentureProject } from '../../../types';
import { tr } from '../../../lib/i18n';
import { haptic, tg, useMainButton } from '../../../lib/telegram';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, SkeletonRows } from '../../ui/States';

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const statusLabel = (s: Application['status']) =>
  s === 'pending' ? tr('На розгляді', 'Pending') : s === 'accepted' ? tr('Прийнято', 'Accepted') : tr('Відхилено', 'Declined');

export function openContact(url: string) {
  const app = tg();
  if (url.startsWith('https://t.me/') && app) app.openTelegramLink(url);
  else window.open(url, '_blank');
}

/** Можливості → Стартапи: join someone's team or post your own. Applications live one tap away. */
export function Startups() {
  const [startups, setStartups] = useState<StartupCard[] | null>(null);
  const [mine, setMine] = useState<VentureProject[]>([]);
  const [apps, setApps] = useState<{ incoming: Application[]; outgoing: Application[] } | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<VentureProject | 'new' | null>(null);
  const [open, setOpen] = useState<StartupCard | null>(null);
  const [inbox, setInbox] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [list, my, a] = await Promise.all([
        api.get<{ startups: StartupCard[] }>(`/venture/startups${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`),
        api.get<{ projects: VentureProject[] }>('/venture/projects'),
        api.get<{ incoming: Application[]; outgoing: Application[] }>('/venture/applications'),
      ]);
      setStartups(list.startups);
      setMine(my.projects);
      setApps(a);
    } catch { setError(true); }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const pending = apps?.incoming.filter((a) => a.status === 'pending').length ?? 0;
  const appCount = (apps?.incoming.length ?? 0) + (apps?.outgoing.length ?? 0);

  return (
    <>
      <div className="group">
        {mine.map((p) => (
          <button key={p.id} className="row press" onClick={() => { haptic.tap(); setEditing(p); }}>
            <Rocket className="row-icon" strokeWidth={1.75} />
            <div className="row__main">
              <div className="row__title">{p.title}</div>
              <div className="row__meta">{p.isActive ? tr('Твій стартап · набір відкрито', 'Your startup · recruiting') : tr('Твій стартап · набір закрито', 'Your startup · closed')}</div>
            </div>
            <ChevronRight className="chev" strokeWidth={1.75} />
          </button>
        ))}
        <button className="row press" style={{ color: 'var(--accent)' }} onClick={() => { haptic.tap(); setEditing('new'); }}>
          <Plus className="row-icon" strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
          <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Додати свій стартап', 'Post your startup')}</div></div>
        </button>
        {appCount > 0 && (
          <button className="row press" onClick={() => { haptic.tap(); setInbox(true); }}>
            <Inbox className="row-icon" strokeWidth={1.75} />
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Заявки', 'Applications')}</div></div>
            {pending > 0 && <span className="pill pill--accent">{tr(`${pending} нових`, `${pending} new`)}</span>}
            <ChevronRight className="chev" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="field-wrap" style={{ marginTop: 16 }}>
        <Search strokeWidth={1.75} />
        <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Ідея, роль, автор', 'Idea, role, author')} enterKeyHint="search" />
      </div>

      {error ? (
        <div className="group" style={{ marginTop: 16 }}><EmptyState icon={WifiOff} title={tr('Не вдалося завантажити', "Couldn't load")} action={{ label: tr('Спробувати ще раз', 'Try again'), onClick: load }} /></div>
      ) : !startups ? (
        <div style={{ marginTop: 16 }}><SkeletonRows rows={3} /></div>
      ) : startups.length === 0 ? (
        <div className="group" style={{ marginTop: 16 }}>
          <EmptyState icon={Rocket} title={query ? tr('Нічого не знайшли', 'Nothing found') : tr('Поки немає відкритих стартапів', 'No open startups yet')}
            text={query ? undefined : tr('Додай свій — його побачать усі студенти KSE Hub.', 'Post yours and every KSE Hub student will see it.')} />
        </div>
      ) : (
        <>
          <div className="caption">{tr('Шукають команду', 'Looking for a team')}</div>
          <div className="group">
            {startups.map((c) => (
              <button key={c.project.id} className="row opp press" onClick={() => { haptic.tap(); setOpen(c); }}>
                <span className="org" aria-hidden="true">{c.project.title.trim()[0]?.toUpperCase()}</span>
                <div className="row__main">
                  <div className="row__title">{c.project.title}</div>
                  {c.project.pitch && <div className="opp__org clamp2">{c.project.pitch}</div>}
                  <div className="row__meta">{[c.project.requiredRoles?.slice(0, 3).join(', '), c.author.name].filter(Boolean).join(' · ')}</div>
                </div>
                {c.myStatus && <span className="pill pill--accent">{statusLabel(c.myStatus)}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {editing && <ProjectSheet project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {open && <StartupSheet card={open} onClose={() => setOpen(null)} onApplied={() => { setOpen(null); load(); }} />}
      {inbox && apps && <ApplicationsSheet apps={apps} onClose={() => setInbox(false)} onChanged={load} />}
    </>
  );
}

function StartupSheet({ card, onClose, onApplied }: { card: StartupCard; onClose: () => void; onApplied: () => void }) {
  const p = card.project;
  const [applying, setApplying] = useState(false);
  const [role, setRole] = useState(p.requiredRoles?.[0] ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/venture/projects/${p.id}/apply`, { role: role || undefined, message: message.trim() || undefined });
      haptic.success();
      onApplied();
    } catch (e) { haptic.error(); setError((e as Error).message); }
    setBusy(false);
  };

  useMainButton({
    text: applying ? tr('Надіслати заявку', 'Send application') : tr('Хочу в команду', 'I want to join'),
    visible: !card.myStatus,
    loading: busy,
    onClick: () => (applying ? send() : setApplying(true)),
  });

  return (
    <Sheet onClose={applying ? () => setApplying(false) : onClose} label={p.title}>
      <div className="sheet__title">{p.title}</div>
      <div className="sheet__sub">{tr('Автор', 'By')}: {card.author.name}</div>
      {!applying ? (
        <>
          {p.pitch && <p className="desc">{p.pitch}</p>}
          {p.problem && <><div className="person__label">{tr('Яку проблему вирішують', 'Problem they solve')}</div><p className="desc" style={{ marginTop: 4 }}>{p.problem}</p></>}
          {p.requiredRoles?.length > 0 && <><div className="person__label">{tr('Кого шукають', 'Looking for')}</div><div className="tags">{p.requiredRoles.map((r) => <span key={r} className="tag">{r}</span>)}</div></>}
          {p.commitmentLevel && <><div className="person__label">{tr('Скільки часу', 'Time needed')}</div><p className="desc" style={{ marginTop: 4 }}>{p.commitmentLevel}</p></>}
          {card.myStatus && <p className="note" style={{ paddingTop: 16 }}>{tr('Твоя заявка', 'Your application')}: {statusLabel(card.myStatus)}</p>}
        </>
      ) : (
        <>
          {p.requiredRoles?.length > 0 && (
            <>
              <span className="field-label">{tr('Роль', 'Role')}</span>
              <div className="pills" style={{ flexWrap: 'wrap', margin: 0 }}>
                {[...p.requiredRoles, tr('Інше', 'Other')].map((r) => <button key={r} className="press" aria-pressed={role === r} onClick={() => { haptic.select(); setRole(r); }}>{r}</button>)}
              </div>
            </>
          )}
          <label className="field-label" htmlFor="apply-msg">{tr('Коротко про себе і чому цей проєкт', 'A few words about you and why this project')}</label>
          <textarea id="apply-msg" className="field" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
          <p className="note">{tr('Автору прийде сповіщення в бот. Якщо прийме — ви отримаєте Telegram одне одного.', "The author gets a note in the bot. If they accept, you'll both get each other's Telegram.")}</p>
          {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
        </>
      )}
    </Sheet>
  );
}

function ProjectSheet({ project, onClose, onDone }: { project: VentureProject | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    title: project?.title ?? '', pitch: project?.pitch ?? '', problem: project?.problem ?? '',
    roles: project?.requiredRoles?.join(', ') ?? '', commitmentLevel: project?.commitmentLevel ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); haptic.success(); onDone(); } catch (e) { haptic.error(); setError((e as Error).message); }
    setBusy(false);
  };
  const save = () => run(() => {
    const body = { title: form.title.trim(), pitch: form.pitch.trim(), problem: form.problem.trim(), requiredRoles: splitList(form.roles), commitmentLevel: form.commitmentLevel.trim() };
    return project ? api.put(`/venture/projects/${project.id}`, body) : api.post('/venture/projects', body);
  });

  useMainButton({ text: project ? tr('Зберегти', 'Save') : tr('Опублікувати', 'Publish'), onClick: save, disabled: !form.title.trim(), loading: busy });

  const input = (key: keyof typeof form, label: string, placeholder: string, area = false) => (
    <>
      <label className="field-label" htmlFor={`p-${key}`}>{label}</label>
      {area
        ? <textarea id={`p-${key}`} className="field" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        : <input id={`p-${key}`} className="field" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />}
    </>
  );

  return (
    <Sheet onClose={onClose} label={tr('Стартап', 'Startup')}>
      <div className="sheet__title">{project ? project.title : tr('Твій стартап', 'Your startup')}</div>
      {input('title', tr('Назва', 'Name'), tr('Напр. StudyBuddy', 'e.g. StudyBuddy'))}
      {input('pitch', tr('Ідея одним абзацом', 'The idea in one paragraph'), tr('Що робите і для кого', 'What you build and for whom'), true)}
      {input('problem', tr('Яку проблему вирішуєте', 'What problem you solve'), tr('Необовʼязково', 'Optional'), true)}
      {input('roles', tr('Кого шукаєте, через кому', 'Who you need, comma-separated'), 'Frontend, Designer, Marketing')}
      {input('commitmentLevel', tr('Скільки часу треба', 'Time needed'), tr('Напр. 5–10 год на тиждень', 'e.g. 5–10 h a week'))}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {project && (
        <button className="btn-plain press" style={{ marginTop: 20, color: project.isActive ? 'var(--danger)' : 'var(--accent)' }} disabled={busy}
          // Saving a closed startup reopens it (the server sets it active on every update)
          onClick={() => (project.isActive ? run(() => api.post(`/venture/projects/${project.id}/close`)) : save())}>
          {project.isActive ? tr('Закрити набір', 'Stop recruiting') : tr('Відкрити набір знову', 'Recruit again')}
        </button>
      )}
    </Sheet>
  );
}

function ApplicationsSheet({ apps, onClose, onChanged }: { apps: { incoming: Application[]; outgoing: Application[] }; onClose: () => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: number, accept: boolean) => {
    setError(null);
    try { await api.post(`/venture/applications/${id}/decide`, { accept }); haptic.success(); onChanged(); }
    catch (e) { haptic.error(); setError((e as Error).message); }
  };

  return (
    <Sheet onClose={onClose} label={tr('Заявки', 'Applications')}>
      <div className="sheet__title">{tr('Заявки', 'Applications')}</div>
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
      {apps.incoming.length > 0 && <div className="caption">{tr('До твоїх стартапів', 'To your startups')}</div>}
      {apps.incoming.map((a) => (
        <div key={a.id} className="group" style={{ marginBottom: 8 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="row__main">
              <div className="row__title">{a.applicant!.name}</div>
              <div className="row__meta">«{a.project.title}»{a.role ? ` · ${a.role}` : ''}</div>
              {a.applicant!.headline && <div className="desc" style={{ marginTop: 6, fontSize: 14 }}>{a.applicant!.headline}</div>}
              {a.applicant!.skills.length > 0 && <div className="tags">{a.applicant!.skills.slice(0, 6).map((s) => <span key={s} className="tag">{s}</span>)}</div>}
              {a.message && <div className="desc" style={{ marginTop: 8, fontSize: 14 }}>«{a.message}»</div>}
            </div>
            {a.status !== 'pending' && <span className="pill pill--accent">{statusLabel(a.status)}</span>}
          </div>
          {a.status === 'pending' && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn-plain btn-accent press" style={{ height: 40, fontSize: 15 }} onClick={() => decide(a.id, true)}>{tr('Прийняти', 'Accept')}</button>
              <button className="btn-plain press" style={{ height: 40, fontSize: 15, color: 'var(--text)', background: 'var(--fill)' }} onClick={() => decide(a.id, false)}>{tr('Відхилити', 'Decline')}</button>
            </div>
          )}
          {a.applicant!.contact && a.status === 'accepted' && (
            <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500 }} onClick={() => openContact(a.applicant!.contact!)}>{tr('Написати в Telegram', 'Message on Telegram')}</button>
          )}
        </div>
      ))}
      {apps.outgoing.length > 0 && (
        <>
          <div className="caption">{tr('Твої заявки', 'Your applications')}</div>
          <div className="group">
            {apps.outgoing.map((a) => (
              <div key={a.id} className="row">
                <div className="row__main">
                  <div className="row__title">«{a.project.title}»</div>
                  <div className="row__meta">{a.author!.name}{a.role ? ` · ${a.role}` : ''}</div>
                </div>
                {a.author!.contact
                  ? <button className="link-btn" onClick={() => openContact(a.author!.contact!)}>{tr('Написати', 'Message')}</button>
                  : <span className="row__side">{statusLabel(a.status)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
