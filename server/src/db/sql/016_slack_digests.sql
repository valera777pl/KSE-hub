-- Slack digests through the reader account (SLACK-DIGEST-PROMPT.md): channels the account is in, the summaries
-- Claude's scheduled task sends, who reads which channel, what was delivered. Raw Slack messages are never stored.
-- A private channel is seen only by its course/section or cohort (schedule, entry year) or by students who got
-- Slack notification emails from it. Additive and idempotent.
CREATE TABLE IF NOT EXISTS "slack_channels" (
  "channel_id" varchar(20) PRIMARY KEY,
  "name" varchar(100) NOT NULL,
  "team" varchar(100),
  "is_private" boolean DEFAULT false NOT NULL,
  "status" varchar(10) DEFAULT 'pending' NOT NULL,
  "course_code" varchar(20),
  "section" varchar(20),
  "program" varchar(10),
  "cohort_year" integer,
  "last_ts" varchar(20),
  "default_on" boolean DEFAULT false NOT NULL,
  "auto_publish" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "slack_summaries" (
  "id" serial PRIMARY KEY,
  "channel_id" varchar(20) NOT NULL REFERENCES "slack_channels"("channel_id") ON DELETE cascade,
  "from_ts" varchar(20) NOT NULL,
  "to_ts" varchar(20) NOT NULL,
  "summary" text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(10) DEFAULT 'draft' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "published_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "slack_summaries_channel_to_idx" ON "slack_summaries" ("channel_id", "to_ts");
CREATE INDEX IF NOT EXISTS "slack_summaries_status_idx" ON "slack_summaries" ("status", "published_at");

CREATE TABLE IF NOT EXISTS "user_slack_subscriptions" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "channel_id" varchar(20) NOT NULL REFERENCES "slack_channels"("channel_id") ON DELETE cascade,
  "on" boolean NOT NULL,
  PRIMARY KEY ("user_id", "channel_id")
);

CREATE TABLE IF NOT EXISTS "slack_deliveries" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "summary_id" integer NOT NULL REFERENCES "slack_summaries"("id") ON DELETE cascade,
  "delivered_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "summary_id")
);

-- Channels a student got Slack notification emails from (channel ids from the email's links)
CREATE TABLE IF NOT EXISTS "user_slack_channels" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "channel_id" varchar(20) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "channel_id")
);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slack_digest_slots" jsonb DEFAULT '["evening"]'::jsonb NOT NULL;
-- An event from a private channel ("audience = 'slack'") is seen only by those who see the channel
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "slack_channel_id" varchar(20);
