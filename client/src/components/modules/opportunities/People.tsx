import { useEffect, useState } from 'react';
import { useDrag } from '@use-gesture/react';
import { ChevronRight, UserRound, Users } from 'lucide-react';
import { api, errorText } from '../../../api/client';
import { useVentureStore } from '../../../stores/ventureStore';
import type { SwipeCardProfile, VentureProfile } from '../../../types';
import { tr } from '../../../lib/i18n';
import { initials } from '../../../lib/place';
import { haptic, useMainButton } from '../../../lib/telegram';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, SkeletonRows } from '../../ui/States';
import { openContact } from './Startups';

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Можливості → Люди: one student at a time. "Цікаво" on both sides opens each other's Telegram. */
export function People() {
  const { deck, deckType, myProfile, matchResult, loading, setDeckType, fetchDeck, swipe, clearMatch, fetchMyProfile } = useVentureStore();
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (deckType !== 'profile') setDeckType('profile'); else fetchDeck();
    fetchMyProfile();
  }, []);

  const card = deck.find((c): c is SwipeCardProfile => 'profile' in c);

  const decide = (like: boolean) => {
    if (!card || leaving) return;
    haptic.select();
    setLeaving(like ? 'right' : 'left');
    setTimeout(async () => { await swipe(card.profile.id, 'profile', like).catch(() => null); setLeaving(null); }, 240);
  };

  const bind = useDrag(({ swipe: [sx] }) => { if (sx) decide(sx > 0); }, { axis: 'x', filterTaps: true, swipe: { distance: 60 } });

  return (
    <>
      <div className="group">
        <button className="row press" onClick={() => { haptic.tap(); setEditing(true); }}>
          <UserRound className="row-icon" strokeWidth={1.75} />
          <div className="row__main">
            <div className="row__title" style={{ fontWeight: 500 }}>{myProfile ? myProfile.title : tr('Розкажи про себе', 'Tell people about you')}</div>
            <div className="row__meta">{myProfile ? tr('Твій профіль — його бачать інші й автори стартапів', 'Your profile, seen by others and startup authors') : tr('Без профілю тебе не побачать у «Людях»', "Without a profile you won't appear in People")}</div>
          </div>
          <ChevronRight className="chev" strokeWidth={1.75} />
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading && !card ? <SkeletonRows rows={2} /> : !card ? (
          <div className="group"><EmptyState icon={Users} title={tr('Поки всіх переглянуто', "You've seen everyone for now")} text={tr('Нові люди зʼявляться, щойно заповнять профіль.', 'New people appear as they fill in their profiles.')} /></div>
        ) : (
          <>
            <article {...bind()} className={`person${leaving ? ` person--out-${leaving}` : ''}`} key={card.profile.id}>
              <div className="person__head">
                <span className="avatar-btn">{card.user.avatarUrl ? <img src={card.user.avatarUrl} alt="" /> : initials(card.user.fullName)}</span>
                <div>
                  <div className="person__name">{card.user.fullName}</div>
                  <div className="person__title">{[card.profile.title, card.user.faculty && !card.profile.title.includes(card.user.faculty) ? card.user.faculty : null].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              {card.profile.bio && <p className="person__bio">{card.profile.bio}</p>}
              {card.profile.skills?.length > 0 && <><div className="person__label">{tr('Вміє', 'Skills')}</div><div className="tags">{card.profile.skills.map((s) => <span key={s} className="tag">{s}</span>)}</div></>}
              {card.profile.lookingFor?.length > 0 && <><div className="person__label">{tr('Шукає', 'Looking for')}</div><div className="tags">{card.profile.lookingFor.map((s) => <span key={s} className="tag">{s}</span>)}</div></>}
            </article>
            <div className="deck-actions">
              <button className="btn-plain press" style={{ color: 'var(--text)' }} onClick={() => decide(false)}>{tr('Пропустити', 'Skip')}</button>
              <button className="btn-plain btn-accent press" onClick={() => decide(true)}>{tr('Цікаво', 'Interested')}</button>
            </div>
            <p className="note" style={{ textAlign: 'center' }}>{tr('Якщо вам обом цікаво — покажемо Telegram одне одного.', "If you're both interested, we'll show each other's Telegram.")}</p>
          </>
        )}
      </div>

      {editing && <ProfileSheet profile={myProfile} onClose={() => setEditing(false)} onDone={() => { setEditing(false); fetchMyProfile(); fetchDeck(); }} />}
      {matchResult?.matched && matchResult.matchedUser && (
        <Sheet onClose={clearMatch} label={tr('Взаємно', "It's mutual")}>
          <div className="done-mark">
            <span className="avatar-btn" style={{ width: 64, height: 64, fontSize: 22 }}>{initials(matchResult.matchedUser.fullName)}</span>
            <b>{tr('Взаємно', "It's mutual")}</b>
            <span>{tr(`Тобі й ${matchResult.matchedUser.fullName} цікаво попрацювати разом.`, `You and ${matchResult.matchedUser.fullName} both want to work together.`)}</span>
          </div>
          {matchResult.matchedUser.username && (
            <button className="btn-plain btn-accent press" onClick={() => openContact(`https://t.me/${matchResult.matchedUser!.username}`)}>{tr('Написати в Telegram', 'Message on Telegram')}</button>
          )}
        </Sheet>
      )}
    </>
  );
}

function ProfileSheet({ profile, onClose, onDone }: { profile: VentureProfile | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    title: profile?.title ?? '', bio: profile?.bio ?? '',
    skills: profile?.skills?.join(', ') ?? '', lookingFor: profile?.lookingFor?.join(', ') ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/venture/profile', { title: form.title.trim(), bio: form.bio.trim(), skills: splitList(form.skills), lookingFor: splitList(form.lookingFor) });
      haptic.success();
      onDone();
    } catch (e) { haptic.error(); setError(errorText(e)); }
    setBusy(false);
  };

  useMainButton({ text: tr('Зберегти', 'Save'), onClick: save, disabled: !form.title.trim(), loading: busy });

  const input = (key: keyof typeof form, label: string, placeholder: string, area = false) => (
    <>
      <label className="field-label" htmlFor={`v-${key}`}>{label}</label>
      {area
        ? <textarea id={`v-${key}`} className="field" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        : <input id={`v-${key}`} className="field" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />}
    </>
  );

  return (
    <Sheet onClose={onClose} label={tr('Мій профіль', 'My profile')}>
      <div className="sheet__title">{tr('Мій профіль', 'My profile')}</div>
      <div className="sheet__sub">{tr('Його бачать інші студенти й автори стартапів, коли ти подаєш заявку.', 'Other students and startup authors see it when you apply.')}</div>
      {input('title', tr('Хто ти одним рядком', 'You in one line'), tr('Напр. Python-розробник, 1 курс BE', 'e.g. Python developer, BE year 1'))}
      {input('bio', tr('Про себе', 'About you'), tr('Досвід, інтереси', 'Experience, interests'), true)}
      {input('skills', tr('Що вмієш, через кому', 'Skills, comma-separated'), 'Python, Figma, SQL')}
      {input('lookingFor', tr('Що шукаєш, через кому', 'Looking for, comma-separated'), tr('Стартап, команда на хакатон', 'A startup, a hackathon team'))}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
    </Sheet>
  );
}
