-- P7 Research, Project Intelligence and thesis state

ALTER TABLE "project_artifacts" DROP CONSTRAINT IF EXISTS "project_artifacts_kind_ck";--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_kind_ck"
  CHECK ("kind" IN ('chart','table','screen','valuation','portfolio','research','report','spreadsheet','data','backtest','strategy','decision','timeline','thesis'));--> statement-breakpoint

CREATE TABLE "project_intelligence_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "source_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "content_hash" text NOT NULL,
  "occurred_at" timestamptz,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "context_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "embedding" jsonb,
  "indexed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_intelligence_document_hash_ck" CHECK (length("content_hash") = 64),
  CONSTRAINT "project_intelligence_document_type_ck" CHECK ("source_type" IN ('chat','chat_message','resource','artifact','ledger_event','research_evidence','filing','assumption','decision','report','thesis','document'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "project_intelligence_document_source_unique"
  ON "project_intelligence_documents" ("project_id","source_type","source_ref");--> statement-breakpoint
CREATE INDEX "project_intelligence_document_project_idx"
  ON "project_intelligence_documents" ("project_id","indexed_at");--> statement-breakpoint
CREATE INDEX "project_intelligence_document_scope_idx"
  ON "project_intelligence_documents" ("organization_id","owner_user_id","project_id");--> statement-breakpoint
CREATE INDEX "project_intelligence_document_type_idx"
  ON "project_intelligence_documents" ("project_id","source_type","occurred_at");--> statement-breakpoint

CREATE TABLE "project_intelligence_document_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "source_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "content_hash" text NOT NULL,
  "occurred_at" timestamptz,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "context_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "embedding" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_intelligence_document_version_hash_ck" CHECK (length("content_hash") = 64),
  CONSTRAINT "project_intelligence_document_version_type_ck" CHECK ("source_type" IN ('chat','chat_message','resource','artifact','ledger_event','research_evidence','filing','assumption','decision','report','thesis','document'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "project_intelligence_document_version_unique"
  ON "project_intelligence_document_versions" ("project_id","source_type","source_ref","content_hash");--> statement-breakpoint
CREATE INDEX "project_intelligence_document_version_lookup_idx"
  ON "project_intelligence_document_versions" ("project_id","source_ref","content_hash");--> statement-breakpoint
CREATE INDEX "project_intelligence_document_version_scope_idx"
  ON "project_intelligence_document_versions" ("organization_id","owner_user_id","project_id");--> statement-breakpoint

CREATE TABLE "project_intelligence_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE cascade,
  "generated_at" timestamptz NOT NULL,
  "content_hash" text NOT NULL,
  "graph_hash" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_intelligence_snapshot_content_hash_ck" CHECK (length("content_hash") = 64),
  CONSTRAINT "project_intelligence_snapshot_graph_hash_ck" CHECK (length("graph_hash") = 64)
);--> statement-breakpoint
CREATE UNIQUE INDEX "project_intelligence_snapshot_hash_unique"
  ON "project_intelligence_snapshots" ("project_id","content_hash");--> statement-breakpoint
CREATE INDEX "project_intelligence_snapshot_project_idx"
  ON "project_intelligence_snapshots" ("project_id","generated_at");--> statement-breakpoint
CREATE INDEX "project_intelligence_snapshot_scope_idx"
  ON "project_intelligence_snapshots" ("organization_id","owner_user_id","project_id");--> statement-breakpoint

ALTER TABLE "project_intelligence_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_intelligence_document_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_intelligence_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_intelligence_documents_owner ON "project_intelligence_documents";--> statement-breakpoint
CREATE POLICY li_os_project_intelligence_documents_owner ON "project_intelligence_documents" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_intelligence_document_versions_owner ON "project_intelligence_document_versions";--> statement-breakpoint
CREATE POLICY li_os_project_intelligence_document_versions_owner ON "project_intelligence_document_versions" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());--> statement-breakpoint

DROP POLICY IF EXISTS li_os_project_intelligence_snapshots_owner ON "project_intelligence_snapshots";--> statement-breakpoint
CREATE POLICY li_os_project_intelligence_snapshots_owner ON "project_intelligence_snapshots" FOR ALL
  USING ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id())
  WITH CHECK ("owner_user_id" = li_os_current_user_id() AND "organization_id" IS NOT DISTINCT FROM li_os_current_organization_id());
