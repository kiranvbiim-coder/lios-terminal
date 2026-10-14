import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeviceProofPayload,
  deviceCapabilityAdvertisementSchema,
  deviceIdFromPublicKey,
  devicePublicKeySchema,
  deviceSignatureSchema,
  fromBase64Url,
  normalizeDeviceCapabilityAdvertisement,
  toBase64Url,
} from "./devicePairing";

test("base64url round-trips arbitrary bytes without padding", () => {
  for (const length of [0, 1, 2, 3, 31, 32, 33, 64]) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    const encoded = toBase64Url(bytes);
    assert.match(encoded, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(Array.from(fromBase64Url(encoded)), Array.from(bytes));
  }
});

test("an Ed25519 public key and signature have exactly the schema lengths, and the id is derived from the key", async () => {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode("x"))));
  assert.equal(devicePublicKeySchema.safeParse(publicKey).success, true);
  assert.equal(deviceSignatureSchema.safeParse(signature).success, true);
  const id = await deviceIdFromPublicKey(publicKey);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(id, await deviceIdFromPublicKey(publicKey));
  const other = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  assert.notEqual(id, await deviceIdFromPublicKey(toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey)))));
});

test("the proof payload binds every field, and empty declarations retain v1 compatibility", () => {
  const base = { deviceId: "a".repeat(32), clientId: "app", clientMode: "ui", scopes: ["write", "read"], signedAt: 1000, nonce: "n", pairingToken: "" };
  const payload = buildDeviceProofPayload(base);
  assert.ok(payload.startsWith("lios-device-v1|"));
  assert.equal(payload, buildDeviceProofPayload({ ...base, scopes: ["read", "write"], capabilities: [], commands: [] }));
  for (const change of [{ deviceId: "b".repeat(32) }, { clientId: "x" }, { clientMode: "cli" }, { scopes: ["read"] }, { signedAt: 1001 }, { nonce: "m" }, { pairingToken: "t" }]) {
    assert.notEqual(buildDeviceProofPayload({ ...base, ...change }), payload, JSON.stringify(change));
  }
});

test("capability declarations are normalized, bounded and cryptographically bound", () => {
  const base = {
    deviceId: "a".repeat(32), clientId: "node", clientMode: "service", scopes: ["read"],
    signedAt: 1000, nonce: "n", pairingToken: "",
    capabilities: ["camera", "screen", "camera"],
    commands: ["screen.capture", "camera.snap"],
  };
  const normalized = normalizeDeviceCapabilityAdvertisement(base);
  assert.deepEqual(normalized, {
    capabilities: ["camera", "screen"],
    commands: ["camera.snap", "screen.capture"],
  });
  const payload = buildDeviceProofPayload(base);
  assert.ok(payload.startsWith("lios-device-v2|"));
  assert.equal(payload, buildDeviceProofPayload({
    ...base,
    capabilities: ["screen", "camera"],
    commands: ["camera.snap", "screen.capture"],
  }));
  assert.notEqual(payload, buildDeviceProofPayload({ ...base, commands: ["camera.snap"] }));
  assert.equal(deviceCapabilityAdvertisementSchema.safeParse({
    capabilities: Array.from({ length: 65 }, (_, index) => `cap.${index}`),
    commands: [],
  }).success, false);
  assert.equal(deviceCapabilityAdvertisementSchema.safeParse({ capabilities: ["bad command!"], commands: [] }).success, false);
});
