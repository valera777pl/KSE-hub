import type { FriendshipStatus } from '../db/schema.js';

type Pair = { requesterId: number; addresseeId: number; status: FriendshipStatus };

/**
 * What a friend request from `from` does, given the pair's existing row (if any):
 * - nothing yet → a new pending request (the other side gets a message with two buttons);
 * - the other side already asked, or once declined us and now asks back → mutual right away;
 * - we already asked (pending or declined) → nothing, no second message: a "no" isn't asked twice.
 */
export function requestAction(existing: Pair | null, from: number): 'create' | 'accept' | 'already_friends' | 'already_requested' {
  if (!existing) return 'create';
  if (existing.status === 'accepted') return 'already_friends';
  if (existing.requesterId === from) return 'already_requested';
  return 'accept';
}

/** "Олег хоче додати тебе в друзі" — the request message, with the reason friends matter in Hub. */
export function friendRequestText(lang: 'uk' | 'en', name: string): string {
  return lang === 'en'
    ? `<b>${name} wants to add you as a friend</b>\nFriends can see shared free time and remind each other about deadlines.`
    : `<b>${name} хоче додати тебе в друзі</b>\nДрузі бачать спільні вікна й можуть нагадати одне одному про дедлайн.`;
}
