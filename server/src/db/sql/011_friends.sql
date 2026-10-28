-- Mutual friends (NEXT-PROMPT.md §10.1): a request, then the other side accepts. One row per pair.
-- users.invited_by: who sent the t.me/…?start=inv_ link; they become friends after onboarding. Idempotent.
CREATE TABLE IF NOT EXISTS "friendships" (
  "id" serial PRIMARY KEY,
  "requester_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "addressee_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" varchar(10) DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "decided_at" timestamp,
  CHECK ("requester_id" <> "addressee_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "friendships_pair_idx"
  ON "friendships" (least("requester_id", "addressee_id"), greatest("requester_id", "addressee_id"));
CREATE INDEX IF NOT EXISTS "friendships_addressee_idx" ON "friendships" ("addressee_id", "status");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
