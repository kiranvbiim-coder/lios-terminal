/**
 * LiOS V4 market-status resolver (LV4-05-04).
 *
 * Interprets the exchange-local sessions and holiday rows from the trading
 * calendar against an instant. No US-market constants: the exchange's
 * IANA timezone, session rows, and verified holiday coverage are the only
 * inputs. `unknown` is intentional outside the holiday coverage window;
 * declaring a market open without a verified holiday calendar is unsafe.
 */
import { classifyTradingDay, getSessionsForExchange, type Holiday, type TradingSession } from "./tradingCalendar";

export interface MarketClockExchange {
  mic: string;
  timezone: string;
  sessions: readonly TradingSession[];
  holidays: readonly Holiday[];
  holidayCoverage: { startDate: string; endDate: string };
}

export type MarketStatus = "open" | "closed" | "upcoming" | "unknown";
export type MarketStatusReason = "session" | "session_break" | "outside_session" | "early_close" | "holiday" | "weekend" | "calendar_unavailable";
export type MarketStatusTransition = "open" | "close" | null;

export interface MarketStatusSnapshot {
  exchangeMic: string;
  timezone: string;
  status: MarketStatus;
  reason: MarketStatusReason;
  sessionType: TradingSession["sessionType"] | null;
  localDate: string;
  localTime: string;
  nextTransition: MarketStatusTransition;
  nextTransitionAt: string | null;
}

interface LocalParts {
  date: string;
  time: string;
  minutes: number;
}

function parseParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    minutes: hour * 60 + minute,
  };
}

function parseClock(value: string): number {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) throw new RangeError(`Invalid exchange-local session time: ${value}`);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function inCoverage(exchange: MarketClockExchange, date: string): boolean {
  return date >= exchange.holidayCoverage.startDate && date <= exchange.holidayCoverage.endDate;
}

function zonedOffsetMinutes(instant: Date, timezone: string): number {
  const local = parseParts(instant, timezone);
  const localAsUtc = Date.UTC(
    Number(local.date.slice(0, 4)),
    Number(local.date.slice(5, 7)) - 1,
    Number(local.date.slice(8, 10)),
    Math.floor(local.minutes / 60),
    local.minutes % 60,
  );
  return (localAsUtc - instant.getTime()) / 60_000;
}

/** Converts an exchange-local date + wall-clock time to an instant, with a
 * second offset pass to remain correct across DST transition boundaries. */
function localTimeToInstant(date: string, time: string, timezone: string): Date {
  const guess = new Date(`${date}T${time}:00.000Z`);
  const firstOffset = zonedOffsetMinutes(guess, timezone);
  const first = new Date(guess.getTime() - firstOffset * 60_000);
  const secondOffset = zonedOffsetMinutes(first, timezone);
  return new Date(guess.getTime() - secondOffset * 60_000);
}

function makeSnapshot(
  exchange: MarketClockExchange,
  local: LocalParts,
  status: MarketStatus,
  reason: MarketStatusReason,
  sessionType: TradingSession["sessionType"] | null,
  nextTransition: MarketStatusTransition = null,
  nextTransitionAt: Date | null = null,
): MarketStatusSnapshot {
  return {
    exchangeMic: exchange.mic,
    timezone: exchange.timezone,
    localDate: local.date,
    localTime: local.time,
    status,
    reason,
    sessionType,
    nextTransition,
    nextTransitionAt: nextTransitionAt?.toISOString() ?? null,
  };
}

function sessionEnd(session: TradingSession, earlyCloseTime: string | null): number {
  const regularEnd = parseClock(session.endTime);
  if (session.sessionType !== "regular" || earlyCloseTime === null) return regularEnd;
  return Math.min(regularEnd, parseClock(earlyCloseTime));
}

/** Resolves the market state for one exchange at one instant. */
export function resolveMarketStatus(exchange: MarketClockExchange, now: Date): MarketStatusSnapshot {
  const local = parseParts(now, exchange.timezone);
  const base = {
    exchangeMic: exchange.mic,
    timezone: exchange.timezone,
    localDate: local.date,
    localTime: local.time,
  };
  if (!inCoverage(exchange, local.date)) {
    return { ...base, status: "unknown", reason: "calendar_unavailable", sessionType: null, nextTransition: null, nextTransitionAt: null };
  }

  const day = classifyTradingDay(exchange.holidays, exchange.mic, local.date);
  if (day.kind === "holiday") {
    return { ...base, status: "closed", reason: "holiday", sessionType: null, nextTransition: null, nextTransitionAt: null };
  }
  if (day.kind === "weekend") {
    return { ...base, status: "closed", reason: "weekend", sessionType: null, nextTransition: null, nextTransitionAt: null };
  }

  const earlyCloseTime = day.kind === "early_close" ? day.holiday.earlyCloseTime : null;
  const sessions = getSessionsForExchange(exchange.sessions, exchange.mic);
  const activeSessions = sessions.filter((session) => {
    if (day.kind === "early_close" && session.sessionType === "post_market") return false;
    return sessionEnd(session, earlyCloseTime) > parseClock(session.startTime);
  });

  for (const [index, session] of activeSessions.entries()) {
    const start = parseClock(session.startTime);
    const end = sessionEnd(session, earlyCloseTime);
    if (local.minutes >= start && local.minutes < end) {
      const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
      return makeSnapshot(exchange, local, "open", "session", session.sessionType, "close", localTimeToInstant(local.date, endTime, exchange.timezone));
    }
    if (local.minutes < start) {
      return makeSnapshot(exchange, local, "upcoming", index === 0 ? "outside_session" : "session_break", session.sessionType, "open", localTimeToInstant(local.date, session.startTime, exchange.timezone));
    }
  }

  return makeSnapshot(exchange, local, "closed", day.kind === "early_close" ? "early_close" : "outside_session", null);
}
