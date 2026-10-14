import { resolvePersistedExchange } from "./globalMarketMasterStore";
import { listExchangeHolidays, listExchangeSessions } from "./tradingCalendarStore";
import { resolveMarketStatus, type MarketClockExchange, type MarketStatusSnapshot } from "@shared/marketStatus";

function inferHolidayCoverage(holidays: readonly { holidayDate: string }[]): { startDate: string; endDate: string } | null {
  if (holidays.length === 0) return null;
  const years = holidays.map((holiday) => holiday.holidayDate.slice(0, 4)).sort();
  return { startDate: `${years[0]}-01-01`, endDate: `${years.at(-1)}-12-31` };
}

/**
 * Resolves one exchange's current/historical market state from its
 * persisted MIC, timezone, sessions, and holiday calendar. Unknown MICs
 * return null; an exchange outside the verified holiday coverage window
 * returns an explicit `unknown` snapshot rather than a US-default guess.
 */
export async function getPersistedMarketStatus(mic: string, now = new Date()): Promise<MarketStatusSnapshot | null> {
  const exchange = await resolvePersistedExchange(mic);
  if (!exchange) return null;

  const [sessions, holidays] = await Promise.all([
    listExchangeSessions(exchange.mic),
    listExchangeHolidays(exchange.mic),
  ]);
  const holidayCoverage = inferHolidayCoverage(holidays);
  if (!holidayCoverage) {
    return {
      exchangeMic: exchange.mic,
      timezone: exchange.timezone,
      status: "unknown",
      reason: "calendar_unavailable",
      sessionType: null,
      localDate: new Intl.DateTimeFormat("en-CA", { timeZone: exchange.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
      localTime: new Intl.DateTimeFormat("en-GB", { timeZone: exchange.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now),
      nextTransition: null,
      nextTransitionAt: null,
    };
  }

  const input: MarketClockExchange = {
    mic: exchange.mic,
    timezone: exchange.timezone,
    sessions,
    holidays,
    holidayCoverage,
  };
  return resolveMarketStatus(input, now);
}
