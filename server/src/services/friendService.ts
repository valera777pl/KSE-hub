import { InlineKeyboard } from 'grammy';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { friendships, googleAccounts, users } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { botUsername, escapeHtml } from '../bot/send.js';
import { appButton } from '../bot/messages.js';
import { signInvite } from '../utils/crypto.js';
import { friendRequestText, requestAction } from '../utils/friends.js';
import { AnalyticsService } from './analyticsService.js';
import { PushService } from './pushService.js';
import { studentCard } from './scheduleService.js';

const IMPORT_LIMIT = 5;

const pairOf = (a: number, b: number) =>
  or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)));

/** The people side of a friendship: KSE email name, Telegram photo, how to reach them. */
async function people(ids: number[]) {
  if (!ids.length) return new Map<number, ReturnType<typeof card>>();
  const rows = await db
    .select({ userId: users.id, telegramId: users.telegramId, languagePref: users.languagePref, fullName: users.fullName,
      username: users.username, avatarUrl: users.avatarUrl, email: googleAccounts.email, onboardedAt: users.onboardedAt })
    .from(users)
    .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.userId, card(r)]));
}

function card(r: { userId: number; telegramId: number; languagePref: string | null; fullName: string; username: string | null;
  avatarUrl: string | null; email: string | null; onboardedAt: Date | null }) {
  const named = r.email ? studentCard({ email: r.email, avatarUrl: r.avatarUrl }) : { name: r.fullName, cohort: null, avatarUrl: r.avatarUrl };
  return { userId: r.userId, name: named.name, avatarUrl: named.avatarUrl, username: r.username,
    telegramId: r.telegramId, lang: (r.languagePref === 'en' ? 'en' : 'uk') as 'uk' | 'en', onboarded: !!r.onboardedAt };
}

export class FriendService {
  static async areFriends(a: number, b: number): Promise<boolean> {
    const [row] = await db.select({ id: friendships.id }).from(friendships)
      .where(and(pairOf(a, b), eq(friendships.status, 'accepted'))).limit(1);
    return !!row;
  }

  /** Ids of my mutual friends. */
  static async friendIds(userId: number): Promise<number[]> {
    const rows = await db.select({ a: friendships.requesterId, b: friendships.addresseeId }).from(friendships)
      .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))));
    return rows.map((r) => (r.a === userId ? r.b : r.a));
  }

  /** My friends, requests to me waiting for an answer, and mine waiting for theirs. */
  static async list(userId: number) {
    const rows = await db.select().from(friendships)
      .where(and(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)), sql`${friendships.status} <> 'declined'`));
    const other = (r: typeof rows[number]) => (r.requesterId === userId ? r.addresseeId : r.requesterId);
    const cards = await people(rows.map(other));
    const view = (r: typeof rows[number]) => {
      const p = cards.get(other(r))!;
      return { friendshipId: r.id, userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, username: p.username };
    };
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(view),
      incoming: rows.filter((r) => r.status === 'pending' && r.addresseeId === userId).map(view),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requesterId === userId).map(view),
    };
  }

  /**
   * Ask to be friends. The other side gets one message with «Прийняти / Відхилити»;
   * if they had already asked us, we're friends right away and they hear about it.
   */
  static async request(fromId: number, toId: number) {
    if (fromId === toId) throw new AppError('Це ти', 400);
    const cards = await people([fromId, toId]);
    const from = cards.get(fromId);
    const to = cards.get(toId);
    if (!from || !to?.onboarded) throw new AppError('Цього студента ще немає в KSE Hub', 404);

    const [existing] = await db.select().from(friendships).where(pairOf(fromId, toId)).limit(1);
    const action = requestAction(existing ?? null, fromId);
    if (action === 'create') {
      const [row] = await db.insert(friendships).values({ requesterId: fromId, addresseeId: toId }).onConflictDoNothing().returning();
      if (!row) return { status: 'pending' as const };
      AnalyticsService.track(fromId, 'friend.request');
      const en = to.lang === 'en';
      await PushService.send({ id: to.userId, telegramId: to.telegramId }, 'friend', friendRequestText(to.lang, escapeHtml(from.name)),
        new InlineKeyboard().text(en ? 'Accept' : 'Прийняти', `fr:a:${row.id}`).text(en ? 'Decline' : 'Відхилити', `fr:d:${row.id}`));
      return { status: 'pending' as const };
    }
    if (action === 'accept') {
      await this.accept(existing!.id);
      AnalyticsService.track(fromId, 'friend.accept');
      await this.tellFriends(to, from);
      return { status: 'accepted' as const };
    }
    return { status: action === 'already_friends' ? 'accepted' as const : 'pending' as const };
  }

  /** The addressee answers a request (from the bot buttons or the mini app). */
  static async respond(actorId: number, friendshipId: number, accept: boolean) {
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId)).limit(1);
    if (!row || row.addresseeId !== actorId) throw new AppError('Запит не знайдено', 404);
    if (row.status !== 'pending') return { status: row.status, alreadyDecided: true };
    if (!accept) {
      await db.update(friendships).set({ status: 'declined', decidedAt: new Date() }).where(eq(friendships.id, friendshipId));
      return { status: 'declined' as const, alreadyDecided: false };
    }
    await this.accept(friendshipId);
    AnalyticsService.track(actorId, 'friend.accept');
    const cards = await people([row.requesterId, actorId]);
    await this.tellFriends(cards.get(row.requesterId)!, cards.get(actorId)!);
    return { status: 'accepted' as const, alreadyDecided: false };
  }

  static async remove(userId: number, otherId: number) {
    await db.delete(friendships).where(pairOf(userId, otherId));
  }

  /**
   * Friends picked for schedule comparison used to live only on the phone (CloudStorage).
   * Each of them gets a proper request, with a message, so they see it.
   */
  static async importFromPhone(userId: number, ids: number[]) {
    const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id !== userId))].slice(0, IMPORT_LIMIT);
    const results: { userId: number; status: string }[] = [];
    for (const id of unique) {
      try {
        results.push({ userId: id, ...(await this.request(userId, id)) });
      } catch {
        results.push({ userId: id, status: 'unavailable' });
      }
    }
    return results;
  }

  /** The link to share: opening it starts the bot with inv_<code>. */
  static async inviteLink(userId: number) {
    return `https://t.me/${await botUsername()}?start=inv_${signInvite(userId)}`;
  }

  /** Came through an invite and finished onboarding: friends with the inviter, who learns "Данило вже в KSE Hub". */
  static async joinedByInvite(newUserId: number) {
    const [user] = await db.select({ invitedBy: users.invitedBy }).from(users).where(and(eq(users.id, newUserId), isNotNull(users.invitedBy))).limit(1);
    if (!user?.invitedBy) return;
    const inviterId = user.invitedBy;
    const [existing] = await db.select().from(friendships).where(pairOf(inviterId, newUserId)).limit(1);
    if (existing?.status === 'accepted') return;
    if (existing) await this.accept(existing.id);
    else await db.insert(friendships).values({ requesterId: inviterId, addresseeId: newUserId, status: 'accepted', decidedAt: new Date() }).onConflictDoNothing();
    AnalyticsService.track(inviterId, 'invite.joined');
    const cards = await people([inviterId, newUserId]);
    const inviter = cards.get(inviterId);
    const joined = cards.get(newUserId);
    if (!inviter || !joined) return;
    const en = inviter.lang === 'en';
    await PushService.send({ id: inviter.userId, telegramId: inviter.telegramId }, 'friend',
      en ? `<b>${escapeHtml(joined.name)} is on KSE Hub now</b>\nYou're friends: compare schedules and remind each other about deadlines.`
        : `<b>${escapeHtml(joined.name)} вже в KSE Hub</b>\nВи друзі: можна порівнювати розклад і нагадувати одне одному про дедлайни.`,
      appButton(en ? 'Open schedule' : 'Відкрити розклад', 'today', 'friend'));
  }

  private static async accept(id: number) {
    await db.update(friendships).set({ status: 'accepted', decidedAt: new Date() }).where(eq(friendships.id, id));
  }

  /** The one who asked learns the answer. */
  private static async tellFriends(requester: ReturnType<typeof card>, accepter: ReturnType<typeof card>) {
    const en = requester.lang === 'en';
    await PushService.send({ id: requester.userId, telegramId: requester.telegramId }, 'friend',
      en ? `<b>${escapeHtml(accepter.name)} accepted your friend request</b>` : `<b>${escapeHtml(accepter.name)} тепер у твоїх друзях</b>`);
  }
}
