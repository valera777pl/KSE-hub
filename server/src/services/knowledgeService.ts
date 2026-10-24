import { db } from '../db/connection.js';
import { kbChunks, kbPages } from '../db/schema.js';
import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { embed } from '../ai/client.js';

// Below this cosine similarity a chunk is rarely about the question
const MIN_SIMILARITY = 0.55;

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
      .limit(limit);
    return rows.filter((r) => r.similarity >= MIN_SIMILARITY);
  }
}
