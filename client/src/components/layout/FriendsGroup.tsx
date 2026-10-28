import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../../api/client';
import type { FriendsList } from '../../types';
import { tr } from '../../lib/i18n';
import { haptic } from '../../lib/telegram';
import { inviteFriend } from '../../lib/invite';
import { Avatar } from '../ui/Avatar';

/**
 * Профіль → Друзі: requests waiting for my answer first, then friends, then mine still waiting.
 * Only mutual friends can remind each other and show up on a course page.
 */
export function FriendsGroup({ confirm }: { confirm: (text: string) => Promise<boolean> }) {
  const [list, setList] = useState<FriendsList | null>(null);
  const load = () => api.get<FriendsList>('/friends').then(setList).catch(() => setList({ friends: [], incoming: [], outgoing: [] }));
  useEffect(() => { load(); }, []);

  const answer = async (friendshipId: number, accept: boolean) => {
    haptic.select();
    try {
      await api.post(`/friends/${friendshipId}/${accept ? 'accept' : 'decline'}`);
      if (accept) haptic.success();
    } catch { haptic.error(); }
    load();
  };
  const remove = async (userId: number, name: string) => {
    if (!(await confirm(tr(`Прибрати ${name} з друзів?`, `Remove ${name} from friends?`)))) return;
    await api.delete(`/friends/${userId}`).catch(() => haptic.error());
    load();
  };

  return (
    <>
      <div className="caption">{tr('Друзі', 'Friends')}</div>
      <div className="group">
        {list?.incoming.map((f) => (
          <div className="row" key={`in-${f.friendshipId}`}>
            <Avatar name={f.name} url={f.avatarUrl} size={32} />
            <div className="row__main">
              <div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div>
              <div className="row__meta">{tr('Запит у друзі', 'Friend request')}</div>
            </div>
            <button className="link-btn" style={{ color: 'var(--text-secondary)' }} onClick={() => answer(f.friendshipId, false)}>{tr('Ні', 'No')}</button>
            <button className="link-btn" onClick={() => answer(f.friendshipId, true)}>{tr('Прийняти', 'Accept')}</button>
          </div>
        ))}
        {list?.friends.map((f) => (
          <button className="row press" key={`f-${f.userId}`} onClick={() => remove(f.userId, f.name.split(' ')[0])}>
            <Avatar name={f.name} url={f.avatarUrl} size={32} />
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div>
          </button>
        ))}
        {list?.outgoing.map((f) => (
          <div className="row" key={`out-${f.friendshipId}`}>
            <Avatar name={f.name} url={f.avatarUrl} size={32} />
            <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div></div>
            <span className="row__side">{tr('Чекає відповіді', 'Waiting')}</span>
          </div>
        ))}
        <button className="row press" onClick={() => { inviteFriend().catch(() => haptic.error()); }}>
          <UserPlus className="row-icon" strokeWidth={1.7} />
          <div className="row__main">
            <div className="row__title" style={{ fontWeight: 500 }}>{tr('Запросити друга в KSE Hub', 'Invite a friend to KSE Hub')}</div>
            {list && !list.friends.length && <div className="row__meta">{tr('Друзі бачать спільні вікна й нагадують про дедлайни', 'Friends see shared free time and remind each other about deadlines')}</div>}
          </div>
        </button>
      </div>
    </>
  );
}
