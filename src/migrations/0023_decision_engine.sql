CREATE TYPE "public"."decision_case_status" AS ENUM('draft', 'review', 'approved', 'rejected', 'superseded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."decision_materiality" AS ENUM('routine', 'material', 'critical');--> statement-breakpoint
CREATE TYPE "public"."decision_approval_outcome" AS ENUM('approved', 'rejected', 'waived');--> statement-breakpoint
CREATE TYPE "public"."decision_monitor_status" AS ENUM('active', 'breached', 'acknowledged', 'disabled');--> statement-breakpoint
CREATE TABLE "decision_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"decision_type" text DEFAULT 'investment' NOT NULL,
	"materiality" "decision_materiality" DEFAULT 'material' NOT NULL,
	"status" "decision_case_status" DEFAULT 'draft' NOT NULL,
	"symbol" text,
	"investigation_id" integer,
	"brain_run_id" integer,
	"organization_id" integer,
	"owner_user_id" integer NOT NULL,
	"final_decision" text,
	"decision_rationale" text,
	"review_date" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"approved_receipt_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "decision_receipt_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"decision_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot_hash" text NOT NULL,
	"question" text NOT NULL,
	"recommendation" text NOT NULL,
	"interpretation" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scenarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counterarguments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" jsonb NOT NULL,
	"monitoring_triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_evidence_count" integer DEFAULT 3 NOT NULL,
	"completeness" jsonb NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_receipt_version_unique" UNIQUE("decision_id","version"),
	CONSTRAINT "decision_receipt_hash_unique" UNIQUE("snapshot_hash")
);--> statement-breakpoint
CREATE TABLE "decision_approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"decision_id" integer NOT NULL,
	"receipt_version_id" integer NOT NULL,
	"outcome" "decision_approval_outcome" NOT NULL,
	"snapshot_hash" text NOT NULL,
	"note" text,
	"waiver_reason" text,
	"reviewer_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_approval_reviewer_receipt_unique" UNIQUE("receipt_version_id","reviewer_user_id")
);--> statement-breakpoint
CREATE TABLE "decision_monitoring_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"decision_id" integer NOT NULL,
	"receipt_version_id" integer NOT NULL,
	"name" text NOT NULL,
	"indicator" text NOT NULL,
	"operator" text NOT NULL,
	"threshold" real NOT NULL,
	"unit" text NOT NULL,
	"action" text NOT NULL,
	"status" "decision_monitor_status" DEFAULT 'active' NOT NULL,
	"current_value" real,
	"source_url" text,
	"last_evaluated_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "decision_replays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"decision_id" integer NOT NULL,
	"receipt_version_id" integer NOT NULL,
	"original_snapshot_hash" text NOT NULL,
	"replay_snapshot_hash" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"changed" boolean NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_investigation_id_research_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_brain_run_id_brain_runs_id_fk" FOREIGN KEY ("brain_run_id") REFERENCES "public"."brain_runs"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "decision_receipt_versions" ADD CONSTRAINT "decision_receipt_versions_decision_id_decision_cases_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_cases"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_receipt_versions" ADD CONSTRAINT "decision_receipt_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "decision_approvals" ADD CONSTRAINT "decision_approvals_decision_id_decision_cases_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_cases"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_approvals" ADD CONSTRAINT "decision_approvals_receipt_version_id_decision_receipt_versions_id_fk" FOREIGN KEY ("receipt_version_id") REFERENCES "public"."decision_receipt_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_approvals" ADD CONSTRAINT "decision_approvals_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "decision_monitoring_rules" ADD CONSTRAINT "decision_monitoring_rules_decision_id_decision_cases_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_cases"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_monitoring_rules" ADD CONSTRAINT "decision_monitoring_rules_receipt_version_id_decision_receipt_versions_id_fk" FOREIGN KEY ("receipt_version_id") REFERENCES "public"."decision_receipt_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_monitoring_rules" ADD CONSTRAINT "decision_monitoring_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_decision_id_decision_cases_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_cases"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_receipt_version_id_decision_receipt_versions_id_fk" FOREIGN KEY ("receipt_version_id") REFERENCES "public"."decision_receipt_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decision_replays" ADD CONSTRAINT "decision_replays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "decision_case_owner_updated_idx" ON "decision_cases" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "decision_case_investigation_idx" ON "decision_cases" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "decision_case_org_idx" ON "decision_cases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "decision_receipt_decision_created_idx" ON "decision_receipt_versions" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_approval_decision_idx" ON "decision_approvals" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_monitor_decision_status_idx" ON "decision_monitoring_rules" USING btree ("decision_id","status");--> statement-breakpoint
CREATE INDEX "decision_replay_decision_created_idx" ON "decision_replays" USING btree ("decision_id","created_at");
