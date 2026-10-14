-- LV4-05-05: canonical corporate-action event + instrument-leg model.
-- Events carry provider-neutral type/dates/source; legs carry the affected
-- security/listing and role. No provider-specific rows are seeded here --
-- the follow-up adapter contract (LV4-05-06) will normalize provider
-- payloads into this schema.
CREATE TYPE "public"."corporate_action_type" AS ENUM('dividend', 'special_dividend', 'split', 'reverse_split', 'rights_issue', 'bonus_issue', 'merger', 'acquisition', 'spin_off', 'ticker_change', 'exchange_migration', 'delisting', 'relisting', 'security_replacement');
--> statement-breakpoint
CREATE TYPE "public"."corporate_action_leg_role" AS ENUM('subject', 'acquirer', 'target', 'successor', 'replacement', 'spinoff');
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"action_type" "public"."corporate_action_type" NOT NULL,
	"issuer_company_id" integer,
	"announcement_date" text,
	"ex_date" text,
	"record_date" text,
	"payable_date" text,
	"effective_date" text,
	"source" text NOT NULL,
	"provider_event_id" text,
	"source_url" text,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_action_legs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"action_id" integer NOT NULL,
	"security_id" integer,
	"listing_id" integer,
	"role" "public"."corporate_action_leg_role" NOT NULL,
	"ratio_numerator" real,
	"ratio_denominator" real,
	"cash_amount" real,
	"cash_currency" text,
	"new_symbol" text,
	"new_exchange_mic" text,
	CONSTRAINT "corporate_action_leg_one_instrument" CHECK ((("corporate_action_legs"."security_id" IS NOT NULL)::int + ("corporate_action_legs"."listing_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "corporate_action_leg_ratio_shape" CHECK ((("corporate_action_legs"."ratio_numerator" IS NULL) = ("corporate_action_legs"."ratio_denominator" IS NULL)) AND ("corporate_action_legs"."ratio_numerator" IS NULL OR (("corporate_action_legs"."ratio_numerator" > 0 AND "corporate_action_legs"."ratio_denominator" > 0) AND "corporate_action_legs"."ratio_numerator" NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real) AND "corporate_action_legs"."ratio_denominator" NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)))),
	CONSTRAINT "corporate_action_leg_cash_nonnegative" CHECK ("corporate_action_legs"."cash_amount" IS NULL OR ("corporate_action_legs"."cash_amount" >= 0 AND "corporate_action_legs"."cash_amount" NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)))
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_issuer_company_id_companies_id_fk" FOREIGN KEY ("issuer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action_legs" ADD CONSTRAINT "corporate_action_legs_action_id_corporate_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."corporate_actions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action_legs" ADD CONSTRAINT "corporate_action_legs_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action_legs" ADD CONSTRAINT "corporate_action_legs_listing_id_company_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."company_listings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action_legs" ADD CONSTRAINT "corporate_action_legs_cash_currency_currencies_code_fk" FOREIGN KEY ("cash_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action_legs" ADD CONSTRAINT "corporate_action_legs_new_exchange_mic_exchanges_mic_fk" FOREIGN KEY ("new_exchange_mic") REFERENCES "public"."exchanges"("mic") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "corporate_action_type_idx" ON "corporate_actions" USING btree ("action_type");
--> statement-breakpoint
CREATE INDEX "corporate_action_effective_date_idx" ON "corporate_actions" USING btree ("effective_date");
--> statement-breakpoint
CREATE INDEX "corporate_action_issuer_company_idx" ON "corporate_actions" USING btree ("issuer_company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_action_provider_event_unique" ON "corporate_actions" USING btree ("source","provider_event_id") WHERE "corporate_actions"."provider_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "corporate_action_leg_action_idx" ON "corporate_action_legs" USING btree ("action_id");
--> statement-breakpoint
CREATE INDEX "corporate_action_leg_security_idx" ON "corporate_action_legs" USING btree ("security_id");
--> statement-breakpoint
CREATE INDEX "corporate_action_leg_listing_idx" ON "corporate_action_legs" USING btree ("listing_id");
