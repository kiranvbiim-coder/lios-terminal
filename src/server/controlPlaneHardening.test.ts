import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDeviceAuthorization,
  hasFeatureEntitlement,
} from "./controlPlanePolicy";
import { deviceFingerprintHashFromRequest, ensureDeviceBindingCookie } from "./auth";

// ─── deviceFingerprintHashFromRequest ────────────────────────────────────────

function fakeReq(headers: Record<string, string>): Request {
  return {
    header(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as Request;
}

function withLegacyDeviceHeaderEnabled(fn: () => void): void {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
  process.env.NODE_ENV = "test";
  process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = "true";
  try {
    fn();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFlag === undefined) delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
    else process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = previousFlag;
  }
}

test("deviceFingerprintHashFromRequest ignores legacy fingerprints by default", () => {
  assert.equal(
    deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "abcdef0123456789" })),
    null,
  );
});

test("deviceFingerprintHashFromRequest accepts valid legacy fingerprints only in explicit non-production migration mode", () => {
  withLegacyDeviceHeaderEnabled(() => {
    assert.equal(
      deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "abcdef0123456789" })),
      "abcdef0123456789",
    );
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({})), null);
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "" })), null);
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "short" })), null);
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "   " })), null);
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "123456789012345" })), null);
    assert.equal(
      deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "1234567890123456" })),
      "1234567890123456",
    );
  });
});

test("production never accepts legacy device fingerprint headers even when migration flag is set", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
  process.env.NODE_ENV = "production";
  process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = "true";
  try {
    assert.equal(
      deviceFingerprintHashFromRequest(fakeReq({ "x-lios-device-fingerprint": "abcdef0123456789" })),
      null,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFlag === undefined) delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
    else process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = previousFlag;
  }
});

test("server-issued device binding cookies produce stable fingerprints and reject tampering", () => {
  const previous = process.env.LIMURIA_DEVICE_BINDING_SECRET;
  process.env.LIMURIA_DEVICE_BINDING_SECRET = "device-binding-test-secret-at-least-32-characters";
  try {
    let cookie = "";
    ensureDeviceBindingCookie(fakeReq({}), {
      append(_name: string, value: string) { cookie = value; },
    } as never);
    assert.match(cookie, /^lios_device_binding=/);
    const cookieHeader = cookie.split(";")[0];
    const headers = { cookie: cookieHeader };
    const first = deviceFingerprintHashFromRequest(fakeReq(headers));
    const second = deviceFingerprintHashFromRequest(fakeReq(headers));
    assert.ok(first);
    assert.equal(first, second);
    assert.equal(first?.length, 64);
    assert.equal(deviceFingerprintHashFromRequest(fakeReq({ cookie: `${cookieHeader}tampered` })), null);
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DEVICE_BINDING_SECRET;
    else process.env.LIMURIA_DEVICE_BINDING_SECRET = previous;
  }
});
// ─── evaluateDeviceAuthorization edge cases ──────────────────────────────────

test("device auth boundary: lease expires exactly at now is still valid", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const result = evaluateDeviceAuthorization({ status: "authorized", leaseExpiresAt: now }, now);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "device_authorized");
});

test("device auth boundary: lease 1ms before now is expired", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const result = evaluateDeviceAuthorization({
    status: "authorized",
    leaseExpiresAt: new Date(now.getTime() - 1),
  }, now);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "device_lease_expired");
});

test("device auth: authorized with no lease expiry is valid", () => {
  const result = evaluateDeviceAuthorization({ status: "authorized" }, new Date());
  assert.equal(result.allowed, true);
});

// ─── hasFeatureEntitlement edge cases ────────────────────────────────────────

test("entitlement: empty entitlement list denies", () => {
  assert.equal(hasFeatureEntitlement([], "valuation.dcf"), false);
});

test("entitlement: wildcard with future expiry grants", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  assert.equal(
    hasFeatureEntitlement([{ featureKey: "*", active: true, expiresAt: "2026-09-01T00:00:00.000Z" }], "anything", now),
    true,
  );
});

test("entitlement: wildcard with past expiry denies", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  assert.equal(
    hasFeatureEntitlement([{ featureKey: "*", active: true, expiresAt: "2026-08-24T00:00:00.000Z" }], "anything", now),
    false,
  );
});

test("entitlement: inactive exact match denies", () => {
  assert.equal(
    hasFeatureEntitlement([{ featureKey: "valuation.dcf", active: false }], "valuation.dcf"),
    false,
  );
});

test("entitlement: multiple entries, one match grants", () => {
  assert.equal(
    hasFeatureEntitlement([
      { featureKey: "export.pdf", active: true },
      { featureKey: "export.xlsx", active: false },
      { featureKey: "valuation.dcf", active: true },
    ], "valuation.dcf"),
    true,
  );
});
