import { useEffect, useMemo, useState } from 'react';
import { Bookmark, BookmarkCheck, Compass, Mail, Search, SlidersHorizontal } from 'lucide-react';
import { api, track } from '../../../api/client';
import type { Opportunity } from '../../../types';
import { tr } from '../../../lib/i18n';
import { dayKey, dayMonth, now } from '../../../lib/time';
import { programName } from '../../../lib/programs';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { useAuthStore } from '../../../stores/authStore';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { useCached } from '../../../lib/cache';
import { AskPanel } from '../../ui/AskPanel';

type Category = '' | Opportunity['category'];
type Filters = { category: Category; fromMail: boolean; saved: boolean };
const NO_FILTERS: Filters = { category: '', fromMail: false, saved: false };

const categories = (): [Category, string][] => [
  ['', tr('Усі', 'All')], ['internship', tr('Стажування', 'Internships')], ['job', tr('Робота', 'Jobs')],
  ['grant', tr('Гранти', 'Grants')], ['research', tr('Дослідження', 'Research')],
];

/** "BE · EBD" or "Усі програми" */
const programsLabel = (o: Opportunity) => (o.programs?.length ? o.programs.join(' · ') : tr('Усі програми', 'All programmes'));
const deadlineLabel = (o: Opportunity) => (o.deadline ? `${tr('до', 'by')} ${dayMonth(dayKey(new Date(o.deadline)))}` : null);
const initial = (o: Opportunity) => (o.company.trim()[0] ?? '?').toUpperCase();

/** Можливості → Для тебе: opportunities from KSE mail, your programme first, the rest below with a label. */
export function ForYou({ openId }: { openId: number | null }) {
  const user = useAuthStore((s) => s.user);
  const program = user?.faculty ?? null;
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [open, setOpen] = useState<Opportunity | null>(null);

  useEffect(() => { track('opps.open'); }, []);

  // Typing waits a beat before asking the server
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.fromMail) params.set('source', 'email');
  if (filters.saved) params.set('saved', 'true');
  if (search) params.set('search', search);
  // Only the plain list is kept for offline; filtered and searched views are asked fresh
  const q = useCached(`opps${params.size ? `?${params}` : ''}`,
    () => api.get<{ opportunities: Opportunity[] }>(`/careers${params.size ? `?${params}` : ''}`).then((r) => r.opportunities),
    { persist: params.size === 0 });
  // Local copy so "Зберегти" shows at once
  const [list, setList] = useState<Opportunity[] | null>(q.data);
  useEffect(() => setList(q.data), [q.data]);

  // From the bot: "opp_12" opens that one
  useEffect(() => {
    if (openId && list) setOpen((o) => o ?? list.find((x) => x.id === openId) ?? null);
  }, [list]);

  // Grant students don't need contract-only offers and vice versa; "all" fits everyone
  const fits = (o: Opportunity) => o.eligibility === 'all' || o.eligibility === user?.studentType;
  const { mine, others } = useMemo(() => {
    const ok = (list ?? []).filter(fits);
    // Without a chosen programme everything counts as "for you"; splitting would only hide things
    const forMe = (o: Opportunity) => !program || !o.programs?.length || o.programs.includes(program);
    return { mine: ok.filter(forMe), others: ok.filter((o) => !forMe(o)) };
  }, [list, program, user?.studentType]);

  const active = Number(!!filters.category) + Number(filters.fromMail) + Number(filters.saved);

  const setSaved = (o: Opportunity, saved: boolean) => {
    setList((l) => l?.map((x) => (x.id === o.id ? { ...x, saved } : x)) ?? null);
    setOpen((x) => (x && x.id === o.id ? { ...x, saved } : x));
  };

  return (
    <>
      <div className="search-row">
        <div className="field-wrap">
          <Search strokeWidth={1.75} />
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Компанія, роль, тема', 'Company, role, topic')} enterKeyHint="search" />
        </div>
        <button className="filter-btn press" data-on={active > 0} aria-label={tr('Фільтри', 'Filters')} onClick={() => setFiltering(true)}>
          <SlidersHorizontal strokeWidth={1.75} />{active > 0 && <b>{active}</b>}
        </button>
      </div>

      {q.staleAt && <div style={{ marginTop: 16 }}><StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} /></div>}
      {!list && q.error ? (
        <div style={{ marginTop: 16 }}><ErrorState error={q.error} onRetry={q.refresh} /></div>
      ) : !list ? (
        <div style={{ marginTop: 16 }}><SkeletonRows rows={4} /></div>
      ) : mine.length + others.length === 0 ? (
        <div className="group" style={{ marginTop: 16 }}>
          {active || query
            ? <EmptyState icon={Search} title={tr('Нічого не знайшли', 'Nothing found')} action={{ label: tr('Скинути фільтри', 'Clear filters'), onClick: () => { setFilters(NO_FILTERS); setQuery(''); } }} />
            : <EmptyState icon={Compass} title={program ? tr(`Поки нічого для ${program}`, `Nothing for ${program} yet`) : tr('Поки нічого', 'Nothing yet')}
                text={tr('Нові зʼявляються, щойно SDO чи компанії надсилають листи студентам.', 'New ones appear as soon as SDO or companies email students.')} />}
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <div className="caption">{program ? tr(`Для ${program} і всіх`, `For ${program} and everyone`) : tr('Для всіх', 'For everyone')}</div>
              <div className="group">{mine.map((o) => <OppRow key={o.id} o={o} onOpen={() => { haptic.tap(); setOpen(o); }} />)}</div>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="caption">{tr('Для інших програм', 'For other programmes')}</div>
              <div className="group">{others.map((o) => <OppRow key={o.id} o={o} onOpen={() => { haptic.tap(); setOpen(o); }} />)}</div>
            </>
          )}
        </>
      )}

      {filtering && <FilterSheet value={filters} onChange={setFilters} onClose={() => setFiltering(false)} />}
      {open && <OppSheet o={open} onClose={() => setOpen(null)} onSaved={(v) => setSaved(open, v)} />}
    </>
  );
}

function OppRow({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  const soon = o.deadline && new Date(o.deadline).getTime() - now().getTime() < 3 * 86_400_000;
  return (
    <button className="row opp press" onClick={onOpen}>
      <span className="org" aria-hidden="true">{initial(o)}</span>
      <div className="row__main">
        <div className="row__title clamp2">{o.title}</div>
        <div className="opp__org">{o.company}</div>
        <div className="row__meta">
          {programsLabel(o)}
          {deadlineLabel(o) && <> · <span style={soon ? { color: 'var(--danger)' } : undefined}>{deadlineLabel(o)}</span></>}
        </div>
      </div>
      {o.saved && <BookmarkCheck className="saved-mark" strokeWidth={1.75} aria-label={tr('Збережено', 'Saved')} />}
    </button>
  );
}

function FilterSheet({ value, onChange, onClose }: { value: Filters; onChange: (f: Filters) => void; onClose: () => void }) {
  const set = (patch: Partial<Filters>) => { haptic.select(); onChange({ ...value, ...patch }); };
  return (
    <Sheet onClose={onClose} label={tr('Фільтри', 'Filters')}>
      <div className="sheet__title">{tr('Фільтри', 'Filters')}</div>
      <div className="caption">{tr('Що шукаєш', 'Looking for')}</div>
      <div className="pills" style={{ flexWrap: 'wrap', margin: 0 }}>
        {categories().map(([k, l]) => <button key={k || 'all'} className="press" aria-pressed={value.category === k} onClick={() => set({ category: k })}>{l}</button>)}
      </div>
      <div className="group" style={{ marginTop: 24 }}>
        <div className="row">
          <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Лише збережені', 'Saved only')}</div></div>
          <button className="switch" role="switch" aria-checked={value.saved} aria-label={tr('Лише збережені', 'Saved only')} onClick={() => set({ saved: !value.saved })} />
        </div>
        <div className="row">
          <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Лише з моєї пошти', 'From my mail only')}</div></div>
          <button className="switch" role="switch" aria-checked={value.fromMail} aria-label={tr('Лише з моєї пошти', 'From my mail only')} onClick={() => set({ fromMail: !value.fromMail })} />
        </div>
      </div>
      <p className="note">{tr('Можливості лише для грантистів чи контрактників ми й так показуємо тільки тим, кому вони підходять.', 'Grant-only and contract-only offers already show only to students they fit.')}</p>
    </Sheet>
  );
}

function OppSheet({ o, onClose, onSaved }: { o: Opportunity; onClose: () => void; onSaved: (saved: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useMainButton({
    text: tr('Подати', 'Apply'),
    visible: !!o.url && !asking,
    onClick: () => { if (o.url) { track('opp.apply_click'); openExternal(o.url); } },
  });

  const toggleSave = async () => {
    setBusy(true);
    try {
      await api.post(`/careers/${o.id}/save`, { saved: !o.saved });
      haptic.success();
      onSaved(!o.saved);
    } catch { haptic.error(); }
    setBusy(false);
  };

  if (asking) {
    return (
      <Sheet onClose={() => setAsking(false)} label="Copilot">
        <AskPanel about={o.title} onBack={() => setAsking(false)}
          context={`${tr('можливість', 'opportunity')} «${o.title}», ${o.company}, ${programsLabel(o)}${o.deadline ? `, ${deadlineLabel(o)}` : ''}. ${o.description ?? ''}`}
          starters={[tr('Чи підходить це мені?', 'Is this a fit for me?'), tr('Допоможи з мотиваційним листом', 'Help me with a cover letter')]} />
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} label={o.title}>
      <span className="org org--lg" aria-hidden="true">{initial(o)}</span>
      <div className="sheet__title">{o.title}</div>
      <div className="sheet__sub">{o.company}</div>
      <div className="tags">
        <span className="tag">{o.programs?.length ? o.programs.map(programName).join(', ') : tr('Усі програми', 'All programmes')}</span>
        {deadlineLabel(o) && <span className="tag">{tr('Подача', 'Apply')} {deadlineLabel(o)}</span>}
        {o.eligibility !== 'all' && <span className="tag">{o.eligibility === 'grant' ? tr('Для грантистів', 'Grant students') : tr('Для контрактників', 'Contract students')}</span>}
      </div>
      {o.description && <p className="desc">{o.description}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 20 }}>
        <button className="btn-plain press" style={{ fontSize: 16 }} onClick={toggleSave} disabled={busy} aria-pressed={!!o.saved}>
          {o.saved ? <BookmarkCheck strokeWidth={1.75} /> : <Bookmark strokeWidth={1.75} />}{o.saved ? tr('Збережено', 'Saved') : tr('Зберегти', 'Save')}
        </button>
        <button className="btn-plain press" style={{ fontSize: 16 }} onClick={() => setAsking(true)}>{tr('Запитати Copilot', 'Ask Copilot')}</button>
      </div>
      {o.saved && o.deadline && <p className="note" style={{ textAlign: 'center' }}>{tr('Нагадаємо в боті за 3 дні до кінця подачі.', "We'll remind you in the bot 3 days before applications close.")}</p>}
      {o.emailUrl && (
        <button className="row press" style={{ color: 'var(--accent)', fontWeight: 500, gap: 8, padding: '12px 4px' }} onClick={() => openExternal(o.emailUrl!)}>
          <Mail size={18} strokeWidth={1.75} /> {tr('Відкрити лист', 'Open the email')}
        </button>
      )}
    </Sheet>
  );
}
