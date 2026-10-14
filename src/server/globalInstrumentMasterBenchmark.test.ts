import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstrumentLocal, type InstrumentMasterCandidate, type InstrumentResolutionQuery } from "@shared/globalInstrumentMaster";

/**
 * LV4-04-14: instrument resolution benchmark.
 *
 * A representative multi-country universe (US, India, UK, Japan, Hong
 * Kong, primary + secondary listings, one merger, one delisting) and a
 * query set spanning the lookup kinds the master plan requires resolution
 * to handle (section 10: ticker, company name, exchange+ticker,
 * identifier, historical). Each case asserts the exact expected outcome --
 * this is not a fuzzy "mostly works" measurement, it is a fixed pass/fail
 * bar per case, aggregated into the two headline KPIs section 43 names:
 * Instrument Resolution Rate and primary-listing accuracy.
 */
function candidate(overrides: Partial<InstrumentMasterCandidate>): InstrumentMasterCandidate {
  return {
    entityId: "lios:entity:1",
    listingId: "lios:listing:1",
    name: "Placeholder",
    symbol: "PLC",
    isPrimaryListing: true,
    lifecycleStatus: "active",
    identifiers: [],
    canonical: true,
    ...overrides,
  };
}

const UNIVERSE: InstrumentMasterCandidate[] = [
  // US: Apple, primary NASDAQ listing plus one duplicate-name-prefix trap.
  candidate({
    entityId: "lios:entity:100", listingId: "lios:listing:100", name: "Apple Inc.", symbol: "AAPL",
    exchange: "NASDAQ", mic: "XNAS", countryCode: "US", currency: "USD",
    identifiers: [{ type: "cik", value: "0000320193" }, { type: "ticker", value: "AAPL" }],
  }),
  candidate({
    entityId: "lios:entity:101", listingId: "lios:listing:101", name: "Apple Hospitality REIT", symbol: "APLE",
    exchange: "NYSE", mic: "XNYS", countryCode: "US", currency: "USD",
    identifiers: [{ type: "ticker", value: "APLE" }],
  }),
  // India: same ticker root on two different exchanges (NSE primary, BSE secondary) -- the
  // "same ticker exists on multiple venues" case the master plan calls out explicitly.
  candidate({
    entityId: "lios:entity:200", listingId: "lios:listing:200", name: "Reliance Industries Ltd", symbol: "RELIANCE",
    exchange: "NSE", mic: "XNSE", countryCode: "IN", currency: "INR", isPrimaryListing: true,
    identifiers: [{ type: "isin", value: "INE002A01018" }, { type: "ticker", value: "RELIANCE", provider: "nse" }],
  }),
  candidate({
    entityId: "lios:entity:200", listingId: "lios:listing:201", name: "Reliance Industries Ltd", symbol: "RELIANCE",
    exchange: "BSE", mic: "XBOM", countryCode: "IN", currency: "INR", isPrimaryListing: false,
    identifiers: [{ type: "isin", value: "INE002A01018" }, { type: "ticker", value: "RELIANCE", provider: "bse" }],
  }),
  // UK: identifier-only lookup (LEI), no ticker query in that test case.
  candidate({
    entityId: "lios:entity:300", listingId: "lios:listing:300", name: "Unilever PLC", symbol: "ULVR",
    exchange: "LSE", mic: "XLON", countryCode: "GB", currency: "GBP",
    identifiers: [{ type: "lei", value: "5493006MHB84DD0ZWV18" }, { type: "ticker", value: "ULVR" }],
  }),
  // Japan: name-based lookup where the display name differs from the local-market ticker.
  candidate({
    entityId: "lios:entity:400", listingId: "lios:listing:400", name: "Toyota Motor Corporation", symbol: "7203",
    exchange: "TSE", mic: "XTKS", countryCode: "JP", currency: "JPY",
    identifiers: [{ type: "ticker", value: "7203" }],
  }),
  // Hong Kong: ambiguity trap -- two unrelated entities sharing a numeric-style ticker root.
  candidate({
    entityId: "lios:entity:500", listingId: "lios:listing:500", name: "Sample HK Holdings A", symbol: "0001",
    exchange: "HKEX", mic: "XHKG", countryCode: "HK", currency: "HKD",
    identifiers: [{ type: "ticker", value: "0001" }],
  }),
  candidate({
    entityId: "lios:entity:501", listingId: "lios:listing:501", name: "Sample HK Holdings B", symbol: "0001",
    exchange: "HKEX", mic: "XHKG", countryCode: "HK", currency: "HKD",
    identifiers: [{ type: "ticker", value: "0001", provider: "duplicate_fixture" }],
  }),
  // Historical/delisted: a US listing that was acquired -- must be excluded by default
  // and only surfaced with includeHistorical, per master plan section 10's "historical/
  // delisted resolution" requirement.
  candidate({
    entityId: "lios:entity:600", listingId: "lios:listing:600", name: "Legacy Corp", symbol: "LGCY",
    exchange: "NYSE", mic: "XNYS", countryCode: "US", currency: "USD", lifecycleStatus: "acquired",
    identifiers: [{ type: "ticker", value: "LGCY" }],
  }),
];

interface BenchmarkCase {
  description: string;
  query: InstrumentResolutionQuery;
  expectedStatus: "resolved" | "ambiguous" | "not_found";
  expectedEntityId?: string | null;
  expectedListingId?: string | null;
}

const CASES: BenchmarkCase[] = [
  { description: "US exact ticker resolves to the correct entity, not the name-prefix trap", query: { ticker: "AAPL" }, expectedStatus: "resolved", expectedEntityId: "lios:entity:100" },
  { description: "US exact ticker for the trap symbol resolves to itself, not Apple Inc.", query: { ticker: "APLE" }, expectedStatus: "resolved", expectedEntityId: "lios:entity:101" },
  { description: "India bare ticker across two venues resolves to the primary (NSE) listing", query: { ticker: "RELIANCE" }, expectedStatus: "resolved", expectedListingId: "lios:listing:200" },
  { description: "India ticker qualified by the secondary MIC resolves to that specific listing", query: { ticker: "RELIANCE", mic: "XBOM" }, expectedStatus: "resolved", expectedListingId: "lios:listing:201" },
  { description: "UK identifier-only (LEI) lookup resolves without any ticker/name in the query", query: { identifier: { type: "lei", value: "5493006MHB84DD0ZWV18" } }, expectedStatus: "resolved", expectedEntityId: "lios:entity:300" },
  { description: "Japan company-name lookup resolves despite a numeric local-market ticker", query: { name: "Toyota Motor Corporation" }, expectedStatus: "resolved", expectedEntityId: "lios:entity:400" },
  { description: "Hong Kong ambiguous ticker across two unrelated entities is reported ambiguous, not silently picked", query: { ticker: "0001" }, expectedStatus: "ambiguous" },
  { description: "Hong Kong ambiguity resolves once exchange context narrows it no further (still ambiguous -- same MIC)", query: { ticker: "0001", mic: "XHKG" }, expectedStatus: "ambiguous" },
  { description: "Delisted/acquired instrument is excluded from a default (non-historical) query", query: { ticker: "LGCY" }, expectedStatus: "not_found" },
  { description: "Delisted/acquired instrument resolves when includeHistorical is set", query: { ticker: "LGCY", includeHistorical: true }, expectedStatus: "resolved", expectedEntityId: "lios:entity:600" },
  { description: "Unknown ticker with no match anywhere in the universe is honestly not_found", query: { ticker: "ZZZZZ9" }, expectedStatus: "not_found" },
];

test("instrument resolution benchmark: representative multi-country query set", () => {
  const failures: string[] = [];

  for (const testCase of CASES) {
    const result = resolveInstrumentLocal(testCase.query, UNIVERSE);
    if (result.status !== testCase.expectedStatus) {
      failures.push(`${testCase.description}: expected status "${testCase.expectedStatus}", got "${result.status}"`);
      continue;
    }
    if (testCase.expectedEntityId !== undefined && result.match?.entityId !== testCase.expectedEntityId) {
      failures.push(`${testCase.description}: expected entityId "${testCase.expectedEntityId}", got "${result.match?.entityId}"`);
    }
    if (testCase.expectedListingId !== undefined && result.match?.listingId !== testCase.expectedListingId) {
      failures.push(`${testCase.description}: expected listingId "${testCase.expectedListingId}", got "${result.match?.listingId}"`);
    }
  }

  const resolutionRate = (CASES.length - failures.length) / CASES.length;
  assert.deepEqual(failures, [], `Instrument Resolution Rate ${(resolutionRate * 100).toFixed(0)}% -- failing cases above`);
});

test("instrument resolution benchmark: primary-listing accuracy across multi-venue entities", () => {
  // Every entity in the universe with more than one listing (Reliance) must
  // rank its isPrimaryListing candidate strictly above its other listings
  // for an unqualified bare-ticker query -- this is the master plan
  // section 10 "primary-listing accuracy" metric in isolation from the
  // resolved/ambiguous/not_found status checked above.
  const result = resolveInstrumentLocal({ ticker: "RELIANCE" }, UNIVERSE);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.isPrimaryListing, true);
  const primaryScore = result.candidates.find((c) => c.candidate.listingId === "lios:listing:200")?.score;
  const secondaryScore = result.candidates.find((c) => c.candidate.listingId === "lios:listing:201")?.score;
  assert.equal(typeof primaryScore, "number");
  assert.equal(typeof secondaryScore, "number");
  assert.equal(primaryScore! > secondaryScore!, true, "primary listing must outrank the secondary listing, not merely tie with it");
});
