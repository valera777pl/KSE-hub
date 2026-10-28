-- Moodle without noise (NEXT-PROMPT.md §3): other practice groups' copies are hidden per student,
-- "submitted" and "feedback" come from Moodle's emails. Additive and idempotent.
alter table moodle_assignments add column if not exists hidden boolean not null default false;
alter table moodle_assignments add column if not exists group_no integer;
alter table moodle_assignments add column if not exists submitted_at timestamp;
alter table moodle_assignments add column if not exists feedback_at timestamp;
