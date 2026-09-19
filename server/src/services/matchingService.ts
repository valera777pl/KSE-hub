import { db } from '../db/connection.js';
import {
  ventureProfiles,
  ventureProjects,
  swipes,
  matches,
  users,
} from '../db/schema.js';
import { eq, and, ne, notInArray, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';

export class MatchingService {
  /**
   * Get unseen profiles for the swipe deck.
   * Excludes the current user's own profile and already-swiped profiles.
   */
  static async getSwipeDeck(userId: number, type: 'profile' | 'project', limit = 10) {
    // Get IDs already swiped by this user
    const swipedIds = await db
      .select({ targetId: swipes.targetId })
      .from(swipes)
      .where(
        and(
          eq(swipes.actorId, userId),
          eq(swipes.targetType, type)
        )
      );

    const excludeIds = swipedIds.map((s) => s.targetId);

    if (type === 'profile') {
      const query = db
        .select({
          profile: ventureProfiles,
          user: {
            id: users.id,
            fullName: users.fullName,
            username: users.username,
            avatarUrl: users.avatarUrl,
            faculty: users.faculty,
            year: users.year,
          },
        })
        .from(ventureProfiles)
        .innerJoin(users, eq(ventureProfiles.userId, users.id))
        .where(
          and(
            eq(ventureProfiles.isActive, true),
            ne(ventureProfiles.userId, userId),
            excludeIds.length > 0
              ? notInArray(ventureProfiles.id, excludeIds)
              : undefined
          )
        )
        .limit(limit);

      return query;
    } else {
      const query = db
        .select({
          project: ventureProjects,
          user: {
            id: users.id,
            fullName: users.fullName,
            username: users.username,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(ventureProjects)
        .innerJoin(users, eq(ventureProjects.userId, users.id))
        .where(
          and(
            eq(ventureProjects.isActive, true),
            ne(ventureProjects.userId, userId),
            excludeIds.length > 0
              ? notInArray(ventureProjects.id, excludeIds)
              : undefined
          )
        )
        .limit(limit);

      return query;
    }
  }

  /**
   * Record a swipe and check for mutual match.
   * Returns match data if mutual interest detected.
   */
  static async recordSwipe(
    actorId: number,
    targetId: number,
    targetType: 'profile' | 'project',
    isLike: boolean
  ) {
    // Record the swipe
    await db
      .insert(swipes)
      .values({ actorId, targetId, targetType, isLike })
      .onConflictDoNothing();

    if (!isLike) return { matched: false };

    // Check for mutual match
    // Find the owner of the target
    let targetUserId: number | null = null;
    let projectId: number | null = null;

    if (targetType === 'profile') {
      const [profile] = await db
        .select()
        .from(ventureProfiles)
        .where(eq(ventureProfiles.id, targetId))
        .limit(1);
      targetUserId = profile?.userId ?? null;
    } else {
      const [project] = await db
        .select()
        .from(ventureProjects)
        .where(eq(ventureProjects.id, targetId))
        .limit(1);
      targetUserId = project?.userId ?? null;
      projectId = project?.id ?? null;
    }

    if (!targetUserId) return { matched: false };

    // Check if target user has also liked the actor's profile
    const actorProfile = await db
      .select()
      .from(ventureProfiles)
      .where(eq(ventureProfiles.userId, actorId))
      .limit(1);

    if (actorProfile.length === 0) return { matched: false };

    const reverseSwipe = await db
      .select()
      .from(swipes)
      .where(
        and(
          eq(swipes.actorId, targetUserId),
          eq(swipes.targetId, actorProfile[0].id),
          eq(swipes.targetType, 'profile'),
          eq(swipes.isLike, true)
        )
      )
      .limit(1);

    if (reverseSwipe.length === 0) return { matched: false };

    // Create match!
    const [match] = await db
      .insert(matches)
      .values({
        userAId: actorId,
        userBId: targetUserId,
        matchType: targetType,
        projectId,
      })
      .returning();

    // Get matched user info for the modal
    const [matchedUser] = await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    return { matched: true, match, matchedUser };
  }

  /**
   * Get user's matches.
   */
  static async getUserMatches(userId: number) {
    const userMatches = await db
      .select()
      .from(matches)
      .where(
        sql`${matches.userAId} = ${userId} OR ${matches.userBId} = ${userId}`
      )
      .orderBy(sql`${matches.matchedAt} DESC`);

    // Enrich with user data
    const enriched = await Promise.all(
      userMatches.map(async (match) => {
        const otherUserId = match.userAId === userId ? match.userBId : match.userAId;
        const [otherUser] = await db
          .select({
            id: users.id,
            telegramId: users.telegramId,
            username: users.username,
            fullName: users.fullName,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(eq(users.id, otherUserId))
          .limit(1);

        return { ...match, otherUser };
      })
    );

    return enriched;
  }
}
