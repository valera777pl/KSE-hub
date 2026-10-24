-- Startup applications. Idempotent.
DO $$ BEGIN
  CREATE TYPE "application_status" AS ENUM ('pending', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "project_applications" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "venture_projects"("id") ON DELETE cascade,
  "applicant_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" varchar(100),
  "message" text,
  "status" "application_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "decided_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_applications_project_applicant_idx" ON "project_applications" ("project_id", "applicant_id");
