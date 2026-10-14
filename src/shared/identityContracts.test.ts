import assert from "node:assert/strict";
import test from "node:test";
import {
  authSessionStateSchema,
  effectiveAccessSnapshotSchema,
  featureIsEntitled,
  identityPrincipalSchema,
  ownershipMatches,
  ownershipScopeForPrincipal,
  principalFromUser,
} from "./identityContracts";

test("principal contract separates client and internal audiences", () => {
  const client = principalFromUser({
    id: 7,
    email: "Analyst@Example.com",
    name: "Analyst",
    role: "client_user",
    organizationId: 42,
  });
  assert.equal(client.audience, "client");
  assert.equal(client.email, "analyst@example.com");
  assert.equal(client.organizationId, 42);

  const internal = principalFromUser({
    id: 8,
    email: "internal@limuria.local",
    name: "Internal",
    role: "internal_analyst",
    organizationId: null,
  });
  assert.equal(internal.audience, "internal");

  assert.equal(identityPrincipalSchema.safeParse({
    ...client,
    audience: "internal",
  }).success, false);
  assert.equal(identityPrincipalSchema.safeParse({
    ...internal,
    organizationId: 42,
  }).success, false);
});

test("ownership scope is exact user plus organization and never organization-only", () => {
  const principal = principalFromUser({
    id: 10,
    email: "owner@example.com",
    name: "Owner",
    role: "client_user",
    organizationId: 22,
  });
  const scope = ownershipScopeForPrincipal(principal);
  assert.equal(ownershipMatches(scope, { ownerUserId: 10, organizationId: 22 }), true);
  assert.equal(ownershipMatches(scope, { ownerUserId: 11, organizationId: 22 }), false);
  assert.equal(ownershipMatches(scope, { ownerUserId: 10, organizationId: 23 }), false);
  assert.equal(ownershipMatches(scope, { ownerUserId: 10, organizationId: null }), false);
});

test("feature checks consume entitlement keys, not plan names", () => {
  const principal = principalFromUser({
    id: 1,
    email: "user@example.com",
    name: "User",
    role: "client_user",
    organizationId: 2,
  });
  const snapshot = effectiveAccessSnapshotSchema.parse({
    version: 1,
    mode: "online",
    principal,
    organization: { id: 2, name: "Example", lifecycleStage: "client", status: "active" },
    device: null,
    deviceAccess: { allowed: true, reason: "no_devices_configured" },
    license: {
      status: "active",
      reason: "license_active",
      canAuthenticate: true,
      canUseEntitledFeatures: true,
      offlineAllowed: true,
      expiresAt: null,
    },
    entitlementMode: "allowlist",
    entitlements: [{
      featureKey: "valuation.dcf",
      active: true,
      limitValue: null,
      expiresAt: null,
      source: "license",
    }],
    evaluatedAt: "2026-09-26T00:00:00.000Z",
    degradedReason: null,
  });

  assert.equal(featureIsEntitled(snapshot, "valuation.dcf", new Date("2026-09-26T00:00:00.000Z")), true);
  assert.equal(featureIsEntitled(snapshot, "valuation.lbo", new Date("2026-09-26T00:00:00.000Z")), false);
});

test("unrestricted compatibility mode remains explicit instead of silently inventing grants", () => {
  const principal = principalFromUser({
    id: 1,
    email: "user@example.com",
    name: "User",
    role: "client_user",
    organizationId: 2,
  });
  const snapshot = effectiveAccessSnapshotSchema.parse({
    version: 1,
    mode: "online",
    principal,
    organization: { id: 2, name: "Example", lifecycleStage: "client", status: "active" },
    device: null,
    deviceAccess: { allowed: true, reason: "no_devices_configured" },
    license: {
      status: null,
      reason: "license_not_configured",
      canAuthenticate: true,
      canUseEntitledFeatures: true,
      offlineAllowed: false,
      expiresAt: null,
    },
    entitlementMode: "unrestricted",
    entitlements: [{
      featureKey: "*",
      active: true,
      limitValue: null,
      expiresAt: null,
      source: "compatibility",
    }],
    evaluatedAt: "2026-09-26T00:00:00.000Z",
    degradedReason: "commercial_configuration_not_yet_projected",
  });
  assert.equal(featureIsEntitled(snapshot, "portfolio.optimizer"), true);
});

test("session restoration states are explicit and cannot masquerade as authenticated", () => {
  assert.equal(authSessionStateSchema.parse({
    version: 1,
    state: "signed_out",
    principal: null,
    restoredAt: null,
    reason: "no_session",
  }).state, "signed_out");

  assert.equal(authSessionStateSchema.safeParse({
    version: 1,
    state: "authenticated_online",
    principal: null,
    restoredAt: "2026-09-26T00:00:00.000Z",
    reason: null,
  }).success, false);
});
