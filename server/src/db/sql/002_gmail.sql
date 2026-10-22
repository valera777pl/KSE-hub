-- Gmail + Calendar connection and the email digest pipeline. Idempotent.
CREATE TABLE IF NOT EXISTS "google_accounts" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE cascade,
  "email" varchar(255) NOT NULL,
  "refresh_token_enc" text NOT NULL,
  "scopes" text,
  "last_sync_at" timestamp,
  "sync_error" text,
  "connected_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "summaries" (
  "id" serial PRIMARY KEY,
  "message_id_header" varchar(500) UNIQUE,
  "body_hash" varchar(64) NOT NULL UNIQUE,
  "summary" text NOT NULL,
  "category" varchar(20) NOT NULL,
  "important" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "emails" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "gmail_id" varchar(100) NOT NULL,
  "source" varchar(10) DEFAULT 'gmail' NOT NULL,
  "from_name" varchar(255),
  "subject" text,
  "received_at" timestamp NOT NULL,
  "summary_id" integer REFERENCES "summaries"("id") ON DELETE set null,
  "digested_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "emails_user_gmail_idx" ON "emails" ("user_id", "gmail_id");
CREATE INDEX IF NOT EXISTS "emails_user_digest_idx" ON "emails" ("user_id", "digested_at");
