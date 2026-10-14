CREATE TYPE "public"."client_audit_event_type" AS ENUM('login', 'logout', 'watchlist_add', 'watchlist_remove', 'alert_add', 'alert_remove', 'quote_accepted', 'quote_declined', 'csv_export');
--> statement-breakpoint
CREATE TABLE "client_audit_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"user_id" integer,
	"event_type" "client_audit_event_type" NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_audit_events" ADD CONSTRAINT "client_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_audit_events" ADD CONSTRAINT "client_audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
