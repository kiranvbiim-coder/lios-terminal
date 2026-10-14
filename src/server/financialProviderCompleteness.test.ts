import assert from "node:assert/strict";
import test from "node:test";
import { boundFinancialPeriodEnds } from "./secEdgarFinancials";
import { selectFinnhubEntries, type FinnhubReportEntry } from "./finnhubFinancials";
import { buildFinancialDatasetPayload } from "./pointInTimeDatasetStore";
import { extractYfinanceFundamentals, YFINANCE_FUNDAMENTAL_FIELD_REGISTRY } from "./yfinanceFinancials";
import { CASHFLOW_MAP } from "./simfinFinancials";
import type { FinancialReportsResult } from "./financialDataProviders";
import { boundFmpQuery } from "./fmpData";
import { attachFinancialFieldProvenance, type FinancialDataProvider } from "./financialDataProviders";

test("SEC period depth removes the old ten-period ceiling but remains bounded and paginable", () => {
  const dates = Array.from({ length: 25 }, (_, index) => `20${String(index + 1).padStart(2, "0")}-12-31`);
  assert.equal(boundFinancialPeriodEnds(dates).length, 25);
  assert.deepEqual(boundFinancialPeriodEnds(dates, { limit: 3, offset: 2 }), ["2023-12-31", "2022-12-31", "2021-12-31"]);
  assert.equal(boundFinancialPeriodEnds(Array.from({ length: 101 }, (_, index) => `19${String(index).padStart(2, "0")}-12-31`)).length, 100);
});

test("FMP dataset requests expose safe page and limit bounds", () => {
  assert.deepEqual(boundFmpQuery({ limit: 500, page: -3 }), { limit: 100, page: 0 });
  assert.deepEqual(boundFmpQuery({ limit: 0.8, page: 2.9 }), { limit: 1, page: 2 });
});

function entry(endDate: string, quarter: number, form: string): FinnhubReportEntry {
  return { year: Number(endDate.slice(0, 4)), quarter, form, startDate: `${endDate.slice(0, 4)}-01-01`, endDate, filedDate: endDate, report: { bs: [], ic: [], cf: [] } };
}

test("Finnhub quarterly selection requests only filed standalone Q1-Q3 periods", () => {
  const rows = [entry("2025-12-31", 4, "10-K"), entry("2025-09-30", 3, "10-Q"), entry("2025-06-30", 2, "10-Q"), entry("2025-03-31", 1, "10-Q")];
  assert.deepEqual(selectFinnhubEntries(rows, "Q2").map((row) => row.endDate), ["2025-06-30"]);
  assert.deepEqual(selectFinnhubEntries(rows, "Q4"), []);
});

test("yfinance fundamentals registry preserves nulls and quarantines unknown keys", () => {
  const snapshot = extractYfinanceFundamentals({ enterpriseValue: 100, grossMargins: 0.4, futureUndocumentedMetric: 7 }, { retrievedAt: "2026-08-31T00:00:00.000Z" });
  assert.equal(YFINANCE_FUNDAMENTAL_FIELD_REGISTRY.length >= 30, true);
  assert.equal(snapshot.fields.enterpriseValue, 100);
  assert.equal(snapshot.fields.enterpriseToRevenue, null);
  assert.equal(snapshot.fields.grossMargins, 0.4);
  assert.equal(snapshot.rawExtended.futureUndocumentedMetric, 7);
  assert.equal(snapshot.source.provider, "yfinance");
});

test("SimFin dividends use the canonical commonDividendsPaid field", () => {
  assert.equal(CASHFLOW_MAP.dividendsPaid, undefined);
  assert.equal(CASHFLOW_MAP.commonDividendsPaid, "Dividends Paid");
});

test("financial waterfall field provenance preserves provider, as-of, and freshness", () => {
  const provider: FinancialDataProvider = { id: "sec_edgar", label: "SEC EDGAR", getReports: async () => [] };
  const row = attachFinancialFieldProvenance(provider, {
    symbol: "AAPL", report_type: "income", date: "2025-12-31", fiscal_year: "2025", period: "FY", reported_currency: "USD", filing_date: "2026-02-01", data: JSON.stringify({ revenue: 10, netIncome: null }),
  }, true);
  assert.equal(row.data_source, "SEC EDGAR");
  assert.equal(row.field_provenance?.revenue.provider, "SEC EDGAR");
  assert.equal(row.field_provenance?.revenue.asOf, "2026-02-01");
  assert.equal(row.field_provenance?.revenue.sourceReference, "https://data.sec.gov/api/xbrl/companyfacts");
  assert.equal(row.field_provenance?.netIncome, undefined);
  assert.equal(row.status.isFallback, true);
});

test("financial snapshot contract preserves provider-backed product and geography segments", () => {
  const report = (reportType: "income" | "balance" | "cashflow", data: Record<string, number>) => ({
    symbol: "TEST", report_type: reportType, date: "2025-12-31", fiscal_year: "2025", period: "FY",
    reported_currency: "USD", filing_date: "2026-02-01", data: JSON.stringify(data),
    data_source: "SEC EDGAR", status: { provider: "SEC EDGAR", freshness: "feed" as const, asOf: "2026-02-01", delayLabel: "filed", isFallback: false },
  });
  const result = (statementType: "income" | "balance" | "cashflow", data: Record<string, number>): FinancialReportsResult => ({
    reports: [report(statementType, data)], provider: "sec_edgar", attemptedProviders: ["sec_edgar"], failures: [],
  });
  const normalized = buildFinancialDatasetPayload("TEST", {
    income: result("income", { revenue: 100, costOfRevenue: 50, incomeBeforeTax: 20, incomeTaxExpense: 4, netIncome: 16 }),
    balance: result("balance", { cashAndCashEquivalents: 10, netReceivables: 10, inventory: 10, propertyPlantEquipmentNet: 10, accountPayables: 5, totalAssets: 40, totalLiabilities: 15, totalStockholdersEquity: 25 }),
    cashflow: result("cashflow", { depreciationAndAmortization: 3, investmentsInPropertyPlantAndEquipment: -4 }),
  }, "2026-03-01T00:00:00.000Z", {
    products: [{ symbol: "TEST", fiscalYear: 2025, period: "FY", reportedCurrency: "USD", date: "2025-12-31", data: { Cloud: 60 } }],
    geographies: [{ symbol: "TEST", fiscalYear: 2025, period: "FY", reportedCurrency: "USD", date: "2025-12-31", data: { US: 70 } }],
  });
  assert.deepEqual(normalized.payload.periods[0].segments, { Cloud: 60 });
  assert.deepEqual(normalized.payload.periods[0].geographies, { US: 70 });
  assert.equal(normalized.lineage.segmentation.provider, "FMP");
});
