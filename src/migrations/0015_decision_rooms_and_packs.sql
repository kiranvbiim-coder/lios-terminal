CREATE TYPE "public"."consulting_request_pack" AS ENUM('investment_decision', 'market_entry', 'ma_intelligence');--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD COLUMN "pack_type" "consulting_request_pack";--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "is_decision_room" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "decision_question" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "data_used" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "model_used" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "key_assumptions" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "key_risks" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "scenarios" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "decision_owner" text;