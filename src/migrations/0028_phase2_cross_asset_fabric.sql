ALTER TABLE "dataset_snapshots" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "dataset_snapshot_org_class_asof_idx" ON "dataset_snapshots" USING btree ("organization_id","data_class","available_at");
