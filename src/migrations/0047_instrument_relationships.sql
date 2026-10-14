-- LV4-04-06/LV4-04-07: instrument relationship model (ADR/GDR, generic
-- related instruments, and successor/predecessor entity succession) plus a
-- share-class column on company_listings.
--
-- Share classes (e.g. GOOGL Class A vs. GOOG Class C) need no new edge --
-- both listings already share one companies.id, so a plain nullable column
-- on company_listings is enough to say which class a given listing is.
--
-- ADR/GDR, generic related-instrument links, and succession are genuinely
-- relationships between two different rows, so they get one typed edge
-- table. The CHECK constraint enforces the split the master plan's own
-- hierarchy implies: succession describes two whole entities (predecessor
-- company -> successor company), while adr_gdr/related_instrument describe
-- two specific securities (listing -> listing) -- a row is never allowed to
-- mix both shapes.
ALTER TABLE "company_listings" ADD COLUMN "share_class" text;
--> statement-breakpoint
CREATE TYPE "public"."instrument_relationship_type" AS ENUM('adr_gdr', 'related_instrument', 'succession');
--> statement-breakpoint
CREATE TABLE "instrument_relationships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"relationship_type" "public"."instrument_relationship_type" NOT NULL,
	"source_listing_id" integer,
	"target_listing_id" integer,
	"source_company_id" integer,
	"target_company_id" integer,
	"ratio" text,
	"note" text,
	"source" text DEFAULT 'limuria' NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_relationships_listing_or_company_shape" CHECK (
		("instrument_relationships"."relationship_type" = 'succession'
			AND "instrument_relationships"."source_company_id" IS NOT NULL AND "instrument_relationships"."target_company_id" IS NOT NULL
			AND "instrument_relationships"."source_listing_id" IS NULL AND "instrument_relationships"."target_listing_id" IS NULL)
		OR
		("instrument_relationships"."relationship_type" <> 'succession'
			AND "instrument_relationships"."source_listing_id" IS NOT NULL AND "instrument_relationships"."target_listing_id" IS NOT NULL
			AND "instrument_relationships"."source_company_id" IS NULL AND "instrument_relationships"."target_company_id" IS NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "instrument_relationships" ADD CONSTRAINT "instrument_relationships_source_listing_id_company_listings_id_fk" FOREIGN KEY ("source_listing_id") REFERENCES "public"."company_listings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instrument_relationships" ADD CONSTRAINT "instrument_relationships_target_listing_id_company_listings_id_fk" FOREIGN KEY ("target_listing_id") REFERENCES "public"."company_listings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instrument_relationships" ADD CONSTRAINT "instrument_relationships_source_company_id_companies_id_fk" FOREIGN KEY ("source_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instrument_relationships" ADD CONSTRAINT "instrument_relationships_target_company_id_companies_id_fk" FOREIGN KEY ("target_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_relationship_unique" ON "instrument_relationships" USING btree ("relationship_type","source_listing_id","target_listing_id","source_company_id","target_company_id");
--> statement-breakpoint
CREATE INDEX "instrument_relationship_type_idx" ON "instrument_relationships" USING btree ("relationship_type");
--> statement-breakpoint
CREATE INDEX "instrument_relationship_source_listing_idx" ON "instrument_relationships" USING btree ("source_listing_id");
--> statement-breakpoint
CREATE INDEX "instrument_relationship_target_listing_idx" ON "instrument_relationships" USING btree ("target_listing_id");
--> statement-breakpoint
CREATE INDEX "instrument_relationship_source_company_idx" ON "instrument_relationships" USING btree ("source_company_id");
--> statement-breakpoint
CREATE INDEX "instrument_relationship_target_company_idx" ON "instrument_relationships" USING btree ("target_company_id");
