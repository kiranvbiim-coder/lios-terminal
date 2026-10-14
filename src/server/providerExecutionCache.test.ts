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
