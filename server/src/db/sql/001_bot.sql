-- Telegram bot: digest settings, reminder de-duplication.
-- Idempotent, safe to run repeatedly (npm run db:sql).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_sources" jsonb DEFAULT '["moodle","gmail","slack"]'::jsonb NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_hour" integer DEFAULT 20 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_digest_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_synced_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bot_blocked" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "deadline_reminders" (
  "id" serial PRIMARY KEY,
  "assignment_id" integer NOT NULL,
  "kind" varchar(10) NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "deadline_reminders" ADD CONSTRAINT "deadline_reminders_assignment_id_moodle_assignments_id_fk"
    FOREIGN KEY ("assignment_id") REFERENCES "public"."moodle_assignments"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "deadline_reminders_assignment_kind_idx" ON "deadline_reminders" USING btree ("assignment_id","kind");
