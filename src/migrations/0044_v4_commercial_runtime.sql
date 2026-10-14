-- LiOS V4 commercial-runtime convergence.
-- Canonical software tiers: trial / starter / pro / enterprise.
-- Historical personal/team semantics are migrated only in software-plan data;
-- generic collaboration/team concepts elsewhere are intentionally untouched.

CREATE TYPE "public"."platform_plan_tier_v4" AS ENUM('trial', 'starter', 'pro', 'enterprise');
--> statement-breakpoint

ALTER TABLE "platform_plans"
  ALTER COLUMN "tier" TYPE "public"."platform_plan_tier_v4"
  USING (
    CASE "tier"::text
      WHEN 'personal' THEN 'starter'
      WHEN 'team' THEN 'pro'
      ELSE "tier"::text
    END
  )::"public"."platform_plan_tier_v4";
--> statement-breakpoint

DROP TYPE "public"."platform_plan_tier";
--> statement-breakpoint
ALTER TYPE "public"."platform_plan_tier_v4" RENAME TO "platform_plan_tier";
--> statement-breakpoint

-- Normalize legacy plan codes when it is collision-safe. If a canonical plan
-- already exists, retain the historical row under an explicit legacy code and
-- deactivate it rather than deleting commercial history.
DO $$
DECLARE legacy_id integer;
BEGIN
  SELECT id INTO legacy_id FROM "platform_plans" WHERE code = 'personal' LIMIT 1;
  IF legacy_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "platform_plans" WHERE code = 'starter' AND id <> legacy_id) THEN
      UPDATE "platform_plans"
        SET code = 'legacy-personal-' || legacy_id::text, active = false, updated_at = now()
        WHERE id = legacy_id;
    ELSE
      UPDATE "platform_plans" SET code = 'starter', updated_at = now() WHERE id = legacy_id;
    END IF;
  END IF;

  SELECT id INTO legacy_id FROM "platform_plans" WHERE code = 'team' LIMIT 1;
  IF legacy_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "platform_plans" WHERE code = 'pro' AND id <> legacy_id) THEN
      UPDATE "platform_plans"
        SET code = 'legacy-team-' || legacy_id::text, active = false, updated_at = now()
        WHERE id = legacy_id;
    ELSE
      UPDATE "platform_plans" SET code = 'pro', updated_at = now() WHERE id = legacy_id;
    END IF;
  END IF;
END $$;
--> statement-breakpoint

-- Signed entitlement and offline-lease material. These fields describe access
-- authority only; they never contain or custody client datasets or BYOAI keys.
ALTER TABLE "organization_licenses"
  ADD COLUMN "entitlement_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "entitlement_issued_at" timestamp,
  ADD COLUMN "entitlement_expires_at" timestamp,
  ADD COLUMN "entitlement_public_key_id" text,
  ADD COLUMN "signed_entitlement_hash" text,
  ADD COLUMN "entitlement_signature" text,
  ADD COLUMN "offline_lease_signature" text;
--> statement-breakpoint

CREATE INDEX "organization_license_entitlement_expiry_idx"
  ON "organization_licenses" USING btree ("entitlement_expires_at");
--> statement-breakpoint

-- Canonical trial policy is server-backed, seven-day, Pro-style and BYOAI is
-- never metered through the LiOS credit ledger.
UPDATE "platform_plans"
SET
  name = CASE WHEN code = 'trial' THEN 'LiOS Pro Trial' ELSE name END,
  feature_limits = CASE
    WHEN code = 'trial' THEN COALESCE(feature_limits, '{}'::jsonb) || jsonb_build_object(
      'entitlementTier', 'pro',
      'trialDays', 7,
      'byoaiConsumesLiosCredits', false
    )
    ELSE feature_limits
  END,
  updated_at = now()
WHERE code = 'trial';
