import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialReportsResult, FinancialReportRow } from "./financialDataProviders";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import { buildFinancialDatasetPayload, compareFinancialDatasetPayloads, stableSnapshotHash } from "./pointInTimeDatasetStore";

function result(statementType: "income" | "balance" | "cashflow", values: Record<string, number>, filingDate = "2024-02-15"): FinancialReportsResult {
  const row = {
    symbol: "TEST", report_type: statementType, date: "2023-12-31", fiscal_year: "2023", period: "FY",
    reported_currency: "USD", data: JSON.stringify(values), filing_date: filingDate, data_source: "fixture",
    status: { provider: "fixture", freshness: "feed", asOf: filingDate, delayLabel: "fixture", isFallback: false },
  } satisfies FinancialReportRow;
  return { reports: [row], provider: "fixture", attemptedProviders: ["fixture"], failures: [] };
}

test("financial dataset normalization combines statement rows and preserves filing availability", () => {
  const normalized = buildFinancialDatasetPayload("test", {
    income: result("income", { revenue: 1000, costOfRevenue: 600, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112 }, "2024-02-10"),
    balance: result("balance", { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 }, "2024-02-15"),
    cashflow: result("cashflow", { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 }, "2024-02-12"),
  }, "2024-03-01T10:00:00.000Z");
  assert.equal(normalized.payload.symbol, "TEST");
  assert.equal(normalized.payload.periods.length, 1);
  assert.equal(normalized.payload.periods[0].availableAt, "2024-02-15T00:00:00.000Z");
  assert.equal(normalized.payload.periods[0].income.revenue, 1000);
  assert.equal(normalized.quality.score, 1);
  assert.deepEqual(normalized.quality.missingCriticalFields, []);
  assert.deepEqual(Object.keys(normalized.lineage).sort(), ["balance", "cashflow", "income", "segmentation"]);
});

test("financial dataset normalization tolerates non-canonical provider metadata fields", () => {
  // Real LSE-sourced payloads carry derived fields like `cik`/`acceptedDate`
  // alongside the actual financial figures (see financialStatementsBroker.ts's
  // diffReports comment) -- capture must not fail the whole snapshot just
  // because a provider attached metadata parseReportData doesn't recognize.
  const normalized = buildFinancialDatasetPayload("test", {
    income: result("income", { revenue: 1000, costOfRevenue: 600, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, cik: 320193, acceptedDate: 20241101 }, "2024-02-10"),
    balance: result("balance", { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 }, "2024-02-15"),
    cashflow: result("cashflow", { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 }, "2024-02-12"),
  }, "2024-03-01T10:00:00.000Z");
  assert.equal(normalized.quality.score, 1);
  assert.deepEqual(normalized.quality.missingCriticalFields, []);
  assert.equal(normalized.payload.periods[0].income.revenue, 1000);
  assert.equal((normalized.payload.periods[0].income as Record<string, unknown>).cik, undefined);
  assert.equal((normalized.payload.periods[0].income as Record<string, unknown>).acceptedDate, undefined);
});

test("financial dataset quality reports missing critical fields without inventing values", () => {
  const normalized = buildFinancialDatasetPayload("TEST", {
    income: result("income", { revenue: 1000 }),
    balance: result("balance", { totalAssets: 800 }),
    cashflow: result("cashflow", {}),
  }, "2024-03-01T10:00:00.000Z");
  assert.ok(normalized.quality.score < 0.2);
  assert.ok(normalized.quality.missingCriticalFields.includes("income.netIncome"));
  assert.ok(normalized.quality.missingCriticalFields.includes("cashflow.depreciationAndAmortization"));
  assert.equal(normalized.payload.periods[0].income.netIncome, undefined);
});

test("snapshot fingerprints are stable across object key order and change with content", () => {
  const left = stableSnapshotHash({ b: 2, a: { d: 4, c: 3 } });
  const right = stableSnapshotHash({ a: { c: 3, d: 4 }, b: 2 });
  assert.equal(left, right);
  assert.notEqual(left, stableSnapshotHash({ a: { c: 3, d: 5 }, b: 2 }));
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("restatement comparison isolates field revisions and materiality", () => {
  const before = buildFinancialDatasetPayload("TEST", {
    income: result("income", { revenue: 1000, costOfRevenue: 600, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112 }),
    balance: result("balance", { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 }),
    cashflow: result("cashflow", { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 }),
  }, "2024-03-01T00:00:00.000Z").payload;
  const after = structuredClone(before);
  after.periods[0].income.revenue = 1020;
  after.periods[0].income.netIncome = 112.5;
  const report = compareFinancialDatasetPayloads(before, after, "new", "old");
  assert.equal(report.status, "revised");
  assert.equal(report.changedFields, 2);
  assert.equal(report.materialChanges, 1);
  assert.equal(report.revisions.find((revision) => revision.field === "revenue")?.percentChange, 0.02);
});

test("financial payload rejects non-canonical statement fields", () => {
  assert.throws(() => financialDatasetPayloadSchema.parse({
    symbol: "TEST",
    periods: [{
      fiscalYear: "2023",
      period: "FY",
      periodEnd: "2023-12-31",
      filingDate: "2024-02-15",
      availableAt: "2024-02-15T00:00:00.000Z",
      currency: "USD",
      income: { revenue: 1000, totalEquity: 500 },
      balance: {},
      cashflow: {},
      segments: {},
      geographies: {},
      sources: [{ statementType: "income", provider: "fixture" }],
    }],
  }), /canonical/i);
});

test("financial payload rejects placeholder currencies", () => {
  assert.throws(() => financialDatasetPayloadSchema.parse({
    symbol: "TEST",
    periods: [{
      fiscalYear: "2023",
      period: "FY",
      periodEnd: "2023-12-31",
      filingDate: "2024-02-15",
      availableAt: "2024-02-15T00:00:00.000Z",
      currency: "UNKNOWN",
      income: {},
      balance: {},
      cashflow: {},
      segments: {},
      geographies: {},
      sources: [{ statementType: "income", provider: "fixture" }],
    }],
  }), /currency/i);
});

test("duplicate statement periods resolve deterministically and retain row provenance", () => {
  const first = result("income", { revenue: 1000 }, "2024-02-10").reports[0];
  const restated = {
    ...first,
    filing_date: "2024-03-01",
    data: JSON.stringify({ revenue: 1100 }),
    data_source: "restated-fixture",
    status: { ...first.status, provider: "restated-fixture" },
  } satisfies FinancialReportRow;
  const aggregate: FinancialReportsResult = {
    reports: [first, restated],
    provider: "aggregate",
    attemptedProviders: ["fixture", "restated-fixture"],
    failures: [],
  };
  const input = {
    income: aggregate,
    balance: result("balance", {}),
    cashflow: result("cashflow", {}),
  };
  const normalized = buildFinancialDatasetPayload("TEST", input, "2024-04-01T00:00:00.000Z");
  const reversed = buildFinancialDatasetPayload("TEST", {
    ...input,
    income: { ...aggregate, reports: [...aggregate.reports].reverse() },
  }, "2024-04-01T00:00:00.000Z");
  assert.equal(normalized.payload.periods[0].income.revenue, 1100);
  assert.deepEqual(normalized.payload, reversed.payload);
  assert.deepEqual(normalized.payload.periods[0].sources.filter((source) => source.statementType === "income").map((source) => source.provider).sort(), ["fixture", "restated-fixture"]);
  assert.ok(normalized.quality.warnings.some((warning) => /duplicate/i.test(warning)));
});
