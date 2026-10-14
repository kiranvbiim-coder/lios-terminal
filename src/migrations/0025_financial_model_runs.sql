CREATE TABLE "financial_model_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"dataset_snapshot_id" text NOT NULL,
	"model_version" text NOT NULL,
	"assumptions" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_model_run_hash_unique" UNIQUE("dataset_snapshot_id","result_hash")
);--> statement-breakpoint
ALTER TABLE "financial_model_runs" ADD CONSTRAINT "financial_model_runs_dataset_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("dataset_snapshot_id") REFERENCES "public"."dataset_snapshots"("id");--> statement-breakpoint
ALTER TABLE "financial_model_runs" ADD CONSTRAINT "financial_model_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "financial_model_run_symbol_created_idx" ON "financial_model_runs" USING btree ("symbol","created_at");
