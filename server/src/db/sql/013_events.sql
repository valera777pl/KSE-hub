-- Events from KSE mailings (NEXT-PROMPT.md §12): the model already files them as "event"; now with a start time,
-- a place and a registration link. Mass mailings are for everyone, a personal invite only for its recipient. Idempotent.
CREATE TABLE IF NOT EXISTS "events" (
  "id" serial PRIMARY KEY,
  "title" varchar(300) NOT NULL,
  "starts_at" timestamp NOT NULL,
  "location" varchar(200),
  "description" text,
  "programs" varchar(10)[] DEFAULT '{}' NOT NULL,
  "registration_url" text,
  "audience" varchar(10) DEFAULT 'all' NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE cascade,
  "source_key" varchar(100) NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "events_starts_idx" ON "events" ("starts_at");
