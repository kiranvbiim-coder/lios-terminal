import assert from "node:assert/strict";
import test from "node:test";
import { decodeDevicePairingInvitation, encodeDevicePairingInvitation } from "@shared/deviceNetwork";
import type { DevicePairingInvitation } from "@shared/deviceNetwork";

const invitation: DevicePairingInvitation = {
  version: 1,
  homeId: "d14d7195-2bac-4005-9c30-8350365c52c9",
  name: "My Home",
  urls: ["wss://192.168.1.23:45555/gateway/device", "wss://[::1]:45555/gateway/device"],
  fingerprint: "a".repeat(64),
  pairingToken: "x".repeat(43),
  expiresAt: "2026-10-02T18:05:00Z",
};

test("a pairing invitation preserves Home identity, addresses, certificate pin and token", () => {
  assert.deepEqual(decodeDevicePairingInvitation(encodeDevicePairingInvitation(invitation), Date.parse("2026-10-02T18:00:00Z")), invitation);
});

test("an invitation expires at its deadline, not one millisecond later", () => {
  const wire = encodeDevicePairingInvitation(invitation);
  assert.deepEqual(decodeDevicePairingInvitation(wire, Date.parse(invitation.expiresAt) - 1), invitation);
  assert.throws(() => decodeDevicePairingInvitation(wire, Date.parse(invitation.expiresAt)), /expired/);
});

test("plaintext, credential-bearing and unrelated endpoints cannot be encoded as pinned invitations", () => {
  for (const url of ["ws://192.168.1.1/gateway/device", "https://192.168.1.1/gateway/device", "wss://user:secret@home/gateway/device", "wss://home/api/auth/me", "wss://home/gateway/device?token=secret", "wss://home/gateway/device#secret"]) {
    assert.throws(() => encodeDevicePairingInvitation({ ...invitation, urls: [url] }));
  }
  assert.throws(() => encodeDevicePairingInvitation({ ...invitation, fingerprint: "bad" }));
  assert.throws(() => decodeDevicePairingInvitation("lios-pair:v1:" + "x".repeat(16_384)), /Invalid/);
  assert.throws(() => decodeDevicePairingInvitation("https://not-an-invitation"), /Invalid/);
});
