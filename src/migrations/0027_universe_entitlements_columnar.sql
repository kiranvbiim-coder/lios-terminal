CREATE TABLE "data_entitlement_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"data_class" text NOT NULL,
	"license_type" text NOT NULL,
	"access_scope" text NOT NULL,
	"redistribution" text NOT NULL,
	"permitted_uses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution" text,
	"terms_url" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" integer,
	"content_hash" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_entitlement_policy_hash_unique" UNIQUE("content_hash")
);--> statement-breakpoint
ALTER TABLE "data_entitlement_policies" ADD CONSTRAINT "data_entitlement_policies_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "data_entitlement_policy_lookup_idx" ON "data_entitlement_policies" USING btree ("provider","data_class","effective_from");--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD COLUMN "entitlement_policy_id" text;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_entitlement_policy_id_data_entitlement_policies_id_fk" FOREIGN KEY ("entitlement_policy_id") REFERENCES "public"."data_entitlement_policies"("id");--> statement-breakpoint
CREATE TABLE "columnar_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_snapshot_id" text NOT NULL,
	"format" text DEFAULT 'parquet' NOT NULL,
	"relative_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"compression" text DEFAULT 'zstd' NOT NULL,
	"access_scope" text DEFAULT 'internal_only' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "columnar_artifact_snapshot_hash_unique" UNIQUE("dataset_snapshot_id","content_hash")
);--> statement-breakpoint
ALTER TABLE "columnar_artifacts" ADD CONSTRAINT "columnar_artifacts_dataset_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("dataset_snapshot_id") REFERENCES "public"."dataset_snapshots"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "columnar_artifacts" ADD CONSTRAINT "columnar_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "columnar_artifact_snapshot_idx" ON "columnar_artifacts" USING btree ("dataset_snapshot_id","created_at");
