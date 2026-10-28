import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, errorText } from '../../api/client';
import type { FriendsList } from '../../types';
import { tr } from '../../lib/i18n';
import { haptic } from '../../lib/telegram';
import { dayKey, dayNum, hm, now, weekdayShort } from '../../lib/time';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';

/** "пт 30.10, 18:00" */
export const shortWhen = (d: Date) => {
  const k = dayKey(d);
  return `${weekdayShort(k).toLowerCase()} ${dayNum(k)}.${k.slice(5, 7)}, ${hm(d)}`;
};

/** <input type="datetime-local"> value in the phone's own time zone */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * «Нагадати…»: one tap on «за 1 день» / «за 3 год», or «свій час». The bot sends it within ~10 minutes of the time.
 * For a deadline, «Нагадати другу» nudges a mutual friend right away.
 */
export function RemindSheet({ text, at, startapp, assignmentId, onClose }: {
  /** What the reminder says: «ECON100 Problem set 4 — пт 30.10, 23:59» */
  text: string;
  /** The moment it's about (deadline, class start) */
  at: Date;
  startapp?: string;
  /** A deadline can also be sent to a friend */
  assignmentId?: number;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [time, setTime] = useState(() => localInput(new Date(Math.max(now().getTime() + 3_600_000, at.getTime() - 24 * 3_600_000))));
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendsList['friends'] | null>(null);
  const [nudged, setNudged] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (assignmentId) api.get<FriendsList>('/friends').then((l) => setFriends(l.friends)).catch(() => setFriends([]));
  }, [assignmentId]);

  const options = [
    { key: '1d', label: tr('За 1 день', '1 day before'), when: new Date(at.getTime() - 24 * 3_600_000) },
    { key: '3h', label: tr('За 3 год', '3 hours before'), when: new Date(at.getTime() - 3 * 3_600_000) },
  ].filter((o) => o.when.getTime() > now().getTime() + 60_000);

  const create = async (when: Date) => {
    setError(null);
    try {
      await api.post('/reminders', { text, remindAt: when.toISOString(), startapp });
      haptic.success();
      setDone(tr(`Нагадаю ${shortWhen(when)}`, `Will remind you ${shortWhen(when)}`));
      setTimeout(onClose, 1200);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    }
  };

  const nudge = async (friendId: number) => {
    setError(null);
    try {
      await api.post('/reminders/friend', { friendId, text, assignmentId });
      haptic.success();
      setNudged((s) => new Set(s).add(friendId));
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    }
  };

  return (
    <Sheet onClose={onClose} label={tr('Нагадати', 'Remind me')}>
      <div className="sheet__title">{tr('Нагадати', 'Remind me')}</div>
      <div className="sheet__sub">{text}</div>

      {done ? (
        <p className="remind-done" role="status"><Check strokeWidth={2.2} />{done}</p>
      ) : (
        <>
          <div className="group" style={{ marginTop: 16 }}>
            {options.map((o) => (
              <button key={o.key} className="row press" onClick={() => create(o.when)}>
                <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{o.label}</div></div>
                <span className="row__side num">{shortWhen(o.when)}</span>
              </button>
            ))}
            <button className="row press" onClick={() => { haptic.select(); setCustom(true); }} aria-expanded={custom}>
              <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Свій час', 'Pick a time')}</div></div>
            </button>
            {custom && (
              <div className="row">
                <input className="field" type="datetime-local" value={time} min={localInput(now())} onChange={(e) => setTime(e.target.value)} aria-label={tr('Коли нагадати', 'When to remind')} />
              </div>
            )}
          </div>
          {custom && (
            <button className="btn-plain btn-accent press" style={{ marginTop: 12 }} disabled={!time} onClick={() => create(new Date(time))}>
              {tr(`Нагадати ${shortWhen(new Date(time))}`, `Remind ${shortWhen(new Date(time))}`)}
            </button>
          )}
          <p className="note">{tr('Бот напише в чат протягом 10 хвилин від цього часу.', 'The bot writes within 10 minutes of that time.')}</p>
        </>
      )}

      {assignmentId && !done && friends && friends.length > 0 && (
        <>
          <div className="caption">{tr('Нагадати другу', 'Remind a friend')}</div>
          <div className="group">
            {friends.map((f) => (
              <button key={f.userId} className="row press" disabled={nudged.has(f.userId)} onClick={() => nudge(f.userId)}>
                <Avatar name={f.name} url={f.avatarUrl} size={32} />
                <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div>
                <span className="row__side">{nudged.has(f.userId) ? tr('Надіслано ✓', 'Sent ✓') : tr('Надіслати', 'Send')}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
    </Sheet>
  );
}
