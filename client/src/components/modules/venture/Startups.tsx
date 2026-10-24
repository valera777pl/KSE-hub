import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { Application, StartupCard, VentureProfile, VentureProject } from '../../../types';

const STATUS: Record<Application['status'], { label: string; className: string }> = {
  pending: { label: 'На розгляді', className: 'badge--all' },
  accepted: { label: 'Прийнято', className: 'badge--grant' },
  declined: { label: 'Відхилено', className: 'badge--deadline' },
};

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function openContact(url: string) {
  // @ts-ignore - Telegram WebApp SDK
  const tg = window.Telegram?.WebApp;
  if (url.startsWith('https://t.me/') && tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left', maxHeight: '85vh', overflowY: 'auto' }}>
        <h2 className="modal__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="text-sm" style={{ color: 'var(--danger)', margin: '8px 0' }}>❌ {error}</div> : null;
}

/** Create or edit my startup. */
export function ProjectForm({ project, onDone, onClose }: { project: VentureProject | null; onDone: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    title: project?.title ?? '',
    pitch: project?.pitch ?? '',
    problem: project?.problem ?? '',
    roles: project?.requiredRoles?.join(', ') ?? '',
    commitmentLevel: project?.commitmentLevel ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { title: form.title.trim(), pitch: form.pitch.trim(), problem: form.problem.trim(), requiredRoles: splitList(form.roles), commitmentLevel: form.commitmentLevel.trim() };
      if (project) await api.put(`/venture/projects/${project.id}`, body);
      else await api.post('/venture/projects', body);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, area = false) => (
    <div className="input-group">
      <label className="input-group__label">{label}</label>
      {area
        ? <textarea className="input" rows={3} value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        : <input className="input" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />}
    </div>
  );

  return (
    <Modal title={project ? 'Редагувати стартап' : 'Новий стартап'} onClose={onClose}>
      {field('title', 'Назва', 'Напр. StudyBuddy')}
      {field('pitch', 'Ідея одним абзацом', 'Що робите і для кого', true)}
      {field('problem', 'Яку проблему вирішуєте', 'Необовʼязково', true)}
      {field('roles', 'Кого шукаєте (через кому)', 'Frontend, Designer, Marketing')}
      {field('commitmentLevel', 'Скільки часу треба', 'Напр. 5–10 год/тиждень')}
      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="btn btn--secondary" onClick={onClose}>Скасувати</button>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={submit} disabled={busy || !form.title.trim()}>{busy ? '…' : 'Зберегти'}</button>
      </div>
    </Modal>
  );
}

/** "About me" card the startup author sees with an application; also puts me into the People deck. */
export function ProfileForm({ profile, onDone, onClose }: { profile: VentureProfile | null; onDone: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    title: profile?.title ?? '',
    bio: profile?.bio ?? '',
    skills: profile?.skills?.join(', ') ?? '',
    lookingFor: profile?.lookingFor?.join(', ') ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/venture/profile', { title: form.title.trim(), bio: form.bio.trim(), skills: splitList(form.skills), lookingFor: splitList(form.lookingFor) });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Мій профіль" onClose={onClose}>
      <div className="input-group">
        <label className="input-group__label">Хто ти одним рядком</label>
        <input className="input" value={form.title} placeholder="Напр. Python-розробник, 1 курс BE" onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="input-group">
        <label className="input-group__label">Про себе</label>
        <textarea className="input" rows={3} value={form.bio} placeholder="Досвід, інтереси" onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      </div>
      <div className="input-group">
        <label className="input-group__label">Навички (через кому)</label>
        <input className="input" value={form.skills} placeholder="Python, Figma, SQL" onChange={(e) => setForm({ ...form, skills: e.target.value })} />
      </div>
      <div className="input-group">
        <label className="input-group__label">Що шукаєш (через кому)</label>
        <input className="input" value={form.lookingFor} placeholder="Стартап, команда на хакатон" onChange={(e) => setForm({ ...form, lookingFor: e.target.value })} />
      </div>
      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="btn btn--secondary" onClick={onClose}>Скасувати</button>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={submit} disabled={busy || !form.title.trim()}>{busy ? '…' : 'Зберегти'}</button>
      </div>
    </Modal>
  );
}

function ApplyForm({ card, onDone, onClose }: { card: StartupCard; onDone: () => void; onClose: () => void }) {
  const [role, setRole] = useState(card.project.requiredRoles?.[0] ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/venture/projects/${card.project.id}/apply`, { role: role || undefined, message: message.trim() || undefined });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Заявка в «${card.project.title}»`} onClose={onClose}>
      {card.project.requiredRoles?.length > 0 && (
        <div className="input-group">
          <label className="input-group__label">Роль</label>
          <div className="filter-chips">
            {[...card.project.requiredRoles, 'Інше'].map((r) => (
              <button key={r} className={`filter-chip ${role === r ? 'filter-chip--active' : ''}`} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
      <div className="input-group">
        <label className="input-group__label">Коротко про себе і чому цей проєкт</label>
        <textarea className="input" rows={4} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Автор побачить це разом з твоїм профілем" />
      </div>
      <div className="text-sm text-hint">Автору прийде сповіщення в бот. Якщо прийме — ви отримаєте Telegram одне одного.</div>
      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button className="btn btn--secondary" onClick={onClose}>Скасувати</button>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={submit} disabled={busy}>{busy ? '…' : 'Надіслати заявку'}</button>
      </div>
    </Modal>
  );
}

/** Tab «Стартапи»: my startups on top, then everyone else's with "join" buttons. */
export function StartupsTab() {
  const [startups, setStartups] = useState<StartupCard[]>([]);
  const [mine, setMine] = useState<VentureProject[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<VentureProject | null | 'new'>(null);
  const [applying, setApplying] = useState<StartupCard | null>(null);

  const load = useCallback(async () => {
    const [list, my] = await Promise.all([
      api.get<{ startups: StartupCard[] }>(`/venture/startups${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`),
      api.get<{ projects: VentureProject[] }>('/venture/projects'),
    ]);
    setStartups(list.startups);
    setMine(my.projects);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { load().catch(() => setLoading(false)); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const close = async (p: VentureProject) => {
    await api.post(`/venture/projects/${p.id}/close`);
    load();
  };

  return (
    <>
      <div className="card" style={{ padding: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: mine.length ? '10px' : 0 }}>
          <div className="font-semibold" style={{ flex: 1 }}>Мої стартапи</div>
          <button className="btn btn--primary btn--small" onClick={() => setEditing('new')}>+ Створити</button>
        </div>
        {mine.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-semibold">{p.title}</div>
              <div className="text-sm text-hint">{p.isActive ? 'Набір відкрито' : 'Набір закрито'}</div>
            </div>
            <button className="btn btn--secondary btn--small" onClick={() => setEditing(p)}>{p.isActive ? 'Змінити' : 'Відкрити знову'}</button>
            {p.isActive && <button className="btn btn--secondary btn--small" onClick={() => close(p)}>Закрити</button>}
          </div>
        ))}
        {!mine.length && <div className="text-sm text-hint" style={{ marginTop: '6px' }}>Маєш ідею? Опиши її — студенти зможуть подати заявку в команду.</div>}
      </div>

      <input className="input mb-md" placeholder="🔎 Пошук стартапу" value={query} onChange={(e) => setQuery(e.target.value)} />

      {loading ? (
        <div className="skeleton skeleton--card" />
      ) : startups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🚀</div>
          <div className="empty-state__title">Поки немає відкритих стартапів</div>
          <div className="empty-state__text">Створи свій — і він зʼявиться тут для всіх.</div>
        </div>
      ) : (
        startups.map((card) => (
          <div key={card.project.id} className="opportunity-card">
            <div className="opportunity-card__top">
              <span className="opportunity-card__company">🚀 {card.author.name}</span>
              {card.myStatus && <span className={`badge ${STATUS[card.myStatus].className}`}>{STATUS[card.myStatus].label}</span>}
            </div>
            <div className="opportunity-card__title">{card.project.title}</div>
            {card.project.pitch && <div className="opportunity-card__desc">{card.project.pitch}</div>}
            {card.project.requiredRoles?.length > 0 && (
              <div className="swipe-card__skills" style={{ margin: '8px 0' }}>
                {card.project.requiredRoles.map((r) => <span key={r} className="skill-tag">{r}</span>)}
              </div>
            )}
            <div className="opportunity-card__footer">
              <span className="text-sm text-hint">{card.project.commitmentLevel ? `⏱ ${card.project.commitmentLevel}` : ''}</span>
              {!card.myStatus && (
                <button className="btn btn--primary btn--small" onClick={() => setApplying(card)}>Хочу в команду</button>
              )}
            </div>
          </div>
        ))
      )}

      {editing && (
        <ProjectForm project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
      {applying && <ApplyForm card={applying} onClose={() => setApplying(null)} onDone={() => { setApplying(null); load(); }} />}
    </>
  );
}

/** Tab «Заявки»: to my startups (accept / decline) and the ones I sent. */
export function ApplicationsTab() {
  const [data, setData] = useState<{ incoming: Application[]; outgoing: Application[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ incoming: Application[]; outgoing: Application[] }>('/venture/applications').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const decide = async (id: number, accept: boolean) => {
    try {
      await api.post(`/venture/applications/${id}/decide`, { accept });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!data) return <div className="skeleton skeleton--card" />;

  return (
    <>
      <ErrorLine error={error} />
      <h3 className="profile-section__title">Мені в стартапи</h3>
      {data.incoming.length === 0 && <div className="text-sm text-hint mb-md">Заявок поки немає.</div>}
      {data.incoming.map((a) => (
        <div key={a.id} className="card" style={{ padding: '14px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="font-semibold" style={{ flex: 1 }}>{a.applicant!.name}</div>
            <span className={`badge ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
          </div>
          <div className="text-sm text-hint">«{a.project.title}»{a.role ? ` · ${a.role}` : ''}</div>
          {a.applicant!.headline && <div className="text-sm" style={{ marginTop: '6px' }}>{a.applicant!.headline}</div>}
          {a.applicant!.skills.length > 0 && (
            <div className="swipe-card__skills" style={{ margin: '6px 0' }}>
              {a.applicant!.skills.slice(0, 8).map((s) => <span key={s} className="skill-tag">{s}</span>)}
            </div>
          )}
          {a.message && <div className="text-sm" style={{ marginTop: '6px', fontStyle: 'italic' }}>«{a.message}»</div>}
          {a.status === 'pending' && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button className="btn btn--primary btn--small" style={{ flex: 1 }} onClick={() => decide(a.id, true)}>✅ Прийняти</button>
              <button className="btn btn--secondary btn--small" onClick={() => decide(a.id, false)}>Відхилити</button>
            </div>
          )}
          {a.applicant!.contact && (
            <button className="btn btn--secondary btn--small btn--full" style={{ marginTop: '10px' }} onClick={() => openContact(a.applicant!.contact!)}>💬 Написати</button>
          )}
        </div>
      ))}

      <h3 className="profile-section__title" style={{ marginTop: '20px' }}>Мої заявки</h3>
      {data.outgoing.length === 0 && <div className="text-sm text-hint">Ти ще не подавав заявок.</div>}
      {data.outgoing.map((a) => (
        <div key={a.id} className="card" style={{ padding: '14px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="font-semibold" style={{ flex: 1 }}>«{a.project.title}»</div>
            <span className={`badge ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
          </div>
          <div className="text-sm text-hint">Автор: {a.author!.name}{a.role ? ` · ${a.role}` : ''}</div>
          {a.author!.contact && (
            <button className="btn btn--primary btn--small btn--full" style={{ marginTop: '10px' }} onClick={() => openContact(a.author!.contact!)}>💬 Написати автору</button>
          )}
        </div>
      ))}
    </>
  );
}
