-- Deadlines straight from Moodle through the student's own token (MOODLE-PROMPT.md §3.1), owner-only for now:
-- what Moodle knows beyond the date (cut-off, extension, quiz opening and attempts, grade), and when it was last read.
-- Additive and idempotent.
alter table moodle_assignments add column if not exists moodle jsonb;
alter table moodle_ws_tokens add column if not exists deadlines_synced_at timestamp;
