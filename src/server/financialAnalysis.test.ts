import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialAnalysis, getMetricValue, mergeFinancialStatementReports, summarizePeerMetric, type RawStatementReport } from "@shared/financialAnalysis";

test("financial analysis derives margins, returns, leverage and cash conversion from statements", () => {
  const [latest] = buildFinancialAnalysis([
    {
      fiscalYear: "2024",
      period: "FY",
      income: {
        revenue: 1200,
        grossProfit: 600,
        ebitda: 300,
        operatingIncome: 240,
        interestExpense: -40,
        netIncome: 150,
        costOfRevenue: 600,
      },
      balance: {
        cashAndCashEquivalents: 100,
        netReceivables: 100,
        inventory: 80,
        totalAssets: 1000,
        accountPayables: 70,
        shortTermDebt: 50,
        longTermDebt: 250,
        totalStockholdersEquity: 500,
      },
      cashflow: {
        netCashProvidedByOperatingActivities: 210,
        capitalExpenditure: -60,
      },
    },
    {
      fiscalYear: "2023",
      period: "FY",
      income: { revenue: 1000 },
      balance: {
        cashAndCashEquivalents: 80,
        netReceivables: 90,
        inventory: 70,
        totalAssets: 900,
        accountPayables: 60,
        shortTermDebt: 40,
        longTermDebt: 260,
        totalStockholdersEquity: 450,
      },
    },
  ]);

  assert.ok(latest);
  assert.equal(getMetricValue(latest.metrics, "revenueGrowth"), 0.2);
  assert.equal(getMetricValue(latest.metrics, "grossMargin"), 0.5);
  assert.equal(getMetricValue(latest.metrics, "netDebtToEbitda"), 2 / 3);
  assert.equal(getMetricValue(latest.metrics, "fcf"), 150);
  assert.equal(getMetricValue(latest.metrics, "fcfConversion"), 1);
  assert.equal(Number(getMetricValue(latest.metrics, "roic")?.toFixed(6)), 0.350365);
  assert.equal(Number(getMetricValue(latest.metrics, "cashConversionCycle")?.toFixed(2)), 34.98);
});

test("peer summary ranks target by metric direction and reports median discount", () => {
  const cheaperIsBetter = summarizePeerMetric([
    { symbol: "AAA", value: 10 },
    { symbol: "BBB", value: 20 },
    { symbol: "CCC", value: 30 },
  ], "AAA", false);

  assert.equal(cheaperIsBetter.median, 20);
  assert.equal(cheaperIsBetter.targetRank, 1);
  assert.equal(cheaperIsBetter.targetPercentile, 100);
  assert.equal(cheaperIsBetter.targetPremiumDiscountToMedian, -0.5);

  const higherIsBetter = summarizePeerMetric([
    { symbol: "AAA", value: 10 },
    { symbol: "BBB", value: 20 },
    { symbol: "CCC", value: 30 },
  ], "AAA", true);

  assert.equal(higherIsBetter.targetRank, 3);
  assert.equal(higherIsBetter.targetPercentile, 0);
});

test("mergeFinancialStatementReports sorts oldest-first provider rows into the newest-first order buildFinancialAnalysis requires", () => {
  // Real API responses list periods oldest-first (buildFinancialDatasetPayload
  // sorts by periodEnd ascending). Every caller (ValuationPanel,
  // CompanyFundamentalsPanel, FinancialStatementsPanel) feeds report rows in
  // that same order -- this must not silently hand buildFinancialAnalysis()
  // the oldest period as "index 0".
  const income: RawStatementReport[] = [
    { fiscal_year: "2018", period: "FY", date: "2018-09-29", reported_currency: "USD", data: JSON.stringify({ revenue: 265_595_000_000 }) },
    { fiscal_year: "2025", period: "FY", date: "2025-09-27", reported_currency: "USD", data: JSON.stringify({ revenue: 391_035_000_000 }) },
  ];
  const merged = mergeFinancialStatementReports({ income });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].fiscalYear, "2025", "the most recent filed period must sort to index 0");
  assert.equal(merged[0].income?.revenue, 391_035_000_000);
  assert.equal(merged[1].fiscalYear, "2018");

  const [latest] = buildFinancialAnalysis(merged);
  assert.equal(latest.fiscalYear, "2025", "buildFinancialAnalysis must compute its 'latest' period from the sorted, not the raw provider, order");
});

test("mergeFinancialStatementReports merges income/balance/cashflow rows for the same fiscal period and respects the limit", () => {
  const income: RawStatementReport[] = [{ fiscal_year: "2024", period: "FY", date: "2024-12-31", reported_currency: "USD", data: JSON.stringify({ revenue: 500 }) }];
  const balance: RawStatementReport[] = [{ fiscal_year: "2024", period: "FY", date: "2024-12-31", reported_currency: "USD", data: JSON.stringify({ totalAssets: 1000 }) }];
  const merged = mergeFinancialStatementReports({ income, balance }, 5);
  assert.equal(merged.length, 1, "income and balance rows for the same fiscal period must merge into one bundle, not two");
  assert.equal(merged[0].income?.revenue, 500);
  assert.equal(merged[0].balance?.totalAssets, 1000);
});
