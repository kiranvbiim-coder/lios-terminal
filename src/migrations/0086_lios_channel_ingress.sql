-- Canonical channel polling custody: one cursor per source connection and minimal per-update replay identity.
-- Cursor and dispositions commit with the existing Chat message in one transaction; no raw provider body is stored.
CREATE TABLE IF NOT EXISTS "channel_ingress_cursors" (
  "source_connection_id" integer PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "next_offset" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "channel_ingress_cursors_provider_ck" CHECK ("provider" = 'telegram'),
  CONSTRAINT "channel_ingress_cursors_offset_ck" CHECK ("next_offset" >= 0 AND "next_offset" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_ingress_updates" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_connection_id" integer NOT NULL,
  "update_id" bigint NOT NULL,
  "event_type" text NOT NULL,
  "fingerprint" text NOT NULL,
  "disposition" text NOT NULL,
  "reason" text,
  "chat_message_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "channel_ingress_update_disposition_ck" CHECK ("disposition" IN ('adopted','ignored')),
  CONSTRAINT "channel_ingress_update_fingerprint_ck" CHECK (length("fingerprint") = 64),
  CONSTRAINT "channel_ingress_update_id_ck" CHECK ("update_id" >= 0 AND "update_id" < 9007199254740991),
  CONSTRAINT "channel_ingress_update_adopted_ck" CHECK ("disposition" <> 'adopted' OR "reason" IS NULL)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_ingress_cursors" ADD CONSTRAINT "channel_ingress_cursors_source_connection_id_source_connections_id_fk"
    FOREIGN KEY ("source_connection_id") REFERENCES "source_connections"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_updates_source_connection_id_source_connections_id_fk"
    FOREIGN KEY ("source_connection_id") REFERENCES "source_connections"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_ingress_updates" ADD CONSTRAINT "channel_ingress_updates_chat_message_id_project_chat_messages_id_fk"
    FOREIGN KEY ("chat_message_id") REFERENCES "project_chat_messages"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_ingress_update_identity_unique" ON "channel_ingress_updates" ("source_connection_id","update_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_ingress_update_message_idx" ON "channel_ingress_updates" ("chat_message_id");
