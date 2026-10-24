-- KSE knowledge base for the assistant (pgvector, Gemini 768-d embeddings). Idempotent.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "kb_pages" (
  "id" serial PRIMARY KEY,
  "url" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "hash" varchar(64) NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "kb_chunks" (
  "id" serial PRIMARY KEY,
  "page_id" integer NOT NULL REFERENCES "kb_pages"("id") ON DELETE cascade,
  "content" text NOT NULL,
  "embedding" vector(768) NOT NULL
);
CREATE INDEX IF NOT EXISTS "kb_chunks_page_idx" ON "kb_chunks" ("page_id");
CREATE INDEX IF NOT EXISTS "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);
