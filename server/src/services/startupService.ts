import { InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { googleAccounts, projectApplications, users, ventureProfiles, ventureProjects } from '../db/schema.js';
import { and, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';
import { escapeHtml, openAppKeyboard, sendToUser } from '../bot/send.js';
import { nameFromEmail } from './scheduleService.js';
import { AnalyticsService } from './analyticsService.js';

type ProjectInput = {
  title: string;
  pitch?: string;
  problem?: string;
  targetMvp?: string;
  requiredRoles?: string[];
  commitmentLevel?: string;
};

type Person = { id: number; fullName: string; username: string | null; telegramId: number; email: string | null };

/** The KSE email name ("Ivan Petrenko") beats a Telegram nickname for recognising classmates. */
export function displayName(p: { fullName: string; email: string | null }): string {
  return p.email ? nameFromEmail(p.email).name : p.fullName;
}

/** A Telegram link to the person: public username if they have one, otherwise their account id. */
export function contactLink(p: { username: string | null; telegramId: number }): string {
  return p.username ? `https://t.me/${p.username}` : `tg://user?id=${p.telegramId}`;
}

const personColumns = {
  id: users.id,
  fullName: users.fullName,
  username: users.username,
  telegramId: users.telegramId,
  email: googleAccounts.email,
};

async function person(userId: number): Promise<Person> {
  const [p] = await db.select(personColumns).from(users)
    .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.id, userId)).limit(1);
  if (!p) throw new AppError('Студента не знайдено', 404);
  return p;
}

export class StartupService {
  /** Open startups of other students, newest first, with my application status if any. */
  static async list(userId: number, { query, role }: { query?: string; role?: string } = {}) {
    const conditions = [eq(ventureProjects.isActive, true), ne(ventureProjects.userId, userId)];
    if (query) {
      const like = `%${query}%`;
      conditions.push(or(ilike(ventureProjects.title, like), ilike(ventureProjects.pitch, like), ilike(ventureProjects.problem, like))!);
    }
    if (role) conditions.push(sql`${ventureProjects.requiredRoles}::text ilike ${`%${role}%`}`);

    const rows = await db
      .select({ project: ventureProjects, author: personColumns, myStatus: projectApplications.status })
      .from(ventureProjects)
      .innerJoin(users, eq(users.id, ventureProjects.userId))
      .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .leftJoin(projectApplications, and(eq(projectApplications.projectId, ventureProjects.id), eq(projectApplications.applicantId, userId)))
      .where(and(...conditions))
      .orderBy(desc(ventureProjects.createdAt))
      .limit(50);

    return rows.map(({ project, author, myStatus }) => ({
      project,
      author: { id: author.id, name: displayName(author) },
      myStatus,
    }));
  }

  static async mine(userId: number) {
    return db.select().from(ventureProjects).where(eq(ventureProjects.userId, userId)).orderBy(desc(ventureProjects.createdAt));
  }

  static async save(userId: number, data: ProjectInput, projectId?: number) {
    if (!projectId) {
      const [project] = await db.insert(ventureProjects).values({ ...data, userId }).returning();
      AnalyticsService.track(userId, 'startup.created');
      return project;
    }
    // Only the author may edit their startup
    const [project] = await db.update(ventureProjects)
      .set({ ...data, isActive: true, updatedAt: new Date() })
      .where(and(eq(ventureProjects.id, projectId), eq(ventureProjects.userId, userId)))
      .returning();
    if (!project) throw new AppError('Стартап не знайдено', 404);
    return project;
  }

  /** Hide from the list (team found, project paused); applications are kept. */
  static async close(userId: number, projectId: number) {
    const [project] = await db.update(ventureProjects)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(ventureProjects.id, projectId), eq(ventureProjects.userId, userId)))
      .returning();
    if (!project) throw new AppError('Стартап не знайдено', 404);
    return project;
  }

  static async apply(userId: number, projectId: number, role: string | undefined, message: string | undefined) {
    const [project] = await db.select().from(ventureProjects).where(eq(ventureProjects.id, projectId)).limit(1);
    if (!project || !project.isActive) throw new AppError('Стартап не знайдено або набір закрито', 404);
    if (project.userId === userId) throw new AppError('Це твій стартап 🙂', 400);

    const [application] = await db.insert(projectApplications)
      .values({ projectId, applicantId: userId, role: role || null, message: message || null })
      .onConflictDoNothing()
      .returning();
    if (!application) throw new AppError('Ти вже подав заявку в цей стартап', 409);
    AnalyticsService.track(userId, 'startup.applied');

    // Tell the author right away, with buttons to answer from the chat
    const [applicant, author] = await Promise.all([person(userId), person(project.userId)]);
    const [profile] = await db.select().from(ventureProfiles).where(eq(ventureProfiles.userId, userId)).limit(1);
    const about = profile
      ? `\n${escapeHtml(profile.title)}${profile.skills?.length ? ` · ${escapeHtml(profile.skills.slice(0, 6).join(', '))}` : ''}`
      : '';
    const text =
      `🙋 <b>Нова заявка в «${escapeHtml(project.title)}»</b>\n\n` +
      `<b>${escapeHtml(displayName(applicant))}</b>${role ? ` — ${escapeHtml(role)}` : ''}${about}` +
      (message ? `\n\n«${escapeHtml(message)}»` : '');
    await sendToUser(author.telegramId, text, new InlineKeyboard()
      .text('Прийняти', `vapp:a:${application.id}`)
      .text('Відхилити', `vapp:d:${application.id}`));

    return application;
  }

  /** Applications to my startups and the ones I sent. Contacts are revealed only after acceptance. */
  static async applications(userId: number) {
    const myProjects = await db.select({ id: ventureProjects.id }).from(ventureProjects).where(eq(ventureProjects.userId, userId));
    const incomingRows = myProjects.length
      ? await db
          .select({ application: projectApplications, project: { id: ventureProjects.id, title: ventureProjects.title }, applicant: personColumns, profile: ventureProfiles })
          .from(projectApplications)
          .innerJoin(ventureProjects, eq(ventureProjects.id, projectApplications.projectId))
          .innerJoin(users, eq(users.id, projectApplications.applicantId))
          .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
          .leftJoin(ventureProfiles, eq(ventureProfiles.userId, users.id))
          .where(inArray(projectApplications.projectId, myProjects.map((p) => p.id)))
          .orderBy(desc(projectApplications.createdAt))
      : [];

    const outgoingRows = await db
      .select({ application: projectApplications, project: { id: ventureProjects.id, title: ventureProjects.title }, author: personColumns })
      .from(projectApplications)
      .innerJoin(ventureProjects, eq(ventureProjects.id, projectApplications.projectId))
      .innerJoin(users, eq(users.id, ventureProjects.userId))
      .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(eq(projectApplications.applicantId, userId))
      .orderBy(desc(projectApplications.createdAt));

    return {
      incoming: incomingRows.map(({ application, project, applicant, profile }) => ({
        ...application,
        project,
        applicant: {
          name: displayName(applicant),
          headline: profile?.title ?? null,
          skills: profile?.skills ?? [],
          // The author is deciding whether to talk to them; seeing who it is is fine, the chat link comes after "accept"
          contact: application.status === 'accepted' ? contactLink(applicant) : null,
        },
      })),
      outgoing: outgoingRows.map(({ application, project, author }) => ({
        ...application,
        project,
        author: { name: displayName(author), contact: application.status === 'accepted' ? contactLink(author) : null },
      })),
    };
  }

  /** The author accepts or declines; both sides learn the outcome in the bot. */
  static async decide(authorId: number, applicationId: number, accept: boolean) {
    const [row] = await db
      .select({ application: projectApplications, project: ventureProjects })
      .from(projectApplications)
      .innerJoin(ventureProjects, eq(ventureProjects.id, projectApplications.projectId))
      .where(eq(projectApplications.id, applicationId))
      .limit(1);
    if (!row || row.project.userId !== authorId) throw new AppError('Заявку не знайдено', 404);
    if (row.application.status !== 'pending') {
      return { application: row.application, applicant: await person(row.application.applicantId), alreadyDecided: true };
    }

    const [application] = await db.update(projectApplications)
      .set({ status: accept ? 'accepted' : 'declined', decidedAt: new Date() })
      .where(eq(projectApplications.id, applicationId))
      .returning();
    AnalyticsService.track(authorId, accept ? 'startup.accepted' : 'startup.declined');

    const [applicant, author] = await Promise.all([person(application.applicantId), person(authorId)]);
    const title = escapeHtml(row.project.title);
    if (accept) {
      await sendToUser(applicant.telegramId,
        `🎉 <b>Тебе прийняли в «${title}»!</b>\n\nНапиши автору: <a href="${contactLink(author)}">${escapeHtml(displayName(author))}</a>`);
    } else {
      await sendToUser(applicant.telegramId,
        `Автор «${title}» поки не готовий взяти тебе в команду. Подивись інші стартапи 👇`, openAppKeyboard('Стартапи KSE'));
    }
    return { application, applicant, alreadyDecided: false };
  }
}
