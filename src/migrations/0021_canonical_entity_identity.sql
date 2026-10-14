CREATE TABLE "company_listings" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "company_id" integer NOT NULL,
  "symbol" text NOT NULL,
  "exchange" text DEFAULT 'UNKNOWN' NOT NULL,
  "mic" text,
  "currency" text,
  "country" text,
  "asset_class" "asset_class" DEFAULT 'equity' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source" text DEFAULT 'limuria' NOT NULL,
  "valid_from" text,
  "valid_to" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "company_identifiers" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "company_id" integer NOT NULL,
  "identifier_type" text NOT NULL,
  "identifier" text NOT NULL,
  "source" text DEFAULT 'limuria' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "valid_from" text,
  "valid_to" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "company_listings" ADD CONSTRAINT "company_listings_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "company_listing_symbol_exchange_unique" ON "company_listings" ("symbol", "exchange");--> statement-breakpoint
CREATE INDEX "company_listing_company_idx" ON "company_listings" ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_identifier_type_value_unique" ON "company_identifiers" ("identifier_type", "identifier");--> statement-breakpoint
CREATE INDEX "company_identifier_company_idx" ON "company_identifiers" ("company_id");
