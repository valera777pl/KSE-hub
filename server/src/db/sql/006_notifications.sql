-- Schedule-change and class reminders, weekly deadlines. Idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_schedule_changes" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "class_reminders" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_weekly_at" timestamp;

-- Keyed by calendar + Google event id: our own row ids change on every events re-sync
CREATE TABLE IF NOT EXISTS "class_reminders" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "event_key" varchar(300) NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "class_reminders_user_event_idx" ON "class_reminders" ("user_id", "event_key");
