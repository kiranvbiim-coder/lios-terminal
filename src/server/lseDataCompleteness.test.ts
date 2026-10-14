import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  getOptionsChain,
  getOptionsFlow,
  screenCatalog,
  normalizeLseQueryOptions,
  LseQueryValidationError,
} from "./lseData";

const originalFetch = globalThis.fetch;
const originalKey = process.env.LSE_API_KEY;
const originalRoot = process.env.LIOS_DATA_ROOT;

function isolateHome(): void {
  process.env.LIOS_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lse-test-"));
}
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.LSE_API_KEY;
  else process.env.LSE_API_KEY = originalKey;
  if (originalRoot === undefined) delete process.env.LIOS_DATA_ROOT;
  else process.env.LIOS_DATA_ROOT = originalRoot;
});

test("LSE query validation rejects unsafe ranges and ambiguous pagination", () => {
  assert.throws(() => normalizeLseQueryOptions({ limit: 5001 }), LseQueryValidationError);
  assert.throws(() => normalizeLseQueryOptions({ start: "2026-02-01", end: "2026-01-01" }), LseQueryValidationError);
  assert.throws(() => normalizeLseQueryOptions({ page: 2, cursor: "abc" }), LseQueryValidationError);
});

test("options chain applies DTE/type filters and preserves array default", async () => {
  isolateHome();
  process.env.LSE_API_KEY = "test-key";
  let requestUrl = "";
  globalThis.fetch = async (input) => {
    requestUrl = String(input);
    return new Response(JSON.stringify([
      { ticker: "A", underlying: "TEST", contract_type: "call", strike: 100, expiry: "2026-09-15", dte: 15 },
      { ticker: "B", underlying: "TEST", contract_type: "put", strike: 100, expiry: "2026-10-15", dte: 45 },
      { ticker: "C", underlying: "TEST", contract_type: "call", strike: 100, expiry: "2026-12-15", dte: 106 },
    ]), { status: 200 });
  };
  const rows = await getOptionsChain("TEST", { type: "call", minDte: 10, maxDte: 30 });
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "A");
  assert.match(requestUrl, /min_dte=10/);
  assert.match(requestUrl, /max_dte=30/);
});

test("catalog screen page boundaries are deterministic and expose metadata", async () => {
  isolateHome();
  process.env.LSE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify([
    { dataset: "bonds", symbol: "A", ticks: 1, last_value: 1 },
    { dataset: "bonds", symbol: "B", ticks: 1, last_value: 2 },
    { dataset: "bonds", symbol: "C", ticks: 1, last_value: 3 },
  ]), { status: 200 });
  const page = await screenCatalog("bonds", {}, 2, { mode: "page", page: 2 });
  assert.deepEqual(page.rows.map((row) => row.symbol), ["C"]);
  assert.equal(page.page, 2);
  assert.equal(page.limit, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.provenance.provider, "LSE");
});

test("options flow page metadata reports a full provider page", async () => {
  isolateHome();
  process.env.LSE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify([
    { id: 1, ts: "2026-08-01T00:00:00Z", ticker: "A", underlying: "TEST", contract_type: "call", strike: 100, expiry: "2026-09-15", dte: 15, premium: 100 },
    { id: 2, ts: "2026-08-01T00:00:00Z", ticker: "B", underlying: "TEST", contract_type: "put", strike: 100, expiry: "2026-10-15", dte: 45, premium: 200 },
  ]), { status: 200 });
  const page = await getOptionsFlow({ underlying: "TEST", limit: 2, mode: "page", page: 1 });
  assert.deepEqual(page.rows.map((row) => row.id), [1, 2]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "2");
});

test("cached LSE page is explicitly classified as fallback when the key is unavailable", async () => {
  isolateHome();
  process.env.LSE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify([
    { id: 7, ts: "2026-08-01T00:00:00Z", ticker: "A", underlying: "CACHECASE", contract_type: "call", strike: 100, expiry: "2026-09-15", dte: 15, premium: 100 },
  ]), { status: 200 });
  await getOptionsFlow({ underlying: "CACHECASE", limit: 1 });
  delete process.env.LSE_API_KEY;
  const cachedPage = await getOptionsFlow({ underlying: "CACHECASE", limit: 1, mode: "page" });
  assert.equal(cachedPage.provenance.fallback, true);
  assert.equal(cachedPage.provenance.cache, "stale");
  assert.equal(cachedPage.rows.length, 1);
});
