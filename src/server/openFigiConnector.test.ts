import assert from "node:assert/strict";
import test from "node:test";
import {
  mapOpenFigi,
  openFigiMappingJobFromQuery,
  openFigiRowToCandidate,
  parseOpenFigiQuota,
  searchOpenFigi,
} from "./openFigiConnector";

test("P5 OpenFIGI maps LiOS identifier types to v3 mapping jobs", () => {
  assert.deepEqual(openFigiMappingJobFromQuery({ identifier: { type: "isin", value: "US4592001014" } }), { idType: "ID_ISIN", idValue: "US4592001014" });
  assert.deepEqual(openFigiMappingJobFromQuery({ ticker: "IBM", mic: "XNYS" }), { idType: "TICKER", idValue: "IBM", micCode: "XNYS" });
  assert.equal(openFigiMappingJobFromQuery({ identifier: { type: "lei", value: "x" } }), null);
});

test("P5 OpenFIGI results enrich identity without becoming canonical LiOS state", () => {
  const candidate = openFigiRowToCandidate({
    figi: "BBG000BLNNH6", compositeFIGI: "BBG000BLNNH6", shareClassFIGI: "BBG001S5S399",
    ticker: "IBM", name: "INTL BUSINESS MACHINES CORP", exchCode: "US", securityType2: "Common Stock",
  });
  assert.equal(candidate?.canonical, false);
  assert.equal(candidate?.source, "openfigi");
  assert.ok(candidate?.identifiers.some((item) => item.type === "figi" && item.value === "BBG000BLNNH6"));
  assert.ok(candidate?.identifiers.some((item) => item.type === "share_class_figi" && item.value === "BBG001S5S399"));
});

test("P5 OpenFIGI mapping sends X-OPENFIGI-APIKEY without leaking it into output", async () => {
  let headerValue: string | null = null;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headerValue = headers.get("X-OPENFIGI-APIKEY");
    return new Response(JSON.stringify([{ data: [{ figi: "BBG000BLNNH6", ticker: "IBM", name: "IBM", exchCode: "US" }] }]), {
      status: 200,
      headers: { "Content-Type": "application/json", "ratelimit-limit": "25", "ratelimit-remaining": "24", "ratelimit-reset": "6" },
    });
  }) as typeof fetch;
  const result = await mapOpenFigi([{ idType: "TICKER", idValue: "IBM" }], { fetchFn, credential: "test-key" });
  assert.equal(headerValue, "test-key");
  assert.equal(result.candidates[0].symbol, "IBM");
  assert.equal(JSON.stringify(result).includes("test-key"), false);
  assert.equal(result.quota.remaining, 24);
});

test("P5 OpenFIGI filter search parses data pages", async () => {
  const fetchFn = (async () => new Response(JSON.stringify({
    data: [{ figi: "BBG000BLNNH6", ticker: "IBM", name: "INTL BUSINESS MACHINES CORP", exchCode: "US" }],
    next: "cursor", total: 1,
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const result = await searchOpenFigi("IBM", { limit: 10 }, { fetchFn, credential: "test-key" });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].canonical, false);
});

test("P5 OpenFIGI quota parser consumes official rate-limit headers", () => {
  const headers = new Headers({ "ratelimit-limit": "25", "ratelimit-remaining": "3", "ratelimit-reset": "6" });
  const quota = parseOpenFigiQuota(headers);
  assert.equal(quota.limit, 25);
  assert.equal(quota.remaining, 3);
  assert.equal(quota.retryAfterMs, 6000);
});

test("P5 OpenFIGI record without a ticker stays ticker-less instead of promoting its FIGI to a symbol", () => {
  const candidate = openFigiRowToCandidate({ figi: "BBG00NOTICKER", name: "PRIVATE ISSUER 2031 NOTE", exchCode: "US" });
  assert.equal(candidate?.symbol, null);
  assert.equal(candidate?.identifiers.some((item) => item.type === "ticker"), false);
  assert.ok(candidate?.identifiers.some((item) => item.type === "figi" && item.value === "BBG00NOTICKER"));
  assert.equal(candidate?.canonical, false);
});
