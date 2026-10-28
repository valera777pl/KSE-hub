import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../api/client';
import type { Reminder } from '../../types';
import { tr } from '../../lib/i18n';
import { haptic } from '../../lib/telegram';
import { shortWhen } from '../ui/RemindSheet';

/** Профіль → Мої нагадування: what the bot will still send, tap to delete. Hidden when there's nothing. */
export function RemindersGroup({ confirm }: { confirm: (text: string) => Promise<boolean> }) {
  const [list, setList] = useState<Reminder[]>([]);
  const load = () => api.get<{ reminders: Reminder[] }>('/reminders').then((r) => setList(r.reminders)).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const remove = async (r: Reminder) => {
    if (!(await confirm(tr('Видалити нагадування?', 'Delete this reminder?')))) return;
    haptic.select();
    await api.delete(`/reminders/${r.id}`).catch(() => haptic.error());
    load();
  };

  if (!list.length) return null;
  return (
    <>
      <div className="caption">{tr('Мої нагадування', 'My reminders')}</div>
      <div className="group">
        {list.map((r) => (
          <button className="row press" key={r.id} onClick={() => remove(r)} aria-label={`${r.text}. ${tr('Видалити', 'Delete')}`}>
            <Bell className="row-icon" strokeWidth={1.7} />
            <div className="row__main">
              <div className="row__title clamp2" style={{ fontWeight: 500 }}>{r.text.split('\n')[0]}</div>
              <div className="row__meta num">{shortWhen(new Date(r.remindAt))}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
