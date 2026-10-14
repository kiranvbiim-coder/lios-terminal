CREATE TYPE "public"."research_investigation_status" AS ENUM('draft', 'active', 'review', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."research_evidence_type" AS ENUM('filing', 'news', 'official_data', 'market_data', 'model_output', 'uploaded_document', 'internal_note', 'claim');--> statement-breakpoint
CREATE TYPE "public"."research_evidence_kind" AS ENUM('fact', 'claim', 'calculation', 'interpretation', 'counterargument', 'unknown');--> statement-breakpoint
CREATE TABLE "research_investigations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_investigations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"question" text NOT NULL,
	"thesis" text,
	"status" "research_investigation_status" DEFAULT 'draft' NOT NULL,
	"primary_symbol" text,
	"subject_label" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_id" integer,
	"domain_id" integer,
	"organization_id" integer,
	"owner_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "research_evidence" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_evidence_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"investigation_id" integer NOT NULL,
	"evidence_type" "research_evidence_type" NOT NULL,
	"evidence_kind" "research_evidence_kind" DEFAULT 'unknown' NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"annotation" text,
	"source_name" text NOT NULL,
	"provider" text NOT NULL,
	"source_url" text,
	"source_external_id" text,
	"content_fingerprint" text NOT NULL,
	"published_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_quality" jsonb NOT NULL,
	"relevance_score" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "research_investigations" ADD CONSTRAINT "research_investigations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_investigations" ADD CONSTRAINT "research_investigations_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_investigations" ADD CONSTRAINT "research_investigations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_investigations" ADD CONSTRAINT "research_investigations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_investigation_id_research_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_investigations_owner_status_idx" ON "research_investigations" USING btree ("owner_user_id", "status");--> statement-breakpoint
CREATE INDEX "research_investigations_org_idx" ON "research_investigations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "research_investigations_company_idx" ON "research_investigations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_evidence_investigation_fingerprint_unique" ON "research_evidence" USING btree ("investigation_id", "content_fingerprint");--> statement-breakpoint
CREATE INDEX "research_evidence_investigation_created_idx" ON "research_evidence" USING btree ("investigation_id", "created_at");--> statement-breakpoint
CREATE INDEX "research_evidence_external_id_idx" ON "research_evidence" USING btree ("provider", "source_external_id");
