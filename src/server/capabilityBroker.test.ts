import test from "node:test";
import assert from "node:assert/strict";
import { resolveCapabilityConcurrently, type CapabilityProvider } from "./capabilityBroker";

function provider<T>(id: string, label: string, value: T | null | (() => Promise<T | null>)): CapabilityProvider<T> {
  return {
    id,
    label,
    fetch: async () => {
      if (typeof value === "function") return (value as () => Promise<T | null>)();
      return value;
    },
  };
}

// This repo's `npm test` pipeline runs under whatever Node is first on
// PATH, which resolves to v20.x here (its better-sqlite3 native binding is
// compiled for v20's NODE_MODULE_VERSION, confirmed by
// databaseConnector.test.ts failing to dlopen under a v22 override) even
// though package.json's engines field targets >=22.12.0 for the packaged
// app. Promise.withResolvers() is Node 22+/ES2024 and isn't available
// here, so this is the manual equivalent rather than the newer built-in.
function withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** A provider whose fetch() doesn't resolve until the test explicitly releases it -- lets tests control interleaving deterministically instead of racing real timers. */
function deferredProvider<T>(id: string, label: string): { provider: CapabilityProvider<T>; resolve: (value: T | null) => void; started: () => boolean } {
  const { promise, resolve } = withResolvers<T | null>();
  let started = false;
  return {
    provider: { id, label, fetch: () => { started = true; return promise; } },
    resolve,
    started: () => started,
  };
}

/** Flushes pending microtasks without waiting on the wall clock. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

test("resolveCapabilityConcurrently attempts every provider and keeps only non-empty observations", async () => {
  const providers = [
    provider("a", "A", ["x"]),
    provider("b", "B", [] as string[]),
    provider("c", "C", null),
    provider("d", "D", ["y"]),
  ];
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: (v: string[]) => v.length === 0,
  });
  assert.deepEqual(resolution.attemptedProviders.sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(resolution.observations.map((o) => o.providerId).sort(), ["a", "d"]);
  assert.equal(resolution.failures.length, 0);
});

test("default rank picks the earliest observation in provider priority order, not fetch-completion order", async () => {
  // "b" is lower priority but resolves first; "a" is higher priority and
  // resolves later. The authoritative pick must still be "a".
  const deferredA = deferredProvider<string[]>("a", "A");
  const deferredB = deferredProvider<string[]>("b", "B");
  const resultPromise = resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers: [deferredA.provider, deferredB.provider],
    concurrency: 2,
    isEmpty: (v: string[]) => v.length === 0,
  });
  await flush();
  assert.ok(deferredA.started() && deferredB.started(), "both providers should have started under concurrency=2");
  deferredB.resolve(["from-b"]);
  await flush();
  deferredA.resolve(["from-a"]);
  const resolution = await resultPromise;
  assert.equal(resolution.authoritative?.providerId, "a");
  assert.deepEqual(resolution.observations.map((o) => o.providerId).sort(), ["a", "b"]);
});

test("falls through priority order when a higher-priority provider has no data", async () => {
  const providers = [
    provider("a", "A", [] as string[]),
    provider("b", "B", ["from-b"]),
  ];
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: (v: string[]) => v.length === 0,
  });
  assert.equal(resolution.authoritative?.providerId, "b");
});

test("a thrown error from one provider is isolated and does not block the others", async () => {
  const providers: CapabilityProvider<string[]>[] = [
    { id: "a", label: "A", fetch: async () => { throw new Error("boom"); } },
    provider("b", "B", ["ok"]),
  ];
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: (v: string[]) => v.length === 0,
  });
  assert.equal(resolution.failures.length, 1);
  assert.equal(resolution.failures[0].providerId, "a");
  assert.equal(resolution.failures[0].message, "boom");
  assert.equal(resolution.authoritative?.providerId, "b");
});

test("respects a concurrency limit smaller than the provider count", async () => {
  const deferredProviders = Array.from({ length: 6 }, (_, i) => deferredProvider<string[]>(`p${i}`, `P${i}`));
  const resultPromise = resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers: deferredProviders.map((d) => d.provider),
    concurrency: 2,
    isEmpty: (v: string[]) => v.length === 0,
  });

  await flush();
  assert.equal(deferredProviders.filter((d) => d.started()).length, 2, "only 2 of 6 providers should have started fetching");

  // Release the first two; exactly two more of the remaining four should start.
  deferredProviders[0].resolve(["v0"]);
  deferredProviders[1].resolve(["v1"]);
  await flush();
  assert.equal(deferredProviders.filter((d) => d.started()).length, 4, "releasing 2 in-flight fetches should admit exactly 2 more");

  for (const d of deferredProviders) d.resolve([`v-${d.provider.id}`]);
  const resolution = await resultPromise;
  assert.equal(resolution.attemptedProviders.length, 6);
});

test("diff is only invoked with 2+ observations, and its conflicts pass through unchanged", async () => {
  const providers = [
    provider("a", "A", { revenue: 100 }),
    provider("b", "B", { revenue: 105 }),
  ];
  let diffCalls = 0;
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: () => false,
    diff: (observations) => {
      diffCalls++;
      return observations.length > 1 ? [{ key: "", field: "revenue", values: observations.map((o) => ({ providerId: o.providerId, value: (o.value as { revenue: number }).revenue })) }] : [];
    },
  });
  assert.equal(diffCalls, 1);
  assert.equal(resolution.conflicts.length, 1);
  assert.equal(resolution.conflicts[0].field, "revenue");
});

test("diff is not invoked when fewer than 2 providers returned data", async () => {
  const providers = [provider("a", "A", { revenue: 100 })];
  let diffCalls = 0;
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: () => false,
    diff: () => { diffCalls++; return []; },
  });
  assert.equal(diffCalls, 0);
  assert.equal(resolution.conflicts.length, 0);
});

test("authoritative is null and no crash occurs when every provider comes back empty", async () => {
  const providers = [provider("a", "A", [] as string[]), provider("b", "B", [] as string[])];
  const resolution = await resolveCapabilityConcurrently({
    capability: "test",
    entity: "ACME",
    providers,
    isEmpty: (v: string[]) => v.length === 0,
  });
  assert.equal(resolution.authoritative, null);
  assert.deepEqual(resolution.observations, []);
});
