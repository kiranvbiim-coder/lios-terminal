import test from "node:test";
import assert from "node:assert/strict";

import { ingestAndProfile } from "./profiler";
import { classifyDomain } from "./domainClassifier";
import type { WorkbookProfile } from "./profiler";

// classifyDomain calls getDb() to check the AI kill-switch before ever
// attempting an LLM call; getDb() throws when initDb() hasn't run (true in
// this test process), and that throw is caught and treated as
// fail-safe-suppressed -- so every case here exercises the heuristic path
// only, deterministically, with no DB or network dependency. That's
// intentional: the heuristic is the part these tests need to guarantee.

test("a Finance-shaped file classifies as finance with high confidence", async () => {
  const { profile } = ingestAndProfile(
    Buffer.from("ticker,close_price,pe_ratio,market_cap,dividend_yield,eps\nAAPL,327.74,28.5,3200000000000,0.45%,6.13\n"),
    "portfolio_holdings.csv",
  );
  const result = await classifyDomain(profile);
  assert.equal(result.reasoningSource, "heuristic");
  assert.equal(result.candidates[0].slug, "finance");
  assert.ok(result.candidates[0].confidence >= 0.7);
});

test("an Economics-shaped file classifies as economics_policy", async () => {
  const { profile } = ingestAndProfile(
    Buffer.from("series_id,date,indicator_name,value,unit\nCPIAUCSL,2026-01-01,CPI All Items,312.5,index\nUNRATE,2026-01-01,Unemployment Rate,4.1,percent\n"),
    "fred_indicators.csv",
  );
  const result = await classifyDomain(profile);
  assert.equal(result.candidates[0].slug, "economics_policy");
});

test("a Manufacturing-shaped file classifies as manufacturing", async () => {
  const { profile } = ingestAndProfile(
    Buffer.from("machine_id,shift,units_produced,scrap_units,downtime_min,defect_count\nM-07,A,1200,40,15,8\nM-03,B,980,12,0,2\n"),
    "plant_data.csv",
  );
  const result = await classifyDomain(profile);
  assert.equal(result.candidates[0].slug, "manufacturing");
  assert.ok(result.candidates[0].confidence >= 0.7);
});

test("a fully generic file does not falsely report 100% confidence for anything (regression)", async () => {
  // Regression test for a real bug: confidence used to be normalized
  // relative to the top scorer, so a file with zero real domain signal
  // still reported 100% for whichever domain scored least-negligibly.
  const { profile } = ingestAndProfile(
    Buffer.from("id,date,value,category,notes\n1,2026-01-01,100,alpha,foo\n2,2026-01-02,200,beta,bar\n"),
    "generic.csv",
  );
  const result = await classifyDomain(profile);
  for (const candidate of result.candidates) {
    assert.ok(candidate.confidence < 0.5, `${candidate.slug} falsely reported high confidence (${candidate.confidence}) on a generic file`);
  }
});

test("classification combines signal across every sheet, not just the first", async () => {
  // A tabular sheet with no domain signal at all, plus a layout/model sheet
  // whose row labels are unmistakably a DCF -- the workbook should still
  // classify as finance because signal from BOTH sheets is combined into
  // one classification, matching how one real workbook is one document.
  const profile: WorkbookProfile = {
    fileName: "valuation.xlsx",
    fileExt: "xlsx",
    sheetNames: ["Notes", "DCF"],
    sheets: [
      {
        sheetName: "Notes",
        shape: "tabular",
        tabular: {
          rowCount: 2,
          columnCount: 1,
          columns: [{
            name: "comment", inferredType: "text", totalCount: 2, nullCount: 0,
            uniqueCount: 2, isLikelyKey: true, sampleValues: ["reviewed", "pending"], min: null, max: null,
          }],
          duplicateOrBlankHeaderWarning: false,
        },
        layout: null,
      },
      {
        sheetName: "DCF",
        shape: "layout",
        tabular: null,
        layout: {
          rowCount: 6,
          columnCount: 3,
          labels: ["Revenue", "WACC", "Discount Rate", "Terminal Value", "Free Cash Flow", "Present Value"],
          formulaCount: 12,
          hardcodedValueCount: 0,
          detectedModelType: "dcf",
          formulas: [],
        },
      },
    ],
    crossSheetReferences: [],
    parsedAt: new Date().toISOString(),
  };

  const result = await classifyDomain(profile);
  assert.equal(result.candidates[0].slug, "finance");
});

test("classifyDomain always returns at least one candidate and at most three", async () => {
  const { profile } = ingestAndProfile(Buffer.from("a,b\n1,2\n"), "tiny.csv");
  const result = await classifyDomain(profile);
  assert.ok(result.candidates.length >= 1 && result.candidates.length <= 3);
});
