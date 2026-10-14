CREATE TABLE "user_persona_preferences" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"primary_persona" text DEFAULT 'general' NOT NULL,
	"secondary_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_domain_slug" text DEFAULT 'finance' NOT NULL,
	"active_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_persona_preferences_secondary_personas_shape" CHECK (CASE WHEN jsonb_typeof("secondary_personas") = 'array' THEN jsonb_array_length("secondary_personas") <= 8 ELSE false END),
	CONSTRAINT "user_persona_preferences_active_context_shape" CHECK (jsonb_typeof("active_context") = 'object' AND pg_column_size("active_context") <= 65536),
	CONSTRAINT "user_persona_preferences_preferences_shape" CHECK (jsonb_typeof("preferences") = 'object' AND pg_column_size("preferences") <= 65536)
);--> statement-breakpoint
ALTER TABLE "user_persona_preferences" ADD CONSTRAINT "user_persona_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_persona_preferences" ADD CONSTRAINT "user_persona_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_persona_preferences_org_idx" ON "user_persona_preferences" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_persona_preferences_primary_persona_idx" ON "user_persona_preferences" USING btree ("primary_persona");
