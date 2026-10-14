import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptDerivativeInstrument,
  adaptFixedIncomeInstrument,
  adaptMacroObservation,
  adaptPortfolioPosition,
  adaptValuationContext,
} from "@shared/waveCCanonicalAdapters";

test("Wave C portfolio adapter preserves legacy symbols without inventing identity", () => {
  const result = adaptPortfolioPosition({ symbol: "aapl", shares: 10, avgCost: 100 });
  assert.equal(result.record.symbol, "AAPL");
  assert.equal(result.canonical, false);
  assert.equal(result.identity.listingId, undefined);
  assert.match(result.warnings[0], /no canonical ID was invented/i);
  assert.deepEqual(result.fields, ["portfolio.symbol", "portfolio.shares", "portfolio.costBasis"]);
});

test("Wave C canonical adapter marks durable identity and provenance", () => {
  const result = adaptPortfolioPosition({
    symbol: "AAPL", shares: 2, identity: { listingId: "lios:listing:42" },
    provenance: { source: "portfolio-import", provider: "fixture", snapshotId: null, availableAt: null },
  });
  assert.equal(result.canonical, true);
  assert.deepEqual(result.identity, { listingId: "lios:listing:42" });
  assert.equal(result.provenance.provider, "fixture");
});

test("Wave C domain adapters validate required contract fields", () => {
  assert.equal(adaptValuationContext({ symbol: "MSFT", datasetSnapshotId: "00000000-0000-0000-0000-000000000001" }).family, "valuation");
  assert.equal(
    adaptValuationContext({
      symbol: "MSFT",
      datasetSnapshotId: "00000000-0000-0000-0000-000000000001",
      identity: { listingId: "lios:listing:9", securityId: "lios:security:9" },
    }).canonical,
    true,
  );
  assert.equal(adaptFixedIncomeInstrument({ issuer: "US Treasury", coupon: 4.25, maturity: "2030-01-01", faceValue: 100 }).canonical, false);
  assert.equal(
    adaptFixedIncomeInstrument({
      issuer: "US Treasury",
      coupon: 4.25,
      maturity: "2030-01-01",
      faceValue: 100,
      identity: { instrumentId: "lios:instrument:ust-2030" },
    }).canonical,
    true,
  );
  assert.equal(adaptDerivativeInstrument({ underlying: "SPY", instrumentType: "option", expiry: "2030-01-01", strike: 500, optionType: "call" }).family, "derivatives");
  assert.equal(adaptMacroObservation({ country: "us", indicator: "CPI", value: 3.1, date: "2026-08-01" }).record.country, "US");
  assert.throws(() => adaptDerivativeInstrument({ underlying: "SPY", instrumentType: "option", expiry: "not-a-date" } as never));
});

