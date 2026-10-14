import { exchangeHolidays, exchangeTradingSessions } from "@shared/schema";
import { classifyTradingDay, findHolidayOn, getSessionsForExchange, type Holiday, type TradingSession } from "@shared/tradingCalendar";
import { getDb } from "./db";

let cachedSessions: (typeof exchangeTradingSessions.$inferSelect)[] | null = null;
let cachedHolidays: (typeof exchangeHolidays.$inferSelect)[] | null = null;

/**
 * Sessions and holidays are reference data that changes by data-only
 * migration (new INSERT), not at request time -- same process-lifetime
 * cache rationale as globalMarketMasterStore.ts's countries/exchanges
 * cache. Tests that mutate either table directly should call
 * resetTradingCalendarCache().
 */
async function loadSessions() {
  if (!cachedSessions) cachedSessions = await getDb().select().from(exchangeTradingSessions);
  return cachedSessions;
}

async function loadHolidays() {
  if (!cachedHolidays) cachedHolidays = await getDb().select().from(exchangeHolidays);
  return cachedHolidays;
}

export function resetTradingCalendarCache(): void {
  cachedSessions = null;
  cachedHolidays = null;
}

export async function listExchangeSessions(exchangeMic: string, sessionType?: TradingSession["sessionType"]) {
  return getSessionsForExchange(await loadSessions(), exchangeMic, sessionType);
}

export async function resolveHolidayOn(exchangeMic: string, date: string): Promise<Holiday | null> {
  return findHolidayOn(await loadHolidays(), exchangeMic, date);
}

export async function resolveTradingDayClassification(exchangeMic: string, date: string) {
  return classifyTradingDay(await loadHolidays(), exchangeMic, date);
}

/** year is an optional "YYYY" prefix filter -- holidayDate is stored as
 * "YYYY-MM-DD" text, so a plain startsWith is exact and needs no parsing. */
export async function listExchangeHolidays(exchangeMic: string, year?: string) {
  const rows = await loadHolidays();
  return rows.filter((holiday) => holiday.exchangeMic === exchangeMic && (!year || holiday.holidayDate.startsWith(year)));
}
