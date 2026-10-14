CREATE TYPE "public"."deliverable_gate_action" AS ENUM('advance', 'reject');--> statement-breakpoint
CREATE TABLE "deliverable_gate_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deliverable_gate_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"deliverable_id" integer NOT NULL,
	"action" "deliverable_gate_action" NOT NULL,
	"from_status" "deliverable_status" NOT NULL,
	"to_status" "deliverable_status" NOT NULL,
	"performed_by_user_id" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliverables" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliverables" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."deliverable_status";--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('draft', 'data_validation', 'calculation_validation', 'assumption_validation', 'citation_validation', 'consultant_review', 'senior_review', 'approved_for_delivery', 'delivered');--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ALTER COLUMN "from_status" SET DATA TYPE "public"."deliverable_status" USING "from_status"::"public"."deliverable_status";--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ALTER COLUMN "to_status" SET DATA TYPE "public"."deliverable_status" USING "to_status"::"public"."deliverable_status";--> statement-breakpoint
ALTER TABLE "deliverables" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."deliverable_status";--> statement-breakpoint
ALTER TABLE "deliverables" ALTER COLUMN "status" SET DATA TYPE "public"."deliverable_status" USING "status"::"public"."deliverable_status";--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ADD CONSTRAINT "deliverable_gate_events_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_gate_events" ADD CONSTRAINT "deliverable_gate_events_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;