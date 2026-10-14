CREATE TABLE "project_artifacts" (
  "id" text PRIMARY KEY,
  "project_id" integer NOT NULL,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "origin" text DEFAULT 'direct' NOT NULL,
  "head_version" integer DEFAULT 1 NOT NULL,
  "forked_from_artifact_id" text,
  "forked_from_version" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "project_artifacts_kind_ck" CHECK ("kind" IN ('chart','table','screen','valuation','portfolio','research','report','spreadsheet','data','backtest','strategy','decision','timeline')),
  CONSTRAINT "project_artifacts_status_ck" CHECK ("status" IN ('active','archived')),
  CONSTRAINT "project_artifacts_origin_ck" CHECK ("origin" IN ('direct','conversation','import','fork','engine')),
  CONSTRAINT "project_artifacts_head_version_ck" CHECK ("head_version" >= 1),
  CONSTRAINT "project_artifacts_fork_version_ck" CHECK ("forked_from_version" IS NULL OR "forked_from_version" >= 1)
);--> statement-breakpoint

CREATE TABLE "project_artifact_versions" (
  "id" text PRIMARY KEY,
  "artifact_id" text NOT NULL,
  "version" integer NOT NULL,
  "parent_version_id" text,
  "adapter_id" text NOT NULL,
  "content" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "execution_receipt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assumption_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_artifact_versions_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "project_artifact_versions_hash_ck" CHECK (length("content_hash") = 64)
);--> statement-breakpoint

CREATE TABLE "project_artifact_references" (
  "id" text PRIMARY KEY,
  "project_id" integer NOT NULL,
  "artifact_id" text NOT NULL,
  "version" integer,
  "target_type" text NOT NULL,
  "target_ref" text NOT NULL,
  "label" text,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_artifact_references_version_ck" CHECK ("version" IS NULL OR "version" >= 1),
  CONSTRAINT "project_artifact_references_target_type_ck" CHECK ("target_type" IN ('project','session','chat','resource','artifact'))
);--> statement-breakpoint

CREATE TABLE "project_artifact_proposals" (
  "id" text PRIMARY KEY,
  "artifact_id" text NOT NULL,
  "base_version" integer NOT NULL,
  "proposal_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "summary" text NOT NULL,
  "diffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "patch" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "proposed_content_hash" text NOT NULL,
  "created_by_user_id" integer NOT NULL,
  "decided_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "project_artifact_proposals_base_version_ck" CHECK ("base_version" >= 1),
  CONSTRAINT "project_artifact_proposals_type_ck" CHECK ("proposal_type" IN ('spreadsheet_ai_diff','document_edit','artifact_patch')),
  CONSTRAINT "project_artifact_proposals_status_ck" CHECK ("status" IN ('pending','accepted','rejected','cancelled')),
  CONSTRAINT "project_artifact_proposals_hash_ck" CHECK (length("proposed_content_hash") = 64)
);--> statement-breakpoint

CREATE TABLE "artifact_interaction_receipts" (
  "id" text PRIMARY KEY,
  "artifact_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_type" text NOT NULL,
  "from_version" integer,
  "to_version" integer,
  "request_id" text,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "artifact_interaction_receipts_actor_ck" CHECK ("actor_type" IN ('user','conversation','system')),
  CONSTRAINT "artifact_interaction_receipts_action_ck" CHECK ("action" IN ('open','edit','keep','reference','fork','compare','export','archive','restore','create_version','propose_change','accept_change','reject_change','undo','rerun','inspect_source','import')),
  CONSTRAINT "artifact_interaction_receipts_from_version_ck" CHECK ("from_version" IS NULL OR "from_version" >= 1),
  CONSTRAINT "artifact_interaction_receipts_to_version_ck" CHECK ("to_version" IS NULL OR "to_version" >= 1)
);--> statement-breakpoint

ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_forked_from_artifact_id_project_artifacts_id_fk" FOREIGN KEY ("forked_from_artifact_id") REFERENCES "public"."project_artifacts"("id") ON DELETE set null;--> statement-breakpoint

ALTER TABLE "project_artifact_versions" ADD CONSTRAINT "project_artifact_versions_artifact_id_project_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."project_artifacts"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifact_versions" ADD CONSTRAINT "project_artifact_versions_parent_version_id_project_artifact_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."project_artifact_versions"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "project_artifact_versions" ADD CONSTRAINT "project_artifact_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "project_artifact_references" ADD CONSTRAINT "project_artifact_references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifact_references" ADD CONSTRAINT "project_artifact_references_artifact_id_project_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."project_artifacts"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifact_references" ADD CONSTRAINT "project_artifact_references_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "project_artifact_proposals" ADD CONSTRAINT "project_artifact_proposals_artifact_id_project_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."project_artifacts"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifact_proposals" ADD CONSTRAINT "project_artifact_proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_artifact_proposals" ADD CONSTRAINT "project_artifact_proposals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint

ALTER TABLE "artifact_interaction_receipts" ADD CONSTRAINT "artifact_interaction_receipts_artifact_id_project_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."project_artifacts"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "artifact_interaction_receipts" ADD CONSTRAINT "artifact_interaction_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "project_artifacts_project_idx" ON "project_artifacts" ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "project_artifacts_kind_idx" ON "project_artifacts" ("project_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "project_artifacts_owner_idx" ON "project_artifacts" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "project_artifacts_fork_idx" ON "project_artifacts" ("forked_from_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_artifact_versions_artifact_version_unique" ON "project_artifact_versions" ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "project_artifact_versions_artifact_idx" ON "project_artifact_versions" ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "project_artifact_versions_hash_idx" ON "project_artifact_versions" ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "project_artifact_references_unique" ON "project_artifact_references" ("artifact_id",COALESCE("version", 0),"target_type","target_ref");--> statement-breakpoint
CREATE INDEX "project_artifact_references_project_idx" ON "project_artifact_references" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_artifact_references_target_idx" ON "project_artifact_references" ("target_type","target_ref");--> statement-breakpoint
CREATE INDEX "project_artifact_proposals_artifact_idx" ON "project_artifact_proposals" ("artifact_id","status","created_at");--> statement-breakpoint
CREATE INDEX "artifact_interaction_receipts_artifact_idx" ON "artifact_interaction_receipts" ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "artifact_interaction_receipts_request_idx" ON "artifact_interaction_receipts" ("request_id","created_at");
