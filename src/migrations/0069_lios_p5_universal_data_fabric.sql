ALTER TYPE "source_connection_type" ADD VALUE IF NOT EXISTS 'mcp';--> statement-breakpoint

-- P5 Universal Data Fabric & Semantic Finance
CREATE TABLE "data_coverage_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "generated_at" timestamptz NOT NULL,
  "real_universe_size" integer NOT NULL,
  "indexed_universe_size" integer NOT NULL,
  "capacity_proof_size" integer NOT NULL,
  "warm_search_p95_ms" real,
  "provider_count" integer NOT NULL,
  "implemented_provider_count" integer NOT NULL,
  "capability_family_count" integer NOT NULL,
  "field_stages" jsonb NOT NULL,
  "gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "data_coverage_ledger_sizes_ck" CHECK ("real_universe_size" >= 0 AND "indexed_universe_size" >= 0 AND "capacity_proof_size" >= 0)
);--> statement-breakpoint
CREATE INDEX "data_coverage_ledger_scope_idx" ON "data_coverage_ledger" ("organization_id","owner_user_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_coverage_ledger_scope_hash_unique" ON "data_coverage_ledger" ("owner_user_id",COALESCE("organization_id",0),"content_hash");--> statement-breakpoint

CREATE TABLE "semantic_metric_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "metric_id" text NOT NULL,
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "category" text NOT NULL,
  "unit" text,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "formula" text,
  "source_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "semantic_metric_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "semantic_metric_status_ck" CHECK ("status" IN ('active','deprecated'))
);--> statement-breakpoint
CREATE INDEX "semantic_metric_scope_idx" ON "semantic_metric_definitions" ("organization_id","owner_user_id","metric_id");--> statement-breakpoint
CREATE UNIQUE INDEX "semantic_metric_scope_version_unique" ON "semantic_metric_definitions" ("owner_user_id",COALESCE("organization_id",0),"metric_id","version");--> statement-breakpoint

CREATE TABLE "data_lineage_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" integer REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "request_id" text,
  "capability" text NOT NULL,
  "entity_ref" text NOT NULL,
  "point_in_time" jsonb NOT NULL,
  "stages" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "data_lineage_receipt_project_idx" ON "data_lineage_receipts" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "data_lineage_receipt_scope_idx" ON "data_lineage_receipts" ("organization_id","owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_lineage_receipt_request_idx" ON "data_lineage_receipts" ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_lineage_receipt_hash_unique" ON "data_lineage_receipts" ("owner_user_id","content_hash");--> statement-breakpoint


CREATE TABLE "external_rights_assessments" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "subject_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "version" integer NOT NULL,
  "rights" jsonb NOT NULL,
  "notes" text,
  "reviewed_at" timestamptz NOT NULL,
  "reviewed_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "external_rights_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "external_rights_subject_kind_ck" CHECK ("subject_kind" IN ('software','api','data','model','asset','trademark','combined'))
);--> statement-breakpoint
CREATE INDEX "external_rights_scope_idx" ON "external_rights_assessments" ("organization_id","owner_user_id","subject_kind","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_rights_scope_version_unique" ON "external_rights_assessments" ("owner_user_id",COALESCE("organization_id",0),"subject_kind","subject_id","version");--> statement-breakpoint


CREATE TABLE IF NOT EXISTS "data_field_mappings" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer,
  "owner_user_id" integer NOT NULL,
  "provider_id" text NOT NULL,
  "dataset_key" text NOT NULL,
  "provider_field" text NOT NULL,
  "target_field_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "transform" text DEFAULT 'identity' NOT NULL,
  "version" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "confirmed_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "data_field_mappings_target_kind_ck" CHECK ("target_kind" IN ('canonical','extended')),
  CONSTRAINT "data_field_mappings_version_ck" CHECK ("version" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_field_mapping_scope_idx" ON "data_field_mappings" ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_field_mapping_lookup_idx" ON "data_field_mappings" ("organization_id","owner_user_id","provider_id","dataset_key","provider_field");--> statement-breakpoint


-- P5 hosted tenant isolation. Internal/local rows use NULL organization plus
-- exact user ownership; client rows additionally match the active organization.
ALTER TABLE "data_coverage_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "semantic_metric_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_lineage_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_rights_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_field_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS li_os_data_coverage_ledger_owner ON "data_coverage_ledger";--> statement-breakpoint
CREATE POLICY li_os_data_coverage_ledger_owner ON "data_coverage_ledger" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_semantic_metric_definitions_owner ON "semantic_metric_definitions";--> statement-breakpoint
CREATE POLICY li_os_semantic_metric_definitions_owner ON "semantic_metric_definitions" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_data_lineage_receipts_owner ON "data_lineage_receipts";--> statement-breakpoint
CREATE POLICY li_os_data_lineage_receipts_owner ON "data_lineage_receipts" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_external_rights_assessments_owner ON "external_rights_assessments";--> statement-breakpoint
CREATE POLICY li_os_external_rights_assessments_owner ON "external_rights_assessments" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_data_field_mappings_owner ON "data_field_mappings";--> statement-breakpoint
CREATE POLICY li_os_data_field_mappings_owner ON "data_field_mappings" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint
