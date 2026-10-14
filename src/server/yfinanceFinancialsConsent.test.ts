import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-yfinance-consent-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb } = await import("./db");
const { upsertCompany, persistFinancialStatementPeriods } = await import("./companyStore");
const { runWithRequestIdentity } = await import("./requestContext");
const { getYfinanceFinancialReports } = await import("./yfinanceFinancials");

test("revoked Yahoo consent blocks previously persisted yfinance statements", async (t) => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  });

  const symbol = "ZZYFCONSENT";
  const companyId = await upsertCompany({ symbol, name: symbol });
  await persistFinancialStatementPeriods(companyId, [{
    reportType: "income",
    periodEnd: "2025-12-31",
    fiscalYear: "2025",
    period: "FY",
    reportedCurrency: "USD",
    data: { revenue: 123 },
    filingDate: null,
    source: "yfinance",
  }]);

  const reports = await runWithRequestIdentity({
    userId: 41,
    organizationId: null,
    selectedConnectorIds: ["yahoo_finance"],
    communityYahooConsent: false,
  }, () => getYfinanceFinancialReports(symbol, "income", "FY"));

  assert.deepEqual(reports, []);
});


test("Yahoo consent alone does not enable yfinance statements when Yahoo is not selected", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  try {
    const reports = await runWithRequestIdentity({
      userId: 42,
      organizationId: null,
      selectedConnectorIds: ["stooq"],
      communityYahooConsent: true,
      publicFillerConsent: true,
    }, () => getYfinanceFinancialReports("ZZYFCONSENT", "income", "FY"));

    assert.deepEqual(reports, []);
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});
