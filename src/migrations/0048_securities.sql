-- LV4-04-01/LV4-04-02: make the missing entity -> security -> listing
-- layer real and durable.
--
-- `companies` remains the issuer/legal entity. `securities` is the global
-- share-class layer (one entity can issue GOOGL Class A and GOOG Class C as
-- distinct securities). `company_listings` becomes the venue-specific
-- instance of exactly one security. This replaces the old free-text
-- company_listings.share_class column, which stored a security fact at the
-- listing layer and had no production writer.
--
-- No fourth `instruments` table here. The resolver contract reserves
-- instrumentId for a future non-listing tradable-contract layer (derivatives,
-- warrants, etc.); nothing in the current product needs or can correctly
-- populate it. A fabricated fourth level would be worse than an explicit
-- null scope boundary.
--
-- A non-null SEC CIK identifies one issuer. This index is intentionally
-- fail-closed if historical data already has duplicate non-null CIKs: safely
-- merging two legal entities requires an explicit reconciliation, never an
-- automatic migration guess. It also closes the concurrent first-ingestion
-- race where different share-class symbols arrive at the same time.
CREATE UNIQUE INDEX "company_cik_unique" ON "companies" USING btree ("cik") WHERE "cik" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"share_class" text,
	"asset_class" "asset_class" DEFAULT 'equity' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_listings" ADD COLUMN "security_id" integer;
--> statement-breakpoint
-- Backfill one security per existing (company, share class, asset class)
-- group, then attach every legacy listing to that group. GROUP BY makes null
-- share classes coalesce into one row per company+asset class deliberately;
-- the two partial unique indexes below enforce that same invariant for all
-- future writes too.
INSERT INTO "securities" ("company_id", "name", "share_class", "asset_class")
SELECT cl."company_id", c."name", cl."share_class", cl."asset_class"
FROM "company_listings" AS cl
INNER JOIN "companies" AS c ON c."id" = cl."company_id"
GROUP BY cl."company_id", c."name", cl."share_class", cl."asset_class";
--> statement-breakpoint
UPDATE "company_listings" AS cl
SET "security_id" = s."id"
FROM "securities" AS s
WHERE s."company_id" = cl."company_id"
  AND s."asset_class" = cl."asset_class"
  AND (
		s."share_class" = cl."share_class"
		OR (s."share_class" IS NULL AND cl."share_class" IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "company_listings" ALTER COLUMN "security_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "securities" ADD CONSTRAINT "securities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Referenced by the composite listing FK below. Although `id` alone is a
-- primary key, PostgreSQL requires the exact referenced column tuple to have
-- a non-partial unique key before it will enforce the entity+asset match.
CREATE UNIQUE INDEX "security_id_company_asset_unique" ON "securities" USING btree ("id", "company_id", "asset_class");
--> statement-breakpoint
ALTER TABLE "company_listings" ADD CONSTRAINT "company_listings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Prevent a listing for company/asset A from referring to a security owned
-- by company/asset B. The two simple FKs above cannot express this
-- cross-column invariant by themselves.
ALTER TABLE "company_listings" ADD CONSTRAINT "company_listings_security_company_asset_fk" FOREIGN KEY ("security_id", "company_id", "asset_class") REFERENCES "public"."securities"("id", "company_id", "asset_class") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_listings" DROP COLUMN "share_class";
--> statement-breakpoint
-- PostgreSQL considers NULL values distinct in a normal UNIQUE index. Split
-- the invariant in two so the common null-share-class case cannot duplicate.
CREATE UNIQUE INDEX "security_company_class_asset_unique" ON "securities" USING btree ("company_id", "share_class", "asset_class") WHERE "share_class" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "security_company_asset_no_class_unique" ON "securities" USING btree ("company_id", "asset_class") WHERE "share_class" IS NULL;
--> statement-breakpoint
CREATE INDEX "security_company_idx" ON "securities" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "company_listing_security_idx" ON "company_listings" USING btree ("security_id");
