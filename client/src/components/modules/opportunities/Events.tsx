import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarDays, Check } from 'lucide-react';
import { api, errorText, track } from '../../../api/client';
import type { EventItem } from '../../../types';
import { tr } from '../../../lib/i18n';
import { addDays, dayKey, dayNum, hm, mondayOf, todayKey, weekdayShort } from '../../../lib/time';
import { programName } from '../../../lib/programs';
import { haptic, openExternal, useMainButton } from '../../../lib/telegram';
import { useCached } from '../../../lib/cache';
import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { shortWhen } from '../../ui/RemindSheet';

const whereLine = (e: EventItem) => [hm(e.startsAt), e.location].filter(Boolean).join(' · ');

/**
 * Можливості → Події: seminars, talks and club meetups from KSE mailings, this week first.
 * «Нагадати за день» → the bot writes the day before around 10:00, and the event joins that day's digest.
 */
export function Events({ openId }: { openId: number | null }) {
  const q = useCached('events', () => api.get<{ events: EventItem[] }>('/events').then((r) => r.events));
  const [list, setList] = useState<EventItem[] | null>(q.data);
  useEffect(() => setList(q.data), [q.data]);
  const [open, setOpen] = useState<EventItem | null>(null);

  // From the bot: "event_12" opens that one
  useEffect(() => {
    if (!openId) return;
    api.get<{ event: EventItem }>(`/events/${openId}`).then((r) => setOpen(r.event)).catch(() => {});
  }, [openId]);
  useEffect(() => { if (open) track('event.open'); }, [open?.id]);

  const groups = useMemo(() => {
    const thisWeekEnd = addDays(mondayOf(todayKey()), 7);
    const nextWeekEnd = addDays(thisWeekEnd, 7);
    const by = (from: string | null, to: string | null) => (list ?? []).filter((e) => {
      const k = dayKey(new Date(e.startsAt));
      return (!from || k >= from) && (!to || k < to);
    });
    return [
      { title: tr('Цього тижня', 'This week'), items: by(null, thisWeekEnd) },
      { title: tr('Наступного тижня', 'Next week'), items: by(thisWeekEnd, nextWeekEnd) },
      { title: tr('Пізніше', 'Later'), items: by(nextWeekEnd, null) },
    ].filter((g) => g.items.length);
  }, [list]);

  const update = (e: EventItem) => {
    setList((l) => l?.map((x) => (x.id === e.id ? e : x)) ?? null);
    setOpen(e);
  };

  if (!list && q.error) return <ErrorState error={q.error} onRetry={q.refresh} />;
  return (
    <>
      {q.staleAt && <StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} />}
      {!list && <SkeletonRows rows={3} />}
      {list && !list.length && (
        <EmptyState icon={CalendarDays} title={tr('Поки немає подій', 'No events yet')}
          text={tr('Нові зʼявляються, щойно приходить розсилка.', 'New ones appear as soon as a mailing arrives.')} />
      )}
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="group-title">{g.title}</h3>
          <div className="group">
            {g.items.map((e) => {
              const k = dayKey(new Date(e.startsAt));
              return (
                <button key={e.id} className="dl press" onClick={() => { haptic.tap(); setOpen(e); }}>
                  <span className="dl__date" aria-hidden="true"><span>{weekdayShort(k).toLowerCase()}</span><b className="num">{dayNum(k)}</b></span>
                  <span className="dl__main">
                    <span className="dl__title clamp2">{e.title}</span>
                    <span className="dl__meta num">
                      {whereLine(e)}
                      {e.reminded && <> · <span className="dl__ok">{tr('нагадаю', 'reminder on')}</span></>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {open && <EventSheet e={open} onClose={() => setOpen(null)} onChange={update} />}
    </>
  );
}

function EventSheet({ e, onClose, onChange }: { e: EventItem; onClose: () => void; onChange: (e: EventItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMainButton({
    text: tr('Зареєструватися ↗', 'Register ↗'),
    visible: !!e.registrationUrl,
    onClick: () => { if (e.registrationUrl) { track('event.register_click'); openExternal(e.registrationUrl); } },
  });

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (e.reminded) {
        await api.delete(`/events/${e.id}/remind`);
        haptic.select();
        onChange({ ...e, reminded: false });
      } else {
        await api.post(`/events/${e.id}/remind`);
        haptic.success();
        onChange({ ...e, reminded: true });
      }
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    }
    setBusy(false);
  };

  return (
    <Sheet onClose={onClose} label={e.title}>
      <div className="sheet__title">{e.title}</div>
      <div className="sheet__sub num">{[shortWhen(new Date(e.startsAt)), e.location].filter(Boolean).join(' · ')}</div>
      <div className="tags">
        <span className="tag">{e.programs?.length ? e.programs.map(programName).join(', ') : tr('Усі програми', 'All programmes')}</span>
        {e.personal && <span className="tag">{tr('Запрошення тобі', 'Invited personally')}</span>}
        {e.registrationUrl && <span className="tag">{tr('Потрібна реєстрація', 'Registration required')}</span>}
      </div>
      {e.description && <p className="desc">{e.description}</p>}

      {/* One filled button per screen: registration takes the MainButton, then the reminder is outlined */}
      <button className={`btn-plain press${e.reminded || e.registrationUrl ? '' : ' btn-accent'}`} style={{ marginTop: 20 }} onClick={toggle} disabled={busy} aria-pressed={e.reminded}>
        {e.reminded ? <><Check strokeWidth={2} />{tr('Нагадаю', 'Reminder on')}</> : <><BellRing strokeWidth={1.75} />{tr('Нагадати за день', 'Remind me the day before')}</>}
      </button>
      <p className="note" style={{ textAlign: 'center' }}>
        {e.reminded
          ? tr('Бот напише напередодні близько 10:00. Натисни ще раз, щоб скасувати.', 'The bot writes the day before around 10:00. Tap again to cancel.')
          : tr('Бот напише напередодні близько 10:00, і подія потрапить у дайджест того дня.', 'The bot writes the day before around 10:00, and the event joins that day\'s digest.')}
      </p>
      {error && <p className="note" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
    </Sheet>
  );
}
