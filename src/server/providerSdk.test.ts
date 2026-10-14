import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderSdkRegistry,
  createCanonicalDataRequest,
  describeProviderAccess,
  executeCanonicalDataRequest,
  type LiOSDataProviderAdapter,
} from "./providerSdk";
import type { TenantContext } from "./tenantContext";

const ctx = { userId: 1, organizationId: null, role: "internal_admin" } as TenantContext;

test("P5 provider SDK routes an executable capability and normalizes evidence", async () => {
  const registry = new ProviderSdkRegistry();
  const adapter: LiOSDataProviderAdapter = {
    id: "fixture", label: "Fixture", priority: 1, capabilities: ["prices"], pointInTimeModes: ["latest"],
    async fetch() { return { data: { price: 10 }, sourceRefs: ["fixture:price"], entitlement: { decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons: [] }, normalized: true }; },
  };
  registry.register(adapter);
  const response = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: null, capability: "prices", entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
    fields: [], parameters: {}, pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
    providerAllow: [], providerDeny: [],
  }), ctx, registry);
  assert.equal(response.observation?.providerId, "fixture");
  assert.equal(response.gap, null);
});

test("P5 point-in-time requests never silently use latest-only adapters", async () => {
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "latest-only", label: "Latest", priority: 1, capabilities: ["statements"], pointInTimeModes: ["latest"],
    async fetch() { throw new Error("must not execute"); },
  });
  const response = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: 1, capability: "statements", entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
    fields: [], parameters: {}, pointInTime: { mode: "as_known_on", asKnownOn: "2025-01-01T00:00:00.000Z", revision: null, requirePublicationTime: true, allowLaterRevisions: false },
    providerAllow: [], providerDeny: [],
  }), ctx, registry);
  assert.equal(response.observation, null);
  assert.equal(response.gap?.reason, "point_in_time_unavailable");
  assert.equal(response.attempts[0].status, "stale_only");
});

test("P5 unsupported capability returns remedies instead of fabricated data", async () => {
  const registry = new ProviderSdkRegistry();
  const response = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: null, capability: "curves", entity: { ref: "USD", symbol: null, identifiers: {} },
    fields: [], parameters: {}, pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
    providerAllow: [], providerDeny: [],
  }), ctx, registry);
  assert.equal(response.observation, null);
  assert.equal(response.gap?.reason, "unsupported");
  assert.ok(response.gap?.nextActions.some((item) => item.action === "import_data"));
});


test("SI-03.23 canonical response exposes secret-free provider access posture", async () => {
  const registry = new ProviderSdkRegistry();
  const adapter: LiOSDataProviderAdapter = {
    id: "premium-fixture",
    label: "Premium Fixture",
    priority: 1,
    capabilities: ["prices"],
    pointInTimeModes: ["latest"],
    access: {
      authMode: "secret_ref",
      credentialRequirement: "required",
      locality: "remote_provider",
      aiTransmission: "restricted",
      internalUse: "permitted",
      redistribution: "restricted",
      notes: ["Premium source policy."],
    },
    async fetch() {
      return {
        data: { price: 42 },
        sourceRefs: ["provider:premium-fixture:ABC"],
        entitlement: {
          decision: "allowed",
          policyId: "policy:internal-only",
          permittedUses: ["internal_research"],
          reasons: ["Connected account is entitled for internal research."],
        },
        normalized: true,
      };
    },
  };
  registry.register(adapter);
  const response = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: 1,
    capability: "prices",
    entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
    fields: [],
    parameters: {},
    pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
    providerAllow: ["premium-fixture"],
    providerDeny: [],
  }), ctx, registry);

  assert.equal(response.accessPostures.length, 1);
  assert.deepEqual(response.accessPostures[0], {
    providerId: "premium-fixture",
    capability: "prices",
    availability: { state: "available", reason: "returned", detail: null },
    authentication: {
      mode: "secret_ref",
      credentialRequirement: "required",
      secretMaterialExposed: false,
    },
    locality: "remote_provider",
    entitlement: {
      decision: "allowed",
      policyId: "policy:internal-only",
      permittedUses: ["internal_research"],
      reasons: ["Connected account is entitled for internal research."],
    },
    rights: {
      aiTransmission: "restricted",
      internalUse: "permitted",
      redistribution: "restricted",
    },
    pointInTime: {
      requestedMode: "latest",
      supportedModes: ["latest"],
      compatible: true,
    },
    notes: ["Premium source policy."],
  });
  const serialized = JSON.stringify(response.accessPostures[0]);
  assert.equal(/api[_-]?key|token|password|credentialRef/i.test(serialized), false);
});

test("SI-03.23 access posture preserves entitlement denial and point-in-time incompatibility", async () => {
  const registry = new ProviderSdkRegistry();
  registry.register({
    id: "denied",
    label: "Denied",
    priority: 1,
    capabilities: ["statements"],
    pointInTimeModes: ["latest", "as_known_on"],
    access: {
      authMode: "oauth",
      credentialRequirement: "required",
      locality: "remote_provider",
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
      notes: [],
    },
    async entitlement() {
      return {
        decision: "denied",
        policyId: "policy:no-statements",
        permittedUses: [],
        reasons: ["Subscription does not include statements."],
      };
    },
    async fetch() { throw new Error("must not fetch after entitlement denial"); },
  });
  registry.register({
    id: "latest-only",
    label: "Latest",
    priority: 2,
    capabilities: ["statements"],
    pointInTimeModes: ["latest"],
    async fetch() { throw new Error("must not fetch incompatible point-in-time provider"); },
  });

  const response = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: 1,
    capability: "statements",
    entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
    fields: [],
    parameters: {},
    pointInTime: { mode: "as_known_on", asKnownOn: "2025-01-01T00:00:00.000Z", revision: null, requirePublicationTime: true, allowLaterRevisions: false },
    providerAllow: [],
    providerDeny: [],
  }), ctx, registry);

  assert.equal(response.observation, null);
  assert.equal(response.gap?.reason, "point_in_time_unavailable");
  assert.deepEqual(response.accessPostures.map((item) => [item.providerId, item.availability.state, item.availability.reason]), [
    ["denied", "unavailable", "entitlement_denied"],
    ["latest-only", "unavailable", "unsupported_point_in_time"],
  ]);
  assert.equal(response.accessPostures[0].entitlement.decision, "denied");
  assert.equal(response.accessPostures[1].entitlement.decision, "unknown");
  assert.equal(response.accessPostures[1].pointInTime.compatible, false);
});

test("SI-03.23 provider policy exclusion is explicit and access inspection never fetches data", async () => {
  const registry = new ProviderSdkRegistry();
  let fetchCalls = 0;
  let entitlementCalls = 0;
  registry.register({
    id: "fixture",
    label: "Fixture",
    priority: 1,
    capabilities: ["prices"],
    pointInTimeModes: ["latest"],
    access: {
      authMode: "none",
      credentialRequirement: "not_required",
      locality: "remote_provider",
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
      notes: [],
    },
    async entitlement() {
      entitlementCalls += 1;
      return { decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons: [] };
    },
    async fetch() {
      fetchCalls += 1;
      return { data: { price: 1 }, normalized: true };
    },
  });

  const inspected = describeProviderAccess({
    capability: "prices",
    pointInTimeMode: "latest",
    providerAllow: ["fixture"],
    providerDeny: [],
  }, registry);
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].availability.reason, "not_evaluated");
  assert.equal(inspected[0].entitlement.decision, "unknown");
  assert.equal(fetchCalls, 0);
  assert.equal(entitlementCalls, 0);

  const filtered = await executeCanonicalDataRequest(createCanonicalDataRequest({
    projectId: 1,
    capability: "prices",
    entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
    fields: [],
    parameters: {},
    pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
    providerAllow: ["other-provider"],
    providerDeny: [],
  }), ctx, registry);
  assert.equal(filtered.observation, null);
  assert.equal(filtered.gap?.reason, "policy_denied");
  assert.deepEqual(filtered.accessPostures, []);
  assert.equal(fetchCalls, 0);
  assert.equal(entitlementCalls, 0);
});
