import assert from "node:assert/strict";
import test from "node:test";
import { compareUniversePayloads, membersEffectiveAsOf, normalizeUniversePayload } from "./universeDatasetStore";

const base = { universeKey: "TEST", name: "Test Universe", description: "fixture", methodology: "declared history", provider: "user_supplied", sourceName: "fixture", sourceUrl: null, effectiveDate: "2026-08-24" };
const member = (symbol: string, validFrom: string | null, validTo: string | null = null, status: "active" | "unknown_exit" = validTo ? "unknown_exit" : "active") => ({
  entityKey: symbol, symbol, name: symbol, exchange: "XNYS", assetClass: "equity", currency: "USD", weight: null, rank: null,
  validFrom, validTo, status, exitReason: validTo ? "unknown" : null, sourceMemberId: null, metadata: {},
});

test("universe normalization deduplicates exchange-qualified identities and reports unknown history", () => {
  const result = normalizeUniversePayload({ ...base, members: [member("AAA", null), { ...member("AAA", null), name: "Latest AAA" }, member("BBB", "2025-01-01")] });
  assert.equal(result.payload.members.length, 2); assert.equal(result.quality.duplicateCount, 1); assert.equal(result.quality.missingStartDates, 1);
  assert.equal(result.payload.members[0].name, "Latest AAA");
});

test("membership as-of retains later-delisted names and prevents survivorship bias", () => {
  const payload = normalizeUniversePayload({ ...base, members: [member("SURVIVOR", "2020-01-01"), member("DELISTED", "2020-01-01", "2023-06-30")] }).payload;
  assert.deepEqual(membersEffectiveAsOf(payload, "2022-12-31").map((row) => row.symbol), ["DELISTED", "SURVIVOR"]);
  assert.deepEqual(membersEffectiveAsOf(payload, "2024-01-01").map((row) => row.symbol), ["SURVIVOR"]);
});

test("universe revisions distinguish removals from membership interval changes", () => {
  const before = normalizeUniversePayload({ ...base, members: [member("AAA", "2020-01-01"), member("BBB", "2020-01-01")] }).payload;
  const after = normalizeUniversePayload({ ...base, effectiveDate: "2026-08-25", members: [member("AAA", "2020-01-01", "2026-08-24"), member("CCC", "2026-08-25")] }).payload;
  const report = compareUniversePayloads(before, after); assert.deepEqual(report.added, ["CCC@XNYS"]); assert.deepEqual(report.removed, ["BBB@XNYS"]);
  assert.deepEqual(report.changed[0].fields, ["validTo", "status", "exitReason"]);
});
