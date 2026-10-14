import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyFinancialObservations } from "./financeObservations";
import type { LseFinancialReport } from "./useLse";

const report = (year: string, revenue: number, ebitda: number): LseFinancialReport => ({
  symbol: "AAPL", report_type: "income", date: `${year}-12-31`, fiscal_year: year, period: "FY",
  reported_currency: "USD", filing_date: `${Number(year) + 1}-02-01`, data_source: "SEC EDGAR",
  data: JSON.stringify({ revenue, ebitda, ebit: ebitda - 10, epsDiluted: 2 }),
});

test("company observations retain multiple filed periods and derive historical growth", () => {
  const observations = buildCompanyFinancialObservations({ incomeReports: [report("2025", 120, 30), report("2024", 100, 20)] });
  assert.equal(observations.filter(item => item.metricId === "revenue").length, 2);
  const growth = observations.find(item => item.metricId === "revenueGrowth");
  assert.equal(growth?.value, 0.2);
  assert.equal(growth?.status, "derived");
  assert.equal(growth?.period, "2025");
  assert.equal(growth?.source, "LiOS historical period growth");
});
