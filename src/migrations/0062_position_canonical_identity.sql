-- LV4-09-09: durable portfolio identity is listing/security, not raw ticker.
ALTER TABLE "positions" ADD COLUMN "listing_id" integer;
--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "security_id" integer;
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_listing_id_company_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."company_listings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "positions_listing_idx" ON "positions" USING btree ("listing_id");
--> statement-breakpoint
CREATE INDEX "positions_security_idx" ON "positions" USING btree ("security_id");
--> statement-breakpoint
UPDATE "positions" AS p
SET "listing_id" = chosen."id",
    "security_id" = chosen."security_id"
FROM (
  SELECT DISTINCT ON (upper(cl."symbol"))
    cl."id",
    cl."security_id",
    upper(cl."symbol") AS usym
  FROM "company_listings" AS cl
  ORDER BY upper(cl."symbol"), cl."is_primary" DESC, cl."id"
) AS chosen
WHERE upper(p."symbol") = chosen.usym;
--> statement-breakpoint
ALTER TABLE "financial_model_runs" ADD COLUMN "listing_id" integer;
--> statement-breakpoint
ALTER TABLE "financial_model_runs" ADD COLUMN "security_id" integer;
--> statement-breakpoint
UPDATE "financial_model_runs" AS r
SET "listing_id" = chosen."id",
    "security_id" = chosen."security_id"
FROM (
  SELECT DISTINCT ON (upper(cl."symbol"))
    cl."id",
    cl."security_id",
    upper(cl."symbol") AS usym
  FROM "company_listings" AS cl
  ORDER BY upper(cl."symbol"), cl."is_primary" DESC, cl."id"
) AS chosen
WHERE upper(r."symbol") = chosen.usym;
