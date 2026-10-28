-- Course page (NEXT-PROMPT.md §9): the course's Slack channel, learned from Slack notification emails
-- (one student's email is enough, everyone sees it), and office hours when known. Idempotent.
CREATE TABLE IF NOT EXISTS "course_links" (
  "course_code" varchar(20) PRIMARY KEY,
  "slack_team" varchar(100),
  "slack_channel_id" varchar(20),
  "slack_channel_name" varchar(100),
  "office_hours" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
