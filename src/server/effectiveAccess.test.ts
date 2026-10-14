import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAccessFromLicenseFile } from "./effectiveAccess";
import { featureIsEntitled, principalFromUser } from "@shared/identityContracts";
import { ASYMMETRIC_LICENSE_LEASE_ALGORITHM } from "./licenseLease";

const principal = principalFromUser({
  id: 5,
  email: "offline@example.com",
  name: "Offline User",
  role: "client_user",
  organizationId: 8,
});

const lease = {
  algorithm: ASYMMETRIC_LICENSE_LEASE_ALGORITHM,
  payload: {
    organizationId: 8,
    licenseId: 3,
    status: "active" as const,
    seatsPurchased: 1,
    issuedAt: "2026-09-26T00:00:00.000Z",
    expiresAt: "2026-09-30T00:00:00.000Z",
    keyId: "test-key",
    deviceFingerprintHash: "a".repeat(64),
    planCode: "pro",
    entitlementMode: "allowlist" as const,
    featureKeys: ["valuation.dcf", "portfolio.risk"],
  },
  signature: "test-signature",
};

const at = new Date("2026-09-27T00:00:00.000Z");
const organization = { id: 8, name: "Licensed Org", lifecycleStage: "client" as const, status: "active" };

test("licence-file access is feature-key scoped and expiry bounded", () => {
  const snapshot = effectiveAccessFromLicenseFile({ principal, organization, lease, now: at });
  assert.equal(snapshot.license.reason, "license_file");
  assert.equal(snapshot.degradedReason, null);
  assert.equal(featureIsEntitled(snapshot, "valuation.dcf", at), true);
  assert.equal(featureIsEntitled(snapshot, "valuation.lbo", at), false);
  assert.equal(featureIsEntitled(snapshot, "valuation.dcf", new Date("2026-10-01T00:00:00.000Z")), false);
});

test("an unrestricted licence is explicit and remains expiry bounded", () => {
  const unrestricted = { ...lease, payload: { ...lease.payload, entitlementMode: "unrestricted" as const, featureKeys: [] } };
  const snapshot = effectiveAccessFromLicenseFile({ principal, organization, lease: unrestricted, now: at });
  assert.equal(featureIsEntitled(snapshot, "any.feature", at), true);
  assert.equal(featureIsEntitled(snapshot, "any.feature", new Date("2026-10-01T00:00:00.000Z")), false);
});
