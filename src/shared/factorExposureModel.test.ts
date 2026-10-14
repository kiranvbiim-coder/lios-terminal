import test from "node:test";
import assert from "node:assert/strict";
import { buildFactorExposures, type SecurityRawInputs } from "./factorExposureModel";

const benchmark = Array.from({ length: 12 }, (_, i) => 0.01 * (i + 1));

function security(overrides: Partial<SecurityRawInputs> = {}): SecurityRawInputs {
  return {
    securityId: "AAA",
    sector: "Technology & Hardware",
    marketCap: 100,
    bookValue: 40,
    eps: 4,
    price: 20,
    roe: 0.15,
    roa: 0.08,
    netMargin: 0.12,
    monthlyReturns: benchmark.map((value) => value * 2),
    dailyVolatilityAnnualized: 0.2,
    ...overrides,
  };
}

test("buildFactorExposures computes beta and sector dummy from valid observations", () => {
  const result = buildFactorExposures([
    security({ securityId: "AAA", sector: "Technology & Hardware", marketCap: 100 }),
    security({ securityId: "BBB", sector: "Financial Services", marketCap: 200, bookValue: 80, roe: 0.2 }),
  ], benchmark, "2026-08-31");

  assert.equal(result.excluded.length, 0);
  assert.equal(result.securities.length, 2);
  assert.ok(Math.abs(result.securities[0].exposures.market_beta - 2) < 1e-12);
  assert.equal(result.securities[0].exposures.sector_technology_hardware, 1);
  assert.equal(result.securities[0].exposures.sector_financial_services, undefined);
  assert.equal(result.securities[1].exposures.sector_financial_services, 1);
  assert.deepEqual(result.factors.slice(0, 6).map((factor) => factor.id), [
    "market_beta", "size", "value", "momentum", "volatility", "quality",
  ]);
  assert.ok(result.securities.every((item) => item.status === "derived"));
});

test("buildFactorExposures standardizes size using ln(marketCap) across the included universe", () => {
  const result = buildFactorExposures([
    security({ securityId: "A", marketCap: Math.exp(1) }),
    security({ securityId: "B", marketCap: Math.exp(2), bookValue: 80 }),
    security({ securityId: "C", marketCap: Math.exp(3), bookValue: 120 }),
  ], benchmark, "2026-08-31");
  const expected = (1 - 2) / Math.sqrt(2 / 3);
  assert.ok(Math.abs(result.securities[0].exposures.size - expected) < 1e-12);
  assert.ok(Math.abs(result.securities[1].exposures.size) < 1e-12);
  assert.equal(result.securities[2].exposures.size, -expected);
});

test("buildFactorExposures uses 12-1 compounded momentum and earnings-yield fallback", () => {
  const monthlyReturns = [0.1, 0.2, -0.05, 0.03, 0.01, 0.04, -0.02, 0.02, 0.05, 0, 0.01, 0.9];
  const result = buildFactorExposures([
    security({ securityId: "A", monthlyReturns, bookValue: null, eps: 2, price: 10 }),
    security({ securityId: "B", monthlyReturns, bookValue: 40, eps: 4, price: 20 }),
  ], benchmark, "2026-08-31");
  assert.equal(result.excluded.length, 0);
  const expectedMomentum = monthlyReturns.slice(0, -1).reduce((product, value) => product * (1 + value), 1) - 1;
  // The two securities have identical momentum in this fixture, so both z-scores floor at zero.
  assert.equal(result.securities[0].exposures.momentum, 0);
  assert.equal(result.securities[1].exposures.momentum, 0);
  // Earnings yield 2/10 is valid even without a positive book value; value is standardized over the two rows.
  assert.ok(Math.abs(result.securities[0].exposures.value + 1) < 1e-12);
  assert.ok(Math.abs(result.securities[1].exposures.value - 1) < 1e-12);
  assert.ok(Number.isFinite(expectedMomentum));
});

test("buildFactorExposures excludes each missing-data gate with a specific reason", () => {
  const cases: Array<[string, Partial<SecurityRawInputs>, string]> = [
    ["momentum", { monthlyReturns: benchmark.slice(0, 11) }, "momentum requires"],
    ["size", { marketCap: null }, "size requires"],
    ["value", { bookValue: null, eps: null }, "value requires"],
    ["quality", { roe: null, roa: null, netMargin: null }, "quality requires"],
    ["beta", { monthlyReturns: benchmark.slice(0, 11) }, "market_beta requires"],
  ];
  for (const [id, overrides, reason] of cases) {
    const result = buildFactorExposures([security({ securityId: id, ...overrides })], benchmark, "2026-08-31");
    assert.equal(result.securities.length, 0);
    assert.equal(result.excluded.length, 1);
    assert.match(result.excluded[0].reason, new RegExp(reason));
  }
});

test("buildFactorExposures rejects a constant benchmark instead of fabricating beta", () => {
  const result = buildFactorExposures([security()], Array(12).fill(0.01), "2026-08-31");
  assert.equal(result.securities.length, 0);
  assert.match(result.excluded[0].reason, /non-constant benchmark/);
});

test("buildFactorExposures floors degenerate cross-sectional standard deviations to zero", () => {
  const identical = [
    security({ securityId: "A", sector: "Technology" }),
    security({ securityId: "B", sector: "Technology" }),
  ];
  const result = buildFactorExposures(identical, benchmark, "2026-08-31");
  for (const exposure of result.securities) {
    assert.equal(exposure.exposures.size, 0);
    assert.equal(exposure.exposures.value, 0);
    assert.equal(exposure.exposures.momentum, 0);
    assert.equal(exposure.exposures.volatility, 0);
    assert.equal(exposure.exposures.quality, 0);
  }
  assert.equal(result.factors.filter((factor) => factor.id.startsWith("sector_")).length, 1);
});
