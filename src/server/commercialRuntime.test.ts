import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_RUNTIME_POLICY,
  DEFAULT_TRIAL_DAYS,
  TRIAL_ENTITLEMENT_TIER,
  aiInvocationConsumesLiosCredits,
  canTransitionLicense,
  evaluateOfflineLease,
  normalizeSoftwarePlanTier,
  requireSoftwarePlanTier,
  resolveRuntimeAccess,
  resolveTrialLifecycle,
} from "../shared/commercialRuntime";

test("canonical software plans and legacy software-plan aliases normalize correctly", () => {
  assert.equal(normalizeSoftwarePlanTier("trial"), "trial");
  assert.equal(normalizeSoftwarePlanTier("starter"), "starter");
  assert.equal(normalizeSoftwarePlanTier("pro"), "pro");
  assert.equal(normalizeSoftwarePlanTier("enterprise"), "enterprise");
  assert.equal(normalizeSoftwarePlanTier("personal"), "starter");
  assert.equal(normalizeSoftwarePlanTier("team"), "pro");
  assert.equal(normalizeSoftwarePlanTier(" TEAM "), "pro");
  assert.equal(normalizeSoftwarePlanTier("vantage"), null);
  assert.throws(() => requireSoftwarePlanTier("one"), /Unsupported LiOS software plan tier/);
});

test("trial is seven days and receives Pro-style software entitlement", () => {
  assert.equal(DEFAULT_TRIAL_DAYS, 7);
  assert.equal(TRIAL_ENTITLEMENT_TIER, "pro");
});

test("BYOAI does not consume LiOS credits and is not required by deterministic runtime", () => {
  assert.equal(AI_RUNTIME_POLICY.byoaiConsumesLiosCredits, false);
  assert.equal(AI_RUNTIME_POLICY.trialByoaiConsumesLiosCredits, false);
  assert.equal(AI_RUNTIME_POLICY.deterministicRuntimeRequiresAi, false);
  assert.equal(aiInvocationConsumesLiosCredits(), false);
});

test("trial lifecycle is resolved only from server-authoritative timestamps", () => {
  const startedAt = new Date("2026-09-01T00:00:00.000Z");
  const endsAt = new Date("2026-09-08T00:00:00.000Z");

  assert.equal(
    resolveTrialLifecycle({ serverNow: new Date("2026-09-07T23:59:59.000Z"), startedAt, endsAt }),
    "active",
  );
  assert.equal(
    resolveTrialLifecycle({ serverNow: new Date("2026-09-08T00:00:00.000Z"), startedAt, endsAt }),
    "expired",
  );
  assert.equal(
    resolveTrialLifecycle({
      serverNow: new Date("2026-09-04T00:00:00.000Z"),
      startedAt,
      endsAt,
      convertedAt: new Date("2026-09-03T00:00:00.000Z"),
    }),
    "converted",
  );
  assert.equal(
    resolveTrialLifecycle({
      serverNow: new Date("2026-09-04T00:00:00.000Z"),
      startedAt,
      endsAt,
      revokedAt: new Date("2026-09-02T00:00:00.000Z"),
    }),
    "revoked",
  );
});

test("terminated licenses cannot be resurrected by an ordinary lifecycle transition", () => {
  assert.equal(canTransitionLicense("active", "grace"), true);
  assert.equal(canTransitionLicense("grace", "active"), true);
  assert.equal(canTransitionLicense("terminated", "active"), false);
  assert.equal(canTransitionLicense("terminated", "terminated"), true);
});

test("offline lease requires signing, signature verification, and a valid trusted-time interval", () => {
  const valid = {
    trustedNow: new Date("2026-09-05T00:00:00.000Z"),
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-08T00:00:00.000Z"),
    signedLeaseHash: "sha256:lease",
    publicKeyId: "lios-control-plane-1",
    signatureVerified: true,
  } as const;

  assert.deepEqual(evaluateOfflineLease(valid), { valid: true, reason: "valid" });
  assert.deepEqual(evaluateOfflineLease({ ...valid, signatureVerified: false }), {
    valid: false,
    reason: "unverified_signature",
  });
  assert.deepEqual(
    evaluateOfflineLease({ ...valid, trustedNow: new Date("2026-09-08T00:00:00.000Z") }),
    { valid: false, reason: "expired" },
  );
});

test("trial uses Pro-style entitlement online without a four-panel allowlist", () => {
  const decision = resolveRuntimeAccess({
    planTier: "trial",
    licenseStatus: "active",
    deviceStatus: "authorized",
    connectedToControlPlane: true,
  });

  assert.equal(decision.canOpenLocalWorkspace, true);
  assert.equal(decision.canExecutePaidCapabilities, true);
  assert.equal(decision.effectiveEntitlementTier, "pro");
  assert.equal(decision.reason, "online_authorized");
});

test("billing expiry never destroys local work but blocks paid execution", () => {
  const decision = resolveRuntimeAccess({
    planTier: "pro",
    licenseStatus: "suspended",
    deviceStatus: "authorized",
    connectedToControlPlane: true,
  });

  assert.equal(decision.canOpenLocalWorkspace, true);
  assert.equal(decision.canExecutePaidCapabilities, false);
  assert.equal(decision.reason, "license_not_executable");
});

test("authorized offline execution requires a valid signed lease", () => {
  const base = {
    planTier: "enterprise" as const,
    licenseStatus: "grace" as const,
    deviceStatus: "authorized" as const,
    connectedToControlPlane: false,
  };

  const denied = resolveRuntimeAccess(base);
  assert.equal(denied.canExecutePaidCapabilities, false);
  assert.equal(denied.reason, "offline_lease_required");

  const allowed = resolveRuntimeAccess({
    ...base,
    offlineLease: {
      trustedNow: new Date("2026-09-05T00:00:00.000Z"),
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: new Date("2026-09-08T00:00:00.000Z"),
      signedLeaseHash: "sha256:lease",
      publicKeyId: "lios-control-plane-1",
      signatureVerified: true,
    },
  });

  assert.equal(allowed.canExecutePaidCapabilities, true);
  assert.equal(allowed.reason, "offline_lease_authorized");
});

test("pending and revoked devices cannot execute paid capabilities", () => {
  for (const deviceStatus of ["pending", "revoked"] as const) {
    const decision = resolveRuntimeAccess({
      planTier: "pro",
      licenseStatus: "active",
      deviceStatus,
      connectedToControlPlane: true,
    });
    assert.equal(decision.canOpenLocalWorkspace, true);
    assert.equal(decision.canExecutePaidCapabilities, false);
    assert.equal(decision.reason, "device_not_authorized");
  }
});
