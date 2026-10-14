import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSignedAsymmetricOfflineLicenseLease, licenseKeyId, type OfflineLicenseLeasePayload } from "./licenseLease";
import { importLicenseFile, LicenseImportError, licenseStatus, parseLicenseFile, serializeLicenseFile } from "./licenseFile";
import { desktopDeviceFingerprintHash } from "./offlineLeaseCache";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const vendor = generateKeyPairSync("ed25519");
const vendorPrivate = vendor.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const vendorPublic = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = licenseKeyId(vendorPublic);
const anchors = { [keyId]: vendorPublic };

function setup(t: test.TestContext, deviceId = "install-one-12345678") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { env: { LIOS_LICENSE_CACHE_DIR: root, LIOS_DESKTOP_DEVICE_ID: deviceId } satisfies NodeJS.ProcessEnv, root };
}

function issue(overrides: Partial<OfflineLicenseLeasePayload> = {}, privateKey = vendorPrivate): string {
  return serializeLicenseFile(createSignedAsymmetricOfflineLicenseLease({
    organizationId: 3, licenseId: 4, status: "active", seatsPurchased: 10,
    issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    keyId, entitlementMode: "allowlist", featureKeys: ["engine.valuation"], planCode: "pro", ...overrides,
  }, privateKey));
}

test("a vendor-signed licence imports, persists and reports its terms without any network call", (t) => {
  const { env } = setup(t);
  assert.equal(licenseStatus(env, NOW, anchors).state, "none");
  const status = importLicenseFile(issue(), env, NOW, anchors);
  assert.deepEqual([status.state, status.planCode, status.seats, status.bound, status.featureCount], ["valid", "pro", 10, false, 1]);
  assert.equal(licenseStatus(env, NOW, anchors).state, "valid", "survives a reload from disk");
  assert.equal(licenseStatus(env, new Date(NOW.getTime() + 40 * 86_400_000), anchors).state, "offline_lease_expired");
});

test("a device-bound licence installs only on its install and the status exposes the hash to request one", (t) => {
  const { env } = setup(t);
  const hash = desktopDeviceFingerprintHash(env);
  assert.ok(hash);
  assert.equal(licenseStatus(env, NOW, anchors).deviceFingerprintHash, hash);
  assert.equal(importLicenseFile(issue({ deviceFingerprintHash: hash }), env, NOW, anchors).bound, true);
  const other = setup(t, "different-install-87654321");
  assert.throws(() => importLicenseFile(issue({ deviceFingerprintHash: hash }), other.env, NOW, anchors), /different installation/);
  assert.equal(licenseStatus(other.env, NOW, anchors).state, "none", "a refused import stores nothing");
});

test("forged, altered, unpinned, expired, malformed and oversized files are refused and keep the current licence", (t) => {
  const { env } = setup(t);
  importLicenseFile(issue(), env, NOW, anchors);
  const attacker = generateKeyPairSync("ed25519");
  const attackerPrivate = attacker.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const refusals: Array<[string, RegExp]> = [
    [issue({}, attackerPrivate), /signature is not valid/],
    [issue({ keyId: "unknown-key" }), /not issued by a trusted/],
    [issue({ expiresAt: "2026-09-01T00:00:00.000Z" }), /expired/],
    [issue({ entitlementMode: undefined }), /does not state/],
    [issue().replace('"seatsPurchased": 10', '"seatsPurchased": 9999'), /signature is not valid/],
    [issue().replace('"planCode": "pro"', '"planCode": "pro", "extra": true'), /not a valid/],
    ["{\"format\":\"other\"}", /not a valid/],
    ["not json", /not a LiOS licence/],
    ["x".repeat(70_000), /too large/],
  ];
  for (const [text, message] of refusals) assert.throws(() => importLicenseFile(text, env, NOW, anchors), (error) => error instanceof LicenseImportError && message.test(error.message), message.source);
  assert.equal(licenseStatus(env, NOW, anchors).state, "valid");
  assert.equal(parseLicenseFile(issue()).payload.planCode, "pro");
});
