import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExtractedStatementReports } from "./documentIngestionAdapter";

test("normalizes extracted statement fields and preserves document provenance", () => {
  const result = normalizeExtractedStatementReports({
    symbol: "ACME",
    fileName: "acme-2024.pdf",
    reports: [
      {
        reportType: "income",
        periodLabel: "FY 2024",
        fiscalYear: "2024",
        reportedCurrency: "USD",
        fields: [
          {
            key: "revenue",
            label: "Revenue",
            value: 1250,
            rawText: "$1,250",
            confidence: "high",
            sourceMethod: "deterministic",
          },
          {
            key: "netIncome",
            label: "NET INCOME",
            value: 80,
            rawText: "80",
            confidence: "low",
            sourceMethod: "llm",
          },
          {
            key: "operatingExpenses",
            label: "Total Operating Expenses",
            value: 400,
            rawText: "400",
            confidence: "high",
            sourceMethod: "deterministic",
          },
          {
            key: "interestExpense",
            label: "Interest Expense",
            value: null,
            rawText: null,
            confidence: "low",
            sourceMethod: "unmatched",
          },
        ],
      },
    ],
  });

  assert.equal(result.provenance.fileName, "acme-2024.pdf");
  assert.equal(result.provenance.symbol, "ACME");
  assert.equal(result.provenance.parser, "pdfStatementExtractor");
  assert.deepEqual(
    result.observations.map(({ metricId, value, period, currency, confidence }) => ({
      metricId,
      value,
      period,
      currency,
      confidence,
    })),
    [
      { metricId: "revenue", value: 1250, period: "2024 FY", currency: "USD", confidence: 0.95 },
      { metricId: "netIncome", value: 80, period: "2024 FY", currency: "USD", confidence: 0.4 },
    ],
  );
  assert.deepEqual(
    result.rejected.map(({ fieldKey, reason }) => ({ fieldKey, reason })),
    [
      { fieldKey: "operatingExpenses", reason: "No analytical metric mapping exists for the extracted field." },
      { fieldKey: "interestExpense", reason: "The extractor returned no finite value." },
    ],
  );
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[1]?.sourceMethod, "llm");
});
