/**
 * Builds the KSE knowledge base: fetch public pages → strip site chrome →
 * chunk → embed with Gemini → store in kb_pages / kb_chunks.
 * Unchanged pages (same text hash) are skipped, pages no longer listed are removed.
 *
 *   npm run kb:ingest            # incremental
 *   npm run kb:ingest -- --force # re-embed everything
 */
import { db, queryClient } from '../src/db/connection.js';
import { kbChunks, kbPages } from '../src/db/schema.js';
import { eq, notInArray } from 'drizzle-orm';
import { embed } from '../src/ai/client.js';
import { sha256 } from '../src/utils/crypto.js';
import { EXTRA_PAGES, UNIVERSITY_EXCLUDE, UNIVERSITY_INCLUDE, UNIVERSITY_SITEMAP } from '../src/kb/sources.js';

const UA = 'KSEHubBot/1.0 (+https://kse-hub.vercel.app; student assistant)';
const CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 200;
const force = process.argv.includes('--force');

type Page = { url: string; title: string; lines: string[] };

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function listUrls(): Promise<string[]> {
  const xml = await get(UNIVERSITY_SITEMAP);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const picked = urls.filter((u) => {
    const path = new URL(u).pathname.replace(/\/$/, '');
    return UNIVERSITY_INCLUDE.some((p) => path === p || path.startsWith(`${p}/`)) && !UNIVERSITY_EXCLUDE.some((re) => re.test(path));
  });
  return [...new Set([...picked, ...EXTRA_PAGES])];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»', rsquo: '’', hellip: '…' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);

function extract(url: string, html: string): Page {
  const title = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? url)
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const text = html
    .replace(/<(script|style|noscript|svg|header|footer|nav|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|section|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = unhideEmails(decode(text)).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2);
  return { url, title, lines };
}

/** KSE's site writes emails backwards against spam bots: "au.gro.esk%40otylppa" → "applyto@kse.org.ua". */
function unhideEmails(text: string): string {
  return text.replace(/\b(au\.[a-z.]+|moc\.[a-z.]+)%40([a-z0-9._-]+)/gi, (m) => [...m.replace('%40', '@')].reverse().join(''));
}

/** Drop lines repeated across many pages of the same site: menus, footers, teacher cards, testimonials. */
function stripBoilerplate(pages: Page[]): Page[] {
  const byHost = new Map<string, Page[]>();
  for (const p of pages) byHost.set(new URL(p.url).host, [...(byHost.get(new URL(p.url).host) ?? []), p]);
  for (const group of byHost.values()) {
    const seen = new Map<string, number>();
    for (const p of group) for (const l of new Set(p.lines)) seen.set(l, (seen.get(l) ?? 0) + 1);
    const limit = Math.max(3, Math.ceil(group.length * 0.15));
    for (const p of group) p.lines = p.lines.filter((l, i, all) => (seen.get(l) ?? 0) < limit && all.indexOf(l) === i);
  }
  return pages;
}

function chunk(page: Page): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of page.lines) {
    if (current && current.length + line.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = current.slice(-OVERLAP_CHARS).replace(/^\S*\s/, '') + '\n' + line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current.trim().length > 80) chunks.push(current);
  return chunks.map((c) => `${page.title}\n${c}`);
}

async function main() {
  const urls = await listUrls();
  console.log(`pages to read: ${urls.length}`);

  const pages: Page[] = [];
  for (const url of urls) {
    try {
      pages.push(extract(url, await get(url)));
    } catch (err) {
      console.warn(`skip ${url}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // be polite to KSE's servers
  }
  stripBoilerplate(pages);

  let embedded = 0;
  let unchanged = 0;
  for (const page of pages) {
    const chunks = chunk(page);
    if (!chunks.length) continue;
    const hash = sha256(chunks.join('\n---\n'));
    const [existing] = await db.select().from(kbPages).where(eq(kbPages.url, page.url)).limit(1);
    if (existing && existing.hash === hash && !force) {
      unchanged++;
      continue;
    }

    const vectors = await embed(chunks, 'RETRIEVAL_DOCUMENT', page.title, { patient: true });
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(kbPages).values({ url: page.url, title: page.title, hash })
        .onConflictDoUpdate({ target: kbPages.url, set: { title: page.title, hash, fetchedAt: new Date() } }).returning();
      await tx.delete(kbChunks).where(eq(kbChunks.pageId, row.id));
      await tx.insert(kbChunks).values(chunks.map((content, i) => ({ pageId: row.id, content, embedding: vectors[i] })));
    });
    embedded++;
    console.log(`✓ ${page.title} — ${chunks.length} chunks`);
    // Free tier: stay under ~100 embedded texts per minute
    await new Promise((r) => setTimeout(r, chunks.length * 700));
  }

  const keep = pages.map((p) => p.url);
  const removed = keep.length ? await db.delete(kbPages).where(notInArray(kbPages.url, keep)).returning() : [];
  console.log(`done: ${embedded} embedded, ${unchanged} unchanged, ${removed.length} removed`);
  await queryClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await queryClient.end();
  process.exit(1);
});
