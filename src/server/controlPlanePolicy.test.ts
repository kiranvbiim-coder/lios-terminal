import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_AUTHORIZATION_STATUSES,
  LICENSE_LIFECYCLE_STATUSES,
  evaluateDeviceAuthorization,
  evaluateLicenseLifecycle,
  evaluateOrganizationAccess,
  hasFeatureEntitlement,
} from "./controlPlanePolicy";

test("license lifecycle status set matches the shared-chat control-plane contract", () => {
  assert.deepEqual([...LICENSE_LIFECYCLE_STATUSES], [
    "active",
    "grace",
    "billing_hold",
    "suspended",
    "security_locked",
    "terminated",
  ]);
});

test("license lifecycle allows active and unexpired grace without revoking sessions", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");

  assert.deepEqual(evaluateLicenseLifecycle({ status: "active", offlineLeaseExpiresAt: "2026-09-01T00:00:00.000Z" }, now), {
    canAuthenticate: true,
    canUseEntitledFeatures: true,
    offlineAllowed: true,
    shouldRevokeSessions: false,
    reason: "license_active",
  });

  assert.deepEqual(evaluateLicenseLifecycle({ status: "grace", graceEndsAt: "2026-08-26T00:00:00.000Z", offlineLeaseExpiresAt: "2026-08-26T00:00:00.000Z" }, now), {
    canAuthenticate: true,
    canUseEntitledFeatures: true,
    offlineAllowed: true,
    shouldRevokeSessions: false,
    reason: "license_in_grace",
  });
});

test("license lifecycle blocks expired grace and lockout states", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");

  assert.deepEqual(evaluateLicenseLifecycle({ status: "grace", graceEndsAt: "2026-08-24T23:59:59.000Z" }, now), {
    canAuthenticate: false,
    canUseEntitledFeatures: false,
    offlineAllowed: false,
    shouldRevokeSessions: true,
    reason: "license_grace_expired",
  });

  for (const status of ["suspended", "security_locked", "terminated"] as const) {
    const decision = evaluateLicenseLifecycle({ status }, now);
    assert.equal(decision.canAuthenticate, false, status);
    assert.equal(decision.canUseEntitledFeatures, false, status);
    assert.equal(decision.shouldRevokeSessions, true, status);
  }
});

test("billing hold permits authentication but blocks entitled feature use", () => {
  assert.deepEqual(evaluateLicenseLifecycle({ status: "billing_hold" }, new Date("2026-08-25T00:00:00.000Z")), {
    canAuthenticate: true,
    canUseEntitledFeatures: false,
    offlineAllowed: false,
    shouldRevokeSessions: false,
    reason: "license_billing_hold",
  });
});

test("device authorization is explicit and lease-bounded", () => {
  assert.deepEqual([...DEVICE_AUTHORIZATION_STATUSES], ["authorized", "pending", "revoked"]);

  const now = new Date("2026-08-25T00:00:00.000Z");
  assert.deepEqual(evaluateDeviceAuthorization({ status: "authorized", leaseExpiresAt: "2026-08-25T00:00:00.000Z" }, now), {
    allowed: true,
    reason: "device_authorized",
  });
  assert.deepEqual(evaluateDeviceAuthorization({ status: "authorized", leaseExpiresAt: "2026-08-24T23:59:59.000Z" }, now), {
    allowed: false,
    reason: "device_lease_expired",
  });
  assert.deepEqual(evaluateDeviceAuthorization({ status: "pending" }, now), { allowed: false, reason: "device_pending" });
  assert.deepEqual(evaluateDeviceAuthorization({ status: "revoked" }, now), { allowed: false, reason: "device_revoked" });
});

test("entitlements require an active exact or wildcard grant and unexpired lease", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");

  assert.equal(hasFeatureEntitlement([{ featureKey: "valuation.dcf", active: true }], "valuation.dcf", now), true);
  assert.equal(hasFeatureEntitlement([{ featureKey: "*", active: true }], "portfolio.optimizer", now), true);
  assert.equal(hasFeatureEntitlement([{ featureKey: "valuation.dcf", active: false }], "valuation.dcf", now), false);
  assert.equal(hasFeatureEntitlement([{ featureKey: "valuation.dcf", active: true, expiresAt: "2026-08-24T00:00:00.000Z" }], "valuation.dcf", now), false);
  assert.equal(hasFeatureEntitlement([{ featureKey: "valuation.dcf", active: true }], "valuation.lbo", now), false);
});

test("organization access preserves current client-only semantics and fails closed", () => {
  assert.deepEqual(evaluateOrganizationAccess({ organizationStatus: "active", lifecycleStage: "client" }), {
    allowed: true,
    reason: "organization_active_client",
  });
  assert.deepEqual(evaluateOrganizationAccess({ organizationStatus: "inactive", lifecycleStage: "client" }), {
    allowed: false,
    reason: "organization_inactive",
  });
  assert.deepEqual(evaluateOrganizationAccess({ organizationStatus: "security_locked", lifecycleStage: "client" }), {
    allowed: false,
    reason: "organization_inactive",
  });
  assert.deepEqual(evaluateOrganizationAccess({ organizationStatus: "active", lifecycleStage: "trial" }), {
    allowed: false,
    reason: "organization_not_client",
  });
  assert.deepEqual(evaluateOrganizationAccess(null), {
    allowed: false,
    reason: "organization_missing",
  });
});
