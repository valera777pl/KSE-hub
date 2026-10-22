import { db } from '../db/connection.js';
import { moodleAssignments, moodleCourses, users, type DigestSource } from '../db/schema.js';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { escapeHtml } from '../bot/send.js';
import { formatKyiv, timeLeft } from '../utils/kyivTime.js';

type User = typeof users.$inferSelect;

export const SOURCE_LABELS: Record<DigestSource, string> = {
  moodle: '📚 Moodle',
  gmail: '📧 Пошта',
  slack: '💬 Slack',
};

/**
 * Builds the digest text: one section per source the student picked.
 * Sources with nothing new are skipped; returns null when every section is empty.
 */
export class DigestService {
  static async build(user: User): Promise<string | null> {
    const sections: string[] = [];

    for (const source of user.digestSources) {
      const body = await this.section(user, source);
      if (body) sections.push(`<b>${SOURCE_LABELS[source]}</b>\n${body}`);
    }

    if (sections.length === 0) return null;
    return `🗞 <b>Твій дайджест</b>\n\n${sections.join('\n\n')}`;
  }

  private static async section(user: User, source: DigestSource): Promise<string | null> {
    switch (source) {
      case 'moodle':
        return this.moodleSection(user);
      // Gmail and Slack land in the digest pipeline next; until then they're empty
      case 'gmail':
      case 'slack':
        return null;
    }
  }

  private static async moodleSection(user: User): Promise<string | null> {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const rows = await this.upcomingDeadlines(user.id, now, weekAhead, 10);
    if (rows.length === 0) return null;

    return rows
      .map(({ assignment, courseName }) => {
        const due = assignment.dueDate!;
        const course = courseName ? ` · <i>${escapeHtml(courseName)}</i>` : '';
        return `• ${escapeHtml(assignment.title)}${course}\n  ⏰ ${formatKyiv(due)} (${timeLeft(due, now)})`;
      })
      .join('\n');
  }

  static upcomingDeadlines(userId: number, from: Date, to: Date, limit = 20) {
    return db
      .select({ assignment: moodleAssignments, courseName: moodleCourses.courseName })
      .from(moodleAssignments)
      .leftJoin(moodleCourses, eq(moodleAssignments.courseId, moodleCourses.id))
      .where(
        and(
          eq(moodleAssignments.userId, userId),
          eq(moodleAssignments.isCompleted, false),
          gt(moodleAssignments.dueDate, from),
          lte(moodleAssignments.dueDate, to)
        )
      )
      .orderBy(asc(moodleAssignments.dueDate))
      .limit(limit);
  }
}
