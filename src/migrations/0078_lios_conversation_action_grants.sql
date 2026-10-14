CREATE TABLE IF NOT EXISTS "conversation_action_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"organization_id" integer,
	"project_id" integer NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Idempotent on purpose: dbMigration.test.ts replays every migration after 0074 against an already-migrated database.
DO $$ BEGIN
	ALTER TABLE "conversation_action_grants" ADD CONSTRAINT "conversation_action_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_action_grants" ADD CONSTRAINT "conversation_action_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_action_grants" ADD CONSTRAINT "conversation_action_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_action_grants_scope_idx" ON "conversation_action_grants" USING btree ("project_id","owner_user_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_action_grants_owner_idx" ON "conversation_action_grants" USING btree ("owner_user_id");
