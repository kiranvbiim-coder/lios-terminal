import test from "node:test";
import assert from "node:assert/strict";
import type { Quote, OHLCVSeries } from "./finance";
import { computeObservedBrinsonAttribution, parseAttributionHoldings } from "./portfolioAttributionObservations";

const status: OHLCVSeries["status"] = {
  provider: "Limuria Intelligence", freshness: "daily", asOf: "2026-10-23",
  delayLabel: "Daily close data", isFallback: false,
};
const quote = (symbol: string, sector: string | undefined): Pick<Quote, "symbol" | "sector" | "status" | "price" | "quoteSource"> =>
  ({ symbol, sector, price: 100, quoteSource: "observed-source", status });
const series = (points: Array<[string, number]>, meta: OHLCVSeries["status"] = status): OHLCVSeries => ({
  bars: points.map(([date, close]) => ({ date, close, open: close, high: close, low: close, volume: 100 })),
  status: meta, supportsIntraday: false,
});
const weights = (input: string) => {
  const p = parseAttributionHoldings(input);
  assert.equal(p.error, null);
  return p.holdings;
};

test("attribution holdings reject silent weight drops, malformed pairs and duplicates", () => {
  assert.deepEqual(weights(" AAPL:30,msft:70 "), [
    { symbol: "AAPL", weight: 0.3 }, { symbol: "MSFT", weight: 0.7 },
  ]);
  for (const input of ["", "AAPL:10,", "AAPL", "AAPL:0,MSFT:1", "AAPL:-1", "AAPL:wat",
    "AAPL:1e309", "AAPL:1,AAPL:2", "AAPL:1:2", "BAD SYMBOL:100", "AAPL:1e-300,MSFT:1e300"]) {
    const result = parseAttributionHoldings(input);
    assert.ok(result.error, `must reject ${input}`);
    assert.equal(result.holdings.length, 0);
  }
});

test("observed returns use identical common daily endpoints, not mismatched per-holding periods", () => {
  const calculated = computeObservedBrinsonAttribution(
    weights("AAPL:3,MSFT:1"), weights("AAPL:1,MSFT:3"),
    [quote("AAPL", "Technology"), quote("MSFT", "Financial")],
    {
      AAPL: series([["2026-01-01", 100], ["2026-01-02", 110], ["2026-01-10", 121]]),
      MSFT: series([["2026-01-02", 100], ["2026-01-09", 88], ["2026-01-10", 90]]),
    },
  );
  assert.equal(calculated.state, "ready");
  if (calculated.state !== "ready") return;
  assert.equal(calculated.startDate, "2026-01-02");
  assert.equal(calculated.endDate, "2026-01-10");
  assert.equal(calculated.commonObservations, 2);
  const tech = calculated.rows.find((row) => row.segment === "Technology")!;
  assert.ok(Math.abs(tech.portfolioReturn - 10) < 1e-10, "AAPL return must be 110->121, not 100->121");
  assert.equal(calculated.priceSources[0], "Daily close data");
  assert.ok(Math.abs(calculated.rows.reduce((sum, row) => sum + row.totalEffect, 0) - 10) < 1e-10);
});

test("negative observed price-return effects keep their sign, are not floored or replaced with zeros", () => {
  const result = computeObservedBrinsonAttribution(
    weights("AAPL:3,MSFT:1"), weights("AAPL:1,MSFT:3"),
    [quote("AAPL", "Technology"), quote("MSFT", "Financial")],
    { AAPL: series([["2026-01-01", 100], ["2026-01-02", 90]]),
      MSFT: series([["2026-01-01", 100], ["2026-01-02", 110]]) },
  );
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.totalEffect, 0) + 10) < 1e-9);
  assert.ok(Math.abs(result.rows.find((row) => row.segment === "Technology")!.portfolioReturn + 10) < 1e-10);
});

test("missing history and mismatched trading days explicitly block attribution", () => {
  const actual = weights("AAPL:1"), benchmark = weights("MSFT:1");
  const quotes = [quote("AAPL", "Technology"), quote("MSFT", "Financial")];
  for (const histories of [
    { AAPL: series([["2026-01-01", 100], ["2026-01-02", 105]]) },
    {
      AAPL: series([["2026-01-01", 100], ["2026-01-02", 105]]),
      MSFT: series([["2026-01-02", 100], ["2026-01-03", 95]]),
    },
    {
      AAPL: series([["2026-01-01", 100], ["2026-01-02", 105]]),
      MSFT: series([["2026-01-01", 0], ["2026-01-02", 0]]),
    },
  ]) {
    const result = computeObservedBrinsonAttribution(actual, benchmark, quotes, histories);
    assert.equal(result.state, "unavailable");
  }
});

test("a missing, unobserved or unclassified quote cannot fabricate a sector", () => {
  const actual = weights("AAPL:1"), benchmark = weights("AAPL:1");
  const histories = { AAPL: series([["2026-01-01", 100], ["2026-01-02", 101]]) };
  for (const quotes of [
    [],
    [quote("AAPL", undefined)],
    [{ ...quote("AAPL", "Technology"), price: 0, quoteSource: "Unavailable" }],
  ]) {
    const result = computeObservedBrinsonAttribution(actual, benchmark, quotes, histories);
    assert.equal(result.state, "unavailable");
  }
});

test("duplicated dates, unqualified source status and non-normalized weights block output", () => {
  const actual = weights("AAPL:1"), benchmark = weights("AAPL:1");
  const quotes = [quote("AAPL", "Technology")];
  const duplicate = { AAPL: series([["2026-01-01", 100], ["2026-01-01", 101], ["2026-01-03", 104]]) };
  assert.equal(computeObservedBrinsonAttribution(actual, benchmark, quotes, duplicate).state, "unavailable");
  const unsourced = { AAPL: series([["2026-01-01", 100], ["2026-01-03", 104]], { ...status, provider: "unavailable" }) };
  assert.equal(computeObservedBrinsonAttribution(actual, benchmark, quotes, unsourced).state, "unavailable");
  assert.equal(computeObservedBrinsonAttribution([{ symbol: "AAPL", weight: 50 }], benchmark, quotes, { AAPL: series([["2026-01-01", 100], ["2026-01-03", 104]]) }).state, "unavailable");
});

test("source fallback flag is presented without claiming source-signed records", () => {
  const input = weights("AAPL:1");
  const result = computeObservedBrinsonAttribution(input, input, [quote("AAPL", "Technology")], {
    AAPL: series([["2026-01-01", 100], ["2026-01-03", 105]], { ...status, isFallback: true }),
  });
  assert.equal(result.state, "ready");
  if (result.state === "ready") assert.deepEqual(result.fallbackSymbols, ["AAPL"]);
});

