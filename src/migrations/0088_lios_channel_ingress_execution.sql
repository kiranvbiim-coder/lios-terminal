-- Extend existing replay custody; this is not a second run store or run status.
-- A committed claim is never automatically replayed, including the SQL/filesystem journal admission gap.
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "execution_request_id" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "execution_input_sha256" text;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "execution_chat_id" integer CONSTRAINT "channel_ingress_updates_execution_chat_id_project_chats_id_fk" REFERENCES "project_chats"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "execution_claimed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD COLUMN IF NOT EXISTS "execution_settled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_execution_claim_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_execution_claim_ck" CHECK (
  ("execution_request_id" IS NULL AND "execution_input_sha256" IS NULL AND "execution_claimed_at" IS NULL AND "execution_chat_id" IS NULL AND "execution_settled_at" IS NULL) OR
  ("execution_request_id" IS NOT NULL AND "execution_input_sha256" IS NOT NULL AND "execution_claimed_at" IS NOT NULL AND "disposition" = 'adopted' AND "message_anchor" = true AND "execution_request_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND "execution_input_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" DROP CONSTRAINT IF EXISTS "channel_ingress_execution_settlement_ck";
--> statement-breakpoint
ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_execution_settlement_ck" CHECK ("execution_settled_at" IS NULL OR ("execution_claimed_at" IS NOT NULL AND "execution_settled_at" >= "execution_claimed_at"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_ingress_execution_request_unique" ON "channel_ingress_updates" ("execution_request_id") WHERE "execution_request_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_ingress_execution_source_inflight_unique" ON "channel_ingress_updates" ("source_connection_id") WHERE "execution_request_id" IS NOT NULL AND "execution_settled_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_ingress_execution_chat_inflight_unique" ON "channel_ingress_updates" ("execution_chat_id") WHERE "execution_request_id" IS NOT NULL AND "execution_settled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_ingress_execution_budget_idx" ON "channel_ingress_updates" ("source_connection_id", "execution_claimed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_chat_messages_ingress_result_unique" ON "project_chat_messages" (("metadata"->>'channelIngressExecutionId')) WHERE "role" = 'assistant' AND "metadata"->>'channelIngressExecutionId' IS NOT NULL;
