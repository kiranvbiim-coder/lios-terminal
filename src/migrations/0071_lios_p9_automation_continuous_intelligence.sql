-- P9 Automation and Continuous Intelligence

CREATE TABLE "project_automation_workflows" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "template" text DEFAULT 'custom' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "trigger" jsonb NOT NULL,
  "action" jsonb NOT NULL,
  "notification_policy" jsonb NOT NULL,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "engine_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "event_cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "next_run_at" timestamptz,
  "last_run_at" timestamptz,
  "last_success_at" timestamptz,
  "last_failure_at" timestamptz,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "claim_token" text,
  "claim_expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_automation_workflows_name_ck" CHECK (char_length("name") BETWEEN 1 AND 200),
  CONSTRAINT "project_automation_workflows_template_ck" CHECK ("template" IN ('custom','filing_monitor','earnings_monitor','thesis_refresh','valuation_refresh','portfolio_monitor','provider_health','report_refresh')),
  CONSTRAINT "project_automation_workflows_failures_ck" CHECK ("consecutive_failures" >= 0)
);--> statement-breakpoint
CREATE INDEX "project_automation_workflows_project_idx" ON "project_automation_workflows" ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "project_automation_workflows_due_idx" ON "project_automation_workflows" ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "project_automation_workflows_scope_idx" ON "project_automation_workflows" ("organization_id","owner_user_id","project_id");--> statement-breakpoint

CREATE TABLE "project_automation_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workflow_id" text NOT NULL REFERENCES "project_automation_workflows"("id") ON DELETE cascade,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "trigger_type" text NOT NULL,
  "trigger_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text,
  "status" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "summary" text,
  "changed" boolean DEFAULT false NOT NULL,
  "condition_met" boolean DEFAULT false NOT NULL,
  "relevance_score" real DEFAULT 0 NOT NULL,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "engine_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "execution_receipt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "output" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  CONSTRAINT "project_automation_runs_trigger_ck" CHECK ("trigger_type" IN ('manual','schedule','event')),
  CONSTRAINT "project_automation_runs_status_ck" CHECK ("status" IN ('running','succeeded','failed','skipped')),
  CONSTRAINT "project_automation_runs_relevance_ck" CHECK ("relevance_score" >= 0 AND "relevance_score" <= 1)
);--> statement-breakpoint
CREATE INDEX "project_automation_runs_workflow_idx" ON "project_automation_runs" ("workflow_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_automation_runs_dedupe_unique" ON "project_automation_runs" ("workflow_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "project_automation_runs_project_idx" ON "project_automation_runs" ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "project_automation_runs_scope_idx" ON "project_automation_runs" ("organization_id","owner_user_id","project_id");--> statement-breakpoint

CREATE TABLE "project_automation_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "workflow_id" text NOT NULL REFERENCES "project_automation_workflows"("id") ON DELETE cascade,
  "run_id" text NOT NULL REFERENCES "project_automation_runs"("id") ON DELETE cascade,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "relevance_score" real DEFAULT 0 NOT NULL,
  "read_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_automation_notifications_channel_ck" CHECK ("channel" IN ('in_app')),
  CONSTRAINT "project_automation_notifications_status_ck" CHECK ("status" IN ('delivered','suppressed')),
  CONSTRAINT "project_automation_notifications_reason_ck" CHECK ("reason" IN ('success','failure','condition_met','change_detected')),
  CONSTRAINT "project_automation_notifications_relevance_ck" CHECK ("relevance_score" >= 0 AND "relevance_score" <= 1)
);--> statement-breakpoint
CREATE INDEX "project_automation_notifications_project_idx" ON "project_automation_notifications" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_automation_notifications_workflow_idx" ON "project_automation_notifications" ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "project_automation_notifications_scope_idx" ON "project_automation_notifications" ("organization_id","owner_user_id","project_id");--> statement-breakpoint

ALTER TABLE "project_automation_workflows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_automation_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_automation_workflows_owner ON "project_automation_workflows";--> statement-breakpoint
CREATE POLICY li_os_project_automation_workflows_owner ON "project_automation_workflows" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_automation_runs_owner ON "project_automation_runs";--> statement-breakpoint
CREATE POLICY li_os_project_automation_runs_owner ON "project_automation_runs" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_automation_notifications_owner ON "project_automation_notifications";--> statement-breakpoint
CREATE POLICY li_os_project_automation_notifications_owner ON "project_automation_notifications" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());
