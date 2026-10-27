-- Programmes an opportunity is for (empty = everyone) and opportunities students saved. Idempotent.
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "programs" varchar(10)[] DEFAULT '{}' NOT NULL;

CREATE TABLE IF NOT EXISTS "saved_opportunities" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "opportunity_id" integer NOT NULL REFERENCES "opportunities"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "reminded_at" timestamp,
  PRIMARY KEY ("user_id", "opportunity_id")
);
