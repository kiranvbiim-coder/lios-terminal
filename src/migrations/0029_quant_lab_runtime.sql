CREATE TYPE "public"."quant_workspace" AS ENUM('dataset', 'statistics', 'econometrics', 'forecasting', 'risk', 'portfolio', 'derivatives', 'backtest', 'ml', 'results', 'registry');--> statement-breakpoint
CREATE TYPE "public"."quant_experiment_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."quant_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TABLE "quant_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"workspace" "quant_workspace" NOT NULL,
	"status" "quant_experiment_status" DEFAULT 'active' NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dataset_snapshot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed" integer,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"investigation_id" integer,
	"organization_id" integer,
	"owner_user_id" integer NOT NULL,
	"parent_experiment_id" text,
	"next_run_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "quant_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" "quant_run_status" DEFAULT 'queued' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"engine" text NOT NULL,
	"engine_endpoint" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"dataset_snapshot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dataset_snapshot_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seed" integer,
	"timeout_ms" integer NOT NULL,
	"input_hash" text NOT NULL,
	"cache_key" text NOT NULL,
	"cached_from_run_id" text,
	"environment" jsonb NOT NULL,
	"environment_hash" text NOT NULL,
	"library_versions" jsonb NOT NULL,
	"output" jsonb,
	"output_hash" text,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"owner_user_id" integer NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer
);--> statement-breakpoint
ALTER TABLE "quant_experiments" ADD CONSTRAINT "quant_experiments_investigation_id_research_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "quant_experiments" ADD CONSTRAINT "quant_experiments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "quant_experiments" ADD CONSTRAINT "quant_experiments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "quant_experiments" ADD CONSTRAINT "quant_experiments_parent_experiment_id_quant_experiments_id_fk" FOREIGN KEY ("parent_experiment_id") REFERENCES "public"."quant_experiments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "quant_runs" ADD CONSTRAINT "quant_runs_experiment_id_quant_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."quant_experiments"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "quant_runs" ADD CONSTRAINT "quant_runs_cached_from_run_id_quant_runs_id_fk" FOREIGN KEY ("cached_from_run_id") REFERENCES "public"."quant_runs"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "quant_runs" ADD CONSTRAINT "quant_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "quant_experiment_owner_updated_idx" ON "quant_experiments" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "quant_experiment_investigation_idx" ON "quant_experiments" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "quant_experiment_workspace_idx" ON "quant_experiments" USING btree ("workspace","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quant_run_experiment_sequence_unique" ON "quant_runs" USING btree ("experiment_id","sequence");--> statement-breakpoint
CREATE INDEX "quant_run_owner_status_idx" ON "quant_runs" USING btree ("owner_user_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "quant_run_cache_idx" ON "quant_runs" USING btree ("owner_user_id","cache_key","status");
