import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same LIMURIA_DATA_DIR-before-./db-import ordering requirement as
// currencyMasterStore.test.ts -- see billingSubscriptionProjection.test.ts
// for the full rationale.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-trading-calendar-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const {
  listExchangeSessions,
  resolveHolidayOn,
  resolveTradingDayClassification,
  listExchangeHolidays,
  resetTradingCalendarCache,
} = await import("./tradingCalendarStore");
const { exchangeTradingSessions } = await import("@shared/schema");

test("tradingCalendarStore", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("listExchangeSessions returns NYSE's three seeded sessions in a stable shape", async () => {
    const sessions = await listExchangeSessions("XNYS");
    assert.equal(sessions.length, 3);
    const regular = sessions.find((s) => s.sessionType === "regular");
    assert.deepEqual(regular && { startTime: regular.startTime, endTime: regular.endTime }, { startTime: "09:30", endTime: "16:00" });
  });

  await t.test("listExchangeSessions returns a split session ordered morning-then-afternoon for Tokyo", async () => {
    const sessions = await listExchangeSessions("XTKS", "regular");
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((s) => [s.sequence, s.startTime, s.endTime]), [
      [0, "09:00", "11:30"],
      [1, "12:30", "15:30"],
    ]);
  });

  await t.test("listExchangeSessions returns an empty array for an exchange with no seeded sessions", async () => {
    assert.deepEqual(await listExchangeSessions("XBOM", "pre_market"), []);
  });

  await t.test("resolveHolidayOn resolves the seeded 2026 NYSE Thanksgiving closure and early-close day", async () => {
    const thanksgiving = await resolveHolidayOn("XNYS", "2026-11-26");
    assert.equal(thanksgiving?.status, "closed");
    assert.equal(thanksgiving?.earlyCloseTime, null);

    const dayAfter = await resolveHolidayOn("XNYS", "2026-11-27");
    assert.equal(dayAfter?.status, "early_close");
    assert.equal(dayAfter?.earlyCloseTime, "13:00");
  });

  await t.test("resolveHolidayOn returns null for an ordinary trading day and resolves a verified non-US holiday", async () => {
    assert.equal(await resolveHolidayOn("XNYS", "2026-11-24"), null);
    const lseChristmas = await resolveHolidayOn("XLON", "2026-12-25");
    assert.equal(lseChristmas?.status, "closed");
    assert.equal(lseChristmas?.name, "Christmas Day");
  });

  await t.test("resolveTradingDayClassification composes the holiday and weekend checks end-to-end", async () => {
    assert.deepEqual(await resolveTradingDayClassification("XNYS", "2026-11-24"), { kind: "trading" });
    assert.deepEqual(await resolveTradingDayClassification("XNYS", "2026-09-12"), { kind: "weekend" });
    const holidayResult = await resolveTradingDayClassification("XNYS", "2026-12-25");
    assert.equal(holidayResult.kind, "holiday");
  });

  await t.test("listExchangeHolidays filters to a given exchange and optional year, returning all 12 seeded 2026 NYSE holidays", async () => {
    const all2026 = await listExchangeHolidays("XNYS", "2026");
    assert.equal(all2026.length, 12);
    const otherYear = await listExchangeHolidays("XNYS", "2027");
    assert.deepEqual(otherYear, []);
  });

  await t.test("resetTradingCalendarCache makes a newly inserted session visible on the next read", async () => {
    assert.deepEqual(await listExchangeSessions("XPAR", "pre_market"), []);
    await getDb().insert(exchangeTradingSessions).values({
      exchangeMic: "XPAR", sessionType: "pre_market", sequence: 0, startTime: "07:15", endTime: "09:00", source: "test",
    });
    assert.deepEqual(await listExchangeSessions("XPAR", "pre_market"), [], "cache not yet invalidated");
    resetTradingCalendarCache();
    const sessions = await listExchangeSessions("XPAR", "pre_market");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].startTime, "07:15");
  });
});
