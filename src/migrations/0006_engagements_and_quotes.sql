CREATE TYPE "public"."engagement_model" AS ENUM('strategy', 'one', 'vantage');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('proposed', 'negotiating', 'agreed', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."consulting_quote_status" AS ENUM('proposed', 'accepted', 'declined', 'superseded');--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "engagements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"engagement_model" "engagement_model" NOT NULL,
	"domain_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" "engagement_status" DEFAULT 'proposed' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulting_quotes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consulting_quotes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" integer NOT NULL,
	"proposed_by_admin_id" integer NOT NULL,
	"amount" real,
	"currency" text DEFAULT 'INR' NOT NULL,
	"proposed_timeline_days" integer,
	"notes" text NOT NULL,
	"status" "consulting_quote_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"responded_by_user_id" integer
);
--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD COLUMN "engagement_id" integer;--> statement-breakpoint
ALTER TABLE "consulting_requests" ALTER COLUMN "sla_hours" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consulting_requests" ALTER COLUMN "sla_hours" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "consulting_requests" ALTER COLUMN "sla_deadline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consulting_requests" ALTER COLUMN "pricing_tier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consulting_requests" ALTER COLUMN "pricing_tier" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_quotes" ADD CONSTRAINT "consulting_quotes_request_id_consulting_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_quotes" ADD CONSTRAINT "consulting_quotes_proposed_by_admin_id_users_id_fk" FOREIGN KEY ("proposed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_quotes" ADD CONSTRAINT "consulting_quotes_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;
