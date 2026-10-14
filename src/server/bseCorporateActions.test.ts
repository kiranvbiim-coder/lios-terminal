import test from "node:test";
import assert from "node:assert/strict";
import { applyCanonicalCorporateActionAdjustments, applySplitBonusAdjustments, dedupeCorporateActionAdjustments, getBseSplitBonusActions, parseAdjustmentFactor, type CanonicalCorporateActionAdjustment } from "./bseCorporateActions";
import type { OHLCVBar } from "./marketData";

const BARS: OHLCVBar[] = [
  { date: "2026-01-02", open: 100, high: 110, low: 90, close: 100, volume: 1000 },
  { date: "2026-01-03", open: 50, high: 55, low: 45, close: 50, volume: 2000 },
  { date: "2026-01-04", open: 50, high: 55, low: 45, close: 50, volume: 2000 },
];

test("canonical split adjustment changes prices before ex-date and volume inversely", () => {
  const actions: CanonicalCorporateActionAdjustment[] = [{ actionType: "split", exDate: "2026-01-04", ratioNumerator: 2, ratioDenominator: 1 }];
  const adjusted = applyCanonicalCorporateActionAdjustments(BARS, actions);
  assert.deepEqual(adjusted[0], { date: "2026-01-02", open: 50, high: 55, low: 45, close: 50, volume: 2000 });
  assert.deepEqual(adjusted[1], { date: "2026-01-03", open: 25, high: 27.5, low: 22.5, close: 25, volume: 4000 });
  assert.deepEqual(adjusted[2], BARS[2], "the ex-date bar itself is not back-adjusted");
});
test("future corporate actions do not adjust a series before the action date", () => {
  const adjusted = applyCanonicalCorporateActionAdjustments(BARS, [{
    actionType: "split",
    exDate: "2026-12-31",
    ratioNumerator: 2,
    ratioDenominator: 1,
  }]);
  assert.deepEqual(adjusted, BARS);
});

test("canonical reverse split adjustment applies the inverse share ratio", () => {
  const actions: CanonicalCorporateActionAdjustment[] = [{ actionType: "reverse_split", exDate: "2026-01-04", ratioNumerator: 1, ratioDenominator: 5 }];
  const adjusted = applyCanonicalCorporateActionAdjustments(BARS, actions);
  assert.equal(adjusted[0].close, 500);
  assert.equal(adjusted[0].volume, 200);
});

test("canonical dividend adjustment uses the last pre-ex-date close as the reference", () => {
  const actions: CanonicalCorporateActionAdjustment[] = [{ actionType: "dividend", exDate: "2026-01-04", cashAmount: 2 }];
  const adjusted = applyCanonicalCorporateActionAdjustments(BARS, actions);
  assert.equal(adjusted[0].close, 96, "the last pre-ex close is 50, so $2 is a 4% adjustment");
  assert.equal(adjusted[1].close, 48);
  assert.equal(adjusted[0].volume, 1000, "dividends do not change share volume");
  assert.equal(adjusted[2].close, 50, "ex-date is not back-adjusted");
});
test("canonical adjustments reject non-finite corporate-action inputs", () => {
  assert.throws(
    () => applyCanonicalCorporateActionAdjustments(BARS, [{ actionType: "split", exDate: "2026-01-04", ratioNumerator: Number.NaN, ratioDenominator: 1 }]),
    /finite positive ratio fields/,
  );
  assert.throws(
    () => applyCanonicalCorporateActionAdjustments(
      [BARS[0], { ...BARS[1], close: Number.NaN }, BARS[2]],
      [{ actionType: "dividend", exDate: "2026-01-04", cashAmount: 2 }],
    ),
    /valid positive pre-ex-date reference close/,
  );
});
test("deduplication collapses equivalent legacy and canonical split events", () => {
  const actions: CanonicalCorporateActionAdjustment[] = [
    { actionType: "split", exDate: "2026-01-04", ratioNumerator: 2, ratioDenominator: 1 },
    { actionType: "bonus_issue", exDate: "2026-01-04", ratioNumerator: 10, ratioDenominator: 5 },
  ];
  assert.equal(dedupeCorporateActionAdjustments(actions).length, 1);
});
test("BSE adjustment-factor parsing rejects extreme provider ratios", () => {
  assert.equal(parseAdjustmentFactor(`Bonus issue ${"9".repeat(400)}:1`), null);
  assert.equal(parseAdjustmentFactor("Stock Split From Rs.1 to Rs.0.0000000001"), null);
});
test("BSE action fetch rejects path-like scrip codes before cache or network access", async () => {
  await assert.rejects(
    () => getBseSplitBonusActions("../../tmp/pwn"),
    /must contain 1-12 digits/,
  );
});
test("same-date regular and special dividends aggregate into one cash adjustment", () => {
  const adjusted = applyCanonicalCorporateActionAdjustments(BARS, [
    { actionType: "dividend", exDate: "2026-01-04", cashAmount: 1 },
    { actionType: "special_dividend", exDate: "2026-01-04", cashAmount: 1 },
  ]);
  assert.equal(adjusted[0].close, 96);
});

test("non-INR dividend adjustments are rejected for BSE prices", () => {
  assert.throws(
    () => applyCanonicalCorporateActionAdjustments(BARS, [{
      actionType: "dividend",
      exDate: "2026-01-04",
      cashAmount: 2,
      cashCurrency: "USD",
    }]),
    /requires INR cashCurrency/,
  );
});

test("legacy BSE split/bonus adjustment delegates to the canonical pipeline", () => {
  const adjusted = applySplitBonusAdjustments(BARS, [{ exDate: "2026-01-04", purpose: "Bonus issue 1:1", adjustmentFactor: 0.5 }]);
  assert.equal(adjusted[0].close, 50);
  assert.equal(adjusted[0].volume, 2000);
});
