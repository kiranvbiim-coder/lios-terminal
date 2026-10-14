CREATE TABLE IF NOT EXISTS "paired_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"public_key" text NOT NULL,
	"scopes" jsonb DEFAULT '["read","write"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
-- Idempotent on purpose: dbMigration.test.ts replays every migration after 0074 against an already-migrated database.
DO $$ BEGIN
	ALTER TABLE "paired_devices" ADD CONSTRAINT "paired_devices_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "paired_devices" ADD CONSTRAINT "paired_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "paired_devices_public_key_idx" ON "paired_devices" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paired_devices_owner_idx" ON "paired_devices" USING btree ("owner_user_id");
