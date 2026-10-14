CREATE TYPE "public"."organization_lifecycle_stage" AS ENUM('trial', 'client', 'churned');--> statement-breakpoint
CREATE TYPE "public"."engagement_agreement_status" AS ENUM('draft', 'sent', 'signed', 'void');--> statement-breakpoint
CREATE TYPE "public"."engagement_payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE IF NOT EXISTS 'declined';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'trial_started';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'tier_selected';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'agreement_signed';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'payment_completed';--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'engagement_activated';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "lifecycle_stage" "organization_lifecycle_stage" DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_credits_granted_at" timestamp;--> statement-breakpoint
CREATE TABLE "engagement_agreements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "engagement_agreements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"engagement_id" integer NOT NULL,
	"status" "engagement_agreement_status" DEFAULT 'draft' NOT NULL,
	"vendor_reference" text,
	"signed_by_user_id" integer,
	"signed_at" timestamp,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "engagement_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"engagement_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"provider_payment_id" text,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "engagement_payment_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reconciled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "engagement_agreements" ADD CONSTRAINT "engagement_agreements_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_agreements" ADD CONSTRAINT "engagement_agreements_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_payments" ADD CONSTRAINT "engagement_payments_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_payments_idempotency_unique" ON "engagement_payments" USING btree ("idempotency_key");
