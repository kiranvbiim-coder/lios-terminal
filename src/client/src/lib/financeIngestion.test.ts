import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUniversalFinanceRecords } from "@shared/universalIngestion";

test("universal ingestion maps aliases and accounting numeric strings", () => {
  const result = normalizeUniversalFinanceRecords({
    symbol: "AAPL",
    source: "uploaded-workbook",
    provider: "user_supplied",
    defaultCurrency: "USD",
    records: [{ fiscal_period: "FY2025", revenue: "$100,000", "EBITDA": "(20)" }],
  });
  assert.deepEqual(result.observations.map(row => [row.metricId, row.value, row.period, row.currency]), [
    ["revenue", 100000, "FY2025", "USD"],
    ["ebitda", -20, "FY2025", "USD"],
  ]);
  assert.equal(result.rejected.length, 0);
});

test("universal ingestion preserves explicit provenance and reports rejected values", () => {
  const result = normalizeUniversalFinanceRecords({
    symbol: "ACME",
    source: "private-api",
    provider: "client_private",
    sourceUrl: "https://example.com/financials",
    records: [
      { metric: "revenue", value: 50, period: "2025", asOf: "2026-01-31", currency: "EUR" },
      { metric: "unknown_metric", value: 10, period: "2025" },
      { metric: "ebitda", value: "not-a-number", period: "2025" },
    ],
  });
  assert.equal(result.observations[0].source, "private-api");
  assert.equal(result.observations[0].sourceUrl, "https://example.com/financials");
  assert.equal(result.observations[0].currency, "EUR");
  assert.equal(result.rejected.length, 2);
});
test("universal ingestion exposes confidence-ranked column mapping suggestions", () => {
  const result = normalizeUniversalFinanceRecords({
    symbol: "AAPL",
    source: "uploaded-workbook",
    provider: "user_supplied",
    records: [{ revenue: 100, net_income: 10, sales: 90, mystery: 5 }],
  });
  assert.deepEqual(result.columnMappings, [
    { sourceColumn: "revenue", metricId: "revenue", confidence: "exact" },
    { sourceColumn: "net_income", metricId: "netIncome", confidence: "normalized" },
    { sourceColumn: "sales", metricId: "revenue", confidence: "alias" },
    { sourceColumn: "mystery", metricId: null, confidence: "unmapped" },
  ]);
});

test("universal ingestion applies a user column override before creating observations", () => {
  const result = normalizeUniversalFinanceRecords({
    symbol: "AAPL",
    source: "uploaded-workbook",
    provider: "user_supplied",
    records: [{ sales: 42 }],
    columnMapping: { sales: "netIncome" },
  });
  assert.deepEqual(result.observations.map(observation => [observation.metricId, observation.value]), [["netIncome", 42]]);
});

test("universal ingestion keeps unmapped columns rejected until explicitly mapped", () => {
  const unmapped = normalizeUniversalFinanceRecords({
    symbol: "AAPL",
    source: "uploaded-workbook",
    provider: "user_supplied",
    records: [{ mystery: 42 }],
  });
  assert.equal(unmapped.observations.length, 0);
  assert.equal(unmapped.columnMappings[0].confidence, "unmapped");
  assert.ok(unmapped.rejected.some(item => item.reason.includes("recognized canonical finance metric")));

  const mapped = normalizeUniversalFinanceRecords({
    symbol: "AAPL",
    source: "uploaded-workbook",
    provider: "user_supplied",
    records: [{ mystery: 42 }],
    columnMapping: { mystery: "revenue" },
  });
  assert.deepEqual(mapped.observations.map(observation => observation.metricId), ["revenue"]);
  assert.equal(mapped.rejected.length, 0);
});
