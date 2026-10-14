CREATE TABLE "dataset_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_key" text NOT NULL,
	"entity_key" text NOT NULL,
	"data_class" text NOT NULL,
	"schema_version" text NOT NULL,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"frequency" text NOT NULL,
	"currency" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"observation_start" text,
	"observation_end" text,
	"effective_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"parent_snapshot_id" text,
	"quality" jsonb NOT NULL,
	"lineage" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_snapshot_content_unique" UNIQUE("dataset_key","content_hash")
);--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_parent_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("parent_snapshot_id") REFERENCES "public"."dataset_snapshots"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_asof_idx" ON "dataset_snapshots" USING btree ("dataset_key","entity_key","available_at");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_entity_created_idx" ON "dataset_snapshots" USING btree ("entity_key","created_at");
