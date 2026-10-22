-- Canonical Quick Chat attachment manifest; Project resources remain Project-scoped.
-- Quick Chat uploads never create an invisible Project or share its resource scope.
ALTER TABLE "project_chats" ADD COLUMN IF NOT EXISTS "attachment_manifest" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_attachment_manifest_ck"
    CHECK (jsonb_typeof("attachment_manifest") = 'array' AND jsonb_array_length("attachment_manifest") <= 250);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
