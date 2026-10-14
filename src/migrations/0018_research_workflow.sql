CREATE TYPE "public"."research_relationship_type" AS ENUM('supports', 'contradicts', 'supersedes', 'derived_from', 'affects', 'cites');--> statement-breakpoint
CREATE TABLE "research_evidence_relationships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"investigation_id" integer NOT NULL,
	"from_evidence_id" integer NOT NULL,
	"to_evidence_id" integer NOT NULL,
	"relationship_type" "research_relationship_type" NOT NULL,
	"note" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_evidence_relationship_no_self" CHECK ("from_evidence_id" <> "to_evidence_id")
);--> statement-breakpoint
CREATE TABLE "research_saved_searches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"investigation_id" integer,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "research_briefs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"investigation_id" integer NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "research_evidence_relationships" ADD CONSTRAINT "research_evidence_relationships_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "research_evidence_relationships" ADD CONSTRAINT "research_evidence_relationships_from_evidence_id_fk" FOREIGN KEY ("from_evidence_id") REFERENCES "public"."research_evidence"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "research_evidence_relationships" ADD CONSTRAINT "research_evidence_relationships_to_evidence_id_fk" FOREIGN KEY ("to_evidence_id") REFERENCES "public"."research_evidence"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "research_evidence_relationships" ADD CONSTRAINT "research_evidence_relationships_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "research_saved_searches" ADD CONSTRAINT "research_saved_searches_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "research_saved_searches" ADD CONSTRAINT "research_saved_searches_owner_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."research_investigations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_generated_by_user_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_evidence_relationship_unique" ON "research_evidence_relationships" ("investigation_id", "from_evidence_id", "to_evidence_id", "relationship_type");--> statement-breakpoint
CREATE INDEX "research_evidence_relationship_investigation_idx" ON "research_evidence_relationships" ("investigation_id");--> statement-breakpoint
CREATE INDEX "research_saved_search_owner_idx" ON "research_saved_searches" ("owner_user_id", "updated_at");--> statement-breakpoint
CREATE INDEX "research_saved_search_investigation_idx" ON "research_saved_searches" ("investigation_id");--> statement-breakpoint
CREATE INDEX "research_briefs_investigation_created_idx" ON "research_briefs" ("investigation_id", "created_at");
