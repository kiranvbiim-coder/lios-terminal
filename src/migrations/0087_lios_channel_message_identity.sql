-- Extend existing Home ingress custody; no provider cache, raw text, new store or inferred legacy attribution.
-- Deliberately do not backfill from current credentials/Chat metadata: deleted legacy receipts cannot be attributed.
-- Existing content stays readable; old/null namespaces require disconnect and a new named connection before polling.
ALTER TABLE "channel_ingress_cursors" ADD COLUMN IF NOT EXISTS "provider_bot_id" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_cursors" ADD COLUMN IF NOT EXISTS "token_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_cursors" DROP CONSTRAINT IF EXISTS "channel_ingress_cursors_namespace_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_cursors" ADD CONSTRAINT "channel_ingress_cursors_namespace_ck" CHECK (
  ("provider_bot_id" IS NULL AND "token_fingerprint" IS NULL) OR
  ("provider_bot_id" IS NOT NULL AND "token_fingerprint" IS NOT NULL AND "provider_bot_id" ~ '^[1-9][0-9]{0,19}$' AND "token_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "provider_bot_id" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "conversation_id" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "provider_message_id" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "message_family" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "provider_occurred_at" timestamp;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "provider_edited_at" timestamp;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "message_anchor" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_update_disposition_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_update_disposition_ck" CHECK ("disposition" IN ('adopted','edited','ignored'));
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_update_adopted_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_update_adopted_ck" CHECK ("disposition" NOT IN ('adopted','edited') OR "reason" IS NULL);
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_update_namespace_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_update_namespace_ck" CHECK ("provider_bot_id" IS NULL OR "provider_bot_id" ~ '^[1-9][0-9]{0,19}$');
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_update_logical_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_update_logical_ck" CHECK (
  ("conversation_id" IS NULL AND "provider_message_id" IS NULL AND "message_family" IS NULL AND "provider_occurred_at" IS NULL AND "provider_edited_at" IS NULL AND "message_anchor" = false) OR
  ("provider_bot_id" IS NOT NULL AND "conversation_id" IS NOT NULL AND "provider_message_id" IS NOT NULL AND "message_family" IS NOT NULL AND "conversation_id" ~ '^-?[1-9][0-9]{0,19}$' AND "provider_message_id" ~ '^[1-9][0-9]{0,19}$' AND "message_family" IN ('message','channel_post') AND "provider_occurred_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_update_anchor_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_update_anchor_ck" CHECK ("message_anchor" = false OR "event_type" IN ('message','channel_post'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_ingress_message_anchor_unique" ON "channel_ingress_updates" ("source_connection_id","provider_bot_id","conversation_id","provider_message_id") WHERE "message_anchor" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_ingress_logical_message_idx" ON "channel_ingress_updates" ("source_connection_id","provider_bot_id","conversation_id","provider_message_id");
