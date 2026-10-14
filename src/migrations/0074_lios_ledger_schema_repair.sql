-- Repair: databases created by an earlier build recorded a different 0067 migration
-- (conversation_ledger_entries) with a later timestamp, so Drizzle skipped the
-- reproducibility-ledger tables forever. Recreate them idempotently; this is a
-- no-op on databases where 0067 already ran.
CREATE TABLE IF NOT EXISTS "project_ledger_stream_heads" (
  "stream_id" text PRIMARY KEY,
  "project_id" integer,
  "chat_id" integer,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "next_sequence" integer DEFAULT 1 NOT NULL,
  "head_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_ledger_stream_heads_next_sequence_ck" CHECK ("next_sequence" >= 1),
  CONSTRAINT "project_ledger_stream_heads_head_hash_ck" CHECK ("head_hash" IS NULL OR length("head_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_ledger_events" (
  "id" text PRIMARY KEY,
  "stream_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "project_id" integer,
  "chat_id" integer,
  "session_id" text,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL,
  "request_id" text,
  "receipt_id" text,
  "correlation_id" text,
  "causation_id" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "lineage" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
  "reversible" boolean DEFAULT false NOT NULL,
  "inverse_payload" jsonb,
  "previous_hash" text,
  "event_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_ledger_events_sequence_ck" CHECK ("sequence" >= 1),
  CONSTRAINT "project_ledger_events_hash_ck" CHECK (length("event_hash") = 64),
  CONSTRAINT "project_ledger_events_previous_hash_ck" CHECK ("previous_hash" IS NULL OR length("previous_hash") = 64),
  CONSTRAINT "project_ledger_events_actor_ck" CHECK ("actor_type" IN ('user','system','engine','ai','provider')),
  CONSTRAINT "project_ledger_events_reversible_ck" CHECK (NOT "reversible" OR "inverse_payload" IS NOT NULL)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_stream_heads" ADD CONSTRAINT "project_ledger_stream_heads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_stream_heads" ADD CONSTRAINT "project_ledger_stream_heads_chat_id_project_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."project_chats"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_stream_heads" ADD CONSTRAINT "project_ledger_stream_heads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_stream_heads" ADD CONSTRAINT "project_ledger_stream_heads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_stream_id_project_ledger_stream_heads_stream_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."project_ledger_stream_heads"("stream_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_chat_id_project_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."project_chats"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_session_id_project_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_sessions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_ledger_events" ADD CONSTRAINT "project_ledger_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_stream_heads_project_idx" ON "project_ledger_stream_heads" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_stream_heads_owner_idx" ON "project_ledger_stream_heads" ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_ledger_events_stream_sequence_unique" ON "project_ledger_events" ("stream_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_ledger_events_receipt_unique" ON "project_ledger_events" ("receipt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_ledger_events_single_revert_unique" ON "project_ledger_events" ("causation_id") WHERE "event_type" = 'state.reverted' AND "causation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_project_idx" ON "project_ledger_events" ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_chat_idx" ON "project_ledger_events" ("chat_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_session_idx" ON "project_ledger_events" ("session_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_owner_idx" ON "project_ledger_events" ("owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_request_idx" ON "project_ledger_events" ("request_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_ledger_events_type_idx" ON "project_ledger_events" ("event_type","created_at");
