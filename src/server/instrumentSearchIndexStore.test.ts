import assert from "node:assert/strict";
import test from "node:test";
import { matchSecTickers, searchFederatedInstrumentCandidates, secEdgarFederatedFallback } from "./instrumentSearchIndexStore";
import type { InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";

const FIXTURE_TICKERS = [
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
  { cik: "0000789019", ticker: "MSFT", name: "Microsoft Corp" },
  { cik: "0001652044", ticker: "GOOGL", name: "Alphabet Inc." },
];

test("matchSecTickers matches by ticker substring", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "AAPL", {});
  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "AAPL");
  assert.equal(results[0].canonical, false, "a live SEC fallback hit is provisional, never silently canonical");
  assert.equal(results[0].source, "sec_edgar");
  assert.equal(results[0].exchange, null, "the SEC ticker file does not identify a trading venue");
  assert.equal(results[0].countryCode, "US");
});

test("matchSecTickers matches by company name substring, case-insensitively", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "alphabet", {});
  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "GOOGL");
});

test("matchSecTickers returns no matches for an unrelated query, without throwing", () => {
  assert.deepEqual(matchSecTickers(FIXTURE_TICKERS, "ZZZNOTHING", {}), []);
});

test("matchSecTickers returns [] for an empty/whitespace query rather than the entire universe", () => {
  assert.deepEqual(matchSecTickers(FIXTURE_TICKERS, "   ", {}), []);
});

test("matchSecTickers respects the limit option", () => {
  const manyTickers = Array.from({ length: 50 }, (_, i) => ({ cik: String(i), ticker: `ACME${i}`, name: "Acme Holdings" }));
  const results = matchSecTickers(manyTickers, "ACME", { limit: 5 });
  assert.equal(results.length, 5);
});

test("matchSecTickers carries the real CIK as a provider_id identifier", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "MSFT", {});
  assert.ok(results[0].identifiers.some((i) => i.type === "provider_id" && i.value === "0000789019" && i.provider === "sec_edgar"));
});

test("conversation federation honors provider policy and keeps synthetic SEC provenance", async (t) => {
  const calls: string[] = [];
  t.mock.method(secEdgarFederatedFallback, "search", async (query: string) => {
    calls.push(query);
    return matchSecTickers([{ cik: "SYNTHETIC_CIK", ticker: "SYNTHX", name: "Synthetic Industries" }], query, {});
  });
  const candidates = await searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    propagateErrors: true,
    signal: new AbortController().signal,
  });
  assert.deepEqual(calls, ["SYNTHX"]);
  assert.equal(candidates[0].source, "sec_edgar");
  assert.equal(candidates[0].canonical, false);
  assert.equal(candidates[0].entityId, null);
  assert.deepEqual(await searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    providerDeny: ["sec_edgar"],
    propagateErrors: true,
  }), []);
  assert.deepEqual(calls, ["SYNTHX"], "provider denial wins over allowance without contacting any provider");
});

test("strict conversation federation reports real provider failures while ordinary search stays best effort", async (t) => {
  const failure = Object.assign(new Error("Synthetic provider denial"), { status: 403 });
  t.mock.method(secEdgarFederatedFallback, "search", async () => { throw failure; });
  await assert.rejects(
    () => searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"], propagateErrors: true }),
    (error) => error === failure,
  );
  assert.deepEqual(await searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"] }), []);
});

test("conversation federation aborts a pending shared provider read without returning late identity", async (t) => {
  const completion = Promise.withResolvers<InstrumentMasterCandidate[]>();
  t.mock.method(secEdgarFederatedFallback, "search", () => completion.promise);
  const controller = new AbortController();
  const pending = searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    propagateErrors: true,
    signal: controller.signal,
  });
  const abort = new DOMException("Synthetic discovery cancelled", "AbortError");
  controller.abort(abort);
  await assert.rejects(pending, (error) => error === abort);
  completion.resolve([]);
  await assert.rejects(
    () => searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"], signal: controller.signal }),
    (error) => error === abort,
  );
});
