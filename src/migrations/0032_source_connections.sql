CREATE TYPE "public"."source_connection_type" AS ENUM('public_api', 'keyed_api', 'file', 'database', 'private_api', 'cloud_storage', 'sidecar', 'local_model');--> statement-breakpoint
CREATE TYPE "public"."source_connection_status" AS ENUM('configured', 'healthy', 'degraded', 'unreachable', 'invalid');--> statement-breakpoint
CREATE TABLE "source_connections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"connector_id" text NOT NULL,
	"name" text NOT NULL,
	"source_type" "source_connection_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ref" text,
	"status" "source_connection_status" DEFAULT 'configured' NOT NULL,
	"last_tested_at" timestamp,
	"last_healthy_at" timestamp,
	"status_detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "source_connection_user_connector_name_unique" ON "source_connections" USING btree ("user_id","connector_id","name");--> statement-breakpoint
CREATE INDEX "source_connection_org_idx" ON "source_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "source_connection_connector_idx" ON "source_connections" USING btree ("connector_id");