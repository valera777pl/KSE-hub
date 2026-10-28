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
