import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFinancialStatementPeriod,
  resolveFinancialStatementReports,
  statementReportData,
} from "@shared/financialStatementResolver";
import {
  buildFinancialAnalysis,
  getMetricValue,
  mergeFinancialStatementReports,
  type RawStatementReport,
} from "@shared/financialAnalysis";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";

test("normalizes equivalent fiscal-period spellings and lets imported values win", () => {
  assert.equal(normalizeFinancialStatementPeriod("FY2025"), "2025 FY");
  assert.equal(normalizeFinancialStatementPeriod("Q1 2025"), "2025 Q1");

  const provider: RawStatementReport = {
    fiscal_year: "2025",
    period: "FY",
    date: "2025-12-31",
    reported_currency: "USD",
    data_source: "Provider filing",
    data: JSON.stringify({ revenue: 100, grossProfit: 40 }),
  };
  const imported: FinancialMetricObservation = {
    metricId: "revenue",
    value: 120,
    status: "imported",
    period: "FY2025",
    asOf: "2026-01-15",
    source: "uploaded-workbook",
    currency: "USD",
  };

  const [resolved] = resolveFinancialStatementReports("income", [provider], [imported]);
  assert.equal(statementReportData(resolved).revenue, 120);
  assert.equal(resolved.normalized.fieldSources.revenue.unit, "currency");
  assert.equal(resolved.normalized.fieldSources.revenue.source, "uploaded-workbook");
  assert.ok(resolved.normalized.importedFields.includes("revenue"));
  assert.ok(resolved.normalized.conflictFields.includes("revenue"));
});

test("materializes an imported-only period and makes missing fields explicit", () => {
  const imported: FinancialMetricObservation = {
    metricId: "cfo",
    value: 80,
    status: "imported",
    period: "2024",
    asOf: "2025-02-01",
    source: "uploaded-csv",
    currency: "EUR",
  };

  const [resolved] = resolveFinancialStatementReports("cashflow", [], [imported]);
  assert.equal(resolved.fiscal_year, "2024");
  assert.equal(resolved.period, "FY");
  assert.equal(statementReportData(resolved).netCashProvidedByOperatingActivities, 80);
  assert.ok(resolved.normalized.importedFields.includes("netCashProvidedByOperatingActivities"));
  assert.ok(resolved.normalized.missingFields.includes("freeCashFlow"));
});

test("does not materialize imported rows outside the requested period", () => {
  const observations: FinancialMetricObservation[] = [
    { metricId: "cfo", value: 80, status: "imported", period: "2024 FY", source: "uploaded-workbook" },
    { metricId: "cfo", value: 20, status: "imported", period: "2024 Q1", source: "uploaded-workbook" },
  ];

  const reports = resolveFinancialStatementReports("cashflow", [], observations, undefined, "Q1");

  assert.deepEqual(reports.map(report => report.normalized.period), ["2024 Q1"]);
  assert.equal(statementReportData(reports[0]).netCashProvidedByOperatingActivities, 20);
});

test("normalized statement values flow into downstream ratio analysis", () => {
  const income: RawStatementReport[] = [{
    fiscal_year: "2025",
    period: "FY",
    date: "2025-12-31",
    reported_currency: "USD",
    data: JSON.stringify({ revenue: 200, grossProfit: 100, operatingIncome: 50, netIncome: 40 }),
  }];
  const balance: RawStatementReport[] = [{
    fiscal_year: "2025",
    period: "FY",
    date: "2025-12-31",
    reported_currency: "USD",
    data: JSON.stringify({ totalAssets: 500, totalStockholdersEquity: 300, shortTermDebt: 50, longTermDebt: 50, cashAndCashEquivalents: 25 }),
  }];
  const cashflow: RawStatementReport[] = [{
    fiscal_year: "2025",
    period: "FY",
    date: "2025-12-31",
    reported_currency: "USD",
    data: JSON.stringify({ netCashProvidedByOperatingActivities: 80, capitalExpenditure: -30 }),
  }];
  const overrides: FinancialMetricObservation[] = [
    { metricId: "revenue", value: 250, status: "imported", period: "2025 FY", source: "mapped-xlsx" },
    { metricId: "fcf", value: 110, status: "imported", period: "2025 FY", source: "mapped-xlsx" },
  ];

  const merged = mergeFinancialStatementReports({
    income: resolveFinancialStatementReports("income", income, overrides),
    balance: resolveFinancialStatementReports("balance", balance, overrides),
    cashflow: resolveFinancialStatementReports("cashflow", cashflow, overrides),
  });
  const [latest] = buildFinancialAnalysis(merged);

  assert.equal(getMetricValue(latest.metrics, "grossMargin"), 0.4);
  assert.equal(getMetricValue(latest.metrics, "fcf"), 110);
});
