import ical from 'node-ical';
import { db } from '../db/connection.js';
import { moodleCourses, moodleAssignments, users } from '../db/schema.js';
import { eq, and, gte, asc } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';

export class MoodleService {
  /**
   * Sync deadlines & courses from an iCal webcal URL.
   * Parses events, extracts courses, due dates, and direct links.
   */
  static async syncCalendar(userId: number, calendarUrl?: string | null) {
    let url = calendarUrl;

    if (!url) {
      const [u] = await db
        .select({ calendarUrl: users.calendarUrl })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      url = u?.calendarUrl;
    }

    if (!url) {
      throw new AppError('Calendar URL not configured. Add it in Profile Settings.', 400);
    }

    // Support webcal:// protocol by replacing with https://
    const fetchUrl = url.trim().replace(/^webcal:\/\//i, 'https://');

    let events: any;
    try {
      events = await ical.async.fromURL(fetchUrl);
    } catch (err: any) {
      throw new AppError(`Failed to fetch or parse iCal feed: ${err.message || 'Network error'}`, 502);
    }

    if (!events || typeof events !== 'object') {
      throw new AppError('Invalid iCal feed format', 502);
    }

    const courseMap = new Map<string, number>(); // courseName -> courseId in DB

    // 1. First pass: extract distinct course names from events (categories/summaries/descriptions)
    for (const k in events) {
      if (!Object.prototype.hasOwnProperty.call(events, k)) continue;
      const ev = events[k];
      if (ev.type !== 'VEVENT') continue;

      const courseName = this.extractCourseName(ev);
      if (courseName && !courseMap.has(courseName)) {
        // Upsert course in DB
        const existing = await db
          .select()
          .from(moodleCourses)
          .where(
            and(
              eq(moodleCourses.userId, userId),
              eq(moodleCourses.courseName, courseName)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(moodleCourses)
            .set({ syncedAt: new Date() })
            .where(eq(moodleCourses.id, existing[0].id));
          courseMap.set(courseName, existing[0].id);
        } else {
          // Generate a pseudo course ID based on course name hash or slug
          const pseudoId = Buffer.from(courseName).toString('base64').slice(0, 16);
          const [newCourse] = await db
            .insert(moodleCourses)
            .values({
              userId,
              courseId: pseudoId,
              courseName,
              syncedAt: new Date(),
            })
            .returning();
          courseMap.set(courseName, newCourse.id);
        }
      }
    }

    // 2. Second pass: Upsert assignments / quizzes / events
    let count = 0;
    for (const k in events) {
      if (!Object.prototype.hasOwnProperty.call(events, k)) continue;
      const ev = events[k];
      if (ev.type !== 'VEVENT') continue;

      const uid = ev.uid || k;
      const title = ev.summary || 'Untitled Event';
      const dueDate = ev.end || ev.start || null;
      const courseName = this.extractCourseName(ev);
      const courseId = courseName ? courseMap.get(courseName) || null : null;
      const sourceUrl = this.extractSourceUrl(ev);
      const type = this.detectEventType(ev);

      const existing = await db
        .select()
        .from(moodleAssignments)
        .where(
          and(
            eq(moodleAssignments.userId, userId),
            eq(moodleAssignments.externalId, uid)
          )
        )
        .limit(1);

      const values = {
        userId,
        courseId,
        externalId: uid,
        title,
        dueDate: dueDate ? new Date(dueDate) : null,
        sourceUrl,
        type,
      };

      if (existing.length > 0) {
        await db
          .update(moodleAssignments)
          .set(values)
          .where(eq(moodleAssignments.id, existing[0].id));
      } else {
        await db.insert(moodleAssignments).values(values);
      }
      count++;
    }

    return { totalEvents: count, coursesCount: courseMap.size };
  }

  /**
   * Helper to extract course name from iCal event (Moodle puts course in CATEGORIES, SUMMARY, or DESCRIPTION)
   */
  private static extractCourseName(ev: any): string {
    // 1. Check categories (Moodle standard)
    if (ev.categories && Array.isArray(ev.categories) && ev.categories.length > 0) {
      const cat = ev.categories[0].trim();
      if (cat && !cat.toLowerCase().includes('calendar') && !cat.toLowerCase().includes('moodle')) {
        return cat;
      }
    }

    // 2. Check summary prefix or brackets: e.g. "[Introduction to Calculus] Homework 1" or "CS101: Assignment 2"
    if (ev.summary) {
      const bracketMatch = ev.summary.match(/^\[(.*?)\]/);
      if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();

      const colonMatch = ev.summary.match(/^([A-Za-z0-9\s]{3,30}):/);
      if (colonMatch && colonMatch[1]) return colonMatch[1].trim();
    }

    // 3. Check description for Course Name:
    if (ev.description) {
      const descMatch = ev.description.match(/Course:\s*([^\n\r]+)/i);
      if (descMatch && descMatch[1]) return descMatch[1].trim();
    }

    return 'General / University';
  }

  /**
   * Helper to extract direct link to assignment/course
   */
  private static extractSourceUrl(ev: any): string | null {
    if (ev.url) return ev.url;
    if (ev.description) {
      const urlMatch = ev.description.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) return urlMatch[0];
    }
    return 'https://teaching.kse.org.ua';
  }

  /**
   * Determine whether event is assignment, quiz, or event
   */
  private static detectEventType(ev: any): 'assignment' | 'quiz' | 'event' {
    const text = `${ev.summary || ''} ${ev.description || ''}`.toLowerCase();
    if (text.includes('quiz') || text.includes('тест') || text.includes('іспит') || text.includes('exam')) {
      return 'quiz';
    }
    if (text.includes('assign') || text.includes('завдання') || text.includes('homework') || text.includes('дз')) {
      return 'assignment';
    }
    return 'event';
  }

  /**
   * Get user's courses.
   */
  static async getUserCourses(userId: number) {
    return db
      .select()
      .from(moodleCourses)
      .where(eq(moodleCourses.userId, userId))
      .orderBy(moodleCourses.courseName);
  }

  /**
   * Get upcoming deadlines (assignments, quizzes, events).
   */
  static async getDeadlines(userId: number, includeCompleted = false) {
    const conditions = [
      eq(moodleAssignments.userId, userId),
    ];

    if (!includeCompleted) {
      conditions.push(eq(moodleAssignments.isCompleted, false));
    }

    return db
      .select({
        assignment: moodleAssignments,
        courseName: moodleCourses.courseName,
      })
      .from(moodleAssignments)
      .leftJoin(moodleCourses, eq(moodleAssignments.courseId, moodleCourses.id))
      .where(and(...conditions))
      .orderBy(asc(moodleAssignments.dueDate));
  }

  /**
   * Toggle assignment completion.
   */
  static async toggleCompleted(assignmentId: number, userId: number) {
    const [existing] = await db
      .select()
      .from(moodleAssignments)
      .where(
        and(
          eq(moodleAssignments.id, assignmentId),
          eq(moodleAssignments.userId, userId)
        )
      )
      .limit(1);

    if (!existing) {
      throw new AppError('Assignment not found', 404);
    }

    const [updated] = await db
      .update(moodleAssignments)
      .set({ isCompleted: !existing.isCompleted })
      .where(eq(moodleAssignments.id, assignmentId))
      .returning();

    return updated;
  }
}
