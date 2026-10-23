-- Immutable source-to-parameter selection metadata stays with existing experiments/runs.
ALTER TABLE "quant_experiments" ADD COLUMN IF NOT EXISTS "dataset_input_bindings" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "quant_runs" ADD COLUMN IF NOT EXISTS "dataset_input_bindings" jsonb NOT NULL DEFAULT '[]'::jsonb;
