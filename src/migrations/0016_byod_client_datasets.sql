ALTER TYPE "public"."client_audit_event_type" ADD VALUE 'dataset_uploaded';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE 'dataset_deleted';--> statement-breakpoint
CREATE TABLE "client_datasets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_ext" text NOT NULL,
	"sheet_count" integer NOT NULL,
	"total_rows" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_datasets" ADD CONSTRAINT "client_datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_datasets" ADD CONSTRAINT "client_datasets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;