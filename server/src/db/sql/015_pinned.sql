-- Live pinned message in the bot chat (NEXT-PROMPT.md §13.2): what it shows, which message it is, what it says now.
-- Off by default. Additive and idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinned_kind" varchar(10) DEFAULT 'off' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinned_message_id" integer;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinned_text" text;
