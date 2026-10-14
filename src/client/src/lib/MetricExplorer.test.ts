import assert from "node:assert/strict";
import test from "node:test";
import { buildMetricExplorerModel, formatMetricExplorerValue } from "./MetricExplorer";
import type { LseCompanyProfile, LseFinancialReport, LseStockFundamentals } from "./useLse";

const profile = {
  symbol: "AAPL", company_name: "Apple Inc.", exchange: "NASDAQ", currency: "USD", country: "US", sector: "Technology", industry: "Consumer Electronics",
  ceo: null, description: null, website: null, full_time_employees: null, address: null, city: null, state: null, price: 200, market_cap: 3_000,
  beta: 1.2, last_dividend: 0.25, price_range: "190-210", volume: 100, average_volume: 90, ipo_date: null, image_url_dark: null,
} satisfies LseCompanyProfile;

const fundamentals = {
  symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Consumer Electronics", country: "US", ipo_date: null,
  current_price: 200, market_cap: 3_000, beta: 1.2, pe_ratio: 20, week_52_high: 210, week_52_low: 150, dividend_yield: 0.005, revenue_ttm: 400, profit_margin: 0.25,
} satisfies LseStockFundamentals;

function report(reportType: "income" | "balance" | "cashflow", values: Record<string, unknown>): LseFinancialReport {
  return {
    symbol: "AAPL", report_type: reportType, date: "2025-09-27", fiscal_year: "2025", period: "FY", reported_currency: "USD", filing_date: "2025-11-01",
    data_source: "SEC EDGAR", data: JSON.stringify(values),
  };
}

test("metric explorer maps LSE statement fields and resolves a derived value", () => {
  const model = buildMetricExplorerModel({
    profile,
    fundamentals,
    incomeReports: [report("income", { revenue: 100, grossProfit: 40, netIncome: 20, epsDiluted: 2 })],
    balanceReports: [report("balance", { cashAndCashEquivalents: 30, totalAssets: 200, totalLiabilities: 120, totalStockholdersEquity: 80 })],
    cashflowReports: [report("cashflow", { netCashProvidedByOperatingActivities: 25, investmentsInPropertyPlantAndEquipment: -5 })],
  });
  const revenue = model.canonical.find(row => row.id === "revenue");
  const margin = model.canonical.find(row => row.id === "grossMargin");
  assert.equal(revenue?.resolved.value, 100);
  assert.equal(revenue?.resolved.status, "filed");
  assert.equal(revenue?.resolved.period, "2025");
  assert.equal(revenue?.resolved.provider, "SEC EDGAR");
  assert.equal(margin?.resolved.value, 0.4);
  assert.equal(margin?.group, "DERIVED");
  assert.equal(margin?.resolved.formula, "grossProfit / revenue");
});

test("unknown LSE provider fields stay raw and are not promoted to registry metrics", () => {
  const model = buildMetricExplorerModel({ profile, fundamentals, incomeReports: [report("income", { revenue: 100, providerAdjustedMargin: 0.31 })] });
  assert.ok(model.provider.some(row => row.id === "profile.beta" && row.value === 1.2));
  assert.ok(model.provider.some(row => row.id === "fundamentals.revenue_ttm" && row.value === 400));
  assert.ok(model.provider.some(row => row.id === "income.providerAdjustedMargin" && row.value === 0.31));
  assert.equal(model.canonical.find(row => row.id === "revenueNtm")?.resolved.value, null);
});

test("missing dependencies remain explicit instead of being zero-filled", () => {
  const model = buildMetricExplorerModel({ incomeReports: [report("income", { revenue: 100 })] });
  const margin = model.canonical.find(row => row.id === "grossMargin");
  assert.equal(margin?.resolved.value, null);
  assert.equal(margin?.resolved.status, "missing");
  assert.deepEqual(margin?.resolved.missingDependencies, ["grossProfit"]);
});

test("metric value formatting is deterministic across units and null", () => {
  assert.equal(formatMetricExplorerValue(0.125, "percent"), "12.50%");
  assert.equal(formatMetricExplorerValue(2.5, "multiple"), "2.50x");
  assert.equal(formatMetricExplorerValue(null, "currency"), "—");
});
