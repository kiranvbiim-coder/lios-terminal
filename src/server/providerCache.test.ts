import assert from "node:assert/strict";
import test from "node:test";
import { ProviderResponseCache, pointInTimeCachePolicy } from "./providerCache";

test("P5 provider cache de-duplicates concurrent loads", async () => {
  let calls = 0;
  const cache = new ProviderResponseCache<number>();
  const loader = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return 42; };
  const [a,b,c] = await Promise.all([
    cache.getOrLoad("k", { freshMs: 1000, staleMs: 2000 }, loader),
    cache.getOrLoad("k", { freshMs: 1000, staleMs: 2000 }, loader),
    cache.getOrLoad("k", { freshMs: 1000, staleMs: 2000 }, loader),
  ]);
  assert.deepEqual([a,b,c], [42,42,42]);
  assert.equal(calls, 1);
});

test("P5 cache policy gives immutable revisions longer reuse than latest data", () => {
  assert.ok(pointInTimeCachePolicy("revision_exact").freshMs > pointInTimeCachePolicy("latest").freshMs);
  assert.ok(pointInTimeCachePolicy("as_known_on").freshMs > pointInTimeCachePolicy("latest").freshMs);
});
