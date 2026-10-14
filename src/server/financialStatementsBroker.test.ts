import test from "node:test";
import assert from "node:assert/strict";
import { diffReports } from "./financialStatementsBroker";
import type { LseFinancialReport } from "./lseData";
import type { CapabilityObservation } from "./capabilityBroker";

function report(overrides: Partial<LseFinancialReport> & { data: Record<string, number> }): LseFinancialReport {
  return {
    symbol: "AAPL",
    report_type: "income",
    date: "2024-09-28",
    fiscal_year: "2024",
    period: "FY",
    reported_currency: "USD",
    filing_date: "2024-11-01",
    ...overrides,
    data: JSON.stringify(overrides.data),
  } as unknown as LseFinancialReport;
}

function observation(providerId: string, reports: LseFinancialReport[]): CapabilityObservation<LseFinancialReport[]> {
  return { providerId, providerLabel: providerId.toUpperCase(), value: reports };
}

test("diffReports finds no conflicts when only one provider covers a period", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000 } })]),
  ]);
  assert.deepEqual(conflicts, []);
});

test("diffReports finds no conflicts when two providers fully agree", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000, netIncome: 93_736_000_000 } })]),
    observation("finnhub", [report({ data: { revenue: 391_035_000_000, netIncome: 93_736_000_000 } })]),
  ]);
  assert.deepEqual(conflicts, []);
});

test("diffReports flags a field two providers report differently for the same period", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ data: { revenue: 390_000_000_000 } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "revenue");
  assert.equal(conflicts[0].key, "income:2024:FY");
  assert.deepEqual(new Map(conflicts[0].values.map((v) => [v.providerId, v.value])), new Map([
    ["sec_edgar", 391_035_000_000],
    ["simfin", 390_000_000_000],
  ]));
});

test("diffReports never compares across different periods", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ fiscal_year: "2024", data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ fiscal_year: "2023", data: { revenue: 383_285_000_000 } })]),
  ]);
  assert.deepEqual(conflicts, [], "different fiscal years should never be diffed against each other");
});

test("diffReports handles three providers, comparing each against the highest-priority one that covers the period", () => {
  const conflicts = diffReports([
    observation("lse", [report({ data: { revenue: 391_035_000_000 } })]),
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ data: { revenue: 390_000_000_000 } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "revenue");
  // sec_edgar agrees with the reference (lse) and should not appear; simfin disagrees and should.
  const providerIds = conflicts[0].values.map((v) => v.providerId).sort();
  assert.deepEqual(providerIds, ["lse", "simfin"]);
});

test("diffReports flags multiple differing fields for the same period independently", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000, netIncome: 93_736_000_000 } })]),
    observation("simfin", [report({ data: { revenue: 390_000_000_000, netIncome: 93_736_000_000 } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts.map((c) => c.field), ["revenue"]);
});

test("diffReports is stable-sorted by key then field", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [
      report({ report_type: "balance", data: { totalAssets: 1, cash: 1 } }),
      report({ report_type: "income", data: { revenue: 1, netIncome: 1 } }),
    ]),
    observation("simfin", [
      report({ report_type: "balance", data: { totalAssets: 2, cash: 2 } }),
      report({ report_type: "income", data: { revenue: 2, netIncome: 2 } }),
    ]),
  ]);
  const keys = conflicts.map((c) => `${c.key}:${c.field}`);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
});

test("diffReports treats a field only one provider populates as a coverage gap, not a conflict", () => {
  // LSE's payload carries derived fields (cik, acceptedDate, ...) that
  // Finnhub's normalizer never sets at all -- that's a difference in
  // field vocabulary, not the two providers disagreeing about a number.
  const conflicts = diffReports([
    observation("lse", [report({ data: { revenue: 391_035_000_000, cik: 320_193, acceptedDate: 20_241_101 } })]),
    observation("finnhub", [report({ data: { revenue: 391_035_000_000 } })]),
  ]);
  assert.deepEqual(conflicts, [], "fields absent from one provider entirely must not be reported as conflicts");
});

test("diffReports still flags a real disagreement even when other fields are coverage gaps", () => {
  const conflicts = diffReports([
    observation("lse", [report({ data: { revenue: 391_035_000_000, cik: 320_193 } })]),
    observation("finnhub", [report({ data: { revenue: 390_000_000_000 } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "revenue");
});

test("diffReports marks a sub-1% numeric difference as not material", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ data: { revenue: 391_000_000_000 } })]), // ~0.009% off
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].material, false);
});

test("diffReports marks a >=1% numeric difference as material", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ data: { revenue: 300_000_000_000 } })]), // ~23% off
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].material, true);
});

test("diffReports marks a non-numeric field disagreement as material regardless of magnitude", () => {
  const conflicts = diffReports([
    observation("sec_edgar", [report({ data: { revenue: 391_035_000_000, statementLabel: "Annual" as unknown as number } })]),
    observation("simfin", [report({ data: { revenue: 391_035_000_000, statementLabel: "FY" as unknown as number } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "statementLabel");
  assert.equal(conflicts[0].material, true);
});

test("diffReports flags a reported_currency mismatch as its own material conflict and skips numeric comparison for that pair", () => {
  const conflicts = diffReports([
    observation("lse", [report({ reported_currency: "USD", data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ reported_currency: "EUR", data: { revenue: 360_000_000_000 } })]),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "reported_currency");
  assert.equal(conflicts[0].material, true);
  assert.deepEqual(new Map(conflicts[0].values.map((v) => [v.providerId, v.value])), new Map([["lse", "USD"], ["simfin", "EUR"]]));
});

test("diffReports does not flag a currency conflict when currencies agree", () => {
  const conflicts = diffReports([
    observation("lse", [report({ reported_currency: "USD", data: { revenue: 391_035_000_000 } })]),
    observation("simfin", [report({ reported_currency: "USD", data: { revenue: 391_035_000_000 } })]),
  ]);
  assert.deepEqual(conflicts, []);
});
