import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDataRequest, ProviderSdkRegistry } from "./providerSdk";
import { clearProviderExecutionCache, executeCanonicalDataRequestCached, prefetchCanonicalDataRequests } from "./providerExecutionCache";
import type { TenantContext } from "./tenantContext";

const ctx = { userId: 1, organizationId: null, role: "internal_admin" } as TenantContext;
const req = () => createCanonicalDataRequest({
  projectId: null, capability: "prices",
  entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
  fields: [], parameters: {},
  pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
  providerAllow: [], providerDeny: [],
});

test("P5 provider cache deduplicates successful observations but never caches gaps", async () => {
  clearProviderExecutionCache();
  let hits = 0;
  const registry = new ProviderSdkRegistry();
  registry.register({
    id:"fixture",label:"Fixture",priority:1,capabilities:["prices"],pointInTimeModes:["latest"],
    async fetch(){ hits += 1; return { data:{price:10}, entitlement:{decision:"allowed",policyId:null,permittedUses:["internal_research"],reasons:[]}, normalized:true }; },
  });
  const first = await executeCanonicalDataRequestCached(req(), ctx, registry);
  const second = await executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.equal(hits, 1);

  const empty = new ProviderSdkRegistry();
  let emptyHits = 0;
  empty.register({id:"empty",label:"Empty",priority:1,capabilities:["prices"],pointInTimeModes:["latest"],async fetch(){emptyHits+=1;return null;}});
  await executeCanonicalDataRequestCached(req(), ctx, empty);
  await executeCanonicalDataRequestCached(req(), ctx, empty);
  assert.equal(emptyHits, 2);
});

test("P5 prefetch is bounded and returns structured outcome accounting", async () => {
  clearProviderExecutionCache();
  const registry = new ProviderSdkRegistry();
  registry.register({id:"fixture",label:"Fixture",priority:1,capabilities:["prices"],pointInTimeModes:["latest"],async fetch(){return {data:{price:1},entitlement:{decision:"allowed",policyId:null,permittedUses:["internal_research"],reasons:[]}};}});
  const results = await prefetchCanonicalDataRequests([req(), req(), req()], ctx, registry, 2);
  assert.equal(results.length, 3);
  assert.ok(results.every((row)=>row.ok));
});

test("cache invalidation isolates an old completion and preserves a newer in-flight request", async () => {
  clearProviderExecutionCache();
  const resolvers: Array<(value: { data: { price: number }; normalized: boolean }) => void> = [];
  let fetches = 0;
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "controlled",
    label: "Controlled",
    priority: 1,
    capabilities: ["prices"],
    pointInTimeModes: ["latest"],
    fetch: async () => {
      fetches += 1;
      return new Promise<{ data: { price: number }; normalized: boolean }>((resolve) => {
        resolvers.push(resolve);
      });
    },
  });

  const old = executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(fetches, 1);
  clearProviderExecutionCache();
  const fresh = executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(fetches, 2, "invalidation must admit a new provider request");

  resolvers[0]({ data: { price: 10 }, normalized: true });
  const oldResult = await old;
  assert.equal((oldResult.response.observation?.data as { price: number }).price, 10,
    "the original caller still receives its completed request");

  const follower = executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(fetches, 2, "old cleanup must not delete the newer pending request");
  resolvers[1]({ data: { price: 20 }, normalized: true });
  const [freshResult, followerResult] = await Promise.all([fresh, follower]);
  assert.equal((freshResult.response.observation?.data as { price: number }).price, 20);
  assert.equal(followerResult.cache, "deduped");
  assert.equal((followerResult.response.observation?.data as { price: number }).price, 20);

  const cached = await executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(cached.cache, "hit");
  assert.equal((cached.response.observation?.data as { price: number }).price, 20);
  assert.equal(fetches, 2);
  clearProviderExecutionCache();
});

test("a late response from before invalidation never overwrites the refreshed cache", async () => {
  clearProviderExecutionCache();
  const resolvers: Array<(value: { data: { price: number }; normalized: boolean }) => void> = [];
  let fetches = 0;
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "controlled-late",
    label: "Controlled late",
    priority: 1,
    capabilities: ["prices"],
    pointInTimeModes: ["latest"],
    fetch: async () => {
      fetches += 1;
      return new Promise<{ data: { price: number }; normalized: boolean }>((resolve) => {
        resolvers.push(resolve);
      });
    },
  });

  const older = executeCanonicalDataRequestCached(req(), ctx, registry);
  clearProviderExecutionCache();
  const newer = executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(fetches, 2);

  resolvers[1]({ data: { price: 20 }, normalized: true });
  const recentResult = await newer;
  assert.equal((recentResult.response.observation?.data as { price: number }).price, 20);
  resolvers[0]({ data: { price: 10 }, normalized: true });
  await older;

  const cached = await executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(cached.cache, "hit");
  assert.equal((cached.response.observation?.data as { price: number }).price, 20,
    "invalidated work must not restore an obsolete cached observation");
  assert.equal(fetches, 2);
  clearProviderExecutionCache();
});

test("SI-06.06 cache separates the same user's role and project authorization scopes", async () => {
  clearProviderExecutionCache();
  let fetches = 0;
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "scope-fixture", label: "Scope fixture", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async fetch() {
      fetches += 1;
      return { data: { price: fetches }, normalized: true,
        entitlement: { decision: "allowed" as const, policyId: null, permittedUses: ["internal_research"], reasons: [] } };
    },
  });
  const base = req();
  const roleChanged = { ...ctx, role: "client_admin" } as TenantContext;
  const projectChanged = { ...base, projectId: 88 };
  assert.equal((await executeCanonicalDataRequestCached(base, ctx, registry)).cache, "miss");
  assert.equal((await executeCanonicalDataRequestCached(base, ctx, registry)).cache, "hit");
  assert.equal((await executeCanonicalDataRequestCached(base, roleChanged, registry)).cache, "miss");
  assert.equal((await executeCanonicalDataRequestCached(projectChanged, ctx, registry)).cache, "miss");
  assert.equal((await executeCanonicalDataRequestCached(projectChanged, ctx, registry)).cache, "hit");
  assert.equal(fetches, 3);
  clearProviderExecutionCache();
});

test("SI-06.06 cached observations recheck live entitlement and fail closed on revocation", async () => {
  clearProviderExecutionCache();
  let fetches = 0;
  let allowed = true;
  let checks = 0;
  const entitlement = () => ({
    decision: allowed ? "allowed" as const : "denied" as const,
    policyId: "provider-policy-v1",
    permittedUses: allowed ? ["internal_research"] : [],
    reasons: [],
  });
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "live-rights", label: "Live rights", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() { checks += 1; return entitlement(); },
    async fetch() {
      fetches += 1;
      return { data: { price: 23 }, normalized: true, entitlement: entitlement() };
    },
  });
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "miss");
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "hit");
  assert.equal(fetches, 1);
  allowed = false;
  const denied = await executeCanonicalDataRequestCached(req(), ctx, registry);
  assert.equal(denied.cache, "miss");
  assert.equal(denied.response.observation, null, "denied entitlement cannot reveal a cached price");
  assert.equal(fetches, 1, "SDK must deny before calling the provider");
  allowed = true;
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "miss");
  assert.equal(fetches, 2);
  assert.ok(checks >= 4, "cached result must not bypass the entitlement callback");
  clearProviderExecutionCache();
});

test("SI-06.06 change of permitted uses or policy identity forces a new canonical request", async () => {
  clearProviderExecutionCache();
  let fetches = 0;
  let policyId = "v1";
  let uses = ["internal_research"];
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "live-policy", label: "Live policy", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() { return { decision: "allowed" as const, policyId, permittedUses: [...uses], reasons: [] }; },
    async fetch() {
      fetches += 1;
      return {
        data: { price: fetches }, normalized: true,
        entitlement: { decision: "allowed" as const, policyId, permittedUses: [...uses], reasons: [] },
      };
    },
  });
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "miss");
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "hit");
  uses = ["internal_research", "report"];
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "miss");
  assert.equal(fetches, 2);
  policyId = "v2";
  assert.equal((await executeCanonicalDataRequestCached(req(), ctx, registry)).cache, "miss");
  assert.equal(fetches, 3);
  clearProviderExecutionCache();
});

test("SI-06.06 an entitlement change during a deduped request never serves the stale result", async () => {
  clearProviderExecutionCache();
  let release!: (value: { data: { price: number }; normalized: boolean }) => void;
  let allowed = true;
  let fetches = 0;
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "rights-inflight", label: "Rights in-flight", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() {
      return { decision: allowed ? "allowed" as const : "denied" as const, policyId: null, permittedUses: allowed ? ["internal_research"] : [], reasons: [] };
    },
    async fetch() {
      fetches += 1;
      return new Promise<{ data: { price: number }; normalized: boolean }>((resolve) => { release = resolve; });
    },
  });
  const original = executeCanonicalDataRequestCached(req(), ctx, registry);
  // SDK checks entitlement asynchronously before entering fetch().
  for (let i = 0; i < 10 && !release; i += 1) await Promise.resolve();
  assert.equal(fetches, 1);
  const follower = executeCanonicalDataRequestCached(req(), ctx, registry);
  allowed = false;
  release({ data: { price: 23 }, normalized: true });
  await original;
  const followResult = await follower;
  assert.equal(followResult.cache, "miss");
  assert.equal(followResult.response.observation, null);
  assert.equal(fetches, 1);
  clearProviderExecutionCache();
});
