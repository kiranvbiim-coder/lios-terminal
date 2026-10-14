CREATE TYPE "public"."brain_decision_type" AS ENUM('investment', 'policy', 'portfolio', 'risk', 'supply_chain', 'consulting', 'general_research');--> statement-breakpoint
CREATE TYPE "public"."brain_run_status" AS ENUM('planned', 'running', 'paused', 'awaiting_approval', 'completed', 'incomplete', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."brain_task_status" AS ENUM('pending', 'running', 'completed', 'incomplete', 'failed', 'blocked', 'awaiting_approval', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."brain_agent_role" AS ENUM('planner', 'research', 'financial_analyst', 'portfolio', 'risk', 'economist', 'policy', 'supply_chain', 'consulting', 'red_team', 'verification', 'decision_judge', 'human');--> statement-breakpoint
CREATE TYPE "public"."brain_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "brain_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"decision_type" "brain_decision_type" NOT NULL,
	"status" "brain_run_status" DEFAULT 'planned' NOT NULL,
	"organization_id" integer,
	"investigation_id" integer,
	"owner_user_id" integer NOT NULL,
	"intent" jsonb NOT NULL,
	"required_outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synthesis" text,
	"completion_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "brain_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"run_id" integer NOT NULL,
	"task_key" text NOT NULL,
	"label" text NOT NULL,
	"agent_role" "brain_agent_role" NOT NULL,
	"tool_id" text,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completion_criteria" text NOT NULL,
	"status" "brain_task_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deterministic_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "brain_tool_calls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"run_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"tool_id" text NOT NULL,
	"agent_role" "brain_agent_role" NOT NULL,
	"status" "brain_task_status" NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deterministic_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"model_id" text,
	"error" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "brain_approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"run_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"status" "brain_approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"decided_by_user_id" integer,
	"note" text,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "brain_runs" ADD CONSTRAINT "brain_runs_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "brain_runs" ADD CONSTRAINT "brain_runs_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "brain_runs" ADD CONSTRAINT "brain_runs_owner_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "brain_tasks" ADD CONSTRAINT "brain_tasks_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."brain_runs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "brain_tool_calls" ADD CONSTRAINT "brain_tool_calls_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."brain_runs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "brain_tool_calls" ADD CONSTRAINT "brain_tool_calls_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."brain_tasks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "brain_approvals" ADD CONSTRAINT "brain_approvals_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."brain_runs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "brain_approvals" ADD CONSTRAINT "brain_approvals_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."brain_tasks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "brain_approvals" ADD CONSTRAINT "brain_approvals_requested_by_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "brain_approvals" ADD CONSTRAINT "brain_approvals_decided_by_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "brain_run_owner_created_idx" ON "brain_runs" ("owner_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "brain_run_org_idx" ON "brain_runs" ("organization_id");--> statement-breakpoint
CREATE INDEX "brain_run_investigation_idx" ON "brain_runs" ("investigation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_task_run_key_unique" ON "brain_tasks" ("run_id", "task_key");--> statement-breakpoint
CREATE INDEX "brain_task_run_status_idx" ON "brain_tasks" ("run_id", "status");--> statement-breakpoint
CREATE INDEX "brain_tool_call_run_created_idx" ON "brain_tool_calls" ("run_id", "created_at");--> statement-breakpoint
CREATE INDEX "brain_tool_call_task_idx" ON "brain_tool_calls" ("task_id");--> statement-breakpoint
CREATE INDEX "brain_approval_run_idx" ON "brain_approvals" ("run_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_approval_task_snapshot_unique" ON "brain_approvals" ("task_id", "snapshot_hash");
