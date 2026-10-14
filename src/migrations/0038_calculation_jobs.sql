CREATE TYPE "public"."calculation_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "calculation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" "calculation_job_status" DEFAULT 'queued' NOT NULL,
	"cancellation_requested" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error" text,
	"recovery_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"owner_user_id" integer NOT NULL,
	"organization_id" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculation_jobs" ADD CONSTRAINT "calculation_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_jobs" ADD CONSTRAINT "calculation_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculation_job_owner_status_idx" ON "calculation_jobs" USING btree ("owner_user_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "calculation_job_org_status_idx" ON "calculation_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "calculation_job_lease_idx" ON "calculation_jobs" USING btree ("status","lease_expires_at");