CREATE TABLE IF NOT EXISTS "durable_memories" (
  "id" text PRIMARY KEY NOT NULL,
  "memory_key" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "project_id" integer REFERENCES "projects"("id") ON DELETE cascade,
  "scope" text NOT NULL,
  "kind" text NOT NULL,
  "role" text,
  "content" text NOT NULL,
  "origin_class" text NOT NULL,
  "origin_kind" text NOT NULL,
  "origin_ref" text,
  "epistemic_status" text DEFAULT 'observed' NOT NULL,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observed_at" timestamptz,
  "state" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "durable_memories_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "durable_memories_scope_ck" CHECK ("scope" IN ('user','project')),
  CONSTRAINT "durable_memories_scope_project_ck" CHECK (
    ("scope" = 'user' AND "project_id" IS NULL)
    OR
    ("scope" = 'project' AND "project_id" IS NOT NULL)
  ),
  CONSTRAINT "durable_memories_origin_class_ck" CHECK ("origin_class" IN ('owner','agent','untrusted','system')),
  CONSTRAINT "durable_memories_epistemic_status_ck" CHECK ("epistemic_status" IN ('observed','inferred','confirmed')),
  CONSTRAINT "durable_memories_state_ck" CHECK ("state" IN ('active','superseded','deleted')),
  CONSTRAINT "durable_memories_content_ck" CHECK (length("content") > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_memories_key_revision_unique" ON "durable_memories" ("memory_key","revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_memories_owner_recent_idx" ON "durable_memories" ("owner_user_id","organization_id","state","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_memories_project_recent_idx" ON "durable_memories" ("project_id","state","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_memories_origin_idx" ON "durable_memories" ("origin_kind","origin_ref");--> statement-breakpoint

ALTER TABLE "durable_memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS li_os_durable_memories_owner ON "durable_memories";--> statement-breakpoint
CREATE POLICY li_os_durable_memories_owner ON "durable_memories" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());
