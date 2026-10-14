/**
 * LiOS V4 Trading Calendar contracts (LV4-05-03).
 *
 * Sessions and holidays for the exchanges seeded in globalMarketMaster.ts
 * (LV4-04-03/04). Answers "what are this exchange's sessions" and "is this
 * date a trading day for this exchange" -- deliberately NOT "is the market
 * open right now" (that needs the current instant, timezone conversion,
 * and same-day session-window logic, which is LV4-05-04's market-status
 * service, built on top of this).
 */
import type { ExchangeHoliday, ExchangeTradingSession } from "./schema";

export type TradingSession = Pick<ExchangeTradingSession, "exchangeMic" | "sessionType" | "sequence" | "startTime" | "endTime">;
export type Holiday = Pick<ExchangeHoliday, "exchangeMic" | "holidayDate" | "name" | "status" | "earlyCloseTime">;

/**
 * Returns an exchange's sessions, optionally filtered to one sessionType,
 * ordered by sequence -- so a split session (Tokyo, Hong Kong, Shanghai,
 * Shenzhen, Singapore all close for a midday break) comes back
 * morning-then-afternoon rather than in insertion order.
 */
const SESSION_TYPE_ORDER: Record<TradingSession["sessionType"], number> = {
  pre_market: 0,
  regular: 1,
  post_market: 2,
};

export function getSessionsForExchange(
  sessions: readonly TradingSession[],
  exchangeMic: string,
  sessionType?: TradingSession["sessionType"],
): TradingSession[] {
  return sessions
    .filter((session) => session.exchangeMic === exchangeMic && (sessionType === undefined || session.sessionType === sessionType))
    .sort((a, b) => SESSION_TYPE_ORDER[a.sessionType] - SESSION_TYPE_ORDER[b.sessionType] || a.sequence - b.sequence || a.startTime.localeCompare(b.startTime));
}

/** Exact-date holiday lookup. Returns null, never a guess, when this
 * exchange has no holiday recorded for that date -- absence of a row is
 * not the same fact as "confirmed open," see classifyTradingDay below. */
export function findHolidayOn(holidays: readonly Holiday[], exchangeMic: string, date: string): Holiday | null {
  return holidays.find((holiday) => holiday.exchangeMic === exchangeMic && holiday.holidayDate === date) ?? null;
}

/** True for Saturday/Sunday in the date's own calendar (UTC-anchored
 * parsing, so this doesn't depend on the server process's local
 * timezone). Every exchange currently seeded trades Monday-Friday; a
 * future Sun-Thu market (common in parts of the Middle East) would need
 * its own trading-day rule rather than reusing this helper. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export type TradingDayClassification =
  | { kind: "trading" }
  | { kind: "early_close"; holiday: Holiday }
  | { kind: "holiday"; holiday: Holiday }
  | { kind: "weekend" };

/**
 * Classifies a single calendar date for one exchange. A recorded holiday
 * takes precedence over the weekend check (though in practice a holiday
 * that would fall on a weekend is typically not separately recorded --
 * NYSE's own 2026 schedule already shifts New Year's Day off a Saturday
 * rather than listing both) -- never conflates "no holiday row found"
 * with "confirmed open"; absence of holiday data for an exchange this
 * table hasn't been populated for yet still classifies correctly as
 * weekend/trading based on the date alone, but callers should not treat
 * `{kind: "trading"}` as proof a holiday calendar was actually checked
 * unless they know this exchange's holidays are seeded.
 */
export function classifyTradingDay(holidays: readonly Holiday[], exchangeMic: string, date: string): TradingDayClassification {
  const holiday = findHolidayOn(holidays, exchangeMic, date);
  if (holiday) {
    return holiday.status === "early_close" ? { kind: "early_close", holiday } : { kind: "holiday", holiday };
  }
  if (isWeekend(date)) return { kind: "weekend" };
  return { kind: "trading" };
}
