-- Replay-safe like every post-0074 migration: desktop ledger repair replays this suffix.
ALTER TABLE "project_artifacts" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD COLUMN IF NOT EXISTS "owning_chat_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_owning_chat_id_project_chats_id_fk" FOREIGN KEY ("owning_chat_id") REFERENCES "project_chats"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_owner_context_ck" CHECK ("project_id" IS NOT NULL OR "owning_chat_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_artifacts_chat_idx" ON "project_artifacts" ("owning_chat_id", "status", "updated_at");
--> statement-breakpoint
ALTER TABLE "project_artifact_references" ALTER COLUMN "project_id" DROP NOT NULL;
