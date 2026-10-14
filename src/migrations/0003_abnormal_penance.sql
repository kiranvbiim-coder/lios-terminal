CREATE TYPE "public"."asset_class" AS ENUM('equity', 'etf', 'fund', 'bond', 'index', 'commodity', 'forex', 'crypto');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"cik" text,
	"exchange" text,
	"country" text,
	"sector" text,
	"industry" text,
	"asset_class" "asset_class" DEFAULT 'equity' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "financial_statement_periods" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "financial_statement_periods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"report_type" text NOT NULL,
	"period_end" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"period" text DEFAULT 'FY' NOT NULL,
	"reported_currency" text DEFAULT 'USD' NOT NULL,
	"data" jsonb NOT NULL,
	"filing_date" text,
	"source" text DEFAULT 'sec_edgar' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_filings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sec_filings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"form_type" text NOT NULL,
	"accession_number" text NOT NULL,
	"filed_date" text NOT NULL,
	"filing_url" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_statement_periods" ADD CONSTRAINT "financial_statement_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_filings" ADD CONSTRAINT "sec_filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_stmt_period_unique" ON "financial_statement_periods" USING btree ("company_id","report_type","period_end","period","source");--> statement-breakpoint
CREATE UNIQUE INDEX "sec_filings_accession_unique" ON "sec_filings" USING btree ("accession_number");