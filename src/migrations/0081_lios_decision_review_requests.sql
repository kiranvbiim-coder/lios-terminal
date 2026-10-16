ALTER TABLE "decision_approvals" ADD COLUMN IF NOT EXISTS "review_request_id" text;--> statement-breakpoint
ALTER TABLE "decision_approvals" ADD COLUMN IF NOT EXISTS "review_request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decision_approval_reviewer_request_unique" ON "decision_approvals" USING btree ("reviewer_user_id", "review_request_id");
