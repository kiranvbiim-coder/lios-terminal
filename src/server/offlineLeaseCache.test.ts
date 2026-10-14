import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createSignedAsymmetricOfflineLicenseLease } from "./licenseLease";
import {
  cacheOfflineLeaseBundle,
  desktopDeviceFingerprintHash,
  evaluateCachedOfflineAccess,
} from "./offlineLeaseCache";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function makeEnv(root: string, deviceId = "workspace-device-12345"): NodeJS.ProcessEnv {
  return {
    LIOS_LICENSE_CACHE_DIR: root,
    LIOS_DESKTOP_DEVICE_ID: deviceId,
  };
}

test("device-bound signed offline lease authorizes only its entitled desktop", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-offline-lease-"));
  try {
    const env = makeEnv(root);
    const fingerprint = desktopDeviceFingerprintHash(env);
    assert.ok(fingerprint);
    const keys = keyPair();
    const anchors = { "test-key": keys.publicKey };
    const now = new Date("2026-09-19T10:00:00.000Z");
    const lease = createSignedAsymmetricOfflineLicenseLease({
      organizationId: 12,
      licenseId: 34,
      status: "active",
      seatsPurchased: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      keyId: "test-key",
      deviceFingerprintHash: fingerprint,
      planCode: "pro-monthly",
      entitlementMode: "allowlist",
      featureKeys: ["engine.valuation", "export.standard"],
    }, keys.privateKey);

    cacheOfflineLeaseBundle({ lease }, env);

    assert.deepEqual(evaluateCachedOfflineAccess("engine.valuation", now, env, anchors).allowed, true);
    assert.equal(evaluateCachedOfflineAccess("engine.quant-pro", now, env, anchors).reason, "offline_feature_not_entitled");
    assert.equal(
      evaluateCachedOfflineAccess("engine.valuation", now, makeEnv(root, "different-workspace-device"), anchors).reason,
      "offline_lease_wrong_device",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("expired or unscoped offline leases fail closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-offline-expired-"));
  try {
    const env = makeEnv(root);
    const keys = keyPair();
    const anchors = { "test-key": keys.publicKey };
    const now = new Date("2026-09-19T10:00:00.000Z");
    const expired = createSignedAsymmetricOfflineLicenseLease({
      organizationId: 1,
      licenseId: 2,
      status: "active",
      seatsPurchased: 1,
      issuedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      expiresAt: new Date(now.getTime() - 1000).toISOString(),
      keyId: "test-key",
      deviceFingerprintHash: desktopDeviceFingerprintHash(env) ?? undefined,
      entitlementMode: "unrestricted",
    }, keys.privateKey);
    cacheOfflineLeaseBundle({ lease: expired }, env);
    assert.equal(evaluateCachedOfflineAccess(undefined, now, env, anchors).reason, "offline_lease_expired");

    const unscoped = createSignedAsymmetricOfflineLicenseLease({
      organizationId: 1,
      licenseId: 2,
      status: "active",
      seatsPurchased: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      keyId: "test-key",
    }, keys.privateKey);
    cacheOfflineLeaseBundle({ lease: unscoped }, env);
    assert.equal(evaluateCachedOfflineAccess(undefined, now, env, anchors).reason, "offline_lease_unscoped");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a lease signed by a key that is not pinned is rejected even if it carries its own public key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-offline-forged-"));
  try {
    const env = makeEnv(root);
    const now = new Date("2026-09-19T10:00:00.000Z");
    const forger = keyPair();
    const forged = createSignedAsymmetricOfflineLicenseLease({
      organizationId: 1, licenseId: 2, status: "active", seatsPurchased: 99,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      keyId: "attacker-key", entitlementMode: "unrestricted",
    }, forger.privateKey);
    cacheOfflineLeaseBundle({ lease: forged }, env);
    // A v1-style file that also ships the forger's public key still cannot make the lease trusted.
    const file = path.join(root, "offline-entitlement.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, lease: forged, publicKey: forger.publicKey, cachedAt: now.toISOString() }));
    assert.equal(evaluateCachedOfflineAccess(undefined, now, env, { "pinned-key": keyPair().publicKey }).reason, "offline_lease_untrusted_key");
    // Signed with the pinned key id but a different private key: signature mismatch.
    const impostor = createSignedAsymmetricOfflineLicenseLease({ ...forged.payload, keyId: "pinned-key" }, forger.privateKey);
    cacheOfflineLeaseBundle({ lease: impostor }, env);
    assert.equal(evaluateCachedOfflineAccess(undefined, now, env, { "pinned-key": keyPair().publicKey }).reason, "offline_lease_invalid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unbound licence works on any install; a bound one only on its own", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-offline-unbound-"));
  try {
    const keys = keyPair();
    const anchors = { "test-key": keys.publicKey };
    const now = new Date("2026-09-19T10:00:00.000Z");
    const payload = {
      organizationId: 1, licenseId: 2, status: "active" as const, seatsPurchased: 5,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      keyId: "test-key", entitlementMode: "unrestricted" as const,
    };
    cacheOfflineLeaseBundle({ lease: createSignedAsymmetricOfflineLicenseLease(payload, keys.privateKey) }, makeEnv(root));
    assert.equal(evaluateCachedOfflineAccess("anything", now, makeEnv(root, "another-install-87654321"), anchors).allowed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
