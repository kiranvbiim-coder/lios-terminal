-- LIOS UX lifecycle Trash state
-- Archive remains an organizational state; trashed_at marks recoverable deletion.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "project_chats" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "project_resources" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "project_chats" ADD COLUMN IF NOT EXISTS "trashed_by_project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "project_resources" ADD COLUMN IF NOT EXISTS "trashed_by_project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN IF NOT EXISTS "trashed_by_project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD COLUMN IF NOT EXISTS "trashed_by_project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "project_chats" ADD COLUMN IF NOT EXISTS "trashed_from_status" text;
--> statement-breakpoint
ALTER TABLE "project_resources" ADD COLUMN IF NOT EXISTS "trashed_from_status" text;
--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN IF NOT EXISTS "trashed_from_status" text;
--> statement-breakpoint
ALTER TABLE "project_artifacts" ADD COLUMN IF NOT EXISTS "trashed_from_status" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_owner_trash_idx" ON "projects" ("owner_user_id", "trashed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_chats_owner_trash_idx" ON "project_chats" ("owner_user_id", "trashed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_resources_owner_trash_idx" ON "project_resources" ("owner_user_id", "trashed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sessions_owner_trash_idx" ON "project_sessions" ("owner_user_id", "trashed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_artifacts_owner_trash_idx" ON "project_artifacts" ("owner_user_id", "trashed_at");
