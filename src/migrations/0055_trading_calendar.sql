-- LV4-05-03: exchange trading sessions and holiday calendar. Each session
-- row's `source` column cites where it was checked -- each exchange's own
-- primary site where reachable in this session (nyse.com, jpx.co.jp,
-- hkex.com.hk, sse.com.cn, asx.com.au, deutsche-boerse.com,
-- nseindia.com, cmcmarkets.com), a data aggregator (tradinghours.com,
-- market-clock.com) where a primary site was unreachable. Two values
-- from an initial pass (Tokyo's afternoon close, Bovespa's close) were
-- caught wrong by code review and corrected against jpx.co.jp and
-- tradinghours.com's own live page respectively -- not guessed, and not
-- assumed correct without checking. The 2026 holiday calendar initially
-- seeded here is limited to XNAS/XNYS (US markets observe an identical
-- SEC-recognized schedule), verified directly against
-- https://www.nyse.com/markets/hours-calendars (checked 2026-09-14).
-- Migration 0056_trading_calendar_2026_completion.sql subsequently adds
-- the verified 2026 holiday rows for the other 13 exchanges; this file's
-- initial scope is historical context, not the current coverage boundary.
-- Not exhaustive -- adding a session or holiday row is a data-only
-- INSERT, same convention as countries/exchanges/currencies.
CREATE TYPE "public"."trading_session_type" AS ENUM('pre_market', 'regular', 'post_market');
--> statement-breakpoint
CREATE TYPE "public"."exchange_holiday_status" AS ENUM('closed', 'early_close');
--> statement-breakpoint
CREATE TABLE "exchange_trading_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"exchange_mic" text NOT NULL,
	"session_type" "public"."trading_session_type" NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_trading_session_time_order" CHECK ("exchange_trading_sessions"."start_time" < "exchange_trading_sessions"."end_time")
);
--> statement-breakpoint
CREATE TABLE "exchange_holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"exchange_mic" text NOT NULL,
	"holiday_date" text NOT NULL,
	"name" text NOT NULL,
	"status" "public"."exchange_holiday_status" DEFAULT 'closed' NOT NULL,
	"early_close_time" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_holiday_early_close_shape" CHECK (
		("exchange_holidays"."status" = 'early_close' AND "exchange_holidays"."early_close_time" IS NOT NULL)
		OR
		("exchange_holidays"."status" = 'closed' AND "exchange_holidays"."early_close_time" IS NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "exchange_trading_sessions" ADD CONSTRAINT "exchange_trading_sessions_exchange_mic_exchanges_mic_fk" FOREIGN KEY ("exchange_mic") REFERENCES "public"."exchanges"("mic") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "exchange_holidays" ADD CONSTRAINT "exchange_holidays_exchange_mic_exchanges_mic_fk" FOREIGN KEY ("exchange_mic") REFERENCES "public"."exchanges"("mic") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_trading_session_unique" ON "exchange_trading_sessions" USING btree ("exchange_mic","session_type","sequence");
--> statement-breakpoint
CREATE INDEX "exchange_trading_session_mic_idx" ON "exchange_trading_sessions" USING btree ("exchange_mic");
--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_holiday_unique" ON "exchange_holidays" USING btree ("exchange_mic","holiday_date");
--> statement-breakpoint
CREATE INDEX "exchange_holiday_mic_idx" ON "exchange_holidays" USING btree ("exchange_mic");
--> statement-breakpoint
-- US markets (nyse.com/markets/hours-calendars, checked 2026-09-14).
INSERT INTO "exchange_trading_sessions" ("exchange_mic", "session_type", "sequence", "start_time", "end_time", "source") VALUES
	('XNAS', 'pre_market', 0, '04:00', '09:30', 'nyse.com/markets/hours-calendars'),
	('XNAS', 'regular', 0, '09:30', '16:00', 'nyse.com/markets/hours-calendars'),
	('XNAS', 'post_market', 0, '16:00', '20:00', 'nyse.com/markets/hours-calendars'),
	('XNYS', 'pre_market', 0, '04:00', '09:30', 'nyse.com/markets/hours-calendars'),
	('XNYS', 'regular', 0, '09:30', '16:00', 'nyse.com/markets/hours-calendars'),
	('XNYS', 'post_market', 0, '16:00', '20:00', 'nyse.com/markets/hours-calendars'),
	('XBOM', 'regular', 0, '09:15', '15:30', 'nseindia.com/resources/exchange-communication-holidays (BSE observes the same session as NSE)'),
	('XNSE', 'regular', 0, '09:15', '15:30', 'nseindia.com/resources/exchange-communication-holidays'),
	('XLON', 'regular', 0, '08:00', '16:30', 'cmcmarkets.com/en-gb/shares/stock-market-trading-hours'),
	('XTKS', 'regular', 0, '09:00', '11:30', 'jpx.co.jp/english/equities/trading/domestic/01.html'),
	('XTKS', 'regular', 1, '12:30', '15:30', 'jpx.co.jp/english/equities/trading/domestic/01.html'),
	('XHKG', 'pre_market', 0, '09:00', '09:30', 'hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market'),
	('XHKG', 'regular', 0, '09:30', '12:00', 'hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market'),
	('XHKG', 'regular', 1, '13:00', '16:00', 'hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market'),
	('XSHG', 'regular', 0, '09:30', '11:30', 'english.sse.com.cn/start/trading/schedule'),
	('XSHG', 'regular', 1, '13:00', '15:00', 'english.sse.com.cn/start/trading/schedule'),
	('XSHE', 'regular', 0, '09:30', '11:30', 'english.sse.com.cn/start/trading/schedule (SZSE observes an identical session)'),
	('XSHE', 'regular', 1, '13:00', '15:00', 'english.sse.com.cn/start/trading/schedule (SZSE observes an identical session)'),
	('XETR', 'regular', 0, '09:00', '17:30', 'deutsche-boerse.com/dbg-en/markets-services/trading/trading-venues'),
	('XPAR', 'regular', 0, '09:00', '17:30', 'tradinghours.com/markets/euronext-paris'),
	('XTSE', 'regular', 0, '09:30', '16:00', 'market-clock.com/markets/tmx/tsx/equities'),
	('XASX', 'regular', 0, '10:00', '16:00', 'asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours'),
	('BVMF', 'regular', 0, '10:00', '16:55', 'tradinghours.com/markets/bovespa'),
	('XSES', 'regular', 0, '09:00', '12:00', 'tradinghours.com/markets/sgx'),
	('XSES', 'regular', 1, '13:00', '17:00', 'tradinghours.com/markets/sgx');
--> statement-breakpoint
-- 2026 US market holidays (nyse.com/markets/hours-calendars, checked
-- 2026-09-14). NASDAQ (XNAS) observes the identical SEC-recognized
-- holiday schedule as NYSE (XNYS).
INSERT INTO "exchange_holidays" ("exchange_mic", "holiday_date", "name", "status", "early_close_time", "source") VALUES
	('XNYS', '2026-01-01', E'New Year\'s Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-01-19', 'Martin Luther King, Jr. Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-02-16', E'Washington\'s Birthday', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-04-03', 'Good Friday', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-05-25', 'Memorial Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-06-19', 'Juneteenth National Independence Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-07-03', 'Independence Day (observed)', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-09-07', 'Labor Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-11-26', 'Thanksgiving Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-11-27', 'Day after Thanksgiving (early close)', 'early_close', '13:00', 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-12-24', 'Christmas Eve (early close)', 'early_close', '13:00', 'nyse.com/markets/hours-calendars'),
	('XNYS', '2026-12-25', 'Christmas Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-01-01', E'New Year\'s Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-01-19', 'Martin Luther King, Jr. Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-02-16', E'Washington\'s Birthday', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-04-03', 'Good Friday', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-05-25', 'Memorial Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-06-19', 'Juneteenth National Independence Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-07-03', 'Independence Day (observed)', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-09-07', 'Labor Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-11-26', 'Thanksgiving Day', 'closed', NULL, 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-11-27', 'Day after Thanksgiving (early close)', 'early_close', '13:00', 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-12-24', 'Christmas Eve (early close)', 'early_close', '13:00', 'nyse.com/markets/hours-calendars'),
	('XNAS', '2026-12-25', 'Christmas Day', 'closed', NULL, 'nyse.com/markets/hours-calendars');
