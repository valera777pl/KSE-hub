import { db } from '../db/connection.js';
import { emails, moodleAssignments, moodleCourses, summaries, users, type DigestSource, type EmailSource } from '../db/schema.js';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import { escapeHtml } from '../bot/send.js';
import { formatKyiv, timeLeft } from '../utils/kyivTime.js';

type User = typeof users.$inferSelect;

export const SOURCE_LABELS: Record<DigestSource, string> = {
  moodle: '📚 Moodle',
  gmail: '📧 Пошта',
  slack: '💬 Slack',
};

const EMAILS_PER_SECTION = 10;
const EMAIL_LOOKBACK_MS = 3 * 24 * 3_600_000;

/**
 * Builds the digest text: one section per source the student picked.
 * Sources with nothing new are skipped; returns null when every section is empty.
 */
export class DigestService {
  /**
   * @param markDigested the scheduled digest marks the included emails so they
   *   don't repeat tomorrow; the /digest preview leaves them alone.
   */
  static async build(user: User, { markDigested = false } = {}): Promise<string | null> {
    const sections: string[] = [];
    const includedEmailIds: number[] = [];

    for (const source of user.digestSources) {
      const parts: string[] = [];
      if (source === 'moodle') {
        const deadlines = await this.moodleDeadlines(user);
        if (deadlines) parts.push(deadlines);
      }
      const mail = await this.emailLines(user, source);
      if (mail.lines.length) {
        parts.push(mail.lines.join('\n'));
        includedEmailIds.push(...mail.ids);
      }
      if (parts.length) sections.push(`<b>${SOURCE_LABELS[source]}</b>\n${parts.join('\n\n')}`);
    }

    if (markDigested && includedEmailIds.length) {
      await db.update(emails).set({ digestedAt: new Date() }).where(inArray(emails.id, includedEmailIds));
    }

    if (sections.length === 0) return null;
    return `🗞 <b>Твій дайджест</b>\n\n${sections.join('\n\n')}`;
  }

  private static async moodleDeadlines(user: User): Promise<string | null> {
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

  /** Not-yet-digested emails from this source, important first, newsletters left out. */
  private static async emailLines(user: User, source: EmailSource) {
    const rows = await db
      .select({ id: emails.id, subject: emails.subject, fromName: emails.fromName, summary: summaries.summary })
      .from(emails)
      .innerJoin(summaries, eq(emails.summaryId, summaries.id))
      .where(
        and(
          eq(emails.userId, user.id),
          eq(emails.source, source),
          isNull(emails.digestedAt),
          ne(summaries.category, 'newsletter'),
          gt(emails.receivedAt, new Date(Date.now() - EMAIL_LOOKBACK_MS))
        )
      )
      .orderBy(desc(summaries.important), desc(emails.receivedAt))
      .limit(EMAILS_PER_SECTION);

    return {
      ids: rows.map((r) => r.id),
      lines: rows.map((r) => {
        const from = r.fromName ? ` · <i>${escapeHtml(r.fromName)}</i>` : '';
        return `• <b>${escapeHtml(r.subject ?? '')}</b>${from}\n  ${escapeHtml(r.summary)}`;
      }),
    };
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
