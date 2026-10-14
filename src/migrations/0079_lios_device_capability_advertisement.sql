ALTER TABLE "paired_devices" ADD COLUMN IF NOT EXISTS "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "paired_devices" ADD COLUMN IF NOT EXISTS "commands" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "paired_devices" ADD COLUMN IF NOT EXISTS "advertised_at" timestamp with time zone;
