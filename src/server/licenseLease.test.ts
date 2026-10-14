import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { LICENSE_TRUST_ANCHORS } from "@shared/licenseTrust";
import {
  createSignedAsymmetricOfflineLicenseLease,
  licenseKeyId,
  verifyAsymmetricOfflineLicenseLease,
  verifyLeaseAgainstTrustAnchors,
  type OfflineLicenseLeasePayload,
} from "./licenseLease";

const VALID_PAYLOAD: OfflineLicenseLeasePayload = {
  organizationId: 1,
  licenseId: 10,
  status: "active",
  seatsPurchased: 5,
  issuedAt: "2026-08-25T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  keyId: "ed25519:test",
};

test("Ed25519 leases verify with the public key and reject tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const otherPublicPem = otherPublicKey.export({ type: "spki", format: "pem" }).toString();
  const payload = { ...VALID_PAYLOAD, keyId: "ed25519:test" };
  const lease = createSignedAsymmetricOfflineLicenseLease(payload, privatePem);
  const now = new Date("2026-08-25T12:00:00.000Z");

  assert.equal(verifyAsymmetricOfflineLicenseLease(lease, publicPem, now).valid, true);
  assert.equal(verifyAsymmetricOfflineLicenseLease({ ...lease, payload: { ...payload, seatsPurchased: 99 } }, publicPem, now).reason, "lease_signature_mismatch");
  assert.equal(verifyAsymmetricOfflineLicenseLease(lease, otherPublicPem, now).reason, "lease_signature_mismatch");
});

test("pinned anchors: every anchor id is the hash of its own PEM, and the lease selects but never supplies its key", () => {
  for (const [id, pem] of Object.entries(LICENSE_TRUST_ANCHORS)) assert.equal(licenseKeyId(pem), id);
  const mine = generateKeyPairSync("ed25519");
  const theirs = generateKeyPairSync("ed25519");
  const privatePem = mine.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const minePublic = mine.publicKey.export({ type: "spki", format: "pem" }).toString();
  const now = new Date("2026-08-25T12:00:00.000Z");
  const lease = createSignedAsymmetricOfflineLicenseLease(VALID_PAYLOAD, privatePem);
  assert.equal(verifyLeaseAgainstTrustAnchors(lease, { [VALID_PAYLOAD.keyId]: minePublic }, now).valid, true);
  assert.equal(verifyLeaseAgainstTrustAnchors(lease, {}, now).reason, "lease_untrusted_key");
  assert.equal(
    verifyLeaseAgainstTrustAnchors(lease, { [VALID_PAYLOAD.keyId]: theirs.publicKey.export({ type: "spki", format: "pem" }).toString() }, now).reason,
    "lease_signature_mismatch",
  );
  assert.equal(verifyLeaseAgainstTrustAnchors(lease, { [VALID_PAYLOAD.keyId]: minePublic }, new Date("2026-09-02T00:00:00Z")).reason, "lease_expired");
  assert.equal(verifyLeaseAgainstTrustAnchors({ ...lease, payload: { ...lease.payload, status: "grace" } }, { [VALID_PAYLOAD.keyId]: minePublic }, now).reason, "lease_signature_mismatch");
});
