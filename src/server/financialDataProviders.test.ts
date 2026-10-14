import test from "node:test";
import assert from "node:assert/strict";
import { differingFinancialFields, financialReportJoinKey, runFinancialProviderWaterfall, type FinancialDataProvider } from "./financialDataProviders";

test("financial provider waterfall continues after an upstream failure", async () => {
  const providers: FinancialDataProvider[] = [
    { id: "primary", label: "Primary", getReports: async () => { throw new Error("rate limited"); } },
    { id: "fallback", label: "Fallback", getReports: async () => [{ symbol: "AAPL" } as never] },
  ];
  const result = await runFinancialProviderWaterfall(providers, "AAPL", "income", "FY");
  assert.equal(result.provider?.id, "fallback");
  assert.deepEqual(result.attemptedProviders, ["primary", "fallback"]);
  assert.deepEqual(result.failures, [{ provider: "primary", message: "rate limited" }]);
});

test("financial report join keys preserve period granularity", () => {
  assert.equal(financialReportJoinKey({ report_type: "income", fiscal_year: "2025", period: "FY" }), "income:2025:FY");
  assert.notEqual(
    financialReportJoinKey({ report_type: "income", fiscal_year: "2025", period: "FY" }),
    financialReportJoinKey({ report_type: "income", fiscal_year: "2025", period: "Q1" }),
  );
});

test("financial report conflict detection returns changed payload fields", () => {
  assert.deepEqual(
    differingFinancialFields(JSON.stringify({ revenue: 100, netIncome: 10 }), JSON.stringify({ revenue: 105, netIncome: 10, eps: 1 })),
    ["eps", "revenue"],
  );
});
