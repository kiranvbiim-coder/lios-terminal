CREATE TABLE "environment_setups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"setup_version" text DEFAULT 'v1' NOT NULL,
	"selected_connector_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"python_runtime_id" text DEFAULT 'lios-managed' NOT NULL,
	"python_environment_path" text,
	"python_pack_ids" jsonb DEFAULT '["core"]'::jsonb NOT NULL,
	"ai_provider_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "environment_setups" ADD CONSTRAINT "environment_setups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "environment_setups" ADD CONSTRAINT "environment_setups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_setup_user_unique" ON "environment_setups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "environment_setup_org_idx" ON "environment_setups" USING btree ("organization_id");