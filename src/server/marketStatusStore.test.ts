import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-market-status-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { getPersistedMarketStatus } = await import("./marketStatusStore");
const { resetGlobalMarketMasterCache } = await import("./globalMarketMasterStore");
const { resetTradingCalendarCache } = await import("./tradingCalendarStore");
const { exchanges, exchangeTradingSessions } = await import("@shared/schema");
test("marketStatusStore", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("resolves a persisted exchange status from its own timezone, sessions, and holiday rows", async () => {
    const status = await getPersistedMarketStatus("XNYS", new Date("2026-03-16T13:31:00.000Z"));
    assert.equal(status?.status, "open");
    assert.equal(status?.sessionType, "regular");
    assert.equal(status?.localTime, "09:31");
  });

  await t.test("returns an explicit unknown result outside the verified holiday coverage window", async () => {
    const status = await getPersistedMarketStatus("XNYS", new Date("2027-01-04T14:00:00.000Z"));
    assert.equal(status?.status, "unknown");
    assert.equal(status?.reason, "calendar_unavailable");
  });

  await t.test("returns null for an unknown exchange MIC instead of applying a US default", async () => {
    assert.equal(await getPersistedMarketStatus("ZZZZ", new Date("2026-03-16T13:31:00.000Z")), null);
  });

  await t.test("fails closed to unknown when an exchange has no holiday rows", async () => {
    await getDb().insert(exchanges).values({
      mic: "XZZZ",
      name: "Market Status Test Exchange",
      countryCode: "US",
      currencyCode: "USD",
      timezone: "America/New_York",
    });
    await getDb().insert(exchangeTradingSessions).values({
      exchangeMic: "XZZZ",
      sessionType: "regular",
      sequence: 0,
      startTime: "09:30",
      endTime: "16:00",
      source: "test",
    });
    resetGlobalMarketMasterCache();
    resetTradingCalendarCache();

    const status = await getPersistedMarketStatus("XZZZ", new Date("2026-03-16T13:31:00.000Z"));
    assert.equal(status?.status, "unknown");
    assert.equal(status?.reason, "calendar_unavailable");
  });

  await t.test("resolves a persisted split-session exchange in its own timezone", async () => {
    const status = await getPersistedMarketStatus("XTKS", new Date("2026-09-14T03:00:00.000Z"));
    assert.equal(status?.status, "upcoming");
    assert.equal(status?.reason, "session_break");
    assert.equal(status?.sessionType, "regular");
    assert.equal(status?.nextTransitionAt, "2026-09-14T03:30:00.000Z");
  });
});
