CREATE TYPE "public"."consensus_metric" AS ENUM('revenue', 'ebitda', 'ebit', 'eps', 'free_cash_flow', 'gross_margin', 'operating_margin', 'net_margin', 'capex', 'price_target', 'recommendation_score');--> statement-breakpoint
CREATE TYPE "public"."consensus_source_type" AS ENUM('licensed_provider', 'user_supplied', 'manual');--> statement-breakpoint
CREATE TYPE "public"."consensus_benchmark_kind" AS ENUM('company_guidance', 'reported_actual', 'limuria_model');--> statement-breakpoint
CREATE TABLE "consensus_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"symbol" text NOT NULL,
	"organization_id" integer,
	"investigation_id" integer,
	"metric" "consensus_metric" NOT NULL,
	"fiscal_period" text NOT NULL,
	"period_end" timestamp with time zone,
	"currency" text,
	"unit" text NOT NULL,
	"mean" real,
	"median" real,
	"high" real,
	"low" real,
	"contributor_count" integer,
	"standard_deviation" real,
	"upward_revision_count" integer,
	"downward_revision_count" integer,
	"unchanged_revision_count" integer,
	"estimate_as_of" timestamp with time zone NOT NULL,
	"source_type" "consensus_source_type" NOT NULL,
	"provider" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"methodology" text,
	"snapshot_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "consensus_benchmarks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"symbol" text NOT NULL,
	"organization_id" integer,
	"investigation_id" integer,
	"metric" "consensus_metric" NOT NULL,
	"fiscal_period" text NOT NULL,
	"period_end" timestamp with time zone,
	"currency" text,
	"unit" text NOT NULL,
	"benchmark_kind" "consensus_benchmark_kind" NOT NULL,
	"value" real,
	"low" real,
	"high" real,
	"effective_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"model_name" text,
	"model_version" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumption_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consensus_benchmark_value_or_range" CHECK ("value" IS NOT NULL OR ("low" IS NOT NULL AND "high" IS NOT NULL)),
	CONSTRAINT "consensus_benchmark_range_order" CHECK ("low" IS NULL OR "high" IS NULL OR "low" <= "high")
);--> statement-breakpoint
CREATE TABLE "consensus_alert_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"owner_user_id" integer NOT NULL,
	"organization_id" integer,
	"symbol" text NOT NULL,
	"metric" "consensus_metric",
	"revision_threshold_pct" real DEFAULT 5 NOT NULL,
	"dispersion_threshold_pct" real DEFAULT 20 NOT NULL,
	"divergence_threshold_pct" real DEFAULT 10 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "consensus_snapshots" ADD CONSTRAINT "consensus_snapshots_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "consensus_snapshots" ADD CONSTRAINT "consensus_snapshots_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "consensus_snapshots" ADD CONSTRAINT "consensus_snapshots_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "consensus_benchmarks" ADD CONSTRAINT "consensus_benchmarks_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "consensus_benchmarks" ADD CONSTRAINT "consensus_benchmarks_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "consensus_benchmarks" ADD CONSTRAINT "consensus_benchmarks_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "consensus_alert_rules" ADD CONSTRAINT "consensus_alert_rules_owner_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "consensus_alert_rules" ADD CONSTRAINT "consensus_alert_rules_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "consensus_snapshot_hash_unique" ON "consensus_snapshots" ("snapshot_hash");--> statement-breakpoint
CREATE INDEX "consensus_snapshot_symbol_period_idx" ON "consensus_snapshots" ("symbol", "metric", "fiscal_period", "estimate_as_of");--> statement-breakpoint
CREATE INDEX "consensus_snapshot_org_idx" ON "consensus_snapshots" ("organization_id");--> statement-breakpoint
CREATE INDEX "consensus_benchmark_symbol_period_idx" ON "consensus_benchmarks" ("symbol", "metric", "fiscal_period", "effective_at");--> statement-breakpoint
CREATE INDEX "consensus_benchmark_org_idx" ON "consensus_benchmarks" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consensus_alert_owner_symbol_metric_unique" ON "consensus_alert_rules" ("owner_user_id", "organization_id", "symbol", "metric");--> statement-breakpoint
CREATE INDEX "consensus_alert_owner_idx" ON "consensus_alert_rules" ("owner_user_id", "enabled");
