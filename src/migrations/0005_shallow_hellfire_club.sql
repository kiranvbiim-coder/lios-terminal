CREATE TYPE "public"."request_pricing_tier" AS ENUM('basic', 'standard', 'premium');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'assigned', 'in_progress', 'completed', 'escalated', 'resolved');--> statement-breakpoint
CREATE TABLE "admin_domains" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_domains_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"domain_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulting_approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consulting_approvals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" integer NOT NULL,
	"submitted_by_admin_id" integer NOT NULL,
	"solution_body" text NOT NULL,
	"status" text DEFAULT 'delivered' NOT NULL,
	"attached_files" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulting_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consulting_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" integer NOT NULL,
	"author_user_id" integer NOT NULL,
	"message" text NOT NULL,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulting_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consulting_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"domain_id" integer NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"assigned_admin_id" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"pricing_tier" "request_pricing_tier" DEFAULT 'standard' NOT NULL,
	"sla_hours" integer DEFAULT 24 NOT NULL,
	"sla_deadline" timestamp NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"attached_files" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulting_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consulting_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"domain_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"template_body" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_domains" ADD CONSTRAINT "admin_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_domains" ADD CONSTRAINT "admin_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_approvals" ADD CONSTRAINT "consulting_approvals_request_id_consulting_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_approvals" ADD CONSTRAINT "consulting_approvals_submitted_by_admin_id_users_id_fk" FOREIGN KEY ("submitted_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_comments" ADD CONSTRAINT "consulting_comments_request_id_consulting_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_comments" ADD CONSTRAINT "consulting_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_assigned_admin_id_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_templates" ADD CONSTRAINT "consulting_templates_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_templates" ADD CONSTRAINT "consulting_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_domain_unique" ON "admin_domains" USING btree ("user_id","domain_id");