ALTER TABLE "project_artifact_versions"
  ADD COLUMN IF NOT EXISTS "trust_manifest" jsonb,
  ADD COLUMN IF NOT EXISTS "dependency_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "refresh_spec" jsonb;
