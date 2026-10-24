-- Sign-up gate, admin flag, usage analytics. Idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarded_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;

-- Students who already connected KSE mail count as signed up
UPDATE "users" SET "onboarded_at" = now()
WHERE "onboarded_at" IS NULL AND EXISTS (SELECT 1 FROM "google_accounts" g WHERE g."user_id" = "users"."id");

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" serial PRIMARY KEY,
  "user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "event" varchar(50) NOT NULL,
  "props" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "usage_events_created_idx" ON "usage_events" ("created_at");
CREATE INDEX IF NOT EXISTS "usage_events_event_idx" ON "usage_events" ("event", "created_at");
