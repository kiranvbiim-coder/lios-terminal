-- LV4-04-03/04: canonical country and exchange/MIC master tables.
-- Seeded with the markets already referenced by name in the existing
-- codebase (US, India) plus the additional countries the V4 Global
-- Acceptance Matrix (docs/LIOS_V4_MASTER_COMPLETION_PLAN.md section 34)
-- explicitly requires: UK/Europe, Japan/HK/APAC, Australia/Canada. This is
-- a starting set, not an exhaustive one -- adding a market is a data-only
-- INSERT against these tables, never a schema change.
CREATE TABLE "countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"currency_code" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"mic" text PRIMARY KEY NOT NULL,
	"operating_mic" text,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"currency_code" text NOT NULL,
	"timezone" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "exchange_country_idx" ON "exchanges" USING btree ("country_code");
--> statement-breakpoint
CREATE INDEX "exchange_operating_mic_idx" ON "exchanges" USING btree ("operating_mic");
--> statement-breakpoint
INSERT INTO "countries" ("code", "name", "region", "currency_code", "aliases") VALUES
	('US', 'United States', 'Americas', 'USD', '["USA", "United States of America"]'),
	('IN', 'India', 'Asia-Pacific', 'INR', '["Bharat"]'),
	('GB', 'United Kingdom', 'Europe', 'GBP', '["UK", "Great Britain"]'),
	('JP', 'Japan', 'Asia-Pacific', 'JPY', '[]'),
	('HK', 'Hong Kong', 'Asia-Pacific', 'HKD', '["Hong Kong SAR"]'),
	('CN', 'China', 'Asia-Pacific', 'CNY', '["People''s Republic of China", "PRC"]'),
	('DE', 'Germany', 'Europe', 'EUR', '[]'),
	('FR', 'France', 'Europe', 'EUR', '[]'),
	('CA', 'Canada', 'Americas', 'CAD', '[]'),
	('AU', 'Australia', 'Asia-Pacific', 'AUD', '[]'),
	('BR', 'Brazil', 'Americas', 'BRL', '[]'),
	('SG', 'Singapore', 'Asia-Pacific', 'SGD', '[]');
--> statement-breakpoint
INSERT INTO "exchanges" ("mic", "operating_mic", "name", "country_code", "currency_code", "timezone", "aliases") VALUES
	('XNAS', NULL, 'Nasdaq', 'US', 'USD', 'America/New_York', '["NASDAQ", "Nasdaq Stock Market"]'),
	('XNYS', NULL, 'New York Stock Exchange', 'US', 'USD', 'America/New_York', '["NYSE"]'),
	('XBOM', NULL, 'BSE Limited', 'IN', 'INR', 'Asia/Kolkata', '["BSE", "Bombay Stock Exchange"]'),
	('XNSE', NULL, 'National Stock Exchange of India', 'IN', 'INR', 'Asia/Kolkata', '["NSE"]'),
	('XLON', NULL, 'London Stock Exchange', 'GB', 'GBP', 'Europe/London', '["LSE"]'),
	('XTKS', NULL, 'Tokyo Stock Exchange', 'JP', 'JPY', 'Asia/Tokyo', '["TSE"]'),
	('XHKG', NULL, 'Hong Kong Stock Exchange', 'HK', 'HKD', 'Asia/Hong_Kong', '["HKEX"]'),
	('XSHG', NULL, 'Shanghai Stock Exchange', 'CN', 'CNY', 'Asia/Shanghai', '["SSE"]'),
	('XSHE', NULL, 'Shenzhen Stock Exchange', 'CN', 'CNY', 'Asia/Shanghai', '["SZSE"]'),
	('XETR', NULL, 'Deutsche Boerse Xetra', 'DE', 'EUR', 'Europe/Berlin', '["XETRA", "Deutsche Boerse"]'),
	('XPAR', NULL, 'Euronext Paris', 'FR', 'EUR', 'Europe/Paris', '[]'),
	('XTSE', NULL, 'Toronto Stock Exchange', 'CA', 'CAD', 'America/Toronto', '["TSX"]'),
	('XASX', NULL, 'Australian Securities Exchange', 'AU', 'AUD', 'Australia/Sydney', '["ASX"]'),
	('BVMF', NULL, 'B3 - Brasil Bolsa Balcao', 'BR', 'BRL', 'America/Sao_Paulo', '["B3", "BOVESPA"]'),
	('XSES', NULL, 'Singapore Exchange', 'SG', 'SGD', 'Asia/Singapore', '["SGX"]');
