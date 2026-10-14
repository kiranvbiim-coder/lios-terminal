import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarketStatus, type MarketClockExchange } from "./marketStatus";

const NYSE: MarketClockExchange = {
  mic: "XNYS",
  timezone: "America/New_York",
  sessions: [
    { exchangeMic: "XNYS", sessionType: "pre_market", sequence: 0, startTime: "04:00", endTime: "09:30" },
    { exchangeMic: "XNYS", sessionType: "regular", sequence: 0, startTime: "09:30", endTime: "16:00" },
    { exchangeMic: "XNYS", sessionType: "post_market", sequence: 0, startTime: "16:00", endTime: "20:00" },
  ],
  holidays: [
    { exchangeMic: "XNYS", holidayDate: "2026-11-26", name: "Thanksgiving Day", status: "closed", earlyCloseTime: null },
    { exchangeMic: "XNYS", holidayDate: "2026-11-27", name: "Day after Thanksgiving", status: "early_close", earlyCloseTime: "13:00" },
  ],
  holidayCoverage: { startDate: "2026-01-01", endDate: "2026-12-31" },
};

const TOKYO: MarketClockExchange = {
  mic: "XTKS",
  timezone: "Asia/Tokyo",
  sessions: [
    { exchangeMic: "XTKS", sessionType: "regular", sequence: 0, startTime: "09:00", endTime: "11:30" },
    { exchangeMic: "XTKS", sessionType: "regular", sequence: 1, startTime: "12:30", endTime: "15:30" },
  ],
  holidays: [],
  holidayCoverage: { startDate: "2026-01-01", endDate: "2026-12-31" },
};

test("resolveMarketStatus uses exchange timezone and regular session windows", () => {
  const status = resolveMarketStatus(NYSE, new Date("2026-03-16T13:31:00.000Z"));
  assert.equal(status.status, "open");
  assert.equal(status.sessionType, "regular");
  assert.equal(status.localDate, "2026-03-16");
  assert.equal(status.localTime, "09:31");
  assert.equal(status.timezone, "America/New_York");
});

test("resolveMarketStatus handles daylight-saving offset changes without hardcoded New York offsets", () => {
  const winter = resolveMarketStatus(NYSE, new Date("2026-01-12T14:31:00.000Z"));
  const summer = resolveMarketStatus(NYSE, new Date("2026-07-13T13:31:00.000Z"));
  assert.equal(winter.status, "open");
  assert.equal(winter.localTime, "09:31");
  assert.equal(summer.status, "open");
  assert.equal(summer.localTime, "09:31");
});

test("resolveMarketStatus is deterministic when persisted session rows arrive out of order", () => {
  const reversed = { ...NYSE, sessions: [...NYSE.sessions].reverse() };
  const status = resolveMarketStatus(reversed, new Date("2026-03-16T13:31:00.000Z"));
  assert.equal(status.status, "open");
  assert.equal(status.sessionType, "regular");
});

test("resolveMarketStatus reports a split-session lunch break as upcoming with the next local session transition", () => {
  const status = resolveMarketStatus(TOKYO, new Date("2026-09-14T03:00:00.000Z"));
  assert.equal(status.status, "upcoming");
  assert.equal(status.reason, "session_break");
  assert.equal(status.sessionType, "regular");
  assert.equal(status.nextTransition, "open");
  assert.equal(status.nextTransitionAt, "2026-09-14T03:30:00.000Z");
});

test("resolveMarketStatus returns closed with holiday reason before considering sessions", () => {
  const status = resolveMarketStatus(NYSE, new Date("2026-11-26T14:00:00.000Z"));
  assert.equal(status.status, "closed");
  assert.equal(status.reason, "holiday");
  assert.equal(status.sessionType, null);
  assert.equal(status.nextTransition, null);
});

test("resolveMarketStatus shortens a regular session on an early-close holiday", () => {
  const status = resolveMarketStatus(NYSE, new Date("2026-11-27T18:00:00.000Z"));
  assert.equal(status.localTime, "13:00");
  assert.equal(status.status, "closed");
  assert.equal(status.reason, "early_close");
  assert.equal(status.nextTransition, null);
});

test("resolveMarketStatus reports weekends as closed and does not use US-specific weekday logic", () => {
  const status = resolveMarketStatus(TOKYO, new Date("2026-09-12T03:00:00.000Z"));
  assert.equal(status.status, "closed");
  assert.equal(status.reason, "weekend");
});

test("resolveMarketStatus returns unknown outside the verified holiday coverage window", () => {
  const status = resolveMarketStatus(NYSE, new Date("2027-01-04T14:00:00.000Z"));
  assert.equal(status.status, "unknown");
  assert.equal(status.reason, "calendar_unavailable");
  assert.equal(status.nextTransition, null);
});

test("resolveMarketStatus reports pre-market and post-market sessions distinctly", () => {
  const pre = resolveMarketStatus(NYSE, new Date("2026-03-16T12:00:00.000Z"));
  const post = resolveMarketStatus(NYSE, new Date("2026-03-16T20:30:00.000Z"));
  assert.deepEqual({ status: pre.status, sessionType: pre.sessionType }, { status: "open", sessionType: "pre_market" });
  assert.deepEqual({ status: post.status, sessionType: post.sessionType }, { status: "open", sessionType: "post_market" });
});
