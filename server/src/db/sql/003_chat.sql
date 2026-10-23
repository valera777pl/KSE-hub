-- AI assistant conversation history. Idempotent.
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" varchar(10) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "chat_messages_user_idx" ON "chat_messages" ("user_id", "created_at");
