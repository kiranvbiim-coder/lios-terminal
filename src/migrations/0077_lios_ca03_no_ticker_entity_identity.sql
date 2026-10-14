-- CA-03 / P5: an entity no longer needs a ticker. The hierarchy stays entity -> security -> listing;
-- a company may now have zero securities, zero listings and no symbol. Compatible, additive and
-- idempotent on purpose (dbMigration.test.ts replays migrations against an already-migrated database).
--
-- 1. companies.symbol becomes nullable (UNIQUE is kept: Postgres permits any number of NULLs) and can
--    never be the empty-string sentinel.
-- 2. Entity facts are separate attributes, never inferred from a name or a missing ticker:
--    jurisdiction, legal_entity_kind, legal_form, lifecycle_status ('unknown' default) and
--    identity_status ('provisional' default = not yet confirmed against an authoritative registry).
-- 3. company_identifiers gains a (registry, jurisdiction) namespace so registry numbers (company
--    numbers, GLEIF/OpenCorporates-style record ids) are stored as identifier_type 'registry_id'
--    instead of a closed per-country type list. Existing rows are globally unique types and keep the
--    '' namespace.
-- 4. Repair/flag: ingestion providers without a legal name persisted the ticker (or a URL slug) as
--    companies.name. Those rows are flagged name_is_placeholder so a real name later replaces them and
--    a placeholder never overwrites a real name. The real names cannot be recovered here.
ALTER TABLE "companies" ALTER COLUMN "symbol" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "name_is_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "jurisdiction" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "legal_entity_kind" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "legal_form" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "lifecycle_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "identity_status" text DEFAULT 'provisional' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_identifiers" ADD COLUMN IF NOT EXISTS "registry" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_identifiers" ADD COLUMN IF NOT EXISTS "jurisdiction" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "companies" SET "symbol" = NULL WHERE "symbol" IS NOT NULL AND btrim("symbol") = '';--> statement-breakpoint
UPDATE "companies" SET "name_is_placeholder" = true
  WHERE "name_is_placeholder" = false
    AND "symbol" IS NOT NULL
    AND (upper(btrim("name")) = upper("symbol") OR upper(btrim("name")) = upper(split_part("symbol", '.', 1)));--> statement-breakpoint
DROP INDEX IF EXISTS "company_identifier_type_value_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_identifier_namespace_value_unique" ON "company_identifiers" USING btree ("identifier_type","registry","jurisdiction","identifier");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "companies" ADD CONSTRAINT "companies_symbol_not_blank" CHECK ("companies"."symbol" IS NULL OR length(btrim("companies"."symbol")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "companies" ADD CONSTRAINT "companies_legal_entity_kind_valid" CHECK ("companies"."legal_entity_kind" IS NULL OR "companies"."legal_entity_kind" IN ('corporation', 'partnership', 'limited_liability_company', 'trust', 'fund', 'sovereign', 'government_agency', 'nonprofit', 'individual', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "companies" ADD CONSTRAINT "companies_lifecycle_status_valid" CHECK ("companies"."lifecycle_status" IN ('unknown', 'active', 'inactive', 'dissolved', 'merged', 'acquired', 'insolvent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "companies" ADD CONSTRAINT "companies_identity_status_valid" CHECK ("companies"."identity_status" IN ('provisional', 'verified'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_registry_namespace_shape" CHECK (("company_identifiers"."identifier_type" = 'registry_id') = ("company_identifiers"."registry" <> '') AND ("company_identifiers"."jurisdiction" = '' OR "company_identifiers"."registry" <> ''));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
