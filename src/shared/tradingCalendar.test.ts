import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTradingDay,
  findHolidayOn,
  getSessionsForExchange,
  isWeekend,
  type Holiday,
  type TradingSession,
} from "./tradingCalendar";

const XNAS_PRE: TradingSession = { exchangeMic: "XNAS", sessionType: "pre_market", sequence: 0, startTime: "04:00", endTime: "09:30" };
const XNAS_REGULAR: TradingSession = { exchangeMic: "XNAS", sessionType: "regular", sequence: 0, startTime: "09:30", endTime: "16:00" };
const XNAS_POST: TradingSession = { exchangeMic: "XNAS", sessionType: "post_market", sequence: 0, startTime: "16:00", endTime: "20:00" };
// Split session out of insertion order, to prove sorting is real.
const XTKS_PM: TradingSession = { exchangeMic: "XTKS", sessionType: "regular", sequence: 1, startTime: "12:30", endTime: "15:30" };
const XTKS_AM: TradingSession = { exchangeMic: "XTKS", sessionType: "regular", sequence: 0, startTime: "09:00", endTime: "11:30" };
const SESSIONS = [XNAS_PRE, XNAS_REGULAR, XNAS_POST, XTKS_PM, XTKS_AM];

test("getSessionsForExchange filters by exchange and sorts a split session by sequence", () => {
  const xtks = getSessionsForExchange(SESSIONS, "XTKS");
  assert.deepEqual(xtks, [XTKS_AM, XTKS_PM]);
});

test("getSessionsForExchange optionally filters by session type", () => {
  const preMarketOnly = getSessionsForExchange(SESSIONS, "XNAS", "pre_market");
  assert.deepEqual(preMarketOnly, [XNAS_PRE]);
  const regularOnly = getSessionsForExchange(SESSIONS, "XNAS", "regular");
  assert.deepEqual(regularOnly, [XNAS_REGULAR]);
});

test("getSessionsForExchange returns an empty array, not null/undefined, for an unseeded exchange", () => {
  assert.deepEqual(getSessionsForExchange(SESSIONS, "ATLANTIS"), []);
});

const THANKSGIVING: Holiday = { exchangeMic: "XNYS", holidayDate: "2026-11-26", name: "Thanksgiving Day", status: "closed", earlyCloseTime: null };
const DAY_AFTER_THANKSGIVING: Holiday = { exchangeMic: "XNYS", holidayDate: "2026-11-27", name: "Day after Thanksgiving (early close)", status: "early_close", earlyCloseTime: "13:00" };
const HOLIDAYS = [THANKSGIVING, DAY_AFTER_THANKSGIVING];

test("findHolidayOn resolves an exact (exchange, date) match and returns null otherwise", () => {
  assert.equal(findHolidayOn(HOLIDAYS, "XNYS", "2026-11-26"), THANKSGIVING);
  assert.equal(findHolidayOn(HOLIDAYS, "XNYS", "2026-11-25"), null);
  assert.equal(findHolidayOn(HOLIDAYS, "XNAS", "2026-11-26"), null, "holiday rows are per-exchange, not shared across MICs");
});

test("isWeekend correctly classifies Saturday/Sunday vs weekdays, UTC-anchored", () => {
  assert.equal(isWeekend("2026-09-12"), true, "Saturday");
  assert.equal(isWeekend("2026-09-13"), true, "Sunday");
  assert.equal(isWeekend("2026-09-14"), false, "Monday");
  assert.equal(isWeekend("2026-09-18"), false, "Friday");
});

test("classifyTradingDay returns trading for an ordinary weekday with no holiday", () => {
  assert.deepEqual(classifyTradingDay(HOLIDAYS, "XNYS", "2026-11-24"), { kind: "trading" });
});

test("classifyTradingDay returns weekend for a Saturday/Sunday with no holiday row", () => {
  assert.deepEqual(classifyTradingDay(HOLIDAYS, "XNYS", "2026-09-12"), { kind: "weekend" });
});

test("classifyTradingDay returns holiday for a full closure", () => {
  assert.deepEqual(classifyTradingDay(HOLIDAYS, "XNYS", "2026-11-26"), { kind: "holiday", holiday: THANKSGIVING });
});

test("classifyTradingDay returns early_close, distinct from holiday, for a partial trading day", () => {
  assert.deepEqual(classifyTradingDay(HOLIDAYS, "XNYS", "2026-11-27"), { kind: "early_close", holiday: DAY_AFTER_THANKSGIVING });
});

test("classifyTradingDay prefers a recorded holiday even when the same date would otherwise classify as a weekday", () => {
  // 2026-11-26 is a Thursday -- proves the holiday branch is checked
  // first rather than only ever firing on a weekend coincidence.
  const result = classifyTradingDay(HOLIDAYS, "XNYS", "2026-11-26");
  assert.equal(result.kind, "holiday");
});
