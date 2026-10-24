import { db } from '../db/connection.js';
import {
  emails, googleAccounts, opportunities, summaries, users,
  type EmailCategory, type EmailSource,
} from '../db/schema.js';
import { and, eq, gt, inArray, ne, or } from 'drizzle-orm';
import { GoogleService } from './googleService.js';
import { sha256 } from '../utils/crypto.js';
import { escapeHtml, sendToUser } from '../bot/send.js';
import { chatCompletion, hasAI } from '../ai/client.js';

// Gemini's free tier allows only a few requests per minute, shared with the assistant
const MAX_MESSAGES_PER_SYNC = 10;
const SUMMARY_CONCURRENCY = 1;
const BASE_QUERY = '-in:spam -in:trash -category:promotions -category:social';
const CATEGORIES: EmailCategory[] = ['deadline', 'event', 'internship', 'job', 'startup', 'admin', 'newsletter', 'other'];

type Account = typeof googleAccounts.$inferSelect;
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  internalDate: string;
  payload: GmailPart & { headers: { name: string; value: string }[] };
};

export class GmailService {
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
    const summary = await this.summaryFor(messageIdHeader, subject, from, body);

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
      await saveOpportunity(summary, subject, senderName(from));
    }
    return { ...row, summary };
  }

  /**
   * Reuse an existing summary when the same content was already seen
   * (same Message-ID across inboxes, or same normalized body) — 0 tokens.
   */
  private static async summaryFor(messageIdHeader: string | null, subject: string, from: string, body: string) {
    const bodyHash = sha256(normalize(`${subject}\n${body}`));
    const existing = await findSummary(messageIdHeader, bodyHash);
    if (existing) return existing;

    const generated = await summarize(subject, from, body);
    await db.insert(summaries).values({ messageIdHeader, bodyHash, ...generated }).onConflictDoNothing();
    // Re-read: a parallel sync of the same mailing may have won the insert
    return (await findSummary(messageIdHeader, bodyHash))!;
  }

  /** Deadlines and admin notices that the model flagged important go out right away, not in the digest. */
  private static async pushUrgent(userId: number, stored: StoredEmail[]) {
    const urgent = stored.filter((e) => e.summary.important && ['deadline', 'admin'].includes(e.summary.category));
    if (urgent.length === 0) return;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.botBlocked || !user.digestSources.includes(urgent[0].source)) return;

    for (const email of urgent) {
      const text = `🚨 <b>${escapeHtml(email.subject ?? '')}</b>\n<i>${escapeHtml(email.fromName ?? '')}</i>\n\n${escapeHtml(email.summary.summary)}`;
      if (await sendToUser(user.telegramId, text)) {
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

async function summarize(subject: string, from: string, body: string) {
  // Without any AI key the digest still works, just with snippets. A failing
  // model throws instead, so the email is retried rather than cached as a snippet.
  if (!hasAI()) {
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 220);
    return { summary: snippet ? `${snippet}…` : subject, category: 'other' as EmailCategory, important: false };
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
          'internship/job — стажування та вакансії; startup — пошук команди чи стартап-активності; newsletter — розсилки без дії.',
      },
      { role: 'user', content: `Від: ${from}\nТема: ${subject}\n\n${body.slice(0, 6000)}` },
    ],
  });

  const raw = JSON.parse(completion.choices[0]?.message?.content || '{}');
  const category: EmailCategory = CATEGORIES.includes(raw.category) ? raw.category : 'other';
  return {
    summary: String(raw.summary || subject).slice(0, 1000),
    category,
    important: raw.important === true,
  };
}

async function saveOpportunity(summary: Summary, subject: string, company: string) {
  // One opportunity per summary, however many inboxes it arrived in
  const sourceKey = `summary:${summary.id}`;
  const [exists] = await db.select({ id: opportunities.id }).from(opportunities)
    .where(eq(opportunities.slackMessageId, sourceKey)).limit(1);
  if (exists) return;
  await db.insert(opportunities).values({
    title: subject.slice(0, 500),
    company: (company || 'KSE').slice(0, 255),
    category: summary.category === 'job' ? 'job' : 'internship',
    description: summary.summary,
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
function isClassScheduleNotice(from: string, subject: string): boolean {
  if (/KSE Hub Worker/i.test(from) || /calendar-notification@google\.com/i.test(from)) return true;
  return /^(updated invitation|new event|invitation|event canceled|canceled event|cancelled event|оновлене запрошення|нова подія|запрошення|подію скасовано)[^:]{0,40}:\s*[A-Z]{2,6}\d{3}\b/i.test(subject.trim());
}

function detectSource(from: string): EmailSource {
  const f = from.toLowerCase();
  if (f.includes('slack.com')) return 'slack';
  if (f.includes('teaching.kse.org.ua') || f.includes('moodle')) return 'moodle';
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
function normalize(text: string): string {
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
