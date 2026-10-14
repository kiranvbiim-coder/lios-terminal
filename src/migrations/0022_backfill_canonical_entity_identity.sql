INSERT INTO "company_listings" ("company_id", "symbol", "exchange", "country", "asset_class", "is_primary", "source")
SELECT
  "id",
  "symbol",
  COALESCE(NULLIF("exchange", ''), 'UNKNOWN'),
  "country",
  "asset_class",
  true,
  'legacy_company_master'
FROM "companies"
ON CONFLICT ("symbol", "exchange") DO NOTHING;--> statement-breakpoint

INSERT INTO "company_identifiers" ("company_id", "identifier_type", "identifier", "source", "is_primary")
SELECT
  "id",
  'cik',
  UPPER("cik"),
  'legacy_company_master',
  true
FROM "companies"
WHERE "cik" IS NOT NULL AND "cik" <> ''
ON CONFLICT ("identifier_type", "identifier") DO NOTHING;
