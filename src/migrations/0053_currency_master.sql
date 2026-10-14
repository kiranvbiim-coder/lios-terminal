-- LV4-05-01: canonical currency master (ISO 4217) + the two "listing/base
-- currency" contracts the V4 Master Plan section 11 requires: countries and
-- exchanges' existing currency_code columns become real foreign keys
-- instead of unvalidated free text, and portfolios gains a base_currency
-- column (it previously had none at all). Currencies are seeded before the
-- ALTER TABLE ... ADD CONSTRAINT statements below so the existing
-- countries/exchanges rows (11 distinct currency codes across the 12
-- seeded countries) already satisfy the new foreign keys when added.
-- Starting set, not exhaustive -- adding a currency is a data-only INSERT,
-- same convention as countries/exchanges (migration 0046).
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"numeric_code" text,
	"minor_unit" integer DEFAULT 2 NOT NULL,
	"symbol" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "currencies" ("code", "name", "numeric_code", "minor_unit", "symbol") VALUES
	('USD', 'US Dollar', '840', 2, '$'),
	('EUR', 'Euro', '978', 2, E'\u20AC'),
	('GBP', 'Pound Sterling', '826', 2, E'\u00A3'),
	('JPY', 'Yen', '392', 0, E'\u00A5'),
	('INR', 'Indian Rupee', '356', 2, E'\u20B9'),
	('HKD', 'Hong Kong Dollar', '344', 2, 'HK$'),
	('CNY', 'Yuan Renminbi', '156', 2, E'\u00A5'),
	('CAD', 'Canadian Dollar', '124', 2, 'CA$'),
	('AUD', 'Australian Dollar', '036', 2, 'A$'),
	('BRL', 'Brazilian Real', '986', 2, 'R$'),
	('SGD', 'Singapore Dollar', '702', 2, 'S$'),
	('CHF', 'Swiss Franc', '756', 2, 'CHF'),
	('KRW', 'Won', '410', 0, E'\u20A9'),
	('TWD', 'New Taiwan Dollar', '901', 2, 'NT$'),
	('THB', 'Baht', '764', 2, E'\u0E3F'),
	('IDR', 'Rupiah', '360', 2, 'Rp'),
	('MYR', 'Malaysian Ringgit', '458', 2, 'RM'),
	('PHP', 'Philippine Peso', '608', 2, E'\u20B1'),
	('VND', 'Dong', '704', 0, E'\u20AB'),
	('ZAR', 'Rand', '710', 2, 'R'),
	('MXN', 'Mexican Peso', '484', 2, 'Mex$'),
	('NZD', 'New Zealand Dollar', '554', 2, 'NZ$'),
	('SEK', 'Swedish Krona', '752', 2, 'kr'),
	('NOK', 'Norwegian Krone', '578', 2, 'kr'),
	('DKK', 'Danish Krone', '208', 2, 'kr'),
	('PLN', 'Zloty', '985', 2, E'z\u0142'),
	('TRY', 'Turkish Lira', '949', 2, E'\u20BA'),
	('AED', 'UAE Dirham', '784', 2, E'\u062F.\u0625'),
	('SAR', 'Saudi Riyal', '682', 2, E'\uFDFC'),
	('ILS', 'New Israeli Sheqel', '376', 2, E'\u20AA'),
	('RUB', 'Russian Ruble', '643', 2, E'\u20BD');
--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "base_currency" text DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
