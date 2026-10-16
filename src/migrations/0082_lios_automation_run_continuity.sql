ALTER TABLE project_automation_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_automation_runs_live_lease_idx ON project_automation_runs (lease_expires_at) WHERE status = 'running';
