CREATE TYPE "public"."decision_record_status" AS ENUM('open', 'resolved');--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE 'decision_logged';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE 'decision_resolved';--> statement-breakpoint
CREATE TABLE "decision_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "decision_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"question" text NOT NULL,
	"assumptions" text NOT NULL,
	"forecast" text NOT NULL,
	"target_date" timestamp NOT NULL,
	"status" "decision_record_status" DEFAULT 'open' NOT NULL,
	"actual_outcome" text,
	"created_by_user_id" integer NOT NULL,
	"resolved_by_user_id" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;