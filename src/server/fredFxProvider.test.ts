import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same LIMURIA_DATA_DIR-before-./db-import ordering requirement as
// fxRateStore.test.ts -- see billingSubscriptionProjection.test.ts for the
// full rationale.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-fred-fx-provider-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { currencies } = await import("@shared/schema");
const { FX_SERIES_CATALOG, fetchFxObservation, syncFxRates } = await import("./fredFxProvider");
const { resolveFxRateAsOf } = await import("./fxRateStore");

function fredObservationsResponse(date: string, value: string): Response {
  return new Response(
    JSON.stringify({ observations: [{ date, value, realtime_start: date, realtime_end: date }] }),
    { status: 200 },
  );
}

async function withFredCredential<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const previousKey = process.env.FRED_API_KEY;
  if (key === undefined) delete process.env.FRED_API_KEY;
  else process.env.FRED_API_KEY = key;
  try {
    return await run();
  } finally {
    if (previousKey === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = previousKey;
  }
}

async function withMockedFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("fredFxProvider", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("every catalog entry's currencies exist in the currency master and are distinct -- otherwise fx_rates' FK/CHECK constraints would reject a real sync at insert time", async () => {
    const rows = await getDb().select({ code: currencies.code }).from(currencies);
    const known = new Set(rows.map((row) => row.code));
    for (const profile of FX_SERIES_CATALOG) {
      assert.equal(known.has(profile.baseCurrency), true, `${profile.seriesId}: baseCurrency ${profile.baseCurrency} is not a seeded currency`);
      assert.equal(known.has(profile.quoteCurrency), true, `${profile.seriesId}: quoteCurrency ${profile.quoteCurrency} is not a seeded currency`);
      assert.notEqual(profile.baseCurrency, profile.quoteCurrency, `${profile.seriesId}: base and quote must differ`);
    }
    assert.equal(FX_SERIES_CATALOG.length, 21);
  });

  await t.test("fetchFxObservation returns a null observation, without calling fetch at all, when no FRED credential is configured", async () => {
    await withFredCredential(undefined, async () => {
      let called = false;
      await withMockedFetch((async () => {
        called = true;
        throw new Error("must not be called without a credential");
      }) as typeof fetch, async () => {
        const result = await fetchFxObservation(FX_SERIES_CATALOG[0]);
        assert.equal(result.observation, null);
      });
      assert.equal(called, false);
    });
  });

  await t.test("fetchFxObservation parses a live FRED response and requests the as-of cutoff via observation_end", async () => {
    await withFredCredential("test-fred-key", async () => {
      let capturedUrl = "";
      await withMockedFetch((async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return fredObservationsResponse("2026-06-01", "150.25");
      }) as typeof fetch, async () => {
        const jpy = FX_SERIES_CATALOG.find((p) => p.seriesId === "DEXJPUS")!;
        const result = await fetchFxObservation(jpy, "2026-06-01");
        assert.deepEqual(result.observation, { date: "2026-06-01", value: 150.25, realtimeStart: "2026-06-01", realtimeEnd: "2026-06-01" });
      });
      assert.match(capturedUrl, /series_id=DEXJPUS/);
      assert.match(capturedUrl, /observation_end=2026-06-01/);
    });
  });

  await t.test("fetchFxObservation returns a null observation instead of throwing when FRED responds with an error status", async () => {
    await withFredCredential("test-fred-key", async () => {
      await withMockedFetch((async () => new Response("rate limited", { status: 429 })) as typeof fetch, async () => {
        const result = await fetchFxObservation(FX_SERIES_CATALOG[0]);
        assert.equal(result.observation, null);
      });
    });
  });

  await t.test("fetchFxObservation returns a null observation instead of throwing when FRED responds 200 with a malformed (non-JSON) body", async () => {
    await withFredCredential("test-fred-key", async () => {
      await withMockedFetch((async () => new Response("not json", { status: 200 })) as typeof fetch, async () => {
        const result = await fetchFxObservation(FX_SERIES_CATALOG[0]);
        assert.equal(result.observation, null);
      });
    });
  });

  await t.test("syncFxRates persists a successful observation into fx_rates in the profile's declared (base, quote) direction", async () => {
    await withFredCredential("test-fred-key", async () => {
      await withMockedFetch((async () => fredObservationsResponse("2026-06-01", "1.1")) as typeof fetch, async () => {
        const results = await syncFxRates("2026-06-01");
        assert.equal(results.length, FX_SERIES_CATALOG.length);
        assert.equal(results.every((r) => r.recorded), true);
      });
      // EUR/USD is one of the "asterisked" USD-per-foreign-unit series
      // (baseCurrency EUR, per the module's own doc comment) -- persisting
      // it the wrong way round would silently invert every conversion.
      const stored = await resolveFxRateAsOf("EUR", "USD", "2026-06-01");
      assert.deepEqual(stored, { rate: 1.1, rateDate: "2026-06-01" });
    });
  });

  await t.test("syncFxRates reports recorded:false for every series, without throwing, when no FRED credential is configured", async () => {
    await withFredCredential(undefined, async () => {
      const results = await syncFxRates();
      assert.equal(results.length, FX_SERIES_CATALOG.length);
      assert.equal(results.every((r) => r.recorded === false), true);
    });
  });
});
