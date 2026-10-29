-- Slack digests go out on their own (owner, 2026-10-29): new channels auto-publish; the owner's hand-published
-- summaries are marked, so only those trigger the "right after review" digest, not every automatic run.
-- Additive and idempotent (existing channels were switched on once by hand, not here: a re-run must not undo the owner's choices).
ALTER TABLE "slack_channels" ALTER COLUMN "auto_publish" SET DEFAULT true;
ALTER TABLE "slack_summaries" ADD COLUMN IF NOT EXISTS "reviewed" boolean DEFAULT false NOT NULL;
