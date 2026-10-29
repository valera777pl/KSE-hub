/*
 * Slack notification emails ("New message in #math101-fall26") link to the channel:
 * https://<workspace>.slack.com/archives/C0123ABCD/p… — enough to open it from the course page.
 * We never read Slack itself; this is only what already arrived in the student's mail.
 */

export type SlackChannel = { courseCode: string; team: string; channelId: string; name: string | null };

const ARCHIVE = /https:\/\/([a-z0-9-]+)\.slack\.com\/archives\/([CG][A-Z0-9]{6,})/g;
const CHANNEL_NAME = /#([a-z0-9][a-z0-9_-]{1,79})/gi;

/** "math101-fall26" → "MATH101" */
export function courseFromChannel(name: string): string | null {
  const m = name.match(/^([a-z]{2,6})[-_]?(\d{3}[a-z]?)(?![0-9])/i);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : null;
}

/**
 * Course channels named in a Slack email. A channel counts only when the email has exactly one channel link
 * and one course-like channel name, so a message can't be pinned to the wrong channel.
 */
export function slackChannels(subject: string, body: string): SlackChannel[] {
  const text = `${subject}\n${body}`;
  const links = [...new Map([...text.matchAll(ARCHIVE)].map((m) => [m[2], m[1]])).entries()];
  const names = [...new Set([...text.matchAll(CHANNEL_NAME)].map((m) => m[1].toLowerCase()))].filter((n) => courseFromChannel(n));
  if (links.length !== 1 || names.length !== 1) return [];
  const [[channelId, team]] = links;
  return [{ courseCode: courseFromChannel(names[0])!, team, channelId, name: names[0] }];
}

/** Every channel a Slack notification email links to — the student is in each of them. */
export function archiveChannelIds(text: string): string[] {
  return [...new Set([...text.matchAll(ARCHIVE)].map((m) => m[2]))];
}

/** Channel names in Slack email subjects ("New message in #math101-pr8-autumn-2026") — older emails have only these. */
export function channelNamesIn(text: string): string[] {
  return [...new Set([...text.matchAll(CHANNEL_NAME)].map((m) => m[1].toLowerCase()))];
}

/** Who a private channel is for: a course (one section or all of them) or a cohort (programme, or all of them, + entry year). */
export type ChannelScope =
  | { kind: 'course'; courseCode: string; section: string | null }
  | { kind: 'cohort'; program: string | null; cohortYear: number };

/** Bachelor's takes 4 years, and cohort channels carry the graduation year: "be30" = BE, entered 2026. */
export const BACHELOR_YEARS = 4;

const SECTION = /^(p|pr|l|lec)(\d{1,2})$/;
const TERM = /^(autumn|fall|spring|summer|winter|\d{4}|\d{2})$/;
const COHORT = /^([a-z]{2,4})-?(\d{2})$/;

/** Cyrillic letters typed by mistake in Latin names: "intro_to_сalculus" (Cyrillic с) → "intro_to_calculus" */
const LOOKALIKES: Record<string, string> = { а: 'a', в: 'b', е: 'e', і: 'i', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  А: 'A', В: 'B', Е: 'E', І: 'I', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };
export const latinLookalikes = (s: string) => s.replace(/[авеікмнорстухАВЕІКМНОРСТХ]/g, (ch) => LOOKALIKES[ch]);

/** "pr8" → "P8", "l1" → "L1" */
function sectionFrom(word: string): string | null {
  const m = word.match(SECTION);
  return m ? `${m[1].startsWith('l') ? 'L' : 'P'}${Number(m[2])}` : null;
}

/** "Introduction to Calculus (BE, EBD)" → ["introduction", "to", "calculus"] */
const titleWords = (title: string) => title.replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Who a private channel is for, from its name alone:
 * - "math101-pr8-autumn-2026" → MATH101 P8; "math101-autumn-2026" → all of MATH101;
 * - "intro_to_calculus-pr6-…" → the course whose title starts with those words ("Introduction to Calculus"),
 *   only when exactly one course matches;
 * - "be30" → programme BE, entered 2026.
 * Anything else (e.g. "kse-ba30") is null: the owner ties it in the admin.
 */
export function channelScope(
  rawName: string,
  known: { courses: { courseCode: string; title: string }[]; programs: string[] },
  topic?: string | null,
): ChannelScope | null {
  const name = latinLookalikes(rawName.toLowerCase());
  const words = name.split(/[-_]+/).filter(Boolean);
  const at = words.findIndex((w) => sectionFrom(w));
  const section = at >= 0 ? sectionFrom(words[at]) : null;

  // The name, or else the channel topic: "MATH111 - Introduction to Calculus"
  const code = courseFromChannel(name) ?? (topic ? courseFromChannel(latinLookalikes(topic.trim())) : null);
  if (code) return { kind: 'course', courseCode: code, section };

  // The course words come before the section or the term: "intro_to_calculus-pr6-autumn-2026"
  const end = at >= 0 ? at : words.findIndex((w) => TERM.test(w));
  const head = end >= 0 ? words.slice(0, end) : words;
  if (head.length >= 2) {
    const codes = new Set(known.courses
      .filter((c) => {
        const t = titleWords(c.title);
        return head.length <= t.length && head.every((w, i) => t[i].startsWith(w));
      })
      .map((c) => c.courseCode));
    if (codes.size === 1) return { kind: 'course', courseCode: [...codes][0], section };
  }

  const cohort = words.length === 1 ? name.match(COHORT) : null;
  const program = cohort?.[1].toUpperCase();
  if (cohort && program && known.programs.includes(program)) {
    return { kind: 'cohort', program, cohortYear: 2000 + Number(cohort[2]) - BACHELOR_YEARS };
  }
  return null;
}
