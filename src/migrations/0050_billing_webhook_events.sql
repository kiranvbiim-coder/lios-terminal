-- LV4-03-04: webhook replay safety and payment-event idempotency. The
-- unique index on (provider, provider_event_id) is what actually enforces
-- "processed at most once" -- see schema.ts's billingWebhookEvents doc
-- comment for the full rationale.
CREATE TYPE "public"."billing_webhook_event_status" AS ENUM('mapped', 'unmapped');--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"normalized_type" text,
	"status" "billing_webhook_event_status" NOT NULL,
	"mapping_error" text,
	"occurred_at" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_event_provider_id_unique" ON "billing_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "billing_webhook_event_status_idx" ON "billing_webhook_events" USING btree ("status");