import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeDeviceHome,
  EMPTY_DEVICE_HOMES_STATE,
  recordFromPairingInvitation,
  removeDeviceHome,
  setActiveDeviceHome,
  upsertDeviceHome,
} from "./deviceHomes";

const invitation = {
  version: 1 as const,
  homeId: "d14d7195-2bac-4005-9c30-8350365c52c9",
  name: "Office",
  urls: ["wss://192.168.1.10:8443/gateway/device"],
  fingerprint: "c".repeat(64),
  pairingToken: "x".repeat(43),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

test("remembered Homes replace fingerprint changes and keep one active Home", () => {
  const first = upsertDeviceHome(EMPTY_DEVICE_HOMES_STATE, recordFromPairingInvitation(invitation));
  assert.equal(activeDeviceHome(first)?.homeId, invitation.homeId);
  const rotated = upsertDeviceHome(first, recordFromPairingInvitation({
    ...invitation,
    fingerprint: "d".repeat(64),
  }));
  assert.equal(rotated.homes.length, 1);
  assert.equal(rotated.homes[0]?.fingerprint, "d".repeat(64));
  const secondHome = upsertDeviceHome(rotated, recordFromPairingInvitation({
    ...invitation,
    homeId: "11111111-1111-4111-8111-111111111111",
    name: "Lab",
  }));
  const chosen = setActiveDeviceHome(secondHome, "11111111-1111-4111-8111-111111111111");
  assert.equal(activeDeviceHome(chosen)?.name, "Lab");
  const removed = removeDeviceHome(chosen, invitation.homeId);
  assert.equal(removed.homes.length, 1);
  assert.equal(removed.activeHomeId, "11111111-1111-4111-8111-111111111111");
});
