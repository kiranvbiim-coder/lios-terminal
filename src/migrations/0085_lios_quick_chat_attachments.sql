-- Canonical Quick Chat attachment manifest; Project resources remain Project-scoped.
-- Quick Chat uploads never create an invisible Project or share its resource scope.
ALTER TABLE "project_chats" ADD COLUMN IF NOT EXISTS "attachment_manifest" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_attachment_manifest_ck"
    CHECK (jsonb_typeof("attachment_manifest") = 'array' AND jsonb_array_length("attachment_manifest") <= 250);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Re-assert migration 0084 (quant dataset input bindings): a database that applied the earlier Quick Chat 0084 recorded the same journal timestamp and would otherwise skip it.
ALTER TABLE "quant_experiments" ADD COLUMN IF NOT EXISTS "dataset_input_bindings" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "quant_runs" ADD COLUMN IF NOT EXISTS "dataset_input_bindings" jsonb NOT NULL DEFAULT '[]'::jsonb;
