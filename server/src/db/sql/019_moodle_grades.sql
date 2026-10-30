-- Moodle grades, an owner-only experiment (2026-10-30): the student's own token from Moodle's app sign-in page
-- (admin/tool/mobile/launch.php), stored encrypted, used only for read-only calls. Not public until KSE IT says yes.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "moodle_ws_tokens" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE cascade,
  "token_enc" text NOT NULL,
  "moodle_user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_ok_at" timestamp
);
