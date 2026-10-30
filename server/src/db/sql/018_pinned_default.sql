-- The pinned line in the bot chat is on for new students: «Наступна пара» (owner, 2026-10-30).
-- Existing students were switched once by hand, not here: a re-run must not undo someone's «Вимкнено». Idempotent.
ALTER TABLE "users" ALTER COLUMN "pinned_kind" SET DEFAULT 'next';
