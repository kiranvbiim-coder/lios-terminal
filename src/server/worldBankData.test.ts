import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getWbIndicator, normalizeWbOptions } from "./worldBankData";


async function withWorldBankFixture<T>(
  fetchImpl: typeof fetch,
  run: (home: string) => Promise<T>,
): Promise<T> {
  const previousFetch = globalThis.fetch;
  const previousRoot = process.env.LIOS_DATA_ROOT;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lios-worldbank-"));
  process.env.LIOS_DATA_ROOT = home;
  globalThis.fetch = fetchImpl;
  try {
    return await run(home);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previousRoot;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("World Bank options retain bounded year and page defaults", () => {
  const currentYear = new Date().getFullYear();
  assert.deepEqual(normalizeWbOptions({}), {
    startYear: currentYear - 60,
    endYear: currentYear,
    page: 1,
    limit: 61,
  });
  assert.deepEqual(normalizeWbOptions({ startYear: 2000, endYear: 2010, page: 2, limit: 5 }), {
    startYear: 2000,
    endYear: 2010,
    page: 2,
    limit: 5,
  });
  assert.throws(() => normalizeWbOptions({ startYear: 1900, endYear: 2001 }), /date range cannot exceed/);
  assert.throws(() => normalizeWbOptions({ page: 0 }), /page must be/);
});

test("getWbIndicator parses the World Bank v2 envelope, pagination, nulls, and numeric strings", { concurrency: false }, async () => {
  const requests: string[] = [];
  const responseBody = [
    { page: "1", pages: "2", per_page: "3", total: "5", sourceid: "2" },
    [
      { indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" }, country: { id: "US", value: "United States" }, date: "2022", value: "25462700000000" },
      { indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" }, country: { id: "US", value: "United States" }, date: "2021", value: null },
      { indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" }, country: { id: "US", value: "United States" }, date: "2020", value: 21060400000000 },
    ],
  ];

  await withWorldBankFixture(
    (async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    async () => {
      const result = await getWbIndicator("NY.GDP.MKTP.CD", "US", { startYear: 2020, endYear: 2022, page: 1, limit: 3 });
      assert.deepEqual(result.history, [
        { year: "2020", value: 21060400000000 },
        { year: "2022", value: 25462700000000 },
      ]);
      assert.equal(result.latestYear, "2022");
      assert.equal(result.latestValue, 25462700000000);
      assert.equal(result.status, "live");
      assert.equal(result.isLive, true);
      assert.equal(result.page, 1);
      assert.equal(result.limit, 3);
      assert.equal(result.hasMore, true);
      assert.equal(result.nextPage, 2);
      assert.equal(requests.length, 1);
      const requested = new URL(requests[0]);
      assert.equal(requested.searchParams.get("format"), "json");
      assert.equal(requested.searchParams.get("page"), "1");
      assert.equal(requested.searchParams.get("per_page"), "3");
      assert.equal(requested.searchParams.get("date"), "2020:2022");
      assert.equal(requested.searchParams.has("api_key"), false);
    },
  );
});

test("malformed and empty World Bank payloads stay empty without fabricated observations", { concurrency: false }, async () => {
  const payloads: unknown[] = [
    { error: "provider returned an object instead of a v2 envelope" },
    [],
    [{ page: "1", pages: "1" }, null],
    [{ page: "1", pages: "1" }, [{ date: "not-a-year", value: "123" }, { date: "2022", value: "NaN" }]],
  ];

  await withWorldBankFixture(
    (async () => new Response(JSON.stringify(payloads.shift()), { status: 200 })) as typeof fetch,
    async () => {
      for (const expectedPayload of [1, 2, 3, 4]) {
        const result = await getWbIndicator("TEST.EMPTY." + expectedPayload, "US", { startYear: 2020, endYear: 2022, limit: 3 });
        assert.deepEqual(result.history, []);
        assert.equal(result.latestValue, null);
        assert.equal(result.latestYear, null);
        assert.equal(result.status, "live");
        assert.equal(result.isLive, true);
      }
    },
  );
});


test("World Bank reports unavailable when the request fails without cache", { concurrency: false }, async () => {
  await withWorldBankFixture(
    (async () => { throw new Error("offline"); }) as typeof fetch,
    async () => {
      const result = await getWbIndicator("TEST.NO_CACHE", "US", { startYear: 2020, endYear: 2021, limit: 2 });
      assert.deepEqual(result.history, []);
      assert.equal(result.status, "unavailable");
      assert.equal(result.isLive, false);
      assert.equal(result.retrievedAt, null);
    },
  );
});
test("a stale World Bank cache is used when the live request fails", { concurrency: false }, async () => {
  const cachedEnvelope = [
    { page: "1", pages: "1", per_page: "2", total: "1" },
    [{ date: "2020", value: "42.5", country: { id: "US", value: "United States" } }],
  ];

  await withWorldBankFixture(
    (async () => { throw new Error("offline"); }) as typeof fetch,
    async (home) => {
      const cacheFile = path.join(home, "worldbank-cache", "ind_TEST_INDICATOR_US_2000_2001_1_2.json");
      const cachedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ cachedAt, data: cachedEnvelope }));

      const result = await getWbIndicator("TEST.INDICATOR", "US", { startYear: 2000, endYear: 2001, page: 1, limit: 2 });
      assert.deepEqual(result.history, [{ year: "2020", value: 42.5 }]);
      assert.equal(result.status, "cached");
      assert.equal(result.isLive, false);
      assert.equal(result.retrievedAt, new Date(cachedAt).toISOString());
    },
  );
});
