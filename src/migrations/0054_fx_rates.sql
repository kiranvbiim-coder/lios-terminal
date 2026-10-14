-- LV4-05-02: FX rates table for date-aware currency conversion. No data is
-- seeded here -- provider-agnostic by design (see schema.ts's doc comment
-- on fxRates for the full rationale). This migration only creates the
-- table so shared/fxNormalization.ts and server/fxRateStore.ts have
-- somewhere to read/write real historical observations from once a rate
-- provider is wired.
CREATE TABLE "fx_rates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate_date" text NOT NULL,
	"rate" real NOT NULL,
	"source" text NOT NULL,
	"retrieved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_base_quote_distinct" CHECK ("fx_rates"."base_currency" <> "fx_rates"."quote_currency"),
	CONSTRAINT "fx_rates_positive_rate" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_quote_currency_currencies_code_fk" FOREIGN KEY ("quote_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rate_unique" ON "fx_rates" USING btree ("base_currency","quote_currency","rate_date","source");
--> statement-breakpoint
CREATE INDEX "fx_rate_pair_date_idx" ON "fx_rates" USING btree ("base_currency","quote_currency","rate_date");
