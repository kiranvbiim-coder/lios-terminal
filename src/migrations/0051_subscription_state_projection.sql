-- LV4-03-05: subscription state projection into LiOS. Links a webhook
-- event to its resolved organization plus whether projection has
-- actually run for it yet (projected_at -- makes a retried duplicate
-- delivery still able to retry a previously-failed projection, rather
-- than being acknowledged and permanently skipped), and links an
-- organization's license to the Paddle customer/subscription it
-- belongs to. See schema.ts's doc comments on both new column groups
-- for the full rationale.
ALTER TABLE "billing_webhook_events" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD COLUMN "projected_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_licenses" ADD COLUMN "provider_customer_id" text;--> statement-breakpoint
ALTER TABLE "organization_licenses" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;