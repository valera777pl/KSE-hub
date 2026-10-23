-- KSE course calendars, who is subscribed, and their events. Idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "schedule_visible" boolean DEFAULT true NOT NULL;
ALTER TABLE "google_accounts" ADD COLUMN IF NOT EXISTS "calendars_synced_at" timestamp;

CREATE TABLE IF NOT EXISTS "course_calendars" (
  "id" serial PRIMARY KEY,
  "google_id" varchar(255) NOT NULL UNIQUE,
  "course_code" varchar(20) NOT NULL,
  "section" varchar(20),
  "title" varchar(255) NOT NULL,
  "events_synced_at" timestamp
);

CREATE TABLE IF NOT EXISTS "user_calendars" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "calendar_id" integer NOT NULL REFERENCES "course_calendars"("id") ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_calendars_user_calendar_idx" ON "user_calendars" ("user_id", "calendar_id");
CREATE INDEX IF NOT EXISTS "user_calendars_calendar_idx" ON "user_calendars" ("calendar_id");

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" serial PRIMARY KEY,
  "calendar_id" integer NOT NULL REFERENCES "course_calendars"("id") ON DELETE cascade,
  "google_event_id" varchar(255) NOT NULL,
  "title" text NOT NULL,
  "location" text,
  "start_at" timestamp NOT NULL,
  "end_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_calendar_event_idx" ON "calendar_events" ("calendar_id", "google_event_id");
CREATE INDEX IF NOT EXISTS "calendar_events_start_idx" ON "calendar_events" ("start_at");
