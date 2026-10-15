import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderSdkRegistry,
  createCanonicalDataRequest,
  describeProviderAccess,
  executeCanonicalDataRequest,
  startProviderStream,
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

const streamingRequest = (overrides: { capability?: "prices" | "statements"; providerAllow?: string[]; providerDeny?: string[]; asKnownOn?: boolean } = {}) => createCanonicalDataRequest({
  projectId: 17,
  capability: overrides.capability ?? "prices",
  entity: { ref: "ABC", symbol: "ABC", identifiers: {} },
  fields: [], parameters: {},
  pointInTime: overrides.asKnownOn
    ? { mode: "as_known_on", asKnownOn: "2025-01-01T00:00:00.000Z", revision: null, requirePublicationTime: true, allowLaterRevisions: false }
    : { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
  providerAllow: overrides.providerAllow ?? [],
  providerDeny: overrides.providerDeny ?? [],
});

test("SI-06.31 streaming checks capability, source policy, and point-in-time before opening a connection", async () => {
  const registry = new ProviderSdkRegistry();
  let entitlementCalls = 0;
  let streamCalls = 0;
  registry.register({
    id: "stream-source", label: "Stream", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() {
      entitlementCalls += 1;
      return { decision: "allowed", policyId: "live:1", permittedUses: ["internal_research"], reasons: [] };
    },
    async fetch() { return null; },
    async stream(request) {
      streamCalls += 1;
      assert.equal(request.projectId, 17);
      return { lifecycle: {} as never, stop: async () => {} };
    },
  });
  for (const request of [
    streamingRequest({ capability: "statements" }),
    streamingRequest({ providerAllow: ["some-other-source"] }),
    streamingRequest({ providerDeny: ["stream-source"] }),
    streamingRequest({ asKnownOn: true }),
  ]) {
    await assert.rejects(startProviderStream("stream-source", request, ctx, registry));
  }
  assert.equal(streamCalls, 0);
  assert.equal(entitlementCalls, 0, "policy-incompatible requests must not contact credentials or providers");
  const subscription = await startProviderStream("stream-source", streamingRequest(), ctx, registry);
  assert.equal(streamCalls, 1);
  assert.equal(entitlementCalls, 2, "grant must also be rechecked after opening the connection");
  assert.equal(await subscription.recheckEntitlement(), true);
  assert.equal(entitlementCalls, 3);
  await subscription.stop();
});

test("SI-06.31 stream launch refuses revoked, unknown, missing-use or unverifiable entitlements", async () => {
  const registry = new ProviderSdkRegistry();
  let mode: "allowed" | "denied" | "unknown" | "error" = "denied";
  let permittedUses = ["internal_research"];
  let streamCalls = 0;
  registry.register({
    id: "entitled-stream", label: "Stream", priority: 1, capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() {
      if (mode === "error") throw new Error("secret=DO_NOT_LOG provider oauth refresh failed");
      return { decision: mode, policyId: "live", permittedUses, reasons: [] };
    },
    async fetch() { return null; },
    async stream() { streamCalls += 1; return { lifecycle: {} as never, stop: async () => {} }; },
  });
  for (const denied of ["denied", "unknown", "allowed"] as const) {
    mode = denied;
    permittedUses = denied === "allowed" ? ["redistribution"] : ["internal_research"];
    await assert.rejects(startProviderStream("entitled-stream", streamingRequest(), ctx, registry), /does not permit/);
  }
  mode = "error";
  await assert.rejects(startProviderStream("entitled-stream", streamingRequest(), ctx, registry), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /could not be verified/);
    assert.doesNotMatch(error.message, /secret|DO_NOT_LOG|oauth/);
    return true;
  });
  assert.equal(streamCalls, 0);
  const noHook = new ProviderSdkRegistry();
  noHook.register({
    id: "no-entitlement", label: "Legacy", priority: 1, capabilities: ["prices"], pointInTimeModes: ["latest"],
    async fetch() { return null; },
    async stream() { streamCalls += 1; return { lifecycle: {} as never, stop: async () => {} }; },
  });
  await assert.rejects(startProviderStream("no-entitlement", streamingRequest(), ctx, noHook), /no live entitlement/);
  assert.equal(streamCalls, 0);
});

test("SI-06.31 one failed entitlement check does not block the next eligible data provider", async () => {
  const registry = new ProviderSdkRegistry();
  let unsafeFetches = 0;
  registry.register({
    id: "provider-with-outage", label: "Outage", priority: 1, capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() { throw new Error("secret=DO_NOT_LOG provider grant service offline"); },
    async fetch() { unsafeFetches += 1; return { data: { price: 0 } }; },
  });
  registry.register({
    id: "safe-fallback", label: "Fallback", priority: 2, capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() {
      return { decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons: [] };
    },
    async fetch() { return { data: { price: 42 }, normalized: true }; },
  });
  const result = await executeCanonicalDataRequest(streamingRequest(), ctx, registry);
  assert.equal(unsafeFetches, 0);
  assert.equal(result.observation?.providerId, "safe-fallback");
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[1].status, "returned");
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_LOG|secret=|grant service offline/);

  const outageOnly = new ProviderSdkRegistry();
  outageOnly.register(registry.get("provider-with-outage")!);
  const gap = await executeCanonicalDataRequest(streamingRequest(), ctx, outageOnly);
  assert.equal(gap.observation, null);
  assert.equal(gap.gap?.reason, "provider_error");
  assert.equal(gap.attempts.length, 1);
  assert.doesNotMatch(JSON.stringify(gap), /DO_NOT_LOG|secret=/);
});

test("SI-06.31 revocation during stream connection closes the underlying source before returning access", async () => {
  const registry = new ProviderSdkRegistry();
  let checks = 0;
  let opened = 0;
  let stopped = 0;
  registry.register({
    id: "connect-revocation",
    label: "Connect-time revocation",
    priority: 1,
    capabilities: ["prices"],
    pointInTimeModes: ["latest"],
    async entitlement() {
      checks += 1;
      return checks === 1
        ? { decision: "allowed", policyId: "v1", permittedUses: ["internal_research"], reasons: [] }
        : { decision: "denied", policyId: "v1", permittedUses: [], reasons: ["secret=DO_NOT_EXPOSE"] };
    },
    async fetch() { return null; },
    async stream() {
      opened += 1;
      return { lifecycle: { state: "streaming", reason: null } as never, async stop() { stopped += 1; } };
    },
  });
  await assert.rejects(startProviderStream("connect-revocation", streamingRequest(), ctx, registry), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /entitlement changed/);
    assert.doesNotMatch(error.message, /DO_NOT_EXPOSE|secret=/);
    return true;
  });
  assert.equal(checks, 2);
  assert.equal(opened, 1);
  assert.equal(stopped, 1, "just-opened stream must be closed on lost entitlement");
});

test("SI-06.31 policy change while connecting closes stream even if provider still reports allowed", async () => {
  const registry = new ProviderSdkRegistry();
  let checks = 0;
  let stopped = 0;
  registry.register({
    id: "connecting-policy-change", label: "Policy changed", priority: 1,
    capabilities: ["prices"], pointInTimeModes: ["latest"],
    async entitlement() {
      checks += 1;
      return { decision: "allowed", policyId: checks === 1 ? "old-policy" : "new-policy", permittedUses: ["internal_research"], reasons: [] };
    },
    async fetch() { return null; },
    async stream() {
      return { lifecycle: { state: "streaming", reason: null } as never, async stop() { stopped += 1; } };
    },
  });
  await assert.rejects(startProviderStream("connecting-policy-change", streamingRequest(), ctx, registry), /entitlement changed/);
  assert.equal(stopped, 1);
});
