import { db } from '../db/connection.js';
import { kbChunks, kbPages } from '../db/schema.js';
import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { embed } from '../ai/client.js';

// Below this cosine similarity a chunk is rarely about the question
const MIN_SIMILARITY = 0.55;
// One long page (e.g. the Psychology programme) shouldn't crowd everything else out
const MAX_PER_PAGE = 2;
// Hand-written student docs (offices, SSO contacts) beat admissions marketing on a tie
const DOC_BOOST = 0.03;

export class KnowledgeService {
  /** The public KSE pages closest in meaning to the question, best first. */
  static async search(query: string, limit = 5) {
    const [vector] = await embed([query], 'RETRIEVAL_QUERY');
    const similarity = sql<number>`1 - (${cosineDistance(kbChunks.embedding, vector)})`;
    const rows = await db
      .select({ title: kbPages.title, url: kbPages.url, content: kbChunks.content, similarity })
      .from(kbChunks)
      .innerJoin(kbPages, eq(kbPages.id, kbChunks.pageId))
      .orderBy(desc(similarity))
      .limit(limit * 6);

    const perPage = new Map<string, number>();
    return rows
      .map((r) => ({ ...r, score: r.similarity + (r.url.startsWith('doc:') ? DOC_BOOST : 0) }))
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const n = perPage.get(r.url) ?? 0;
        perPage.set(r.url, n + 1);
        return n < MAX_PER_PAGE;
      })
      .slice(0, limit);
  }
}
