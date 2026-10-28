-- Reminders (NEXT-PROMPT.md §10.2–10.3, §12): to myself (from the app or Copilot), to a friend, before an event.
-- The cron sends what's due every ~10 minutes. reminder_mutes: "Не отримувати від Олега". Idempotent.
CREATE TABLE IF NOT EXISTS "reminders" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "from_user_id" integer REFERENCES "users"("id") ON DELETE cascade,
  "kind" varchar(10) DEFAULT 'self' NOT NULL,
  "text" varchar(300) NOT NULL,
  "remind_at" timestamp NOT NULL,
  "startapp" varchar(64),
  "event_id" integer,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "reminders_due_idx" ON "reminders" ("remind_at") WHERE "sent_at" IS NULL;
CREATE INDEX IF NOT EXISTS "reminders_user_idx" ON "reminders" ("user_id", "remind_at");

CREATE TABLE IF NOT EXISTS "reminder_mutes" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "muted_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "muted_user_id")
);
