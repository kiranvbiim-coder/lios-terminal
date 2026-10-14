CREATE TABLE "organization_credentials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"organization_id" integer NOT NULL,
	"created_by_user_id" integer,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "organization_credentials" ADD CONSTRAINT "organization_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "organization_credentials" ADD CONSTRAINT "organization_credentials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_credential_org_name_unique" ON "organization_credentials" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "organization_credential_org_idx" ON "organization_credentials" USING btree ("organization_id");
