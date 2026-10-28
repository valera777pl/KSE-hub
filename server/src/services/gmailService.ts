import { db } from '../db/connection.js';
import {
  emails, googleAccounts, opportunities, summaries, users,
  type EmailCategory, type EmailSource,
} from '../db/schema.js';
import { and, eq, gt, inArray, ne, or } from 'drizzle-orm';
import { GoogleService } from './googleService.js';
import { sha256 } from '../utils/crypto.js';
import { escapeHtml } from '../bot/send.js';
import { PushService } from './pushService.js';
import { chatCompletion, hasAI } from '../ai/client.js';
import { AnalyticsService } from './analyticsService.js';
import { MoodleService } from './moodleService.js';
import { isOtherGroup, parseMoodleMail } from '../utils/moodleGroups.js';

// Gemini's free tier allows only a few requests per minute, shared with the assistant
const MAX_MESSAGES_PER_SYNC = 10;
const SUMMARY_CONCURRENCY = 1;
const BASE_QUERY = '-in:spam -in:trash -category:promotions -category:social';
const DOMAINS = ['Tech', 'Economics & Finance', 'Consulting', 'Public sector', 'Marketing', 'Research', 'Other'];

/** Extra fields the model pulls out of internship/job emails for the Careers tab. */
type OpportunityDetails = { company?: string; deadline?: Date; link?: string; domain?: string; programs?: string[] };

const CATEGORIES: EmailCategory[] = ['deadline', 'event', 'internship', 'job', 'startup', 'admin', 'newsletter', 'other'];

type Account = typeof googleAccounts.$inferSelect;
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  internalDate: string;
  payload: GmailPart & { headers: { name: string; value: string }[] };
};

const ON_DEMAND_FRESHNESS_MS = 90_000;
const ON_DEMAND_TIMEOUT_MS = 20_000;

export class GmailService {
  /** Sync now if the last pull is older than 90 s; gives up quietly after 20 s so a chat reply isn't held hostage. */
  static async syncIfStale(userId: number): Promise<void> {
    const [account] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, userId)).limit(1);
    if (!account || account.syncError === 'invalid_grant') return;
    if (account.lastSyncAt && Date.now() - account.lastSyncAt.getTime() < ON_DEMAND_FRESHNESS_MS) return;
    await Promise.race([
      this.sync(account).catch((err) => console.error('On-demand Gmail sync failed:', err)),
      new Promise((resolve) => setTimeout(resolve, ON_DEMAND_TIMEOUT_MS)),
    ]);
  }

  /** Pull new mail for one account, summarize what's new, return how many emails were stored. */
  static async sync(account: Account): Promise<number> {
    const token = await GoogleService.accessToken(account);
    // First sync looks back 2 days; later ones overlap by 10 min to be safe
    const since = account.lastSyncAt
      ? `after:${Math.floor(account.lastSyncAt.getTime() / 1000) - 600}`
      : 'newer_than:2d';

    const list = await gmail<{ messages?: { id: string }[] }>(
      token,
      `messages?${new URLSearchParams({ q: `${since} ${BASE_QUERY}`, maxResults: String(MAX_MESSAGES_PER_SYNC) })}`
    );
    const ids = (list.messages ?? []).map((m) => m.id);

    const known = ids.length
      ? await db.select({ gmailId: emails.gmailId }).from(emails)
          .where(and(eq(emails.userId, account.userId), inArray(emails.gmailId, ids)))
      : [];
    const knownIds = new Set(known.map((k) => k.gmailId));
    const fresh = ids.filter((id) => !knownIds.has(id));

    const stored: StoredEmail[] = [];
    let failed = 0;
    await inBatches(fresh, SUMMARY_CONCURRENCY, async (id) => {
      try {
        const email = await this.ingest(account, token, id);
        if (email) stored.push(email);
      } catch (err) {
        failed++;
        console.error(`Gmail ingest failed (${account.email}, ${id}):`, err);
      }
    });

    // On failures keep the old sync point: the next run lists the same window
    // again, skips what's stored, and retries the rest
    await db.update(googleAccounts)
      .set(failed ? { syncError: `${failed} message(s) failed` } : { lastSyncAt: new Date(), syncError: null })
      .where(eq(googleAccounts.id, account.id));

    await this.pushUrgent(account.userId, stored);
    return stored.length;
  }

  private static async ingest(account: Account, token: string, gmailId: string): Promise<StoredEmail | null> {
    const msg = await gmail<GmailMessage>(token, `messages/${gmailId}?format=full`);
    const header = (name: string) =>
      msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = header('From');
    const subject = header('Subject') || '(без теми)';
    // Class schedule updates are shown by the schedule tab; not worth a digest line or AI quota
    if (isClassScheduleNotice(from, subject)) return null;

    const messageIdHeader = header('Message-ID').trim().toLowerCase() || null;
    const body = extractText(msg.payload);
    const source = detectSource(from);
    // Moodle receipts and feedback need no model: the subject says it all, and they update the assignment
    const moodleMail = source === 'moodle' ? parseMoodleMail(subject, body) : null;
    const { summary, opportunity } = moodleMail
      ? { summary: await plainSummary(messageIdHeader, subject, body), opportunity: undefined }
      : await this.summaryFor(messageIdHeader, subject, from, body);

    const [row] = await db.insert(emails).values({
      userId: account.userId,
      gmailId,
      source,
      fromName: senderName(from).slice(0, 255),
      subject,
      receivedAt: new Date(parseInt(msg.internalDate, 10)),
      summaryId: summary.id,
    }).onConflictDoNothing().returning();
    if (!row) return null;
    if (moodleMail) await MoodleService.applyMail(account.userId, moodleMail, row.receivedAt).catch((err) => console.error('Moodle mail status failed:', err));

    // The same mailing can reach one inbox twice (two lists, slightly different
    // footers): same summary, or same subject from the same sender within 2 days
    const [copy] = await db.select({ id: emails.id }).from(emails)
      .where(and(
        eq(emails.userId, account.userId),
        ne(emails.id, row.id),
        or(
          eq(emails.summaryId, summary.id),
          and(eq(emails.subject, row.subject!), eq(emails.fromName, row.fromName!), gt(emails.receivedAt, new Date(row.receivedAt.getTime() - 2 * 86_400_000)))
        )
      ))
      .limit(1);
    if (copy) {
      await db.update(emails).set({ digestedAt: new Date() }).where(eq(emails.id, row.id));
      return null;
    }

    if (summary.category === 'internship' || summary.category === 'job') {
      await saveOpportunity(summary, subject, senderName(from), opportunity);
    }
    return { ...row, summary };
  }

  /**
   * Reuse an existing summary when the same content was already seen
   * (same Message-ID across inboxes, or same normalized body) — 0 tokens.
   */
  private static async summaryFor(
    messageIdHeader: string | null, subject: string, from: string, body: string
  ): Promise<{ summary: Summary; opportunity?: OpportunityDetails }> {
    const bodyHash = sha256(normalize(`${subject}\n${body}`));
    const existing = await findSummary(messageIdHeader, bodyHash);
    if (existing) return { summary: existing };

    const { opportunity, ...generated } = await summarize(subject, from, body);
    await db.insert(summaries).values({ messageIdHeader, bodyHash, ...generated }).onConflictDoNothing();
    // Re-read: a parallel sync of the same mailing may have won the insert
    return { summary: (await findSummary(messageIdHeader, bodyHash))!, opportunity };
  }

  /** Deadlines and admin notices that the model flagged important go out right away, not in the digest. */
  private static async pushUrgent(userId: number, stored: StoredEmail[]) {
    const urgent = stored.filter((e) => e.summary.important && ['deadline', 'admin'].includes(e.summary.category));
    if (urgent.length === 0) return;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.botBlocked || !user.digestSources.includes(urgent[0].source)) return;
    const groups = urgent.some((e) => e.source === 'moodle') ? await MoodleService.groups(userId) : new Map();

    for (const email of urgent) {
      // A reminder about another practice group's quiz is not this student's business
      if (email.source === 'moodle' && isOtherGroup(email.subject ?? '', null, groups)) continue;
      const text = `🚨 <b>${escapeHtml(email.subject ?? '')}</b>\n<i>${escapeHtml(email.fromName ?? '')}</i>\n\n${escapeHtml(email.summary.summary)}`;
      if (await PushService.send(user, 'urgent', text)) {
        AnalyticsService.track(userId, 'urgent.sent');
        await db.update(emails).set({ digestedAt: new Date() }).where(eq(emails.id, email.id));
      }
    }
  }
}

type Summary = typeof summaries.$inferSelect;
type StoredEmail = typeof emails.$inferSelect & { summary: Summary };

async function findSummary(messageIdHeader: string | null, bodyHash: string): Promise<Summary | null> {
  const [row] = await db.select().from(summaries)
    .where(messageIdHeader
      ? or(eq(summaries.messageIdHeader, messageIdHeader), eq(summaries.bodyHash, bodyHash))
      : eq(summaries.bodyHash, bodyHash))
    .limit(1);
  return row ?? null;
}

/** A summary without the model: the subject is the whole story (Moodle receipts and feedback). */
async function plainSummary(messageIdHeader: string | null, subject: string, body: string): Promise<Summary> {
  const bodyHash = sha256(normalize(`${subject}\n${body}`));
  const existing = await findSummary(messageIdHeader, bodyHash);
  if (existing) return existing;
  await db.insert(summaries).values({ messageIdHeader, bodyHash, summary: subject, category: 'other', important: false }).onConflictDoNothing();
  return (await findSummary(messageIdHeader, bodyHash))!;
}

async function summarize(subject: string, from: string, body: string) {
  // Without any AI key the digest still works, just with snippets. A failing
  // model throws instead, so the email is retried rather than cached as a snippet.
  if (!hasAI()) {
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 220);
    return { summary: snippet ? `${snippet}…` : subject, category: 'other' as EmailCategory, important: false, opportunity: undefined };
  }
  return summarizeWithModel(subject, from, body);
}

async function summarizeWithModel(subject: string, from: string, body: string) {
  const completion = await chatCompletion({
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'Ти стискаєш університетські листи для студентів KSE. Відповідай JSON: ' +
          '{"summary": "1–2 речення українською: що сталося і що треба зробити, з датами/дедлайнами якщо є", ' +
          `"category": одне з ${CATEGORIES.map((c) => `"${c}"`).join(', ')}, ` +
          '"important": true лише якщо студенту треба діяти найближчими днями (дедлайн, зміна розкладу, обовʼязкова дія)}. ' +
          'internship/job — стажування та вакансії; startup — пошук команди чи стартап-активності; newsletter — розсилки без дії. ' +
          'Лише для internship/job додай поля: "company" (організація), "deadline" (YYYY-MM-DD або null), ' +
          `"link" (посилання на подачу заявки з листа або null), "domain" (одне з ${DOMAINS.map((d) => `"${d}"`).join(', ')}), ` +
          '"programs" (масив кодів програм KSE, для яких можливість, як у листі: "BE", "EBD" тощо; [] якщо для всіх або не сказано).',
      },
      { role: 'user', content: `Від: ${from}\nТема: ${subject}\n\n${body.slice(0, 6000)}` },
    ],
  });

  const raw = JSON.parse(completion.choices[0]?.message?.content || '{}');
  const category: EmailCategory = CATEGORIES.includes(raw.category) ? raw.category : 'other';
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline ?? '') ? new Date(`${raw.deadline}T23:59:00+03:00`) : undefined;
  return {
    summary: String(raw.summary || subject).slice(0, 1000),
    category,
    important: raw.important === true,
    opportunity: category === 'internship' || category === 'job'
      ? {
          company: typeof raw.company === 'string' && raw.company.trim() ? raw.company.trim() : undefined,
          deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
          link: typeof raw.link === 'string' && /^https?:\/\//.test(raw.link) ? raw.link : undefined,
          domain: DOMAINS.includes(raw.domain) ? raw.domain : undefined,
          programs: Array.isArray(raw.programs) ? raw.programs.filter((p: unknown) => typeof p === 'string' && /^[A-Z]{2,5}$/.test(p)).slice(0, 6) : [],
        }
      : undefined,
  };
}

async function saveOpportunity(summary: Summary, subject: string, sender: string, details: OpportunityDetails = {}) {
  // One opportunity per summary, however many inboxes it arrived in
  const sourceKey = `summary:${summary.id}`;
  const [exists] = await db.select({ id: opportunities.id }).from(opportunities)
    .where(eq(opportunities.slackMessageId, sourceKey)).limit(1);
  if (exists) return;
  await db.insert(opportunities).values({
    title: subject.slice(0, 500),
    company: (details.company || sender || 'KSE').slice(0, 255),
    category: summary.category === 'job' ? 'job' : 'internship',
    description: summary.summary,
    deadline: details.deadline ?? null,
    url: details.link ?? null,
    domain: details.domain ?? null,
    programs: details.programs ?? [],
    slackMessageId: sourceKey,
  });
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * KSE's schedule workers ("KSE Hub Worker #5") send an invitation for every
 * class change. Invitations to other events (seminars, from people) stay.
 */
export function isClassScheduleNotice(from: string, subject: string): boolean {
  if (/KSE Hub Worker/i.test(from) || /calendar-notification@google\.com/i.test(from)) return true;
  return /^(updated invitation|new event|invitation|event canceled|canceled event|cancelled event|оновлене запрошення|нова подія|запрошення|подію скасовано)[^:]{0,40}:\s*[A-Z]{2,6}\d{3}\b/i.test(subject.trim());
}

/** KSE's Moodle writes from msupport@kse.org.ua ("Не відповідайте на цей лист (via KSE)", "Grader AI (via KSE)"). */
export function detectSource(from: string): EmailSource {
  const f = from.toLowerCase();
  if (f.includes('slack.com')) return 'slack';
  if (f.includes('msupport@kse.org.ua') || f.includes('teaching.kse.org.ua') || f.includes('moodle')) return 'moodle';
  return 'gmail';
}

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m?.[1] ?? from).trim();
}

/** Prefer text/plain; fall back to stripped HTML. */
function extractText(part: GmailPart): string {
  const plain = findPart(part, 'text/plain');
  if (plain) return plain;
  const html = findPart(part, 'text/html');
  return html ? stripHtml(html) : '';
}

function findPart(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Drop the parts that differ between copies of one mailing: greetings, links, unsubscribe footers. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .split('\n')
    .filter((line) => !/^\s*(dear|hi|hello|шановн|привіт|вітаю|доброго)\b/.test(line))
    .filter((line) => !/unsubscribe|відписатися|відписка/.test(line))
    .join('\n')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}
