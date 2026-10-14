import test from "node:test";
import assert from "node:assert/strict";
import {
  assessDataQuality,
  buildCalculatedPassport,
  buildDataPassport,
  buildPassportEntry,
  computeFreshnessDays,
  computeSnapshotHash,
  generatePassportId,
  isFresh,
  resolveConflict,
  validateAccountingIdentity,
  validateSignConsistency,
  type DataPassportEntry,
  type SourceBinding,
} from "./dataTruth";

const NOW = new Date("2026-08-25T12:00:00.000Z");

const BINDING: SourceBinding = {
  contractFamily: "financial_statements",
  field: "revenue",
  connectorId: "sec_edgar",
  provider: "SEC EDGAR",
  priority: "primary",
};

// Keep "fresh" fixtures fresh as the calendar advances. Hard-coding a 2026
// retrieval date made the quality contract fail once the suite was run later
// than the original development week.
function recentTimestamp(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function entry(field: string, value: unknown, retrievedAt = recentTimestamp()): DataPassportEntry {
  return buildPassportEntry(field, value, { ...BINDING, field }, retrievedAt);
}

test("generatePassportId produces unique prefixed ids", () => {
  const a = generatePassportId();
  const b = generatePassportId();
  assert.ok(a.startsWith("ppt_"));
  assert.notEqual(a, b);
});

test("computeSnapshotHash is deterministic for same entries", () => {
  const entries = [entry("revenue", 1_000_000), entry("netIncome", 200_000)];
  const h1 = computeSnapshotHash(entries);
  const h2 = computeSnapshotHash(entries);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64); // SHA-256 hex
});

test("computeSnapshotHash changes when data changes", () => {
  const a = computeSnapshotHash([entry("revenue", 1_000_000)]);
  const b = computeSnapshotHash([entry("revenue", 2_000_000)]);
  assert.notEqual(a, b);
});

test("assessDataQuality scores completeness and freshness", () => {
  const entries = [entry("revenue", 1_000_000), entry("netIncome", 200_000)];
  const quality = assessDataQuality(entries, ["revenue", "netIncome", "totalAssets"]);
  // 2 out of 3 required → 0.666...
  assert.ok(quality.completeness > 0.6 && quality.completeness < 0.7);
  assert.equal(quality.level, "low");
  assert.ok(quality.warnings.some((w) => w.includes("totalAssets")));
});

test("assessDataQuality reports high quality when all required met and fresh", () => {
  const entries = [entry("revenue", 1_000_000), entry("netIncome", 200_000)];
  const quality = assessDataQuality(entries, ["revenue", "netIncome"]);
  assert.equal(quality.completeness, 1);
  assert.equal(quality.level, "high");
});

test("assessDataQuality detects stale data", () => {
  const staleEntry = entry("revenue", 1_000_000, "2026-01-01T00:00:00.000Z");
  const quality = assessDataQuality([staleEntry], ["revenue"]);
  assert.ok(quality.warnings.some((w) => w.includes("stale")));
});

test("resolveConflict picks primary source by default", () => {
  const conflict = resolveConflict("revenue", [
    { value: 1_000_000, connectorId: "sec_edgar", provider: "SEC", retrievedAt: "2026-08-20T00:00:00.000Z", quality: "high", priority: "primary" },
    { value: 1_050_000, connectorId: "fmp", provider: "FMP", retrievedAt: "2026-08-25T00:00:00.000Z", quality: "medium", priority: "secondary" },
  ]);
  assert.equal(conflict.resolvedValue, 1_000_000);
  assert.equal(conflict.resolvedFrom, "sec_edgar");
  assert.equal(conflict.strategy, "primary_source");
  assert.equal(conflict.values.length, 2);
});

test("resolveConflict picks latest timestamp when strategy is latest_timestamp", () => {
  const conflict = resolveConflict("revenue", [
    { value: 1_000_000, connectorId: "sec_edgar", provider: "SEC", retrievedAt: "2026-08-20T00:00:00.000Z", quality: "high", priority: "primary" },
    { value: 1_050_000, connectorId: "fmp", provider: "FMP", retrievedAt: "2026-08-25T00:00:00.000Z", quality: "medium", priority: "secondary" },
  ], "latest_timestamp");
  assert.equal(conflict.resolvedValue, 1_050_000);
  assert.equal(conflict.resolvedFrom, "fmp");
});

test("resolveConflict picks manual override when present", () => {
  const conflict = resolveConflict("revenue", [
    { value: 1_000_000, connectorId: "sec_edgar", provider: "SEC", retrievedAt: "2026-08-25T00:00:00.000Z", quality: "high", priority: "primary" },
    { value: 999_000, connectorId: "manual", provider: "User", retrievedAt: "2026-08-25T00:00:00.000Z", quality: "unverified", priority: "manual_override" },
  ], "manual_override");
  assert.equal(conflict.resolvedValue, 999_000);
  assert.equal(conflict.resolvedFrom, "manual");
});

test("buildDataPassport produces a complete passport", () => {
  const entries = [entry("revenue", 1_000_000), entry("netIncome", 200_000)];
  const passport = buildDataPassport("financial_statements", "AAPL", entries, ["revenue", "netIncome"]);
  assert.ok(passport.id.startsWith("ppt_"));
  assert.equal(passport.contractFamily, "financial_statements");
  assert.equal(passport.entityKey, "AAPL");
  assert.equal(passport.entries.length, 2);
  assert.equal(passport.quality.completeness, 1);
  assert.equal(passport.snapshotHash.length, 64);
});

test("buildCalculatedPassport links input passports to engine output", () => {
  const entries = [entry("revenue", 1_000_000)];
  const inputPassport = buildDataPassport("financial_statements", "AAPL", entries, ["revenue"]);
  const calc = buildCalculatedPassport(
    "valuation.dcf", "1.0.0",
    [inputPassport],
    [{ key: "wacc", value: 0.10, source: "manual" }],
    "abc123def456",
    ["Terminal growth rate is assumed constant"],
  );
  assert.ok(calc.id.startsWith("ppt_"));
  assert.equal(calc.engineId, "valuation.dcf");
  assert.equal(calc.inputs.length, 1);
  assert.equal(calc.inputs[0].passportId, inputPassport.id);
  assert.equal(calc.assumptions.length, 1);
  assert.equal(calc.outputHash, "abc123def456");
  assert.equal(calc.limitations.length, 1);
});

test("computeFreshnessDays calculates correctly", () => {
  const days = computeFreshnessDays("2026-08-20T00:00:00.000Z", NOW);
  assert.ok(days > 5 && days < 6);
});

test("isFresh returns correct boundary behavior", () => {
  assert.equal(isFresh("2026-08-25T12:00:00.000Z", 1, NOW), true); // exactly now
  assert.equal(isFresh("2026-08-24T12:00:00.001Z", 1, NOW), true); // just under 1 day
  assert.equal(isFresh("2026-08-20T00:00:00.000Z", 3, NOW), false); // 5+ days > 3
});

test("validateAccountingIdentity passes when A = L + E within tolerance", () => {
  const result = validateAccountingIdentity(1_000_000, 600_000, 400_000);
  assert.equal(result.valid, true);
  assert.equal(result.checks[0].passed, true);
});

test("validateAccountingIdentity fails when A ≠ L + E beyond tolerance", () => {
  const result = validateAccountingIdentity(1_000_000, 600_000, 300_000);
  assert.equal(result.valid, false);
  assert.ok(result.checks[0].detail?.includes("FAILED"));
});

test("validateAccountingIdentity handles small rounding differences", () => {
  // 0.5% difference should pass with default 1% tolerance
  const result = validateAccountingIdentity(1_000_000, 602_500, 400_000);
  assert.equal(result.valid, true);
});

test("validateSignConsistency flags negative revenue", () => {
  const result = validateSignConsistency(-500_000, 100_000);
  assert.equal(result.valid, false);
  assert.ok(result.checks.some((c) => c.check === "revenue_sign" && !c.passed));
});

test("validateSignConsistency flags extreme operating income magnitude", () => {
  const result = validateSignConsistency(100_000, 600_000); // 6x revenue
  assert.equal(result.valid, false);
  assert.ok(result.checks.some((c) => c.check === "operating_income_magnitude" && !c.passed));
});

test("validateSignConsistency passes normal values", () => {
  const result = validateSignConsistency(1_000_000, 200_000);
  assert.equal(result.valid, true);
});
