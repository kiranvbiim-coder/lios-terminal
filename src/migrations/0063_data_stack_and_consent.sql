ALTER TABLE "environment_setups" ADD COLUMN IF NOT EXISTS "provider_stack_order" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_setups" ADD COLUMN IF NOT EXISTS "data_stack_pins" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_data_consents" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  "consent_version" text NOT NULL,
  "accepted_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_data_consent_user_scope_unique" ON "user_data_consents" ("user_id", "scope");
